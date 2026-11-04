/**
 * OTI Visual — VigenciaTimeline (render DOM/SVG, sin dependencias).
 * Requiere: design-system/tokens.css y ./vigencia-timeline.css cargados en la página.
 *
 *   import { renderVigenciaTimeline } from './vigencia-timeline.js';
 *   const vt = renderVigenciaTimeline(document.getElementById('x'), { data, corte: '2026-11-04' });
 *   vt.update({ data: nuevos });  vt.setModo('adenda');  vt.destroy();
 */
import {
  computeRows, groupRows, summarize, textoBrecha, filasTooltip, STATUS_META,
  fmtCorta, fmtLarga, fromDay, nombreMes,
} from './compute.js';

const NS = 'http://www.w3.org/2000/svg';
const DAY_MS = 864e5;
let instanceSeq = 0;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const svgEl = (tag, attrs, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
};

const STATUS_STYLE = {
  critical: { fill: 'var(--risk-fill)', ink: 'var(--risk-ink)', mark: 'var(--risk)' },
  warn: { fill: 'var(--warn-fill)', ink: 'var(--warn-ink)', mark: 'var(--warn)' },
  ok: { fill: 'var(--ok-fill)', ink: 'var(--ok-ink)', mark: 'var(--ok)' },
  none: { fill: 'var(--neutral-fill)', ink: 'var(--ink-muted)', mark: 'var(--line-strong)' },
};

/**
 * @param {HTMLElement} container
 * @param {import('./vigencia-timeline').VigenciaTimelineOptions} options
 * @returns {import('./vigencia-timeline').VigenciaTimelineInstance}
 */
