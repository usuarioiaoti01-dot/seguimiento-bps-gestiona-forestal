'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-'));
process.env.MODO_DATOS = 'memoria';
process.env.ARCHIVO_DEMO = path.join(tmp, 'demo.json');
process.env.PLANES_PDF_DIR = path.join(tmp, 'planes-pdf');
process.env.ADENDAS_PDF_DIR = path.join(tmp, 'adendas-pdf');
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

  // El Administrador crea cuentas (cualquier dominio de correo)
  const nu = await llamar('POST', '/api/usuarios', { correo: 'jefe@ejemplo.com', nombre: 'Jefe de Proyecto', rol: 'JEFE_PROYECTO' });
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

  const nu = await llamar('POST', '/api/usuarios', { correo: 'editor.bit@serfor.gob.pe', nombre: 'Editor Bitácora', rol: 'JEFE_PROYECTO' });
  assert.equal(nu.estado, 200);
  await llamar('POST', '/api/auth/salir');
  cookie = '';
  assert.equal((await llamar('POST', '/api/auth/ingresar', { correo: 'editor.bit@serfor.gob.pe', clave: nu.cuerpo.clave_temporal })).estado, 200);
  assert.equal((await llamar('POST', '/api/auth/cambiar-clave', { actual: nu.cuerpo.clave_temporal, nueva: 'ClaveEditor2026x' })).estado, 200);

  const editor = await llamar('GET', `/api/bitacora?consultor_id=${erb.consultor_id}`);
  assert.equal(editor.estado, 200);
  assert.ok(editor.cuerpo.length > 0);
  assert.ok(!/11223344|988777666/.test(JSON.stringify(editor.cuerpo)), 'el Jefe de Proyecto no ve datos personales');
});

test('historial de adendas: /api/estado lo expone y la edición valida los plazos', async () => {
  // Continúa la sesión EDITOR de la prueba anterior
  const est = await llamar('GET', '/api/estado');
  const asl = est.cuerpo.consultores.find((c) => c.clave === 'ASL');
  assert.deepEqual(asl.historial_adendas.map((h) => [h.numero, h.fecha_inicio, h.fecha_fin, h.plazo_dias, h.plazo_solicitado_dias]),
    [[1, '2026-05-13', '2026-08-10', 90, null], [2, '2026-08-11', '2026-11-08', 90, 180]]);
  assert.equal(asl.cobertura.dias_sin_cobertura, 0);
  assert.equal(asl.cobertura.consistente, true);
  assert.ok(est.cuerpo.consultores.every((c) => c.cobertura.consistente));

  const det = await llamar('GET', `/api/consultores/${asl.consultor_id}`);
  const ad2 = det.cuerpo.adendas.find((a) => a.numero === 2);
  assert.equal(ad2.estado, 'CONCLUIDA');
  assert.equal(det.cuerpo.adendas.length, 3);
  assert.equal(det.cuerpo.cobertura.tramos.length, 2);

  const mala = await llamar('PATCH', `/api/adendas/${ad2.adenda_id}`, { plazo_dias: 0, revision: ad2.revision, motivo: 'Prueba de validación' });
  assert.equal(mala.estado, 400);
  // un hueco entre la Adenda 02 y la 03 aparece como alerta en la ficha
  const ok = await llamar('PATCH', `/api/adendas/${ad2.adenda_id}`, { fecha_fin: '2026-10-31', plazo_dias: 82, revision: ad2.revision, motivo: 'Corrección de la fecha de fin según el documento' });
  assert.equal(ok.estado, 200, JSON.stringify(ok.cuerpo));
  const despues = await llamar('GET', `/api/consultores/${asl.consultor_id}`);
  assert.equal(despues.cuerpo.cobertura.dias_sin_cobertura, 8);
  assert.ok(despues.cuerpo.alertas.some((a) => a.codigo === 'ADENDAS_SIN_COBERTURA' && a.prioridad === 'ALTA'));
});

