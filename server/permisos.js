'use strict';
/**
 * Permisos por proyecto (criterio C6 de PLAN_DE_MEJORAS.md; equipos en sgf.proyecto_miembro, db/15).
 *
 * Decisiones D1 y D2: el Equipo de Desarrollo usa el perfil JEFE_PROYECTO; un Jefe de Proyecto LEE todos los
 * proyectos pero solo ESCRIBE en los de su equipo. El Administrador escribe en todos. El alcance del PROFESIONAL
 * lo siguen imponiendo server.js (lista blanca) y los servicios.
 *
 * Cómo se impone: cada petición de la API corre dentro de un «alcance» (AsyncLocalStorage) con el perfil y los
 * proyectos del usuario, leídos de la base en esa misma petición. El repositorio va envuelto: toda escritura de
 * entidad (crear/actualizar, también dentro de una transacción) averigua el proyecto del registro y, si un Jefe de
 * Proyecto no es miembro de ese proyecto, responde 403 antes de escribir. Así quedan cubiertas todas las vías:
 * API, asistente de IA, carga de documentos, Actualizar Desde Archivo y formulación.
 * Sin alcance (arranque, recálculo diario, herramientas, pruebas que llaman al servicio) no se restringe.
 *
 * Matriz (§7 del plan):
 *   acción                                         ADMIN  JEFE_PROYECTO        PROFESIONAL
 *   ver tablero y cualquier proyecto                 ✔     ✔ todos              ✘ (solo su ficha)
 *   crear/editar proyectos y su equipo               ✔     ✘                    ✘
 *   escribir en un proyecto (profesionales, OS,      ✔     ✔ solo sus proyectos  avance/estado de sus actividades
 *     adendas, planes, actividades, documentos)
 *   documentos confidenciales (OS, notificación)     ✔     ✔ solo sus proyectos  ✘
 *   cuentas, perfiles y datos personales             ✔     ✘                    ✘
 */
const { AsyncLocalStorage } = require('async_hooks');

const { ENTIDADES } = require('./datos/entidades');
const als = new AsyncLocalStorage();
const MENSAJE = 'Solo puede modificar los proyectos de su equipo. Pida al Administrador que lo incluya en el equipo de este proyecto.';
const denegar = (msg = MENSAJE) => Object.assign(new Error(msg), { estado: 403 });

/** Alcance de una petición autenticada. */
function alcanceDe(usuario) {
  if (!usuario) return null;
  return { rol: usuario.rol, usuario: usuario.correo, proyectos: (usuario.proyectos || []).map(Number), creados: new Map() };
}

const ejecutarConAlcance = (alcance, fn) => als.run(alcance, fn);
const alcanceActual = () => als.getStore() || null;

/** ¿Puede escribir en el proyecto? (sin alcance = proceso del sistema: sí). */
function puedeEscribirProyecto(alcance, proyectoId) {
  if (!alcance) return true;
  if (alcance.rol === 'ADMIN') return true;
  if (alcance.rol === 'JEFE_PROYECTO') return proyectoId === null || proyectoId === undefined || alcance.proyectos.includes(Number(proyectoId));
  return alcance.rol === 'PROFESIONAL'; // su alcance lo acotan server.js y los servicios
}

/** ¿Puede ver un documento confidencial del proyecto? (OS, notificación: decisión D4 y criterio C10). */
function puedeVerConfidencial(usuario, proyectoId) {
  if (!usuario) return false;
  if (usuario.rol === 'ADMIN') return true;
  if (usuario.rol !== 'JEFE_PROYECTO') return false;
  return proyectoId != null && (usuario.proyectos || []).map(Number).includes(Number(proyectoId));
}

