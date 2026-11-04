import { api, esc, ff, fh, titulo, puede, aviso, fallo, modal, opciones, estado, NOMBRE_PERFIL } from '../util.js';

export async function vistaConfiguracion(el) {
  titulo('Configuración', 'Parámetros del pronóstico, calendario de feriados, usuarios y consumo del asistente');
  const admin = puede('ADMIN'); // Administrador: usuarios y perfiles
  const jefe = puede('EDITOR'); // Jefe de Proyecto y Administrador: parámetros, feriados y consumo de IA
  const { parametros, feriados, corte_vigente: corte } = await api('GET', '/parametros');
  const [usuarios, uso, e] = await Promise.all([admin ? api('GET', '/usuarios') : [], jefe ? api('GET', '/ia/uso') : [], admin ? api('GET', '/estado') : { consultores: [] }]);
  const consultores = e.consultores;
  const claveDe = Object.fromEntries(consultores.map((c) => [c.consultor_id, c.clave]));
  el.innerHTML = `
  <div class="rejilla-2">
    <div class="tarjeta"><div class="cab"><h2>Parámetros del pronóstico</h2><span class="mut2">Corte vigente: ${ff(corte)}</span></div>
      <div class="cuerpo sin tabla-env"><table><thead><tr><th>Parámetro</th><th>Valor</th><th>Descripción</th><th></th></tr></thead><tbody>
      ${parametros.map((p) => `<tr><td class="num"><b>${esc(p.codigo)}</b></td><td>${esc(p.valor || '(vacío)')}</td><td class="mut2 desc">${esc(p.descripcion || '')}</td><td>${jefe ? `<button class="btn peq" data-p="${esc(p.codigo)}">Cambiar</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="tarjeta"><div class="cab"><h2>Feriados y días no laborables</h2>${jefe ? '<button class="btn peq" id="b-fer">Agregar</button>' : ''}</div>
      <div class="cuerpo sin tabla-env" style="max-height:380px;overflow:auto"><table><thead><tr><th>Fecha</th><th>Descripción</th><th>Tipo</th><th></th></tr></thead><tbody>
      ${feriados.map((f) => `<tr><td class="num">${ff(f.fecha)}</td><td>${esc(f.descripcion)}</td><td class="mut2">${esc(f.tipo)}</td><td>${jefe ? `<button class="btn peq peligro" data-f="${esc(f.fecha)}">Quitar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="cuerpo mut2">Solo se usan en planes configurados en días hábiles. Verifique cada año los feriados y los días no laborables que declare el Poder Ejecutivo para el sector público.</div></div>
  </div>
  ${jefe ? `<div class="rejilla-2">
    ${admin ? `<div class="tarjeta"><div class="cab"><h2>Usuarios</h2><div class="acciones">
        <button class="btn peq" id="b-lote">Crear cuentas de profesionales</button><button class="btn peq prim" id="b-usr">Nuevo usuario</button></div></div>
      <div class="cuerpo sin tabla-env"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Perfil</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead><tbody>
      ${usuarios.map((u) => `<tr class="${u.activo ? '' : 'anulada'}"><td>${esc(u.nombre)}</td><td>${esc(u.correo)}</td>
        <td>${esc(NOMBRE_PERFIL[u.rol] || u.rol)}${u.consultor_id ? ` <span class="mut2">${esc(claveDe[u.consultor_id] || '')}</span>` : ''}</td>
        <td>${u.activo ? 'Activo' : 'Inactivo'}${u.debe_cambiar_clave ? '<br><span class="mut2">clave temporal</span>' : ''}</td><td class="num mut2">${fh(u.ultimo_acceso)}</td>
        <td style="white-space:nowrap"><button class="btn peq" data-u="${u.usuario_id}">Editar</button> <button class="btn peq" data-reset="${u.usuario_id}">Restablecer clave</button>
          ${u.correo === estado.usuario.correo ? '' : `<button class="btn peq ${u.activo ? 'peligro' : ''}" data-act="${u.usuario_id}">${u.activo ? 'Desactivar' : 'Activar'}</button>`}</td></tr>`).join('')}</tbody></table></div>
      <div class="cuerpo mut2"><b>Administrador:</b> acceso total, crea usuarios y modifica perfiles. <b>Jefe de Proyecto:</b> todo, menos crear usuarios y modificar perfiles. <b>Profesional:</b> solo su propia información; actualiza el estado y el avance de sus actividades. Las cuentas no se eliminan: se desactivan.</div></div>` : ''}
    <div class="tarjeta"><div class="cab"><h2>Consumo del asistente de IA</h2><span class="mut2">${estado.ia ? 'Activo' : 'Sin ANTHROPIC_API_KEY'}</span></div>
      <div class="cuerpo sin tabla-env"><table><thead><tr><th>Día</th><th class="d">Respuestas</th><th class="d">Tokens de entrada</th><th class="d">Tokens de salida</th></tr></thead><tbody>
      ${uso.map((x) => `<tr><td class="num">${ff(x.dia)}</td><td class="d num">${x.respuestas}</td><td class="d num">${Number(x.tokens_entrada).toLocaleString('es-PE')}</td><td class="d num">${Number(x.tokens_salida).toLocaleString('es-PE')}</td></tr>`).join('') || '<tr><td colspan="4" class="vacio">Sin consumo registrado</td></tr>'}</tbody></table></div>
      <div class="cuerpo mut2">Sirve de sustento para dimensionar los créditos de consumo (tokens) del servicio de IA.</div></div>
  </div>` : ''}`;

  el.querySelectorAll('[data-p]').forEach((b) => { b.onclick = async () => {
    const p = parametros.find((x) => x.codigo === b.dataset.p);
    const campo = p.codigo === 'FECHA_CORTE' ? `<input type="date" name="valor" value="${esc(p.valor)}"><span class="mut2">Déjelo vacío para usar siempre la fecha del día.</span>`
      : p.codigo === 'METODO_PRONOSTICO' ? `<select name="valor">${opciones([['RENDIMIENTO', 'Rendimiento (SPI)'], ['LINEAL', 'Lineal']], p.valor)}</select>` : `<input name="valor" value="${esc(p.valor)}">`;
    const r = await modal({ titulo: p.codigo, contenido: `<p class="mut" style="margin:0">${esc(p.descripcion || '')}</p><div class="campo">${campo}</div>`, botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Guardar', clase: 'prim', valor: 'ok' }] });
    if (r.valor !== 'ok') return;
    try { await api('PUT', `/parametros/${p.codigo}`, { valor: r.datos.valor ?? '' }); aviso('Parámetro actualizado · pronóstico recalculado', 'exito'); window.sgfRefrescar(); } catch (err) { fallo(err); }
  }; });
  el.querySelectorAll('[data-f]').forEach((b) => { b.onclick = async () => { try { await api('DELETE', `/feriados/${b.dataset.f}`); window.sgfRefrescar(); } catch (err) { fallo(err); } }; });
  const bf = el.querySelector('#b-fer');
  if (bf) bf.onclick = async () => {
    const r = await modal({ titulo: 'Agregar feriado o día no laborable', contenido: `<div class="form"><div class="campo"><label>Fecha</label><input type="date" name="fecha"></div><div class="campo"><label>Tipo</label><select name="tipo"><option value="FERIADO">Feriado</option><option value="NO_LABORABLE">Día no laborable</option></select></div><div class="campo ancho"><label>Descripción</label><input name="descripcion"></div></div>`, botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Guardar', clase: 'prim', valor: 'ok' }] });
    if (r.valor !== 'ok') return;
    try { await api('POST', '/feriados', r.datos); window.sgfRefrescar(); } catch (err) { fallo(err); }
  };
  const bu = el.querySelector('#b-usr');
  if (bu) bu.onclick = () => editarUsuario(null, consultores, usuarios);
  const bl = el.querySelector('#b-lote');
  if (bl) bl.onclick = () => crearCuentasProfesionales(consultores, usuarios);
  const usuarioDe = (id) => usuarios.find((u) => u.usuario_id === Number(id));
  el.querySelectorAll('[data-u]').forEach((b) => { b.onclick = () => editarUsuario(usuarioDe(b.dataset.u), consultores, usuarios); });
  el.querySelectorAll('[data-reset]').forEach((b) => { b.onclick = () => restablecerClave(usuarioDe(b.dataset.reset)); });
  el.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => cambiarActivo(usuarioDe(b.dataset.act)); });
}

/** Muestra las claves temporales (una sola vez) con un botón para copiarlas. */
async function mostrarClaves(titulo, filas) {
  const texto = filas.map((f) => `${f.nombre} · ${f.correo} · ${f.clave_temporal}`).join('\n');
  const p = modal({
    titulo, ancho: 760, botones: [{ texto: 'Cerrar', clase: 'prim', valor: 'ok' }],
    contenido: `<p class="mut" style="margin:0">Entregue cada clave a su titular por un canal seguro. <b>No se volverá a mostrar</b>: cada persona deberá definir su clave propia en su primer ingreso.</p>
      <div class="tabla-env"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Clave temporal</th></tr></thead><tbody>
      ${filas.map((f) => `<tr><td>${esc(f.nombre)}</td><td>${esc(f.correo)}</td><td style="font:600 15px var(--mono);user-select:all">${esc(f.clave_temporal)}</td></tr>`).join('')}</tbody></table></div>
      <div><button type="button" class="btn peq" id="b-copiar">Copiar todo</button></div>`,
  });
  const copiar = document.querySelector('.velo #b-copiar');
  if (copiar) copiar.onclick = async () => { try { await navigator.clipboard.writeText(texto); aviso('Claves copiadas', 'exito'); } catch { aviso('No se pudo copiar: seleccione las claves manualmente', 'error'); } };
  await p;
}

/** Alta de las cuentas de los profesionales que aún no tienen: un correo por cada uno (de cualquier dominio). */
async function crearCuentasProfesionales(consultores, usuarios) {
  const conCuenta = new Set(usuarios.filter((u) => u.consultor_id).map((u) => u.consultor_id));
  const pendientes = consultores.filter((c) => !conCuenta.has(c.consultor_id));
  if (!pendientes.length) { aviso('Todos los profesionales ya tienen una cuenta', 'exito'); return; }
  const r = await modal({
    titulo: `Crear cuentas de profesionales (${pendientes.length})`, ancho: 820,
    contenido: `<p class="mut" style="margin:0">Escriba el correo de cada profesional (puede ser de cualquier dominio). Se creará una cuenta con perfil Profesional y una clave temporal distinta para cada una. Las filas sin correo se omiten.</p>
      <div class="tabla-env" style="max-height:55vh;overflow:auto"><table><thead><tr><th>Profesional</th><th>Correo</th></tr></thead><tbody>
      ${pendientes.map((c) => `<tr><td>${esc(c.nombres)} <span class="mut2">${esc(c.clave)}</span></td><td><input type="email" name="correo_${c.consultor_id}" autocomplete="off" style="width:100%" aria-label="Correo de ${esc(c.nombres)}"></td></tr>`).join('')}</tbody></table></div>`,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Crear cuentas', clase: 'prim', valor: 'ok' }],
  });
  if (r.valor !== 'ok') return;
  const cuentas = pendientes.map((c) => ({ consultor_id: c.consultor_id, correo: (r.datos[`correo_${c.consultor_id}`] || '').trim() })).filter((x) => x.correo);
  if (!cuentas.length) { aviso('Escriba al menos un correo', 'error'); return; }
  try {
    const res = await api('POST', '/usuarios/profesionales', { cuentas });
    await mostrarClaves(`${res.cuentas.length} cuenta(s) creada(s)`, res.cuentas);
    window.sgfRefrescar();
  } catch (err) { fallo(err); }
}

async function restablecerClave(u) {
  const ok = await modal({
    titulo: 'Restablecer clave', botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Restablecer', clase: 'prim', valor: 'ok' }],
    contenido: `<p style="margin:0">Se generará una nueva clave temporal para <b>${esc(u.nombre)}</b> (${esc(u.correo)}). La clave actual dejará de servir y se le pedirá definir una nueva en su próximo ingreso.</p>`,
  });
  if (ok.valor !== 'ok') return;
  try {
    const res = await api('PATCH', `/usuarios/${u.usuario_id}`, { restablecer: true });
    await mostrarClaves('Clave restablecida', [{ nombre: res.usuario.nombre, correo: res.usuario.correo, clave_temporal: res.clave_temporal }]);
    window.sgfRefrescar();
  } catch (err) { fallo(err); }
}

async function cambiarActivo(u) {
  const desactivar = !!u.activo;
  const ok = await modal({
    titulo: desactivar ? 'Desactivar cuenta' : 'Activar cuenta', botones: [{ texto: 'Cancelar', valor: null }, { texto: desactivar ? 'Desactivar' : 'Activar', clase: 'prim', valor: 'ok' }],
    contenido: `<p style="margin:0">${desactivar ? `<b>${esc(u.nombre)}</b> ya no podrá ingresar y su sesión actual se cerrará de inmediato. La cuenta no se elimina: puede volver a activarla.` : `<b>${esc(u.nombre)}</b> podrá volver a ingresar con su clave actual.`}</p>`,
  });
  if (ok.valor !== 'ok') return;
  try { await api('PATCH', `/usuarios/${u.usuario_id}`, { activo: desactivar ? 0 : 1 }); aviso(desactivar ? 'Cuenta desactivada' : 'Cuenta activada', 'exito'); window.sgfRefrescar(); } catch (err) { fallo(err); }
}

async function editarUsuario(u, consultores, usuarios) {
  const nuevo = !u;
  const propia = !nuevo && u.correo === estado.usuario.correo; // no puede cambiar su propio perfil ni desactivarse
  const ocupados = new Set(usuarios.filter((x) => x.consultor_id && (!u || x.usuario_id !== u.usuario_id)).map((x) => x.consultor_id));
  const libres = consultores.filter((c) => !ocupados.has(c.consultor_id));
  const p = modal({
    titulo: nuevo ? 'Nuevo usuario' : u.nombre,
    contenido: `<div class="form">
      <div class="campo ancho"><label>Correo electrónico (cualquier dominio)</label><input name="correo" type="email" value="${esc(u ? u.correo : '')}" ${nuevo ? '' : 'disabled'}></div>
      <div class="campo ancho"><label>Nombre</label><input name="nombre" value="${esc(u ? u.nombre : '')}"></div>
      <div class="campo"><label>Perfil</label><select name="rol" ${propia ? 'disabled' : ''}>${opciones([['PROFESIONAL', 'Profesional'], ['JEFE_PROYECTO', 'Jefe de Proyecto'], ['ADMIN', 'Administrador']], u ? u.rol : 'PROFESIONAL')}</select></div>
      <div class="campo" id="c-prof"><label>Profesional al que pertenece</label><select name="consultor_id"><option value="">— Seleccione —</option>${opciones(libres.map((c) => [c.consultor_id, `${c.nombres} (${c.clave})`]), u && u.consultor_id)}</select></div>
      ${nuevo ? '' : `<div class="campo"><label>Estado</label><select name="activo" ${propia ? 'disabled' : ''}>${opciones([[1, 'Activo'], [0, 'Inactivo']], u.activo ? 1 : 0)}</select></div>`}</div>
      ${nuevo ? '<p class="mut2" style="margin:0">Se generará una clave temporal que se mostrará una sola vez; se pedirá cambiarla en el primer ingreso.</p>' : ''}`,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Guardar', clase: 'prim', valor: 'ok' }],
  });
  const velo = document.querySelector('.velo');
  const selRol = velo.querySelector('[name="rol"]');
  const mostrarProf = () => { velo.querySelector('#c-prof').style.display = selRol.value === 'PROFESIONAL' ? '' : 'none'; };
  selRol.onchange = mostrarProf; mostrarProf();
  const r = await p;
  if (r.valor !== 'ok') return;
  try {
    const rol = propia ? u.rol : r.datos.rol;
    const consultor_id = rol === 'PROFESIONAL' ? Number(r.datos.consultor_id) || null : null;
    let res;
    if (nuevo) res = await api('POST', '/usuarios', { correo: r.datos.correo, nombre: r.datos.nombre, rol, consultor_id });
    else res = await api('PATCH', `/usuarios/${u.usuario_id}`, { nombre: r.datos.nombre, rol, consultor_id, ...(propia ? {} : { activo: Number(r.datos.activo) }) });
    if (res.clave_temporal) await mostrarClaves('Clave temporal', [{ nombre: res.usuario.nombre, correo: res.usuario.correo, clave_temporal: res.clave_temporal }]);
    aviso('Usuario guardado', 'exito'); window.sgfRefrescar();
  } catch (err) { fallo(err); }
}
