'use strict';
/**
 * Ingreso con Google Workspace (OpenID Connect, código de autorización + PKCE). Sin dependencias nuevas.
 *
 * 1. /api/auth/google: arma la URL de Google con `state`, `nonce` y el reto PKCE; los guarda firmados en una cookie
 *    temporal (10 min, SameSite=Lax para que vuelva con la redirección de Google).
 * 2. /api/auth/google/retorno: comprueba el `state`, canjea el código por el id_token y lo verifica: firma RS256 con
 *    las llaves públicas de Google, emisor, audiencia (nuestro client_id), vencimiento, `nonce`, correo verificado y
 *    dominio de Workspace (claim `hd` y terminación del correo). Devuelve el correo; server.js busca la cuenta.
 * Las cuentas no se crean solas: la crea el Administrador. Ni el client secret ni los tokens se registran.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const AUTORIZACION = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const LLAVES = 'https://www.googleapis.com/oauth2/v3/certs';
const EMISORES = ['https://accounts.google.com', 'accounts.google.com'];
const COOKIE = 'sgf_oauth';
const b64url = (b) => Buffer.from(b).toString('base64url');

const errorSso = (codigo, detalle) => Object.assign(new Error(detalle || codigo), { codigo });

function crearSsoGoogle({ config, secreto, obtener = (...a) => globalThis.fetch(...a) }) {
  let llaves = { hasta: 0, porKid: new Map() };

  const activo = () => !!(config.google && config.clienteId && config.secreto);

  /** URL de Google y el valor firmado de la cookie temporal. */
  function iniciar() {
    if (!activo()) throw errorSso('desactivado', 'El ingreso con Google no está configurado');
    const state = b64url(crypto.randomBytes(24));
    const nonce = b64url(crypto.randomBytes(24));
    const verificador = b64url(crypto.randomBytes(48));
    const reto = b64url(crypto.createHash('sha256').update(verificador).digest());
    const q = new URLSearchParams({
      client_id: config.clienteId, redirect_uri: config.urlRetorno, response_type: 'code', scope: 'openid email profile',
      state, nonce, code_challenge: reto, code_challenge_method: 'S256', hd: config.dominio, prompt: 'select_account',
    });
    const cookie = jwt.sign({ state, nonce, verificador }, secreto, { expiresIn: '10m', audience: 'sgf-oauth' });
    return { url: `${AUTORIZACION}?${q}`, cookie };
  }

  async function llavesDeGoogle(forzar = false) {
    if (!forzar && Date.now() < llaves.hasta && llaves.porKid.size) return llaves.porKid;
    const r = await obtener(LLAVES);
    if (!r.ok) throw errorSso('google', `Google no entregó sus llaves públicas (${r.status})`);
    const j = await r.json();
    const max = /max-age=(\d+)/.exec((r.headers && r.headers.get && r.headers.get('cache-control')) || '');
    llaves = { hasta: Date.now() + Math.min(Number(max ? max[1] : 3600), 86400) * 1000, porKid: new Map((j.keys || []).map((k) => [k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })])) };
    return llaves.porKid;
  }

  /** Verifica el id_token y devuelve sus datos (lanza errorSso con un código si algo no cuadra). */
  async function verificarIdToken(idToken, nonce) {
    const cab = jwt.decode(idToken, { complete: true });
    if (!cab || !cab.header || cab.header.alg !== 'RS256') throw errorSso('token', 'Token de Google no válido');
    let porKid = await llavesDeGoogle();
    if (!porKid.has(cab.header.kid)) porKid = await llavesDeGoogle(true); // Google rota sus llaves
    const llave = porKid.get(cab.header.kid);
    if (!llave) throw errorSso('token', 'Token de Google firmado con una llave desconocida');
    let p;
    try { p = jwt.verify(idToken, llave, { algorithms: ['RS256'], audience: config.clienteId, issuer: EMISORES, clockTolerance: 60 }); } catch (err) { throw errorSso('token', `Token de Google no válido: ${err.message}`); }
    if (!nonce || p.nonce !== nonce) throw errorSso('token', 'El token de Google no corresponde a este ingreso');
    const correo = String(p.email || '').toLowerCase();
    if (!correo || p.email_verified !== true) throw errorSso('correo', 'Google no confirmó el correo de la cuenta');
    if (String(p.hd || '').toLowerCase() !== config.dominio || !correo.endsWith(`@${config.dominio}`)) throw errorSso('dominio', `Solo se admiten cuentas @${config.dominio}`);
    return { correo, nombre: p.name || null };
  }

  /** Procesa el regreso de Google: { code, state, error } de la URL y el valor de la cookie temporal. */
  async function retorno({ code, state, error, cookie }) {
    if (!activo()) throw errorSso('desactivado', 'El ingreso con Google no está configurado');
    if (error) throw errorSso('cancelado', `Google respondió: ${String(error).slice(0, 60)}`);
    let guardado;
    try { guardado = jwt.verify(String(cookie || ''), secreto, { audience: 'sgf-oauth' }); } catch { throw errorSso('estado', 'El ingreso con Google expiró o no se inició aquí'); }
    const a = Buffer.from(String(state || '')); const b = Buffer.from(String(guardado.state));
    if (!code || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw errorSso('estado', 'El ingreso con Google no corresponde a esta sesión');
    const r = await obtener(TOKEN, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: String(code), client_id: config.clienteId, client_secret: config.secreto, redirect_uri: config.urlRetorno, grant_type: 'authorization_code', code_verifier: guardado.verificador }).toString(),
    });
    if (!r.ok) throw errorSso('google', `Google rechazó el código de autorización (${r.status})`);
    const j = await r.json();
    if (!j.id_token) throw errorSso('google', 'Google no devolvió el id_token');
    return verificarIdToken(j.id_token, guardado.nonce);
  }

  return { activo, iniciar, retorno, verificarIdToken, COOKIE };
}

module.exports = { crearSsoGoogle, COOKIE_OAUTH: COOKIE };
