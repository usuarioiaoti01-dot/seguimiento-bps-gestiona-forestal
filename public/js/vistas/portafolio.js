// Tablero general (OTI Visual v2, docs/diseno/REDISENO-TABLERO-OTI.md §6): banda de resumen → ¿qué requiere atención
// hoy? → tarjetas analíticas (semáforo, avance, ciclo de la OS) → proyectos (tarjetas o tabla) → línea de tiempo.
// Las cifras las calcula el servidor (motor/portafolio.js); aquí solo se ordenan, se filtran y se dibujan.
import { api, esc, ff, titulo, estado, opciones, insignia, semInfo, SEMAFORO, accionesCabecera, panelLateral, ICONOS } from '../util.js';
import { fijarProyecto, pintarSelectorProyecto } from './proyectos.js';

// Estado del proyecto: chip neutro (no usa colores de semáforo); glifo + texto
const ESTADO_CHIP = { REGISTRADO: ['○', 'g-reg', 'Registrado'], EN_EJECUCION: ['●', 'g-ejec', 'En ejecución'], SUSPENDIDO: ['‖', '', 'Suspendido'], CONCLUIDO: ['✓', 'g-fin', 'Concluido'], CERRADO: ['✓', 'g-fin', 'Cerrado'], ANULADO: ['✕', '', 'Anulado'] };
export const TITULO_APP = 'SEGUIMIENTO DE PROYECTOS DE LA OFICINA DE TECNOLOGÍAS DE LA INFORMACIÓN';
const MODALIDAD = { ORDEN_SERVICIO: 'Orden de servicio', CONTRATO_ADENDAS: 'Contrato con adendas', GESTION_INTERNA: 'Gestión interna' };
const AYUDA_SEM = {
  ROJO: 'Hay un entregable vencido o una vigencia en riesgo.',
  AMBAR: 'Algo vence pronto: conviene anticiparse.',
  VERDE: 'Entregables y vigencias dentro de plazo.',
  GRIS: 'Aún sin profesionales u órdenes de servicio que seguir.',
};
const soles = (n) => `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n) => `${Number(n).toLocaleString('es-PE', { maximumFractionDigits: 1 })} %`;
const sinMovimiento = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const esMovil = () => window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
/** Plazo relativo desde la fecha de corte: consecuencia, no signo. */
function plazo(dias) {
  if (dias === null || dias === undefined) return '';
  if (dias < 0) return `vencido hace ${-dias} d`;
  if (dias === 0) return 'vence hoy';
  if (dias === 1) return 'vence mañana';
  return `vence en ${dias} d`;
}
const chipPlazo = (pe) => { if (!pe || pe.dias === null || pe.dias === undefined) return ''; const s = pe.dias < 0 ? 'ROJO' : pe.semaforo === 'AMBAR' ? 'AMBAR' : pe.semaforo === 'ROJO' ? 'ROJO' : 'VERDE'; return insignia(s, plazo(pe.dias)); };
const chipEstado = (e) => { const [g, c, t] = ESTADO_CHIP[e] || ['–', '', e]; return `<span class="ins ins-neutro"><span class="${c}" aria-hidden="true">${g}</span>${esc(t)}</span>`; };

// ---------------------------------------------------------------- filtros (en la URL y recordados en el navegador)
const CLAVE = 'sgf_filtros_portafolio';
const PARAM = { situacion: 'situacion', area: 'gestion', responsable: 'resp', anio: 'anio', semaforo: 'sem', texto: 'q', tema: 'tema', mios: 'mios' };
const BASE = { situacion: 'en_curso', area: '', responsable: '', anio: '', semaforo: '', texto: '', tema: '', mios: false };
const leerGuardados = () => { try { return JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch { return {}; } };
function leerUrl() {
  const q = new URLSearchParams((location.hash.split('?')[1]) || '');
  const f = {};
  for (const [k, p] of Object.entries(PARAM)) if (q.has(p)) f[k] = k === 'mios' ? q.get(p) === '1' : q.get(p);
  return f;
}
function guardar(f) {
  const q = new URLSearchParams();
  for (const [k, p] of Object.entries(PARAM)) {
    const v = f[k];
    if (k === 'situacion' ? v && v !== 'en_curso' : v) q.set(p, k === 'mios' ? '1' : v);
  }
  const s = q.toString();
  history.replaceState(null, '', `${location.pathname}${location.search}#/${s ? `?${s}` : ''}`);
  try { localStorage.setItem(CLAVE, JSON.stringify(f)); } catch { /* sin almacenamiento */ }
}
const claveVista = () => `sgf_vista_portafolio:${(estado.usuario && estado.usuario.correo) || ''}`;
const leerVista = () => { try { return localStorage.getItem(claveVista()) || 'tarjetas'; } catch { return 'tarjetas'; } };
const guardarVista = (v) => { try { localStorage.setItem(claveVista(), v); } catch { /* sin almacenamiento */ } };

/** «Ver» de cada fila de atención y pasos del ciclo: qué proyectos se muestran. */
const TEMAS = {
  vencidos: ['con entregables vencidos', (p) => p.entregables.vencidos > 0],
  conformidad: ['con conformidades fuera de plazo', (p) => p.entregables.revision_vencida > 0],
  por_vencer: ['con entregables por vencer', (p) => p.entregables.por_vencer > 0],
  os: ['con órdenes de servicio sin notificar', (p) => p.os_sin_notificar > 0],
  vigencia: ['con vigencias por vencer', (p) => p.vencen_15_dias > 0],
  sin_parte: ['sin parte diario reciente', (p) => p.sin_parte],
  sin_resp: ['sin responsable asignado', (p) => p.en_curso && !p.responsable],
  ejecucion: ['con órdenes de servicio en ejecución', (p) => p.os_en_ejecucion > 0],
  revision: ['con entregables en revisión', (p) => p.entregables.en_revision > 0],
  conformes: ['con entregables conformes', (p) => p.entregables.conformes > 0],
  culminadas: ['con órdenes de servicio culminadas', (p) => p.os_culminadas > 0],
};

