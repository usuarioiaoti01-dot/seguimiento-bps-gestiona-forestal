// Expediente del proyecto (§8 de PLAN_DE_MEJORAS.md): todos sus documentos del almacén, agrupados por tipo, con lo que
// respalda cada uno, su versión y quién lo subió. Los confidenciales solo los ve el Administrador y el equipo del proyecto.
import { api, esc, fh, titulo, estado, opciones } from '../util.js';
import { cargarProyectos } from './proyectos.js';

const CLAVE = 'sgf_filtros_expediente';
const tamano = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const leerFiltros = () => { try { return JSON.parse(localStorage.getItem(CLAVE)) || {}; } catch { return {}; } };
const guardarFiltros = (f) => { try { localStorage.setItem(CLAVE, JSON.stringify(f)); } catch { /* sin almacenamiento */ } };

export async function vistaExpediente(el) {
  titulo('EXPEDIENTE DEL PROYECTO', 'Todos los documentos del proyecto: TDR, Órdenes de Servicio, notificaciones, adendas, planes, entregables, evidencias e informe de cierre');
  const lista = estado.proyectos && estado.proyectos.length ? estado.proyectos : await cargarProyectos();
  const p = (lista || []).find((x) => x.proyecto_id === estado.proyecto_id);
  if (!p) { el.innerHTML = '<div class="tarjeta"><div class="vacio">Elija un proyecto en el menú lateral.</div></div>'; return; }
  let r;
  try { r = await api('GET', `/proyectos/${p.proyecto_id}/expediente`); } catch (err) { el.innerHTML = `<div class="tarjeta"><div class="vacio">${esc(err.message)}</div></div>`; return; }
  const f = { tipo: '', profesional: '', texto: '', historicos: false, ...leerFiltros() };
  const profesionales = [...new Map(r.documentos.filter((d) => d.consultor_id).map((d) => [d.consultor_id, `${d.profesional} (${d.clave})`])).entries()].sort((a, b) => a[1].localeCompare(b[1]));

  el.innerHTML = `
    <div class="kpis">
      <div class="tarjeta kpi"><span class="t">DOCUMENTOS VIGENTES</span><span class="v num">${r.vigentes}</span><span class="e">${r.por_tipo.length} tipo(s) de documento</span></div>
      <div class="tarjeta kpi"><span class="t">VERSIONES ANTERIORES</span><span class="v num">${r.total - r.vigentes}</span><span class="e">se conservan: nada se borra</span></div>
      <div class="tarjeta kpi"><span class="t">TAMAÑO TOTAL</span><span class="v num">${tamano(r.bytes)}</span><span class="e">de los documentos visibles</span></div>
      ${r.confidenciales_ocultos ? `<div class="tarjeta kpi"><span class="t">CONFIDENCIALES</span><span class="v num">${r.confidenciales_ocultos}</span><span class="e">no visibles para usted</span></div>` : ''}
    </div>
    <div class="tarjeta">
      <div class="cab"><h2>${esc(p.codigo)} · ${esc(p.nombre)}</h2><span class="mut2" id="cuenta"></span></div>
      <form class="filtros-port" id="f-exp" novalidate>
        <select name="tipo" aria-label="Tipo de documento"><option value="">Todos los tipos</option>${opciones(r.por_tipo.map((g) => [g.tipo, `${g.nombre} (${g.vigentes})`]), f.tipo)}</select>
        <select name="profesional" aria-label="Profesional"><option value="">Todos los profesionales</option>${opciones(profesionales, f.profesional)}</select>
        <input type="search" name="texto" value="${esc(f.texto)}" placeholder="Buscar archivo o a qué pertenece" aria-label="Buscar">
        <label class="chk"><input type="checkbox" name="historicos" ${f.historicos ? 'checked' : ''}> Ver versiones anteriores</label>
      </form>
      ${r.confidenciales_ocultos ? `<div class="cuerpo mut2">${r.confidenciales_ocultos} documento(s) confidencial(es) —Orden de Servicio, notificación o resolución— solo los ven el Administrador y el equipo del proyecto.</div>` : ''}
      <div class="cuerpo sin tabla-env"><table class="tabla-exp"><thead><tr><th>Tipo</th><th>Pertenece a</th><th>Profesional</th><th>Archivo</th><th>Versión</th><th>Subido</th><th>Tamaño</th><th></th></tr></thead><tbody id="filas"></tbody></table></div>
    </div>`;

  const form = el.querySelector('#f-exp');
  const pintar = () => {
    const fd = new FormData(form);
    Object.assign(f, { tipo: fd.get('tipo') || '', profesional: fd.get('profesional') || '', texto: String(fd.get('texto') || '').trim(), historicos: fd.get('historicos') === 'on' });
    guardarFiltros(f);
    const t = f.texto.toLowerCase();
    const vis = r.documentos.filter((d) => (f.historicos || d.vigente) && (!f.tipo || d.tipo === f.tipo) && (!f.profesional || String(d.consultor_id) === String(f.profesional))
      && (!t || `${d.nombre} ${d.pertenece_a} ${d.profesional || ''}`.toLowerCase().includes(t)));
    el.querySelector('#cuenta').textContent = `${vis.length} documento(s)`;
    el.querySelector('#filas').innerHTML = vis.map((d) => `<tr class="${d.vigente ? '' : 'anulada'}">
        <td>${esc(d.tipo_nombre)}${d.confidencial ? ' <span class="badge b-gris" title="Solo el Administrador y el equipo del proyecto">Confidencial</span>' : ''}</td>
        <td class="desc">${esc(d.pertenece_a)}</td>
        <td>${d.profesional ? `${esc(d.profesional)} <span class="mut2">${esc(d.clave)}</span>` : '<span class="mut2">—</span>'}</td>
        <td class="desc">${esc(d.nombre)}</td>
        <td class="num">${d.version}${d.vigente ? '' : ' <span class="mut2">(anterior)</span>'}</td>
        <td class="num">${d.subido_en ? fh(d.subido_en) : '—'}${d.subido_por ? `<br><span class="mut2">${esc(d.subido_por)}</span>` : ''}</td>
        <td class="num">${tamano(d.bytes)}</td>
        <td style="white-space:nowrap"><a class="btn peq" href="/api/documentos/${d.documento_id}/archivo" target="_blank" rel="noopener">Ver</a> <a class="btn peq" href="/api/documentos/${d.documento_id}/archivo?descargar=1">Descargar</a></td>
      </tr>`).join('') || '<tr><td colspan="8" class="vacio">No hay documentos con estos filtros.</td></tr>';
  };
  form.addEventListener('input', pintar);
  form.addEventListener('change', pintar);
  form.addEventListener('submit', (e) => e.preventDefault());
  pintar();
}
