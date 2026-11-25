import { api, esc, fh, titulo, badge, estado, opciones } from '../util.js';
import { diffHtml } from './consultor.js';
import { cargarProyectos } from './proyectos.js';

// Entidades que registran bitácora (las de la Etapa 2 en adelante incluidas)
const ENTIDADES = [['proyecto', 'Proyecto'], ['proyecto_miembro', 'Equipo del proyecto'], ['consultor', 'Profesional'], ['contrato', 'Contrato u Orden de Servicio'],
  ['adenda', 'Adenda o periodo'], ['entregable_servicio', 'Entregable'], ['plan_trabajo', 'Plan de trabajo'], ['actividad', 'Actividad'], ['actividad_dependencia', 'Dependencia'],
  ['parte_diario', 'Parte diario'], ['parte_diario_item', 'Ítem del parte'], ['documento', 'Documento'], ['linea_base_entregable', 'Línea base'], ['control_cambio', 'Control de cambios'],
  ['parametro', 'Parámetro'], ['feriado', 'Feriado'], ['usuario', 'Usuario'], ['ia_propuesta', 'Propuesta del asistente'], ['sesion', 'Sesión']];

/** modo 'proyecto': abierta desde el menú de un proyecto (filtra por él de entrada). */
export async function vistaBitacora(el, [modo] = []) {
  titulo('Bitácora de cambios', 'Quién cambió qué, cuándo y por qué · el historial de valores se conserva además en las tablas temporales de SQL Server');
  const proyectos = (estado.proyectos && estado.proyectos.length ? estado.proyectos : await cargarProyectos()) || [];
  const e = await api('GET', '/estado?proyecto_id='); // todos los profesionales (el filtro de proyecto se aplica aquí)
  const inicial = modo === 'proyecto' && estado.proyecto_id ? String(estado.proyecto_id) : '';
  el.innerHTML = `<div class="tarjeta"><div class="cab"><h2>Registros</h2><div class="filtros">
    <select id="f-p" aria-label="Proyecto"><option value="">Todos los proyectos</option>${opciones(proyectos.map((p) => [p.proyecto_id, `${p.codigo} · ${p.nombre}`]), inicial)}</select>
    <select id="f-c" aria-label="Profesional"></select>
    <select id="f-e" aria-label="Entidad"><option value="">Todas las entidades</option>${opciones(ENTIDADES)}</select>
    <select id="f-n" aria-label="Cantidad"><option>100</option><option>300</option><option>1000</option></select></div></div>
    <div class="cuerpo sin tabla-env"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Origen</th><th>Acción</th><th>Registro</th><th>Cambios</th><th>Motivo</th></tr></thead><tbody id="cuerpo"><tr><td colspan="7" class="vacio">Cargando…</td></tr></tbody></table></div></div>`;
  const nombre = (id) => (e.consultores.find((c) => c.consultor_id === id) || {}).clave || '';
  const etiqueta = Object.fromEntries(ENTIDADES);
  const fp = el.querySelector('#f-p'); const fc = el.querySelector('#f-c');
  // la lista de profesionales sigue al proyecto elegido
  const pintarProfesionales = () => {
    const actual = fc.value;
    const lista = e.consultores.filter((c) => !fp.value || String(c.proyecto_id ?? '') === fp.value);
    fc.innerHTML = `<option value="">Todos los profesionales</option>${opciones(lista.map((c) => [c.consultor_id, `${c.clave} · ${c.nombres}`]), actual)}`;
  };
  const cargar = async () => {
    const q = new URLSearchParams();
    if (fp.value) q.set('proyecto_id', fp.value);
    if (fc.value) q.set('consultor_id', fc.value);
    if (el.querySelector('#f-e').value) q.set('entidad', el.querySelector('#f-e').value);
    q.set('limite', el.querySelector('#f-n').value);
    const filas = await api('GET', `/bitacora?${q}`);
    el.querySelector('#cuerpo').innerHTML = filas.map((b) => `<tr><td class="num">${fh(b.fecha)}</td><td>${esc(b.usuario)}</td><td>${b.origen === 'IA' ? badge('NUEVA', 'IA') : esc(b.origen)}</td><td>${esc(b.accion)}</td>
      <td>${esc(etiqueta[b.entidad] || b.entidad)} ${b.entidad_id ?? ''} ${b.consultor_id ? `<a href="#/consultor/${b.consultor_id}">${esc(nombre(b.consultor_id))}</a>` : ''}</td><td class="diff">${diffHtml(b.cambios_json)}</td><td class="mut2 desc">${esc(b.motivo || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="vacio">Sin registros</td></tr>';
  };
  fp.onchange = () => { pintarProfesionales(); cargar(); };
  [fc, el.querySelector('#f-e'), el.querySelector('#f-n')].forEach((s) => { s.onchange = cargar; });
  pintarProfesionales();
  await cargar();
}
