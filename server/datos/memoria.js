'use strict';
/**
 * Repositorio en memoria (modo DEMO y pruebas). Replica el comportamiento del
 * repositorio SQL Server: revisión optimista, baja lógica, historial por
 * entidad (emula las tablas temporales) y bitácora. Si se indica un archivo,
 * persiste el estado en JSON para sobrevivir a reinicios.
 */
const fs = require('fs');
const path = require('path');
const { ENTIDADES } = require('./entidades');

/**
 * Equivale a db/06_historial_adendas.sql: un estado demo guardado antes del historial recibe las adendas
 * CONCLUIDA de la semilla que le falten (se identifican por contrato y n.° de adenda; las existentes no se tocan).
 */
function incorporarHistorial(db, semilla) {
  if (!semilla || !db.adendas) return;
  const hay = new Set(db.adendas.map((a) => `${a.contrato_id}|${a.numero}`));
  let sigId = db.adendas.reduce((m, a) => Math.max(m, a.adenda_id), 0) + 1;
  let n = 0;
  for (const a of semilla.adendas || []) {
    if (a.estado !== 'CONCLUIDA' || hay.has(`${a.contrato_id}|${a.numero}`) || !db.contratos.some((k) => k.contrato_id === a.contrato_id)) continue;
    db.adendas.push({ ...JSON.parse(JSON.stringify(a)), adenda_id: sigId++, activo: 1, revision: 1 });
    n += 1;
  }
  if (n) {
    db.bitacora.push({ bitacora_id: db.bitacora.reduce((m, b) => Math.max(m, b.bitacora_id), 0) + 1, fecha: new Date().toISOString(), usuario: 'sistema', entidad: 'adenda', entidad_id: null, consultor_id: null, accion: 'CREAR', cambios_json: JSON.stringify({ adendas_concluidas_insertadas: n }), motivo: 'Carga del historial de adendas 01 y 02 (db/fuentes/historial_adendas_01_02.csv)', origen: 'SCRIPT' });
  }
}

/**
 * Equivale a db/07_perfiles_usuario.sql: EDITOR pasa a JEFE_PROYECTO; las cuentas LECTOR quedan como
 * PROFESIONAL inactivas y sin vínculo (se reactivan vinculándolas a un consultor).
 */
function migrarPerfiles(db) {
  for (const u of db.usuarios || []) {
    if (u.rol === 'EDITOR') u.rol = 'JEFE_PROYECTO';
    else if (u.rol === 'LECTOR') { u.rol = 'PROFESIONAL'; u.activo = 0; u.consultor_id = null; }
  }
}

/**
 * Equivale a db/12_proyectos.sql: crea el proyecto inicial y asigna a él los consultores que aún no tienen proyecto.
 */
