'use strict';
/**
 * Contrataciones por Orden de Servicio (Etapa 2 de PLAN_DE_MEJORAS.md; db/17).
 *
 * 1. Registrar: profesional (nuevo o el mismo de una OS anterior) + Orden de Servicio (número, monto, plazo) +
 *    entregables del TDR + PDF del TDR y de la OS. Queda REGISTRADA: sin fechas y fuera del seguimiento (D6).
 * 2. Notificar: fecha, medio y PDF de la notificación. En una sola transacción se calculan inicio, fin y fechas
 *    límite (motor/plazos.js), se genera el periodo ORIGINAL (el motor de vigencia lo usa) y la OS pasa a
 *    EN_EJECUCION (y el proyecto también, si era su primera OS). Corregir la fecha después exige motivo.
 * 3. Nueva OS para el mismo profesional = otra contratación enlazada (contrato_anterior_id); «ampliación de plazo»
 *    de la misma OS = periodo AMPLIACION, con su documento de sustento.
 *
 * Los PDF van al almacén documental (db/14): TDR público para la OTI; OS y notificación confidenciales (D4, C10).
 * Toda escritura va con bitácora en la misma transacción; el alcance por proyecto lo impone permisos.js.
 */
const crypto = require('crypto');
const fs = require('fs');
const { aDia, aFecha, hoyLima } = require('./motor/calendario');
const { validarEntregables, calcularPlazosContratacion, esFecha } = require('./motor/plazos');
const { detectarFormato, MAX_BYTES } = require('./documentos/almacen');
const { filtrarColumnas } = require('./datos/entidades');
const { configDe, ESTADOS_ABIERTOS, MEDIOS_NOTIFICACION } = require('./modalidades');

const error = (estado, mensaje, extra = {}) => Object.assign(new Error(mensaje), { estado, ...extra });
const vivo = (x) => x && x.activo !== 0 && x.activo !== false;
const ff = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const MONTO_MAX = 9999999999.99;
const TTL_TEMPORAL = 60 * 60000;
const FORMATOS_EVIDENCIA = ['pdf', 'jpg', 'png', 'docx', 'xlsx'];

/** Toda escritura sobre una OS existente exige la revisión que leyó el cliente (regla invariante 4). */
function exigirRevision(enviada, actual) {
  if (enviada === undefined || enviada === null || enviada === '') throw error(409, 'Falta la revisión de la Orden de Servicio. Recargue y vuelva a intentar.', { actual });
  if (Number(enviada) !== Number(actual)) throw error(409, 'Otro usuario modificó esta Orden de Servicio. Recargue y vuelva a intentar.', { actual });
}

