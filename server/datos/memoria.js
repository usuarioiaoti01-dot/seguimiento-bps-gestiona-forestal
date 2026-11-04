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

  return {
    tipo: 'memoria',

    async cargarTodo() {
      const out = {};
      for (const k of ['consultores', 'contratos', 'adendas', 'planes', 'actividades', 'dependencias', 'linea_base', 'controles_cambio', 'feriados', 'parametros']) {
        out[k] = copia(db[k] || []);
      }
      return out;
    },

    async crear(entidad, fila, { usuario, motivo, origen = 'UI', consultor_id = null } = {}) {
      const meta = ENTIDADES[entidad];
      const nueva = { ...fila, [meta.pk]: sig(db[meta.coleccion], meta.pk), activo: fila.activo ?? 1, modificado_por: usuario };
      if (!meta.sinRevision) nueva.revision = 1;
      db[meta.coleccion].push(nueva);
      bitacora({ usuario, entidad, entidad_id: nueva[meta.pk], consultor_id, accion: 'CREAR', cambios_json: { despues: fila }, motivo, origen });
      guardar();
      return copia(nueva);
    },

    async actualizar(entidad, id, cambios, { revision, usuario, motivo, origen = 'UI', consultor_id = null, accion = 'MODIFICAR' } = {}) {
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
      if (!Object.keys(despues).length) return { fila: copia(fila), sinCambios: true };
      db.historial.push({ entidad, id: Number(id), valido_hasta: new Date().toISOString(), fila: copia(fila) });
      Object.assign(fila, cambios, { modificado_por: usuario });
      if (!meta.sinRevision) fila.revision += 1;
      bitacora({ usuario, entidad, entidad_id: Number(id), consultor_id, accion, cambios_json: { antes, despues }, motivo, origen });
      guardar();
      return { fila: copia(fila), antes, despues };
    },

    async historialEntidad(entidad, id) {
      const meta = ENTIDADES[entidad];
      const actual = db[meta.coleccion].find((x) => x[meta.pk] === Number(id));
      const previas = db.historial.filter((h) => h.entidad === entidad && h.id === Number(id));
      const filas = [...previas.map((h) => ({ ...h.fila, valido_hasta: h.valido_hasta })), ...(actual ? [{ ...actual, valido_hasta: null }] : [])];
      return copia(filas.map((f, i) => ({ ...f, valido_desde: i === 0 ? null : filas[i - 1].valido_hasta })));
    },

    async registrarBitacora(e) { const f = bitacora(e); guardar(); return f; },

    async listarBitacora({ consultor_id, entidad, entidad_id, limite = 200 } = {}) {
      return copia(db.bitacora
        .filter((b) => (!consultor_id || b.consultor_id === Number(consultor_id)) && (!entidad || b.entidad === entidad) && (!entidad_id || b.entidad_id === Number(entidad_id)))
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
  };
}

module.exports = { crearRepositorioMemoria };
