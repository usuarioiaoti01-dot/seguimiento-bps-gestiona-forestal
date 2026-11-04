import { api, estado, esc, ff, titulo, badge, semaforo, diasBadge, holguraBadge, barraAvance, puede, aviso, fallo, modal } from '../util.js';
import { renderVigenciaTimeline } from '../vigencia-timeline/vigencia-timeline.js';
import { adaptarVigencias } from '../vigencia-adaptador.js';

// El historial completo se dibuja con el eje desde mayo de 2026 (inicio de las primeras adendas).
const EJE_HISTORIAL_DESDE = '2026-05-01';

const POR_PAGINA = 5; // profesionales por página en la tabla

const TITULO = 'TABLERO SEGUIMIENTO ACTIVIDADES DESARROLLO GESTIONA FORESTAL - 2026';

// Filtros de la tabla de profesionales a los que llevan las tarjetas (mismos criterios de los indicadores del servidor).
const FILTROS = {
  atrasadas: { texto: 'con actividades atrasadas o sin iniciar vencidas', fn: (c) => c.atrasadas > 0 },
  exceden: { texto: 'cuyo término probable excede la vigencia', fn: (c) => c.vigencia.holgura_dias !== null && c.vigencia.holgura_dias < 0 },
};

let omitirAlertas = false; // tras "Recalcular" no se vuelve a abrir sola la ventana de alertas

