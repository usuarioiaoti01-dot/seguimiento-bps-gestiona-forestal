'use strict';
/**
 * Plan de trabajo ya elaborado en un documento → actividades del plan (función pura).
 *   - `planDeTablas(hojas)`: Excel / CSV con las columnas de la plantilla del cronograma
 *     (N.°, Actividad, Producto / evidencia, Inicio, Fin, Días). Las filas «1.1», «1.2»… son subactividades de la «1».
 *   - `normalizarPlan(crudo)`: la salida del asistente de IA (PDF/Word) con la misma forma.
 * Resultado: { actividades: [{ descripcion, producto, dias, subactividades: [{ texto, dias, producto }], advertencias }], area_usuaria, supuestos }.
 * Los días son hábiles (1 a 99); si el documento solo trae fechas se cuentan los días hábiles entre ellas (sin feriados).
 */

const sinTilde = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const texto = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Días hábiles (lunes a viernes) entre dos fechas AAAA-MM-DD, ambas incluidas. */
function diasHabilesEntre(ini, fin) {
  const a = Date.parse(`${String(ini).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(fin).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  let n = 0;
  for (let t = a; t <= b; t += 86400000) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) n += 1; }
  return n;
}

function mapaColumnas(fila) {
  const m = {};
  fila.forEach((c, i) => {
    const h = sinTilde(c).replace(/[^a-z0-9. ]/g, '');
    if (!h) return;
    if (m.num === undefined && /^(n|no|nro|num|numero|item|n\.?)\.?$/.test(h.replace(/\s/g, ''))) m.num = i;
    else if (m.desc === undefined && /(^|\s)(actividad|actividades|descripcion|tarea)/.test(h) && !/producto|evidencia/.test(h)) m.desc = i;
    else if (m.prod === undefined && /(producto|evidencia|entregable)/.test(h)) m.prod = i;
    else if (m.ini === undefined && /^inicio/.test(h)) m.ini = i;
    else if (m.fin === undefined && /^(fin|termino)/.test(h)) m.fin = i;
    else if (m.dias === undefined && /(dias|duracion)/.test(h)) m.dias = i;
  });
  return m;
}

const entero = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
const fechaIso = (v) => { const s = String(v ?? '').trim(); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; };

function planDeTablas(hojas) {
  for (const h of hojas || []) {
    const filas = h.filas || [];
    const ie = filas.findIndex((f) => { const m = mapaColumnas(f); return m.desc !== undefined && m.prod !== undefined; });
    if (ie < 0) continue;
    const m = mapaColumnas(filas[ie]);
    const actividades = [];
    let actual = null;
    for (const f of filas.slice(ie + 1)) {
      const num = texto(f[m.num]).replace(/\.$/, '');
      let desc = texto(f[m.desc]);
      if (!desc && !texto(f[m.prod])) continue;
      const esSub = /^\d+\.\d+/.test(num) || /^[•\-–·]\s*/.test(desc) || (actual && !num && /^[•\-–·]/.test(desc));
      const dias = entero(f[m.dias]) ?? (m.ini !== undefined && m.fin !== undefined && fechaIso(f[m.ini]) && fechaIso(f[m.fin]) ? diasHabilesEntre(f[m.ini], f[m.fin]) : null);
      const deFechas = entero(f[m.dias]) === null && dias !== null;
      desc = desc.replace(/^[•\-–·]\s*/, '');
      if (esSub && actual) {
        actual.subactividades.push({ texto: desc, dias, producto: texto(f[m.prod]), __deFechas: deFechas });
      } else if (/^totales?$/i.test(desc) || /^total\b/i.test(desc)) {
        continue;
      } else {
        actual = { descripcion: desc, producto: texto(f[m.prod]), dias, subactividades: [], advertencias: [], __deFechas: deFechas };
        actividades.push(actual);
      }
    }
    if (actividades.length) return cerrar({ actividades });
  }
  return null;
}

/** Salida del asistente de IA con la misma forma. */
function normalizarPlan(crudo) {
  const c = crudo || {};
  const actividades = (Array.isArray(c.actividades) ? c.actividades : []).map((a) => {
    const dias = entero(a.dias) ?? (fechaIso(a.inicio) && fechaIso(a.fin) ? diasHabilesEntre(a.inicio, a.fin) : null);
    return {
      descripcion: texto(a.descripcion), producto: texto(a.producto), dias, advertencias: [],
      __deFechas: entero(a.dias) === null && dias !== null,
      subactividades: (Array.isArray(a.subactividades) ? a.subactividades : []).map((s) => ({ texto: texto(s.texto), dias: entero(s.dias), producto: texto(s.producto) })),
    };
  }).filter((a) => a.descripcion);
  return cerrar({ actividades, area_usuaria: texto(c.area_usuaria) || null, supuestos: texto(c.supuestos) || null });
}

/** Ajusta los días (suma de subactividades) y deja las advertencias de lo que se dedujo. */
function cerrar(plan) {
  for (const a of plan.actividades) {
    const sub = a.subactividades;
    const suma = sub.reduce((t, s) => t + (s.dias || 0), 0);
    if (a.__deFechas) a.advertencias.push('Los días se calcularon con las fechas del documento (sin contar feriados)');
    if (sub.some((s) => s.__deFechas)) a.advertencias.push('Los días de alguna subactividad se calcularon con las fechas del documento');
    if (sub.length && (a.dias === null || a.dias < suma)) {
      if (a.dias !== null) a.advertencias.push(`Los días de la actividad (${a.dias}) eran menores que la suma de sus subactividades (${suma}): se usó ${suma}`);
      a.dias = suma;
    }
    if (a.dias === null) a.advertencias.push('El documento no indica los días hábiles de la actividad: complételos antes de incorporarla');
    if (!sub.length && !a.producto) a.advertencias.push('Falta el producto / evidencia verificable');
    for (const s of sub) { delete s.__deFechas; }
    delete a.__deFechas;
  }
  return plan;
}

module.exports = { planDeTablas, normalizarPlan, diasHabilesEntre };
