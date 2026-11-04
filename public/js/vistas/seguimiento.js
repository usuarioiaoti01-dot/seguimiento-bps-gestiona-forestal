import { api, estado, esc, ff, titulo, badge, semaforo, diasBadge, holguraBadge, barraAvance, puede, aviso, fallo } from '../util.js';
import { abrirCargaDocumento } from './carga-documento.js';

const POR_PAGINA = 5; // profesionales por página en la tabla

// Filtros a los que llevan las tarjetas del Gestión Adendas (mismos criterios de los indicadores del servidor).
const FILTROS = {
  atrasadas: { texto: 'con actividades atrasadas o sin iniciar vencidas', fn: (c) => c.atrasadas > 0 },
  exceden: { texto: 'cuyo término probable excede la vigencia', fn: (c) => c.vigencia.holgura_dias !== null && c.vigencia.holgura_dias < 0 },
};

/** Seguimiento Actividades: la tabla de profesionales (con filtro opcional por la ruta #/seguimiento/atrasadas|exceden). */
export async function vistaSeguimiento(el, [clave = '']) {
  const q = estado.corte ? `?corte=${estado.corte}` : '';
  const e = await api('GET', `/estado${q}`);
  if (!estado.corte) { const c = document.getElementById('corte'); if (c && !c.value) c.value = e.corte; }
  titulo('SEGUIMIENTO ACTIVIDADES', '');

  const k = e.indicadores;
  const num = (n) => Number(n).toLocaleString('es-PE', { maximumFractionDigits: 1 });
  const todosAprobados = k.consultores > 0 && k.planes_aprobados === k.consultores;
  el.innerHTML = `
  <div class="kpis">
    <div class="tarjeta kpi"><span class="t">PORCENTAJE DE AVANCE</span><span class="v num">${num(k.avance_ponderado)}%</span><span class="e">de todos los profesionales (esperado ${num(k.avance_esperado)}%)</span></div>
    <div class="tarjeta kpi ${k.dias_atraso ? 'rojo' : 'verde'}"><span class="t">DÍAS DE ATRASO</span><span class="v num">${num(k.dias_atraso)}</span><span class="e">acumulados en ${num(k.actividades_vencidas)} actividades vencidas sin concluir</span></div>
    <div class="tarjeta kpi ${k.actividades_sin_inicio ? 'ambar' : 'verde'}"><span class="t">ACTIVIDADES SIN INICIO</span><span class="v num">${num(k.actividades_sin_inicio)}</span><span class="e">sin iniciar o sin avance registrado</span></div>
    <div class="tarjeta kpi ${todosAprobados ? 'verde' : 'rojo'}"><span class="t">PLAN APROBADO</span><span class="v texto">${todosAprobados ? 'PLAN APROBADO' : 'NO TIENE PLAN APROBADO'}</span><span class="e">${num(k.planes_aprobados)} de ${num(k.consultores)} profesionales con plan aprobado</span></div>
  </div>
  <div class="tarjeta" id="profesionales">
    <div class="cab"><h2>PROFESIONALES</h2><div class="acciones">
      ${puede('EDITOR') ? '<button class="btn peq prim" id="b-cargar">Cargar documento</button>' : ''}
      <a class="btn peq" href="/api/exportar/actividades.csv">Exportar actividades (CSV)</a>
      ${puede('EDITOR') ? '<button class="btn peq" id="b-recalc">Recalcular y guardar corte</button>' : ''}</div></div>
    <div id="filtro" class="filtro-activo" hidden></div>
    <div class="cuerpo sin tabla-env"><table>
      <thead><tr><th></th><th>Profesional</th><th>Vigencia</th><th>Restan</th><th>Fin plan</th><th>Término probable</th><th>Holgura</th><th>Avance</th></tr></thead>
      <tbody id="tbody"></tbody></table></div>
    <div id="paginador" class="paginador" hidden></div>
  </div>`;

  const fila = (c) => {
    const v = c.vigencia; const p = c.pronostico;
    return `<tr class="clic" data-id="${c.consultor_id}">
      <td>${semaforo(v.semaforo)}</td>
      <td><b>${esc(c.nombres)}</b> <span class="mut2">${esc(c.clave)}</span><br><span class="mut2">${esc(c.perfil || '')}</span></td>
      <td class="num">${v.adenda_vigente ? `Ad. ${String(v.adenda_vigente.numero).padStart(2, '0')} · ${ff(v.fin_vigencia)}` : '—'}</td>
      <td>${diasBadge(v.dias_restantes)}</td>
      <td class="num">${p && p.fin_plan ? ff(p.fin_plan) : badge(c.plan ? c.plan.estado : 'POR_REGISTRAR')}</td>
      <td class="num"><b>${p && p.fin_probable ? ff(p.fin_probable) : '—'}</b>${c.atrasadas ? `<br><span class="mut2">${c.atrasadas} act. atrasadas</span>` : ''}</td>
      <td>${holguraBadge(v.holgura_dias)}</td>
      <td>${p && p.numero_actividades ? barraAvance(p.avance_ponderado, p.avance_esperado) : '<span class="mut2">—</span>'}</td></tr>`;
  };
  const tbody = el.querySelector('#tbody');
  const caja = el.querySelector('#filtro');
  const paginador = el.querySelector('#paginador');
  const pintarTabla = (clave2, pagina = 1) => {
    const f = FILTROS[clave2];
    const lista = f ? e.consultores.filter(f.fn) : e.consultores;
    const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
    const n = Math.min(Math.max(pagina, 1), paginas);
    const desde = (n - 1) * POR_PAGINA;
    const visibles = lista.slice(desde, desde + POR_PAGINA);
    tbody.innerHTML = visibles.length ? visibles.map(fila).join('') : '<tr><td colspan="8" class="vacio">Ningún profesional cumple este criterio</td></tr>';
    paginador.hidden = paginas === 1;
    paginador.innerHTML = paginas === 1 ? '' : `<span class="mut2">Profesionales ${desde + 1}–${desde + visibles.length} de ${lista.length}</span><div class="acciones">
      <button type="button" class="btn peq" data-pag="${n - 1}" ${n === 1 ? 'disabled' : ''}>Anterior</button>
      ${Array.from({ length: paginas }, (_, i) => `<button type="button" class="btn peq ${i + 1 === n ? 'prim' : ''}" data-pag="${i + 1}" aria-label="Página ${i + 1}" ${i + 1 === n ? 'aria-current="page"' : ''}>${i + 1}</button>`).join('')}
      <button type="button" class="btn peq" data-pag="${n + 1}" ${n === paginas ? 'disabled' : ''}>Siguiente</button></div>`;
    paginador.querySelectorAll('[data-pag]').forEach((b) => { b.onclick = () => pintarTabla(clave2, Number(b.dataset.pag)); });
    caja.hidden = !f;
    caja.innerHTML = f ? `<span>Mostrando ${lista.length} de ${e.consultores.length} profesionales ${f.texto}.</span><button type="button" class="btn peq" id="b-quitar">Quitar filtro</button>` : '';
    if (f) caja.querySelector('#b-quitar').onclick = () => { location.hash = '#/seguimiento'; };
  };
  pintarTabla(clave);
  tbody.onclick = (ev) => { const tr = ev.target.closest('tr.clic'); if (tr) location.hash = `#/consultor/${tr.dataset.id}`; };

  const bc = el.querySelector('#b-cargar');
  if (bc) bc.onclick = () => abrirCargaDocumento(e.consultores);
  const br = el.querySelector('#b-recalc');
  if (br) br.onclick = async () => { try { await api('POST', '/recalcular', { motivo: 'Recálculo manual desde Seguimiento Actividades' }); aviso('Pronóstico recalculado y guardado', 'exito'); window.sgfRefrescar(); } catch (err) { fallo(err); } };
}
