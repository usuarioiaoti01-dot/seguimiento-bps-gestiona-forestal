import { api, esc, ff, titulo, modal, aviso, fallo, estado, puede, puedeProyecto, opciones } from '../util.js';
import { subirPdf } from './profesionales-proyecto.js';

const ESTADOS = [['ACTIVO', 'Activo'], ['CERRADO', 'Cerrado']];
const fecha = (s) => (s ? ff(String(s).slice(0, 10)) : '—');

/** Los proyectos vigentes (menú lateral y lista); se vuelve a leer tras registrar o cambiar uno. */
export async function cargarProyectos() {
  try { estado.proyectos = await api('GET', '/proyectos'); } catch { estado.proyectos = []; }
  if (estado.proyecto_id && !estado.proyectos.some((p) => p.proyecto_id === estado.proyecto_id)) fijarProyecto(null);
  return estado.proyectos;
}

export function fijarProyecto(id) {
  estado.proyecto_id = id ? Number(id) : null;
  try { if (estado.proyecto_id) localStorage.setItem('sgf_proyecto', String(estado.proyecto_id)); else localStorage.removeItem('sgf_proyecto'); } catch { /* almacenamiento no disponible */ }
}

export function pintarSelectorProyecto() {
  const lista = estado.proyectos || [];
  if (window.sgfPintarMenu) window.sgfPintarMenu();
  const act = lista.find((p) => p.proyecto_id === estado.proyecto_id);
  const pie = document.getElementById('proy-pie');
  if (pie) pie.textContent = act ? `${act.codigo} · ${act.financiador || 'Proyecto'}` : 'Todos los proyectos';
}

/** Lo que el proyecto maneja: define las opciones del menú y los documentos que se solicitan. */
export function caracteristicas(p) {
  return [
    p.con_profesionales ? 'Con profesionales' : 'Sin profesionales',
    p.con_adendas ? 'Adendas' : null, p.con_linea_base ? 'Línea base' : null,
    p.con_orden_servicio ? 'Orden de Servicio' : null, p.con_tdr ? 'Términos de Referencia' : null,
  ].filter(Boolean);
}

function formProyecto(p, areas) {
  const v = p || { estado: 'ACTIVO', con_profesionales: 1, con_adendas: 1, con_linea_base: 1, con_orden_servicio: 0, con_tdr: 0 };
  const bloqueado = p && p.profesionales > 0 ? 'disabled' : '';
  const caja = (n, texto, ayuda, extra = '') => `<label class="caja-car"><input type="checkbox" name="${n}" ${v[n] ? 'checked' : ''} ${extra}><span><b>${texto}</b><small>${ayuda}</small></span></label>`;
  return `<div class="form">
    <div class="campo"><label>Código del proyecto</label><input value="${esc(v.codigo || 'Se genera al registrar')}" readonly disabled title="El código lo asigna el sistema y no se puede modificar"></div>
    <div class="campo"><label>Estado</label><select name="estado">${opciones(ESTADOS, v.estado)}</select></div>
    <div class="campo ancho"><label>Nombre del proyecto</label><input name="nombre" value="${esc(v.nombre || '')}" maxlength="300" required></div>
    <div class="campo"><label>Financiador / cooperante</label><input name="financiador" value="${esc(v.financiador || '')}" maxlength="150" placeholder="Ej.: KfW, BID, Tesoro Público"></div>
    <div class="campo"><label>Gestión del proyecto (área designada por la Dirección OTI)</label><select name="area_tecnica"><option value="">— Seleccione —</option>${opciones([...(v.area_tecnica && !areas.includes(v.area_tecnica) ? [v.area_tecnica] : []), ...areas].map((x) => [x, x]), v.area_tecnica)}</select></div>
    <div class="campo"><label>Jefe de proyecto responsable</label><input value="${esc(p ? (p.responsable || 'Sin responsable: asígnelo en «Equipo»') : 'Se asigna en «Equipo», después de registrar')}" readonly disabled title="El equipo y su responsable se definen con el botón «Equipo» de la lista de proyectos"></div>
    <div class="campo"><label>Inicio</label><input type="date" name="fecha_inicio" value="${esc(String(v.fecha_inicio || '').slice(0, 10))}"></div>
    <div class="campo"><label>Fin previsto</label><input type="date" name="fecha_fin" value="${esc(String(v.fecha_fin || '').slice(0, 10))}"></div>
    <div class="campo ancho"><label>Descripción</label><textarea name="descripcion" maxlength="1000">${esc(v.descripcion || '')}</textarea></div>
    <div class="campo ancho"><b>¿Qué maneja este proyecto?</b> <span class="mut2">Según lo que elija se muestran las opciones del menú y se solicitan los documentos del personal${bloqueado ? '. Con profesionales registrados las tres primeras ya no se pueden cambiar' : ''}.</span>
      <div class="cajas-car" id="cajas-car">
        ${caja('con_profesionales', 'Tiene uno o más profesionales', 'Personal contratado cuyo plan de trabajo se formula y se sigue', bloqueado)}
        ${caja('con_adendas', 'Maneja adendas', 'Ampliaciones de plazo de los contratos', bloqueado)}
        ${caja('con_linea_base', 'Tiene línea base', 'Entregables del cronograma contra los que se mide el plan', bloqueado)}
        ${caja('con_orden_servicio', 'El personal se contrata por Orden de Servicio', 'Se adjunta su PDF y se controla su vencimiento')}
        ${caja('con_tdr', 'Se adjuntan Términos de Referencia', 'Se solicita el PDF de los TDR de cada profesional')}
      </div></div></div>`;
}

