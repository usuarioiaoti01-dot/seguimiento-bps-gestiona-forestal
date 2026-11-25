// Tablero general (Etapa 4): todos los proyectos de la OTI, en curso y terminados, con su avance, semáforo, próximos
// vencimientos y supervisión. Las cifras las calcula el servidor (motor/portafolio.js); aquí solo se filtran y muestran.
import { api, esc, ff, titulo, estado, opciones } from '../util.js';
import { fijarProyecto, pintarSelectorProyecto } from './proyectos.js';

const ESTADO = { REGISTRADO: ['Registrado', 'b-azul'], EN_EJECUCION: ['En ejecución', 'b-verde'], SUSPENDIDO: ['Suspendido', 'b-ambar'], CONCLUIDO: ['Concluido', 'b-azul'], CERRADO: ['Cerrado', 'b-gris'], ANULADO: ['Anulado', 'b-gris'] };
const MODALIDAD = { ORDEN_SERVICIO: 'Orden de Servicio', CONTRATO_ADENDAS: 'Contrato con adendas', GESTION_INTERNA: 'Gestión interna' };
const SEM = { ROJO: 'Atrasado o en riesgo', AMBAR: 'Requiere atención', VERDE: 'En plazo', AZUL: 'En revisión', GRIS: 'Sin seguimiento' };
const soles = (n) => `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CLAVE = 'sgf_filtros_portafolio';
const leerFiltros = () => { try { return JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch { return {}; } };
const guardarFiltros = (f) => { try { localStorage.setItem(CLAVE, JSON.stringify(f)); } catch { /* sin almacenamiento */ } };
const punto = (s) => `<span class="punto p-${esc(s === 'AZUL' ? 'VERDE' : s || 'GRIS')}" title="${esc(SEM[s] || s)}"></span>`;

function barra(av) {
  if (av === null || av === undefined) return '<span class="mut2">—</span>';
  const v = Math.max(0, Math.min(100, Number(av)));
  return `<div class="avance" title="Avance ${v} %"><div class="pista"><div class="real" style="width:${v}%"></div></div><small class="num">${v.toLocaleString('es-PE', { maximumFractionDigits: 1 })} %</small></div>`;
}

/** Línea de tiempo: una barra por Orden de Servicio en ejecución, con sus entregables como hitos y la fecha de corte. */
function lineaDeTiempo(filas, corte) {
  const barras = filas.flatMap((f) => f.linea.map((l) => ({ ...l, codigo: f.codigo, proyecto_id: f.proyecto_id })));
  if (!barras.length) return '<div class="vacio">No hay Órdenes de Servicio en ejecución en los proyectos filtrados.</div>';
  const dia = (s) => Date.parse(`${s}T00:00:00Z`) / 86400000;
  const min = Math.min(...barras.map((b) => dia(b.inicio)), dia(corte));
  const max = Math.max(...barras.map((b) => dia(b.fin)), dia(corte));
  const pos = (s) => ((dia(s) - min) / Math.max(1, max - min)) * 100;
  const hoyX = pos(corte);
  return `<div class="ldt"><div class="ldt-escala"><span>${ff(new Date(min * 86400000).toISOString().slice(0, 10))}</span><span>${ff(new Date(max * 86400000).toISOString().slice(0, 10))}</span></div>
    ${barras.sort((a, b) => a.fin.localeCompare(b.fin)).map((b) => `<div class="ldt-fila"><div class="ldt-et" title="${esc(b.profesional)} · OS N.° ${esc(b.numero)}"><b>${esc(b.codigo)}</b> ${esc(b.profesional)}<small>OS N.° ${esc(b.numero)} · ${ff(b.inicio)} – ${ff(b.fin)}</small></div>
      <div class="ldt-pista"><div class="ldt-hoy" style="left:${hoyX}%" title="Corte: ${ff(corte)}"></div>
        <div class="ldt-barra" style="left:${pos(b.inicio)}%;width:${Math.max(0.8, pos(b.fin) - pos(b.inicio))}%"></div>
        ${b.hitos.map((h) => `<span class="ldt-hito p-${esc(h.estado === 'CONFORME' ? 'VERDE' : h.semaforo === 'AZUL' ? 'VERDE' : h.semaforo)}" style="left:${pos(h.fecha)}%" title="Entregable ${h.numero}: ${esc(h.nombre)} · ${ff(h.fecha)} · ${esc(h.estado === 'CONFORME' ? 'Conforme' : SEM[h.semaforo] || '')}"></span>`).join('')}
      </div></div>`).join('')}
    <div class="mut2 ldt-ley"><span class="punto p-VERDE"></span> en plazo o conforme · <span class="punto p-AMBAR"></span> por vencer · <span class="punto p-ROJO"></span> vencido o en riesgo · <span class="ldt-ley-hoy"></span> fecha de corte</div></div>`;
}

export async function vistaPortafolio(el) {
  titulo('TABLERO GENERAL', 'Todos los proyectos de la OTI: en curso y terminados');
  const q = estado.corte ? `?corte=${estado.corte}` : '';
  const d = await api('GET', `/portafolio${q}`);
  if (!estado.corte) { const c = document.getElementById('corte'); if (c && !c.value) c.value = d.resumen.corte; }
  const r = d.resumen;
  const jefe = estado.usuario && estado.usuario.rol === 'JEFE_PROYECTO';
  const f = { situacion: 'en_curso', area: '', responsable: '', anio: '', semaforo: '', mios: false, texto: '', ...leerFiltros() };
  const unicos = (k) => [...new Set(d.proyectos.map((p) => p[k]).filter(Boolean))].sort();
  const kpi = (clave, valor, titulo_, detalle, color = '') => `<button type="button" class="tarjeta kpi kpi-enlace ${color}" data-kpi="${clave}"><span class="t">${titulo_}</span><span class="v num">${valor}</span><span class="e">${detalle}</span></button>`;

  el.innerHTML = `
    <div class="kpis">
      ${kpi('en_curso', r.en_curso, 'PROYECTOS EN CURSO', `${r.semaforo.ROJO} en rojo · ${r.semaforo.AMBAR} en ámbar`, r.semaforo.ROJO ? 'rojo' : r.semaforo.AMBAR ? 'ambar' : 'verde')}
      ${kpi('terminados', r.terminados_anio, `TERMINADOS EN ${String(r.corte).slice(0, 4)}`, `${r.terminados} terminados en total`)}
      ${kpi('os', r.os_en_ejecucion, 'ÓRDENES DE SERVICIO EN EJECUCIÓN', `${r.os_sin_notificar} registrada(s) sin notificar`, r.os_sin_notificar ? 'ambar' : '')}
      ${kpi('por_vencer', r.entregables_por_vencer, 'ENTREGABLES POR VENCER', 'en los próximos días, sin presentar', r.entregables_por_vencer ? 'ambar' : 'verde')}
      ${kpi('vencidos', r.entregables_vencidos, 'ENTREGABLES VENCIDOS', 'sin presentar', r.entregables_vencidos ? 'rojo' : 'verde')}
      ${kpi('conformidad', r.conformidades_fuera_de_plazo, 'CONFORMIDADES FUERA DE PLAZO', 'presentados sin respuesta del equipo', r.conformidades_fuera_de_plazo ? 'rojo' : 'verde')}
      ${kpi('vigencia', r.vencen_15_dias, 'VIGENCIAS POR VENCER', 'profesionales con OS o adenda por vencer', r.vencen_15_dias ? 'ambar' : 'verde')}
      ${kpi('sin_parte', r.sin_parte, 'SIN PARTE DIARIO', 'proyectos con supervisión atrasada', r.sin_parte ? 'ambar' : 'verde')}
      ${d.montos.proyectos_con_monto ? `<div class="tarjeta kpi"><span class="t">MONTO COMPROMETIDO</span><span class="v num" style="font-size:20px">${soles(d.montos.comprometido)}</span><span class="e">con conformidad: ${soles(d.montos.conforme)}${jefe ? ' · solo sus proyectos' : ''}</span></div>` : ''}
    </div>
    <div class="tarjeta"><div class="cab"><h2>Proyectos</h2><div class="acciones"><input type="month" id="mes-rep" value="${String(r.corte).slice(0, 7)}" max="${String(r.corte).slice(0, 7)}" aria-label="Mes del reporte"><a class="btn peq prim" id="b-reporte" href="/api/reportes/mensual.pdf?mes=${String(r.corte).slice(0, 7)}" target="_blank" rel="noopener">Reporte mensual (PDF)</a><a class="btn peq" href="/api/portafolio.csv${q}">Exportar (CSV)</a></div></div>
      <div class="filtros-port">
        <select id="f-situacion" aria-label="Situación">${opciones([['en_curso', 'En curso'], ['terminados', 'Terminados'], ['todos', 'Todos']], f.situacion)}</select>
        <select id="f-area" aria-label="Gestión del proyecto"><option value="">Toda gestión</option>${opciones(unicos('area_tecnica').map((x) => [x, x]), f.area)}</select>
        <select id="f-responsable" aria-label="Responsable"><option value="">Todo responsable</option>${opciones(unicos('responsable').map((x) => [x, x]), f.responsable)}</select>
        <select id="f-anio" aria-label="Año"><option value="">Todo año</option>${opciones(unicos('anio').map((x) => [x, x]), f.anio)}</select>
        <select id="f-semaforo" aria-label="Semáforo"><option value="">Todo semáforo</option>${opciones([['ROJO', 'Rojo'], ['AMBAR', 'Ámbar'], ['VERDE', 'Verde'], ['GRIS', 'Sin seguimiento']], f.semaforo)}</select>
        ${jefe ? `<label class="chk"><input type="checkbox" id="f-mios" ${f.mios ? 'checked' : ''}> Mis proyectos</label>` : ''}
        <input id="f-texto" type="search" placeholder="Buscar por código o nombre" value="${esc(f.texto)}" aria-label="Buscar proyecto">
      </div>
      <div class="cuerpo sin tabla-env" id="t-port"></div></div>
    <div class="tarjeta"><div class="cab"><h2>Línea de tiempo de las Órdenes de Servicio en ejecución</h2></div><div class="cuerpo" id="ldt"></div></div>`;

  const pintar = () => {
    const filas = d.proyectos.filter((p) => (f.situacion === 'todos' || (f.situacion === 'en_curso' ? p.en_curso : p.terminado))
      && (!f.area || p.area_tecnica === f.area) && (!f.responsable || p.responsable === f.responsable) && (!f.anio || String(p.anio) === String(f.anio))
      && (!f.semaforo || (f.semaforo === 'VERDE' ? ['VERDE', 'AZUL'].includes(p.semaforo) : p.semaforo === f.semaforo)) && (!f.mios || p.mio)
      && (!f.texto || `${p.codigo} ${p.nombre}`.toLowerCase().includes(f.texto.toLowerCase())))
      .sort((a, b) => (b.alertas.altas - a.alertas.altas) || ((({ ROJO: 0, AMBAR: 1 })[a.semaforo] ?? 2) - (({ ROJO: 0, AMBAR: 1 })[b.semaforo] ?? 2)) || a.codigo.localeCompare(b.codigo));
    el.querySelector('#t-port').innerHTML = filas.length ? `<table class="tabla-port"><thead><tr><th>Proyecto</th><th>Gestión / unidad usuaria</th><th>Responsable</th><th>Estado</th><th>Avance</th><th>Próximo entregable</th><th>Supervisión</th><th class="d">OS</th><th class="d">Alertas</th></tr></thead><tbody>
      ${filas.map((p) => { const [te, ce] = ESTADO[p.estado] || [p.estado, 'b-gris']; const pe = p.proximo_entregable; return `<tr class="fila-enlace" data-proy="${p.proyecto_id}" tabindex="0" title="Abrir el proyecto">
        <td class="desc">${punto(p.semaforo)} <b>${esc(p.codigo)}</b> · ${esc(p.nombre)}<small>${esc(MODALIDAD[p.modalidad] || p.modalidad)}${p.es_atipico ? ' · <span class="badge b-ambar">Atípico</span>' : ''}${p.profesionales ? ` · ${p.profesionales_activos}/${p.profesionales} profesionales activos` : ''}${'monto_comprometido' in p && p.monto_comprometido ? ` · ${soles(p.monto_comprometido)}` : ''}</small></td>
        <td class="desc">${esc(p.area_tecnica || '—')}${p.unidad_usuaria ? `<small>${esc(p.unidad_usuaria)}</small>` : ''}</td>
        <td>${esc(p.responsable || '—')}${p.mio && jefe ? '<small class="mut2">Su equipo</small>' : ''}</td>
        <td><span class="badge ${ce}">${te}</span></td>
        <td style="min-width:120px">${barra(p.avance)}</td>
        <td class="desc">${pe ? `${pe.numero}. ${esc(pe.nombre)}<small>${ff(pe.fecha_limite)} · ${esc(pe.profesional || '')} ${punto(pe.semaforo)}</small>` : p.entregables.total ? '<span class="mut2">Sin pendientes</span>' : '<span class="mut2">—</span>'}</td>
        <td>${p.dias_sin_parte === null ? `<span class="mut2">${p.ultimo_parte ? ff(p.ultimo_parte) : '—'}</span>` : p.sin_parte ? `<span class="badge b-ambar">${p.dias_sin_parte} días háb. sin parte</span>` : `${p.ultimo_parte ? ff(p.ultimo_parte) : '—'}`}</td>
        <td class="d num">${p.os_total ? `${p.os_en_ejecucion}/${p.os_total}` : '—'}</td>
        <td class="d num">${p.alertas.altas ? `<span class="badge b-rojo">${p.alertas.altas}</span>` : ''} ${p.alertas.total ? `<small class="mut2">${p.alertas.total}</small>` : '<span class="mut2">0</span>'}</td></tr>`; }).join('')}
      </tbody></table>` : '<div class="vacio">Ningún proyecto cumple los filtros.</div>';
    el.querySelector('#ldt').innerHTML = lineaDeTiempo(filas, r.corte);
    el.querySelectorAll('.fila-enlace').forEach((tr) => {
      const abrir = () => { fijarProyecto(tr.dataset.proy); pintarSelectorProyecto(); location.hash = '#/plazos'; };
      tr.onclick = abrir; tr.onkeydown = (ev) => { if (ev.key === 'Enter') abrir(); };
    });
  };
  const enlazar = (id, k, valor = (e) => e.value) => { const e = el.querySelector(id); if (e) e.addEventListener(e.type === 'search' ? 'input' : 'change', () => { f[k] = valor(e); guardarFiltros(f); pintar(); }); };
  enlazar('#f-situacion', 'situacion'); enlazar('#f-area', 'area'); enlazar('#f-responsable', 'responsable'); enlazar('#f-anio', 'anio'); enlazar('#f-semaforo', 'semaforo'); enlazar('#f-texto', 'texto');
  enlazar('#f-mios', 'mios', (e) => e.checked);
  // las tarjetas aplican el filtro que corresponde
  el.querySelectorAll('[data-kpi]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.kpi;
      Object.assign(f, { situacion: k === 'terminados' ? 'terminados' : 'en_curso', semaforo: ['vencidos', 'conformidad'].includes(k) ? 'ROJO' : k === 'por_vencer' ? 'AMBAR' : '' });
      el.querySelector('#f-situacion').value = f.situacion; el.querySelector('#f-semaforo').value = f.semaforo;
      guardarFiltros(f); pintar(); el.querySelector('#t-port').scrollIntoView({ behavior: 'smooth' });
    };
  });
  const mesRep = el.querySelector('#mes-rep');
  if (mesRep) mesRep.onchange = () => { if (mesRep.value) el.querySelector('#b-reporte').href = `/api/reportes/mensual.pdf?mes=${mesRep.value}`; };
  pintar();
}
