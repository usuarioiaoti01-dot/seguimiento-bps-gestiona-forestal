'use strict';
/** Ingreso con Google Workspace (OpenID Connect + PKCE) contra un Google simulado: flujo completo y rechazos. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-sso-'));
const CLIENTE = 'cliente-prueba.apps.googleusercontent.com';
Object.assign(process.env, {
  MODO_DATOS: 'memoria', ARCHIVO_DEMO: path.join(tmp, 'demo.json'), DOCUMENTOS_RAIZ: path.join(tmp, 'almacen'),
  PLANES_PDF_DIR: path.join(tmp, 'planes-pdf'), ADENDAS_PDF_DIR: path.join(tmp, 'adendas-pdf'), CONTRATOS_PDF_DIR: path.join(tmp, 'contratos-pdf'),
  PLANES_ORIGEN_DIR: path.join(tmp, 'planes-origen'), ACTIVIDADES_PDF_DIR: path.join(tmp, 'actividades-pdf'), DOCUMENTOS_DIR: path.join(tmp, 'documentos'),
  ADMIN_CORREO: 'admin.sso@serfor.gob.pe', ADMIN_CLAVE_INICIAL: 'ClaveSso2026xyz', ANTHROPIC_API_KEY: '',
  SSO_GOOGLE: 'true', GOOGLE_CLIENT_ID: CLIENTE, GOOGLE_CLIENT_SECRET: 'secreto-de-prueba', GOOGLE_DOMINIO: 'serfor.gob.pe', URL_APLICACION: 'https://serforia.serfor.gob.pe',
});
const jwt = require('jsonwebtoken');
const { crearSsoGoogle } = require('../server/sso-google');

// --- Google simulado ---------------------------------------------------------------------------------------------
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'llave-1';
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }] };
const google = { reclamos: {}, retos: new Map(), ultimoCuerpo: null };
const firmar = (claims, opts = {}) => jwt.sign({ iss: 'https://accounts.google.com', aud: CLIENTE, email_verified: true, hd: 'serfor.gob.pe', ...claims }, privateKey, { algorithm: 'RS256', keyid: opts.kid || KID, expiresIn: opts.expiresIn || '5m' });
const respuesta = (cuerpo, status = 200) => ({ ok: status < 400, status, json: async () => cuerpo, headers: { get: () => 'public, max-age=3600' } });
async function obtenerFalso(url, opciones = {}) {
  if (url === 'https://www.googleapis.com/oauth2/v3/certs') return respuesta(jwks);
  if (url === 'https://oauth2.googleapis.com/token') {
    const p = new URLSearchParams(opciones.body);
    google.ultimoCuerpo = Object.fromEntries(p);
    const reto = crypto.createHash('sha256').update(p.get('code_verifier')).digest('base64url');
    if (p.get('client_secret') !== 'secreto-de-prueba' || p.get('code') !== 'codigo-bueno' || !google.retos.has(reto)) return respuesta({ error: 'invalid_grant' }, 400);
    return respuesta({ id_token: firmar({ nonce: google.retos.get(reto), ...google.reclamos }) });
  }
  return null;
}
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, opciones) => (await obtenerFalso(String(url), opciones)) || fetchReal(url, opciones);

test('módulo: rechaza tokens vencidos, de otra audiencia, sin correo verificado o de otro dominio; rota llaves', async () => {
  const s = crearSsoGoogle({ config: { google: true, clienteId: CLIENTE, secreto: 'x', dominio: 'serfor.gob.pe', urlRetorno: 'https://a/b' }, secreto: 'firma', obtener: obtenerFalso });
  assert.deepEqual(await s.verificarIdToken(firmar({ email: 'Ana@SERFOR.gob.pe', nonce: 'n1', name: 'Ana' }), 'n1'), { correo: 'ana@serfor.gob.pe', nombre: 'Ana' });
  const codigo = async (token, nonce = 'n1') => { try { await s.verificarIdToken(token, nonce); return 'ok'; } catch (e) { return e.codigo; } };
  assert.equal(await codigo(firmar({ email: 'a@serfor.gob.pe', nonce: 'n1' }, { expiresIn: -120 })), 'token', 'vencido');
  assert.equal(await codigo(jwt.sign({ iss: 'https://accounts.google.com', aud: 'otro', email: 'a@serfor.gob.pe', email_verified: true, hd: 'serfor.gob.pe', nonce: 'n1' }, privateKey, { algorithm: 'RS256', keyid: KID })), 'token', 'otra audiencia');
  assert.equal(await codigo(firmar({ email: 'a@serfor.gob.pe', nonce: 'otro' })), 'token', 'nonce distinto');
  assert.equal(await codigo(firmar({ email: 'a@serfor.gob.pe', nonce: 'n1', email_verified: false })), 'correo');
  assert.equal(await codigo(firmar({ email: 'a@gmail.com', nonce: 'n1', hd: undefined })), 'dominio');
  assert.equal(await codigo(firmar({ email: 'a@otro.gob.pe', nonce: 'n1', hd: 'serfor.gob.pe' })), 'dominio', 'el correo también debe ser del dominio');
  assert.equal(await codigo(jwt.sign({ email: 'a@serfor.gob.pe' }, 'clave-simetrica')), 'token', 'HS256 no se acepta');
  assert.equal(await codigo(firmar({ email: 'a@serfor.gob.pe', nonce: 'n1' }, { kid: 'desconocida' })), 'token', 'llave desconocida');
  const off = crearSsoGoogle({ config: { google: false, clienteId: CLIENTE, secreto: 'x', dominio: 'serfor.gob.pe' }, secreto: 'f' });
  assert.equal(off.activo(), false);
  assert.throws(() => off.iniciar(), /no está configurado/);
});

test('API: ingreso con Google de una cuenta registrada; rechazos; la clave temporal deja de valer', async () => {
  const { crearApp } = require('../server/server');
  const { app } = await crearApp();
  const servidor = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const galleta = (r, nombre) => { const c = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]).find((x) => x && x.startsWith(`${nombre}=`)); return c ? c.split(';')[0] : null; };
  try {
    assert.deepEqual(await (await fetch(`${base}/api/auth/opciones`)).json(), { google: true, dominio: 'serfor.gob.pe' });
    // el Administrador crea la cuenta del Jefe (con clave temporal)
    let cookie = '';
    const ing = await fetch(`${base}/api/auth/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SGF': '1' }, body: JSON.stringify({ correo: 'admin.sso@serfor.gob.pe', clave: 'ClaveSso2026xyz' }) });
    cookie = galleta(ing, 'sgf_sesion');
    await fetch(`${base}/api/auth/cambiar-clave`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SGF': '1', Cookie: cookie }, body: JSON.stringify({ actual: 'ClaveSso2026xyz', nueva: 'NuevaClaveSso2026' }) }).then((r) => { cookie = galleta(r, 'sgf_sesion') || cookie; });
    const nueva = await (await fetch(`${base}/api/usuarios`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SGF': '1', Cookie: cookie }, body: JSON.stringify({ correo: 'jefa.sso@serfor.gob.pe', nombre: 'Jefa SSO', rol: 'JEFE_PROYECTO' }) })).json();

    /** Inicia el ingreso con Google y vuelve con el código; devuelve la respuesta del retorno. */
    const ingresarConGoogle = async (reclamos, { alterarEstado = false, codigo = 'codigo-bueno' } = {}) => {
      const ini = await fetch(`${base}/api/auth/google`, { redirect: 'manual' });
      assert.equal(ini.status, 302);
      const destino = new URL(ini.headers.get('location'));
      assert.equal(destino.origin + destino.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
      assert.equal(destino.searchParams.get('hd'), 'serfor.gob.pe');
      assert.equal(destino.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(destino.searchParams.get('redirect_uri'), 'https://serforia.serfor.gob.pe/api/auth/google/retorno');
      const oauth = galleta(ini, 'sgf_oauth');
      assert.ok(oauth && /SameSite=Lax/i.test((ini.headers.getSetCookie ? ini.headers.getSetCookie() : [ini.headers.get('set-cookie')]).join(';')), 'la cookie temporal es Lax');
      google.retos.set(destino.searchParams.get('code_challenge'), destino.searchParams.get('nonce'));
      google.reclamos = reclamos;
      const estado = alterarEstado ? 'otro-estado' : destino.searchParams.get('state');
      return fetch(`${base}/api/auth/google/retorno?code=${codigo}&state=${estado}`, { redirect: 'manual', headers: { Cookie: oauth } });
    };

    const ok = await ingresarConGoogle({ email: 'jefa.sso@serfor.gob.pe', name: 'Jefa SSO' });
    assert.equal(ok.status, 302); assert.equal(ok.headers.get('location'), '/');
    assert.equal(google.ultimoCuerpo.client_id, CLIENTE);
    const sesion = galleta(ok, 'sgf_sesion');
    const yo = await (await fetch(`${base}/api/auth/yo`, { headers: { Cookie: sesion } })).json();
    assert.equal(yo.usuario.correo, 'jefa.sso@serfor.gob.pe');
    assert.equal(yo.usuario.cambiarClave, false, 'no se le pide cambiar una clave que no usa');
    const local = await fetch(`${base}/api/auth/ingresar`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SGF': '1' }, body: JSON.stringify({ correo: 'jefa.sso@serfor.gob.pe', clave: nueva.clave_temporal }) });
    assert.equal(local.status, 401, 'la clave temporal quedó sin efecto');

    const loc = async (r) => (await r).headers.get('location');
    assert.equal(await loc(ingresarConGoogle({ email: 'nadie@serfor.gob.pe' })), '/?sso_error=no_registrado');
    assert.equal(await loc(ingresarConGoogle({ email: 'alguien@gmail.com', hd: undefined })), '/?sso_error=dominio');
    assert.equal(await loc(ingresarConGoogle({ email: 'jefa.sso@serfor.gob.pe' }, { alterarEstado: true })), '/?sso_error=estado');
    assert.equal(await loc(ingresarConGoogle({ email: 'jefa.sso@serfor.gob.pe' }, { codigo: 'codigo-malo' })), '/?sso_error=google');
    assert.equal((await fetch(`${base}/api/auth/google/retorno?code=codigo-bueno&state=x`, { redirect: 'manual' })).headers.get('location'), '/?sso_error=estado', 'sin la cookie temporal');
    assert.equal((await fetch(`${base}/api/auth/google/retorno?error=access_denied`, { redirect: 'manual' })).headers.get('location'), '/?sso_error=cancelado', 'el usuario canceló en Google');

    // cuenta desactivada
    await fetch(`${base}/api/usuarios/${nueva.usuario.usuario_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-SGF': '1', Cookie: cookie }, body: JSON.stringify({ activo: 0 }) });
    assert.equal(await loc(ingresarConGoogle({ email: 'jefa.sso@serfor.gob.pe' })), '/?sso_error=inactivo');
    const bit = await (await fetch(`${base}/api/bitacora?entidad=sesion&limite=50`, { headers: { 'X-SGF': '1', Cookie: cookie } })).json();
    assert.ok(bit.some((b) => b.accion === 'ACCESO' && /Google/.test(b.motivo) && b.usuario === 'jefa.sso@serfor.gob.pe'));
    assert.ok(bit.some((b) => b.accion === 'ACCESO_RECHAZADO' && b.usuario === 'nadie@serfor.gob.pe'));
    assert.ok(!JSON.stringify(bit).includes('secreto-de-prueba'), 'el client secret no se registra');
  } finally { servidor.close(); }
});
