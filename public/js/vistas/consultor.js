import { api, enviarConMotivo, estado, esc, ff, ffc, fh, pct, titulo, badge, semaforo, diasBadge, holguraBadge, barraAvance, dia, puede, aviso, fallo, modal, opciones, ETIQ } from '../util.js';
import { abrirAsistente } from './asistente.js';

const ESTADOS = ['PENDIENTE', 'EN_CURSO', 'CONCLUIDA', 'SUSPENDIDA'];
const CLASIF = ['ALINEADA', 'REASIGNADA', 'NUEVA', 'TRANSVERSAL'];

export async function vistaConsultor(el, [id]) {
  const q = estado.corte ? `?corte=${estado.corte}` : '';
  const [d, bit] = await Promise.all([api('GET', `/consultores/${id}${q}`), api('GET', `/bitacora?consultor_id=${id}&limite=25`)]);
  const c = d.consultor; const v = d.vigencia; const p = d.pronostico; const k = d.contrato || {};
  const editor = puede('EDITOR');
  titulo(c.nombres, `${esc(c.clave)} · ${esc(c.perfil || '')} · corte ${ff(d.corte)}`);
  const iniciales = c.nombres.split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('');
  const desvioPlan = p && p.fin_probable && p.fin_plan ? dia(p.fin_probable) - dia(p.fin_plan) : null;

  el.innerHTML = `
  <div class="tarjeta"><div class="cuerpo ficha-cab">
    <div class="id"><div class="avatar">${esc(iniciales)}</div><div>
      <h2>${esc(c.nombres)} <span class="mut2">${esc(c.clave)}</span></h2>
      <div class="mut">${esc(k.numero || 'Sin contrato')} · ${esc(k.expediente || '')}</div>
      <div class="mut2">${esc(k.titulo_tdr || '')}${c.recurso_cronograma ? ` · Recurso en cronograma: ${esc(c.recurso_cronograma)}` : ''}</div></div></div>
    <div class="acciones">${badge(v.semaforo)}
      ${estado.ia ? '<button class="btn" id="b-ia">Preguntar al asistente</button>' : ''}
      ${editor ? '<button class="btn" id="b-datos">Editar datos</button>' : ''}<a class="btn" href="#/">← Tablero</a></div>
  </div>${c.observacion ? `<div class="cuerpo mut" style="border-top:1px solid var(--borde);padding-top:10px">${esc(c.observacion)}</div>` : ''}</div>

  <div class="rejilla-2">
    <div class="tarjeta"><div class="cab"><h2>Vigencia contractual</h2>${editor ? '<button class="btn peq prim" id="b-adenda">Registrar adenda</button>' : ''}</div>
      <div class="cuerpo" style="display:grid;gap:14px">
        <div class="datos">
          <div class="dato"><small>Adenda vigente</small><b>${v.adenda_vigente ? `N.° ${String(v.adenda_vigente.numero).padStart(2, '0')}` : '—'}</b></div>
          <div class="dato"><small>Fin de vigencia</small><b class="num">${ff(v.fin_vigencia)}</b></div>
          <div class="dato"><small>Días restantes</small><b>${diasBadge(v.dias_restantes)}</b></div>
          <div class="dato"><small>Holgura vs. término probable</small><b>${holguraBadge(v.holgura_dias)}</b></div>
          <div class="dato"><small>Vigencia potencial</small><b class="num">${v.adenda_siguiente ? `${ff(v.fin_vigencia_potencial)} ${holguraBadge(v.holgura_potencial_dias)}` : '—'}</b></div>
        </div>
        <div class="adendas">${d.adendas.map((a) => `<div class="adenda ${a.estado}" data-adenda="${a.adenda_id}" title="Clic para ver o editar">
          <div><b>Adenda N.° ${String(a.numero).padStart(2, '0')}</b> ${badge(a.estado)}</div>
          <div class="num mut">${ff(a.fecha_inicio)} – ${ff(a.fecha_fin)}</div>
          <div class="mut2">${esc(a.documento_ref || 'Sin documento')}</div></div>`).join('') || '<span class="mut">Sin adendas registradas</span>'}</div>
      </div></div>
    <div class="tarjeta"><div class="cab"><h2>Alertas del profesional</h2></div><div class="cuerpo sin" style="max-height:260px;overflow:auto">
      ${d.alertas.map((a) => `<div class="alerta">${badge(a.prioridad)}<div class="t">${esc(a.titulo)}</div><div class="d">${esc(a.detalle)}</div><div class="a">→ ${esc(a.accion)}</div></div>`).join('') || '<div class="vacio">Sin alertas</div>'}</div></div>
  </div>

  <div class="tarjeta">
    <div class="cab"><div><h2>${esc(d.plan ? d.plan.nombre : 'Sin plan de trabajo')}</h2>
      ${d.plan ? `<span class="mut2">${badge(d.plan.estado)} · ${esc(d.plan.fuente || '')} ${d.plan.fecha_recepcion ? ` · recibido ${ff(d.plan.fecha_recepcion)}` : ''} · días ${d.plan.tipo_dias === 'HABILES' ? 'hábiles' : 'calendario'}</span>` : ''}</div>
      <div class="acciones">${d.plan && editor ? `
        <button class="btn peq" id="b-plan">Editar plan</button>
        <button class="btn peq" id="b-simular">Simular</button>
        <button class="btn peq" id="b-adoptar" title="Convierte las fechas probables en las nuevas fechas del plan (reprogramación formal con motivo)">Adoptar fechas probables</button>
        <button class="btn peq prim" id="b-nueva">Agregar actividad</button>` : ''}</div></div>
    ${p ? `<div class="cuerpo"><div class="datos">
      <div class="dato"><small>Inicio del plan</small><b class="num">${ff(p.inicio_plan)}</b></div>
      <div class="dato"><small>Fin del plan</small><b class="num">${ff(p.fin_plan)}</b></div>
      <div class="dato"><small>Término probable</small><b class="num">${ff(p.fin_probable)} ${desvioPlan ? `<span class="badge ${desvioPlan > 0 ? 'b-rojo' : 'b-verde'}">${desvioPlan > 0 ? '+' : ''}${desvioPlan} d</span>` : ''}</b></div>
      <div class="dato"><small>Avance real / esperado</small>${barraAvance(p.avance_ponderado, p.avance_esperado)}</div>
      <div class="dato"><small>SPI (índice de cronograma)</small><b class="num ${p.spi !== null && p.spi < 0.9 ? 'bad' : ''}">${p.spi ?? '—'}</b></div>
      <div class="dato"><small>Actividades</small><b class="num">${p.numero_actividades}</b></div>
    </div></div>` : ''}
    <div class="cuerpo" style="border-top:1px solid var(--borde);padding-top:10px"><div class="leyenda">
      <span><i style="border:1.5px solid var(--borde-fuerte);background:var(--superficie-2)"></i>Plan formulado</span>
      <span><i style="background:var(--azul)"></i>Probable en plazo</span><span><i style="background:var(--rojo)"></i>Atrasada</span><span><i style="background:var(--verde)"></i>Concluida</span>
      <span><i style="border-left:2px dashed var(--azul);width:2px;height:12px"></i>Corte</span><span><i style="border-left:2px dashed var(--rojo);width:2px;height:12px"></i>Fin de vigencia</span><span><i style="border-left:2px dashed var(--ambar);width:2px;height:12px"></i>Vigencia potencial</span>
      <span class="critica">◆</span> ruta crítica</div></div>
    <div class="cuerpo sin tabla-env" id="tabla-act"></div>
  </div>

  <div class="rejilla-2">
    <div class="tarjeta"><div class="cab"><h2>Línea base 2026 (entregables asignados)</h2></div><div class="cuerpo sin tabla-env"><table>
      <thead><tr><th>EDT</th><th>Entregable</th><th>Fin LB</th><th class="d">Avance al corte LB</th><th>Cobertura</th><th>Situación</th></tr></thead>
      <tbody>${d.linea_base.map((e) => `<tr><td class="num">${esc(e.edt)}</td><td class="desc">${esc(e.nombre)}${e.actividades.length ? `<small>Actividades: ${e.actividades.map(esc).join(', ')}</small>` : ''}</td><td class="num">${ff(e.fin_lb)}</td><td class="d num">${pct(e.avance_corte)}</td><td>${badge(e.cobertura)}</td><td class="mut2">${esc(e.situacion || '')}${e.situacion_oti ? `<br><b>OTI:</b> ${esc(e.situacion_oti)}` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Sin entregables</td></tr>'}</tbody></table></div></div>
    <div style="display:grid;gap:18px;align-content:start">
      <div class="tarjeta"><div class="cab"><h2>Actas de control de cambios</h2>${editor ? '<button class="btn peq" id="b-cc">Registrar acta</button>' : ''}</div><div class="cuerpo sin">
        ${d.controles_cambio.map((x) => `<div class="alerta" data-cc="${x.control_cambio_id}" style="cursor:pointer">${badge(x.estado)}<div class="t">${esc(x.titulo)}</div><div class="d">${ff(x.fecha)} · ${esc(x.documento_ref || '')}</div></div>`).join('') || '<div class="vacio">Sin actas</div>'}</div></div>
      <div class="tarjeta"><div class="cab"><h2>Evolución del término probable</h2></div><div class="cuerpo">${evolucion(d.historial_pronostico)}</div></div>
    </div>
  </div>

  <div class="tarjeta"><div class="cab"><h2>Últimos cambios</h2><a class="btn peq" href="#/bitacora">Ver bitácora completa</a></div><div class="cuerpo sin tabla-env"><table>
    <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Registro</th><th>Cambios</th><th>Motivo</th></tr></thead>
    <tbody>${bit.map((b) => `<tr><td class="num">${fh(b.fecha)}</td><td>${esc(b.usuario)}${b.origen === 'IA' ? ' ' + badge('NUEVA', 'IA') : ''}</td><td>${esc(b.accion)}</td><td>${esc(b.entidad)} ${b.entidad_id ?? ''}</td><td class="diff">${diffHtml(b.cambios_json)}</td><td class="mut2">${esc(b.motivo || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Sin cambios registrados</td></tr>'}</tbody></table></div></div>`;

  pintarActividades(el.querySelector('#tabla-act'), d, editor);
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
  if (v.fin_vigencia_potencial) fechas.push(v.fin_vigencia_potencial);
  const d0 = Math.min(...fechas.filter(Boolean).map(dia)) - 1;
  const d1 = Math.max(...fechas.filter(Boolean).map(dia)) + 2;
  const x = (f) => ((dia(f) - d0) / (d1 - d0)) * 100;
  const w = (a, b) => Math.max(0.8, ((dia(b) - dia(a) + 1) / (d1 - d0)) * 100);
  const marcas = [];
  const rango = d1 - d0;
  const patron = rango <= 45 ? /-(01|08|15|22)$/ : rango <= 120 ? /-(01|15)$/ : /-01$/;
  for (let n = d0; n <= d1; n += 1) { const f = new Date(n * 86400000).toISOString().slice(0, 10); if (patron.test(f)) marcas.push(f); }
  const lineas = `<div class="linea corte" style="left:${x(d.corte)}%"></div>${v.fin_vigencia ? `<div class="linea vig" style="left:${x(v.fin_vigencia)}%"></div>` : ''}${v.fin_vigencia_potencial ? `<div class="linea pot" style="left:${x(v.fin_vigencia_potencial)}%"></div>` : ''}`;

  cont.innerHTML = `<table><thead><tr><th>N.°</th><th>Actividad</th><th>Fechas</th><th>Avance</th><th>Estado</th><th>Término probable</th><th style="min-width:380px;width:34%"><div class="gantt-cab">${marcas.map((m) => `<span style="left:${x(m)}%">${ffc(m)}</span>`).join('')}</div></th><th></th></tr></thead>
  <tbody>${acts.map((a) => {
    const pr = a.pronostico || {};
    const res = a.es_resumen;
    const anul = a.estado === 'ANULADA';
    const editable = editor && !res && !anul;
    return `<tr class="${res ? 'resumen' : ''} ${anul ? 'anulada' : ''}" data-act="${a.actividad_id}">
      <td class="num">${pr.critica ? '<span class="critica" title="Ruta crítica">◆</span> ' : ''}${esc(a.numero)}</td>
      <td class="desc">${esc(a.descripcion)}<small>${badge(a.clasificacion)} ${a.edt_ref ? esc(a.edt_ref) : ''}${a.es_hito ? ' · hito' : ''}${a.predecesoras.length ? ` · depende de ${a.predecesoras.map((p) => esc((acts.find((y) => y.actividad_id === p.predecesora_id) || {}).numero || p.predecesora_id)).join(', ')}` : ''}</small></td>
      <td class="num" style="white-space:nowrap"><span class="mut2">Plan</span> ${ffc(a.inicio_plan)}–${ffc(a.fin_plan)}<br><span class="mut2">Real</span> ${a.inicio_real || a.fin_real ? `${a.inicio_real ? ffc(a.inicio_real) : '…'}–${a.fin_real ? ffc(a.fin_real) : '…'}` : '<span class="mut2">sin registro</span>'}</td>
      <td>${editable ? `<input class="en-linea num" type="number" min="0" max="100" step="5" value="${Number(a.avance)}" data-campo="avance" aria-label="Avance %">` : `<span class="num">${pct(a.avance)}</span>`}</td>
      <td>${editable ? `<select class="en-linea" data-campo="estado" aria-label="Estado">${opciones(ESTADOS.map((s) => [s, ETIQ[s][0]]), a.estado)}</select>` : badge(a.estado)}</td>
      <td class="num">${pr.fin_probable ? `<b>${ff(pr.fin_probable)}</b><br>${pr.desvio_dias ? `<span class="badge ${pr.desvio_dias > 0 ? 'b-rojo' : 'b-verde'}">${pr.desvio_dias > 0 ? '+' : ''}${pr.desvio_dias} d</span>` : ''} ${pr.situacion && pr.situacion !== 'EN_PLAZO' && pr.situacion !== 'PROGRAMADA' ? badge(pr.situacion) : ''}` : '—'}</td>
      <td><div class="gantt">${lineas}
        <div class="plan" style="left:${x(a.inicio_plan)}%;width:${w(a.inicio_plan, a.fin_plan)}%" title="Plan: ${ff(a.inicio_plan)} – ${ff(a.fin_plan)}"></div>
        ${pr.inicio_probable ? `<div class="prob ${esc(pr.situacion)}" style="left:${x(pr.inicio_probable)}%;width:${w(pr.inicio_probable, pr.fin_probable)}%" title="Probable: ${ff(pr.inicio_probable)} – ${ff(pr.fin_probable)}"><div class="lleno" style="width:${Number(a.avance)}%"></div></div>` : ''}</div></td>
      <td>${!res && !anul ? `<button class="btn peq" data-editar="${a.actividad_id}">${editor ? 'Editar' : 'Ver'}</button>` : ''}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function conectar(el, d, editor) {
  const refrescar = () => window.sgfRefrescar();
  const act = (id) => d.actividades.find((a) => a.actividad_id === Number(id));

  el.querySelectorAll('[data-campo]').forEach((inp) => {
    inp.onchange = async () => {
      if (inp.disabled) return;
      inp.disabled = true;
      const a = act(inp.closest('tr').dataset.act);
      const valor = inp.dataset.campo === 'avance' ? Number(inp.value) : inp.value;
      try {
        const r = await enviarConMotivo('PATCH', `/actividades/${a.actividad_id}`, { [inp.dataset.campo]: valor, revision: a.revision });
        aviso(`Actividad ${a.numero} actualizada · pronóstico recalculado${r.finRealAsumido ? `. Fin real asumido: ${ff(r.fila.fin_real)} (corríjalo con «Editar» si fue otra fecha)` : ''}`, 'exito');
        refrescar();
      } catch (err) { inp.disabled = false; fallo(err); if (err.estado === 409 || err.cancelado) refrescar(); }
    };
  });
  el.querySelectorAll('[data-editar]').forEach((b) => { b.onclick = () => editarActividad(act(b.dataset.editar), d, editor); });
  el.querySelectorAll('[data-adenda]').forEach((x) => { x.onclick = () => editarAdenda(d.adendas.find((a) => a.adenda_id === Number(x.dataset.adenda)), d, editor); });
  el.querySelectorAll('[data-cc]').forEach((x) => { x.onclick = () => editarControlCambio(d.controles_cambio.find((a) => a.control_cambio_id === Number(x.dataset.cc)), d, editor); });
  const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = fn; };
  on('#b-ia', () => abrirAsistente({ consultor_id: d.consultor.consultor_id, texto: `Analiza la situación de ${d.consultor.nombres}: vigencia, término probable, actividades críticas y qué debo hacer esta semana.` }));
  on('#b-adenda', () => editarAdenda(null, d, editor));
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

async function editarActividad(a, d, editor) {
  const nueva = !a;
  a = a || { numero: '', descripcion: '', producto: '', edt_ref: '', clasificacion: 'ALINEADA', inicio_plan: d.corte, fin_plan: d.corte, avance: 0, estado: 'PENDIENTE', es_hito: 0, predecesoras: [] };
  const otras = d.actividades.filter((x) => x.actividad_id !== a.actividad_id && !x.es_resumen && x.estado !== 'ANULADA');
  const preds = new Map((a.predecesoras || []).map((p) => [p.predecesora_id, p.desfase_dias]));
  const dis = editor ? '' : 'disabled';
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
      <div class="campo"><label>Avance %</label><input type="number" min="0" max="100" name="avance" value="${Number(a.avance)}" ${dis}></div>
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
    botones: editor ? [
      ...(nueva ? [] : [{ texto: 'Historial', valor: 'historial' }, { texto: 'Anular', clase: 'peligro', valor: 'anular' }]),
      { texto: 'Cancelar', valor: null }, { texto: 'Guardar', clase: 'prim', valor: 'guardar' },
    ] : [{ texto: 'Historial', valor: 'historial' }, { texto: 'Cerrar', valor: null }],
  });
  if (!r.valor) return;
  if (r.valor === 'historial') return verHistorial('actividad', a.actividad_id, `Historial de la actividad ${a.numero}`);
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

async function editarAdenda(a, d, editor) {
  const nueva = !a;
  const ultima = d.adendas[d.adendas.length - 1];
  a = a || { numero: ultima ? ultima.numero + 1 : 1, estado: 'EN_TRAMITE', fecha_inicio: ultima ? new Date((dia(ultima.fecha_fin) + 1) * 86400000).toISOString().slice(0, 10) : d.corte, fecha_fin: '', expediente: d.contrato && d.contrato.expediente };
  const dis = editor ? '' : 'disabled';
  const r = await modal({
    titulo: nueva ? 'Registrar adenda' : `Adenda N.° ${String(a.numero).padStart(2, '0')}`,
    contenido: `<div class="form">
      <div class="campo"><label>N.° de adenda</label><input type="number" name="numero" value="${esc(a.numero)}" ${dis}></div>
      <div class="campo"><label>Estado</label><select name="estado" ${dis}>${opciones([['ANUNCIADA', 'Anunciada (sin documento)'], ['EN_TRAMITE', 'En trámite'], ['FIRMADA', 'Firmada'], ['ANULADA', 'Anulada']], a.estado)}</select></div>
      <div class="campo"><label>Inicio</label><input type="date" name="fecha_inicio" value="${esc(a.fecha_inicio || '')}" ${dis}></div>
      <div class="campo"><label>Fin</label><input type="date" name="fecha_fin" value="${esc(a.fecha_fin || '')}" ${dis}></div>
      <div class="campo"><label>Fecha de suscripción</label><input type="date" name="fecha_suscripcion" value="${esc(a.fecha_suscripcion || '')}" ${dis}></div>
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