function migrarProyectos(db) {
  if (!db.proyectos) db.proyectos = [];
  if (!db.proyectos.length) {
    db.proyectos.push({ proyecto_id: 1, codigo: 'GF2026', nombre: 'Gestiona Forestal 2026 – Proyecto Bosques PI 2 (UE 003 – CUI 2455355)', financiador: 'KfW', area_tecnica: 'Oficina de Tecnologías de la Información – OTI', jefe_proyecto: null, fecha_inicio: null, fecha_fin: null, descripcion: null, estado: 'ACTIVO', activo: 1, revision: 1 });
  }
  for (const p of db.proyectos) {
    for (const [k, v] of Object.entries({ con_profesionales: 1, con_adendas: 1, con_linea_base: 1, con_orden_servicio: 0, con_tdr: 0 })) if (p[k] === undefined) p[k] = v;
    // db/16: modalidad según las características; ACTIVO pasa a EN_EJECUCION
    if (!p.modalidad) {
      p.modalidad = p.con_profesionales === 0 ? 'GESTION_INTERNA' : p.con_adendas === 1 ? 'CONTRATO_ADENDAS' : 'ORDEN_SERVICIO';
      p.es_atipico = p.modalidad === 'CONTRATO_ADENDAS' ? 1 : 0;
      if (p.es_atipico && !p.motivo_atipico) {
        p.motivo_atipico = p.codigo === 'GF2026'
          ? 'Dirección de Control – Gestiona Forestal: equipo de profesionales BPS contratados desde 2025 con contrato y adendas sucesivas; cronograma propio (MS Project v3) financiado por KfW.'
          : 'Proyecto con contrato y adendas registrado antes de la modalidad (db/16).';
      }
    }
    if (p.estado === 'ACTIVO') p.estado = 'EN_EJECUCION';
  }
  // db/17: contrataciones existentes en ejecución, periodos existentes como ADENDA, parámetros de entregables
  for (const k of db.contratos || []) if (!k.estado_contratacion) k.estado_contratacion = 'EN_EJECUCION';
  for (const a of db.adendas || []) if (!a.tipo_periodo) a.tipo_periodo = 'ADENDA';
  if (!db.entregables_servicio) db.entregables_servicio = [];
  // db/18: partes diarios y parámetros de supervisión
  if (!db.partes) db.partes = [];
  if (!db.partes_items) db.partes_items = [];
  for (const [codigo, valor, descripcion] of [['PLAZO_REVISION_DIAS', '7', 'Días calendario para dar la conformidad u observar un entregable presentado.'], ['PLAZO_SUBSANACION_DIAS', '5', 'Días calendario para subsanar una observación, si el TDR no fija otro plazo.'], ['PARTE_DIAS_ATRAS', '3', 'Días hábiles hacia atrás en que se puede registrar un parte diario sin justificación.'], ['UMBRAL_SIN_PARTE_DIAS', '3', 'Alerta cuando un profesional con Orden de Servicio en ejecución lleva más de estos días hábiles sin parte diario.']]) {
    if (db.parametros && !db.parametros.some((x) => x.codigo === codigo)) db.parametros.push({ codigo, valor, descripcion });
  }
  for (const [codigo, valor, descripcion] of [['UMBRAL_ENTREGABLE_DIAS', '7', 'Alerta cuando faltan estos días o menos para la fecha límite de un entregable sin presentar.'], ['UMBRAL_BORRADOR_DIAS', '5', 'Alerta cuando una Orden de Servicio registrada lleva estos días o más sin notificación.']]) {
    if (db.parametros && !db.parametros.some((x) => x.codigo === codigo)) db.parametros.push({ codigo, valor, descripcion });
  }
  for (const c of db.consultores || []) if (!c.proyecto_id) c.proyecto_id = db.proyectos[0].proyecto_id;
}

/**
 * Equivale a db/14 y db/15: colecciones de documentos y de equipos. Al crear la colección de equipos, cada
 * JEFE_PROYECTO activo queda en el equipo de todos los proyectos existentes (conserva el acceso de antes).
 */
function migrarEquipos(db) {
  if (!db.documentos) db.documentos = [];
  if (db.miembros) return;
  db.miembros = [];
  let id = 1;
  for (const p of (db.proyectos || []).filter((x) => x.activo !== 0)) {
    for (const u of (db.usuarios || []).filter((x) => x.activo !== 0 && x.rol === 'JEFE_PROYECTO')) {
      db.miembros.push({ miembro_id: id++, proyecto_id: p.proyecto_id, usuario_id: u.usuario_id, es_responsable: 0, desde: new Date().toISOString().slice(0, 10), hasta: null, activo: 1, revision: 1, modificado_por: 'db/15' });
    }
  }
}

