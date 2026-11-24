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
 * proyectoDeConsultor: async (consultor_id) => proyecto_id | null
 */
function envolverRepositorio(repo, { proyectoDeConsultor }) {
  async function proyectoDe(a, consultorId) {
    if (consultorId === null || consultorId === undefined) return null;
    const id = Number(consultorId);
    if (a.creados.has(id)) return a.creados.get(id); // creado en esta misma petición (p. ej. dentro de la transacción)
    return proyectoDeConsultor(id);
  }

  async function verificar(entidad, { id = null, fila = null, cambios = null, opts = {} }) {
    const a = alcanceActual();
    if (!a || a.rol !== 'JEFE_PROYECTO') return;
    if (entidad === 'proyecto_miembro' || entidad === 'proyecto') throw denegar('Solo el Administrador modifica proyectos y define sus equipos');
    const proyectos = new Set();
    // Resolver la pertenencia desde las claves persistidas; no confiar en opts.consultor_id.
    const d = await repo.cargarTodo();
    async function resolver(tipo, registroId, filaNueva, vistos = new Set()) {
      const meta = ENTIDADES[tipo];
      if (!meta) throw denegar('Entidad sin alcance definido');
      const llave = `${tipo}:${registroId}`;
      if (vistos.has(llave)) throw denegar();
      vistos.add(llave);
      const filas = tipo === 'documento' ? await repo.listarDocumentos({ incluirRetirados: true }) : d[meta.coleccion] || [];
      const f = filaNueva || filas.find(x => x[meta.pk] === Number(registroId));
      if (!f) throw denegar('No se pudo determinar el proyecto del registro');
      if (f.proyecto_id) proyectos.add(Number(f.proyecto_id));
      if (tipo === 'consultor') { const p = await proyectoDe(a, f.consultor_id); if (p) proyectos.add(p); }
      else if (f.consultor_id) { const p = await proyectoDe(a, f.consultor_id); if (p) proyectos.add(p); }
      if (f.plan_id && tipo !== 'plan_trabajo') await resolver('plan_trabajo', f.plan_id, null, new Set(vistos));
      if (f.contrato_id && tipo !== 'contrato') await resolver('contrato', f.contrato_id, null, new Set(vistos));
      if (tipo === 'actividad_dependencia') {
        await resolver('actividad', f.actividad_id, null, new Set(vistos));
        await resolver('actividad', f.predecesora_id, null, new Set(vistos));
      }
    }
    if (id !== null) {
      await resolver(entidad, id);
      const meta = ENTIDADES[entidad];
      const filas = entidad === 'documento' ? await repo.listarDocumentos({ incluirRetirados: true }) : d[meta.coleccion] || [];
      await resolver(entidad, id, { ...filas.find(x => x[meta.pk] === id), ...cambios });
    } else await resolver(entidad, null, fila);
    if (!proyectos.size && !(entidad === 'documento' && fila?.tipo === 'CARGA')) throw denegar('No se pudo determinar el proyecto del registro');
    if (entidad === 'proyecto') proyectos.add(Number(id));
    if (entidad === 'consultor' && fila && fila.proyecto_id) proyectos.add(Number(fila.proyecto_id));
    if (entidad === 'consultor' && id !== null) { const p = await proyectoDe(a, id); if (p) proyectos.add(p); }
    if (cambios && cambios.proyecto_id) proyectos.add(Number(cambios.proyecto_id)); // mover un profesional a otro proyecto
    if (fila && fila.proyecto_id && entidad !== 'consultor') proyectos.add(Number(fila.proyecto_id));
    if (opts.consultor_id !== null && opts.consultor_id !== undefined && entidad !== 'consultor') { const p = await proyectoDe(a, opts.consultor_id); if (p) proyectos.add(p); }
    for (const p of proyectos) if (!a.proyectos.includes(p)) throw denegar();
  }

  function anotar(entidad, nueva) {
    const a = alcanceActual();
    if (a && entidad === 'consultor' && nueva && nueva.consultor_id) a.creados.set(Number(nueva.consultor_id), nueva.proyecto_id ? Number(nueva.proyecto_id) : null);
  }

  const envolver = (base) => ({
    crear: async (entidad, fila, opts = {}) => { await verificar(entidad, { fila, opts }); const r = await base.crear(entidad, fila, opts); anotar(entidad, r); return r; },
    actualizar: async (entidad, id, cambios, opts = {}) => { await verificar(entidad, { id: Number(id), cambios, opts }); return base.actualizar(entidad, id, cambios, opts); },
  });

  return {
    ...repo,
    ...envolver(repo),
    transaccion: (fn) => repo.transaccion((t) => fn({ ...t, ...envolver(t) })),
  };
}

module.exports = { alcanceDe, ejecutarConAlcance, alcanceActual, puedeEscribirProyecto, puedeVerConfidencial, envolverRepositorio, MENSAJE };