/**
 * Envuelve el repositorio para que toda escritura de entidad respete el alcance por proyecto.
 *   proyectoDeConsultor: async (consultor_id) => proyecto_id | null
 *   datos: async (forzar) => foto de la base (servicio.datos; en caché unos segundos)
 *
 * El proyecto se resuelve desde las claves guardadas del registro (proyecto_id, consultor_id, plan_id, contrato_id,
 * parte_id, actividad_id…), no desde lo que diga quien llama. Si no se puede determinar, se niega.
 * IMPORTANTE: dentro de una transacción NO se relee la base (en SQL Server esa lectura esperaría a los bloqueos de la
 * propia transacción); se usan la foto ya leída y los registros creados en esa misma petición.
 */
function envolverRepositorio(repo, { proyectoDeConsultor, datos = null }) {
  async function proyectoDe(a, consultorId) {
    if (consultorId === null || consultorId === undefined) return null;
    const id = Number(consultorId);
    if (a.creados.has(id)) return a.creados.get(id); // creado en esta misma petición (p. ej. dentro de la transacción)
    const fila = a.creadosFila && a.creadosFila.get(`consultor:${id}`);
    if (fila) return fila.proyecto_id ? Number(fila.proyecto_id) : null;
    if (a.enTransaccion && a.foto) { const c = (a.foto.consultores || []).find((x) => x.consultor_id === id); return c && c.proyecto_id ? Number(c.proyecto_id) : null; }
    return proyectoDeConsultor(id);
  }

  /** Busca un registro por su clave: creado en esta petición, en la foto en caché o (fuera de transacción) releyendo. */
  async function buscar(a, tipo, id) {
    if (id === null || id === undefined) return null;
    const meta = ENTIDADES[tipo];
    if (!meta) return null;
    const creado = a.creadosFila && a.creadosFila.get(`${tipo}:${Number(id)}`);
    if (creado) return creado;
    const en = (d) => (d && d[meta.coleccion] ? d[meta.coleccion].find((x) => x[meta.pk] === Number(id)) : null);
    let f = a.enTransaccion && a.foto ? en(a.foto) : datos ? en(await datos(false)) : null;
    if (!f && !a.enTransaccion) {
      if (tipo === 'documento') f = (await repo.listarDocumentos({ incluirRetirados: true })).find((x) => x.documento_id === Number(id)) || null;
      else if (tipo === 'parte_diario') f = (await repo.listarPartes({ limite: 1000 })).find((x) => x.parte_id === Number(id)) || null;
      else f = en(datos ? await datos(true) : await repo.cargarTodo());
    }
    return f || null;
  }

  /** Proyectos a los que pertenece una fila (siguiendo sus claves hacia el consultor o el proyecto). */
  async function proyectosDe(a, tipo, f, acumulado, vistos = new Set()) {
    if (!f) return;
    const llave = `${tipo}:${f[(ENTIDADES[tipo] || {}).pk] ?? 'nuevo'}`;
    if (vistos.has(llave)) return;
    vistos.add(llave);
    if (f.proyecto_id) acumulado.add(Number(f.proyecto_id));
    if (tipo === 'proyecto' && f.proyecto_id) acumulado.add(Number(f.proyecto_id));
    if (tipo !== 'consultor' && f.consultor_id) { const p = await proyectoDe(a, f.consultor_id); if (p) acumulado.add(p); }
    const seguir = [['plan_id', 'plan_trabajo'], ['contrato_id', 'contrato'], ['parte_id', 'parte_diario'], ['actividad_id', 'actividad'], ['predecesora_id', 'actividad']];
    for (const [campo, destino] of seguir) {
      if (f[campo] && tipo !== destino) await proyectosDe(a, destino, await buscar(a, destino, f[campo]), acumulado, vistos);
      else if (f[campo] && tipo === 'actividad_dependencia' && destino === 'actividad') await proyectosDe(a, destino, await buscar(a, destino, f[campo]), acumulado, vistos);
    }
  }

  async function verificar(entidad, { id = null, fila = null, cambios = null, opts = {} }) {
    const a = alcanceActual();
    if (!a || a.rol !== 'JEFE_PROYECTO') return;
    // Excepción única: el cambio AUTOMÁTICO de estado de un proyecto del equipo (p. ej. REGISTRADO → EN_EJECUCION al
    // notificar su primera Orden de Servicio). Lo marca el servidor con origen SISTEMA; el usuario no puede pedirlo.
    const automatico = entidad === 'proyecto' && id !== null && opts.origen === 'SISTEMA' && cambios && Object.keys(cambios).every((k) => k === 'estado');
    if (automatico) { if (!a.proyectos.includes(Number(id))) throw denegar(); return; }
    // Cierre formal (cierre.js): el equipo del proyecto lo cierra con su informe y sus lecciones aprendidas
    const cierre = entidad === 'proyecto' && id !== null && opts.operacion === 'CIERRE' && cambios && cambios.estado === 'CERRADO'
      && Object.keys(cambios).every((k) => ['estado', 'fecha_cierre', 'lecciones_aprendidas'].includes(k));
    if (cierre) { if (!a.proyectos.includes(Number(id))) throw denegar(); return; }
    if (entidad === 'proyecto_miembro' || entidad === 'proyecto') throw denegar('Solo el Administrador modifica proyectos y define sus equipos');
    if (!ENTIDADES[entidad]) throw denegar('Entidad sin alcance definido');
    const proyectos = new Set();
    if (id !== null) {
      const previa = await buscar(a, entidad, id);
      if (!previa) throw denegar('No se pudo determinar el proyecto del registro');
      if (entidad === 'consultor') { const p = await proyectoDe(a, id); if (p) proyectos.add(p); }
      await proyectosDe(a, entidad, previa, proyectos);
      if (cambios) await proyectosDe(a, entidad, { ...previa, ...cambios }, proyectos); // p. ej. mover un profesional a otro proyecto
    } else {
      await proyectosDe(a, entidad, fila || {}, proyectos);
    }
    if (opts.consultor_id !== null && opts.consultor_id !== undefined && entidad !== 'consultor') { const p = await proyectoDe(a, opts.consultor_id); if (p) proyectos.add(p); }
    if (!proyectos.size && !(entidad === 'documento' && fila && fila.tipo === 'CARGA')) throw denegar('No se pudo determinar el proyecto del registro');
    for (const p of proyectos) if (!a.proyectos.includes(p)) throw denegar();
  }

  function anotar(entidad, nueva) {
    const a = alcanceActual();
    if (!a || !nueva) return;
    const meta = ENTIDADES[entidad];
    if (!a.creadosFila) a.creadosFila = new Map();
    if (meta && nueva[meta.pk] !== undefined) a.creadosFila.set(`${entidad}:${Number(nueva[meta.pk])}`, nueva);
    if (entidad === 'consultor' && nueva.consultor_id) a.creados.set(Number(nueva.consultor_id), nueva.proyecto_id ? Number(nueva.proyecto_id) : null);
  }

  const envolver = (base) => ({
    crear: async (entidad, fila, opts = {}) => { await verificar(entidad, { fila, opts }); const r = await base.crear(entidad, fila, opts); anotar(entidad, r); return r; },
    actualizar: async (entidad, id, cambios, opts = {}) => { await verificar(entidad, { id: Number(id), cambios, opts }); return base.actualizar(entidad, id, cambios, opts); },
  });

  return {
    ...repo,
    ...envolver(repo),
    transaccion: async (fn) => {
      const a = alcanceActual();
      const previo = a ? a.enTransaccion : false;
      const fotoPrevia = a ? a.foto : null;
      if (a) { a.foto = datos ? await datos(false) : await repo.cargarTodo(); a.enTransaccion = true; } // la foto se toma ANTES de abrir la transacción
      try { return await repo.transaccion((t) => fn({ ...t, ...envolver(t) })); } finally { if (a) { a.enTransaccion = previo; a.foto = fotoPrevia; } }
    },
  };
}

module.exports = { alcanceDe, ejecutarConAlcance, alcanceActual, puedeEscribirProyecto, puedeVerConfidencial, envolverRepositorio, MENSAJE };