test('PDF del plan aprobado: se adjunta con motivo, se muestra en visor y queda en la bitácora', async () => {
  // Continúa la sesión EDITOR de la prueba anterior
  const est = await llamar('GET', '/api/estado');
  const erb = est.cuerpo.consultores.find((c) => c.clave === 'ERB');
  const det = await llamar('GET', `/api/consultores/${erb.consultor_id}`);
  const planId = det.cuerpo.plan.plan_id;
  assert.equal(det.cuerpo.plan_pdf.existe, false);
  assert.equal((await llamar('GET', `/api/planes/${planId}/pdf`)).estado, 404);

  const subir = (cuerpo, motivo = 'Plan aprobado el 05/11/2026', tipo = 'application/pdf') => fetch(`${base}/api/planes/${planId}/pdf`, {
    method: 'PUT', headers: { 'Content-Type': tipo, 'X-SGF': '1', 'X-Motivo': encodeURIComponent(motivo), Cookie: cookie }, body: cuerpo });
  const pdf = Buffer.from(['%PDF-1.4', '1 0 obj<<>>endobj', 'trailer<<>>', '%%EOF', ''].join(String.fromCharCode(10)));
  assert.equal((await subir(Buffer.from('esto no es un pdf'))).status, 400, 'rechaza lo que no es PDF');
  assert.equal((await subir(pdf, 'no')).status, 400, 'exige el motivo');
  assert.equal((await subir(pdf, 'Plan aprobado el 05/11/2026', 'text/plain')).status, 400, 'exige Content-Type application/pdf');
  const ok = await subir(pdf);
  assert.equal(ok.status, 200);

  const luego = await llamar('GET', `/api/consultores/${erb.consultor_id}`);
  assert.equal(luego.cuerpo.plan_pdf.existe, true);
  assert.equal(luego.cuerpo.plan_pdf.bytes, pdf.length);

  const ver = await fetch(`${base}/api/planes/${planId}/pdf`, { headers: { 'X-SGF': '1', Cookie: cookie } });
  assert.equal(ver.status, 200);
  assert.equal(ver.headers.get('content-type'), 'application/pdf');
  assert.match(ver.headers.get('content-security-policy'), /frame-ancestors 'self'/, 'se puede mostrar en el visor de la propia aplicación');
  assert.equal(Buffer.compare(Buffer.from(await ver.arrayBuffer()), pdf), 0);
  assert.equal((await fetch(`${base}/api/planes/${planId}/pdf`)).status, 401, 'sin sesión no se entrega');

  // reemplazar conserva la versión anterior (nada se borra)
  assert.equal((await subir(Buffer.concat([pdf, Buffer.from('%v2')]), 'Corrección del PDF aprobado')).status, 200);
  assert.equal(fs.readdirSync(process.env.PLANES_PDF_DIR).filter((f) => f.startsWith(`plan-${planId}`)).length, 2);

  const bit = await llamar('GET', `/api/bitacora?consultor_id=${erb.consultor_id}`);
  assert.ok(bit.cuerpo.some((b) => b.entidad === 'plan_trabajo' && /plan_pdf/.test(b.cambios_json || '') && b.motivo === 'Plan aprobado el 05/11/2026'));
  assert.ok(!bit.cuerpo.some((b) => /esto no es un pdf/.test(JSON.stringify(b))));
});

test('PDF de la adenda: sin archivo responde 404 (tiene_pdf = false); se adjunta con motivo, se ve en el visor y queda en la bitácora', async () => {
  const lista = await llamar('GET', '/api/adendas');
  const a = lista.cuerpo.find((x) => x.clave === 'ERB' && x.numero === 3);
  assert.equal(a.tiene_pdf, false);
  const url = `${base}/api/adendas/${a.adenda_id}/pdf`;
  const sin = await fetch(url, { headers: { 'X-SGF': '1', Cookie: cookie } });
  assert.equal(sin.status, 404);
  assert.match((await sin.json()).error, /SIN ADENDA REGISTRADA EN EL SISTEMA/);

  const subir = (cuerpo, motivo = 'Adenda suscrita remitida por BPS', metodo = 'PUT') => fetch(url, { method: metodo, headers: { 'Content-Type': 'application/pdf', 'X-SGF': '1', 'X-Motivo': encodeURIComponent(motivo), Cookie: cookie }, body: cuerpo });
  const pdf = Buffer.from(['%PDF-1.4', '1 0 obj<<>>endobj', 'trailer<<>>', '%%EOF', ''].join(String.fromCharCode(10)));
  assert.equal((await subir(Buffer.from('no es pdf'))).status, 400);
  assert.equal((await subir(pdf, 'no')).status, 400, 'exige el motivo');
  assert.equal((await subir(pdf, undefined, 'POST')).status, 200, 'POST equivale a PUT (el IIS con WebDAV rechaza PUT)');

  assert.equal((await llamar('GET', '/api/adendas')).cuerpo.find((x) => x.adenda_id === a.adenda_id).tiene_pdf, true);
  const ver = await fetch(url, { headers: { 'X-SGF': '1', Cookie: cookie } });
  assert.equal(ver.status, 200);
  assert.equal(ver.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.compare(Buffer.from(await ver.arrayBuffer()), pdf), 0);
  assert.equal((await fetch(url)).status, 401, 'sin sesión no se entrega');
  assert.equal((await fetch(`${base}/api/adendas/999999/pdf`, { headers: { 'X-SGF': '1', Cookie: cookie } })).status, 404);

  const bit = await llamar('GET', `/api/bitacora?consultor_id=${a.consultor_id}`);
  assert.ok(bit.cuerpo.some((b) => b.entidad === 'adenda' && /adenda_pdf/.test(b.cambios_json || '') && b.motivo === 'Adenda suscrita remitida por BPS'));
});