export function renderVigenciaTimeline(container, options) {
  const uid = `vt${++instanceSeq}`;
  let opts = {
    titulo: 'Vigencia contractual vs. término probable del plan',
    modo: 'firmada',
    umbralAtencion: -7,
    etiquetaFila: 'contratos',
    tooltip: 'completo',
    mostrarBrecha: true, // false: sin columna BRECHA (insignias) y el gráfico ocupa todo el ancho
    mostrarHistorial: false, // true: adendas concluidas en gris antes de la vigencia actual y días sin cobertura en rojo
    ejeDesde: null, // 'AAAA-MM-DD': el eje arranca en esta fecha si es anterior a los datos (p. ej. con el historial)
    mostrarTerminoProbable: true, // false: sin la marca del término probable (leyenda, gráfico, eje y tabla)
    tramoSinCobertura: true, // false: sin el tramo rayado entre el fin de vigencia y el término probable
    anchoEtiqueta: 76, // ancho (unidades del gráfico) de la columna de nombres de fila; subir si se usan etiquetas largas
    ...options,
  };

  container.classList.add('vt');
  container.innerHTML = `
    <div class="vt-head">
      <div>
        <h2 class="vt-title" id="${uid}-t"></h2>
        <p class="vt-sub" id="${uid}-s"></p>
      </div>
      <div class="vt-seg" role="group" aria-label="Calcular brecha contra">
        <button type="button" data-modo="firmada">Solo firmadas</button>
        <button type="button" data-modo="adenda">Con adendas en trámite</button>
      </div>
    </div>
    <div class="vt-kpis"></div>
    <div class="vt-legend" aria-hidden="true">
      <span><i class="vt-sw vt-sw-bar"></i>Vigencia firmada</span>
      <span><i class="vt-sw vt-sw-pend"></i>Adenda en trámite</span>
      <span class="vt-leg-gap"><i class="vt-sw vt-sw-gap"></i>Días sin cobertura</span>
      <span class="vt-leg-hist"><i class="vt-sw vt-sw-hist"></i>Adenda concluida</span>
      <span class="vt-leg-hueco"><i class="vt-sw vt-sw-hueco"></i>Días sin cobertura (historial)</span>
      <span class="vt-leg-prob"><i class="vt-sw vt-sw-mk"></i>Término probable del plan</span>
      <span><i class="vt-sw vt-sw-today"></i>Fecha de corte</span>
    </div>
    <div class="vt-scroll"><svg class="vt-svg" role="img" aria-labelledby="${uid}-t ${uid}-s"></svg></div>
    <div class="vt-foot">
      <span class="vt-foot-nota">Brecha = fin de vigencia − término probable. Negativa: el plan termina después de la vigencia.</span>
      <button type="button" class="vt-tbl-toggle" aria-expanded="false" aria-controls="${uid}-tbl">Ver como tabla</button>
    </div>
    <div class="vt-tbl" id="${uid}-tbl" hidden></div>
    <div class="vt-tip" role="tooltip"></div>`;

  const $ = (s) => container.querySelector(s);
  const svg = $('.vt-svg');
  const tip = $('.vt-tip');
  const segButtons = [...container.querySelectorAll('.vt-seg button')];
  const tblBtn = $('.vt-tbl-toggle');

  const onSeg = (e) => { const m = e.currentTarget.dataset.modo; setModo(m); opts.onModoChange?.(m); };
  segButtons.forEach((b) => b.addEventListener('click', onSeg));
  const onTbl = () => {
    const t = $('.vt-tbl'); const open = t.hidden;
    t.hidden = !open; tblBtn.setAttribute('aria-expanded', String(open));
    tblBtn.textContent = open ? 'Ocultar tabla' : 'Ver como tabla';
  };
  tblBtn.addEventListener('click', onTbl);

  function render() {
    const { data, corte, modo, umbralAtencion } = opts;
    const rows = computeRows(data, { corte, modo, umbralAtencion });
    const groups = groupRows(rows);
    const sum = summarize(rows, corte);
    const corteDay = toCorte(corte);

    segButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modo === modo)));
    container.querySelector('.vt-leg-prob').style.display = opts.mostrarTerminoProbable === false ? 'none' : '';
    container.querySelector('.vt-leg-hist').style.display = opts.mostrarHistorial ? '' : 'none';
    container.querySelector('.vt-leg-hueco').style.display = opts.mostrarHistorial ? '' : 'none';
    container.querySelector('.vt-leg-gap').style.display = opts.tramoSinCobertura === false ? 'none' : '';
    container.querySelector('.vt-foot-nota').style.visibility = opts.mostrarBrecha === false ? 'hidden' : '';
    $('.vt-title').textContent = opts.titulo;
    $('.vt-sub').textContent = `Corte al ${fmtLarga(corteDay)} · ${sum.total} ${opts.etiquetaFila} · ${opts.mostrarBrecha === false ? '' : 'brecha calculada '}${modo === 'firmada' ? 'solo con adendas firmadas' : 'asumiendo que se firman las adendas en trámite'}`;

    // KPIs
    const showPlazo = modo === 'firmada' && sum.plazoAdenda != null && sum.count.critical > 0;
    const kpis = [
      ['critical', sum.count.critical ? `Dependen de adenda${showPlazo ? ` · firmar antes del ${fmtCorta(sum.plazoAdenda)} (${sum.diasPlazoAdenda} días)` : ''}` : 'Ningún registro en riesgo'],
      ['warn', `El plan excede la vigencia en ≤ ${Math.abs(umbralAtencion)} días`],
      ['ok', 'El plan termina dentro de la vigencia'],
      ['none', 'Falta registrar avance del plan'],
    ];
    $('.vt-kpis').innerHTML = kpis.map(([k, d]) => `
      <div class="vt-kpi${k === 'critical' && sum.count.critical ? ' is-critical' : ''}">
        <div class="vt-kpi-n"><span class="vt-dot vt-dot-${k}" aria-hidden="true"></span>${sum.count[k]}</div>
        <div class="vt-kpi-t">${STATUS_META[k].titulo}</div>
        <div class="vt-kpi-d">${esc(d)}</div>
      </div>`).join('');

    drawChart(groups, corteDay, modo, showPlazo ? sum : null);
    drawTable(groups);
  }

  function toCorte(iso) { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY_MS; }

  function drawChart(groups, corte, modo, plazo) {
    const conBrecha = opts.mostrarBrecha !== false;
    const W = 1060, L = opts.anchoEtiqueta ?? 76, R = conBrecha ? 868 : 1036, BX = 888, BW = 160, AX = 56, RH = 34, GH = 30;
    const rows = groups.flatMap((g) => g.rows);
    svg.innerHTML = '';
    if (!rows.length) { svg.setAttribute('viewBox', `0 0 ${W} 60`); const t = svgEl('text', { x: 16, y: 34, class: 'vt-t-muted' }, svg); t.textContent = 'Sin registros para mostrar.'; return; }

    const conHist = !!opts.mostrarHistorial;
    const days = rows.flatMap((r) => [r.ini, r.fin, r.ad, opts.mostrarTerminoProbable === false ? null : r.prob,
      ...(conHist ? [...r.hist.flatMap((h) => [h.ini, h.fin]), ...r.brechas.flatMap((t) => [t.ini, t.fin])] : [])]).filter((v) => v != null).concat(corte);
    const desde = conHist && opts.ejeDesde ? toCorte(opts.ejeDesde) : null;
    const x0 = desde != null ? Math.min(desde, Math.min(...days)) : Math.min(...days) - 3, x1 = Math.max(...days) + 4;
    const sx = (v) => L + ((v - x0) / (x1 - x0)) * (R - L);
    const H = AX + groups.reduce((s, g) => s + GH + g.rows.length * RH, 0) + 12;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const pat = svgEl('pattern', { id: `${uid}-hatch`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(135)' }, svgEl('defs', {}, svg));
    svgEl('rect', { width: 6, height: 6, style: 'fill:var(--risk-fill)' }, pat);
    svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 6, style: 'stroke:var(--risk);stroke-width:2' }, pat);

    // Eje: bandas de mes, ticks 1/8/15/22
    const g0 = svgEl('g', {}, svg);
    const t0 = fromDay(x0);
    let m = Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), 1) / DAY_MS;
    for (let i = 0; m < x1; i++) {
      const t = fromDay(m), next = Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1) / DAY_MS;
      const a = Math.max(sx(m), L), b = Math.min(sx(next), R);
      if (i % 2 === 1) svgEl('rect', { x: a, y: AX - 8, width: b - a, height: H - AX, style: 'fill:var(--surface-band)' }, g0);
      if (m >= x0) {
        svgEl('line', { x1: sx(m), x2: sx(m), y1: AX - 30, y2: H - 4, style: 'stroke:var(--line-strong)' }, g0);
        svgEl('text', { x: sx(m) + 3, y: AX - 14, class: 'vt-t-axis' }, g0).textContent = '1';
      }
      if (b - a > 60) svgEl('text', { x: a + 8, y: AX - 34, class: 'vt-t-month' }, g0).textContent = `${nombreMes(t.getUTCMonth()).toUpperCase()} ${t.getUTCFullYear()}`;
      for (const dd of [8, 15, 22]) {
        const v = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), dd) / DAY_MS;
        if (v > x0 && v < x1) {
          svgEl('line', { x1: sx(v), x2: sx(v), y1: AX - 8, y2: H - 4, style: 'stroke:var(--line)' }, g0);
          svgEl('text', { x: sx(v), y: AX - 14, 'text-anchor': 'middle', class: 'vt-t-axis' }, g0).textContent = dd;
        }
      }
      m = next;
    }
    if (conBrecha) svgEl('text', { x: BX, y: AX - 14, class: 'vt-t-colhead' }, svg).textContent = 'BRECHA';

    const onTop = [];
    let y = AX;
    for (const g of groups) {
      const S = STATUS_STYLE[g.key];
      svgEl('line', { x1: 8, x2: W - 8, y1: y + GH - 2, y2: y + GH - 2, style: 'stroke:var(--line-strong)' }, svg);
      svgEl('circle', { cx: 16, cy: y + GH / 2, r: 4.5, style: `fill:${S.mark}` }, svg);
      const gt = svgEl('text', { x: 28, y: y + GH / 2 + 4, class: 'vt-t-group' }, svg);
      gt.textContent = `${STATUS_META[g.key].titulo.toUpperCase()} · ${g.rows.length}`;
      if (g.key === 'critical' && plazo) {
        const nt = svgEl('text', { x: 28 + gt.getComputedTextLength() + 12, y: y + GH / 2 + 4, class: 'vt-t-alert' }, svg);
        nt.textContent = `Firmar adendas antes del ${fmtCorta(plazo.plazoAdenda)} — quedan ${plazo.diasPlazoAdenda} días`;
        onTop.push(nt);
      }
      y += GH;

      for (const r of g.rows) {
        const cy = y + RH / 2, bh = 14, by = cy - bh / 2;
        const hit = svgEl('rect', { class: 'vt-row-hit', x: 8, y, width: W - 16, height: RH, rx: 6, tabindex: 0, 'aria-label': `${r.etiqueta ?? r.id}: ${textoBrecha(r.brecha)}` }, svg);
        svgEl('line', { x1: 8, x2: W - 8, y1: y + RH, y2: y + RH, style: 'stroke:var(--line)' }, svg);
        const conNota = r.porIniciar && r.etiqueta != null; // con nombre largo, la nota va debajo
        svgEl('text', { x: 16, y: cy + (conNota ? -1 : 4.5), class: 'vt-t-code' }, svg).textContent = r.etiqueta ?? r.id;
        if (r.porIniciar) svgEl('text', { x: conNota ? 16 : 48, y: cy + (conNota ? 11 : 4), class: 'vt-t-note' }, svg).textContent = 'por iniciar';

        const sg = svgEl('g', { style: 'pointer-events:none' }, svg);
        if (conHist) {
          for (const h of r.hist) svgEl('rect', { x: sx(h.ini), y: by, width: Math.max(sx(h.fin) - sx(h.ini), 2), height: bh, rx: 4, style: 'fill:var(--vt-hist-fill);stroke:var(--vt-hist-stroke);stroke-width:1.25' }, sg);
          for (const t of r.superposiciones) svgEl('rect', { x: sx(t.ini), y: by - 3, width: Math.max(sx(t.fin) - sx(t.ini), 3), height: bh + 6, rx: 3, style: 'fill:var(--pending-fill);stroke:var(--pending);stroke-width:1.5;opacity:.9' }, sg);
          for (const t of r.brechas) svgEl('rect', { x: sx(t.ini - 1), y: by - 3, width: Math.max(sx(t.fin + 1) - sx(t.ini - 1), 4), height: bh + 6, rx: 3, style: 'fill:var(--risk);stroke:var(--risk);stroke-width:1.25' }, sg);
        }
        if (r.ad != null && r.ad > r.fin) {
          svgEl('rect', { x: sx(r.fin), y: by, width: sx(r.ad) - sx(r.fin), height: bh, rx: 4,
            style: `fill:var(--pending-fill);stroke:var(--pending);stroke-width:1.25${modo === 'adenda' ? '' : ';stroke-dasharray:4 3'}` }, sg);
        }
        svgEl('rect', { x: sx(r.ini), y: by, width: Math.max(sx(r.fin) - sx(r.ini), 2), height: bh, rx: 4, style: 'fill:var(--bar-fill);stroke:var(--bar-stroke);stroke-width:1.25' }, sg);
        if (opts.tramoSinCobertura !== false && r.prob != null && r.prob > r.end) {
          svgEl('rect', { x: sx(r.end), y: by - 2, width: Math.max(sx(r.prob) - sx(r.end), 4), height: bh + 4, rx: 3, style: `fill:url(#${uid}-hatch);stroke:var(--risk);stroke-width:1.25` }, sg);
        }
        if (r.prob != null && opts.mostrarTerminoProbable !== false) {
          svgEl('rect', { x: sx(r.prob) - 3.5, y: cy - 12, width: 7, height: 24, rx: 3.5, style: 'fill:var(--surface)' }, sg);
          svgEl('rect', { x: sx(r.prob) - 2, y: cy - 10.5, width: 4, height: 21, rx: 2, style: 'fill:var(--marker)' }, sg);
        }

        if (conBrecha) {
          const bg = svgEl('rect', { x: BX, y: cy - 11, height: 22, rx: 11, style: `fill:${S.fill};pointer-events:none` }, svg);
          const bt = svgEl('text', { x: BX + 10, y: cy + 4, class: 'vt-t-badge', style: `fill:${S.ink}` }, svg);
          bt.textContent = `${STATUS_META[g.key].icono}  ${textoBrecha(r.brecha)}`;
          bg.setAttribute('width', Math.min(bt.getComputedTextLength() + 20, BW));
        }

        const show = (cx, cyy) => {
          const breve = opts.tooltip === 'vigencia'; // solo vigencia (y adenda si la hay): sin brecha ni término probable
          tip.innerHTML = `<b>${esc(r.id)}</b>${r.descripcion ? ` · ${esc(r.descripcion)}` : ''}${breve ? '' : `<br><span style="color:${S.ink};font-weight:600">${esc(textoBrecha(r.brecha))}</span>`}<dl>
            ${filasTooltip(r, { modo, detalle: opts.tooltip, historial: conHist }).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('\n            ')}
          </dl>`;
          const p = 14, w = tip.offsetWidth, h = tip.offsetHeight;
          let lx = cx + p, ly = cyy + p;
          if (lx + w > innerWidth - 8) lx = cx - w - p;
          if (ly + h > innerHeight - 8) ly = cyy - h - p;
          tip.style.left = `${lx}px`; tip.style.top = `${ly}px`; tip.classList.add('is-on');
        };
        hit.addEventListener('mousemove', (e) => show(e.clientX, e.clientY));
        hit.addEventListener('focus', () => { const b = hit.getBoundingClientRect(); show(b.left + b.width / 2, b.top); });
        hit.addEventListener('mouseleave', () => tip.classList.remove('is-on'));
        hit.addEventListener('blur', () => tip.classList.remove('is-on'));
        if (opts.onRowClick) hit.addEventListener('click', () => opts.onRowClick(r));
        y += RH;
      }
    }

    // Línea de corte encima de las barras, con píldora en la fila de ticks
    const cx = sx(corte);
    svgEl('line', { x1: cx, x2: cx, y1: AX - 8, y2: H - 4, style: 'stroke:var(--today);stroke-width:2;pointer-events:none' }, svg);
    const cover = svgEl('rect', { y: AX - 28, height: 20, style: 'fill:var(--surface)' }, svg);
    const pill = svgEl('rect', { y: AX - 27, height: 18, rx: 9, style: 'fill:var(--today)' }, svg);
    const lt = svgEl('text', { x: cx, y: AX - 14, 'text-anchor': 'middle', class: 'vt-t-today' }, svg);
    lt.textContent = `Corte ${fmtCorta(corte)}`;
    const lw = lt.getComputedTextLength() + 14;
    pill.setAttribute('x', cx - lw / 2); pill.setAttribute('width', lw);
    cover.setAttribute('x', cx - lw / 2 - 6); cover.setAttribute('width', lw + 12);
    for (const t of onTop) {
      const b = t.getBBox();
      svgEl('rect', { x: b.x - 4, y: b.y - 1, width: b.width + 8, height: b.height + 2, rx: 4, style: 'fill:var(--surface)' }, svg);
      svg.appendChild(t);
    }
  }

  function drawTable(groups) {
    const rows = groups.flatMap((g) => g.rows);
    const conBrecha = opts.mostrarBrecha !== false;
    const conNombre = rows.some((r) => r.etiqueta != null);
    $('.vt-tbl').innerHTML = `<table><thead><tr><th>${conNombre ? 'Profesional' : 'Código'}</th><th>Estado</th><th>Inicio</th><th>Fin firmado</th><th>Adenda en trámite</th>${opts.mostrarTerminoProbable === false ? '' : '<th>Término probable</th>'}${conBrecha ? '<th>Brecha (d)</th>' : ''}</tr></thead><tbody>${
      rows.map((r) => `<tr><td><b>${esc(r.etiqueta ?? r.id)}</b></td><td>${STATUS_META[r.status].titulo}</td><td>${fmtLarga(r.ini)}</td><td>${fmtLarga(r.fin)}</td><td>${r.ad != null ? fmtLarga(r.ad) : '—'}</td>${opts.mostrarTerminoProbable === false ? '' : `<td>${r.prob != null ? fmtLarga(r.prob) : '—'}</td>`}${conBrecha ? `<td>${r.brecha == null ? '—' : (r.brecha > 0 ? '+' : '') + r.brecha}</td>` : ''}</tr>`).join('')
    }</tbody></table>`;
  }

  function setModo(m) { if (m !== 'firmada' && m !== 'adenda') return; opts = { ...opts, modo: m }; render(); }
  function update(patch) { opts = { ...opts, ...patch }; render(); }
  function destroy() {
    segButtons.forEach((b) => b.removeEventListener('click', onSeg));
    tblBtn.removeEventListener('click', onTbl);
    container.innerHTML = ''; container.classList.remove('vt');
  }

  // Inter puede llegar tarde: medir texto después de cargar fuentes
  (document.fonts?.ready ?? Promise.resolve()).then(render);
  return { update, setModo, destroy, getModo: () => opts.modo };
}
