import { api, enviarConMotivo, estado, esc, ff, ffc, fh, pct, titulo, badge, semaforo, diasBadge, holguraBadge, barraAvance, dia, puede, aviso, fallo, modal, opciones, pedirTexto, esProfesional, ETIQ } from '../util.js';
import { abrirAsistente } from './asistente.js';

const ESTADOS = ['PENDIENTE', 'EN_CURSO', 'CONCLUIDA', 'SUSPENDIDA'];
const CLASIF = ['ALINEADA', 'REASIGNADA', 'NUEVA', 'TRANSVERSAL'];
const POR_PAGINA = 5; // actividades por página en el plan de trabajo
const paginaActual = { consultor: null, n: 1 }; // sobrevive a "refrescar" tras editar una actividad

/** Divide las actividades en páginas de POR_PAGINA; cada fila resumen viaja con las actividades que encabeza. */
export function paginarActividades(acts) {
  const paginas = [[]];
  let n = 0; let resumenes = [];
  for (const a of acts) {
    if (a.es_resumen) { resumenes.push(a); continue; }
    if (n === POR_PAGINA) { paginas.push([]); n = 0; }
    paginas[paginas.length - 1].push(...resumenes, a);
    resumenes = []; n += 1;
  }
  if (resumenes.length) paginas[paginas.length - 1].push(...resumenes);
  return paginas;
}

