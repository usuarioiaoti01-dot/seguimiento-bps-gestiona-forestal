'use strict';
// Detrás de un proxy (Cloud Run) el límite de intentos de ingreso debe distinguir a cada cliente.
// TRUST_PROXY se lee al cargar la configuración, por eso va en su propio archivo (proceso aparte).
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-proxy-'));
process.env.MODO_DATOS = 'memoria';
process.env.ARCHIVO_DEMO = path.join(tmp, 'demo.json');
process.env.ADMIN_CORREO = 'admin.proxy@serfor.gob.pe';
process.env.ADMIN_CLAVE_INICIAL = 'ClaveProxy2026';
process.env.ANTHROPIC_API_KEY = '';
process.env.TRUST_PROXY = '1';
const config = require('../server/config');
const { crearApp } = require('../server/server');

// El proxy real no es loopback: se conecta por la IP de red de la máquina (si no hay, se omite la prueba).
const ipRed = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);

let base;
let servidor;
test.before(async () => {
  const { app } = await crearApp();
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://${ipRed ? ipRed.address : '127.0.0.1'}:${servidor.address().port}`;
});
test.after(() => servidor.close());

const ingresar = (ip, clave) => fetch(`${base}/api/auth/ingresar`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-SGF': '1', 'X-Forwarded-For': ip },
  body: JSON.stringify({ correo: 'admin.proxy@serfor.gob.pe', clave }),
});

test('TRUST_PROXY=1 se interpreta como número de saltos', () => {
  assert.equal(config.confiarProxy, 1);
});

test('con TRUST_PROXY=1 el bloqueo por intentos fallidos es por cliente y no afecta a otros', { skip: !ipRed && 'sin interfaz de red no loopback' }, async () => {
  for (let i = 0; i < 8; i += 1) assert.equal((await ingresar('203.0.113.7', 'mala')).status, 401);
  assert.equal((await ingresar('203.0.113.7', 'mala')).status, 429, 'el cliente que falla queda bloqueado');
  // Otro cliente (otra IP del proxy) con el mismo correo no queda bloqueado
  assert.equal((await ingresar('198.51.100.9', 'mala')).status, 401);
  assert.equal((await ingresar('198.51.100.9', 'ClaveProxy2026')).status, 200);
});