/** Sin profesionales no hay adendas, línea base ni documentos del personal. */
function enlazarCaracteristicas(form) {
  const c = (n) => form.elements[n];
  const dependientes = ['con_adendas', 'con_linea_base', 'con_orden_servicio', 'con_tdr'];
  const bloqueadas = new Set(dependientes.filter((n) => c(n).disabled));
  const ajustar = () => {
    const con = c('con_profesionales').checked;
    for (const n of dependientes) {
      const el = c(n);
      if (!con) { el.checked = false; el.disabled = true; } else el.disabled = bloqueadas.has(n);
    }
  };
  c('con_profesionales').addEventListener('change', ajustar);
  ajustar();
}

async function registrarProyecto(p) {
  let areas = [];
  try { areas = await api('GET', '/proyectos/areas'); } catch (err) { fallo(err); return false; }
  const espera = modal({
    titulo: p ? `Proyecto ${p.codigo}` : 'Registrar proyecto', ancho: 800, contenido: formProyecto(p, areas),
    botones: [{ texto: 'Cancelar', valor: null }, { texto: p ? 'Guardar' : 'Registrar proyecto', clase: 'prim', valor: 'ok' }],
  });
  const form = document.querySelector('.modal form');
  if (form) enlazarCaracteristicas(form);
  const r = await espera;
  if (r.valor !== 'ok') return false;
  try {
    if (p) {
      await api('PATCH', `/proyectos/${p.proyecto_id}`, { ...r.datos, revision: p.revision });
      aviso('Proyecto guardado', 'exito');
    } else {
      const n = await api('POST', '/proyectos', r.datos);
      aviso(`Proyecto registrado con el código ${n.codigo}.${n.con_profesionales ? ' Ahora registre sus profesionales.' : ''}`, 'exito');
    }
    await cargarProyectos(); pintarSelectorProyecto();
    return true;
  } catch (err) { fallo(err); if (err.estado === 409) await cargarProyectos(); return false; }
}