/** modo 'contrato': ficha abierta desde Contratos y adendas; no muestra el plan de trabajo (solo en Seguimiento Actividades). */
export async function vistaConsultor(el, [id], modo = '') {
  const conPlan = modo !== 'contrato';
  const q = estado.corte ? `?corte=${estado.corte}` : '';
  const [d, bit] = await Promise.all([api('GET', `/consultores/${id}${q}`), api('GET', `/bitacora?consultor_id=${id}&limite=25`)]);
  const c = d.consultor; const v = d.vigencia; const p = d.pronostico; const k = d.contrato || {};
  const editor = puede('EDITOR');
  titulo(c.nombres, `${esc(c.clave)} · ${esc(c.perfil || '')} · corte ${ff(d.corte)}`);
  const iniciales = c.nombres.split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('');
  // Vigencia contractual: solo las adendas suscritas (concluidas y firmadas). Alertas: las dos primeras altas; el resto, en ventana emergente.
  const suscritas = d.adendas.filter((a) => a.estado === 'CONCLUIDA' || a.estado === 'FIRMADA');
  const htmlAlerta = (a) => `<div class="alerta">${badge(a.prioridad)}<div class="t">${esc(a.titulo)}</div><div class="d">${esc(a.detalle)}</div><div class="a">→ ${esc(a.accion)}</div></div>`;
  const altasVisibles = d.alertas.filter((a) => a.prioridad === 'ALTA').slice(0, 2);
  const desvioPlan = p && p.fin_probable && p.fin_plan ? dia(p.fin_probable) - dia(p.fin_plan) : null;

  el.innerHTML = `
  <div class="tarjeta"><div class="cuerpo ficha-cab">
    <div class="id"><div class="avatar">${esc(iniciales)}</div><div>
      <h2>${esc(c.nombres)} <span class="mut2">${esc(c.clave)}</span></h2>
      <div class="mut">${esc(k.numero || 'Sin contrato')} · ${esc(k.expediente || '')}</div>
      <div class="mut2">${esc(k.titulo_tdr || '')}${c.recurso_cronograma ? ` · Recurso en cronograma: ${esc(c.recurso_cronograma)}` : ''}</div></div></div>
    <div class="acciones">${badge(v.semaforo)}
      ${estado.ia ? '<button class="btn" id="b-ia">Preguntar al asistente</button>' : ''}
      ${editor ? '<button class="btn" id="b-datos">Editar datos</button>' : ''}${esProfesional() ? '' : `<a class="btn" href="${conPlan ? '#/seguimiento' : '#/adendas'}">${conPlan ? '← Seguimiento Actividades' : '← Contratos y adendas'}</a>`}</div>
  </div></div>

  <div class="rejilla-2">
    <div class="tarjeta"><div class="cab"><h2>VIGENCIA CONTRACTUAL</h2>${editor ? '<button class="btn peq prim" id="b-adenda">Registrar adenda</button>' : ''}</div>
      <div class="cuerpo" style="display:grid;gap:14px">
        <div class="datos">
          <div class="dato"><small>Adenda vigente</small><b>${v.adenda_vigente ? `N.° ${String(v.adenda_vigente.numero).padStart(2, '0')}` : '—'}</b></div>
          <div class="dato"><small>Fin de vigencia</small><b class="num">${ff(v.fin_vigencia)}</b></div>
          <div class="dato"><small>Días restantes</small><b>${diasBadge(v.dias_restantes)}</b></div>
        </div>
        <div class="adendas">${suscritas.map((a) => `<div class="adenda ${a.estado}" data-adenda="${a.adenda_id}" title="Clic para ver o editar">
          <div><b>Adenda N.° ${String(a.numero).padStart(2, '0')}</b> ${badge(a.estado)}</div>
          <div class="num mut">${ff(a.fecha_inicio)} – ${ff(a.fecha_fin)}</div>
          ${a.plazo_dias ? `<div class="mut2">${a.plazo_dias} días${a.plazo_solicitado_dias && a.plazo_solicitado_dias !== a.plazo_dias ? ` (solicitados ${a.plazo_solicitado_dias})` : ''}</div>` : ''}
          <div class="mut2">${esc(a.documento_ref || (a.estado === 'CONCLUIDA' ? 'Adenda concluida' : 'Sin documento'))}</div></div>`).join('') || '<span class="mut">Sin adendas suscritas</span>'}</div>
        ${coberturaAdendas(d.cobertura)}
      </div></div>
    <div class="tarjeta"><div class="cab"><h2>ALERTAS DEL PROFESIONAL</h2>${d.alertas.length > altasVisibles.length ? `<button class="btn peq" id="b-alertas">Ver todas (${d.alertas.length})</button>` : ''}</div><div class="cuerpo sin">
      ${altasVisibles.map(htmlAlerta).join('') || `<div class="vacio">${d.alertas.length ? 'Sin alertas altas' : 'Sin alertas'}</div>`}</div></div>
  </div>

  ${conPlan ? `<div class="tarjeta">
    <div class="cab"><div><h2>${esc(d.plan ? d.plan.nombre : 'Sin plan de trabajo')}</h2>
      ${d.plan ? `<span class="mut2">${badge(d.plan.estado)} · ${esc(d.plan.fuente || '')} ${d.plan.fecha_recepcion ? ` · recibido ${ff(d.plan.fecha_recepcion)}` : ''} · días ${d.plan.tipo_dias === 'HABILES' ? 'hábiles' : 'calendario'}</span>` : ''}</div>
      <div class="acciones">${d.plan && d.plan_pdf?.existe ? '<button class="btn peq prim" id="b-pdf">Ver plan aprobado (PDF)</button>' : ''}${d.plan && editor ? `<button class="btn peq" id="b-pdf-adjuntar">${d.plan_pdf?.existe ? 'Reemplazar PDF' : 'Adjuntar plan (PDF)'}</button><input type="file" id="f-pdf" accept="application/pdf" hidden>` : ''}${d.plan ? '<button class="btn peq" id="b-lb">Línea base 2026</button>' : ''}${d.plan && editor ? `
        <button class="btn peq" id="b-plan">Editar plan</button>
        <button class="btn peq" id="b-simular">Simular</button>
        <button class="btn peq" id="b-adoptar" title="Convierte las fechas probables en las nuevas fechas del plan (reprogramación formal con motivo)">Adoptar fechas probables</button>
        <button class="btn peq prim" id="b-nueva">Agregar actividad</button>` : ''}</div></div>
    ${p ? `<div class="cuerpo"><div class="datos">
      <div class="dato"><small>Inicio del plan</small><b class="num">${ff(p.inicio_plan)}</b></div>
      <div class="dato"><small>Fin del plan</small><b class="num">${ff(p.fin_plan)}</b></div>
      <div class="dato"><small>Término probable</small><b class="num">${ff(p.fin_probable)} ${desvioPlan ? `<span class="badge ${desvioPlan > 0 ? 'b-rojo' : 'b-verde'}">${desvioPlan > 0 ? '+' : ''}${desvioPlan} d</span>` : ''}</b></div>
      <div class="dato"><small>Avance real / esperado</small>${barraAvance(p.avance_ponderado, p.avance_esperado)}</div>
      <div class="dato"><small>Actividades</small><b class="num">${p.numero_actividades}</b></div>
    </div></div>` : ''}
    <div class="cuerpo" style="border-top:1px solid var(--borde);padding-top:10px"><div class="leyenda">
      <span><i style="border:1.5px solid var(--borde-fuerte);background:var(--superficie-2)"></i>Plan formulado</span>
      <span><i style="background:var(--azul)"></i>Probable en plazo</span><span><i style="background:var(--rojo)"></i>Atrasada</span><span><i style="background:var(--verde)"></i>Concluida</span>
      <span><i style="border-left:2px dashed var(--azul);width:2px;height:12px"></i>Corte</span><span><i style="border-left:2px dashed var(--rojo);width:2px;height:12px"></i>Fin de vigencia</span>
      <span class="critica">◆</span> ruta crítica</div></div>
    <div class="cuerpo sin tabla-env" id="tabla-act"></div>
  </div>` : ''}

  <div class="rejilla-2">
    <div class="tarjeta"><div class="cab"><h2>Actas de control de cambios</h2>${editor ? '<button class="btn peq" id="b-cc">Registrar acta</button>' : ''}</div><div class="cuerpo sin">
        ${d.controles_cambio.map((x) => `<div class="alerta" data-cc="${x.control_cambio_id}" style="cursor:pointer">${badge(x.estado)}<div class="t">${esc(x.titulo)}</div><div class="d">${ff(x.fecha)} · ${esc(x.documento_ref || '')}</div></div>`).join('') || '<div class="vacio">Sin actas</div>'}</div></div>
    <div class="tarjeta"><div class="cab"><h2>Evolución del término probable</h2></div><div class="cuerpo">${evolucion(d.historial_pronostico)}</div></div>
  </div>

  <div class="tarjeta"><div class="cab"><h2>Últimos cambios</h2><a class="btn peq" href="#/bitacora">Ver bitácora completa</a></div><div class="cuerpo sin tabla-env"><table>
    <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Registro</th><th>Cambios</th><th>Motivo</th></tr></thead>
    <tbody>${bit.map((b) => `<tr><td class="num">${fh(b.fecha)}</td><td>${esc(b.usuario)}${b.origen === 'IA' ? ' ' + badge('NUEVA', 'IA') : ''}</td><td>${esc(b.accion)}</td><td>${esc(b.entidad)} ${b.entidad_id ?? ''}</td><td class="diff">${diffHtml(b.cambios_json)}</td><td class="mut2">${esc(b.motivo || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Sin cambios registrados</td></tr>'}</tbody></table></div></div>`;

  if (conPlan) pintarActividades(el.querySelector('#tabla-act'), d, editor);
  conectar(el, d, editor);
}

function evolucion(h) {
  if (!h || !h.length) return '<span class="mut">Aún no hay recálculos guardados.</span>';
  const ult = [];
  for (const x of h) { if (!ult.length || ult[ult.length - 1].fin_probable !== x.fin_probable || ult[ult.length - 1].fecha_corte !== x.fecha_corte) ult.push(x); }
  return `<table><thead><tr><th>Corte</th><th>Término probable</th><th>Holgura</th><th class="d">Avance</th></tr></thead><tbody>${ult.slice(-8).reverse().map((x) => `<tr><td class="num">${ff(x.fecha_corte)}</td><td class="num">${ff(x.fin_probable)}</td><td>${holguraBadge(x.holgura_dias)}</td><td class="d num">${pct(x.avance_ponderado)}</td></tr>`).join('')}</tbody></table>`;
}

export function diffHtml(json) {
  if (!json) return '';
  let o; try { o = typeof json === 'string' ? JSON.parse(json) : json; } catch { return esc(json); }
  if (o.antes && o.despues) return Object.keys(o.despues).map((k2) => `${esc(k2)}: <del>${esc(o.antes[k2] ?? '∅')}</del> → <ins>${esc(o.despues[k2] ?? '∅')}</ins>`).join('<br>');
  if (o.despues) return Object.entries(o.despues).slice(0, 5).map(([k2, v2]) => `${esc(k2)}: <ins>${esc(typeof v2 === 'object' ? JSON.stringify(v2) : v2)}</ins>`).join('<br>');
  return esc(JSON.stringify(o)).slice(0, 200);
}

function pintarActividades(cont, d, editor) {
  const acts = d.actividades;
  if (!acts.length) {
    cont.innerHTML = `<div class="vacio">${d.plan && d.plan.estado === 'POR_REGISTRAR' ? 'Plan por registrar: agregue las actividades del plan de trabajo remitido.' : 'Sin actividades.'}</div>`;
    return;
  }
  const v = d.vigencia;
  const fechas = [d.corte];
  for (const a of acts) { fechas.push(a.inicio_plan, a.fin_plan); if (a.pronostico) fechas.push(a.pronostico.inicio_probable, a.pronostico.fin_probable); }
  if (v.fin_vigencia) fechas.push(v.fin_vigencia);
  const d0 = Math.min(...fechas.filter(Boolean).map(dia)) - 1;
  const d1 = Math.max(...fechas.filter(Boolean).map(dia)) + 2;
  const x = (f) => ((dia(f) - d0) / (d1 - d0)) * 100;
  const w = (a, b) => Math.max(0.8, ((dia(b) - dia(a) + 1) / (d1 - d0)) * 100);
  const marcas = [];
  const rango = d1 - d0;
  const patron = rango <= 45 ? /-(01|08|15|22)$/ : rango <= 120 ? /-(01|15)$/ : /-01$/;
  for (let n = d0; n <= d1; n += 1) { const f = new Date(n * 86400000).toISOString().slice(0, 10); if (patron.test(f)) marcas.push(f); }
  const lineas = `<div class="linea corte" style="left:${x(d.corte)}%"></div>${v.fin_vigencia ? `<div class="linea vig" style="left:${x(v.fin_vigencia)}%"></div>` : ''}`;

  const paginas = paginarActividades(acts);
  if (paginaActual.consultor !== d.consultor.consultor_id) { paginaActual.consultor = d.consultor.consultor_id; paginaActual.n = 1; }
  paginaActual.n = Math.min(Math.max(paginaActual.n, 1), paginas.length);
  const total = acts.filter((a) => !a.es_resumen).length;
  const desde = paginas.slice(0, paginaActual.n - 1).reduce((s, pg) => s + pg.filter((a) => !a.es_resumen).length, 0);
  const enPagina = paginas[paginaActual.n - 1];
  const hasta = desde + enPagina.filter((a) => !a.es_resumen).length;
  const paginador = paginas.length > 1 ? `<div class="paginador"><span class="mut2">Actividades ${desde + 1}–${hasta} de ${total}</span><div class="acciones">
    <button type="button" class="btn peq" data-pag="${paginaActual.n - 1}" ${paginaActual.n === 1 ? 'disabled' : ''}>Anterior</button>
    ${paginas.map((_, i) => `<button type="button" class="btn peq ${i + 1 === paginaActual.n ? 'prim' : ''}" data-pag="${i + 1}" aria-label="Página ${i + 1}" ${i + 1 === paginaActual.n ? 'aria-current="page"' : ''}>${i + 1}</button>`).join('')}
    <button type="button" class="btn peq" data-pag="${paginaActual.n + 1}" ${paginaActual.n === paginas.length ? 'disabled' : ''}>Siguiente</button></div></div>` : '';

  cont.innerHTML = `<table><thead><tr><th>N.°</th><th>Actividad</th><th>Fechas</th><th>Avance</th><th>Estado</th><th>Término probable</th><th style="min-width:380px;width:34%"><div class="gantt-cab">${marcas.map((m) => `<span style="left:${x(m)}%">${ffc(m)}</span>`).join('')}</div></th><th></th></tr></thead>
  <tbody>${enPagina.map((a) => {
    const pr = a.pronostico || {};
    const res = a.es_resumen;
    const anul = a.estado === 'ANULADA';
    const editable = editor && !res && !anul;
    const editaEstado = (editor || esProfesional()) && !res && !anul; // el Profesional solo cambia el estado (y el avance en «Editar»)
    return `<tr class="${res ? 'resumen' : ''} ${anul ? 'anulada' : ''}" data-act="${a.actividad_id}">
      <td class="num">${pr.critica ? '<span class="critica" title="Ruta crítica">◆</span> ' : ''}${esc(a.numero)}</td>
      <td class="desc">${esc(a.descripcion)}<small>${badge(a.clasificacion)} ${a.edt_ref ? esc(a.edt_ref) : ''}${a.es_hito ? ' · hito' : ''}${a.predecesoras.length ? ` · depende de ${a.predecesoras.map((p) => esc((acts.find((y) => y.actividad_id === p.predecesora_id) || {}).numero || p.predecesora_id)).join(', ')}` : ''}</small></td>
      <td class="num" style="white-space:nowrap"><span class="mut2">Plan</span> ${ffc(a.inicio_plan)}–${ffc(a.fin_plan)}<br><span class="mut2">Real</span> ${a.inicio_real || a.fin_real ? `${a.inicio_real ? ffc(a.inicio_real) : '…'}–${a.fin_real ? ffc(a.fin_real) : '…'}` : '<span class="mut2">sin registro</span>'}</td>
      <td>${editable ? `<input class="en-linea num" type="number" min="0" max="100" step="5" value="${Number(a.avance)}" data-campo="avance" aria-label="Avance %">` : `<span class="num">${pct(a.avance)}</span>`}</td>
      <td>${editaEstado ? `<select class="en-linea" data-campo="estado" aria-label="Estado">${opciones(ESTADOS.map((s) => [s, ETIQ[s][0]]), a.estado)}</select>` : badge(a.estado)}</td>
      <td class="num">${pr.fin_probable ? `<b>${ff(pr.fin_probable)}</b><br>${pr.desvio_dias ? `<span class="badge ${pr.desvio_dias > 0 ? 'b-rojo' : 'b-verde'}">${pr.desvio_dias > 0 ? '+' : ''}${pr.desvio_dias} d</span>` : ''} ${pr.situacion && pr.situacion !== 'EN_PLAZO' && pr.situacion !== 'PROGRAMADA' ? badge(pr.situacion) : ''}` : '—'}</td>
      <td><div class="gantt">${lineas}
        <div class="plan" style="left:${x(a.inicio_plan)}%;width:${w(a.inicio_plan, a.fin_plan)}%" title="Plan: ${ff(a.inicio_plan)} – ${ff(a.fin_plan)}"></div>
        ${pr.inicio_probable ? `<div class="prob ${esc(pr.situacion)}" style="left:${x(pr.inicio_probable)}%;width:${w(pr.inicio_probable, pr.fin_probable)}%" title="Probable: ${ff(pr.inicio_probable)} – ${ff(pr.fin_probable)}"><div class="lleno" style="width:${Number(a.avance)}%"></div></div>` : ''}</div></td>
      <td>${!res && !anul ? `<button class="btn peq" data-editar="${a.actividad_id}">${editor || esProfesional() ? 'Editar' : 'Ver'}</button>` : ''}</td></tr>`;
  }).join('')}</tbody></table>${paginador}`;
  cont.querySelectorAll('[data-pag]').forEach((b) => { b.onclick = () => { paginaActual.n = Number(b.dataset.pag); pintarActividades(cont, d, editor); }; });
  conectarActividades(cont, d, editor);
}

/** Avance, estado y "Editar" de las filas de la página que se está mostrando. */
function conectarActividades(cont, d, editor) {
  const act = (id) => d.actividades.find((a) => a.actividad_id === Number(id));
  cont.querySelectorAll('[data-campo]').forEach((inp) => {
    inp.onchange = async () => {
      if (inp.disabled) return;
      inp.disabled = true;
      const a = act(inp.closest('tr').dataset.act);
      const valor = inp.dataset.campo === 'avance' ? Number(inp.value) : inp.value;
      try {
        const r = await enviarConMotivo('PATCH', `/actividades/${a.actividad_id}`, { [inp.dataset.campo]: valor, revision: a.revision });
        aviso(`Actividad ${a.numero} actualizada · pronóstico recalculado${r.finRealAsumido ? `. Fin real asumido: ${ff(r.fila.fin_real)} (corríjalo con «Editar» si fue otra fecha)` : ''}`, 'exito');
        window.sgfRefrescar();
      } catch (err) { inp.disabled = false; fallo(err); if (err.estado === 409 || err.cancelado) window.sgfRefrescar(); }
    };
  });
  cont.querySelectorAll('[data-editar]').forEach((b) => { b.onclick = () => editarActividad(act(b.dataset.editar), d, editor); });
}

function conectar(el, d, editor) {
  const refrescar = () => window.sgfRefrescar();
  const act = (id) => d.actividades.find((a) => a.actividad_id === Number(id));
  el.querySelectorAll('[data-adenda]').forEach((x) => { x.onclick = () => editarAdenda(d.adendas.find((a) => a.adenda_id === Number(x.dataset.adenda)), d, editor); });
  el.querySelectorAll('[data-cc]').forEach((x) => { x.onclick = () => editarControlCambio(d.controles_cambio.find((a) => a.control_cambio_id === Number(x.dataset.cc)), d, editor); });
  const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = fn; };
  on('#b-ia', () => abrirAsistente({ consultor_id: d.consultor.consultor_id, texto: `Analiza la situación de ${d.consultor.nombres}: vigencia, término probable, actividades críticas y qué debo hacer esta semana.` }));
  on('#b-adenda', () => editarAdenda(null, d, editor));
  on('#b-alertas', () => verAlertas(d));
  on('#b-lb', () => verLineaBase(d));
  on('#b-pdf', () => verPlanPdf(d));
  on('#b-pdf-adjuntar', () => el.querySelector('#f-pdf').click());
  const f = el.querySelector('#f-pdf');
  if (f) f.onchange = () => { const arch = f.files[0]; f.value = ''; if (arch) adjuntarPlanPdf(d, arch); };
  on('#b-cc', () => editarControlCambio(null, d, editor));
  on('#b-nueva', () => editarActividad(null, d, editor));
  on('#b-plan', () => editarPlan(d));
  on('#b-simular', () => simular(d));
  on('#b-datos', () => editarConsultor(d));
  on('#b-adoptar', async () => {
    try {
      const r = await enviarConMotivo('POST', `/planes/${d.plan.plan_id}/adoptar-pronostico`, {}, 'Reprogramación formal del plan');
      aviso(`${r.actividades_reprogramadas} actividades reprogramadas`, 'exito'); refrescar();
    } catch (err) { fallo(err); }
  });
}

/** Todas las alertas del profesional (las dos altas de la tarjeta y el resto) en una ventana emergente. */
function verAlertas(d) {
  modal({
    titulo: `ALERTAS DEL PROFESIONAL (${d.alertas.length})`, ancho: 820, botones: [],
    contenido: `<div style="max-height:65vh;overflow:auto">${d.alertas.map((a) => `<div class="alerta">${badge(a.prioridad)}<div class="t">${esc(a.titulo)}</div><div class="d">${esc(a.detalle)}</div><div class="a">→ ${esc(a.accion)}</div></div>`).join('')}</div>`,
  });
}

/** Visor del PDF del plan aprobado (iframe del mismo origen; si el navegador no lo muestra, se ofrece abrirlo aparte). */
function verPlanPdf(d) {
  const url = `/api/planes/${d.plan.plan_id}/pdf`;
  modal({
    titulo: `Plan aprobado · ${d.plan.nombre}`, ancho: 1100, botones: [],
    contenido: `<iframe src="${url}#navpanes=0&zoom=100" title="Plan de trabajo aprobado (PDF)" style="width:100%;height:72vh;border:1px solid var(--borde);border-radius:8px;background:var(--superficie-2)"></iframe>
      <div class="mut2">Si el visor no se muestra, <a href="${url}" target="_blank" rel="noopener">abra el PDF en una pestaña nueva</a>.</div>`,
  });
}

/** Adjunta (o reemplaza) el PDF del plan aprobado; el motivo queda en la bitácora. */
async function adjuntarPlanPdf(d, archivo) {
  if (archivo.type !== 'application/pdf' && !/\.pdf$/i.test(archivo.name)) { aviso('Seleccione un archivo PDF', 'error'); return; }
  if (archivo.size > 15 * 1024 * 1024) { aviso('El PDF supera el máximo de 15 MB', 'error'); return; }
  const motivo = await pedirTexto(d.plan_pdf?.existe ? 'Reemplazar el PDF del plan' : 'Adjuntar el PDF del plan', `Se adjuntará «${archivo.name}» al plan «${d.plan.nombre}». La versión anterior, si existe, se conserva.`, 'Ej.: Plan aprobado con la conformidad de la OTI del 05/11/2026');
  if (!motivo) return;
  try {
    const r = await fetch(`/api/planes/${d.plan.plan_id}/pdf`, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'X-SGF': '1', 'X-Motivo': encodeURIComponent(motivo) }, body: archivo, credentials: 'same-origin' });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(datos.error || `Error ${r.status}`);
    aviso('PDF del plan guardado', 'exito'); window.sgfRefrescar();
  } catch (err) { fallo(err); }
}