export async function vistaTablero(el) {
  const q = estado.corte ? `?corte=${estado.corte}` : '';
  const e = await api('GET', `/estado${q}`);
  if (!estado.corte) { const c = document.getElementById('corte'); if (c && !c.value) c.value = e.corte; }
  titulo(TITULO, '');
  const k = e.indicadores;

  el.innerHTML = `
  <div class="kpis">
    <button type="button" class="tarjeta kpi kpi-enlace" data-destino="todos"><span class="v num">${k.consultores}</span><span class="e">Profesionales en seguimiento</span></button>
    <button type="button" class="tarjeta kpi kpi-enlace ${k.actividades_atrasadas ? 'ambar' : ''}" data-destino="atrasadas"><span class="v num">${k.actividades_atrasadas}<span class="mut" style="font-size:14px"> / ${k.actividades}</span></span><span class="e">Actividades atrasadas o sin iniciar vencidas</span></button>
    <button type="button" class="tarjeta kpi kpi-enlace ${k.planes_exceden_vigencia ? 'rojo' : 'verde'}" data-destino="exceden"><span class="v num">${k.planes_exceden_vigencia}</span><span class="e">Planes cuyo término probable excede la vigencia</span></button>
    <button type="button" class="tarjeta kpi kpi-enlace" data-destino="todos"><span class="v num">${k.avance_ponderado}%</span><span class="e">Avance registrado (esperado ${k.avance_esperado}%)</span></button>
  </div>
  ${k.avance_ponderado === 0 && k.avance_esperado > 0 ? `<div class="tarjeta"><div class="cuerpo" style="display:flex;gap:10px;align-items:center">${badge('MEDIA', 'Importante')}<span>No hay avance registrado en ninguna actividad: el pronóstico asume que lo vencido no se ejecutó. Registre el avance real en cada ficha para obtener fechas probables confiables.</span></div></div>` : ''}
  <div class="filtro-grafico" role="group" aria-label="Periodo del gráfico de vigencia">
    <button type="button" class="btn peq" data-historial="0" aria-pressed="true">Vigencia actual</button>
    <button type="button" class="btn peq" data-historial="1" aria-pressed="false">Historial completo</button>
  </div>
  <div id="vigencias"></div>
  <p id="vig-nota" class="mut2" hidden></p>
  <div class="tarjeta" id="profesionales">
      <div class="cab"><h2>PROFESIONALES</h2><div class="acciones">
        <a class="btn peq" href="/api/exportar/actividades.csv">Exportar actividades (CSV)</a>
        ${puede('EDITOR') ? '<button class="btn peq" id="b-recalc">Recalcular y guardar corte</button>' : ''}</div></div>
      <div id="filtro" class="filtro-activo" hidden></div>
      <div class="cuerpo sin tabla-env"><table>
        <thead><tr><th></th><th>Profesional</th><th>Vigencia</th><th>Restan</th><th>Fin plan</th><th>Término probable</th><th>Holgura</th><th>Avance</th></tr></thead>
        <tbody id="tbody"></tbody></table></div>
      <div id="paginador" class="paginador" hidden></div>
  </div>`;

  // ---- Vigencia vs. término probable (componente VigenciaTimeline del sistema OTI Visual)
  // La brecha es fin de vigencia − término probable; el término probable lo calcula el servidor.
  // umbralAtencion = 0: "sin cobertura" desde 1 día, el mismo criterio del semáforo ROJO del servidor.
  const { datos: vigencias, descartados, consultorPorId } = adaptarVigencias(e.consultores);
  const grafico = renderVigenciaTimeline(el.querySelector('#vigencias'), {
    data: vigencias,
    corte: String(e.corte).slice(0, 10),
    umbralAtencion: 0,
    titulo: 'GESTIÓN DE LAS ADENDAS Y CONTRATOS 2026',
    etiquetaFila: 'profesionales',
    mostrarBrecha: false, // sin la columna BRECHA (insignias)
    mostrarTerminoProbable: false, // el término probable es una estimación: el gráfico muestra solo datos confirmados
    tramoSinCobertura: false, // sin el tramo rojo rayado
    anchoEtiqueta: 170, // espacio para "nombre y primer apellido"
    tooltip: 'vigencia', // al pasar el puntero: solo inicio y fin de vigencia (y adenda con su plazo de firma, si la hay)
    onRowClick: (f) => { if (consultorPorId[f.id]) location.hash = `#/consultor/${consultorPorId[f.id]}`; },
  });
  el.querySelectorAll('[data-historial]').forEach((b) => {
    b.onclick = () => {
      const conHistorial = b.dataset.historial === '1';
      el.querySelectorAll('[data-historial]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      grafico.update({ mostrarHistorial: conHistorial, ejeDesde: conHistorial ? EJE_HISTORIAL_DESDE : null });
    };
  });
  if (descartados.length) {
    const nota = el.querySelector('#vig-nota');
    nota.textContent = `Sin vigencia para graficar: ${descartados.map((d) => d.clave).join(', ')}.`;
    nota.hidden = false;
  }

  // ---- Tabla de profesionales (con filtro opcional)
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
  const pintarTabla = (clave, pagina = 1) => {
    const f = FILTROS[clave];
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
    paginador.querySelectorAll('[data-pag]').forEach((b) => { b.onclick = () => pintarTabla(clave, Number(b.dataset.pag)); });
    caja.hidden = !f;
    caja.innerHTML = f ? `<span>Mostrando ${lista.length} de ${e.consultores.length} profesionales ${f.texto}.</span><button type="button" class="btn peq" id="b-quitar">Quitar filtro</button>` : '';
    if (f) caja.querySelector('#b-quitar').onclick = () => pintarTabla('');
  };
  pintarTabla('');
  tbody.onclick = (ev) => { const tr = ev.target.closest('tr.clic'); if (tr) location.hash = `#/consultor/${tr.dataset.id}`; };

  // ---- Tarjetas: llevan a la tabla de profesionales (con el filtro que corresponde)
  el.querySelectorAll('.kpi-enlace').forEach((b) => {
    b.onclick = () => {
      pintarTabla(b.dataset.destino === 'todos' ? '' : b.dataset.destino);
      el.querySelector('#profesionales').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });

  // ---- Alertas: ventana emergente al entrar al tablero y botón para reabrirla
  const abrirAlertas = () => {
    if (!e.alertas.length || document.querySelector('.velo')) return;
    modal({
      titulo: `Alertas (${e.alertas.length})`, ancho: 860, botones: [],
      contenido: '<div style="display:flex;justify-content:flex-end"><select id="f-prio" class="en-linea" aria-label="Filtrar por prioridad"><option value="">Todas</option><option value="ALTA">Alta</option><option value="MEDIA">Media</option></select></div><div id="alertas" style="max-height:60vh;overflow:auto"></div>',
    });
    const velo = document.querySelector('.velo');
    const lista = velo.querySelector('#alertas');
    const pintarAlertas = (prio) => {
      const items = e.alertas.filter((a) => !prio || a.prioridad === prio);
      lista.innerHTML = items.length ? items.map((a) => `<div class="alerta">${badge(a.prioridad)}<div class="t"><a href="#/consultor/${a.consultor_id}">${esc(a.clave)}</a> · ${esc(a.titulo)}</div><div class="d">${esc(a.detalle)}</div><div class="a">→ ${esc(a.accion)}</div></div>`).join('') : '<div class="vacio">Sin alertas</div>';
    };
    pintarAlertas('');
    velo.querySelector('#f-prio').onchange = (ev) => pintarAlertas(ev.target.value);
    lista.onclick = (ev) => { if (ev.target.closest('a')) velo.querySelector('.cerrar').click(); }; // al ir a una ficha, se cierra la ventana
  };
  // La ventana de alertas se abre una sola vez por ingreso (ni al volver al Tablero ni al recargar la página).
  let vistas = false;
  try { vistas = sessionStorage.getItem('sgf-alertas-vistas') === '1'; } catch { /* sin almacenamiento */ }
  if (!omitirAlertas && !vistas) {
    try { sessionStorage.setItem('sgf-alertas-vistas', '1'); } catch { /* sin almacenamiento */ }
    abrirAlertas();
  }
  omitirAlertas = false;

  const br = el.querySelector('#b-recalc');
  if (br) br.onclick = async () => { try { await api('POST', '/recalcular', { motivo: 'Recálculo manual desde el tablero' }); aviso('Pronóstico recalculado y guardado', 'exito'); omitirAlertas = true; window.sgfRefrescar(); } catch (err) { fallo(err); } };
}
