'use strict';
/**
 * Plazos de una contratación por Orden de Servicio (criterio C1 de PLAN_DE_MEJORAS.md). Función PURA.
 *
 * R-OS1 inicio = fecha de notificación + 1 día calendario (aunque sea sábado, domingo o feriado).
 * R-OS2 fin    = fecha de notificación + plazo (es decir, inicio + plazo − 1).
 * R-OS3 fecha límite de cada entregable = fecha de notificación + su plazo.
 * Los plazos de la OS y de sus entregables siempre son días calendario (decisión D5): los feriados no los afectan.
 *
 * Ejemplo: notificada el 24/11/2026 con 60 días → inicio 25/11/2026, fin 23/01/2027;
 *          entregable a 30 días → 24/12/2026; a 60 días → 23/01/2027.
 */
const { aDia, aFecha } = require('./calendario');

const MAX_PLAZO = 1095; // tres años
const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const entero = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));

/**
 * Revisa el plazo total y los entregables antes de guardarlos.
 * Errores (bloquean): plazo fuera de rango, sin entregables, plazo de entregable inválido o mayor que el total,
 * plazos repetidos o no crecientes, porcentajes inválidos o que suman más de 100.
 * Advertencias (no bloquean): el último entregable no vence al final del plazo; los porcentajes no suman 100.
 */
function validarEntregables({ plazo_dias, entregables = [] }) {
  const errores = []; const advertencias = [];
  const total = entero(plazo_dias);
  if (!Number.isInteger(total) || total < 1 || total > MAX_PLAZO) errores.push(`El plazo de la Orden de Servicio debe ser un número entero de días entre 1 y ${MAX_PLAZO}`);
  if (!Array.isArray(entregables) || !entregables.length) errores.push('Registre al menos un entregable (producto) del TDR con su plazo');
  const lista = Array.isArray(entregables) ? entregables : [];
  let anterior = 0; let suma = 0; let conPct = 0;
  lista.forEach((e, i) => {
    const n = i + 1;
    const nombre = String((e && e.nombre) || '').trim();
    if (nombre.length < 3 || nombre.length > 300) errores.push(`Entregable ${n}: el nombre lleva de 3 a 300 caracteres`);
    const p = entero(e && e.plazo_dias);
    if (!Number.isInteger(p) || p < 1) errores.push(`Entregable ${n}: el plazo debe ser un número entero de días mayor que cero`);
    else {
      if (Number.isInteger(total) && p > total) errores.push(`Entregable ${n}: su plazo (${p} días) supera el plazo de la Orden de Servicio (${total} días)`);
      if (p <= anterior) errores.push(`Entregable ${n}: su plazo (${p} días) debe ser mayor que el del entregable anterior (${anterior} días)`);
      anterior = p;
    }
    if (e && e.porcentaje_pago !== undefined && e.porcentaje_pago !== null && e.porcentaje_pago !== '') {
      const pct = Number(e.porcentaje_pago);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) errores.push(`Entregable ${n}: el porcentaje de pago va de 0 a 100`);
      else { suma += pct; conPct += 1; }
    }
  });
  if (conPct && Math.round(suma * 100) / 100 > 100) errores.push(`Los porcentajes de pago suman ${suma} % (más de 100 %)`);
  if (!errores.length && lista.length) {
    const ultimo = entero(lista[lista.length - 1].plazo_dias);
    if (ultimo !== total) advertencias.push(`El último entregable vence a los ${ultimo} días y la Orden de Servicio a los ${total}: verifique el TDR`);
    if (conPct && Math.round(suma * 100) / 100 !== 100) advertencias.push(`Los porcentajes de pago suman ${suma} % (no 100 %)`);
    if (conPct && conPct < lista.length) advertencias.push('Algunos entregables no tienen porcentaje de pago');
  }
  return { errores, advertencias };
}

/**
 * Fechas de la contratación a partir de la notificación.
 * @returns {{ inicio, fin, entregables: [{ numero, plazo_dias, fecha_limite }], advertencias }}
 */
function calcularPlazosContratacion({ fecha_notificacion, plazo_dias, entregables = [] }) {
  if (!esFecha(fecha_notificacion)) throw Object.assign(new Error('La fecha de notificación debe tener formato AAAA-MM-DD'), { estado: 400 });
  const { errores, advertencias } = validarEntregables({ plazo_dias, entregables });
  if (errores.length) throw Object.assign(new Error(errores.join('. ')), { estado: 400 });
  const n = aDia(fecha_notificacion);
  return {
    inicio: aFecha(n + 1),
    fin: aFecha(n + Number(plazo_dias)),
    entregables: entregables.map((e, i) => ({ numero: Number(e.numero) || i + 1, plazo_dias: Number(e.plazo_dias), fecha_limite: aFecha(n + Number(e.plazo_dias)) })),
    advertencias,
  };
}

module.exports = { validarEntregables, calcularPlazosContratacion, MAX_PLAZO, esFecha };
