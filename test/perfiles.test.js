'use strict';
// Perfiles de usuario: Administrador, Jefe de Proyecto y Profesional (alcance, cuentas y claves).
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-perf-'));
process.env.MODO_DATOS = 'memoria';
process.env.ARCHIVO_DEMO = path.join(tmp, 'demo.json');
process.env.DOCUMENTOS_RAIZ = path.join(tmp, 'almacen');
process.env.PLANES_PDF_DIR = path.join(tmp, 'planes-pdf');
process.env.CONTRATOS_PDF_DIR = path.join(tmp, 'contratos-pdf');
process.env.PLANES_ORIGEN_DIR = path.join(tmp, 'planes-origen');
process.env.DOCUMENTOS_DIR = path.join(tmp, 'documentos');
process.env.ADMIN_CORREO = 'admin.principal@serfor.gob.pe';
process.env.ADMIN_CLAVE_INICIAL = 'ClavePrincipal2026';
process.env.FECHA_CORTE_PRUEBA = '1';
process.env.ANTHROPIC_API_KEY = '';
const { crearApp } = require('../server/server');

let base; let servidor;

/** Cliente HTTP con su propia cookie de sesión (para probar varios usuarios a la vez). */
function cliente() {
  let cookie = '';
  const llamar = async (metodo, ruta, cuerpo) => {
    const r = await fetch(base + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-SGF': '1', Cookie: cookie }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = t; }
    return { estado: r.status, cuerpo: j };
  };
  /** Ingresa y cambia la clave temporal (primer ingreso). */
  llamar.entrar = async (correo, clave, nueva = `Nueva${Date.now()}x9`) => {
    const ing = await llamar('POST', '/api/auth/ingresar', { correo, clave });
    if (ing.estado !== 200) return ing;
    if (ing.cuerpo.usuario.cambiarClave) {
      const c = await llamar('POST', '/api/auth/cambiar-clave', { actual: clave, nueva });
      assert.equal(c.estado, 200, JSON.stringify(c.cuerpo));
    }
    return ing;
  };
  llamar.cookie = () => cookie;
  return llamar;
}

let admin; let semillaEstado; let ids;

test.before(async () => {
  const { app } = await crearApp();
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
  admin = cliente();
  assert.equal((await admin.entrar('admin.principal@serfor.gob.pe', 'ClavePrincipal2026')).estado, 200);
  semillaEstado = (await admin('GET', '/api/estado')).cuerpo;
  ids = Object.fromEntries(semillaEstado.consultores.map((c) => [c.clave, c.consultor_id]));
});
test.after(() => servidor.close());

/** El Jefe de Proyecto escribe solo en los proyectos de su equipo (db/15): el Administrador lo integra. */
async function integrar(usuarioId, proyectoId = 1, esResponsable = false) {
  const r = await admin('POST', `/api/proyectos/${proyectoId}/equipo`, { usuario_id: usuarioId, es_responsable: esResponsable });
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
  return r.cuerpo;
}

const correoDe = (clave) => `${clave.toLowerCase()}@${clave.length % 2 ? 'gmail.com' : 'serfor.gob.pe'}`; // cualquier dominio

test('el Administrador crea las 11 cuentas de profesionales de una vez, con correos de cualquier dominio y una clave temporal distinta', async () => {
  const cuentas = semillaEstado.consultores.map((c) => ({ consultor_id: c.consultor_id, correo: correoDe(c.clave) }));
  assert.equal(cuentas.length, 11);
  const r = await admin('POST', '/api/usuarios/profesionales', { cuentas });
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
  assert.equal(r.cuerpo.cuentas.length, 11);
  const claves = r.cuerpo.cuentas.map((x) => x.clave_temporal);
  assert.equal(new Set(claves).size, 11, 'cada cuenta tiene su propia clave');
  assert.ok(claves.every((k) => k.length >= 8));
  const lista = (await admin('GET', '/api/usuarios')).cuerpo;
  const profes = lista.filter((u) => u.rol === 'PROFESIONAL');
  assert.equal(profes.length, 11);
  assert.ok(profes.every((u) => u.activo && u.debe_cambiar_clave && u.consultor_id && !u.clave_hash));
  // repetir el alta: ya tienen cuenta
  assert.equal((await admin('POST', '/api/usuarios/profesionales', { cuentas })).estado, 409);
  globalThis.__claves = Object.fromEntries(r.cuerpo.cuentas.map((x) => [x.clave, x]));
});

test('alta de cuentas: valida todo antes de crear nada y exige el profesional para ese perfil', async () => {
  assert.equal((await admin('POST', '/api/usuarios', { correo: 'sin-vinculo@ejemplo.org', nombre: 'X', rol: 'PROFESIONAL' })).estado, 400);
  assert.equal((await admin('POST', '/api/usuarios', { correo: 'no-es-correo', nombre: 'X', rol: 'JEFE_PROYECTO' })).estado, 400);
  assert.equal((await admin('POST', '/api/usuarios', { correo: 'x@ejemplo.org', nombre: 'X', rol: 'EDITOR' })).estado, 400, 'EDITOR ya no es un perfil');
  assert.equal((await admin('POST', '/api/usuarios', { correo: 'otro@ejemplo.org', rol: 'PROFESIONAL', consultor_id: ids.APA })).estado, 409, 'APA ya tiene cuenta');
  const antes = (await admin('GET', '/api/usuarios')).cuerpo.length;
  const mal = await admin('POST', '/api/usuarios/profesionales', { cuentas: [{ consultor_id: 9999, correo: 'a@b.co' }] });
  assert.equal(mal.estado, 400);
  assert.equal((await admin('GET', '/api/usuarios')).cuerpo.length, antes);
});

test('primer ingreso: la clave temporal obliga a definir una clave propia antes de usar la aplicación', async () => {
  const c = cliente();
  const x = globalThis.__claves.EBS;
  const ing = await c('POST', '/api/auth/ingresar', { correo: x.correo, clave: x.clave_temporal });
  assert.equal(ing.estado, 200);
  assert.equal(ing.cuerpo.usuario.cambiarClave, true);
  assert.equal(ing.cuerpo.usuario.rol, 'PROFESIONAL');
  const bloqueada = await c('GET', `/api/consultores/${ids.EBS}`);
  assert.equal(bloqueada.estado, 403);
  assert.equal(bloqueada.cuerpo.cambiarClave, true);
  assert.equal((await c('POST', '/api/auth/cambiar-clave', { actual: x.clave_temporal, nueva: 'corta' })).estado, 400);
  assert.equal((await c('POST', '/api/auth/cambiar-clave', { actual: x.clave_temporal, nueva: 'ClavePropia2026x' })).estado, 200);
  assert.equal((await c('GET', `/api/consultores/${ids.EBS}`)).estado, 200);
});

test('Profesional: solo ve su propia información y no accede a nada más', async () => {
  const p = cliente();
  const x = globalThis.__claves.CAC;
  await p.entrar(x.correo, x.clave_temporal, 'ClaveCAC2026x1');
  const yo = (await p('GET', '/api/auth/yo')).cuerpo.usuario;
  assert.equal(yo.consultor_id, ids.CAC);

  assert.equal((await p('GET', `/api/consultores/${ids.CAC}`)).estado, 200);
  assert.equal((await p('GET', `/api/consultores/${ids.ERB}`)).estado, 403);
  assert.equal((await p('GET', `/api/bitacora?consultor_id=${ids.CAC}`)).estado, 200);
  assert.equal((await p('GET', `/api/bitacora?consultor_id=${ids.ERB}`)).estado, 403);
  assert.equal((await p('GET', '/api/bitacora')).estado, 403, 'sin filtro vería a todos');
  assert.equal((await p('GET', '/api/parametros')).estado, 200);
  for (const ruta of ['/api/estado', '/api/linea-base', '/api/adendas', '/api/usuarios', '/api/ia/uso', '/api/historial/adenda/1', '/api/exportar/actividades.csv']) {
    assert.equal((await p('GET', ruta)).estado, 403, `GET ${ruta}`);
  }
  assert.equal((await p('POST', '/api/simular', { cambios: [] })).estado, 403);
  assert.equal((await p('POST', '/api/recalcular', {})).estado, 403);
  assert.equal((await p('POST', '/api/usuarios', { correo: 'a@b.co', nombre: 'x', rol: 'ADMIN' })).estado, 403);
  assert.equal((await p('PUT', '/api/parametros/SPI_MINIMO', { valor: '0.9' })).estado, 403);
  assert.equal((await p('PATCH', `/api/consultores/${ids.CAC}`, { observacion: 'x' })).estado, 403);
  assert.equal((await p('PATCH', '/api/adendas/1', { estado: 'ANULADA' })).estado, 403);
  const det = (await p('GET', `/api/consultores/${ids.CAC}`)).cuerpo;
  assert.ok(!('dni' in det.consultor) && !('telefono' in det.consultor), 'sin datos personales');
  assert.equal((await p('GET', `/api/planes/${det.plan.plan_id}/pdf`)).estado, 404, 'su plan, sin PDF todavía');
  const ajeno = (await admin('GET', `/api/consultores/${ids.ERB}`)).cuerpo.plan.plan_id;
  assert.equal((await p('GET', `/api/planes/${ajeno}/pdf`)).estado, 403, 'el plan de otro');
  assert.equal((await p('PUT', `/api/planes/${det.plan.plan_id}/pdf`, {})).estado, 403, 'no adjunta PDF');
  assert.equal((await p('POST', `/api/planes/${det.plan.plan_id}/actividades`, { numero: '99', descripcion: 'x' })).estado, 403, 'no crea actividades');
});

test('Profesional: solo modifica el estado y el avance de sus propias actividades', async () => {
  const p = cliente();
  const x = globalThis.__claves.CAC;
  await p.entrar(x.correo, 'ClaveCAC2026x1');
  const det = (await p('GET', `/api/consultores/${ids.CAC}`)).cuerpo;
  const a = det.actividades.find((v) => !v.es_resumen && v.estado === 'PENDIENTE');
  const ok = await p('PATCH', `/api/actividades/${a.actividad_id}`, { avance: 40, estado: 'EN_CURSO', revision: a.revision });
  assert.equal(ok.estado, 200, JSON.stringify(ok.cuerpo));
  const luego = (await p('GET', `/api/consultores/${ids.CAC}`)).cuerpo.actividades.find((v) => v.actividad_id === a.actividad_id);
  assert.equal(Number(luego.avance), 40);
  assert.equal(luego.estado, 'EN_CURSO');
  // cualquier otro campo, aunque se envíe a mano, se rechaza
  for (const campo of [{ descripcion: 'otra' }, { fin_plan: '2026-12-30' }, { inicio_plan: '2026-11-20' }, { clasificacion: 'NUEVA' }, { observacion: 'x' }, { evidencia: 'x' }]) {
    const r = await p('PATCH', `/api/actividades/${a.actividad_id}`, { ...campo, revision: luego.revision });
    assert.equal(r.estado, 403, JSON.stringify(campo));
  }
  // actividad de otro profesional
  const otra = (await admin('GET', `/api/consultores/${ids.ERB}`)).cuerpo.actividades.find((v) => !v.es_resumen);
  assert.equal((await p('PATCH', `/api/actividades/${otra.actividad_id}`, { avance: 100, revision: otra.revision })).estado, 403);
  // queda en la bitácora con su usuario
  const bit = (await p('GET', `/api/bitacora?consultor_id=${ids.CAC}`)).cuerpo;
  assert.ok(bit.some((b) => b.usuario === x.correo && b.entidad === 'actividad'));
});

test('Jefe de Proyecto: todo menos crear usuarios y modificar perfiles; sin datos personales', async () => {
  const r = await admin('POST', '/api/usuarios', { correo: 'jefe.proyecto@ejemplo.net', nombre: 'Jefe de Proyecto', rol: 'JEFE_PROYECTO' });
  assert.equal(r.estado, 200);
  await integrar(r.cuerpo.usuario.usuario_id);
  const j = cliente();
  await j.entrar('jefe.proyecto@ejemplo.net', r.cuerpo.clave_temporal);
  assert.equal((await j('GET', '/api/estado')).estado, 200);
  assert.equal((await j('GET', '/api/linea-base')).estado, 200);
  assert.equal((await j('GET', '/api/ia/uso')).estado, 200);
  assert.equal((await j('PUT', '/api/parametros/SPI_MINIMO', { valor: '0.5' })).estado, 200);
  const det = (await j('GET', `/api/consultores/${ids.ERB}`)).cuerpo;
  assert.equal((await j('PATCH', `/api/adendas/${det.adendas[0].adenda_id}`, { observacion: 'Revisada por la jefatura', motivo: 'Revisión' })).estado, 200);
  const act = det.actividades.find((v) => !v.es_resumen);
  assert.equal((await j('PATCH', `/api/actividades/${act.actividad_id}`, { avance: 10, revision: act.revision })).estado, 200);
  assert.ok(!('dni' in det.consultor), 'los datos personales siguen siendo solo del Administrador');
  // no crea usuarios ni cambia perfiles
  assert.equal((await j('GET', '/api/usuarios')).estado, 403);
  assert.equal((await j('POST', '/api/usuarios', { correo: 'n@ejemplo.org', nombre: 'N', rol: 'JEFE_PROYECTO' })).estado, 403);
  assert.equal((await j('POST', '/api/usuarios/profesionales', { cuentas: [] })).estado, 403);
  assert.equal((await j('PATCH', `/api/usuarios/${r.cuerpo.usuario.usuario_id}`, { rol: 'ADMIN' })).estado, 403);
});

test('restablecer la clave: genera una temporal, invalida la anterior y obliga a cambiarla; la sesión abierta también', async () => {
  const x = globalThis.__claves.JCM;
  const p = cliente();
  await p.entrar(x.correo, x.clave_temporal, 'ClaveDeJunior2026x');
  assert.equal((await p('GET', `/api/consultores/${ids.JCM}`)).estado, 200);

  const r = await admin('PATCH', `/api/usuarios/${x.usuario_id}`, { restablecer: true });
  assert.equal(r.estado, 200);
  assert.ok(r.cuerpo.clave_temporal && r.cuerpo.clave_temporal !== x.clave_temporal);
  assert.equal(r.cuerpo.usuario.clave_hash, undefined, 'nunca se devuelve el hash');
  // la sesión que estaba abierta queda obligada a cambiar la clave
  const abierta = await p('GET', `/api/consultores/${ids.JCM}`);
  assert.equal(abierta.estado, 403);
  assert.equal(abierta.cuerpo.cambiarClave, true);
  // la clave anterior ya no sirve; la temporal nueva sí, y pide cambio
  assert.equal((await cliente()('POST', '/api/auth/ingresar', { correo: x.correo, clave: 'ClaveDeJunior2026x' })).estado, 401);
  const nuevo = cliente();
  const ing = await nuevo('POST', '/api/auth/ingresar', { correo: x.correo, clave: r.cuerpo.clave_temporal });
  assert.equal(ing.cuerpo.usuario.cambiarClave, true);
});

test('desactivar una cuenta: cierra su sesión de inmediato y no se puede volver a ingresar; se puede reactivar', async () => {
  const x = globalThis.__claves.KAP;
  const p = cliente();
  await p.entrar(x.correo, x.clave_temporal, 'ClaveDeKenyiyo2026x');
  assert.equal((await p('GET', `/api/consultores/${ids.KAP}`)).estado, 200);

  assert.equal((await admin('PATCH', `/api/usuarios/${x.usuario_id}`, { activo: 0 })).estado, 200);
  assert.equal((await p('GET', `/api/consultores/${ids.KAP}`)).estado, 401, 'la sesión abierta deja de valer');
  assert.equal((await cliente()('POST', '/api/auth/ingresar', { correo: x.correo, clave: 'ClaveDeKenyiyo2026x' })).estado, 401);

  assert.equal((await admin('PATCH', `/api/usuarios/${x.usuario_id}`, { activo: 1 })).estado, 200);
  assert.equal((await cliente()('POST', '/api/auth/ingresar', { correo: x.correo, clave: 'ClaveDeKenyiyo2026x' })).estado, 200);
  // nada se borra: la cuenta sigue en la lista
  assert.ok((await admin('GET', '/api/usuarios')).cuerpo.some((u) => u.usuario_id === x.usuario_id));
});

test('el administrador principal no se degrada ni se desactiva; los perfiles y vínculos se validan', async () => {
  const lista = (await admin('GET', '/api/usuarios')).cuerpo;
  const principal = lista.find((u) => u.correo === 'admin.principal@serfor.gob.pe');
  assert.equal(principal.rol, 'ADMIN');
  assert.equal((await admin('PATCH', `/api/usuarios/${principal.usuario_id}`, { rol: 'JEFE_PROYECTO' })).estado, 400);
  assert.equal((await admin('PATCH', `/api/usuarios/${principal.usuario_id}`, { activo: 0 })).estado, 400);
  // otro administrador sí puede crearse, pero tampoco puede tocar al principal
  const otro = await admin('POST', '/api/usuarios', { correo: 'segundo.admin@ejemplo.com', nombre: 'Segundo', rol: 'ADMIN' });
  const a2 = cliente();
  await a2.entrar('segundo.admin@ejemplo.com', otro.cuerpo.clave_temporal);
  assert.equal((await a2('PATCH', `/api/usuarios/${principal.usuario_id}`, { activo: 0 })).estado, 400);
  // un Jefe de Proyecto pasa a Profesional solo con su profesional vinculado
  const j = (await admin('POST', '/api/usuarios', { correo: 'cambio.perfil@ejemplo.com', nombre: 'Cambio', rol: 'JEFE_PROYECTO' })).cuerpo.usuario;
  assert.equal((await admin('PATCH', `/api/usuarios/${j.usuario_id}`, { rol: 'PROFESIONAL' })).estado, 400);
  assert.equal((await admin('PATCH', `/api/usuarios/${j.usuario_id}`, { rol: 'PROFESIONAL', consultor_id: ids.APA })).estado, 409, 'APA ya tiene cuenta');
  const x = globalThis.__claves.APA;
  await admin('PATCH', `/api/usuarios/${x.usuario_id}`, { activo: 0 });
  assert.equal((await admin('PATCH', `/api/usuarios/${x.usuario_id}`, { activo: 1 })).estado, 200);
  // Administrador → Profesional: el vínculo se limpia al volver a otro perfil
  assert.equal((await admin('PATCH', `/api/usuarios/${j.usuario_id}`, { rol: 'ADMIN' })).estado, 200);
});

test('las acciones sobre cuentas quedan en la bitácora y nunca con claves', async () => {
  const bit = (await admin('GET', '/api/bitacora?entidad=usuario&limite=200')).cuerpo;
  assert.ok(bit.some((b) => b.accion === 'CREAR'));
  assert.ok(bit.some((b) => /restablecida/.test(b.cambios_json || '')));
  const todo = JSON.stringify(bit);
  const claves = Object.values(globalThis.__claves).map((x) => x.clave_temporal);
  assert.ok(!claves.some((k) => todo.includes(k)), 'ninguna clave temporal en la bitácora');
  assert.ok(!/\$2[aby]\$/.test(todo), 'ningún hash de clave en la bitácora');
});

test('carga de documentos: solo Jefe de Proyecto y Administrador; vista previa, aplicación y bitácora por HTTP', async () => {
  const subir = (c, cuerpo, nombre = 'avance.csv', extra = {}) => fetch(`${base}/api/documentos/previsualizar`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-SGF': '1', 'X-Nombre': encodeURIComponent(nombre), Cookie: c.cookie(), ...extra }, body: cuerpo });

  // el Profesional no entra a ninguna ruta de documentos
  const x = globalThis.__claves.APA;
  const p = cliente(); await p.entrar(x.correo, x.clave_temporal);
  assert.equal((await subir(p, Buffer.from('clave;numero;avance;;APA;1;10;;'.replace(/;;/g, String.fromCharCode(10))))).status, 403);
  assert.equal((await p('POST', '/api/documentos/aplicar', { carga_id: 'x', ids: ['c1'] })).estado, 403);
  assert.equal((await fetch(`${base}/api/documentos/plantilla.xlsx`, { headers: { Cookie: p.cookie() } })).status, 403);
  assert.equal((await fetch(`${base}/api/documentos/plantilla.xlsx`)).status, 401);

  const j = (await admin('POST', '/api/usuarios', { correo: 'jefe.docs@ejemplo.com', nombre: 'Jefe Docs', rol: 'JEFE_PROYECTO' })).cuerpo;
  await integrar(j.usuario.usuario_id);
  const jefe = cliente(); await jefe.entrar('jefe.docs@ejemplo.com', j.clave_temporal);
  const plantilla = await fetch(`${base}/api/documentos/plantilla.xlsx`, { headers: { Cookie: jefe.cookie() } });
  assert.equal(plantilla.status, 200);
  assert.match(plantilla.headers.get('content-type'), /spreadsheetml/);
  assert.equal(Buffer.from(await plantilla.arrayBuffer()).subarray(0, 2).toString(), 'PK');

  const det = (await jefe('GET', `/api/consultores/${ids.ERB}`)).cuerpo;
  const act = det.actividades.find((a) => !a.es_resumen);
  const csv = Buffer.from(['clave;numero;avance;estado', `ERB;${act.numero};45;En curso`, ''].join(String.fromCharCode(10)));
  assert.equal((await subir(jefe, Buffer.from('x'), 'virus.exe')).status, 400);
  assert.equal((await subir(jefe, Buffer.alloc(0), 'vacio.csv')).status, 400);
  assert.equal((await subir(jefe, csv, '')).status, 400, 'sin nombre de archivo');
  const prev = await (await subir(jefe, csv)).json();
  assert.equal(prev.resumen.modificar, 1);
  assert.deepEqual(prev.cambios[0].diffs.map((d) => [d.campo, d.antes, d.despues]).filter((d) => d[0] === 'avance'), [['avance', Number(act.avance), 45]]);
  // la vista previa no cambió nada
  assert.equal(Number((await jefe('GET', `/api/consultores/${ids.ERB}`)).cuerpo.actividades.find((a) => a.actividad_id === act.actividad_id).avance), Number(act.avance));

  assert.equal((await jefe('POST', '/api/documentos/aplicar', { carga_id: prev.carga_id, ids: [] })).estado, 400);
  const ap = await jefe('POST', '/api/documentos/aplicar', { carga_id: prev.carga_id, ids: prev.cambios.map((c) => c.id) });
  assert.equal(ap.estado, 200, JSON.stringify(ap.cuerpo));
  assert.equal(ap.cuerpo.aplicados.length, 1);
  const luego = (await jefe('GET', `/api/consultores/${ids.ERB}`)).cuerpo.actividades.find((a) => a.actividad_id === act.actividad_id);
  assert.equal(Number(luego.avance), 45);
  const bit = (await jefe('GET', `/api/bitacora?consultor_id=${ids.ERB}`)).cuerpo;
  assert.ok(bit.some((b) => b.motivo === 'Carga del documento «avance.csv»' && b.usuario === 'jefe.docs@ejemplo.com'));
  assert.ok((await jefe('GET', '/api/bitacora?entidad=documento')).cuerpo.some((b) => /"aplicados":1/.test(b.cambios_json)));
  assert.equal((await jefe('POST', '/api/documentos/aplicar', { carga_id: prev.carga_id, ids: ['c1'] })).estado, 404, 'no se aplica dos veces');
});

test('documento de adenda por HTTP: el Jefe de Proyecto revisa, ajusta el estado y guarda; queda en la bitácora', async () => {
  const subir = (c, cuerpo, nombre, extra = {}) => fetch(`${base}/api/documentos/previsualizar`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-SGF': '1', 'X-Nombre': encodeURIComponent(nombre), Cookie: c.cookie(), ...extra }, body: cuerpo });
  const j = (await admin('POST', '/api/usuarios', { correo: 'jefe.adendas@ejemplo.com', nombre: 'Jefe Adendas', rol: 'JEFE_PROYECTO' })).cuerpo;
  await integrar(j.usuario.usuario_id);
  const jefe = cliente(); await jefe.entrar('jefe.adendas@ejemplo.com', j.clave_temporal);

  const de035 = async () => (await jefe('GET', '/api/adendas')).cuerpo.filter((a) => a.contrato.startsWith('035'));
  const antes = (await de035()).length;
  const sig = Math.max(...(await de035()).map((a) => a.numero)) + 1;
  const csv = Buffer.from(['contrato;numero;plazo_dias;documento', `035;${sig};20;Adenda N.° ${sig} al Contrato 035`, ''].join(String.fromCharCode(10)));
  const prev = await (await subir(jefe, csv, 'adenda-nueva.csv', { 'X-Tipo': 'adenda' })).json();
  assert.equal(prev.tipo, 'adenda');
  assert.equal(prev.resumen.crear, 1);
  assert.equal(prev.cambios[0].campos.estado, 'EN_TRAMITE');
  assert.equal((await de035()).length, antes, 'la vista previa no guarda nada');

  const id = prev.cambios[0].id;
  assert.equal((await jefe('POST', '/api/documentos/aplicar', { carga_id: prev.carga_id, ids: [id], ajustes: { [id]: { estado: 'INVENTADA' } } })).estado, 400);
  const ap = await jefe('POST', '/api/documentos/aplicar', { carga_id: prev.carga_id, ids: [id], ajustes: { [id]: { estado: 'ANUNCIADA' } } });
  assert.equal(ap.estado, 200, JSON.stringify(ap.cuerpo));
  assert.equal(ap.cuerpo.aplicados.length, 1);
  const nueva = (await de035()).find((a) => a.numero === sig);
  assert.equal(nueva.estado, 'ANUNCIADA');
  assert.equal(nueva.plazo_dias, 20);
  const bit = (await jefe('GET', '/api/bitacora?entidad=documento')).cuerpo;
  assert.ok(bit.some((b) => /"tipo":"adenda"/.test(b.cambios_json)));
});

test('Actualizar desde archivo: aplica lo que concuerda, informa lo demás y deja el documento en el visor', async () => {
  const subir = (c, cuerpo, nombre) => fetch(`${base}/api/actualizar-archivo`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-SGF': '1', 'X-Nombre': encodeURIComponent(nombre), Cookie: c.cookie() }, body: cuerpo }).then(async (r) => ({ status: r.status, cuerpo: await r.json() }));
  assert.equal((await fetch(`${base}/api/actualizar-archivo`)).status, 401);
  const j = (await admin('POST', '/api/usuarios', { correo: 'jefe.act@ejemplo.com', nombre: 'Jefe Act', rol: 'JEFE_PROYECTO' })).cuerpo;
  await integrar(j.usuario.usuario_id);
  const jefe = cliente(); await jefe.entrar('jefe.act@ejemplo.com', j.clave_temporal);
  const det = (await jefe('GET', `/api/consultores/${ids.ERB}`)).cuerpo;
  const act = det.actividades.find((a) => !a.es_resumen);
  const nl = String.fromCharCode(10);
  const bueno = Buffer.from(['clave;numero;avance;estado', `ERB;${act.numero};55;En curso`, ''].join(nl));
  const r1 = await subir(jefe, bueno, 'avance-ok.csv');
  assert.equal(r1.status, 200);
  assert.equal(r1.cuerpo.aplicados.length, 1);
  assert.equal(r1.cuerpo.inconsistencias.length, 0, 'todo bien: la carga es exitosa');
  assert.equal(Number((await jefe('GET', `/api/consultores/${ids.ERB}`)).cuerpo.actividades.find((a) => a.actividad_id === act.actividad_id).avance), 55);
  const malo = Buffer.from(['clave;numero;avance;estado', 'ZZZ;1;10;En curso', ''].join(nl));
  const r2 = await subir(jefe, malo, 'avance-malo.csv');
  assert.equal(r2.status, 200);
  assert.ok(r2.cuerpo.inconsistencias.length >= 1, 'lo que no se identifica se informa');
  assert.equal((await subir(jefe, Buffer.from('x'), 'virus.exe')).cuerpo.inconsistencias.length, 1, 'formato no admitido: se informa y no se guarda');
  const lista = (await jefe('GET', '/api/actualizar-archivo')).cuerpo;
  assert.deepEqual(lista.map((d) => d.archivo).slice(0, 2), ['avance-malo.csv', 'avance-ok.csv']);
  assert.ok(!('ruta' in lista[0]) && !('sha256' in lista[0]));
  const arch = await fetch(`${base}/api/actualizar-archivo/${lista[1].id}/archivo`, { headers: { Cookie: jefe.cookie() } });
  assert.equal(arch.status, 200);
  assert.match(await arch.text(), /ERB;/);
  const cont = (await jefe('GET', `/api/actualizar-archivo/${lista[1].id}/contenido`)).cuerpo;
  assert.equal(cont.tipo, 'tablas');
  assert.equal((await jefe('GET', '/api/actualizar-archivo/999/contenido')).estado, 404);
});

test('Proyectos: alta, validaciones, profesional dentro del proyecto y filtro por proyecto', async () => {
  const j = (await admin('POST', '/api/usuarios', { correo: 'jefe.proy@ejemplo.com', nombre: 'Jefe Proy', rol: 'JEFE_PROYECTO' })).cuerpo;
  await integrar(j.usuario.usuario_id);
  const jefe = cliente(); await jefe.entrar('jefe.proy@ejemplo.com', j.clave_temporal);
  const lista0 = (await jefe('GET', '/api/proyectos')).cuerpo;
  assert.equal(lista0.length, 1, 'el proyecto inicial ya existe');
  assert.equal(lista0[0].profesionales, 11, 'los profesionales existentes pasaron al proyecto inicial');
  const inicial = lista0[0].proyecto_id;

  assert.equal((await admin('POST', '/api/proyectos', { nombre: 'x' })).estado, 400, 'nombre corto');
  assert.equal((await admin('POST', '/api/proyectos', {})).estado, 400, 'sin nombre');
  assert.equal((await admin('POST', '/api/proyectos', { nombre: 'Sistema integrado de apoyo', fecha_inicio: '2026-06-01', fecha_fin: '2026-01-01' })).estado, 400, 'fechas invertidas');
  // el código lo genera el sistema: lo que envíe el cliente se ignora
  const nuevo = await admin('POST', '/api/proyectos', { codigo: 'MIO', nombre: 'Sistema integrado de apoyo a la fiscalización', financiador: 'BID', fecha_inicio: '2026-06-01', fecha_fin: '2027-06-01', modalidad: 'CONTRATO_ADENDAS', motivo_atipico: 'Proyecto de prueba con contrato y adendas' });
  assert.equal(nuevo.estado, 200, JSON.stringify(nuevo.cuerpo));
  const anio = new Date().toISOString().slice(0, 4);
  assert.match(nuevo.cuerpo.codigo, new RegExp(`^PRY-${anio}-001$`), 'código autogenerado y correlativo');
  const otro = await admin('POST', '/api/proyectos', { nombre: 'Segundo proyecto de prueba' });
  assert.match(otro.cuerpo.codigo, new RegExp(`^PRY-${anio}-002$`));
  const pid = nuevo.cuerpo.proyecto_id;
  // sin estar en el equipo del proyecto nuevo, el Jefe de Proyecto lo ve pero no escribe en él
  const altaAntes = { clave: 'NEQ', nombres: 'Persona Fuera de Equipo', contrato_numero: '899-2026-TEST', adenda_inicio: '2026-11-01', adenda_plazo_dias: 30 };
  assert.ok((await jefe('GET', '/api/proyectos')).cuerpo.some((p) => p.proyecto_id === pid && p.escribe === false), 'lo ve, marcado como solo lectura');
  assert.equal((await jefe('POST', `/api/proyectos/${pid}/profesionales`, altaAntes)).estado, 403);
  assert.ok(!(await admin('GET', `/api/estado?proyecto_id=${pid}`)).cuerpo.consultores.length, 'el 403 no dejó nada escrito');
  await integrar(j.usuario.usuario_id, pid, true);
  assert.ok((await jefe('GET', '/api/proyectos')).cuerpo.some((p) => p.proyecto_id === pid && p.escribe === true && p.responsable === 'Jefe Proy'));
  // el código no se puede modificar
  const edit = await admin('PATCH', `/api/proyectos/${pid}`, { codigo: 'OTRO-1', financiador: 'KfW', revision: nuevo.cuerpo.revision });
  assert.equal(edit.estado, 200);
  assert.equal(edit.cuerpo.fila.codigo, nuevo.cuerpo.codigo, 'el código no cambió');
  assert.equal(edit.cuerpo.fila.financiador, 'KfW');
  nuevo.cuerpo.revision = edit.cuerpo.fila.revision;

  // profesional dentro del proyecto nuevo
  const alta = { clave: 'jqz', nombres: 'Juan Quispe Zamora', perfil: 'Analista de datos', contrato_numero: '900-2026-TEST', expediente: 'EXP-900', adenda_inicio: '2026-11-01', adenda_plazo_dias: 60 };
  assert.equal((await jefe('POST', `/api/proyectos/${pid}/profesionales`, { ...alta, clave: 'J1' })).estado, 400, 'clave inválida');
  assert.equal((await jefe('POST', `/api/proyectos/${pid}/profesionales`, { ...alta, contrato_numero: '033-2026-MIDAGRI-SERFOR-PKFW' })).estado, 409, 'contrato repetido');
  assert.equal((await jefe('POST', '/api/proyectos/9999/profesionales', alta)).estado, 400, 'proyecto inexistente');
  const ok = await jefe('POST', `/api/proyectos/${pid}/profesionales`, alta);
  assert.equal(ok.estado, 200, JSON.stringify(ok.cuerpo));
  assert.equal(ok.cuerpo.consultor.clave, 'JQZ');
  assert.equal(ok.cuerpo.adenda.fecha_fin, '2026-12-30', 'el fin de la adenda se calcula con el plazo');
  assert.equal((await jefe('POST', `/api/proyectos/${pid}/profesionales`, { ...alta, contrato_numero: '901-2026-TEST' })).estado, 409, 'clave repetida');

  // el filtro por proyecto separa los datos
  const todos = (await jefe('GET', '/api/estado')).cuerpo;
  const delNuevo = (await jefe('GET', `/api/estado?proyecto_id=${pid}`)).cuerpo;
  const delInicial = (await jefe('GET', `/api/estado?proyecto_id=${inicial}`)).cuerpo;
  assert.equal(todos.consultores.length, 12);
  assert.deepEqual(delNuevo.consultores.map((c) => c.clave), ['JQZ']);
  assert.equal(delInicial.consultores.length, 11);
  assert.equal(delNuevo.consultores[0].vigencia.fin_vigencia, '2026-12-30');
  assert.deepEqual((await jefe('GET', `/api/adendas?proyecto_id=${pid}`)).cuerpo.map((a) => a.clave), ['JQZ']);
  assert.equal((await jefe('GET', `/api/linea-base?proyecto_id=${pid}`)).cuerpo.length, 0);

  // no se cierra con profesionales activos; sí cuando ya no hay
  assert.equal((await admin('PATCH', `/api/proyectos/${pid}`, { estado: 'CERRADO', revision: nuevo.cuerpo.revision })).estado, 409, 'el cierre no se hace editando el proyecto');
  const informe = async () => (await (await fetch(`${base}/api/documentos/temporales`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-SGF': '1', Cookie: admin.cookie() }, body: Buffer.from('%PDF-1.4\n%%EOF\n') })).json()).token;
  const lecciones = 'La coordinación semanal con el área usuaria evitó retrasos en las pruebas.';
  let req = (await admin('GET', `/api/proyectos/${pid}/cierre`)).cuerpo;
  assert.equal(req.puede_cerrar, false, 'con profesionales activos no se cierra');
  assert.equal((await admin('POST', `/api/proyectos/${pid}/cierre`, { informe: await informe(), lecciones_aprendidas: lecciones, revision: nuevo.cuerpo.revision })).estado, 409);
  await jefe('PATCH', `/api/consultores/${ok.cuerpo.consultor.consultor_id}`, { estado: 'CULMINADO', revision: ok.cuerpo.consultor.revision });
  req = (await admin('GET', `/api/proyectos/${pid}/cierre`)).cuerpo;
  assert.equal(req.puede_cerrar, true, JSON.stringify(req.requisitos));
  assert.equal((await admin('POST', `/api/proyectos/${pid}/cierre`, { informe: await informe(), lecciones_aprendidas: 'corto', revision: req.proyecto.revision })).estado, 400, 'exige las lecciones aprendidas');
  assert.equal((await admin('POST', `/api/proyectos/${pid}/cierre`, { lecciones_aprendidas: lecciones, revision: req.proyecto.revision })).estado, 400, 'exige el informe de cierre');
  const cerrado = await admin('POST', `/api/proyectos/${pid}/cierre`, { informe: await informe(), lecciones_aprendidas: lecciones, revision: req.proyecto.revision });
  assert.equal(cerrado.estado, 200, JSON.stringify(cerrado.cuerpo));
  assert.equal(cerrado.cuerpo.fila.estado, 'CERRADO');
  assert.ok((await admin('GET', `/api/proyectos/${pid}/cierre`)).cuerpo.informe, 'el informe queda en el almacén');
  assert.equal((await jefe('POST', `/api/proyectos/${pid}/profesionales`, { ...alta, clave: 'ABC', contrato_numero: '902-2026-TEST' })).estado, 409, 'proyecto cerrado');
  assert.ok((await jefe('GET', '/api/bitacora?entidad=proyecto')).cuerpo.some((b) => b.accion === 'CREAR'), 'el alta del proyecto queda en la bitácora');
});

test('Proyectos: la gestión del proyecto es una de las áreas permitidas', async () => {
  const j = (await admin('POST', '/api/usuarios', { correo: 'jefe.area@ejemplo.com', nombre: 'Jefe Area', rol: 'JEFE_PROYECTO' })).cuerpo;
  const jefe = cliente(); await jefe.entrar('jefe.area@ejemplo.com', j.clave_temporal);
  const areas = (await jefe('GET', '/api/proyectos/areas')).cuerpo;
  assert.deepEqual(areas, ['Equipo de Desarrollo', 'Equipo de Infraestructura', 'Seguridad de la Información', 'Equipo de Base de Datos']);
  assert.equal((await jefe('POST', '/api/proyectos', { nombre: 'Proyecto del Jefe de Proyecto' })).estado, 403, 'solo la Dirección OTI (Administrador) crea proyectos');
  assert.equal((await jefe('PATCH', '/api/proyectos/1', { financiador: 'X' })).estado, 403, 'ni los modifica');
  assert.equal((await admin('POST', '/api/proyectos', { nombre: 'Proyecto con área libre', area_tecnica: 'Cualquier cosa' })).estado, 400);
  const ok = await admin('POST', '/api/proyectos', { nombre: 'Proyecto con área válida', area_tecnica: 'Equipo de Infraestructura' });
  assert.equal(ok.estado, 200);
  assert.equal(ok.cuerpo.area_tecnica, 'Equipo de Infraestructura');
  assert.equal((await admin('PATCH', `/api/proyectos/${ok.cuerpo.proyecto_id}`, { area_tecnica: 'Otra', revision: ok.cuerpo.revision })).estado, 400);
});

test('Proyectos: el jefe de proyecto es uno de los designables', async () => {
  const jefes = (await admin('GET', '/api/proyectos/jefes')).cuerpo;
  assert.deepEqual(jefes, ['Alex Tantachuco', 'Iván Rengifo', 'Martín Chocce', 'José Carlos Gallardo']);
  assert.equal((await admin('POST', '/api/proyectos', { nombre: 'Proyecto con jefe libre', jefe_proyecto: 'Otra Persona' })).estado, 400);
  const ok = await admin('POST', '/api/proyectos', { nombre: 'Proyecto con jefe válido', jefe_proyecto: 'Martín Chocce', area_tecnica: 'Equipo de Desarrollo' });
  assert.equal(ok.estado, 200, JSON.stringify(ok.cuerpo));
  assert.equal(ok.cuerpo.jefe_proyecto, 'Martín Chocce');
});

test('Proyectos sin adendas ni línea base: Orden de Servicio, documentos y control de su vencimiento', async () => {
  const j = (await admin('POST', '/api/usuarios', { correo: 'jefe.os@ejemplo.com', nombre: 'Jefe OS', rol: 'JEFE_PROYECTO' })).cuerpo;
  await integrar(j.usuario.usuario_id);
  const jefe = cliente(); await jefe.entrar('jefe.os@ejemplo.com', j.clave_temporal);
  // un proyecto sin profesionales no admite nada de lo demás
  const sinProf = await admin('POST', '/api/proyectos', { nombre: 'Proyecto de gestión sin personal', con_profesionales: 0, con_adendas: 1, con_orden_servicio: 1 });
  assert.equal(sinProf.estado, 200, JSON.stringify(sinProf.cuerpo));
  assert.deepEqual([sinProf.cuerpo.con_profesionales, sinProf.cuerpo.con_adendas, sinProf.cuerpo.con_orden_servicio, sinProf.cuerpo.con_tdr], [0, 0, 0, 0]);
  assert.equal((await jefe('POST', `/api/proyectos/${sinProf.cuerpo.proyecto_id}/profesionales`, { clave: 'SIN', nombres: 'Persona Sin Proyecto', contrato_numero: 'OS-000' })).estado, 409);

  // con personal por Orden de Servicio: el registro es otro (test/contrataciones.test.js); el antiguo, con fechas a mano, ya no aplica
  const p = await admin('POST', '/api/proyectos', { nombre: 'Proyecto con personal por Orden de Servicio', con_profesionales: 1, con_adendas: 0, con_linea_base: 0, con_orden_servicio: 1, con_tdr: 1 });
  assert.equal(p.estado, 200);
  assert.equal(p.cuerpo.modalidad, 'ORDEN_SERVICIO');
  assert.deepEqual([p.cuerpo.con_adendas, p.cuerpo.con_linea_base, p.cuerpo.con_orden_servicio, p.cuerpo.con_tdr], [0, 0, 1, 1]);
  const pid = p.cuerpo.proyecto_id;
  await integrar(j.usuario.usuario_id, pid);
  assert.equal((await jefe('POST', `/api/proyectos/${pid}/profesionales`, { clave: 'OSA', nombres: 'Olga Sánchez Arce', contrato_numero: 'OS-0123-2026', adenda_inicio: '2026-10-01', adenda_plazo_dias: 30 })).estado, 409);
  // en un proyecto con adendas (GF2026) la renovación se hace con adendas
  const inicial = (await jefe('GET', '/api/proyectos')).cuerpo.find((x) => x.codigo === 'GF2026');
  const cInicial = (await jefe('GET', `/api/estado?proyecto_id=${inicial.proyecto_id}`)).cuerpo.consultores[0];
  assert.equal((await jefe('POST', `/api/proyectos/${inicial.proyecto_id}/profesionales/${cInicial.consultor_id}/renovar`, { plazo_dias: 10 })).estado, 409);
  // con profesionales registrados no cambia la modalidad
  assert.equal((await admin('PATCH', `/api/proyectos/${inicial.proyecto_id}`, { modalidad: 'ORDEN_SERVICIO', revision: inicial.revision })).estado, 409);
});