/** Línea base 2026 (entregables asignados) en ventana emergente. */
function verLineaBase(d) {
  modal({
    titulo: 'Línea base 2026 (entregables asignados)', ancho: 1100, botones: [],
    contenido: `<div class="tabla-env" style="max-height:70vh;overflow:auto"><table>
      <thead><tr><th>EDT</th><th>Entregable</th><th>Fin LB</th><th class="d">Avance al corte LB</th><th>Cobertura</th><th>Situación</th></tr></thead>
      <tbody>${d.linea_base.map((e) => `<tr><td class="num">${esc(e.edt)}</td><td class="desc">${esc(e.nombre)}${e.actividades.length ? `<small>Actividades: ${e.actividades.map(esc).join(', ')}</small>` : ''}</td><td class="num">${ff(e.fin_lb)}</td><td class="d num">${pct(e.avance_corte)}</td><td>${badge(e.cobertura)}</td><td class="mut2">${esc(e.situacion || '')}${e.situacion_oti ? `<br><b>OTI:</b> ${esc(e.situacion_oti)}` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Sin entregables</td></tr>'}</tbody></table></div>`,
  });
}

async function editarActividad(a, d, editor) {
  const nueva = !a;
  a = a || { numero: '', descripcion: '', producto: '', edt_ref: '', clasificacion: 'ALINEADA', inicio_plan: d.corte, fin_plan: d.corte, avance: 0, estado: 'PENDIENTE', es_hito: 0, predecesoras: [] };
  const otras = d.actividades.filter((x) => x.actividad_id !== a.actividad_id && !x.es_resumen && x.estado !== 'ANULADA');
  const preds = new Map((a.predecesoras || []).map((p) => [p.predecesora_id, p.desfase_dias]));
  const dis = editor ? '' : 'disabled';
  const prof = esProfesional(); // solo puede cambiar el avance
  const disAvance = editor || prof ? '' : 'disabled';
  const r = await modal({
    titulo: nueva ? 'Agregar actividad al plan' : `Actividad ${a.numero}`,
    ancho: 820,
    contenido: `<div class="form">
      <div class="campo"><label>N.°</label><input name="numero" value="${esc(a.numero)}" ${dis}></div>
      <div class="campo"><label>Clasificación</label><select name="clasificacion" ${dis}>${opciones(CLASIF.map((s) => [s, ETIQ[s][0]]), a.clasificacion)}</select></div>
      <div class="campo"><label>Entregable de línea base</label><select name="entregable_id" ${dis}><option value="">— Ninguno —</option>${opciones(d.linea_base.map((e) => [e.entregable_id, `${e.edt} ${e.nombre.slice(0, 60)}`]), a.entregable_id)}</select></div>
      <div class="campo ancho"><label>Descripción</label><textarea name="descripcion" ${dis}>${esc(a.descripcion)}</textarea></div>
      <div class="campo"><label>Producto / evidencia esperada</label><input name="producto" value="${esc(a.producto || '')}" ${dis}></div>
      <div class="campo"><label>Referencia EDT</label><input name="edt_ref" value="${esc(a.edt_ref || '')}" ${dis}></div>
      <div class="campo"><label>Acta de control de cambios</label><select name="control_cambio_id" ${dis}><option value="">— Ninguna —</option>${opciones(d.controles_cambio.map((x) => [x.control_cambio_id, `${x.titulo.slice(0, 50)} (${x.estado})`]), a.control_cambio_id)}</select></div>
      <div class="campo"><label>Inicio planificado</label><input type="date" name="inicio_plan" value="${esc(a.inicio_plan)}" ${dis}></div>
      <div class="campo"><label>Fin planificado</label><input type="date" name="fin_plan" value="${esc(a.fin_plan)}" ${dis}></div>
      <div class="campo"><label>Hito / entregable</label><select name="es_hito" ${dis}>${opciones([[0, 'No'], [1, 'Sí']], a.es_hito ? 1 : 0)}</select></div>
      ${nueva ? '' : `
      <div class="campo"><label>Inicio real</label><input type="date" name="inicio_real" value="${esc(a.inicio_real || '')}" ${dis}></div>
      <div class="campo"><label>Fin real</label><input type="date" name="fin_real" value="${esc(a.fin_real || '')}" ${dis}></div>
      <div class="campo"><label>Avance %</label><input type="number" min="0" max="100" name="avance" value="${Number(a.avance)}" ${disAvance}></div>
      <div class="campo"><label>Estado</label><select name="estado" ${dis}>${opciones(ESTADOS.map((s) => [s, ETIQ[s][0]]), a.estado)}</select></div>
      <div class="campo"><label>Fecha de revisión OTI</label><input type="date" name="fecha_revision" value="${esc(a.fecha_revision || '')}" ${dis}></div>
      <div class="campo ancho"><label>Evidencia verificada</label><input name="evidencia" value="${esc(a.evidencia || '')}" placeholder="Ej.: Acta de presentación del 12/11; merge request !245" ${dis}></div>
      <div class="campo ancho"><label>Observación OTI</label><textarea name="observacion" ${dis}>${esc(a.observacion || '')}</textarea></div>`}
      <div class="campo ancho"><label>Predecesoras (fin → inicio) y desfase en días (negativo = solapamiento)</label>
        <div style="max-height:180px;overflow:auto;border:1px solid var(--borde);border-radius:8px;padding:6px 10px">${otras.map((o) => `<div style="display:flex;gap:8px;align-items:center;padding:2px 0">
          <input type="checkbox" data-pred="${o.actividad_id}" ${preds.has(o.actividad_id) ? 'checked' : ''} ${dis}>
          <span style="flex:1" class="mut">${esc(o.numero)} · ${esc(o.descripcion.slice(0, 80))} <span class="mut2">(fin ${ff(o.fin_plan)})</span></span>
          <input type="number" class="en-linea" data-desfase="${o.actividad_id}" value="${preds.get(o.actividad_id) ?? 0}" ${dis}></div>`).join('') || '<span class="mut2">No hay otras actividades</span>'}</div></div>
      ${editor ? '<div class="campo ancho"><label>Motivo del cambio (obligatorio si cambia las fechas del plan)</label><input name="motivo" placeholder="Ej.: Reprogramación aprobada en reunión de seguimiento del 05/11"></div>' : ''}
    </div>`,
    botones: prof ? [{ texto: 'Cancelar', valor: null }, { texto: 'Guardar avance', clase: 'prim', valor: 'avance' }] : editor ? [
      ...(nueva ? [] : [{ texto: 'Historial', valor: 'historial' }, { texto: 'Anular', clase: 'peligro', valor: 'anular' }]),
      { texto: 'Cancelar', valor: null }, { texto: 'Guardar', clase: 'prim', valor: 'guardar' },
    ] : [{ texto: 'Historial', valor: 'historial' }, { texto: 'Cerrar', valor: null }],
  });
  if (!r.valor) return;
  if (r.valor === 'historial') return verHistorial('actividad', a.actividad_id, `Historial de la actividad ${a.numero}`);
  if (r.valor === 'avance') { // Profesional: solo el avance; el servidor rechaza cualquier otro campo
    try {
      await api('PATCH', `/actividades/${a.actividad_id}`, { avance: Number(r.datos.avance), revision: a.revision });
      aviso('Avance guardado · pronóstico recalculado', 'exito'); window.sgfRefrescar();
    } catch (err) { fallo(err); if (err.estado === 409) window.sgfRefrescar(); }
    return;
  }
  try {
    if (r.valor === 'anular') {
      await enviarConMotivo('POST', `/actividades/${a.actividad_id}/anular`, { motivo: r.datos.motivo }, 'Motivo de la anulación');
      aviso('Actividad anulada', 'exito'); window.sgfRefrescar(); return;
    }
    const datos = { ...r.datos };
    const motivo = datos.motivo; delete datos.motivo;
    const predecesoras = [...r.form.querySelectorAll('[data-pred]')].filter((x) => x.checked).map((x) => ({ predecesora_id: Number(x.dataset.pred), desfase_dias: Number(r.form.querySelector(`[data-desfase="${x.dataset.pred}"]`).value) || 0 }));
    if (nueva) {
      await api('POST', `/planes/${d.plan.plan_id}/actividades`, { ...datos, predecesoras, motivo });
    } else {
      datos.es_hito = Number(datos.es_hito); if (datos.avance !== null) datos.avance = Number(datos.avance);
      await enviarConMotivo('PATCH', `/actividades/${a.actividad_id}`, { ...datos, revision: a.revision, motivo });
      const antes = JSON.stringify([...preds.entries()].sort());
      const despues = JSON.stringify(predecesoras.map((p) => [p.predecesora_id, p.desfase_dias]).sort());
      if (antes !== despues) await api('PUT', `/actividades/${a.actividad_id}/predecesoras`, { predecesoras, motivo });
    }
    aviso('Guardado · pronóstico recalculado', 'exito');
    window.sgfRefrescar();
  } catch (err) { fallo(err); }
}

/** Resumen de la cobertura entre adendas: días sin cobertura (rojo) e inconsistencias por superposición. */
function coberturaAdendas(c) {
  if (!c || !c.tramos.length) return '';
  const rojo = (t) => `<div class="mut" style="color:var(--rojo)">▲ ${t}</div>`;
  const lineas = [
    ...c.brechas.map((t) => rojo(`${t.dias} día(s) sin cobertura entre la Adenda ${String(t.anterior).padStart(2, '0')} y la ${String(t.siguiente).padStart(2, '0')} (${ff(t.desde)} – ${ff(t.hasta)})`)),
    ...c.superposiciones.map((t) => `<div class="mut" style="color:var(--ambar)">● Inconsistencia: las Adendas ${String(t.anterior).padStart(2, '0')} y ${String(t.siguiente).padStart(2, '0')} se superponen ${t.dias} día(s) (${ff(t.desde)} – ${ff(t.hasta)})</div>`),
  ];
  return `<div>${lineas.join('') || '<div class="mut2">Vigencias contiguas: sin días sin cobertura entre adendas.</div>'}</div>`;
}

export async function editarAdenda(a, d, editor) {
  const nueva = !a;
  const ultima = d.adendas[d.adendas.length - 1];
  a = a || { numero: ultima ? ultima.numero + 1 : 1, estado: 'EN_TRAMITE', fecha_inicio: ultima ? new Date((dia(ultima.fecha_fin) + 1) * 86400000).toISOString().slice(0, 10) : d.corte, fecha_fin: '', expediente: d.contrato && d.contrato.expediente };
  const dis = editor ? '' : 'disabled';
  const r = await modal({
    titulo: nueva ? 'Registrar adenda' : `Adenda N.° ${String(a.numero).padStart(2, '0')}`,
    contenido: `<div class="form">
      <div class="campo"><label>N.° de adenda</label><input type="number" name="numero" value="${esc(a.numero)}" ${dis}></div>
      <div class="campo"><label>Estado</label><select name="estado" ${dis}>${opciones([['ANUNCIADA', 'Anunciada (sin documento)'], ['EN_TRAMITE', 'En trámite'], ['FIRMADA', 'Firmada'], ['CONCLUIDA', 'Concluida'], ['ANULADA', 'Anulada']], a.estado)}</select></div>
      <div class="campo"><label>Inicio</label><input type="date" name="fecha_inicio" value="${esc(a.fecha_inicio || '')}" ${dis}></div>
      <div class="campo"><label>Fin${nueva ? ' (si lo deja vacío: inicio + plazo otorgado − 1)' : ''}</label><input type="date" name="fecha_fin" value="${esc(a.fecha_fin || '')}" ${dis}></div>
      <div class="campo"><label>Fecha de suscripción</label><input type="date" name="fecha_suscripcion" value="${esc(a.fecha_suscripcion || '')}" ${dis}></div>
      <div class="campo"><label>Plazo otorgado (días)</label><input type="number" min="1" name="plazo_dias" value="${esc(a.plazo_dias ?? '')}" ${dis}></div>
      <div class="campo"><label>Plazo solicitado (días)</label><input type="number" min="1" name="plazo_solicitado_dias" value="${esc(a.plazo_solicitado_dias ?? '')}" ${dis}></div>
      <div class="campo"><label>Expediente</label><input name="expediente" value="${esc(a.expediente || '')}" ${dis}></div>
      <div class="campo ancho"><label>Documento (obligatorio si está firmada)</label><input name="documento_ref" value="${esc(a.documento_ref || '')}" placeholder="Adenda N.° 04 al Contrato N.° 039-2026-MIDAGRI-SERFOR-PKFW" ${dis}></div>
      <div class="campo ancho"><label>Observación</label><textarea name="observacion" ${dis}>${esc(a.observacion || '')}</textarea></div>
      ${editor ? '<div class="campo ancho"><label>Motivo / sustento del registro</label><input name="motivo" placeholder="Ej.: Correo de BPS del 05/11 con la adenda suscrita"></div>' : ''}</div>`,
    botones: editor ? [...(nueva ? [] : [{ texto: 'Historial', valor: 'historial' }]), { texto: 'Cancelar', valor: null }, { texto: 'Guardar', clase: 'prim', valor: 'ok' }] : [{ texto: 'Historial', valor: 'historial' }, { texto: 'Cerrar', valor: null }],
  });
  if (r.valor === 'historial') return verHistorial('adenda', a.adenda_id, `Historial de la Adenda N.° ${a.numero}`);
  if (r.valor !== 'ok') return;
  try {
    const datos = { ...r.datos, numero: Number(r.datos.numero) };
    if (nueva) await api('POST', '/adendas', { ...datos, contrato_id: d.contrato.contrato_id });
    else await api('PATCH', `/adendas/${a.adenda_id}`, { ...datos, revision: a.revision });
    aviso('Adenda guardada · vigencia recalculada', 'exito'); window.sgfRefrescar();
  } catch (err) { fallo(err); }
}

async function editarPlan(d) {
  const p = d.plan;
  const r = await modal({
    titulo: 'Plan de trabajo',
    contenido: `<div class="form">
      <div class="campo ancho"><label>Nombre</label><input name="nombre" value="${esc(p.nombre)}"></div>
      <div class="campo"><label>Estado</label><select name="estado">${opciones([['POR_REGISTRAR', 'Por registrar'], ['RECIBIDO', 'Recibido'], ['OBSERVADO', 'Observado'], ['APROBADO', 'Aprobado']], p.estado)}</select></div>
      <div class="campo"><label>Versión</label><input name="version_plan" value="${esc(p.version_plan || '')}"></div>
      <div class="campo"><label>Fecha de recepción</label><input type="date" name="fecha_recepcion" value="${esc(p.fecha_recepcion || '')}"></div>
      <div class="campo"><label>Tipo de días para el cálculo</label><select name="tipo_dias">${opciones([['CALENDARIO', 'Calendario'], ['HABILES', 'Hábiles (lun–vie sin feriados)']], p.tipo_dias)}</select></div>
      <div class="campo"><label>Adenda asociada</label><select name="adenda_id">${opciones(d.adendas.map((a) => [a.adenda_id, `N.° ${a.numero} (${a.estado})`]), p.adenda_id)}</select></div>
      <div class="campo ancho"><label>Fuente</label><input name="fuente" value="${esc(p.fuente || '')}"></div>
      <div class="campo ancho"><label>Observación</label><textarea name="observacion">${esc(p.observacion || '')}</textarea></div></div>`,
    botones: [{ texto: 'Historial', valor: 'historial' }, { texto: 'Cancelar', valor: null }, { texto: 'Guardar', clase: 'prim', valor: 'ok' }],
  });
  if (r.valor === 'historial') return verHistorial('plan_trabajo', p.plan_id, 'Historial del plan');
  if (r.valor !== 'ok') return;
  try { await api('PATCH', `/planes/${p.plan_id}`, { ...r.datos, adenda_id: Number(r.datos.adenda_id), revision: p.revision }); aviso('Plan actualizado', 'exito'); window.sgfRefrescar(); } catch (err) { fallo(err); }
}

async function editarControlCambio(x, d, editor) {
  const nueva = !x;
  x = x || { titulo: '', estado: 'BORRADOR', fecha: d.corte };
  const dis = editor ? '' : 'disabled';
  const r = await modal({
    titulo: nueva ? 'Registrar acta de control de cambios' : 'Acta de control de cambios',
    contenido: `<div class="form"><div class="campo ancho"><label>Título</label><input name="titulo" value="${esc(x.titulo)}" ${dis}></div>
      <div class="campo"><label>Estado</label><select name="estado" ${dis}>${opciones([['BORRADOR', 'Borrador'], ['APROBADO', 'Aprobado'], ['RECHAZADO', 'Rechazado']], x.estado)}</select></div>
      <div class="campo"><label>Fecha</label><input type="date" name="fecha" value="${esc(x.fecha || '')}" ${dis}></div>
      <div class="campo ancho"><label>Documento</label><input name="documento_ref" value="${esc(x.documento_ref || '')}" ${dis}></div>
      <div class="campo ancho"><label>Observación</label><textarea name="observacion" ${dis}>${esc(x.observacion || '')}</textarea></div></div>`,
    botones: editor ? [{ texto: 'Cancelar', valor: null }, { texto: 'Guardar', clase: 'prim', valor: 'ok' }] : [{ texto: 'Cerrar', valor: null }],
  });
  if (r.valor !== 'ok') return;
  try {
    if (nueva) await api('POST', '/controles-cambio', { ...r.datos, consultor_id: d.consultor.consultor_id });
    else await api('PATCH', `/controles-cambio/${x.control_cambio_id}`, { ...r.datos, revision: x.revision });
    aviso('Acta guardada', 'exito'); window.sgfRefrescar();
  } catch (err) { fallo(err); }
}

async function editarConsultor(d) {
  const c = d.consultor;
  const admin = puede('ADMIN');
  const r = await modal({
    titulo: 'Datos del profesional',
    contenido: `<div class="form">
      <div class="campo ancho"><label>Nombres</label><input name="nombres" value="${esc(c.nombres)}"></div>
      <div class="campo ancho"><label>Perfil / servicio</label><input name="perfil" value="${esc(c.perfil || '')}"></div>
      <div class="campo"><label>Recurso en cronograma</label><input name="recurso_cronograma" value="${esc(c.recurso_cronograma || '')}"></div>
      <div class="campo"><label>Correo institucional</label><input name="correo_institucional" value="${esc(c.correo_institucional || '')}"></div>
      <div class="campo"><label>Estado</label><select name="estado">${opciones([['ACTIVO', 'Activo'], ['NO_RENOVADO', 'No renovado'], ['CULMINADO', 'Culminado']], c.estado)}</select></div>
      ${admin ? `<div class="campo"><label>DNI (reservado)</label><input name="dni" value="${esc(c.dni || '')}"></div>
      <div class="campo"><label>Teléfono (reservado)</label><input name="telefono" value="${esc(c.telefono || '')}"></div>
      <div class="campo"><label>Correo personal (reservado)</label><input name="correo_personal" value="${esc(c.correo_personal || '')}"></div>
      <p class="mut2 ancho" style="margin:0">Datos personales visibles solo para administradores y nunca enviados al asistente de IA (Ley N.° 29733).</p>` : ''}
      <div class="campo ancho"><label>Observación</label><textarea name="observacion">${esc(c.observacion || '')}</textarea></div></div>`,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Guardar', clase: 'prim', valor: 'ok' }],
  });
  if (r.valor !== 'ok') return;
  try { await api('PATCH', `/consultores/${c.consultor_id}`, { ...r.datos, revision: c.revision }); aviso('Datos actualizados', 'exito'); window.sgfRefrescar(); } catch (err) { fallo(err); }
}

async function simular(d) {
  const acts = d.actividades.filter((a) => !a.es_resumen && a.estado !== 'ANULADA' && a.estado !== 'CONCLUIDA');
  const r = await modal({
    titulo: 'Simular escenario (no se guarda)',
    ancho: 900,
    contenido: `<p class="mut" style="margin:0">Modifique avance o fechas y vea el efecto en el término probable y la holgura. Nada se guarda.</p>
    <div class="tabla-env" style="max-height:420px"><table><thead><tr><th>N.°</th><th>Actividad</th><th>Avance %</th><th>Inicio plan</th><th>Fin plan</th><th>Fin probable actual</th></tr></thead><tbody>
    ${acts.map((a) => `<tr><td>${esc(a.numero)}</td><td class="desc">${esc(a.descripcion.slice(0, 90))}</td>
      <td><input class="en-linea" type="number" min="0" max="100" data-s="avance" data-id="${a.actividad_id}" value="${Number(a.avance)}"></td>
      <td><input class="en-linea" type="date" data-s="inicio_plan" data-id="${a.actividad_id}" value="${esc(a.inicio_plan)}"></td>
      <td><input class="en-linea" type="date" data-s="fin_plan" data-id="${a.actividad_id}" value="${esc(a.fin_plan)}"></td>
      <td class="num">${ff(a.pronostico && a.pronostico.fin_probable)}</td></tr>`).join('')}</tbody></table></div>`,
    botones: [{ texto: 'Cerrar', valor: null }, { texto: 'Simular', clase: 'prim', valor: 'ok' }],
  });
  if (r.valor !== 'ok') return;
  const cambios = {};
  r.form.querySelectorAll('[data-s]').forEach((inp) => {
    const a = acts.find((x) => x.actividad_id === Number(inp.dataset.id));
    const orig = inp.dataset.s === 'avance' ? Number(a.avance) : a[inp.dataset.s];
    const val = inp.dataset.s === 'avance' ? Number(inp.value) : inp.value;
    if (String(val) !== String(orig)) { cambios[a.actividad_id] = cambios[a.actividad_id] || { actividad_id: a.actividad_id }; cambios[a.actividad_id][inp.dataset.s] = val; }
  });
  if (!Object.keys(cambios).length) { aviso('No modificó ningún valor'); return; }
  try {
    const s = await api('POST', '/simular', { cambios: Object.values(cambios), corte: estado.corte || undefined });
    const i = s.impacto.find((x) => x.clave === d.consultor.clave);
    await modal({
      titulo: 'Resultado de la simulación',
      contenido: i ? `<div class="datos">
        <div class="dato"><small>Término probable</small><b class="num">${ff(i.fin_probable_antes)} → ${ff(i.fin_probable_despues)}</b></div>
        <div class="dato"><small>Holgura</small><b>${holguraBadge(i.holgura_antes)} → ${holguraBadge(i.holgura_despues)}</b></div>
        <div class="dato"><small>Semáforo</small><b>${badge(i.semaforo_antes)} → ${badge(i.semaforo_despues)}</b></div></div>
        <table><thead><tr><th>N.°</th><th>Actividad</th><th>Fin probable</th></tr></thead><tbody>${i.actividades.map((x) => `<tr><td>${esc(x.numero)}</td><td class="desc">${esc(x.descripcion.slice(0, 80))}</td><td class="num">${ff(x.fin_probable_antes)} → <b>${ff(x.fin_probable_despues)}</b></td></tr>`).join('')}</tbody></table>` : '<p>Los cambios no alteran el término probable.</p>',
    });
  } catch (err) { fallo(err); }
}

export async function verHistorial(entidad, id, tituloModal) {
  try {
    const h = await api('GET', `/historial/${entidad}/${id}`);
    const ocultar = new Set(['revision', 'valido_desde', 'valido_hasta', 'modificado_por', 'activo']);
    const filas = h.map((f, i) => {
      const prev = h[i - 1];
      const cambios = prev ? Object.keys(f).filter((k2) => !ocultar.has(k2) && String(f[k2] ?? '') !== String(prev[k2] ?? '')) : [];
      return `<tr><td class="num">${fh(f.valido_desde || '')}</td><td>${esc(f.modificado_por || '—')}</td><td class="diff">${i === 0 ? 'Versión inicial' : cambios.map((k2) => `${esc(k2)}: <del>${esc(prev[k2] ?? '∅')}</del> → <ins>${esc(f[k2] ?? '∅')}</ins>`).join('<br>')}</td></tr>`;
    });
    await modal({ titulo: tituloModal, ancho: 820, contenido: `<p class="mut2" style="margin:0">Fuente: historial de la tabla temporal (cada versión guardada).</p><table><thead><tr><th>Desde</th><th>Usuario</th><th>Cambios respecto a la versión anterior</th></tr></thead><tbody>${filas.reverse().join('')}</tbody></table>` });
  } catch (err) { fallo(err); }
}
