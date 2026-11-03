import { api, esc, fh, titulo, badge } from '../util.js';
import { diffHtml } from './consultor.js';

export async function vistaBitacora(el) {
  titulo('Bitácora de cambios', 'Quién cambió qué, cuándo y por qué · el historial de valores se conserva además en las tablas temporales de SQL Server');
  const e = await api('GET', '/estado');
  el.innerHTML = `<div class="tarjeta"><div class="cab"><h2>Registros</h2><div class="filtros">
    <select id="f-c"><option value="">Todos los profesionales</option>${e.consultores.map((c) => `<option value="${c.consultor_id}">${esc(c.clave)} · ${esc(c.nombres)}</option>`).join('')}</select>
    <select id="f-e"><option value="">Todas las entidades</option>${['actividad', 'adenda', 'plan_trabajo', 'actividad_dependencia', 'linea_base_entregable', 'control_cambio', 'consultor', 'parametro', 'feriado', 'usuario', 'ia_propuesta', 'sesion'].map((x) => `<option>${x}</option>`).join('')}</select>
    <select id="f-n"><option>100</option><option>300</option><option>1000</option></select></div></div>
    <div class="cuerpo sin tabla-env"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Origen</th><th>Acción</th><th>Registro</th><th>Cambios</th><th>Motivo</th></tr></thead><tbody id="cuerpo"><tr><td colspan="7" class="vacio">Cargando…</td></tr></tbody></table></div></div>`;
  const nombre = (id) => (e.consultores.find((c) => c.consultor_id === id) || {}).clave || '';
  const cargar = async () => {
    const q = new URLSearchParams();
    if (el.querySelector('#f-c').value) q.set('consultor_id', el.querySelector('#f-c').value);
    if (el.querySelector('#f-e').value) q.set('entidad', el.querySelector('#f-e').value);
    q.set('limite', el.querySelector('#f-n').value);
    const filas = await api('GET', `/bitacora?${q}`);
    el.querySelector('#cuerpo').innerHTML = filas.map((b) => `<tr><td class="num">${fh(b.fecha)}</td><td>${esc(b.usuario)}</td><td>${b.origen === 'IA' ? badge('NUEVA', 'IA') : esc(b.origen)}</td><td>${esc(b.accion)}</td>
      <td>${esc(b.entidad)} ${b.entidad_id ?? ''} ${b.consultor_id ? `<a href="#/consultor/${b.consultor_id}">${esc(nombre(b.consultor_id))}</a>` : ''}</td><td class="diff">${diffHtml(b.cambios_json)}</td><td class="mut2 desc">${esc(b.motivo || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="vacio">Sin registros</td></tr>';
  };
  el.querySelectorAll('select').forEach((s) => { s.onchange = cargar; });
  await cargar();
}
