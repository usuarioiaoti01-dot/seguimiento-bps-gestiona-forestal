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
const { tablasAFilas, interpretar, interpretarAdendas } = require('./interprete');
const { ESTADOS_ADENDA } = require('../servicio');

const error = (estado, mensaje) => Object.assign(new Error(mensaje), { estado });
const COLECCION = { actividad: 'actividades', adenda: 'adendas', plan_trabajo: 'planes' };
const PK = { actividad: 'actividad_id', adenda: 'adenda_id', plan_trabajo: 'plan_id' };

function crearDocumentos({ servicio, repo, extraerConIA, dir, adendasPdf = null, almacen = null, ttlMs = 30 * 60000 }) {
  const cargas = new Map(); // carga_id -> { usuario, nombre, buffer, formato, origen, cambios, creada }

  const limpiar = () => { const ahora = Date.now(); for (const [id, c] of cargas) if (ahora - c.creada > ttlMs) cargas.delete(id); };

  /** `tipo: 'adenda'` = documento de una adenda (solo adendas; el asistente usa su lectura específica). */
  async function previsualizar({ buffer, nombre, usuario, consultor_id, tipo = null }) {
    limpiar();
    const deAdenda = tipo === 'adenda';
    // Una adenda firmada suele ser un PDF escaneado, sin texto que leer: se guía al usuario al visor, donde sí se puede guardar.
    const leido = await leer(buffer, nombre).catch((e) => {
      if (deAdenda && /parece un documento escaneado/.test(e.message)) throw error(400, 'El PDF no tiene texto (es un escaneo), así que no se pueden leer sus datos. Para guardarlo como el PDF de la adenda, pulse la adenda en Contratos y adendas y use «Guardar el PDF sin leerlo»');
      throw e;
    });
    const datos = await servicio.datos(true);
    const elegido = consultor_id ? datos.consultores.find((c) => c.consultor_id === Number(consultor_id)) : null;
    const clave = elegido ? elegido.clave : null;

    let filas; let rechazadas = []; let origen = 'UI'; let ia = null;
    if (leido.tipo === 'tablas') {
      const t = tablasAFilas(leido.hojas, { clave });
      filas = t.filas; rechazadas = t.rechazadas;
      if (deAdenda) {
        if (!filas.adendas.length) throw error(400, 'El archivo no trae adendas. Use la hoja «Adendas» de la plantilla (contrato, N.° de adenda, plazo e inicio/fin)');
        filas = { actividades: [], planes: [], adendas: filas.adendas };
      } else if (!filas.actividades.length && !filas.adendas.length && !filas.planes.length) {
        throw error(400, 'No se encontraron filas para actualizar. Use la plantilla, o un cronograma con las columnas N.°, Nombre de tarea, Inicio, Fin y % completado');
      }
    } else {
      if (!extraerConIA) throw error(503, 'La lectura de PDF y Word requiere el asistente de IA, que no está configurado. Para guardar el PDF de una adenda sin leerlo, pulse la adenda en Contratos y adendas y use «Guardar el PDF sin leerlo»');
      const r = await extraerConIA({ texto: leido.texto, usuario, clave, ...(deAdenda ? { modo: 'adenda' } : {}) });
      filas = r.filas; origen = 'IA'; ia = { omitidos: r.omitidos, truncado: r.truncado };
      if (deAdenda && !filas.adendas.length) throw error(400, 'No se encontró ninguna adenda en el documento. Compruebe que sea el documento de una adenda, con su contrato y su número');
    }
    const r = deAdenda ? interpretarAdendas(filas, datos, { clave }) : interpretar(filas, datos);
    const id = crypto.randomUUID();
    cargas.set(id, { usuario: usuario.correo, nombre, buffer, formato: leido.formato, origen, tipo: deAdenda ? 'adenda' : null, cambios: r.cambios, creada: Date.now() });
    return {
      carga_id: id, archivo: nombre, formato: leido.formato, origen, ia, tipo: deAdenda ? 'adenda' : null,
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

  /** Ajustes que el usuario hace en la vista previa de una adenda (estado, documento y suscripción); se validan antes de aplicar nada. */
  function conAjustes(c, ajustes) {
    const aj = ajustes && typeof ajustes === 'object' ? ajustes[c.id] : null;
    if (c.entidad !== 'adenda' || !aj || typeof aj !== 'object') return c;
    const extra = {};
    for (const k of ['estado', 'documento_ref', 'fecha_suscripcion']) if (typeof aj[k] === 'string' && aj[k].trim()) extra[k] = aj[k].trim().slice(0, 300);
    if (extra.estado && !ESTADOS_ADENDA.includes(extra.estado)) throw error(400, 'Estado de adenda no válido');
    return { ...c, campos: { ...c.campos, ...extra } };
  }

  /** Guarda el PDF cargado como el PDF de la adenda (la versión anterior, si existe, se conserva) y lo registra en la bitácora. */
  async function adjuntarPdf(adendaId, carga, usuario, motivo, etiqueta) {
    const d = await servicio.datos(true);
    const a = d.adendas.find((x) => x.adenda_id === Number(adendaId));
    const k = a && d.contratos.find((x) => x.contrato_id === a.contrato_id);
    const r = await adendasPdf.guardar(adendaId, carga.buffer, { usuario: usuario.correo, motivo, origen: 'UI', consultor_id: k ? k.consultor_id : null, nombre: carga.nombre });
    // con el almacén (db/14) la bitácora ya quedó con el documento; sin él (pruebas antiguas) se anota aquí
    if (!r.documento_id) await repo.registrarBitacora({ usuario: usuario.correo, entidad: 'adenda', entidad_id: Number(adendaId), consultor_id: k ? k.consultor_id : null, accion: 'MODIFICAR', cambios_json: { adenda_pdf: { bytes: r.bytes, sha256: r.sha256, reemplaza: r.reemplaza } }, motivo, origen: 'UI' });
    return { adenda_id: Number(adendaId), etiqueta };
  }

  // ---- originales conservados: archivo en disco + índice (indice.json) para el visor de «Actualizar desde archivo»
  const rutaIndice = path.join(dir, 'indice.json');
  const leerIndice = () => { try { const x = JSON.parse(fs.readFileSync(rutaIndice, 'utf8')); return Array.isArray(x) ? x : []; } catch { return []; } };

  /** Guarda el original (nombre generado: nunca el del cliente), lo anota en el índice y deja la carga en la bitácora. */
  async function guardarOriginal(carga, usuario, resumen) {
    const sha256 = crypto.createHash('sha256').update(carga.buffer).digest('hex');
    const mes = new Date().toISOString().slice(0, 7);
    const carpeta = path.join(dir, mes);
    fs.mkdirSync(carpeta, { recursive: true });
    const archivo = `${Date.now()}-${sha256.slice(0, 10)}${extension(carga.nombre)}`;
    fs.writeFileSync(path.join(carpeta, archivo), carga.buffer);
    const indice = leerIndice();
    const entrada = { id: Math.max(0, ...indice.map((x) => x.id)) + 1, archivo: carga.nombre, formato: carga.formato, ruta: `${mes}/${archivo}`, bytes: carga.buffer.length, sha256, usuario: usuario.correo, fecha: new Date().toISOString(), origen: carga.origen, ...resumen };
    indice.push(entrada);
    fs.writeFileSync(rutaIndice, JSON.stringify(indice));
    // el original también queda en el almacén documental (db/14), en su carpeta de siempre
    if (almacen) {
      try { await almacen.registrarExistente({ tipo: 'CARGA', entidad: 'carga', entidad_id: entrada.id, raiz: 'DOCUMENTOS', ruta_relativa: entrada.ruta, nombre: carga.nombre, buffer: carga.buffer, reemplazar: false }, { usuario: usuario.correo, motivo: `Original de la carga «${carga.nombre}»`, origen: carga.origen }); } catch (err) { console.error('[almacén] No se pudo registrar el original de la carga:', err.message); }
    }
    await repo.registrarBitacora({
      usuario: usuario.correo, entidad: 'documento', entidad_id: null, accion: 'CREAR', origen: carga.origen,
      cambios_json: { archivo: carga.nombre, formato: carga.formato, tipo: carga.tipo || 'general', sha256, bytes: carga.buffer.length, aplicados: resumen.aplicados, fallidos: resumen.fallidos, omitidos: resumen.omitidos },
      motivo: `Carga del documento «${carga.nombre}»`,
    });
    return entrada;
  }

  /**
   * «Actualizar desde archivo»: lee un archivo, aplica lo que concuerda con la lógica de la aplicación y devuelve lo que
   * no pudo identificar o aplicar. Las actividades nuevas (que no están en el plan) no se crean solas: se informan.
   */
  async function actualizarDesdeArchivo({ buffer, nombre, usuario }) {
    const salida = { archivo: nombre, aplicados: [], inconsistencias: [], registro: null };
    let vista;
    try { vista = await previsualizar({ buffer, nombre, usuario, consultor_id: null }); } catch (e) {
      salida.inconsistencias.push({ motivo: e.message }); return salida; // ilegible: no se guarda ni se cambia nada
    }
    for (const r of vista.rechazadas) salida.inconsistencias.push({ hoja: r.hoja, fila: r.fila, motivo: r.motivo });
    const nuevas = vista.cambios.filter((c) => c.accion === 'CREAR' && c.entidad === 'actividad');
    for (const c of nuevas) salida.inconsistencias.push({ fila: c.fila, referencia: c.etiqueta, motivo: 'No existe en el plan del profesional: la actividad nueva no se crea sola (agréguela en Formular Plan de Trabajo)' });
    const ids = vista.cambios.filter((c) => !nuevas.includes(c)).map((c) => c.id);
    const carga = cargas.get(vista.carga_id);
    if (ids.length) {
      const r = await aplicar({ carga_id: vista.carga_id, ids, usuario });
      salida.aplicados = r.aplicados;
      for (const f of r.fallidos) salida.inconsistencias.push({ referencia: f.etiqueta, motivo: f.motivo });
      salida.registro = leerIndice().pop() || null;
    } else {
      salida.registro = await guardarOriginal(carga, usuario, { aplicados: 0, fallidos: 0, omitidos: nuevas.length, inconsistencias: salida.inconsistencias.map((x) => x.motivo) });
      cargas.delete(vista.carga_id);
    }
    return salida;
  }

  const listarArchivos = () => leerIndice().reverse().map(({ ruta, sha256, ...x }) => x);
  function buscarArchivo(id) {
    const e = leerIndice().find((x) => x.id === Number(id));
    if (!e) throw error(404, 'Documento no encontrado');
    const archivo = path.resolve(dir, e.ruta);
    if (!archivo.startsWith(path.resolve(dir)) || !fs.existsSync(archivo)) throw error(404, 'El archivo ya no está disponible');
    return { entrada: e, archivo };
  }
  /** Contenido para el visor de los formatos que el navegador no muestra (Excel, CSV, XML de Project, Word). */
  async function contenidoArchivo(id) {
    const { entrada, archivo } = buscarArchivo(id);
    const leido = await leer(fs.readFileSync(archivo), entrada.archivo);
    return leido.tipo === 'tablas' ? { tipo: 'tablas', hojas: leido.hojas.map((h) => ({ nombre: h.nombre, filas: h.filas.slice(0, 300), total: h.filas.length })) } : { tipo: 'texto', texto: String(leido.texto || '').slice(0, 60000) };
  }

  async function aplicar({ carga_id, ids, ajustes, usuario }) {
    limpiar();
    const carga = cargas.get(carga_id);
    if (!carga || carga.usuario !== usuario.correo) throw error(404, 'La vista previa venció: suba el documento otra vez');
    const elegidos = new Set(Array.isArray(ids) ? ids : []);
    const seleccion = carga.cambios.filter((c) => elegidos.has(c.id)).map((c) => conAjustes(c, ajustes));
    if (!seleccion.length) throw error(400, 'Seleccione al menos un cambio');
    const ctx = { usuario: usuario.correo, nombre: usuario.nombre, rol: usuario.rol, origen: carga.origen, motivo: `Carga del documento «${carga.nombre}»` };
    // primero las adendas y los planes, luego las actividades existentes y al final las nuevas
    const orden = (c) => (c.entidad === 'adenda' ? 0 : c.entidad === 'plan_trabajo' ? 1 : c.accion === 'MODIFICAR' ? 2 : 3);
    const aplicados = []; const fallidos = []; const pdfs = [];
    for (const c of [...seleccion].sort((a, b) => orden(a) - orden(b))) {
      try {
        const r = await aplicarUno(c, ctx);
        aplicados.push({ id: c.id, etiqueta: c.etiqueta });
        // documento PDF de una adenda: queda como el PDF de esa adenda, para mostrarlo en el visor de Contratos y adendas
        if (c.entidad === 'adenda' && carga.tipo === 'adenda' && carga.formato === 'pdf' && adendasPdf) {
          const adendaId = c.accion === 'MODIFICAR' ? c.registro_id : r && r.adenda_id;
          if (adendaId) pdfs.push(await adjuntarPdf(adendaId, carga, usuario, ctx.motivo, c.etiqueta));
        }
      } catch (err) { fallidos.push({ id: c.id, etiqueta: c.etiqueta, motivo: err.message }); }
    }
    // el original se conserva y la carga queda en la bitácora y en el índice del visor
    await guardarOriginal(carga, usuario, { aplicados: aplicados.length, fallidos: fallidos.length, omitidos: carga.cambios.length - seleccion.length, inconsistencias: fallidos.map((f) => `${f.etiqueta}: ${f.motivo}`) });
    cargas.delete(carga_id);
    return { aplicados, fallidos, omitidos: carga.cambios.length - seleccion.length, pdf_adjuntado: pdfs };
  }

  return { previsualizar, aplicar, actualizarDesdeArchivo, listarArchivos, buscarArchivo, contenidoArchivo };
}

module.exports = { crearDocumentos };
