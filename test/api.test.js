'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-'));
process.env.MODO_DATOS = 'memoria';
process.env.ARCHIVO_DEMO = path.join(tmp, 'demo.json');
process.env.ADMIN_CORREO = 'admin.prueba@serfor.gob.pe';
process.env.ADMIN_CLAVE_INICIAL = 'ClavePrueba2026';
process.env.FECHA_CORTE_PRUEBA = '1';
const { crearApp } = require('../server/server');

let base;
let servidor;
let cookie = '';
const llamar = async (metodo, ruta, cuerpo) => {
  const r = await fetch(base + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-SGF': '1', Cookie: cookie }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { estado: r.status, cuerpo: j };
};

test.before(async () => {
  const { app } = await crearApp();
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => servidor.close());

test('flujo completo: ingreso, cambio de clave, edición con recálculo, concurrencia y bitácora', async () => {
  assert.equal((await llamar('GET', '/api/estado')).estado, 401);
  assert.equal((await llamar('POST', '/api/auth/ingresar', { correo: 'admin.prueba@serfor.gob.pe', clave: 'mala' })).estado, 401);
  const ing = await llamar('POST', '/api/auth/ingresar', { correo: 'admin.prueba@serfor.gob.pe', clave: 'ClavePrueba2026' });
  assert.equal(ing.estado, 200);
  assert.equal(ing.cuerpo.usuario.cambiarClave, true);
  assert.equal((await llamar('GET', '/api/estado')).estado, 403); // debe cambiar la clave primero
  assert.equal((await llamar('POST', '/api/auth/cambiar-clave', { actual: 'ClavePrueba2026', nueva: 'NuevaClave2026x' })).estado, 200);

  // fijar la fecha de corte para que la prueba sea determinista
  assert.equal((await llamar('PUT', '/api/parametros/FECHA_CORTE', { valor: '2026-11-03' })).estado, 200);
  const est = await llamar('GET', '/api/estado');
  assert.equal(est.estado, 200);
  assert.equal(est.cuerpo.corte, '2026-11-03');
  const erb = est.cuerpo.consultores.find((c) => c.clave === 'ERB');
  assert.equal(erb.vigencia.semaforo, 'ROJO');

  const det = await llamar('GET', `/api/consultores/${erb.consultor_id}`);
  const a1 = det.cuerpo.actividades.find((a) => a.numero === '1');
  const a2 = det.cuerpo.actividades.find((a) => a.numero === '2');
  const finAntes = det.cuerpo.pronostico.fin_probable;

  // Registrar avance real: la 1 concluida en fecha y la 2 al 90 %
  let r = await llamar('PATCH', `/api/actividades/${a1.actividad_id}`, { estado: 'CONCLUIDA', fin_real: '2026-10-16', revision: a1.revision });
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
  r = await llamar('PATCH', `/api/actividades/${a2.actividad_id}`, { avance: 90, revision: a2.revision });
  assert.equal(r.estado, 200);
  assert.equal(r.cuerpo.fila.estado, 'EN_CURSO');

  // Conflicto de concurrencia con revisión antigua
  r = await llamar('PATCH', `/api/actividades/${a2.actividad_id}`, { avance: 95, revision: a2.revision });
  assert.equal(r.estado, 409);

  // Reprogramar sin motivo -> 400; con motivo -> 200
  const a3 = det.cuerpo.actividades.find((a) => a.numero === '3');
  r = await llamar('PATCH', `/api/actividades/${a3.actividad_id}`, { fin_plan: '2026-11-12', revision: a3.revision });
  assert.equal(r.estado, 400);
  assert.equal(r.cuerpo.requiereMotivo, true);
  r = await llamar('PATCH', `/api/actividades/${a3.actividad_id}`, { fin_plan: '2026-11-12', revision: a3.revision, motivo: 'Ajuste acordado con el consultor' });
  assert.equal(r.estado, 200);

  const det2 = await llamar('GET', `/api/consultores/${erb.consultor_id}`);
  assert.notEqual(det2.cuerpo.pronostico.fin_probable, finAntes, 'el pronóstico debe recalcularse');

  // Simulación no guarda
  const sim = await llamar('POST', '/api/simular', { cambios: [{ actividad_id: a3.actividad_id, avance: 100 }] });
  assert.equal(sim.estado, 200);
  const det3 = await llamar('GET', `/api/consultores/${erb.consultor_id}`);
  assert.equal(det3.cuerpo.actividades.find((a) => a.numero === '3').avance, 0);

  // Registrar la Adenda N.° 04 como firmada amplía la vigencia
  const ad4 = det3.cuerpo.adendas.find((a) => a.numero === 4);
  r = await llamar('PATCH', `/api/adendas/${ad4.adenda_id}`, { estado: 'FIRMADA', revision: ad4.revision });
  assert.equal(r.estado, 400); // falta documento
  r = await llamar('PATCH', `/api/adendas/${ad4.adenda_id}`, { estado: 'FIRMADA', documento_ref: 'Adenda N.° 04 al Contrato N.° 039-2026', fecha_suscripcion: '2026-11-03', revision: ad4.revision });
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
  const est2 = await llamar('GET', '/api/estado');
  assert.equal(est2.cuerpo.consultores.find((c) => c.clave === 'ERB').vigencia.fin_vigencia, '2026-12-31');

  // Ciclo de dependencias rechazado
  r = await llamar('PUT', `/api/actividades/${a1.actividad_id}/predecesoras`, { predecesoras: [{ predecesora_id: a3.actividad_id, desfase_dias: 0 }] });
  assert.equal(r.estado, 400);

  // Bitácora e historial
  const bit = await llamar('GET', `/api/bitacora?consultor_id=${erb.consultor_id}`);
  assert.ok(bit.cuerpo.some((b) => b.accion === 'REPROGRAMAR' && b.motivo.includes('Ajuste')));
  const hist = await llamar('GET', `/api/historial/actividad/${a2.actividad_id}`);
  assert.equal(hist.cuerpo.length, 2);

  // CSV
  const csv = await fetch(`${base}/api/exportar/actividades.csv`, { headers: { Cookie: cookie } });
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /clave;consultor;numero/);

  // Usuario lector no puede editar
  const nu = await llamar('POST', '/api/usuarios', { correo: 'lector@serfor.gob.pe', nombre: 'Lector', rol: 'LECTOR' });
  assert.equal(nu.estado, 200);
  assert.ok(nu.cuerpo.clave_temporal);
});

test('bitácora: los datos personales solo los ve el ADMIN', async () => {
  // Continúa la sesión ADMIN de la prueba anterior
  const est = await llamar('GET', '/api/estado');
  const erb = est.cuerpo.consultores.find((c) => c.clave === 'ERB');
  const det = await llamar('GET', `/api/consultores/${erb.consultor_id}`);
  const r = await llamar('PATCH', `/api/consultores/${erb.consultor_id}`, { dni: '11223344', telefono: '988777666', revision: det.cuerpo.consultor.revision });
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));

  const admin = await llamar('GET', `/api/bitacora?consultor_id=${erb.consultor_id}`);
  assert.match(JSON.stringify(admin.cuerpo), /11223344/, 'el ADMIN ve el valor');

  const nu = await llamar('POST', '/api/usuarios', { correo: 'editor.bit@serfor.gob.pe', nombre: 'Editor Bitácora', rol: 'EDITOR' });
  assert.equal(nu.estado, 200);
  await llamar('POST', '/api/auth/salir');
  cookie = '';
  assert.equal((await llamar('POST', '/api/auth/ingresar', { correo: 'editor.bit@serfor.gob.pe', clave: nu.cuerpo.clave_temporal })).estado, 200);
  assert.equal((await llamar('POST', '/api/auth/cambiar-clave', { actual: nu.cuerpo.clave_temporal, nueva: 'ClaveEditor2026x' })).estado, 200);

  const editor = await llamar('GET', `/api/bitacora?consultor_id=${erb.consultor_id}`);
  assert.equal(editor.estado, 200);
  assert.ok(editor.cuerpo.length > 0);
  assert.ok(!/11223344|988777666/.test(JSON.stringify(editor.cuerpo)), 'el EDITOR no ve datos personales');
});
