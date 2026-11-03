import { api, esc, ff, pct, titulo, badge, puede, aviso, fallo, modal } from '../util.js';

export async function vistaLineaBase(el) {
  const lb = await api('GET', '/linea-base');
  titulo('Línea base 2026', 'Entregables del cronograma Gestiona Forestal 2026 v3 (corte 17/08/2026) y su cobertura por los planes vigentes');
  const n = (c) => lb.filter((x) => x.cobertura === c).length;
  el.innerHTML = `
  <div class="kpis">
    <div class="tarjeta kpi"><div class="v num">${lb.length}</div><div class="e">Entregables en línea base</div></div>
    <div class="tarjeta kpi verde"><div class="v num">${n('CONCLUIDO')}</div><div class="e">Concluidos al corte de la línea base</div></div>
    <div class="tarjeta kpi"><div class="v num">${n('CUBIERTO')}</div><div class="e">Pendientes cubiertos por un plan</div></div>
    <div class="tarjeta kpi rojo"><div class="v num">${n('NO_CUBIERTO')}</div><div class="e">Pendientes sin actividad en ningún plan</div></div>
  </div>
  <div class="tarjeta"><div class="cab"><h2>Entregables</h2><div class="filtros">
    <select id="f-cob"><option value="">Toda cobertura</option><option value="NO_CUBIERTO">No cubierto</option><option value="CUBIERTO">Cubierto</option><option value="CONCLUIDO">Concluido</option></select>
    <select id="f-cla"><option value="">Todos los profesionales</option>${[...new Set(lb.map((x) => x.clave))].map((c) => `<option>${esc(c)}</option>`).join('')}</select></div></div>
    <div class="cuerpo sin tabla-env"><table><thead><tr><th>EDT</th><th>Profesional</th><th>Entregable</th><th>Inicio LB</th><th>Fin LB</th><th class="d">Avance LB</th><th>Cobertura</th><th>Actividades del plan</th><th>Situación</th><th></th></tr></thead><tbody id="cuerpo"></tbody></table></div></div>`;
  const pintar = () => {
    const cob = el.querySelector('#f-cob').value; const cla = el.querySelector('#f-cla').value;
    el.querySelector('#cuerpo').innerHTML = lb.filter((x) => (!cob || x.cobertura === cob) && (!cla || x.clave === cla)).map((x) => `<tr>
      <td class="num">${esc(x.edt)}</td><td><a href="#/consultor/${x.consultor_id}">${esc(x.clave)}</a></td><td class="desc">${esc(x.nombre)}</td>
      <td class="num">${ff(x.inicio_lb)}</td><td class="num">${ff(x.fin_lb)}</td><td class="d num">${pct(x.avance_corte)}</td><td>${badge(x.cobertura)}</td>
      <td class="mut2">${x.actividades.map((a) => esc(a.numero)).join(', ') || '—'}</td>
      <td class="mut2 desc">${esc(x.situacion || '')}${x.situacion_oti ? `<br><b>OTI:</b> ${esc(x.situacion_oti)}` : ''}</td>
      <td>${puede('EDITOR') ? `<button class="btn peq" data-lb="${x.entregable_id}">Anotar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="10" class="vacio">Sin resultados</td></tr>';
    el.querySelectorAll('[data-lb]').forEach((b) => { b.onclick = () => anotar(lb.find((x) => x.entregable_id === Number(b.dataset.lb))); });
  };
  el.querySelector('#f-cob').onchange = pintar;
  el.querySelector('#f-cla').onchange = pintar;
  pintar();
}

async function anotar(x) {
  const r = await modal({
    titulo: `Entregable ${x.edt}`,
    contenido: `<p class="mut" style="margin:0">${esc(x.nombre)}</p>
      <div class="campo"><label>Situación registrada por la OTI</label><textarea name="situacion_oti">${esc(x.situacion_oti || '')}</textarea></div>
      <div class="campo"><label>Avance al corte de la línea base (%)</label><input type="number" min="0" max="100" name="avance_corte" value="${Number(x.avance_corte)}"></div>
      <div class="campo"><label>Motivo</label><input name="motivo" placeholder="Ej.: Declarado fuera de alcance 2026 en informe situacional"></div>`,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Guardar', clase: 'prim', valor: 'ok' }],
  });
  if (r.valor !== 'ok') return;
  try { await api('PATCH', `/linea-base/${x.entregable_id}`, { ...r.datos, avance_corte: Number(r.datos.avance_corte), revision: x.revision }); aviso('Entregable actualizado', 'exito'); window.sgfRefrescar(); } catch (err) { fallo(err); }
}
