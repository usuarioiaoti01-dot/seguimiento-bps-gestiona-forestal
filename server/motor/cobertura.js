'use strict';
/**
 * Cobertura contractual: días sin cobertura entre una adenda y la siguiente, y vigencias superpuestas.
 * Función pura (sin base de datos). Solo cuentan los periodos confirmados: adendas CONCLUIDA y FIRMADA
 * activas; las anunciadas, en trámite y anuladas no cubren nada todavía.
 *
 * Entre dos periodos consecutivos (ordenados por inicio): hueco = inicio_siguiente − fin_acumulado − 1.
 *   hueco > 0  → BRECHA: días sin cobertura (desde el día siguiente al fin hasta el día anterior al inicio).
 *   hueco = 0  → CONTINUA.
 *   hueco < 0  → SUPERPOSICION: inconsistencia; las vigencias comparten −hueco días.
 * `fin_acumulado` es el mayor fin visto hasta ese momento, de modo que una adenda larga que se solapa con
 * otra posterior (no consecutiva) también se detecta.
 */
const { aDia } = require('./calendario');

const COBERTURAN = new Set(['CONCLUIDA', 'FIRMADA']);

function diaIso(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }

function analizarCobertura(adendas = []) {
  const periodos = adendas
    .filter((a) => a.activo !== 0 && a.activo !== false && COBERTURAN.has(a.estado) && a.fecha_inicio && a.fecha_fin)
    .map((a) => ({ adenda_id: a.adenda_id, numero: Number(a.numero), inicio: aDia(a.fecha_inicio), fin: aDia(a.fecha_fin) }))
    .sort((x, y) => x.inicio - y.inicio || x.numero - y.numero);

  const tramos = [];
  let tope = null; // periodo con el mayor fin visto hasta ahora
  for (const p of periodos) {
    if (tope) {
      const hueco = p.inicio - tope.fin - 1;
      const t = { anterior: tope.numero, siguiente: p.numero };
      if (hueco > 0) tramos.push({ ...t, tipo: 'BRECHA', dias: hueco, desde: diaIso(tope.fin + 1), hasta: diaIso(p.inicio - 1) });
      else if (hueco < 0) tramos.push({ ...t, tipo: 'SUPERPOSICION', dias: -hueco, desde: diaIso(p.inicio), hasta: diaIso(Math.min(tope.fin, p.fin)) });
      else tramos.push({ ...t, tipo: 'CONTINUA', dias: 0, desde: null, hasta: null });
    }
    if (!tope || p.fin > tope.fin) tope = p;
  }
  const brechas = tramos.filter((t) => t.tipo === 'BRECHA');
  const superposiciones = tramos.filter((t) => t.tipo === 'SUPERPOSICION');
  return {
    tramos, brechas, superposiciones,
    dias_sin_cobertura: brechas.reduce((s, t) => s + t.dias, 0),
    consistente: superposiciones.length === 0,
  };
}

module.exports = { analizarCobertura };