async function registrarProfesional(p, previo = {}) {
  const os = p.con_orden_servicio === 1;
  const doc = os ? 'Orden de Servicio' : 'contrato';
  const v = (n, d = '') => esc(previo[n] ?? d);
  const r = await modal({
    titulo: `Registrar profesional en ${p.codigo}`, ancho: 840,
    contenido: `<p class="mut" style="margin:0">Se crea el profesional con su ${doc}${os ? ' y su periodo de vigencia, del que se controla el vencimiento' : ' y, si indica las fechas, su primera adenda'}.${p.con_adendas ? '' : ' Este proyecto no maneja adendas.'}</p>
      <div class="form">
        <div class="campo"><label>Clave (2 a 5 letras)</label><input name="clave" maxlength="5" value="${v('clave')}" placeholder="Ej.: JQZ" style="text-transform:uppercase" required></div>
        <div class="campo"><label>Sede</label><input name="sede" maxlength="50" value="${v('sede')}" placeholder="Ej.: MIRAFLORES"></div>
        <div class="campo ancho"><label>Nombres y apellidos</label><input name="nombres" maxlength="150" value="${v('nombres')}" required></div>
        <div class="campo ancho"><label>Perfil / servicio contratado</label><input name="perfil" maxlength="200" value="${v('perfil')}" placeholder="Ej.: Analista de datos"></div>
        <div class="campo"><label>Correo institucional</label><input name="correo_institucional" type="email" maxlength="150" value="${v('correo_institucional')}"></div>
        ${p.con_linea_base ? `<div class="campo"><label>Recurso en el cronograma (MS Project)</label><input name="recurso_cronograma" maxlength="100" value="${v('recurso_cronograma')}"></div>` : ''}
        <div class="campo"><label>N.° de ${os ? 'Orden de Servicio' : 'contrato'}</label><input name="contrato_numero" maxlength="60" value="${v('contrato_numero')}" required></div>
        <div class="campo"><label>Expediente</label><input name="expediente" maxlength="40" value="${v('expediente')}"></div>
        <div class="campo ancho"><b>${os ? 'Vigencia de la Orden de Servicio' : 'Primera adenda / periodo vigente'}</b> <span class="mut2">${os ? '(obligatorio: de aquí se controla el vencimiento)' : '(opcional; también puede agregarla después)'}</span></div>
        ${!os && p.con_adendas ? `<div class="campo"><label>N.° de adenda</label><input type="number" min="0" name="adenda_numero" value="${v('adenda_numero', 1)}"></div>
        <div class="campo"><label>Estado</label><select name="adenda_estado">${opciones([['FIRMADA', 'Firmada'], ['EN_TRAMITE', 'En trámite']], previo.adenda_estado || 'FIRMADA')}</select></div>` : ''}
        <div class="campo"><label>Inicio</label><input type="date" name="adenda_inicio" value="${v('adenda_inicio')}"></div>
        <div class="campo"><label>Fin</label><input type="date" name="adenda_fin" value="${v('adenda_fin')}"></div>
        <div class="campo"><label>o plazo en días</label><input type="number" min="1" name="adenda_plazo_dias" value="${v('adenda_plazo_dias')}" placeholder="Si no indica el fin"></div>
        ${os || p.con_tdr ? '<div class="campo ancho"><b>Documentos del personal</b> <span class="mut2">(PDF, hasta 15 MB cada uno)</span></div>' : ''}
        ${os ? '<div class="campo ancho"><label>Orden de Servicio (PDF) — obligatoria</label><input type="file" name="__os" accept="application/pdf,.pdf"></div>' : ''}
        ${p.con_tdr ? '<div class="campo ancho"><label>Términos de Referencia (PDF) — obligatorios</label><input type="file" name="__tdr" accept="application/pdf,.pdf"></div>' : ''}
      </div>`,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Registrar profesional', clase: 'prim', valor: 'ok' }],
  });
  if (r.valor !== 'ok') return false;
  const archivoOS = os ? r.form.elements.__os.files[0] : null;
  const archivoTDR = p.con_tdr ? r.form.elements.__tdr.files[0] : null;
  const datos = { ...r.datos }; delete datos.__os; delete datos.__tdr;
  const faltan = [os && !archivoOS ? 'la Orden de Servicio' : null, p.con_tdr && !archivoTDR ? 'los Términos de Referencia' : null].filter(Boolean);
  if (faltan.length) { aviso(`Adjunte ${faltan.join(' y ')} (PDF) para registrar al profesional`, 'error'); return registrarProfesional(p, datos); }
  try {
    const n = await api('POST', `/proyectos/${p.proyecto_id}/profesionales`, datos);
    const pendientes = [];
    if (archivoOS) { try { await subirPdf(n.contrato.contrato_id, 'documento', archivoOS); } catch (e) { pendientes.push(`Orden de Servicio (${e.message})`); } }
    if (archivoTDR) { try { await subirPdf(n.contrato.contrato_id, 'tdr', archivoTDR); } catch (e) { pendientes.push(`Términos de Referencia (${e.message})`); } }
    aviso(`${n.consultor.nombres} registrado en ${p.codigo}`, 'exito');
    if (pendientes.length) aviso(`No se pudo adjuntar: ${pendientes.join('; ')}. Adjúntelo desde la lista de profesionales del proyecto.`, 'error');
    return true;
  } catch (err) { fallo(err); return registrarProfesional(p, datos); }
}

