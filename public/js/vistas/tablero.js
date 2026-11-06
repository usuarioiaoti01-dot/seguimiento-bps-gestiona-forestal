import { api, estado, esc, titulo, badge, modal } from '../util.js';
import { renderVigenciaTimeline } from '../vigencia-timeline/vigencia-timeline.js';
import { adaptarVigencias } from '../vigencia-adaptador.js';

// El historial completo se dibuja con el eje desde mayo de 2026 (inicio de las primeras adendas).
const EJE_HISTORIAL_DESDE = '2026-05-01';

const TITULO = 'TABLERO SEGUIMIENTO ACTIVIDADES DESARROLLO GESTIONA FORESTAL - 2026';

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

  // ---- Tarjetas: llevan a Seguimiento Actividades (con el filtro que corresponde)
  el.querySelectorAll('.kpi-enlace').forEach((b) => {
    b.onclick = () => { location.hash = b.dataset.destino === 'todos' ? '#/seguimiento' : `#/seguimiento/${b.dataset.destino}`; };
  });

  // ---- Alertas: ventana emergente al entrar al tablero y botón para reabrirla
  const PRIORIDADES = [['ALTA', 'Alta'], ['MEDIA', 'Media'], ['BAJA', 'Baja']];
  const POR_PAGINA = 6;
  const textoCerrar = (velo) => { const c = velo.querySelector('.cerrar'); c.textContent = 'Cerrar'; c.classList.add('texto'); c.setAttribute('aria-label', 'Cerrar'); };

  // Segunda ventana: las alertas de un tipo, de a seis por página. Al cerrarla se vuelve al resumen.
  const abrirAlertasDe = (prio, nombre) => {
    const items = e.alertas.filter((a) => a.prioridad === prio);
    const paginas = Math.max(1, Math.ceil(items.length / POR_PAGINA));
    const cerrada = modal({ titulo: `Alertas · ${nombre} (${items.length})`, ancho: 860, botones: [], contenido: '<div id="alertas"></div><div class="paginador" id="pag"></div>' });
    let aFicha = false;
    const velo = document.querySelector('.velo');
    textoCerrar(velo);
    let pag = 1;
    const pintar = () => {
      const trozo = items.slice((pag - 1) * POR_PAGINA, pag * POR_PAGINA);
      velo.querySelector('#alertas').innerHTML = trozo.map((a) => `<div class="alerta">${badge(a.prioridad)}<div class="t"><a href="#/consultor/${a.consultor_id}">${esc(a.clave)}</a> · ${esc(a.titulo)}</div><div class="d">${esc(a.detalle)}</div><div class="a">→ ${esc(a.accion)}</div></div>`).join('');
      velo.querySelector('#pag').innerHTML = paginas > 1
        ? `<span class="mut2">Alertas ${(pag - 1) * POR_PAGINA + 1}–${(pag - 1) * POR_PAGINA + trozo.length} de ${items.length}</span><div class="acciones"><button type="button" class="btn peq" data-p="${pag - 1}" ${pag === 1 ? 'disabled' : ''}>‹ Anterior</button><span class="mut2" style="align-self:center;padding:0 6px">Página ${pag} de ${paginas}</span><button type="button" class="btn peq" data-p="${pag + 1}" ${pag === paginas ? 'disabled' : ''}>Siguiente ›</button></div>`
        : `<span class="mut2">${items.length} alerta${items.length === 1 ? '' : 's'}</span>`;
    };
    pintar();
    velo.querySelector('#pag').onclick = (ev) => { const b = ev.target.closest('button[data-p]'); if (b && !b.disabled) { pag = Number(b.dataset.p); pintar(); } };
    velo.querySelector('#alertas').onclick = (ev) => { if (ev.target.closest('a')) { aFicha = true; velo.querySelector('.cerrar').click(); } }; // al ir a una ficha, se cierra la ventana
    return cerrada.then(() => { if (!aFicha) abrirAlertas(); }); // al cerrar el detalle se vuelve al resumen
  };

  // Ventana principal: una fila por prioridad con su cantidad.
  const abrirAlertas = () => {
    if (!e.alertas.length || document.querySelector('.velo')) return;
    const cuenta = (p) => e.alertas.filter((a) => a.prioridad === p).length;
    modal({
      titulo: `Alertas (${e.alertas.length})`, ancho: 560, botones: [],
      contenido: `<div class="resumen-alertas">${PRIORIDADES.map(([p, n]) => `<div class="fila-alerta"><div>${badge(p)}</div><div class="cant"><b>${cuenta(p)}</b> alerta${cuenta(p) === 1 ? '' : 's'} ${n.toLowerCase()}${cuenta(p) === 1 ? '' : 's'}</div><button type="button" class="btn peq prim" data-prio="${p}" ${cuenta(p) ? '' : 'disabled'}>Ver</button></div>`).join('')}</div>`,
    });
    const velo = document.querySelector('.velo');
    textoCerrar(velo);
    velo.querySelectorAll('button[data-prio]').forEach((b) => {
      b.onclick = () => {
        const p = PRIORIDADES.find(([k]) => k === b.dataset.prio);
        velo.querySelector('.cerrar').click(); // se cierra el resumen y se abre el detalle del tipo
        abrirAlertasDe(p[0], p[1]);
      };
    });
  };
  // La ventana de alertas se abre una sola vez por ingreso (ni al volver al Tablero ni al recargar la página).
  let vistas = false;
  try { vistas = sessionStorage.getItem('sgf-alertas-vistas') === '1'; } catch { /* sin almacenamiento */ }
  if (!vistas) {
    try { sessionStorage.setItem('sgf-alertas-vistas', '1'); } catch { /* sin almacenamiento */ }
    abrirAlertas();
  }
}
