import { api, esc, ff, fh, titulo, puede, aviso, fallo, modal, opciones, estado } from '../util.js';

export async function vistaConfiguracion(el) {
  titulo('Configuración', 'Parámetros del pronóstico, calendario de feriados, usuarios y consumo del asistente');
  const admin = puede('ADMIN');
  const { parametros, feriados, corte_vigente: corte } = await api('GET', '/parametros');
  const [usuarios, uso] = admin ? await Promise.all([api('GET', '/usuarios'), api('GET', '/ia/uso')]) : [[], []];
  el.innerHTML = `
  <div class="rejilla-2">
    <div class="tarjeta"><div class="cab"><h2>Parámetros del pronóstico</h2><span class="mut2">Corte vigente: ${ff(corte)}</span></div>
      <div class="cuerpo sin tabla-env"><table><thead><tr><th>Parámetro</th><th>Valor</th><th>Descripción</th><th></th></tr></thead><tbody>
      ${parametros.map((p) => `<tr><td class="num"><b>${esc(p.codigo)}</b></td><td>${esc(p.valor || '(vacío)')}</td><td class="mut2 desc">${esc(p.descripcion || '')}</td><td>${admin ? `<button class="btn peq" data-p="${esc(p.codigo)}">Cambiar</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="tarjeta"><div class="cab"><h2>Feriados y días no laborables</h2>${admin ? '<button class="btn peq" id="b-fer">Agregar</button>' : ''}</div>
      <div class="cuerpo sin tabla-env" style="max-height:380px;overflow:auto"><table><thead><tr><th>Fecha</th><th>Descripción</th><th>Tipo</th><th></th></tr></thead><tbody>
      ${feriados.map((f) => `<tr><td class="num">${ff(f.fecha)}</td><td>${esc(f.descripcion)}</td><td class="mut2">${esc(f.tipo)}</td><td>${admin ? `<button class="btn peq peligro" data-f="${esc(f.fecha)}">Quitar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="cuerpo mut2">Solo se usan en planes configurados en días hábiles. Verifique cada año los feriados y los días no laborables que declare el Poder Ejecutivo para el sector público.</div></div>
  </div>
  ${admin ? `<div class="rejilla-2">
    <div class="tarjeta"><div class="cab"><h2>Usuarios</h2><button class="btn peq prim" id="b-usr">Nuevo usuario</button></div>
      <div class="cuerpo sin tabla-env"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead><tbody>
      ${usuarios.map((u) => `<tr><td>${esc(u.nombre)}</td><td>${esc(u.correo)}</td><td>${esc(u.rol)}</td><td>${u.activo ? 'Activo' : 'Inactivo'}</td><td class="num mut2">${fh(u.ultimo_acceso)}</td><td><button class="btn peq" data-u="${u.usuario_id}">Editar</button></td></tr>`).join('')}</tbody></table></div>
      <div class="cuerpo mut2">ADMIN: todo, incluidos usuarios, parámetros y datos personales. EDITOR: registra seguimiento, adendas y reprogramaciones. LECTOR: solo consulta y simula.</div></div>
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
  if (bu) bu.onclick = () => editarUsuario(null);
  el.querySelectorAll('[data-u]').forEach((b) => { b.onclick = () => editarUsuario(usuarios.find((u) => u.usuario_id === Number(b.dataset.u))); });
}

async function editarUsuario(u) {
  const nuevo = !u;
  const r = await modal({
    titulo: nuevo ? 'Nuevo usuario' : u.nombre,
    contenido: `<div class="form">
      <div class="campo ancho"><label>Correo institucional</label><input name="correo" type="email" value="${esc(u ? u.correo : '')}" ${nuevo ? '' : 'disabled'}></div>
      <div class="campo ancho"><label>Nombre</label><input name="nombre" value="${esc(u ? u.nombre : '')}"></div>
      <div class="campo"><label>Rol</label><select name="rol">${opciones([['LECTOR', 'Lector'], ['EDITOR', 'Editor'], ['ADMIN', 'Administrador']], u ? u.rol : 'LECTOR')}</select></div>
      ${nuevo ? '' : `<div class="campo"><label>Estado</label><select name="activo">${opciones([[1, 'Activo'], [0, 'Inactivo']], u.activo ? 1 : 0)}</select></div>`}</div>`,
    botones: [...(nuevo ? [] : [{ texto: 'Restablecer clave', valor: 'reset' }]), { texto: 'Cancelar', valor: null }, { texto: 'Guardar', clase: 'prim', valor: 'ok' }],
  });
  if (!r.valor) return;
  try {
    let res;
    if (nuevo) res = await api('POST', '/usuarios', r.datos);
    else res = await api('PATCH', `/usuarios/${u.usuario_id}`, { nombre: r.datos.nombre, rol: r.datos.rol, activo: Number(r.datos.activo), restablecer: r.valor === 'reset' });
    if (res.clave_temporal) {
      await modal({ titulo: 'Clave temporal', contenido: `<p>Entregue esta clave a <b>${esc(res.usuario.correo)}</b> por un canal seguro. Se le pedirá cambiarla en su primer ingreso y no se volverá a mostrar.</p><p style="font:600 18px var(--mono);user-select:all">${esc(res.clave_temporal)}</p>` });
    }
    aviso('Usuario guardado', 'exito'); window.sgfRefrescar();
  } catch (err) { fallo(err); }
}