export async function vistaProyectos(el) {
  titulo('Proyectos', 'Cada proyecto tiene sus características, sus profesionales y la documentación que corresponde; el menú lateral abre sus opciones');
  const pintar = async () => {
    const lista = await cargarProyectos();
    pintarSelectorProyecto();
    el.innerHTML = `<div class="tarjeta"><div class="cab"><h2>Proyectos registrados (${lista.length})</h2><div class="acciones">${puede('ADMIN') ? '<button class="btn prim" id="b-nuevo-proy" type="button">Registrar proyecto</button>' : ''}</div></div>
      <div class="cuerpo sin tabla-env"><table><thead><tr><th>Código</th><th>Proyecto</th><th>Financiador</th><th>Periodo</th><th>Estado</th><th class="d">Profesionales</th><th class="d">Planes aprobados</th><th></th></tr></thead>
      ${lista.map((p) => `<tbody class="proy" data-id="${p.proyecto_id}"><tr class="proy-cab"><td class="num"><b>${esc(p.codigo)}</b></td>
        <td class="desc"><b>${esc(p.nombre)}</b>${estado.usuario?.rol === 'JEFE_PROYECTO' && !p.escribe ? ' <span class="badge b-gris" title="No integra el equipo de este proyecto: puede consultarlo, no modificarlo">Solo lectura</span>' : ''}</td>
        <td>${esc(p.financiador || '—')}</td>
        <td class="num">${fecha(p.fecha_inicio)} – ${fecha(p.fecha_fin)}</td>
        <td>${p.estado === 'CERRADO' ? '<span class="badge b-gris">Cerrado</span>' : '<span class="badge b-verde">Activo</span>'}</td>
        <td class="d num">${p.activos} / ${p.profesionales}</td><td class="d num">${p.planes_aprobados} / ${p.profesionales}</td>
        <td style="white-space:nowrap">${p.con_profesionales ? `<button class="btn peq" data-ver="${p.proyecto_id}" type="button">Ver seguimiento</button>` : ''}
          ${puedeProyecto(p.proyecto_id) && p.con_profesionales ? `<button class="btn peq" data-prof="${p.proyecto_id}" type="button" ${p.estado === 'CERRADO' ? 'disabled' : ''}>Registrar profesional</button>` : ''}
          <button class="btn peq" data-equipo="${p.proyecto_id}" type="button">Equipo</button>${puede('ADMIN') ? `<button class="btn peq" data-editar="${p.proyecto_id}" type="button">Editar</button>` : ''}</td></tr>
        <tr class="proy-det"><td></td><td colspan="7"><dl class="proy-datos">
          <div><dt>Código</dt><dd>${esc(p.codigo)}</dd></div>
          <div><dt>Gestión del proyecto</dt><dd>${esc(p.area_tecnica || '—')}</dd></div>
          <div><dt>Jefe de proyecto responsable</dt><dd>${esc(p.responsable || 'Sin responsable asignado')}</dd></div>
          <div class="ancho"><dt>Equipo del proyecto</dt><dd>${(p.equipo || []).length ? p.equipo.map((m) => `<span class="badge ${m.es_responsable ? 'b-verde' : 'b-gris'}">${esc(m.nombre)}</span>`).join(' ') : '<span class="mut2">Sin equipo asignado: solo el Administrador puede modificar este proyecto</span>'}</dd></div>
          <div><dt>Financiador</dt><dd>${esc(p.financiador || '—')}</dd></div>
          <div><dt>Inicio</dt><dd>${fecha(p.fecha_inicio)}</dd></div>
          <div><dt>Fin previsto</dt><dd>${fecha(p.fecha_fin)}</dd></div>
          <div><dt>Estado</dt><dd>${p.estado === 'CERRADO' ? 'Cerrado' : 'Activo'}</dd></div>
          <div class="ancho"><dt>Características</dt><dd>${caracteristicas(p).map((x) => `<span class="badge b-gris">${esc(x)}</span>`).join(' ')}</dd></div>
          <div class="ancho"><dt>Descripción</dt><dd>${esc(p.descripcion || '—')}</dd></div></dl></td></tr></tbody>`).join('')}
      ${lista.length ? '' : '<tbody><tr><td colspan="8" class="vacio">Aún no hay proyectos</td></tr></tbody>'}</table></div></div>`;
    el.querySelectorAll('[data-equipo]').forEach(b => { b.onclick = () => editarEquipo(Number(b.dataset.equipo)).then(pintar).catch(fallo); });
    const buscar = (id) => lista.find((p) => p.proyecto_id === Number(id));
    const nuevo = el.querySelector('#b-nuevo-proy');
    if (nuevo) nuevo.onclick = async () => { if (await registrarProyecto(null)) pintar(); };
    el.querySelectorAll('[data-editar]').forEach((b) => { b.onclick = async () => { if (await registrarProyecto(buscar(b.dataset.editar))) pintar(); }; });
    el.querySelectorAll('[data-prof]').forEach((b) => { b.onclick = async () => { if (await registrarProfesional(buscar(b.dataset.prof))) pintar(); }; });
    el.querySelectorAll('[data-ver]').forEach((b) => { b.onclick = () => { fijarProyecto(b.dataset.ver); pintarSelectorProyecto(); location.hash = '#/seguimiento'; }; });
  };
  await pintar();
}

