import { api, estado, esc, ff, ffc, titulo, badge, semaforo, diasBadge, holguraBadge, barraAvance, dia, puede, aviso, fallo } from '../util.js';

export async function vistaTablero(el) {
  const q = estado.corte ? `?corte=${estado.corte}` : '';
  const e = await api('GET', `/estado${q}`);
  if (!estado.corte) { const c = document.getElementById('corte'); if (c && !c.value) c.value = e.corte; }
  titulo('Tablero de seguimiento', `Corte ${ff(e.corte)} · pronóstico por ${e.metodo === 'RENDIMIENTO' ? 'rendimiento (SPI)' : 'avance lineal'} · ${e.consultores.length} profesionales`);
  const k = e.indicadores;

  el.innerHTML = `
  <div class="kpis">
    <div class="tarjeta kpi"><div class="v num">${k.consultores}</div><div class="e">Profesionales en seguimiento</div></div>
    <div class="tarjeta kpi ${k.vencen_15_dias ? 'ambar' : ''}"><div class="v num">${k.vencen_15_dias}</div><div class="e">Vigencias que vencen en ≤ 15 días</div></div>
    <div class="tarjeta kpi ${k.planes_exceden_vigencia ? 'rojo' : 'verde'}"><div class="v num">${k.planes_exceden_vigencia}</div><div class="e">Planes cuyo término probable excede la vigencia</div></div>
    <div class="tarjeta kpi ${k.actividades_atrasadas ? 'ambar' : ''}"><div class="v num">${k.actividades_atrasadas}<span class="mut" style="font-size:14px"> / ${k.actividades}</span></div><div class="e">Actividades atrasadas o sin iniciar vencidas</div></div>
    <div class="tarjeta kpi"><div class="v num">${k.avance_ponderado}%</div><div class="e">Avance registrado (esperado ${k.avance_esperado}%)</div></div>
    <div class="tarjeta kpi ${k.alertas_altas ? 'rojo' : ''}"><div class="v num">${k.alertas_altas}</div><div class="e">Alertas de prioridad alta (${k.alertas_total} en total)</div></div>
  </div>
  ${k.avance_ponderado === 0 && k.avance_esperado > 0 ? `<div class="tarjeta"><div class="cuerpo" style="display:flex;gap:10px;align-items:center">${badge('MEDIA', 'Importante')}<span>No hay avance registrado en ninguna actividad: el pronóstico asume que lo vencido no se ejecutó. Registre el avance real en cada ficha para obtener fechas probables confiables.</span></div></div>` : ''}
  <div class="tarjeta">
    <div class="cab"><h2>Vigencia contractual vs. término probable del plan</h2>
      <div class="leyenda"><span><i style="background:var(--marca-suave);border:1px solid var(--marca-2)"></i>Vigencia (adenda firmada)</span><span><i style="border:1px dashed var(--ambar)"></i>Adenda anunciada / en trámite</span><span><i style="background:var(--rojo);width:4px"></i>Término probable</span><span><i style="background:var(--azul);width:2px"></i>Corte</span></div></div>
    <div class="cuerpo" id="vig"></div>
  </div>
  <div class="tarjeta">
      <div class="cab"><h2>Profesionales</h2><div class="acciones">
        <a class="btn peq" href="/api/exportar/actividades.csv">Exportar actividades (CSV)</a>
        ${puede('EDITOR') ? '<button class="btn peq" id="b-recalc">Recalcular y guardar corte</button>' : ''}</div></div>
      <div class="cuerpo sin tabla-env"><table>
        <thead><tr><th></th><th>Profesional</th><th>Vigencia</th><th>Restan</th><th>Adenda siguiente</th><th>Fin plan</th><th>Término probable</th><th>Holgura</th><th>Avance</th><th class="c">Alertas</th></tr></thead>
        <tbody>${e.consultores.map((c) => {
          const v = c.vigencia; const p = c.pronostico;
          return `<tr class="clic" data-id="${c.consultor_id}">
            <td>${semaforo(v.semaforo)}</td>
            <td><b>${esc(c.nombres)}</b> <span class="mut2">${esc(c.clave)}</span><br><span class="mut2">${esc(c.perfil || '')}</span></td>
            <td class="num">${v.adenda_vigente ? `Ad. ${String(v.adenda_vigente.numero).padStart(2, '0')} · ${ff(v.fin_vigencia)}` : '—'}</td>
            <td>${diasBadge(v.dias_restantes)}</td>
            <td>${v.adenda_siguiente ? `${badge(v.adenda_siguiente.estado, `Ad. ${String(v.adenda_siguiente.numero).padStart(2, '0')} ${(v.adenda_siguiente.estado === 'ANUNCIADA' ? 'anunciada' : 'en trámite')}`)}<br><span class="mut2">hasta ${ff(v.fin_vigencia_potencial)}</span>` : '<span class="mut2">—</span>'}</td>
            <td class="num">${p && p.fin_plan ? ff(p.fin_plan) : badge(c.plan ? c.plan.estado : 'POR_REGISTRAR')}</td>
            <td class="num"><b>${p && p.fin_probable ? ff(p.fin_probable) : '—'}</b>${c.atrasadas ? `<br><span class="mut2">${c.atrasadas} act. atrasadas</span>` : ''}</td>
            <td>${holguraBadge(v.holgura_dias)}</td>
            <td>${p && p.numero_actividades ? barraAvance(p.avance_ponderado, p.avance_esperado) : '<span class="mut2">—</span>'}</td>
            <td class="c">${c.alertas ? `<span class="badge b-ambar">${c.alertas}</span>` : ''}</td></tr>`;
        }).join('')}</tbody></table></div>
  </div>
    <div class="tarjeta">
      <div class="cab"><h2>Alertas</h2><select id="f-prio" class="en-linea"><option value="">Todas</option><option value="ALTA">Alta</option><option value="MEDIA">Media</option></select></div>
      <div class="cuerpo sin" id="alertas" style="max-height:560px;overflow:auto"></div>
  </div>`;

  dibujarVigencias(el.querySelector('#vig'), e);
  const pintarAlertas = (prio) => {
    const lista = e.alertas.filter((a) => !prio || a.prioridad === prio);
    el.querySelector('#alertas').innerHTML = lista.length ? lista.map((a) => `<div class="alerta">${badge(a.prioridad)}<div class="t"><a href="#/consultor/${a.consultor_id}">${esc(a.clave)}</a> · ${esc(a.titulo)}</div><div class="d">${esc(a.detalle)}</div><div class="a">→ ${esc(a.accion)}</div></div>`).join('') : '<div class="vacio">Sin alertas</div>';
  };
  pintarAlertas('');
  el.querySelector('#f-prio').onchange = (ev) => pintarAlertas(ev.target.value);
  el.querySelectorAll('tr.clic').forEach((tr) => { tr.onclick = () => { location.hash = `#/consultor/${tr.dataset.id}`; }; });
  const br = el.querySelector('#b-recalc');
  if (br) br.onclick = async () => { try { await api('POST', '/recalcular', { motivo: 'Recálculo manual desde el tablero' }); aviso('Pronóstico recalculado y guardado', 'exito'); window.sgfRefrescar(); } catch (err) { fallo(err); } };
}

