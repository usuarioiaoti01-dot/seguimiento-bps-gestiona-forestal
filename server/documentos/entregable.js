'use strict';
/**
 * Lectura del documento de un entregable (presentación o subsanación) para precargar su registro.
 *
 * El usuario sube primero el documento; el sistema lo lee y propone la fecha de presentación (sello de recepción,
 * mesa de partes o fecha del documento), una observación con el documento y el expediente que lo respaldan, y
 * comprueba que corresponda a ese entregable. Con el asistente de IA (texto sin datos personales ni importes) y, si
 * no está disponible o falla, leyendo el texto (extraerEntregableSinIA, pura). Nada se graba: el usuario revisa.
 */
const { aDia, hoyLima } = require('../motor/calendario');
const { quitarMontos } = require('../proyectos');

const error = (estado, mensaje) => Object.assign(new Error(mensaje), { estado });
const limpiar = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, setiembre: 9, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const ORDINALES = { primer: 1, primero: 1, segundo: 2, tercer: 3, tercero: 3, cuarto: 4, quinto: 5, sexto: 6, septimo: 7, octavo: 8, noveno: 9, decimo: 10, unico: 1 };
const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dos = (n) => String(n).padStart(2, '0');

/** «20/09/2026», «20-09-26», «20 de setiembre de 2026», «2026-09-20» → AAAA-MM-DD válido (o null). */
function aFechaIso(dia, mes, anio) {
  let a = Number(anio); if (a < 100) a += 2000;
  const m = Number(mes); const d = Number(dia);
  if (!(a >= 2000 && a <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const iso = `${a}-${dos(m)}-${dos(d)}`;
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}
function fechasDe(texto) {
  const t = String(texto || '');
  const lista = [];
  for (const m of t.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g)) { const f = aFechaIso(m[1], m[2], m[3]); if (f) lista.push({ f, i: m.index }); }
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) { const f = aFechaIso(m[3], m[2], m[1]); if (f) lista.push({ f, i: m.index }); }
  for (const m of t.matchAll(/\b(\d{1,2})\s+de\s+([a-záéíóú]+)\s+(?:de|del)\s+(\d{4})\b/gi)) { const mes = MESES[sinTildes(m[2])]; const f = mes && aFechaIso(m[1], mes, m[3]); if (f) lista.push({ f, i: m.index }); }
  return lista.sort((a, b) => a.i - b.i);
}

/**
 * Propuesta sin IA: { fecha, fuente_fecha, documento, expediente, entregable_numero, observacion }.
 * La fecha prefiere el sello de recepción o mesa de partes; si no hay, la fecha del documento («Lima, 20 de …»).
 */
function extraerEntregableSinIA(texto) {
  const t = String(texto || '').replace(/\r/g, '');
  const fechas = fechasDe(t);
  const cerca = (re) => { const m = re.exec(t); if (!m) return null; const f = fechas.find((x) => x.i >= m.index && x.i - m.index < 120); return f ? f.f : null; };
  let fecha = cerca(/(?:fecha\s+de\s+recepci[oó]n|recibid[oa]|recepcionad[oa]|mesa\s+de\s+partes|tr[aá]mite\s+documentario|fecha\s+de\s+presentaci[oó]n|fecha\s+de\s+ingreso|ingresad[oa])/i);
  let fuente = fecha ? 'RECEPCION' : null;
  if (!fecha) { fecha = cerca(/(?:^|\n)\s*(?:lima|magdalena(?:\s+del\s+mar)?|[A-ZÁÉÍÓÚ][a-záéíóú]+)\s*,/); if (fecha) fuente = 'DOCUMENTO'; }
  if (!fecha) { const m = /\bfecha\s*:?/i.exec(t); if (m) { const f = fechas.find((x) => x.i >= m.index && x.i - m.index < 40); if (f) { fecha = f.f; fuente = 'DOCUMENTO'; } } }
  const doc = /\b(carta|informe|oficio|memorando|memor[aá]ndum|solicitud)\s*(?:n[°º.o]*|nro\.?)\s*:?\s*([0-9][\w./-]{1,60})/i.exec(t);
  const documento = doc ? `${doc[1][0].toUpperCase()}${doc[1].slice(1).toLowerCase()} N.° ${doc[2].replace(/[.,;]+$/, '')}` : null;
  const exp = /\bexpediente\s*(?:n[°º.o]*|nro\.?)?\s*:?\s*([0-9][\w./-]{2,40})/i.exec(t);
  const expediente = exp ? exp[1].replace(/[.,;]+$/, '') : null;
  let numero = null;
  const ord = /\b(primer|primero|segundo|tercer|tercero|cuarto|quinto|sexto|s[eé]ptimo|octavo|noveno|d[eé]cimo|[uú]nico)\s+(?:entregable|producto|informe\s+de\s+avance)\b/i.exec(t);
  if (ord) numero = ORDINALES[sinTildes(ord[1])] || null;
  if (!numero) { const n = /\b(?:entregable|producto)\s*(?:n[°º.o]*|nro\.?)?\s*:?\s*0?(\d{1,2})\b/i.exec(t); if (n) numero = Number(n[1]); }
  const observacion = [documento, expediente ? `expediente ${expediente}` : null].filter(Boolean).join(', ');
  return { fecha, fuente_fecha: fuente, documento, expediente, entregable_numero: numero, observacion: observacion ? `Presentado con ${observacion}` : null };
}