// ---------------------------------------------------------------- animación (sin librerías; nada si se pidió reducir movimiento)
const contar = (valor, fmt = 'n') => `<span data-contar="${Number(valor) || 0}" data-fmt="${fmt}">${fmt === 'soles' ? soles(valor) : fmt === 'pct' ? pct(valor) : Number(valor || 0).toLocaleString('es-PE')}</span>`;
function animar(raiz) {
  if (!raiz) return;
  const quieto = sinMovimiento();
  raiz.querySelectorAll('[data-contar]').forEach((el) => {
    const fin = Number(el.dataset.contar); const fmt = el.dataset.fmt;
    const escribir = (v) => { el.textContent = fmt === 'soles' ? soles(v) : fmt === 'pct' ? pct(Math.round(v * 10) / 10) : Math.round(v).toLocaleString('es-PE'); };
    if (quieto || !fin) { escribir(fin); return; }
    const t0 = performance.now(); const dur = 900;
    const paso = (t) => { const k = Math.min(1, (t - t0) / dur); escribir(fin * (1 - (1 - k) ** 3)); if (k < 1) requestAnimationFrame(paso); };
    escribir(0); requestAnimationFrame(paso);
  });
  const aplicar = () => {
    raiz.querySelectorAll('[data-dash]').forEach((el) => { el.style.strokeDasharray = el.dataset.dash; });
    raiz.querySelectorAll('[data-offset]').forEach((el) => { el.style.strokeDashoffset = el.dataset.offset; });
    raiz.querySelectorAll('[data-ancho]').forEach((el) => { el.style.width = el.dataset.ancho; });
  };
  if (quieto) aplicar(); else requestAnimationFrame(() => requestAnimationFrame(aplicar));
}

