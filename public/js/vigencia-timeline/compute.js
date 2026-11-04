/**
 * OTI Visual — VigenciaTimeline: lógica pura (sin DOM). Testeable con `node --test`.
 *
 * Brecha = fin de vigencia efectiva − término probable (días calendario).
 *   < umbralAtencion  → 'critical'  (sin cobertura)
 *   umbralAtencion..-1 → 'warn'     (desfase menor)
 *   >= 0              → 'ok'        (en plazo)
 *   sin término       → 'none'      (sin dato)
 * Vigencia efectiva: `fin` en modo 'firmada'; `adenda ?? fin` en modo 'adenda'.
 */

export const STATUS_ORDER = ['critical', 'warn', 'ok', 'none'];

export const STATUS_META = {
  critical: { titulo: 'Sin cobertura', icono: '▲' },
  warn: { titulo: 'Desfase menor', icono: '●' },
  ok: { titulo: 'En plazo', icono: '✓' },
  none: { titulo: 'Sin término probable', icono: '–' },
};

const DAY_MS = 864e5;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'AAAA-MM-DD' → número de día UTC (entero). Lanza error si el formato es inválido. */
export function toDay(iso) {
  const m = ISO.exec(iso ?? '');
  if (!m) throw new Error(`Fecha inválida: ${JSON.stringify(iso)} (se espera AAAA-MM-DD)`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS;
}
const optDay = (v) => (v == null || v === '' ? null : toDay(v));

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
const pad = (n) => String(n).padStart(2, '0');
export const fromDay = (n) => new Date(n * DAY_MS);
/** 04 nov */
export const fmtCorta = (n) => { const t = fromDay(n); return `${pad(t.getUTCDate())} ${MES[t.getUTCMonth()]}`; };
/** 04/11/2026 */
export const fmtLarga = (n) => { const t = fromDay(n); return `${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`; };
export const nombreMes = (i) => MES[i];

/** Texto de la insignia: la consecuencia, nunca el signo solo. */
export function textoBrecha(brecha) {
  if (brecha == null) return 'Sin dato';
  if (brecha < 0) return `${Math.abs(brecha)} d sin cobertura`;
  if (brecha === 0) return 'Justo al cierre';
  return `+${brecha} d de margen`;
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Filas [etiqueta, valor] del tooltip de una fila ya calculada (lógica pura, sin DOM).
 *   detalle 'completo' (por defecto): inicio, fin firmado, adenda, término probable y días para firmar.
 *   detalle 'vigencia': solo inicio y fin de vigencia; si hay una adenda que amplía la vigencia, añade su
 *   vencimiento y, solo en el escenario 'firmada' y mientras la vigencia siga corriendo, el plazo para firmarla.
 */
/** Filas del tooltip con el historial: cada adenda concluida (con plazo otorgado y solicitado) y los huecos o superposiciones. */
export function filasHistorial(r) {
  const filas = r.hist.map((h) => [
    `Adenda ${pad(h.numero)}`,
    `${fmtLarga(h.ini)} – ${fmtLarga(h.fin)}${h.plazoDias != null ? ` · ${plural(h.plazoDias, 'día', 'días')}` : ''}${h.plazoSolicitadoDias != null && h.plazoSolicitadoDias !== h.plazoDias ? ` (solicitados ${h.plazoSolicitadoDias})` : ''}`,
  ]);
  for (const b of r.brechas) filas.push(['Sin cobertura', `${plural(b.dias, 'día', 'días')} (${fmtLarga(b.ini)} – ${fmtLarga(b.fin)})`]);
  for (const s of r.superposiciones) filas.push(['Superposición', `${plural(s.dias, 'día', 'días')} (${fmtLarga(s.ini)} – ${fmtLarga(s.fin)}): revisar fechas`]);
  return filas;
}

export function filasTooltip(r, { modo = 'firmada', detalle = 'completo', historial = false } = {}) {
  const firmable = modo === 'firmada' && r.diasParaFirmarAdenda != null;
  if (detalle === 'vigencia') {
    const filas = [];
    if (historial) filas.push(...filasHistorial(r));
    filas.push(['Inicio', fmtLarga(r.ini)], ['Fin de vigencia', fmtLarga(r.fin)]);
    if (r.ad != null && r.ad > r.fin) {
      filas.push(['Vencimiento de la adenda', fmtLarga(r.ad)]);
      if (firmable) filas.push(['Plazo para firmar la adenda', plural(r.diasParaFirmarAdenda, 'día', 'días')]);
    }
    return filas;
  }
  return [
    ...(historial ? filasHistorial(r) : []),
    ['Inicio', fmtLarga(r.ini)],
    ['Fin vigencia firmada', fmtLarga(r.fin)],
    ...(r.ad != null ? [['Adenda en trámite hasta', fmtLarga(r.ad)]] : []),
    ['Término probable', r.prob != null ? fmtLarga(r.prob) : '—'],
    ...(firmable ? [['Días para firmar adenda', String(r.diasParaFirmarAdenda)]] : []),
  ];
}

/**
 * @param {import('./vigencia-timeline').ContratoVigencia[]} data
 * @param {{ corte: string, modo?: 'firmada'|'adenda', umbralAtencion?: number }} opts
 */
export function computeRows(data, { corte, modo = 'firmada', umbralAtencion = -7 }) {
  const c = toDay(corte);
  return data.map((r) => {
    const ini = toDay(r.inicio);
    const fin = toDay(r.fin);
    const ad = optDay(r.adenda);
    const prob = optDay(r.terminoProbable);
    if (fin < ini) throw new Error(`${r.id}: fin anterior al inicio`);
    const end = modo === 'adenda' && ad != null ? ad : fin;
    const brecha = prob == null ? null : end - prob;
    const tramo = (t) => ({ ...t, ini: toDay(t.inicio), fin: toDay(t.fin) });
    const hist = (r.historial || []).map((h) => ({ numero: h.numero, ini: toDay(h.inicio), fin: toDay(h.fin), plazoDias: h.plazoDias ?? null, plazoSolicitadoDias: h.plazoSolicitadoDias ?? null }));
    const status = brecha == null ? 'none' : brecha < umbralAtencion ? 'critical' : brecha < 0 ? 'warn' : 'ok';
    return {
      ...r, ini, fin, ad, prob, end, brecha, status, hist,
      brechas: (r.brechas || []).map(tramo), superposiciones: (r.superposiciones || []).map(tramo),
      porIniciar: ini > c,
      diasParaFirmarAdenda: ad != null && fin > c ? fin - c : null,
    };
  });
}

/** Agrupa por estado (orden fijo) y ordena cada grupo por brecha ascendente, luego por id. */
export function groupRows(rows) {
  return STATUS_ORDER.map((key) => ({
    key,
    rows: rows
      .filter((r) => r.status === key)
      .sort((a, b) => (a.brecha ?? 0) - (b.brecha ?? 0) || String(a.id).localeCompare(String(b.id))),
  })).filter((g) => g.rows.length);
}

/** Resumen para la fila KPI. `plazoAdenda` = fecha más próxima en que vence una vigencia con adenda pendiente. */
export function summarize(rows, corte) {
  const c = toDay(corte);
  const count = Object.fromEntries(STATUS_ORDER.map((k) => [k, rows.filter((r) => r.status === k).length]));
  const pend = rows.filter((r) => r.ad != null && r.fin > c).map((r) => r.fin);
  const plazoAdenda = pend.length ? Math.min(...pend) : null;
  return { total: rows.length, count, plazoAdenda, diasPlazoAdenda: plazoAdenda == null ? null : plazoAdenda - c };
}