function crearRepositorioMemoria({ semilla, archivo } = {}) {
  let db;
  if (archivo && fs.existsSync(archivo)) {
    db = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    incorporarHistorial(db, semilla);
    migrarPerfiles(db);
  } else {
    const s = JSON.parse(JSON.stringify(semilla));
    db = {
      ...s,
      usuarios: [], bitacora: [], historial: [], recalculos: [], actividad_pronostico: {}, plan_pronostico: {},
      plan_pronostico_historial: [], ia_conversaciones: [], ia_mensajes: [],
    };
    for (const meta of Object.values(ENTIDADES)) {
      for (const f of db[meta.coleccion] || []) {
        if (f.activo === undefined) f.activo = 1;
        if (!meta.sinRevision && f.revision === undefined) f.revision = 1;
      }
    }
    db.bitacora.push({ bitacora_id: 1, fecha: new Date().toISOString(), usuario: 'sistema', entidad: 'carga_inicial', entidad_id: null, consultor_id: null, accion: 'CREAR', cambios_json: null, motivo: 'Carga inicial desde la matriz de control del 03/11/2026', origen: 'SCRIPT' });
  }

  migrarProyectos(db);
  migrarEquipos(db);

  let pendiente = null;
  const guardar = () => {
    if (!archivo) return;
    clearTimeout(pendiente);
    pendiente = setTimeout(() => {
      fs.mkdirSync(path.dirname(archivo), { recursive: true });
      fs.writeFileSync(archivo, JSON.stringify(db));
    }, 200);
  };
  const sig = (lista, campo) => (lista.reduce((m, x) => Math.max(m, Number(x[campo]) || 0), 0) + 1);
  const copia = (x) => JSON.parse(JSON.stringify(x));

  function bitacora(e) {
    const fila = { bitacora_id: sig(db.bitacora, 'bitacora_id'), fecha: new Date().toISOString(), origen: 'UI', ...e };
    if (fila.cambios_json && typeof fila.cambios_json !== 'string') fila.cambios_json = JSON.stringify(fila.cambios_json);
    db.bitacora.push(fila);
    return fila;
  }

  const api = {
    tipo: 'memoria',

    async cargarTodo() {
      const out = {};
      const ultimos = {};
      for (const p of db.partes || []) if (p.activo !== 0 && (!ultimos[p.consultor_id] || p.fecha > ultimos[p.consultor_id])) ultimos[p.consultor_id] = p.fecha;
      out.ultimos_partes = Object.entries(ultimos).map(([consultor_id, ultimo]) => ({ consultor_id: Number(consultor_id), ultimo }));
      for (const k of ['proyectos', 'miembros', 'entregables_servicio', 'consultores', 'contratos', 'adendas', 'planes', 'actividades', 'dependencias', 'linea_base', 'controles_cambio', 'feriados', 'parametros']) {
        out[k] = copia(db[k] || []);
      }
      return out;
    },

    async crear(entidad, fila, { usuario, motivo, origen = 'UI', consultor_id = null } = {}) {
      const meta = ENTIDADES[entidad];
      if (!db[meta.coleccion]) db[meta.coleccion] = [];
      const nueva = { ...fila, [meta.pk]: sig(db[meta.coleccion], meta.pk), activo: fila.activo ?? 1, modificado_por: usuario };
      if (entidad === 'documento' && !nueva.subido_en) nueva.subido_en = new Date().toISOString();
      if (entidad === 'proyecto_miembro' && !nueva.desde) nueva.desde = new Date().toISOString().slice(0, 10);
      if (entidad === 'parte_diario' && !nueva.registrado_en) nueva.registrado_en = new Date().toISOString();
      if (!meta.sinRevision) nueva.revision = 1;
      db[meta.coleccion].push(nueva);
      bitacora({ usuario, entidad, entidad_id: nueva[meta.pk], consultor_id, accion: 'CREAR', cambios_json: { despues: fila }, motivo, origen });
      guardar();
      return copia(nueva);
    },

    async actualizar(entidad, id, cambios, { revision, usuario, motivo, origen = 'UI', consultor_id = null, accion = 'MODIFICAR', tocar = false } = {}) {
      const meta = ENTIDADES[entidad];
      const fila = db[meta.coleccion].find((x) => x[meta.pk] === Number(id));
      if (!fila) throw Object.assign(new Error('Registro no encontrado'), { estado: 404 });
      if (!meta.sinRevision && revision !== undefined && revision !== null && Number(revision) !== fila.revision) {
        throw Object.assign(new Error('Otro usuario modificó este registro. Recargue y vuelva a intentar.'), { estado: 409, actual: copia(fila) });
      }
      const antes = {};
      const despues = {};
      for (const [k, v] of Object.entries(cambios)) {
        if (String(fila[k] ?? '') !== String(v ?? '')) { antes[k] = fila[k] ?? null; despues[k] = v; }
      }
      if (!Object.keys(despues).length && !(tocar && !meta.sinRevision)) return { fila: copia(fila), sinCambios: true }; // `tocar`: sube la revisión sin cambios
      db.historial.push({ entidad, id: Number(id), valido_hasta: new Date().toISOString(), fila: copia(fila) });
      Object.assign(fila, cambios, { modificado_por: usuario });
      if (!meta.sinRevision) fila.revision += 1;
      bitacora({ usuario, entidad, entidad_id: Number(id), consultor_id, accion, cambios_json: { antes, despues }, motivo, origen });
      guardar();
      return { fila: copia(fila), antes, despues };
    },

    async listarDocumentos({ entidad, entidad_id, tipo, proyecto_id, incluirRetirados = false } = {}) {
      return copia(db.documentos.filter((f) => (!entidad || f.entidad === entidad) && (!entidad_id || f.entidad_id === Number(entidad_id))
        && (!tipo || f.tipo === tipo) && (!proyecto_id || f.proyecto_id === Number(proyecto_id)) && (incluirRetirados || f.activo !== 0)));
    },

    async listarPartes({ proyecto_id, consultor_id, desde, hasta, limite = 200 } = {}) {
      const partes = db.partes.filter((x) => x.activo !== 0 && (!proyecto_id || x.proyecto_id === Number(proyecto_id)) && (!consultor_id || x.consultor_id === Number(consultor_id))
        && (!desde || x.fecha >= desde) && (!hasta || x.fecha <= hasta))
        .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.parte_id - a.parte_id).slice(0, Math.min(Number(limite) || 200, 1000));
      return copia(partes.map((x) => ({ ...x, items: db.partes_items.filter((i) => i.parte_id === x.parte_id && i.activo !== 0) })));
    },

    async proyectosDeUsuario(usuario_id) {
      return db.miembros.filter((m) => m.usuario_id === Number(usuario_id) && m.activo !== 0).map((m) => m.proyecto_id);
    },

    async historialEntidad(entidad, id) {
      const meta = ENTIDADES[entidad];
      const actual = db[meta.coleccion].find((x) => x[meta.pk] === Number(id));
      const previas = db.historial.filter((h) => h.entidad === entidad && h.id === Number(id));
      const filas = [...previas.map((h) => ({ ...h.fila, valido_hasta: h.valido_hasta })), ...(actual ? [{ ...actual, valido_hasta: null }] : [])];
      return copia(filas.map((f, i) => ({ ...f, valido_desde: i === 0 ? null : filas[i - 1].valido_hasta })));
    },

    async registrarBitacora(e) { const f = bitacora(e); guardar(); return f; },

    /** proyecto_id: registros de sus profesionales, de la ficha del proyecto, de su equipo y de sus documentos. */
    async listarBitacora({ consultor_id, entidad, entidad_id, proyecto_id, limite = 200 } = {}) {
      const pid = proyecto_id ? Number(proyecto_id) : null;
      const del = pid && {
        consultores: new Set((db.consultores || []).filter((c) => c.proyecto_id === pid).map((c) => c.consultor_id)),
        miembros: new Set((db.miembros || []).filter((m) => m.proyecto_id === pid).map((m) => m.miembro_id)),
        documentos: new Set((db.documentos || []).filter((f) => Number(f.proyecto_id) === pid).map((f) => f.documento_id)),
      };
      const enProyecto = (b) => !pid || del.consultores.has(b.consultor_id) || (b.entidad === 'consultor' && del.consultores.has(b.entidad_id)) || (b.entidad === 'proyecto' && b.entidad_id === pid)
        || (b.entidad === 'proyecto_miembro' && del.miembros.has(b.entidad_id)) || (b.entidad === 'documento' && del.documentos.has(b.entidad_id));
      return copia(db.bitacora
        .filter((b) => (!consultor_id || b.consultor_id === Number(consultor_id)) && (!entidad || b.entidad === entidad) && (!entidad_id || b.entidad_id === Number(entidad_id)) && enProyecto(b))
        .sort((a, b) => b.bitacora_id - a.bitacora_id).slice(0, limite));
    },

    async guardarRecalculo(estado, { usuario, motivo }) {
      const recalculo_id = sig(db.recalculos, 'recalculo_id');
      db.recalculos.push({ recalculo_id, fecha_corte: estado.corte, metodo: estado.metodo, ejecutado_en: new Date().toISOString(), ejecutado_por: usuario, motivo, resumen_json: JSON.stringify(estado.indicadores) });
      const vivos = new Set();
      for (const it of estado.consultores) {
        if (!it.pronostico) continue;
        for (const a of Object.values(it.pronostico.actividades)) { vivos.add(String(a.actividad_id)); db.actividad_pronostico[a.actividad_id] = { ...a, recalculo_id }; }
        const pp = { plan_id: it.plan.plan_id, recalculo_id, fecha_corte: estado.corte, inicio_plan: it.pronostico.inicio_plan, fin_plan: it.pronostico.fin_plan, fin_probable: it.pronostico.fin_probable, avance_ponderado: it.pronostico.avance_ponderado, avance_esperado: it.pronostico.avance_esperado, spi: it.pronostico.spi, fin_vigencia: it.vigencia.fin_vigencia, holgura_dias: it.vigencia.holgura_dias, semaforo: it.vigencia.semaforo };
        db.plan_pronostico[it.plan.plan_id] = pp;
        db.plan_pronostico_historial.push(pp);
      }
      for (const k of Object.keys(db.actividad_pronostico)) if (!vivos.has(k)) delete db.actividad_pronostico[k];
      guardar();
      return recalculo_id;
    },

    async ultimoRecalculo() { return copia(db.recalculos[db.recalculos.length - 1] || null); },

    async historialPronostico(plan_id) {
      return copia(db.plan_pronostico_historial.filter((h) => h.plan_id === Number(plan_id)));
    },

    async guardarParametro(codigo, valor, usuario) {
      let p = db.parametros.find((x) => x.codigo === codigo);
      if (!p) throw Object.assign(new Error('Parámetro no existe'), { estado: 404 });
      const antes = p.valor;
      p.valor = String(valor); p.actualizado_por = usuario; p.actualizado_en = new Date().toISOString();
      bitacora({ usuario, entidad: 'parametro', entidad_id: null, accion: 'MODIFICAR', cambios_json: { codigo, antes, despues: p.valor }, motivo: null });
      guardar();
      return copia(p);
    },

    async guardarFeriado(f, usuario) {
      db.feriados = db.feriados.filter((x) => x.fecha !== f.fecha);
      db.feriados.push({ fecha: f.fecha, descripcion: f.descripcion, tipo: f.tipo || 'FERIADO' });
      db.feriados.sort((a, b) => a.fecha.localeCompare(b.fecha));
      bitacora({ usuario, entidad: 'feriado', entidad_id: null, accion: 'CREAR', cambios_json: f });
      guardar();
    },

    async eliminarFeriado(fecha, usuario) {
      db.feriados = db.feriados.filter((x) => x.fecha !== fecha);
      bitacora({ usuario, entidad: 'feriado', entidad_id: null, accion: 'ANULAR', cambios_json: { fecha } });
      guardar();
    },

    // ---------- usuarios
    async contarUsuarios() { return db.usuarios.length; },
    async buscarUsuario(correo) { return copia(db.usuarios.find((u) => u.correo.toLowerCase() === String(correo).toLowerCase()) || null); },
    async buscarUsuarioId(id) { return copia(db.usuarios.find((u) => u.usuario_id === Number(id)) || null); },
    async listarUsuarios() { return copia(db.usuarios.map(({ clave_hash, ...u }) => u)); },
    async crearUsuario(u) {
      if (db.usuarios.some((x) => x.correo.toLowerCase() === u.correo.toLowerCase())) throw Object.assign(new Error('Ya existe un usuario con ese correo'), { estado: 409 });
      if (u.consultor_id && db.usuarios.some((x) => x.consultor_id === u.consultor_id)) throw Object.assign(new Error('Ese profesional ya tiene una cuenta'), { estado: 409 });
      const n = { usuario_id: sig(db.usuarios, 'usuario_id'), activo: 1, consultor_id: null, debe_cambiar_clave: 1, creado_en: new Date().toISOString(), ultimo_acceso: null, ...u };
      db.usuarios.push(n); guardar();
      const { clave_hash, ...sinClave } = n;
      return copia(sinClave);
    },
    async actualizarUsuario(id, cambios) {
      const u = db.usuarios.find((x) => x.usuario_id === Number(id));
      if (!u) throw Object.assign(new Error('Usuario no encontrado'), { estado: 404 });
      if (cambios.consultor_id && db.usuarios.some((x) => x !== u && x.consultor_id === cambios.consultor_id)) throw Object.assign(new Error('Ese profesional ya tiene una cuenta'), { estado: 409 });
      Object.assign(u, cambios); guardar();
      const { clave_hash, ...sinClave } = u;
      return copia(sinClave);
    },

    // ---------- asistente de IA
    async crearConversacion(usuario, titulo) {
      const c = { conversacion_id: require('crypto').randomUUID(), usuario, titulo, iniciada_en: new Date().toISOString() };
      db.ia_conversaciones.push(c); guardar();
      return c;
    },
    async obtenerConversacion(id) { return copia(db.ia_conversaciones.find((c) => c.conversacion_id === id) || null); },
    async agregarMensaje(m) {
      db.ia_mensajes.push({ mensaje_id: sig(db.ia_mensajes, 'mensaje_id'), creado_en: new Date().toISOString(), ...m, contenido_json: typeof m.contenido_json === 'string' ? m.contenido_json : JSON.stringify(m.contenido_json) });
      guardar();
    },
    async listarMensajes(conversacion_id) {
      return copia(db.ia_mensajes.filter((m) => m.conversacion_id === conversacion_id)).map((m) => ({ ...m, contenido: JSON.parse(m.contenido_json) }));
    },
    async usoIA() {
      const porDia = {};
      for (const m of db.ia_mensajes.filter((x) => x.rol === 'assistant')) {
        const k = String(m.creado_en).slice(0, 10);
        porDia[k] = porDia[k] || { dia: k, respuestas: 0, tokens_entrada: 0, tokens_salida: 0 };
        porDia[k].respuestas += 1; porDia[k].tokens_entrada += m.tokens_entrada || 0; porDia[k].tokens_salida += m.tokens_salida || 0;
      }
      return Object.values(porDia);
    },
    async cerrar() { if (archivo) fs.writeFileSync(archivo, JSON.stringify(db)); },

    /**
     * Operación compuesta (criterio C4): equivale a la transacción de SQL Server. Si `fn` falla, se restaura la
     * copia previa y no queda nada escrito. (Modo demo/pruebas: no aísla de escrituras concurrentes).
     */
    async transaccion(fn) {
      const previo = JSON.stringify(db);
      try {
        return await fn({ tipo: 'memoria', crear: api.crear, actualizar: api.actualizar, registrarBitacora: api.registrarBitacora });
      } catch (err) {
        db = JSON.parse(previo);
        guardar();
        throw err;
      }
    },
  };
  return api;
}

module.exports = { crearRepositorioMemoria };