/**
 * Equipo del proyecto (db/15): Jefes de Proyecto del Equipo de Desarrollo que registran y supervisan el proyecto.
 * Todos lo consultan; solo el Administrador agrega, quita o cambia al responsable (el servidor lo vuelve a validar).
 */
async function editarEquipo(id) {
  const p = (estado.proyectos || []).find((x) => x.proyecto_id === Number(id)) || { codigo: '' };
  for (;;) {
    const miembros = await api('GET', `/proyectos/${id}/equipo`);
    const admin = puede('ADMIN');
    const usuarios = admin ? (await api('GET', '/usuarios')).filter((u) => u.activo && u.rol === 'JEFE_PROYECTO' && !miembros.some((m) => m.usuario_id === u.usuario_id)) : [];
    const filas = miembros.map((m) => `<tr>
        ${admin ? `<td><input type="radio" name="miembro_id" value="${m.miembro_id}" aria-label="Elegir a ${esc(m.nombre)}"></td>` : ''}
        <td><b>${esc(m.nombre)}</b>${m.correo ? `<br><span class="mut2">${esc(m.correo)}</span>` : ''}${m.cuenta_activa ? '' : ' <span class="badge b-gris">Cuenta desactivada</span>'}</td>
        <td>${m.es_responsable ? '<span class="badge b-verde">Responsable</span>' : '<span class="badge b-gris">Miembro</span>'}</td>
        <td class="num">${fecha(m.desde)}</td></tr>`).join('');
    const r = await modal({
      titulo: `Equipo del proyecto ${p.codigo}`, ancho: 720,
      contenido: `<p class="mut" style="margin:0">Los miembros del equipo registran los avances, los documentos y las aprobaciones de este proyecto. Los demás Jefes de Proyecto solo lo consultan; el Administrador puede modificar todos.</p>
        <table><thead><tr>${admin ? '<th></th>' : ''}<th>Jefe de Proyecto</th><th>Rol en el proyecto</th><th>Desde</th></tr></thead>
        <tbody>${filas || `<tr><td colspan="${admin ? 4 : 3}" class="vacio">Sin equipo asignado: solo el Administrador puede modificar este proyecto.</td></tr>`}</tbody></table>
        ${admin ? `<div class="form"><div class="campo ancho"><label>Agregar al equipo (cuentas con perfil Jefe de Proyecto)</label><select name="usuario_id"><option value="">— Seleccione —</option>${opciones(usuarios.map((u) => [u.usuario_id, `${u.nombre} · ${u.correo}`]))}</select>
          ${usuarios.length ? '' : '<small class="mut2">No hay otras cuentas activas con perfil Jefe de Proyecto. Créelas en Configuración.</small>'}</div>
          <label class="caja-car"><input type="checkbox" name="es_responsable"><span><b>Agregar como responsable</b><small>Reemplaza al responsable actual</small></span></label></div>` : ''}`,
      botones: admin
        ? [{ texto: 'Cerrar', valor: null }, { texto: 'Quitar del equipo', valor: 'quitar' }, { texto: 'Marcar como responsable', valor: 'responsable' }, { texto: 'Agregar', clase: 'prim', valor: 'agregar' }]
        : [{ texto: 'Cerrar', valor: null }],
    });
    if (!r.valor) return;
    try {
      if (r.valor === 'agregar') {
        if (!r.datos.usuario_id) { aviso('Elija la cuenta que se agrega al equipo', 'error'); continue; }
        await api('POST', `/proyectos/${id}/equipo`, { usuario_id: Number(r.datos.usuario_id), es_responsable: !!r.datos.es_responsable });
        aviso('Integrante agregado al equipo', 'exito');
      } else {
        const m = miembros.find((x) => x.miembro_id === Number(r.datos.miembro_id));
        if (!m) { aviso('Elija en la lista al integrante del equipo', 'error'); continue; }
        if (r.valor === 'responsable') await api('PATCH', `/proyectos/${id}/equipo/${m.miembro_id}`, { es_responsable: 1, revision: m.revision });
        else await api('POST', `/proyectos/${id}/equipo/${m.miembro_id}/quitar`, { revision: m.revision });
        aviso(r.valor === 'responsable' ? `${m.nombre} es ahora el responsable del proyecto` : `${m.nombre} salió del equipo`, 'exito');
      }
    } catch (e) { fallo(e); }
  }
}
