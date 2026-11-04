'use strict';
/**
 * Carga de documentos del proyecto para actualizar la información de los profesionales.
 *   1. previsualizar(): lee el archivo (Excel/CSV/XML de MS Project con el interprete; PDF/Word con el asistente de IA,
 *      sin datos personales) y devuelve los CAMBIOS propuestos. No escribe nada.
 *   2. aplicar(): con la selección del usuario, aplica cada cambio por los mismos servicios de siempre (validaciones,
 *      concurrencia optimista, recálculo y bitácora con el nombre del documento como motivo), conserva el original
 *      y registra la carga. Nada se borra.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { leer, extension } = require('./lector');
const { tablasAFilas, interpretar } = require('./interprete');

const error = (estado, mensaje) => Object.assign(new Error(mensaje), { estado });
const COLECCION = { actividad: 'actividades', adenda: 'adendas', plan_trabajo: 'planes' };
const PK = { actividad: 'actividad_id', adenda: 'adenda_id', plan_trabajo: 'plan_id' };

function crearDocumentos({ servicio, repo, extraerConIA, dir, ttlMs = 30 * 60000 }) {
  const cargas = new Map(); // carga_id -> { usuario, nombre, buffer, formato, origen, cambios, creada }

  const limpiar = () => { const ahora = Date.now(); for (const [id, c] of cargas) if (ahora - c.creada > ttlMs) cargas.delete(id); };

  async function previsualizar({ buffer, nombre, usuario, consultor_id }) {
    limpiar();
    const leido = await leer(buffer, nombre);
    const datos = await servicio.datos(true);
    const elegido = consultor_id ? datos.consultores.find((c) => c.consultor_id === Number(consultor_id)) : null;
    const clave = elegido ? elegido.clave : null;

    let filas; let rechazadas = []; let origen = 'UI'; let ia = null;
    if (leido.tipo === 'tablas') {
      const t = tablasAFilas(leido.hojas, { clave });
      filas = t.filas; rechazadas = t.rechazadas;
      if (!filas.actividades.length && !filas.adendas.length && !filas.planes.length) {
        throw error(400, 'No se encontraron filas para actualizar. Use la plantilla, o un cronograma con las columnas N.°, Nombre de tarea, Inicio, Fin y % completado');
      }
    } else {
      if (!extraerConIA) throw error(503, 'La lectura de PDF y Word requiere el asistente de IA, que no está configurado');
      const r = await extraerConIA({ texto: leido.texto, usuario, clave });
      filas = r.filas; origen = 'IA'; ia = { omitidos: r.omitidos, truncado: r.truncado };
    }
    const r = interpretar(filas, datos);
    const id = crypto.randomUUID();
    cargas.set(id, { usuario: usuario.correo, nombre, buffer, formato: leido.formato, origen, cambios: r.cambios, creada: Date.now() });
    return {
      carga_id: id, archivo: nombre, formato: leido.formato, origen, ia,
      profesional: elegido ? { consultor_id: elegido.consultor_id, clave: elegido.clave, nombres: elegido.nombres } : null,
      resumen: { modificar: r.cambios.filter((c) => c.accion === 'MODIFICAR').length, crear: r.cambios.filter((c) => c.accion === 'CREAR').length, sin_cambios: r.sinCambios, rechazadas: rechazadas.length + r.rechazadas.length },
      cambios: r.cambios, rechazadas: [...rechazadas, ...r.rechazadas],
    };
  }

  /** Aplica un cambio por el servicio que corresponde. Devuelve nada; lanza si no se pudo. */
  async function aplicarUno(c, ctx) {
    const d = await servicio.datos(true);
    if (c.accion === 'MODIFICAR') {
      const fila = d[COLECCION[c.entidad]].find((x) => x[PK[c.entidad]] === c.registro_id);
      if (!fila) throw error(404, 'El registro ya no existe');
      if (fila.revision !== c.revision) throw error(409, 'Cambió después de la vista previa: cargue el documento otra vez');
    }
    if (c.entidad === 'actividad' && c.accion === 'MODIFICAR') return servicio.actualizarActividad(c.registro_id, { ...c.campos, revision: c.revision }, ctx);
    if (c.entidad === 'actividad') {
      const { avance, estado, inicio_real, fin_real, ...base } = c.campos;
      const nueva = await servicio.crearActividad(c.plan_id, base, ctx);
      const resto = Object.fromEntries(Object.entries({ avance, estado, inicio_real, fin_real }).filter(([, v]) => v !== undefined));
      if (Object.keys(resto).length) await servicio.actualizarActividad(nueva.actividad_id, resto, ctx); // aplica las reglas de consistencia del avance
      return nueva;
    }
    if (c.entidad === 'adenda') {
      return c.accion === 'MODIFICAR' ? servicio.actualizarEntidad('adenda', c.registro_id, { ...c.campos, revision: c.revision }, ctx)
        : servicio.crearEntidad('adenda', { contrato_id: c.contrato_id, ...c.campos }, ctx);
    }
    return servicio.actualizarEntidad('plan_trabajo', c.registro_id, { ...c.campos, revision: c.revision }, ctx);
  }

  async function aplicar({ carga_id, ids, usuario }) {
    limpiar();
    const carga = cargas.get(carga_id);
    if (!carga || carga.usuario !== usuario.correo) throw error(404, 'La vista previa venció: suba el documento otra vez');
    const elegidos = new Set(Array.isArray(ids) ? ids : []);
    const seleccion = carga.cambios.filter((c) => elegidos.has(c.id));
    if (!seleccion.length) throw error(400, 'Seleccione al menos un cambio');
    const ctx = { usuario: usuario.correo, nombre: usuario.nombre, rol: usuario.rol, origen: carga.origen, motivo: `Carga del documento «${carga.nombre}»` };
    // primero las adendas y los planes, luego las actividades existentes y al final las nuevas
    const orden = (c) => (c.entidad === 'adenda' ? 0 : c.entidad === 'plan_trabajo' ? 1 : c.accion === 'MODIFICAR' ? 2 : 3);
    const aplicados = []; const fallidos = [];
    for (const c of [...seleccion].sort((a, b) => orden(a) - orden(b))) {
      try { await aplicarUno(c, ctx); aplicados.push({ id: c.id, etiqueta: c.etiqueta }); } catch (err) { fallidos.push({ id: c.id, etiqueta: c.etiqueta, motivo: err.message }); }
    }
    // el original se conserva (nombre generado: nunca el del cliente) y la carga queda en la bitácora
    const sha256 = crypto.createHash('sha256').update(carga.buffer).digest('hex');
    const carpeta = path.join(dir, new Date().toISOString().slice(0, 7));
    fs.mkdirSync(carpeta, { recursive: true });
    const destino = path.join(carpeta, `${Date.now()}-${sha256.slice(0, 10)}${extension(carga.nombre)}`);
    fs.writeFileSync(destino, carga.buffer);
    await repo.registrarBitacora({
      usuario: usuario.correo, entidad: 'documento', entidad_id: null, accion: 'CREAR', origen: carga.origen,
      cambios_json: { archivo: carga.nombre, formato: carga.formato, sha256, bytes: carga.buffer.length, aplicados: aplicados.length, fallidos: fallidos.length, omitidos: carga.cambios.length - seleccion.length },
      motivo: `Carga del documento «${carga.nombre}»`,
    });
    cargas.delete(carga_id);
    return { aplicados, fallidos, omitidos: carga.cambios.length - seleccion.length };
  }

  return { previsualizar, aplicar };
}

module.exports = { crearDocumentos };