// ---------------------------------------------------------------- 6.1 banda de resumen
function banda(r, d) {
  const m = d.montos;
  const conf = m.proyectos_con_monto && m.comprometido ? (m.conforme / m.comprometido) * 100 : 0;
  return `<section class="banda aparecer" aria-label="Resumen de la cartera">
    <div class="banda-cab">
      <div class="banda-logo"><img src="img/serfor.png" alt="SERFOR – Servicio Nacional Forestal y de Fauna Silvestre" width="265" height="60"></div>
      <div class="banda-id"><h2 class="banda-titulo">${TITULO_APP}</h2><span class="banda-sub">Tablero general · todos los proyectos de la OTI, en curso y terminados</span></div>
    </div>
    <div class="banda-cifras">
    <button type="button" class="banda-celda" data-banda="en_curso"><span class="ov">Proyectos en curso</span><span class="banda-num">${contar(r.en_curso)}</span><span class="banda-sub">${r.terminados_anio} terminado(s) en ${String(r.corte).slice(0, 4)}</span></button>
    <button type="button" class="banda-celda" data-banda="ejecucion"><span class="ov">Órdenes de servicio en ejecución</span><span class="banda-num">${contar(r.os_en_ejecucion)}</span><span class="banda-sub">${r.os_sin_notificar} registrada(s) sin notificar</span></button>
    <div class="banda-celda"><span class="ov">Monto comprometido</span>${m.proyectos_con_monto
      ? `<span class="banda-num">${contar(m.comprometido, 'soles')}</span><div class="banda-pista" role="img" aria-label="${pct(Math.round(conf * 10) / 10)} con conformidad"><div class="banda-real" data-ancho="${Math.min(100, conf)}%"></div></div><span class="banda-sub num">${soles(m.conforme)} con conformidad · ${pct(Math.round(conf * 10) / 10)}</span>`
      : '<span class="banda-num">—</span><span class="banda-sub">Solo visible para el equipo de cada proyecto</span>'}</div>
    <div class="banda-celda"><span class="ov">Avance promedio</span><span class="banda-num">${r.avance_promedio === null || r.avance_promedio === undefined ? '—' : contar(r.avance_promedio, 'pct')}</span><span class="banda-sub">De los proyectos en curso</span></div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- 6.2 ¿qué requiere atención hoy?
function acciones(d, r) {
  const lista = []; const admin = estado.usuario && estado.usuario.rol === 'ADMIN';
  const enCurso = d.proyectos.filter((p) => p.en_curso);
  for (const p of enCurso) {
    const pe = p.proximo_entregable;
    if (p.semaforo === 'ROJO' && p.alertas.total) lista.push({ sev: 'risk', orden: -1, titulo: `${p.codigo} · ${p.alertas.altas} alerta(s) de prioridad alta de ${p.alertas.total}`, sub: `${p.nombre} · ${(MODALIDAD[p.modalidad] || '').toLowerCase()}${p.es_atipico ? ' · atípico' : ''}${p.responsable ? ` · responsable ${p.responsable}` : ''}`, boton: { texto: 'Ver alertas', ir: '#/plazos', proy: p.proyecto_id } });
    if (p.entregables.vencidos > 0 && pe && pe.dias < 0) lista.push({ sev: 'risk', orden: pe.dias, titulo: `Entregable «${pe.numero}. ${pe.nombre}» vencido hace ${-pe.dias} d${p.entregables.vencidos > 1 ? ` (y ${p.entregables.vencidos - 1} más)` : ''}`, sub: `${p.codigo} · ${pe.profesional || ''} · ${ff(pe.fecha_limite)}`, boton: { texto: 'Ver', tema: 'vencidos' } });
    if (p.entregables.revision_vencida > 0) lista.push({ sev: 'risk', orden: 0, titulo: `${p.codigo} · ${p.entregables.revision_vencida} conformidad(es) fuera de plazo`, sub: `${p.nombre} · el equipo aún no responde dentro del plazo de revisión`, boton: { texto: 'Ver', tema: 'conformidad' } });
    if (p.entregables.por_vencer > 0 && pe && pe.dias >= 0) lista.push({ sev: 'warn', orden: pe.dias, titulo: `${p.entregables.por_vencer} entregable(s) ${pe.dias === 0 ? 'vence(n) hoy' : `vence(n) en ${pe.dias} d`} y aún no se presenta(n)`, sub: `«${pe.numero}. ${pe.nombre}» · ${p.codigo} · ${pe.profesional || ''} · ${ff(pe.fecha_limite)}`, boton: { texto: 'Ver', tema: 'por_vencer' } });
    if (p.vencen_15_dias > 0) lista.push({ sev: 'warn', orden: 15, titulo: `${p.codigo} · ${p.vencen_15_dias} vigencia(s) por vencer`, sub: `${p.nombre} · orden de servicio o adenda que termina en los próximos días`, boton: { texto: 'Ver', tema: 'vigencia' } });
    if (p.sin_parte) lista.push({ sev: 'warn', orden: 20, titulo: `${p.codigo} sin supervisión ${p.ultimo_parte ? `desde ${ff(p.ultimo_parte)}` : 'registrada'}`, sub: `${p.dias_sin_parte} día(s) hábil(es) sin parte diario`, boton: { texto: 'Ver', tema: 'sin_parte' } });
    if (!p.responsable) lista.push({ sev: 'warn', orden: 30, titulo: `${p.codigo} sin responsable asignado`, sub: `${p.profesionales ? `${p.profesionales_activos}/${p.profesionales} profesionales activos · ` : ''}${p.avance === null || p.avance === undefined ? 'sin avance calculado' : `${pct(p.avance)} de avance registrado`}`, boton: admin ? { texto: 'Asignar', ir: '#/proyectos' } : { texto: 'Ver', tema: 'sin_resp' } });
  }
  if (r.os_sin_notificar > 0) lista.push({ sev: 'warn', orden: 10, titulo: `${r.os_sin_notificar} orden(es) de servicio registrada(s) sin notificar`, sub: 'El plazo no empieza hasta notificarla al profesional', boton: { texto: 'Notificar', ir: '#/proyectos', primario: true } });
  return lista.sort((a, b) => (a.sev === b.sev ? 0 : a.sev === 'risk' ? -1 : 1) || a.orden - b.orden);
}
function atencion(d, r, todas = false) {
  const lista = acciones(d, r);
  const sinResp = d.proyectos.filter((p) => p.en_curso && !p.responsable).length;
  const controles = [['entregables vencidos', r.entregables_vencidos], ['conformidades', r.conformidades_fuera_de_plazo], ['entregables por vencer', r.entregables_por_vencer], ['notificaciones', r.os_sin_notificar], ['vigencias', r.vencen_15_dias], ['partes diarios', r.sin_parte], ['responsables', sinResp]];
  const enCero = controles.filter(([, n]) => !n).map(([t]) => t);
  const visibles = todas ? lista : lista.slice(0, 6);
  return `<section class="tarjeta tg-tarjeta aparecer" style="--i:1" aria-labelledby="t-aten" id="c-aten">
    <div class="aten-cab"><div><h2 id="t-aten" class="tg-titulo">¿Qué requiere atención hoy?</h2><div class="tg-sub">${lista.length ? `${lista.length} acción(es), ordenadas por riesgo · «Ver» filtra los proyectos` : 'Todo en orden'}</div></div></div>
    <div class="aten-lista">
      ${visibles.map((a, i) => `<div class="aten-fila">${insignia(a.sev === 'risk' ? 'ROJO' : 'AMBAR', a.sev === 'risk' ? 'En riesgo' : 'Atención')}
        <div class="aten-cuerpo"><b>${esc(a.titulo)}</b><small>${esc(a.sub)}</small></div>
        <button type="button" class="btn med ${a.boton.primario ? 'prim' : ''}" data-accion="${i}">${esc(a.boton.texto)}</button></div>`).join('')}
      ${lista.length > 6 ? `<button type="button" class="btn fantasma med ver-mas" id="b-ver-acciones">${todas ? 'Ver solo las 6 primeras' : `Ver las ${lista.length} acciones`}</button>` : ''}
      ${lista.length ? (enCero.length ? `<div class="al-dia">${insignia('VERDE', 'Al día')}Sin pendientes en ${esc(enCero.join(' · '))}</div>` : '')
        : `<div class="al-dia">${insignia('VERDE', 'Al día')}No hay acciones pendientes al ${ff(r.corte)}</div>`}
    </div></section>`;
}

// ---------------------------------------------------------------- 6.3 tarjetas analíticas
function dona(r, f) {
  const s = r.semaforo; const total = r.en_curso;
  const tramos = [['ROJO', s.ROJO], ['AMBAR', s.AMBAR], ['VERDE', s.VERDE], ['GRIS', s.GRIS || 0]];
  const R = 44; const C = 2 * Math.PI * R; let acum = 0;
  const conValor = tramos.filter(([, n]) => n).length;
  const arcos = total ? tramos.filter(([, n]) => n).map(([k, n]) => {
    const largo = (n / total) * C; const sep = conValor > 1 ? 4 : 0;
    const a = `<circle class="dona-tramo t-${k}" cx="60" cy="60" r="${R}" transform="rotate(-90 60 60)" data-sem="${k}" style="stroke-dasharray:0 ${C.toFixed(1)};stroke-dashoffset:${(-acum).toFixed(1)}" data-dash="${Math.max(0, largo - sep).toFixed(1)} ${C.toFixed(1)}"><title>${n} · ${SEMAFORO[k].texto}</title></circle>`;
    acum += largo; return a;
  }).join('') : '';
  const desglose = tramos.map(([k, n]) => `${n} ${SEMAFORO[k].texto.toLowerCase()}`).join(', ');
  return `<section class="tarjeta tg-tarjeta analitica aparecer" style="--i:2" aria-labelledby="t-sem">
    <h2 id="t-sem">¿Cómo están los proyectos en curso?</h2><div class="tg-sub">Pulse un estado para ver esos proyectos</div>
    <div class="dona-env">
      <svg class="dona" viewBox="0 0 120 120" role="img" aria-label="${total} proyecto(s) en curso: ${esc(desglose)}">
        <circle cx="60" cy="60" r="${R}" class="dona-pista"/>${arcos}
        <text x="60" y="62" class="dona-num">${total}</text><text x="60" y="80" class="dona-et">EN CURSO</text>
      </svg>
      <div class="dona-ley">${tramos.map(([k, n]) => { const x = semInfo(k); return `<button type="button" class="ley-fila ${n ? '' : 'cero'}" data-sem="${k}" aria-pressed="${f.semaforo === k}" title="${esc(AYUDA_SEM[k])}"><b class="c-${x.nivel}"><span aria-hidden="true">${x.glifo}</span> ${n}</b><span>${esc(x.texto)}</span></button>`; }).join('')}</div>
    </div></section>`;
}
function medidor(r, proyectos) {
  const v = r.avance_promedio; const L = Math.PI * 80;
  const con = proyectos.filter((p) => p.en_curso && p.avance !== null && p.avance !== undefined).sort((a, b) => b.avance - a.avance);
  return `<section class="tarjeta tg-tarjeta analitica aparecer" style="--i:3" aria-labelledby="t-av">
    <h2 id="t-av">¿Cuánto se ha avanzado?</h2><div class="tg-sub">Promedio de los proyectos en curso</div>
    <div class="medidor"><svg viewBox="0 0 200 112" role="img" aria-label="Avance promedio ${v === null || v === undefined ? 'sin dato' : pct(v)}">
      <path d="M20 100 A80 80 0 0 1 180 100" class="medidor-pista"/>
      ${v === null || v === undefined ? '' : `<path d="M20 100 A80 80 0 0 1 180 100" class="medidor-valor" style="stroke-dasharray:${L.toFixed(1)};stroke-dashoffset:${L.toFixed(1)}" data-offset="${(L * (1 - Math.min(100, v) / 100)).toFixed(1)}"/>`}
      <text x="100" y="96" class="medidor-num">${v === null || v === undefined ? '—' : `<tspan data-contar="${v}" data-fmt="pct">${pct(v)}</tspan>`}</text></svg></div>
    <div class="barras-av">${con.map((p, i) => `<button type="button" class="barra-av" data-abrir="${p.proyecto_id}" title="Abrir ${esc(p.codigo)} · ${esc(p.nombre)}"><span>${esc(p.codigo)}</span><div class="pista"><div class="real" style="--i:${i}" data-ancho="${Math.max(0, Math.min(100, p.avance))}%"></div></div><b>${pct(p.avance)}</b></button>`).join('') || '<div class="mut2">Aún no hay proyectos en curso con avance calculado.</div>'}</div>
    <p class="nota">OS: avance según entregables con conformidad y su % de pago. GF2026: según el plan de trabajo.</p></section>`;
}
function ciclo(r) {
  const pasos = [
    ['os', r.os_sin_notificar, 'Registrada', 'Falta notificarla al profesional', r.os_sin_notificar > 0],
    ['ejecucion', r.os_en_ejecucion, 'En ejecución', 'El plazo corre desde el día siguiente de la notificación', false],
    ['revision', r.entregables_en_revision, 'Entregables en revisión', `Presentados, esperan conformidad${r.entregables_observados ? ` · ${r.entregables_observados} observado(s)` : ''}`, r.conformidades_fuera_de_plazo > 0],
    ['conformes', r.entregables_conformes, 'Entregables conformes', 'Con conformidad del equipo', false],
    ['culminadas', r.os_culminadas, 'OS culminadas', 'Todos sus entregables conformes', false],
  ];
  return `<section class="tarjeta tg-tarjeta analitica aparecer" style="--i:4" aria-labelledby="t-cic">
    <h2 id="t-cic">Ciclo de la orden de servicio</h2><div class="tg-sub">Dónde está cada OS y cada entregable</div>
    <ol class="ciclo">${pasos.map(([tema, n, t, ayuda, accion]) => {
      const clase = `paso ${accion ? 'accion' : n ? 'con-valor' : ''}`;
      const cuerpo = `<span class="paso-num">${contar(n)}</span><span><span class="paso-t">${esc(t)}</span><small>${accion ? '<span aria-hidden="true">● </span>' : ''}${esc(ayuda)}</small></span>`;
      return `<li>${n ? `<button type="button" class="${clase}" data-ciclo="${tema}" title="Ver los proyectos ${esc(TEMAS[tema][0])}">${cuerpo}</button>` : `<div class="${clase}">${cuerpo}</div>`}</li>`;
    }).join('')}</ol></section>`;
}

// ---------------------------------------------------------------- 6.4 proyectos
function accionPrincipal(p) {
  if (p.modalidad === 'CONTRATO_ADENDAS') return ['#/seguimiento', 'Plan de trabajo'];
  if (p.modalidad === 'GESTION_INTERNA' || !p.profesionales) return ['#/proyectos', 'Iniciar seguimiento'];
  return ['#/plazos', 'Entregables'];
}
function tarjeta(p) {
  const pe = p.proximo_entregable; const av = p.avance; const R = 22; const C = 2 * Math.PI * R;
  const conMonto = 'monto_comprometido' in p && p.monto_comprometido;
  const [rutaP, textoP] = accionPrincipal(p);
  const sinEnt = p.modalidad === 'CONTRATO_ADENDAS' ? 'Seguimiento por plan de trabajo y adendas'
    : p.modalidad === 'GESTION_INTERNA' ? 'Gestión interna: aún sin profesionales u OS que seguir'
      : p.entregables.total ? 'Sin entregables pendientes' : 'Sin entregables programados';
  return `<article class="pcard" aria-labelledby="pc-${p.proyecto_id}">
    <div class="pc-fila"><a class="pc-cod" id="pc-${p.proyecto_id}" href="#/plazos" data-proy="${p.proyecto_id}">${esc(p.codigo)}</a>${chipEstado(p.estado)}${p.es_atipico ? '<span class="ins ins-warn">Atípico</span>' : ''}</div>
    <div><div class="pc-nom">${esc(p.nombre)}</div><div class="pc-meta">${esc(MODALIDAD[p.modalidad] || p.modalidad)}${p.area_tecnica ? ` · ${esc(p.area_tecnica)}` : ''}${conMonto ? ` · ${soles(p.monto_comprometido)}` : ''}</div></div>
    ${insignia(p.semaforo)}
    <div class="pc-cuerpo">
      <svg class="anillo" viewBox="0 0 56 56" role="img" aria-label="Avance ${av === null || av === undefined ? 'sin dato' : pct(av)}"><circle cx="28" cy="28" r="${R}" class="anillo-pista"/>${av === null || av === undefined ? '' : `<circle cx="28" cy="28" r="${R}" class="anillo-valor" transform="rotate(-90 28 28)" style="stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${C.toFixed(1)}" data-offset="${(C * (1 - Math.min(100, av) / 100)).toFixed(1)}"/>`}<text x="28" y="32" class="anillo-num ${av === null || av === undefined ? 'sin' : ''}">${av === null || av === undefined ? '—' : pct(av)}</text></svg>
      <div class="pc-prox">${pe ? `<div class="ov">Próximo entregable</div><b>${pe.numero}. ${esc(pe.nombre)}</b><small>${ff(pe.fecha_limite)}${pe.profesional ? ` · ${esc(pe.profesional)}` : ''}</small>${chipPlazo(pe)}`
        : `<div class="ov">${p.modalidad === 'CONTRATO_ADENDAS' ? 'Seguimiento' : 'Entregables'}</div><small>${esc(sinEnt)}</small>${p.vencen_15_dias ? insignia('AMBAR', `${p.vencen_15_dias} vigencia(s) por vencer`) : ''}`}</div>
    </div>
    <div class="pc-datos">
      <div><span>Responsable</span><b class="${p.responsable ? '' : 'sin-resp'}">${esc(p.responsable || 'Sin asignar')}</b></div>
      <div><span>${p.os_total ? 'OS · profesionales' : 'Profesionales'}</span><b class="num">${p.os_total ? `${p.os_en_ejecucion}/${p.os_total} · ` : ''}${p.profesionales ? `${p.profesionales_activos}/${p.profesionales}` : '—'}</b></div>
      <div><span>Alertas</span><span class="num" title="Alertas de prioridad alta de un total de ${p.alertas.total}">${p.alertas.total ? `<b class="${p.alertas.altas ? 'alto' : ''}">${p.alertas.altas}</b> de ${p.alertas.total}` : '0'}</span></div>
    </div>
    <div class="pc-links"><a href="#/expediente" data-proy="${p.proyecto_id}">Expediente</a><a href="#/bitacora/proyecto" data-proy="${p.proyecto_id}">Bitácora</a><a href="${rutaP}" data-proy="${p.proyecto_id}">${textoP}</a></div>
  </article>`;
}
function tabla(filas) {
  const barra = (av) => { if (av === null || av === undefined) return '<span class="mut2">—</span>'; const v = Math.max(0, Math.min(100, Number(av))); return `<div class="avance"><div class="pista"><div class="real" style="width:0" data-ancho="${v}%"></div></div><small class="num">${pct(v)}</small></div>`; };
  return `<div class="tabla-env"><table class="tabla-port"><thead><tr><th>Semáforo</th><th>Proyecto</th><th>Unidad usuaria</th><th>Responsable</th><th>Estado</th><th>Avance</th><th>Próximo entregable</th><th>Supervisión</th><th class="d">OS</th><th class="d">Alertas</th></tr></thead><tbody>
    ${filas.map((p) => { const pe = p.proximo_entregable; return `<tr class="fila-enlace" data-fila="${p.proyecto_id}" tabindex="0" title="Abrir el proyecto">
      <td>${insignia(p.semaforo)}</td>
      <td class="desc"><b>${esc(p.codigo)}</b> · ${esc(p.nombre)}<small>${esc(MODALIDAD[p.modalidad] || p.modalidad)}${p.es_atipico ? ' · atípico' : ''}${p.profesionales ? ` · ${p.profesionales_activos}/${p.profesionales} profesionales activos` : ''}${'monto_comprometido' in p && p.monto_comprometido ? ` · ${soles(p.monto_comprometido)}` : ''}</small></td>
      <td class="desc">${esc(p.unidad_usuaria || '—')}${p.area_tecnica ? `<small>${esc(p.area_tecnica)}</small>` : ''}</td>
      <td>${p.responsable ? esc(p.responsable) : '<span class="warn">Sin asignar</span>'}</td>
      <td>${chipEstado(p.estado)}</td>
      <td style="min-width:120px">${barra(p.avance)}</td>
      <td class="desc">${pe ? `${pe.numero}. ${esc(pe.nombre)}<small>${ff(pe.fecha_limite)} · ${esc(plazo(pe.dias))}</small>` : '<span class="mut2">—</span>'}</td>
      <td>${p.dias_sin_parte === null || p.dias_sin_parte === undefined ? `<span class="mut2">${p.ultimo_parte ? ff(p.ultimo_parte) : '—'}</span>` : p.sin_parte ? insignia('AMBAR', `${p.dias_sin_parte} d háb. sin parte`) : `${p.ultimo_parte ? ff(p.ultimo_parte) : '—'}`}</td>
      <td class="d num">${p.os_total ? `${p.os_en_ejecucion}/${p.os_total}` : '—'}</td>
      <td class="d num">${p.alertas.total ? `<b class="${p.alertas.altas ? 'bad' : ''}">${p.alertas.altas}</b> de ${p.alertas.total}` : '0'}</td></tr>`; }).join('')}
    </tbody></table></div>`;
}

/** Línea de tiempo: una barra por Orden de Servicio en ejecución, con sus entregables como hitos y la fecha de corte. */
function lineaDeTiempo(filas, corte) {
  const barras = filas.flatMap((f) => f.linea.map((l) => ({ ...l, codigo: f.codigo })));
  if (!barras.length) return '<div class="vacio">No hay órdenes de servicio en ejecución en los proyectos filtrados.</div>';
  const dia = (s) => Date.parse(`${s}T00:00:00Z`) / 86400000;
  const min = Math.min(...barras.map((b) => dia(b.inicio)), dia(corte));
  const max = Math.max(...barras.map((b) => dia(b.fin)), dia(corte));
  const pos = (s) => ((dia(s) - min) / Math.max(1, max - min)) * 100;
  const sem = (h) => (h.estado === 'CONFORME' ? 'VERDE' : h.semaforo === 'AZUL' ? 'VERDE' : h.semaforo || 'GRIS');
  return `<div class="ldt"><div class="ldt-escala"><span>${ff(new Date(min * 86400000).toISOString().slice(0, 10))}</span><span>${ff(new Date(max * 86400000).toISOString().slice(0, 10))}</span></div>
    ${barras.sort((a, b) => a.fin.localeCompare(b.fin)).map((b) => `<div class="ldt-fila"><div class="ldt-et" title="${esc(b.profesional)} · OS N.° ${esc(b.numero)}"><b>${esc(b.codigo)}</b> ${esc(b.profesional)}<small>OS N.° ${esc(b.numero)} · ${ff(b.inicio)} – ${ff(b.fin)}</small></div>
      <div class="ldt-pista"><div class="ldt-hoy" style="left:${pos(corte)}%" title="Corte: ${ff(corte)}"></div>
        <div class="ldt-barra" style="left:${pos(b.inicio)}%;width:0" data-ancho="${Math.max(0.8, pos(b.fin) - pos(b.inicio))}%"></div>
        ${b.hitos.map((h) => `<span class="ldt-hito p-${sem(h)}" style="left:${pos(h.fecha)}%" title="Entregable ${h.numero}: ${esc(h.nombre)} · ${ff(h.fecha)} · ${esc(h.estado === 'CONFORME' ? 'Conforme' : semInfo(h.semaforo).texto)}"></span>`).join('')}
      </div></div>`).join('')}
    <div class="mut2 ldt-ley"><span class="punto p-VERDE"></span> ✓ en plazo o conforme · <span class="punto p-AMBAR"></span> ● por vencer · <span class="punto p-ROJO"></span> ▲ vencido o en riesgo · <span class="ldt-ley-hoy"></span> fecha de corte</div></div>`;
}

/** «Cómo leer este tablero»: definiciones en un panel lateral. */
function guia() {
  return `<div class="guia-def"><h3>Semáforo del proyecto</h3><p>Cada proyecto toma el peor estado entre sus entregables pendientes y la vigencia de sus profesionales activos.</p>
      <ul>${['ROJO', 'AMBAR', 'VERDE', 'GRIS'].map((k) => `<li>${insignia(k)}<span>${esc(AYUDA_SEM[k])}</span></li>`).join('')}</ul></div>
    <div class="guia-def"><h3>Estado del proyecto</h3><p>Es la etapa administrativa, no el riesgo: ${chipEstado('REGISTRADO')} ${chipEstado('EN_EJECUCION')} ${chipEstado('CONCLUIDO')} ${chipEstado('CERRADO')}.</p></div>
    <div class="guia-def"><h3>Avance</h3><p>Órdenes de servicio: la suma de los entregables con conformidad según su porcentaje de pago (las OS se ponderan por su monto). GF2026: el avance ponderado de los planes de trabajo aprobados. Gestión interna: sin avance calculado. El avance promedio es el promedio simple de los proyectos en curso que lo tienen.</p></div>
    <div class="guia-def"><h3>Ciclo de la orden de servicio</h3><ul>
      <li><b>Registrada</b><span>La OS existe pero no se notificó: el plazo aún no corre.</span></li>
      <li><b>En ejecución</b><span>El plazo corre en días calendario desde el día siguiente de la notificación.</span></li>
      <li><b>En revisión</b><span>Entregables presentados que esperan la conformidad del equipo (o su subsanación si se observaron).</span></li>
      <li><b>Conformes</b><span>Entregables con documento de conformidad.</span></li>
      <li><b>Culminadas</b><span>Órdenes de servicio con todos sus entregables conformes.</span></li></ul></div>
    <div class="guia-def"><h3>Plazos</h3><p>Se expresan desde la fecha de corte: «vence en 15 d», «vence hoy», «vencido hace 3 d».</p></div>
    <div class="guia-def"><h3>Alertas «N de M»</h3><p>N son las alertas de prioridad alta y M el total de alertas vigentes del proyecto.</p></div>
    <div class="guia-def"><h3>Supervisión</h3><p>El equipo registra un parte diario por proyecto en ejecución; si pasan más días hábiles que el umbral configurado, aparece «sin supervisión».</p></div>
    <div class="guia-def"><h3>Fecha de corte</h3><p>Todas las cifras se calculan a la fecha del botón «Corte al» de la cabecera; puede elegir otra fecha para consultar (no cambia el parámetro del sistema).</p></div>`;
}

export async function vistaPortafolio(el) {
  const q = estado.corte ? `?corte=${estado.corte}` : '';
  const d = await api('GET', `/portafolio${q}`);
  const r = d.resumen;
  if (!estado.corte) { const c = document.getElementById('corte'); if (c && !c.value) c.value = r.corte; }
  if (window.sgfGuardarSemaforos) window.sgfGuardarSemaforos(d);
  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Lima', hour: 'numeric', hour12: false }));
  const saludo = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const nombre = estado.usuario && estado.usuario.nombre ? estado.usuario.nombre.split(/\s+/)[0] : '';
  titulo('Tablero general', `${saludo}${nombre ? `, ${esc(nombre)}` : ''}. Así van los proyectos de la OTI al <b class="num">${ff(r.corte)}</b>.`);
  const cab = accionesCabecera(`<button type="button" class="btn fantasma" id="b-guia">${ICONOS.ayuda}Cómo leer este tablero</button>`);
  if (cab) cab.querySelector('#b-guia').onclick = () => panelLateral({ titulo: 'Cómo leer este tablero', contenido: guia() });

  const jefe = estado.usuario && estado.usuario.rol === 'JEFE_PROYECTO';
  const deUrl = leerUrl();
  const f = { ...BASE, ...(Object.keys(deUrl).length ? {} : leerGuardados()), ...deUrl };
  let vista = leerVista();
  const unicos = (k) => [...new Set(d.proyectos.map((p) => p[k]).filter(Boolean))].sort();
  const mes = String(r.corte).slice(0, 7);
  const meses = []; { let [a, m] = mes.split('-').map(Number); for (let i = 0; i < 12; i++) { meses.push([`${a}-${String(m).padStart(2, '0')}`, new Date(Date.UTC(a, m - 1, 15)).toLocaleString('es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).replace(/^./, (c) => c.toUpperCase()).replace(' de ', ' ')]); m--; if (!m) { m = 12; a--; } } }
  const cuenta = { en_curso: d.proyectos.filter((p) => p.en_curso).length, terminados: d.proyectos.filter((p) => p.terminado).length, todos: d.proyectos.length };
  let todasAcciones = false;

  el.innerHTML = `
    ${banda(r, d)}
    <div id="c-aten-env">${atencion(d, r)}</div>
    <div class="analiticas">${dona(r, f)}${medidor(r, d.proyectos)}${ciclo(r)}</div>
    <section class="tarjeta proy-tarjeta aparecer" style="--i:5" aria-labelledby="t-pry" id="c-proyectos">
      <div class="proy-barra">
        <div><h2 id="t-pry" class="tg-titulo">Proyectos</h2>
          <div class="segmentado" role="group" aria-label="Situación">${[['en_curso', 'En curso'], ['terminados', 'Terminados'], ['todos', 'Todos']].map(([k, t]) => `<button type="button" data-situacion="${k}" aria-pressed="${f.situacion === k}">${t} ${cuenta[k]}</button>`).join('')}</div>
          <div class="conmutador" role="group" aria-label="Vista"><button type="button" data-vista="tarjetas" aria-pressed="${vista !== 'tabla'}">${ICONOS.cuadricula}Tarjetas</button><button type="button" data-vista="tabla" aria-pressed="${vista === 'tabla'}">${ICONOS.lineas}Tabla</button></div>
        </div>
        <div><label>Periodo<select class="sel" id="mes-rep" style="min-width:160px">${opciones(meses, mes)}</select></label>
          <a class="btn prim" id="b-reporte" href="/api/reportes/mensual.pdf?mes=${mes}" target="_blank" rel="noopener">Reporte mensual (PDF)</a>
          <a class="btn" href="/api/portafolio.csv${q}">Exportar CSV</a></div>
      </div>
      <div class="filtros-barra" id="filtros">
        <label class="filtro-buscar"><span class="ov">Buscar</span><span class="caja-buscar">${ICONOS.buscar}<input id="f-texto" type="search" placeholder="Código, nombre o responsable" value="${esc(f.texto)}"></span></label>
        <button type="button" class="btn med b-filtros" id="b-filtros" aria-expanded="false" aria-controls="filtros">Filtros</button>
        <label><span class="ov">Gestión</span><select class="sel" id="f-area"><option value="">Toda gestión</option>${opciones(unicos('area_tecnica').map((x) => [x, x]), f.area)}</select></label>
        <label><span class="ov">Responsable</span><select class="sel" id="f-responsable"><option value="">Todos</option>${opciones(unicos('responsable').map((x) => [x, x]), f.responsable)}</select></label>
        <label><span class="ov">Año</span><select class="sel" id="f-anio" style="min-width:110px"><option value="">Todos</option>${opciones(unicos('anio').map((x) => [x, x]), f.anio)}</select></label>
        <label><span class="ov">Semáforo</span><select class="sel" id="f-semaforo" style="min-width:130px"><option value="">Todos</option>${opciones([['ROJO', '▲ Atrasado o en riesgo'], ['AMBAR', '● Requiere atención'], ['VERDE', '✓ En plazo'], ['GRIS', '– Sin seguimiento']], f.semaforo)}</select></label>
        ${jefe ? `<label class="chk"><input type="checkbox" id="f-mios" ${f.mios ? 'checked' : ''}> Mis proyectos</label>` : ''}
        <span class="cuenta-proy" id="cuenta-proy"></span>
      </div>
      <div class="filtro-activo" id="f-tema" hidden></div>
      <div id="t-port"></div>
    </section>
    <section class="tarjeta aparecer" style="--i:6" aria-labelledby="t-ldt"><div class="cab"><h2 id="t-ldt">Línea de tiempo de las órdenes de servicio en ejecución</h2><span class="mut2">Cada barra es una OS; los círculos, sus entregables</span></div><div class="cuerpo" id="ldt"></div></section>`;

  const abrir = (id, ruta = '#/plazos') => { fijarProyecto(id); pintarSelectorProyecto(); location.hash = ruta; };
  const enlazarProyectos = (raiz) => raiz.querySelectorAll('a[data-proy]').forEach((a) => { a.addEventListener('click', () => { fijarProyecto(a.dataset.proy); pintarSelectorProyecto(); }); });
  const filtrar = () => d.proyectos.filter((p) => (f.situacion === 'todos' || (f.situacion === 'terminados' ? p.terminado : p.en_curso))
    && (!f.area || p.area_tecnica === f.area) && (!f.responsable || p.responsable === f.responsable) && (!f.anio || String(p.anio) === String(f.anio))
    && (!f.semaforo || (f.semaforo === 'VERDE' ? ['VERDE', 'AZUL'].includes(p.semaforo) : p.semaforo === f.semaforo)) && (!f.mios || p.mio)
    && (!f.texto || `${p.codigo} ${p.nombre} ${p.responsable || ''}`.toLowerCase().includes(f.texto.toLowerCase()))
    && (!TEMAS[f.tema] || TEMAS[f.tema][1](p)))
    // riesgo primero y luego el próximo vencimiento
    .sort((a, b) => (({ ROJO: 0, AMBAR: 1, VERDE: 2, AZUL: 2 })[a.semaforo] ?? 3) - (({ ROJO: 0, AMBAR: 1, VERDE: 2, AZUL: 2 })[b.semaforo] ?? 3)
      || ((a.proximo_entregable ? a.proximo_entregable.dias : 9e9) - (b.proximo_entregable ? b.proximo_entregable.dias : 9e9)) || a.codigo.localeCompare(b.codigo));

  const pintar = () => {
    const filas = filtrar();
    const v = esMovil() ? 'tarjetas' : vista;
    const cont = el.querySelector('#t-port');
    cont.innerHTML = !filas.length ? '<div class="vacio">Ningún proyecto cumple los filtros. <button type="button" class="btn fantasma peq" id="b-limpiar">Quitar filtros</button></div>'
      : v === 'tabla' ? tabla(filas) : `<div class="pcards">${filas.map(tarjeta).join('')}</div>`;
    el.querySelector('#cuenta-proy').textContent = `${filas.length} de ${d.proyectos.length} proyectos`;
    const activos = ['area', 'responsable', 'anio', 'semaforo', 'mios'].filter((k) => f[k]).length;
    el.querySelector('#b-filtros').textContent = `Filtros${activos ? ` (${activos})` : ''}`;
    const ft = el.querySelector('#f-tema');
    ft.hidden = !TEMAS[f.tema];
    if (TEMAS[f.tema]) {
      ft.innerHTML = `<span>Se muestran los proyectos <b>${esc(TEMAS[f.tema][0])}</b>.</span><button type="button" class="btn peq" id="b-quitar-tema">Quitar filtro</button>`;
      ft.querySelector('#b-quitar-tema').onclick = () => aplicar({ tema: '' }, false);
    }
    el.querySelectorAll('[data-situacion]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.situacion === f.situacion)));
    el.querySelectorAll('.ley-fila').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sem === f.semaforo)));
    el.querySelector('#ldt').innerHTML = lineaDeTiempo(filas, r.corte);
    enlazarProyectos(cont);
    cont.querySelectorAll('[data-fila]').forEach((tr) => {
      tr.onclick = () => abrir(tr.dataset.fila);
      tr.onkeydown = (ev) => { if (ev.key === 'Enter') abrir(tr.dataset.fila); };
    });
    const bl = cont.querySelector('#b-limpiar');
    if (bl) bl.onclick = () => { Object.assign(f, BASE); sincronizar(); guardar(f); pintar(); };
    animar(cont); animar(el.querySelector('#ldt'));
  };
  const sincronizar = () => {
    for (const [id, k] of [['#f-area', 'area'], ['#f-responsable', 'responsable'], ['#f-anio', 'anio'], ['#f-semaforo', 'semaforo'], ['#f-texto', 'texto']]) { const e = el.querySelector(id); if (e) e.value = f[k] || ''; }
    const m = el.querySelector('#f-mios'); if (m) m.checked = !!f.mios;
  };
  const aplicar = (cambios, desplazar = true) => {
    Object.assign(f, cambios); sincronizar(); guardar(f); pintar();
    if (desplazar) el.querySelector('#c-proyectos').scrollIntoView({ behavior: sinMovimiento() ? 'auto' : 'smooth', block: 'start' });
  };
  window.sgfFiltrosDesdeUrl = () => { if (!document.body.contains(el)) return; Object.assign(f, BASE, leerUrl()); sincronizar(); pintar(); };

  for (const [id, k] of [['#f-area', 'area'], ['#f-responsable', 'responsable'], ['#f-anio', 'anio'], ['#f-semaforo', 'semaforo']]) el.querySelector(id).addEventListener('change', (e) => aplicar({ [k]: e.target.value }, false));
  el.querySelector('#f-texto').addEventListener('input', (e) => aplicar({ texto: e.target.value }, false));
  const fm = el.querySelector('#f-mios'); if (fm) fm.addEventListener('change', () => aplicar({ mios: fm.checked }, false));
  el.querySelector('#b-filtros').onclick = (e) => { const fb = el.querySelector('#filtros'); const ab = fb.classList.toggle('abierto'); e.currentTarget.setAttribute('aria-expanded', String(ab)); };
  el.querySelectorAll('[data-situacion]').forEach((b) => { b.onclick = () => aplicar({ situacion: b.dataset.situacion }, false); });
  el.querySelectorAll('[data-vista]').forEach((b) => { b.onclick = () => { vista = b.dataset.vista; guardarVista(vista); el.querySelectorAll('[data-vista]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); pintar(); }; });
  // banda, dona, ciclo y barras de avance filtran o abren
  el.querySelector('[data-banda="en_curso"]').onclick = () => aplicar({ ...BASE, situacion: 'en_curso' });
  el.querySelector('[data-banda="ejecucion"]').onclick = () => aplicar({ situacion: 'en_curso', semaforo: '', tema: 'ejecucion' });
  el.querySelectorAll('.analiticas [data-sem]').forEach((b) => { b.onclick = () => aplicar({ situacion: 'en_curso', tema: '', semaforo: f.semaforo === b.dataset.sem ? '' : b.dataset.sem }); });
  el.querySelectorAll('[data-ciclo]').forEach((b) => { b.onclick = () => aplicar({ situacion: b.dataset.ciclo === 'culminadas' ? 'todos' : 'en_curso', semaforo: '', tema: b.dataset.ciclo }); });
  el.querySelectorAll('.barra-av').forEach((b) => { b.onclick = () => abrir(b.dataset.abrir); });
  // filas de atención
  const enlazarAtencion = () => {
    const lista = acciones(d, r);
    el.querySelectorAll('[data-accion]').forEach((b) => {
      const a = lista[Number(b.dataset.accion)];
      b.onclick = () => (a.boton.tema ? aplicar({ situacion: 'en_curso', semaforo: '', tema: a.boton.tema }) : a.boton.proy ? abrir(a.boton.proy, a.boton.ir) : (location.hash = a.boton.ir));
    });
    const vm = el.querySelector('#b-ver-acciones');
    if (vm) vm.onclick = () => { todasAcciones = !todasAcciones; el.querySelector('#c-aten-env').innerHTML = atencion(d, r, todasAcciones); enlazarAtencion(); };
  };
  enlazarAtencion();
  const mesRep = el.querySelector('#mes-rep');
  mesRep.onchange = () => { el.querySelector('#b-reporte').href = `/api/reportes/mensual.pdf?mes=${mesRep.value}`; };
  guardar(f);
  pintar();
  animar(el.querySelector('.banda')); animar(el.querySelector('.analiticas'));
}
