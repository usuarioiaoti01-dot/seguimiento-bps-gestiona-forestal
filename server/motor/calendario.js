'use strict';
/**
 * Calendario de trabajo. Las fechas viajan como texto 'AAAA-MM-DD' y se
 * convierten a "número de día" (días desde 1970-01-01, UTC) para operar.
 *
 * Tipos:
 *  - CALENDARIO: todos los días cuentan (regla general de plazos contractuales).
 *  - HABILES: lunes a viernes, excluyendo feriados y días no laborables.
 */

const MS_DIA = 86400000;

function aDia(fecha) {
  if (fecha === null || fecha === undefined || fecha === '') return null;
  if (typeof fecha === 'number') return fecha;
  const s = fecha instanceof Date ? fecha.toISOString().slice(0, 10) : String(fecha).slice(0, 10);
  const [a, m, d] = s.split('-').map(Number);
  if (!a || !m || !d) throw new Error(`Fecha inválida: ${fecha}`);
  return Math.round(Date.UTC(a, m - 1, d) / MS_DIA);
}

function aFecha(dia) {
  if (dia === null || dia === undefined) return null;
  return new Date(dia * MS_DIA).toISOString().slice(0, 10);
}

/** Fecha de hoy en Lima (UTC-5, sin horario de verano). */
function hoyLima(ahora = new Date()) {
  return new Date(ahora.getTime() - 5 * 3600000).toISOString().slice(0, 10);
}

function crearCalendario({ tipo = 'CALENDARIO', feriados = [] } = {}) {
  const noLaborables = new Set(feriados.map((f) => aDia(typeof f === 'string' ? f : f.fecha)));
  const habiles = tipo === 'HABILES';

  const esLaborable = (dia) => {
    if (!habiles) return true;
    const dow = new Date(dia * MS_DIA).getUTCDay(); // 0 domingo, 6 sábado
    return dow !== 0 && dow !== 6 && !noLaborables.has(dia);
  };

  /** Mismo día si es laborable; si no, el siguiente laborable. */
  const siguienteLaborable = (dia) => {
    let d = dia;
    while (!esLaborable(d)) d += 1;
    return d;
  };

  /** Desplaza k días laborables (k puede ser negativo). Con k = 0 devuelve el mismo día. */
  const desplazar = (dia, k) => {
    if (!habiles) return dia + k;
    let d = dia;
    let pasos = Math.abs(k);
    const paso = k >= 0 ? 1 : -1;
    while (pasos > 0) {
      d += paso;
      if (esLaborable(d)) pasos -= 1;
    }
    return d;
  };

  /** Días laborables en el intervalo cerrado [inicio, fin]; mínimo 1. */
  const duracion = (inicio, fin) => {
    if (fin < inicio) return 1;
    if (!habiles) return fin - inicio + 1;
    let n = 0;
    for (let d = inicio; d <= fin; d += 1) if (esLaborable(d)) n += 1;
    return Math.max(1, n);
  };

  /** Fecha de fin de una tarea de `dur` días que empieza en `inicio`. */
  const finDesde = (inicio, dur) => {
    const ini = siguienteLaborable(inicio);
    return desplazar(ini, Math.max(1, dur) - 1);
  };

  return { tipo, esLaborable, siguienteLaborable, desplazar, duracion, finDesde };
}

module.exports = { aDia, aFecha, hoyLima, crearCalendario };