function dibujarVigencias(cont, e) {
  const filas = e.consultores;
  const fechas = [e.corte];
  for (const c of filas) {
    const v = c.vigencia;
    if (v.adenda_vigente) fechas.push(v.adenda_vigente.fecha_inicio, v.fin_vigencia);
    if (v.fin_vigencia_potencial) fechas.push(v.fin_vigencia_potencial);
    if (c.pronostico && c.pronostico.fin_probable) fechas.push(c.pronostico.fin_probable);
  }
  const d0 = Math.min(...fechas.filter(Boolean).map(dia)) - 3;
  const d1 = Math.max(...fechas.filter(Boolean).map(dia)) + 3;
  const x = (f) => `${((dia(f) - d0) / (d1 - d0)) * 100}%`;
  const w = (a, b) => `${((dia(b) - dia(a) + 1) / (d1 - d0)) * 100}%`;
  const marcas = [];
  for (let d = d0; d <= d1; d += 1) {
    const f = new Date(d * 86400000).toISOString().slice(0, 10);
    if (f.endsWith('-01') || f.endsWith('-15')) marcas.push(f);
  }
  cont.innerHTML = `<div class="vig-fila"><span></span><div class="gantt-cab">${marcas.map((m) => `<span style="left:${x(m)}">${ffc(m)}</span>`).join('')}</div><span></span></div>
  ${filas.map((c) => {
    const v = c.vigencia;
    const fp = c.pronostico && c.pronostico.fin_probable;
    return `<div class="vig-fila" title="${esc(c.nombres)}: vigencia hasta ${ff(v.fin_vigencia)}; término probable ${ff(fp)}">
      <b><a href="#/consultor/${c.consultor_id}">${esc(c.clave)}</a></b>
      <div class="vig-pista">
        ${v.adenda_vigente ? `<div class="vigencia" style="left:${x(v.adenda_vigente.fecha_inicio)};width:${w(v.adenda_vigente.fecha_inicio, v.fin_vigencia)}"></div>` : ''}
        ${v.adenda_siguiente ? `<div class="potencial" style="left:${x(v.adenda_siguiente.fecha_inicio)};width:${w(v.adenda_siguiente.fecha_inicio, v.adenda_siguiente.fecha_fin)}"></div>` : ''}
        <div class="hoy" style="left:${x(e.corte)}"></div>
        ${fp ? `<div class="fin ${v.semaforo}" style="left:calc(${x(fp)} - 2px)"></div>` : ''}
      </div>
      <span>${holguraBadge(v.holgura_dias)}</span></div>`;
  }).join('')}`;
}
