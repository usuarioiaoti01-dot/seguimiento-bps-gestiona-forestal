'use strict';
/**
 * Autenticación por usuario y clave (bcrypt) con sesión en cookie httpOnly
 * firmada (JWT). Roles: ADMIN (todo + usuarios, parámetros, datos personales),
 * EDITOR (registra seguimiento y reprograma), LECTOR (solo consulta).
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('./config');

const COOKIE = 'sgf_sesion';
const NIVEL = { LECTOR: 1, EDITOR: 2, ADMIN: 3 };

let secreto = config.sesion.secreto;
if (!secreto) {
  if (config.produccion) throw new Error('Defina SESION_SECRETO en el .env (cadena aleatoria de al menos 32 caracteres).');
  secreto = crypto.randomBytes(32).toString('hex'); // solo desarrollo: las sesiones caducan al reiniciar
}

const claveValida = (c) => typeof c === 'string' && c.length >= 10 && /[A-Za-z]/.test(c) && /\d/.test(c);
const generarClaveTemporal = () => `${crypto.randomBytes(6).toString('base64url')}9a`;

function emitirSesion(res, usuario) {
  const token = jwt.sign({ id: usuario.usuario_id, correo: usuario.correo, nombre: usuario.nombre, rol: usuario.rol, cambiar: !!usuario.debe_cambiar_clave }, secreto, { expiresIn: `${config.sesion.horas}h` });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: config.sesion.cookieSegura, maxAge: config.sesion.horas * 3600000, path: '/' });
}

function leerSesion(req, _res, next) {
  const t = req.cookies && req.cookies[COOKIE];
  if (t) {
    try { req.usuario = jwt.verify(t, secreto); } catch { req.usuario = null; }
  }
  next();
}

function requiere(rol = 'LECTOR') {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'Sesión no iniciada o expirada' });
    if (req.usuario.cambiar && !req.path.includes('cambiar-clave')) return res.status(403).json({ error: 'Debe cambiar su clave antes de continuar', cambiarClave: true });
    if ((NIVEL[req.usuario.rol] || 0) < NIVEL[rol]) return res.status(403).json({ error: 'Su rol no permite esta acción' });
    next();
  };
}

/** Protección CSRF simple: las peticiones que modifican exigen esta cabecera (además de SameSite=Strict). */
function exigirCabeceraApp(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.get('X-SGF') !== '1') {
    return res.status(400).json({ error: 'Petición no válida' });
  }
  next();
}

/** Limita intentos de ingreso por IP y correo (en memoria). */
const intentos = new Map();
function limitarIngreso(req, res, next) {
  const k = `${req.ip}|${String((req.body && req.body.correo) || '').toLowerCase()}`;
  const ahora = Date.now();
  const r = intentos.get(k) || { n: 0, desde: ahora };
  if (ahora - r.desde > 15 * 60000) { r.n = 0; r.desde = ahora; }
  if (r.n >= 8) return res.status(429).json({ error: 'Demasiados intentos. Espere 15 minutos.' });
  r.n += 1;
  intentos.set(k, r);
  req.limpiarIntentos = () => intentos.delete(k);
  next();
}

/** Crea el primer administrador si la tabla de usuarios está vacía. */
async function asegurarAdministrador(repo) {
  if ((await repo.contarUsuarios()) > 0) return;
  const correo = config.admin.correo || 'admin@serfor.gob.pe';
  let clave = config.admin.clave;
  let generada = false;
  if (!clave) {
    if (config.produccion) throw new Error('Defina ADMIN_CORREO y ADMIN_CLAVE_INICIAL en el .env para crear el primer administrador.');
    clave = generarClaveTemporal();
    generada = true;
  }
  await repo.crearUsuario({ correo, nombre: config.admin.nombre, rol: 'ADMIN', clave_hash: await bcrypt.hash(clave, 11), debe_cambiar_clave: 1 });
  console.log(`[seguridad] Administrador inicial creado: ${correo}${generada ? ` · clave temporal: ${clave}` : ' (clave tomada de ADMIN_CLAVE_INICIAL)'} · se pedirá cambiarla al ingresar.`);
}

module.exports = { bcrypt, emitirSesion, leerSesion, requiere, exigirCabeceraApp, limitarIngreso, asegurarAdministrador, claveValida, generarClaveTemporal, COOKIE };
