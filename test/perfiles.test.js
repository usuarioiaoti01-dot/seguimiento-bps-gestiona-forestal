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
process.env.PLANES_PDF_DIR = path.join(tmp, 'planes-pdf');
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