function crearContrataciones({ servicio, repo, almacen, leerDocumento = null, extraerTdrConIA = null }) {
  // ---------------------------------------------------------------- PDF temporales (se suben antes de registrar)
  const temporales = new Map(); // token -> { usuario, nombre, buffer, creado }
  const limpiar = () => { const t = Date.now(); for (const [k, v] of temporales) if (t - v.creado > TTL_TEMPORAL) temporales.delete(k); };

  /**
   * Guarda un archivo en memoria (máx. 1 hora) y devuelve su ficha; se usa al registrar la OS, la notificación,
   * los partes diarios y los entregables. Por defecto solo PDF; con `evidencia` también imágenes, Word y Excel (Etapa 3).
   */
  function subirTemporal(buffer, nombre, ctx, { evidencia = false } = {}) {
    limpiar();
    const permitidos = evidencia ? FORMATOS_EVIDENCIA : ['pdf'];
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw error(400, evidencia ? 'Adjunte el archivo' : 'Adjunte el archivo PDF (Content-Type: application/pdf)');
    if (buffer.length > MAX_BYTES) throw error(413, 'El archivo supera el máximo de 15 MB');
    const formato = detectarFormato(buffer, nombre, permitidos);
    if (!formato) throw error(400, evidencia ? 'Formato no admitido (se aceptan PDF, JPG, PNG, Word .docx y Excel .xlsx)' : 'El archivo no es un PDF válido');
    if ([...temporales.values()].filter((v) => v.usuario === ctx.usuario).length >= 20) throw error(429, 'Demasiados archivos pendientes: registre o espere una hora');
    const token = crypto.randomUUID();
    temporales.set(token, { usuario: ctx.usuario, nombre: String(nombre || `documento.${formato.ext}`).slice(0, 200), buffer, creado: Date.now(), formato: formato.ext });
    return { token, nombre: temporales.get(token).nombre, bytes: buffer.length, formato: formato.ext, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
  }
  function tomarTemporal(token, ctx, rotulo, { soloPdf = true } = {}) {
    limpiar();
    const t = token && temporales.get(String(token));
    if (!t || t.usuario !== ctx.usuario) throw error(400, `Adjunte ${rotulo}${soloPdf ? ' (PDF)' : ''}`);
    if (soloPdf && t.formato && t.formato !== 'pdf') throw error(400, `${rotulo[0].toUpperCase()}${rotulo.slice(1)} debe ser un PDF`);
    return t;
  }
  const liberarTemporal = (token) => temporales.delete(String(token));

  /**
   * PDF vigente del proyecto (TDR u Orden de Servicio cargados al registrar el proyecto), con la misma forma que un
   * temporal ({ buffer, nombre }). Así la primera OS del proyecto se registra con los documentos que ya tiene.
   */
  function documentoProyecto(proy, tipo, rotulo) {
    const f = almacen.vigente(tipo, 'proyecto', proy.proyecto_id);
    if (!f) throw error(400, `El proyecto no tiene ${rotulo}: adjunte el PDF`);
    const ruta = almacen.rutaAbsoluta(f);
    if (!ruta || !fs.existsSync(ruta)) throw error(409, `No se encontró el archivo de ${rotulo} del proyecto: adjunte el PDF`);
    return { buffer: fs.readFileSync(ruta), nombre: f.nombre_original, formato: 'pdf' };
  }
  /** Token temporal o «PROYECTO» (el documento que ya tiene el proyecto). */
  const tomarDocumento = (valor, proy, tipo, ctx, rotulo) => (valor === 'PROYECTO' ? documentoProyecto(proy, tipo, rotulo) : tomarTemporal(valor, ctx, rotulo));

  // ---------------------------------------------------------------- lecturas auxiliares
  async function contexto(contrato_id, forzar = true) {
    const d = await servicio.datos(forzar);
    const k = d.contratos.find((x) => x.contrato_id === Number(contrato_id) && vivo(x));
    if (!k) throw error(404, 'Orden de Servicio no encontrada');
    const c = d.consultores.find((x) => x.consultor_id === k.consultor_id);
    const proy = c && d.proyectos.find((p) => p.proyecto_id === c.proyecto_id);
    const entregables = (d.entregables_servicio || []).filter((e) => e.contrato_id === k.contrato_id && vivo(e) && e.estado !== 'ANULADO').sort((a, b) => a.numero - b.numero);
    const periodos = d.adendas.filter((a) => a.contrato_id === k.contrato_id && vivo(a) && a.estado !== 'ANULADA');
    return { d, k, c, proy, entregables, periodos };
  }
  const exigirOS = (k, proy) => {
    if (!proy || configDe(proy).inicio !== 'NOTIFICACION' || k.tipo_documento !== 'ORDEN_SERVICIO') throw error(409, 'Solo aplica a Órdenes de Servicio de proyectos con modalidad Orden de Servicio');
  };

  function validarOS(d, e, { excluir = null } = {}) {
    const numero = String(e.numero || e.contrato_numero || '').trim();
    if (!numero || numero.length > 60) throw error(400, 'El número de la Orden de Servicio es obligatorio (hasta 60 caracteres)');
    if (d.contratos.some((k) => k.contrato_id !== excluir && String(k.numero).toLowerCase() === numero.toLowerCase())) throw error(409, `Ya existe la Orden de Servicio ${numero}`);
    const monto = Number(e.monto);
    if (e.monto === undefined || e.monto === null || e.monto === '' || !Number.isFinite(monto) || monto <= 0 || monto > MONTO_MAX) throw error(400, 'Indique el monto de la Orden de Servicio (en soles, mayor que cero)');
    if (Math.abs(Math.round(monto * 100) - monto * 100) > 1e-6) throw error(400, 'El monto admite hasta dos decimales');
    for (const [k, max, nombre] of [['expediente', 40, 'El expediente'], ['titulo_tdr', 300, 'El título del TDR'], ['servicio', 300, 'La descripción del servicio']]) {
      if (e[k] && String(e[k]).length > max) throw error(400, `${nombre} admite hasta ${max} caracteres`);
    }
    const { errores, advertencias } = validarEntregables({ plazo_dias: e.plazo_dias, entregables: e.entregables });
    if (errores.length) throw error(400, errores.join('. '));
    return { numero, monto: Math.round(monto * 100) / 100, plazo_dias: Number(e.plazo_dias), advertencias };
  }
  const filaEntregable = (x, i, contrato_id) => filtrarColumnas('entregable_servicio', {
    contrato_id, numero: i + 1, nombre: String(x.nombre).trim(), descripcion: x.descripcion ? String(x.descripcion).trim().slice(0, 1000) : null,
    plazo_dias: Number(x.plazo_dias), porcentaje_pago: x.porcentaje_pago === '' || x.porcentaje_pago === undefined ? null : x.porcentaje_pago, estado: 'PENDIENTE',
  });

  // ---------------------------------------------------------------- 1. registrar la Orden de Servicio
  /**
   * entrada: { consultor_id? (nueva OS del mismo profesional) | clave, nombres, perfil, sede, correo_institucional…,
   *            numero, expediente, titulo_tdr, servicio, monto, plazo_dias, entregables: [{ nombre, plazo_dias, porcentaje_pago?, descripcion? }],
   *            documentos: { TDR: token, ORDEN_SERVICIO: token } }
   */
  async function registrar(proyecto_id, entrada, ctx) {
    const e = entrada || {};
    const d = await servicio.datos(true);
    const proy = d.proyectos.find((p) => p.proyecto_id === Number(proyecto_id) && vivo(p));
    if (!proy) throw error(404, 'Proyecto no encontrado');
    if (configDe(proy).inicio !== 'NOTIFICACION') throw error(409, 'Este proyecto no es de la modalidad Orden de Servicio');
    if (!ESTADOS_ABIERTOS.includes(proy.estado)) throw error(409, `El proyecto está ${String(proy.estado).toLowerCase().replace('_', ' ')}: no admite nuevas Órdenes de Servicio`);
    let consultor = null; let anterior = null; let nuevo = null;
    if (e.consultor_id) {
      consultor = d.consultores.find((c) => c.consultor_id === Number(e.consultor_id) && vivo(c));
      if (!consultor || consultor.proyecto_id !== proy.proyecto_id) throw error(404, 'El profesional no pertenece a este proyecto');
      const previas = d.contratos.filter((k) => k.consultor_id === consultor.consultor_id && vivo(k) && k.estado_contratacion !== 'ANULADA').sort((a, b) => a.contrato_id - b.contrato_id);
      if (previas.some((k) => k.estado_contratacion === 'REGISTRADA')) throw error(409, 'El profesional ya tiene una Orden de Servicio registrada sin notificar: notifíquela o corríjala antes de registrar otra');
      anterior = previas[previas.length - 1] || null;
    } else {
      nuevo = servicio.validarProfesionalNuevo(d, e, ctx, proy);
    }
    const os = validarOS(d, e);
    const tdr = tomarDocumento(e.documentos && e.documentos.TDR, proy, 'TDR', ctx, 'los Términos de Referencia');
    const osPdf = tomarDocumento(e.documentos && e.documentos.ORDEN_SERVICIO, proy, 'ORDEN_SERVICIO', ctx, 'la Orden de Servicio');
    const base = { usuario: ctx.usuario, motivo: ctx.motivo || `Registro de la Orden de Servicio N.° ${os.numero} en el proyecto ${proy.codigo}`, origen: ctx.origen || 'UI' };

    const r = await repo.transaccion(async (t) => {
      const c = consultor || await t.crear('consultor', nuevo, { ...base, consultor_id: null });
      if (consultor && consultor.estado !== 'ACTIVO') await t.actualizar('consultor', consultor.consultor_id, { estado: 'ACTIVO' }, { ...base, consultor_id: consultor.consultor_id });
      const k = await t.crear('contrato', filtrarColumnas('contrato', {
        consultor_id: c.consultor_id, numero: os.numero, tipo_documento: 'ORDEN_SERVICIO', titulo_tdr: e.titulo_tdr || e.perfil || null, servicio: e.servicio || e.perfil || null,
        expediente: e.expediente || null, monto: os.monto, plazo_dias: os.plazo_dias, estado_contratacion: 'REGISTRADA', fecha_registro: hoyLima(), contrato_anterior_id: anterior ? anterior.contrato_id : null,
      }), { ...base, consultor_id: c.consultor_id });
      const ents = [];
      for (const [i, x] of e.entregables.entries()) ents.push(await t.crear('entregable_servicio', filaEntregable(x, i, k.contrato_id), { ...base, consultor_id: c.consultor_id }));
      return { consultor: c, contrato: k, entregables: ents };
    });

    // PDF al almacén (fuera de la transacción: el almacén confirma sus metadatos por separado)
    const documentos = {}; const pendientes = [];
    for (const [tipo, tmp, confidencial, rotulo] of [['TDR', tdr, false, 'Términos de Referencia'], ['ORDEN_SERVICIO', osPdf, true, 'Orden de Servicio']]) {
      try {
        const g = await almacen.guardar({ tipo, entidad: 'contrato', entidad_id: r.contrato.contrato_id, consultor_id: r.consultor.consultor_id, buffer: tmp.buffer, nombre: tmp.nombre, confidencial }, { ...base, motivo: `${rotulo} de la Orden de Servicio N.° ${os.numero}` });
        documentos[tipo] = g.documento_id;
      } catch (err) { pendientes.push(`${rotulo}: ${err.message}`); }
    }
    temporales.delete(String(e.documentos.TDR)); temporales.delete(String(e.documentos.ORDEN_SERVICIO));
    await servicio.recalcularYGuardar(ctx.usuario, `Registro de la Orden de Servicio N.° ${os.numero}`);
    return { ...r, documentos, documentos_pendientes: pendientes, advertencias: os.advertencias };
  }

  /** Corrige los entregables de una OS aún no notificada (se valida el conjunto completo). */
  async function reemplazarEntregables(contrato_id, lista, revision, ctx) {
    const { k, c, proy, entregables } = await contexto(contrato_id);
    exigirOS(k, proy);
    if (k.estado_contratacion !== 'REGISTRADA') throw error(409, 'Los entregables solo se corrigen antes de registrar la notificación');
    exigirRevision(revision, k.revision);
    const { errores, advertencias } = validarEntregables({ plazo_dias: k.plazo_dias, entregables: lista });
    if (errores.length) throw error(400, errores.join('. '));
    const base = { usuario: ctx.usuario, motivo: ctx.motivo || `Corrección de los entregables de la Orden de Servicio N.° ${k.numero}`, origen: ctx.origen || 'UI', consultor_id: c.consultor_id };
    const contrato = await repo.transaccion(async (t) => {
      for (const [i, x] of lista.entries()) {
        const fila = filaEntregable(x, i, k.contrato_id);
        const previo = entregables.find((p) => p.numero === i + 1);
        if (previo) await t.actualizar('entregable_servicio', previo.entregable_servicio_id, { nombre: fila.nombre, descripcion: fila.descripcion, plazo_dias: fila.plazo_dias, porcentaje_pago: fila.porcentaje_pago }, { ...base, revision: previo.revision });
        else await t.crear('entregable_servicio', fila, base);
      }
      for (const p of entregables.filter((x) => x.numero > lista.length)) await t.actualizar('entregable_servicio', p.entregable_servicio_id, { activo: 0 }, { ...base, accion: 'ANULAR', revision: p.revision });
      // La OS es la raíz del agregado: incrementar su revisión serializa dos reemplazos concurrentes.
      return (await t.actualizar('contrato', k.contrato_id, {}, { ...base, revision: k.revision, tocar: true })).fila;
    });
    await servicio.recalcularYGuardar(ctx.usuario, `Entregables de la Orden de Servicio N.° ${k.numero}`);
    return { advertencias, revision: contrato.revision };
  }

  // ---------------------------------------------------------------- 2. notificación
  function plazosDe(k, entregables, fecha) {
    return calcularPlazosContratacion({ fecha_notificacion: fecha, plazo_dias: k.plazo_dias, entregables: entregables.map((x) => ({ numero: x.numero, nombre: x.nombre, plazo_dias: x.plazo_dias, porcentaje_pago: x.porcentaje_pago })) });
  }

  /** Desplaza las ampliaciones desde el fin del periodo ORIGINAL, no desde el fin total de la OS. */
  function ajusteAmpliaciones(periodos, nuevoFinOriginal) {
    const original = periodos.find((a) => a.tipo_periodo === 'ORIGINAL');
    const ampliaciones = periodos.filter((a) => a.tipo_periodo === 'AMPLIACION').sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
    if (!original || !ampliaciones.length) return { original, ampliaciones, delta: 0, fin: nuevoFinOriginal };
    const delta = aDia(nuevoFinOriginal) - aDia(original.fecha_fin);
    return { original, ampliaciones, delta, fin: aFecha(aDia(ampliaciones[ampliaciones.length - 1].fecha_fin) + delta) };
  }

  /** Fechas que resultarían de una notificación (para mostrarlas antes de confirmar; no escribe). */
  async function previsualizarNotificacion(contrato_id, { fecha_notificacion } = {}) {
    const { k, proy, entregables, periodos } = await contexto(contrato_id, false);
    exigirOS(k, proy);
    const p = plazosDe(k, entregables, fecha_notificacion);
    const ajuste = ajusteAmpliaciones(periodos, p.fin);
    return { ...p, fin_original: p.fin, fin: ajuste.fin, entregables: p.entregables.map((x) => ({ ...x, nombre: (entregables.find((y) => y.numero === x.numero) || {}).nombre })) };
  }

  /**
   * entrada: { fecha_notificacion, medio_notificacion, documento: token del PDF (obligatorio la primera vez), motivo (al corregir), revision }
   */
  async function notificar(contrato_id, entrada, ctx) {
    const e = entrada || {};
    const { k, c, proy, entregables, periodos } = await contexto(contrato_id);
    exigirOS(k, proy);
    const correccion = k.estado_contratacion === 'EN_EJECUCION' && !!k.fecha_notificacion;
    if (!correccion && k.estado_contratacion !== 'REGISTRADA') throw error(409, `La Orden de Servicio está ${String(k.estado_contratacion).toLowerCase()}: no admite notificación`);
    exigirRevision(e.revision, k.revision);
    if (!esFecha(e.fecha_notificacion)) throw error(400, 'Indique la fecha de notificación (AAAA-MM-DD)');
    if (e.fecha_notificacion > hoyLima()) throw error(400, 'La fecha de notificación no puede ser posterior a hoy');
    if (!MEDIOS_NOTIFICACION[e.medio_notificacion]) throw error(400, `Indique el medio de notificación (${Object.values(MEDIOS_NOTIFICACION).join(', ')})`);
    const motivo = String(e.motivo || ctx.motivo || '').trim();
    if (correccion && motivo.length < 5) throw error(400, 'Corregir la notificación cambia todas las fechas del servicio: indique el motivo (mínimo 5 caracteres)', { requiereMotivo: true });
    if (!almacen.vigente('TDR', 'contrato', k.contrato_id) || !almacen.vigente('ORDEN_SERVICIO', 'contrato', k.contrato_id)) throw error(409, 'Antes de notificar, adjunte el TDR y la Orden de Servicio (PDF)');
    const pdf = e.documento ? tomarTemporal(e.documento, ctx, 'el cargo o constancia de notificación') : null;
    if (!pdf && !correccion) throw error(400, 'Adjunte el cargo o constancia de notificación (PDF)');
    if (!entregables.length) throw error(409, 'La Orden de Servicio no tiene entregables registrados');
    const p = plazosDe(k, entregables, e.fecha_notificacion);
    const ajuste = ajusteAmpliaciones(periodos, p.fin);
    const textoMotivo = correccion ? `Corrección de la notificación de la Orden de Servicio N.° ${k.numero}: ${motivo}` : `Notificación de la Orden de Servicio N.° ${k.numero} el ${ff(e.fecha_notificacion)}`;
    const base = { usuario: ctx.usuario, motivo: textoMotivo, origen: ctx.origen || 'UI', consultor_id: c.consultor_id };

    // el PDF primero (la contratación ya existe); si la transacción falla, se retira
    let doc = null;
    if (pdf) doc = await almacen.guardar({ tipo: 'NOTIFICACION', entidad: 'contrato', entidad_id: k.contrato_id, consultor_id: c.consultor_id, buffer: pdf.buffer, nombre: pdf.nombre, confidencial: true }, { ...base, motivo: `Cargo de notificación de la Orden de Servicio N.° ${k.numero}` });
    let contratoActualizado = null;
    try {
      await repo.transaccion(async (t) => {
        contratoActualizado = (await t.actualizar('contrato', k.contrato_id, { fecha_notificacion: e.fecha_notificacion, medio_notificacion: e.medio_notificacion, fecha_inicio: p.inicio, fecha_fin: ajuste.fin, estado_contratacion: 'EN_EJECUCION' }, { ...base, revision: e.revision, accion: correccion ? 'REPROGRAMAR' : 'MODIFICAR' })).fila;
        const original = ajuste.original;
        const periodo = { fecha_inicio: p.inicio, fecha_fin: p.fin, plazo_dias: k.plazo_dias, fecha_suscripcion: e.fecha_notificacion, documento_ref: `Orden de Servicio N.° ${k.numero} (notificada el ${ff(e.fecha_notificacion)})`.slice(0, 300) };
        if (original) await t.actualizar('adenda', original.adenda_id, periodo, { ...base, accion: correccion ? 'REPROGRAMAR' : 'MODIFICAR', revision: original.revision });
        else {
          await t.crear('adenda', filtrarColumnas('adenda', { ...periodo, contrato_id: k.contrato_id, numero: Math.max(0, ...periodos.map((a) => Number(a.numero) || 0)) + 1, estado: 'FIRMADA', tipo_periodo: 'ORIGINAL', expediente: k.expediente }), base);
        }
        // las ampliaciones de plazo se corren con la corrección (conservan su duración)
        if (correccion && ajuste.delta) {
          for (const a of ajuste.ampliaciones) {
            await t.actualizar('adenda', a.adenda_id, { fecha_inicio: aFecha(aDia(a.fecha_inicio) + ajuste.delta), fecha_fin: aFecha(aDia(a.fecha_fin) + ajuste.delta) }, { ...base, accion: 'REPROGRAMAR', revision: a.revision });
          }
        }
        for (const x of p.entregables) {
          const ent = entregables.find((y) => y.numero === x.numero);
          if (ent && ent.fecha_limite !== x.fecha_limite) await t.actualizar('entregable_servicio', ent.entregable_servicio_id, { fecha_limite: x.fecha_limite }, { ...base, accion: correccion ? 'REPROGRAMAR' : 'MODIFICAR', revision: ent.revision });
        }
        // cambio automático de estado del proyecto: lo decide el sistema (origen SISTEMA; permisos.js lo admite solo para el estado)
        if (proy.estado === 'REGISTRADO') await t.actualizar('proyecto', proy.proyecto_id, { estado: 'EN_EJECUCION' }, { ...base, consultor_id: null, origen: 'SISTEMA', motivo: `El proyecto inicia su ejecución con la notificación de la Orden de Servicio N.° ${k.numero}`, revision: proy.revision });
      });
    } catch (err) {
      if (doc) { try { await almacen.retirar(doc.documento_id, { ...base, motivo: 'Notificación no registrada: se retira su cargo' }); } catch { /* queda registrado */ } }
      throw err;
    }
    if (pdf) temporales.delete(String(e.documento));
    await servicio.recalcularYGuardar(ctx.usuario, textoMotivo);
    return { inicio: p.inicio, fin: ajuste.fin, fin_original: p.fin, contrato: contratoActualizado, entregables: p.entregables, advertencias: p.advertencias, documento_id: doc ? doc.documento_id : null };
  }

  // ---------------------------------------------------------------- 3. ampliación de plazo de la misma OS
  /** entrada: { plazo_dias (adicionales), documento_ref (documento que la aprueba), motivo } */
  async function ampliarPlazo(contrato_id, entrada, ctx) {
    const e = entrada || {};
    const { k, c, proy, periodos } = await contexto(contrato_id);
    exigirOS(k, proy);
    if (k.estado_contratacion !== 'EN_EJECUCION' || !k.fecha_fin) throw error(409, 'Solo se amplía el plazo de una Orden de Servicio en ejecución (ya notificada)');
    exigirRevision(e.revision, k.revision);
    const dias = Number(e.plazo_dias);
    if (!Number.isInteger(dias) || dias < 1 || dias > 365) throw error(400, 'Indique los días de ampliación (entero de 1 a 365)');
    const ref = String(e.documento_ref || '').trim();
    if (ref.length < 5 || ref.length > 300) throw error(400, 'Indique el documento que aprueba la ampliación (de 5 a 300 caracteres)');
    const motivo = String(e.motivo || ctx.motivo || '').trim();
    if (motivo.length < 5) throw error(400, 'Indique el motivo de la ampliación (mínimo 5 caracteres)', { requiereMotivo: true });
    const inicio = aFecha(aDia(k.fecha_fin) + 1); const fin = aFecha(aDia(k.fecha_fin) + dias);
    const base = { usuario: ctx.usuario, motivo: `Ampliación de plazo de la Orden de Servicio N.° ${k.numero} (${dias} días): ${motivo}`, origen: ctx.origen || 'UI', consultor_id: c.consultor_id };
    const r = await repo.transaccion(async (t) => {
      const a = await t.crear('adenda', filtrarColumnas('adenda', { contrato_id: k.contrato_id, numero: Math.max(0, ...periodos.map((x) => Number(x.numero) || 0)) + 1, tipo_periodo: 'AMPLIACION', estado: 'FIRMADA', fecha_inicio: inicio, fecha_fin: fin, plazo_dias: dias, documento_ref: ref, expediente: k.expediente }), base);
      const contrato = (await t.actualizar('contrato', k.contrato_id, { fecha_fin: fin }, { ...base, revision: e.revision })).fila;
      return { periodo: a, contrato };
    });
    await servicio.recalcularYGuardar(ctx.usuario, base.motivo);
    return { ...r, fecha_fin: fin, advertencias: ['Las fechas límite de los entregables no cambian con la ampliación: si el documento las modifica, regístrelo en la observación del entregable.'] };
  }

  // ---------------------------------------------------------------- lectura del TDR con IA (precarga; no escribe)
  /**
   * Lee el PDF temporal del TDR y devuelve lo que declara (objeto, perfil, plazo, entregables con su plazo y % de pago)
   * para precargar el registro de la OS. El usuario revisa y corrige antes de registrar. A la IA no se le envían datos
   * personales (redactarPersonales en el agente) y su respuesta es solo una propuesta.
   */
  async function leerTdr(token, ctx) {
    const f = tomarTemporal(token, ctx, 'los Términos de Referencia');
    if (!leerDocumento) throw error(503, 'La lectura de documentos no está disponible');
    if (!extraerTdrConIA) throw error(503, 'La lectura del TDR requiere el asistente de IA, que no está configurado (ANTHROPIC_API_KEY)');
    const leido = await leerDocumento(f.buffer, f.nombre);
    if (!leido || !leido.texto || leido.texto.trim().length < 50) throw error(400, 'No se pudo leer texto del TDR (¿es un PDF escaneado?). Registre los datos a mano.');
    const r = await extraerTdrConIA({ texto: leido.texto, usuario: { correo: ctx.usuario } });
    const t = r.tdr || {};
    const advertencias = [];
    if (!t.plazo_dias) advertencias.push('El TDR no indica con claridad el plazo total: complételo');
    if (!t.entregables || !t.entregables.length) advertencias.push('No se identificaron entregables: regístrelos a mano');
    else if (t.entregables.some((x) => !x.plazo_dias)) advertencias.push('Algunos entregables no tienen un plazo claro: complételos');
    if (r.truncado) advertencias.push('El TDR es muy extenso: solo se leyó la primera parte');
    if (t.plazo_dias && t.entregables && t.entregables.length) {
      const { errores, advertencias: adv } = validarEntregables({ plazo_dias: t.plazo_dias, entregables: t.entregables.filter((x) => x.plazo_dias) });
      advertencias.push(...errores, ...adv);
    }
    return { ...t, advertencias, datos_personales_omitidos: r.omitidos || 0 };
  }

  // ---------------------------------------------------------------- 4. término anticipado
  /** Proyectos y profesionales que quedan sin OS abierta al cerrar una (para culminar/concluir en la misma transacción). */
  function cascada(d, k, c, proy) {
    const abierta = (y) => vivo(y) && ['REGISTRADA', 'EN_EJECUCION'].includes(y.estado_contratacion);
    const otraDelProfesional = d.contratos.some((y) => y.consultor_id === c.consultor_id && y.contrato_id !== k.contrato_id && abierta(y));
    const otraDelProyecto = d.contratos.some((y) => y.contrato_id !== k.contrato_id && abierta(y) && d.consultores.some((z) => z.consultor_id === y.consultor_id && z.proyecto_id === proy.proyecto_id));
    return { otraDelProfesional, concluye: !otraDelProyecto && proy.estado === 'EN_EJECUCION' };
  }

  /**
   * Resolución de una OS en ejecución (termina antes de completar sus entregables): los entregables pendientes se
   * anulan con el motivo, el profesional queda CULMINADO si no tiene otra OS abierta y, si era la última OS del
   * proyecto, el proyecto pasa a CONCLUIDO. entrada: { fecha, documento_ref, motivo, documento? (token PDF), revision }
   */
  async function resolver(contrato_id, entrada, ctx) {
    const e = entrada || {};
    const { d, k, c, proy, entregables } = await contexto(contrato_id);
    exigirOS(k, proy);
    if (k.estado_contratacion !== 'EN_EJECUCION') throw error(409, 'Solo se resuelve una Orden de Servicio en ejecución');
    exigirRevision(e.revision, k.revision);
    if (!esFecha(e.fecha) || e.fecha > hoyLima()) throw error(400, 'Indique la fecha de la resolución (AAAA-MM-DD, no posterior a hoy)');
    if (k.fecha_inicio && e.fecha < k.fecha_inicio) throw error(400, `La resolución no puede ser anterior al inicio del servicio (${ff(k.fecha_inicio)})`);
    const ref = String(e.documento_ref || '').trim();
    if (ref.length < 5 || ref.length > 300) throw error(400, 'Indique el documento que resuelve la Orden de Servicio (de 5 a 300 caracteres)');
    const motivo = String(e.motivo || '').trim();
    if (motivo.length < 10 || motivo.length > 800) throw error(400, 'Explique el motivo de la resolución (de 10 a 800 caracteres)');
    const pdf = e.documento ? tomarTemporal(e.documento, ctx, 'el documento de resolución') : null;
    const { otraDelProfesional, concluye } = cascada(d, k, c, proy);
    const base = { usuario: ctx.usuario, origen: ctx.origen || 'UI', consultor_id: c.consultor_id, motivo: `Resolución de la Orden de Servicio N.° ${k.numero} (${ref}): ${motivo}` };
    let doc = null;
    if (pdf) doc = await almacen.guardar({ tipo: 'OTRO', entidad: 'contrato', entidad_id: k.contrato_id, consultor_id: c.consultor_id, buffer: pdf.buffer, nombre: pdf.nombre, confidencial: true }, { ...base, motivo: `Documento de resolución de la Orden de Servicio N.° ${k.numero}` });
    try {
      await repo.transaccion(async (t) => {
        await t.actualizar('contrato', k.contrato_id, { estado_contratacion: 'RESUELTA', fecha_culminacion: e.fecha, observacion: `Resuelta el ${ff(e.fecha)} (${ref}): ${motivo}`.slice(0, 1000) }, { ...base, revision: e.revision, accion: 'ANULAR' });
        for (const x of entregables.filter((y) => !['CONFORME', 'ANULADO'].includes(y.estado))) {
          await t.actualizar('entregable_servicio', x.entregable_servicio_id, { estado: 'ANULADO', observacion: `Sin conformidad: Orden de Servicio resuelta (${ref})`.slice(0, 1000) }, { ...base, accion: 'ANULAR' });
        }
        if (!otraDelProfesional && c.estado === 'ACTIVO') await t.actualizar('consultor', c.consultor_id, { estado: 'CULMINADO' }, { ...base, motivo: `Servicio terminado por resolución (OS N.° ${k.numero})` });
        if (concluye) await t.actualizar('proyecto', proy.proyecto_id, { estado: 'CONCLUIDO' }, { ...base, consultor_id: null, origen: 'SISTEMA', motivo: 'Proyecto concluido: ya no tiene Órdenes de Servicio abiertas' });
      });
    } catch (err) {
      if (doc) { try { await almacen.retirar(doc.documento_id, { ...base, motivo: 'Resolución no registrada: se retira su documento' }); } catch { /* queda registrado */ } }
      throw err;
    }
    if (pdf) liberarTemporal(e.documento);
    await servicio.recalcularYGuardar(ctx.usuario, base.motivo);
    return { estado_contratacion: 'RESUELTA', proyecto_concluido: concluye };
  }

  /**
   * Anulación de una OS registrada y nunca notificada (no llegó a ejecutarse). Sus entregables se anulan; el profesional
   * queda NO_RENOVADO si no tiene otra contratación vigente o culminada. entrada: { motivo, revision }
   */
  async function anular(contrato_id, entrada, ctx) {
    const e = entrada || {};
    const { d, k, c, proy, entregables } = await contexto(contrato_id);
    exigirOS(k, proy);
    if (k.estado_contratacion !== 'REGISTRADA') throw error(409, 'Solo se anula una Orden de Servicio registrada y aún no notificada (si ya está en ejecución, resuélvala)');
    exigirRevision(e.revision, k.revision);
    const motivo = String(e.motivo || '').trim();
    if (motivo.length < 10 || motivo.length > 800) throw error(400, 'Explique el motivo de la anulación (de 10 a 800 caracteres)');
    const otras = d.contratos.some((y) => y.consultor_id === c.consultor_id && y.contrato_id !== k.contrato_id && vivo(y) && y.estado_contratacion !== 'ANULADA');
    const base = { usuario: ctx.usuario, origen: ctx.origen || 'UI', consultor_id: c.consultor_id, motivo: `Anulación de la Orden de Servicio N.° ${k.numero}: ${motivo}` };
    await repo.transaccion(async (t) => {
      await t.actualizar('contrato', k.contrato_id, { estado_contratacion: 'ANULADA', observacion: `Anulada: ${motivo}`.slice(0, 1000) }, { ...base, revision: e.revision, accion: 'ANULAR' });
      for (const x of entregables) await t.actualizar('entregable_servicio', x.entregable_servicio_id, { estado: 'ANULADO' }, { ...base, accion: 'ANULAR' });
      if (!otras && c.estado === 'ACTIVO') await t.actualizar('consultor', c.consultor_id, { estado: 'NO_RENOVADO' }, { ...base, motivo: `Sin contratación vigente: OS N.° ${k.numero} anulada` });
    });
    await servicio.recalcularYGuardar(ctx.usuario, base.motivo);
    return { estado_contratacion: 'ANULADA' };
  }

  return { subirTemporal, tomarTemporal, liberarTemporal, documentoProyecto, tomarDocumento, FORMATOS_EVIDENCIA, leerTdr, resolver, anular, registrar, reemplazarEntregables, previsualizarNotificacion, notificar, ampliarPlazo };
}

module.exports = { crearContrataciones };