function crearLectorEntregables({ servicio, contrataciones, leerDocumento = null, extraerConIA = null }) {
  /** Lee el documento temporal del entregable `id` (no lo consume: el mismo token sirve para registrar). */
  async function leer(id, token, ctx) {
    const d = await servicio.datos();
    const e = (d.entregables_servicio || []).find((x) => x.entregable_servicio_id === Number(id) && x.activo !== 0 && x.activo !== false);
    if (!e) throw error(404, 'Entregable no encontrado');
    const k = d.contratos.find((x) => x.contrato_id === e.contrato_id) || {};
    const f = contrataciones.tomarTemporal(token, ctx, 'el documento del entregable', { soloPdf: false });
    const subsana = e.estado === 'OBSERVADO';
    const advertencias = [];
    if (['jpg', 'png'].includes(f.formato)) return { origen: null, advertencias: ['El documento es una imagen: no se puede leer su texto. Indique la fecha y la observación a mano.'] };
    if (!leerDocumento) throw error(503, 'La lectura de documentos no está disponible');
    const l = await leerDocumento(f.buffer, f.nombre).catch(() => null);
    const texto = (l && l.texto) || '';
    if (texto.trim().length < 30) return { origen: null, advertencias: ['No se pudo leer texto del documento (¿es un escaneo?). Indique la fecha y la observación a mano.'] };
    const directo = extraerEntregableSinIA(texto);
    let p = directo; let origen = 'TEXTO'; let omitidos = 0;
    if (extraerConIA) {
      try {
        const r = await extraerConIA({ texto: quitarMontos(texto), usuario: { correo: ctx.usuario } }, 'entregable');
        const ia = r.entregable || {};
        p = { ...directo };
        for (const k2 of ['fecha', 'documento', 'expediente', 'entregable_numero', 'resumen']) if (ia[k2] !== null && ia[k2] !== undefined && ia[k2] !== '') p[k2] = ia[k2];
        if (ia.fecha && ia.fecha !== directo.fecha) p.fuente_fecha = ia.fuente_fecha || 'DOCUMENTO';
        p.observacion = [p.documento ? `Presentado con ${p.documento}` : null, p.expediente ? `expediente ${p.expediente}` : null].filter(Boolean).join(', ') || null;
        origen = 'IA'; omitidos = r.omitidos || 0;
      } catch (err) { advertencias.push(`No se pudo usar el asistente de IA (${err.message}): los datos se tomaron del texto del documento`); }
    }
    // la fecha propuesta debe ser registrable: no futura ni anterior al inicio del servicio (o a la observación)
    const desde = subsana ? e.fecha_observacion : k.fecha_inicio;
    if (p.fecha && p.fecha > hoyLima()) { advertencias.push(`El documento indica el ${p.fecha.split('-').reverse().join('/')}, posterior a hoy: se propone la fecha de hoy`); p.fecha = hoyLima(); p.fuente_fecha = null; }
    if (p.fecha && desde && p.fecha < desde) { advertencias.push(`La fecha del documento (${p.fecha.split('-').reverse().join('/')}) es anterior al ${subsana ? 'día de la observación' : 'inicio del servicio'}: revísela`); p.fecha = null; }
    if (!p.fecha) advertencias.push('No se identificó la fecha de presentación: indíquela');
    else if (p.fuente_fecha === 'DOCUMENTO') advertencias.push('La fecha es la del documento, no la de recepción: si se recibió otro día, corríjala');
    if (p.entregable_numero && Number(p.entregable_numero) !== Number(e.numero)) advertencias.push(`El documento parece corresponder al entregable ${p.entregable_numero}, no al ${e.numero}: verifique que sea el documento correcto`);
    const atraso = !subsana && p.fecha && e.fecha_limite && p.fecha > e.fecha_limite ? aDia(p.fecha) - aDia(e.fecha_limite) : 0;
    return { ...p, coincide: p.entregable_numero ? Number(p.entregable_numero) === Number(e.numero) : null, dias_atraso: atraso, origen, advertencias, datos_personales_omitidos: omitidos };
  }
  return { leer };
}

module.exports = { crearLectorEntregables, extraerEntregableSinIA, fechasDe };
