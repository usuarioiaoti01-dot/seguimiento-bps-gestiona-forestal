'use strict';
/** Configuración desde variables de entorno (archivo .env en la raíz). */
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');

function cargarEnv(archivo = path.join(RAIZ, '.env')) {
  if (!fs.existsSync(archivo)) return;
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if (/^["']/.test(v)) v = v.replace(/^(["'])(.*)\1.*$/, '$2'); // valor entre comillas: se respeta tal cual
    else if (v.startsWith('#')) v = '';                                // vacío con comentario
    else v = v.replace(/\s+#.*$/, '').trim();                       // comentario al final de la línea
    process.env[m[1]] = v;
  }
}
cargarEnv();

const e = process.env;
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'si', 'sí', 'yes'].includes(String(v).toLowerCase()));

const config = {
  raiz: RAIZ,
  puerto: Number(e.PUERTO || 3080),
  produccion: e.NODE_ENV === 'production',
  // Proxy inverso de confianza (para req.ip y el límite de intentos de ingreso). Número = saltos de proxy
  // (Cloud Run: 1), true/false, o lista/alias de Express (p. ej. 'loopback'). Por defecto solo loopback.
  confiarProxy: (() => { const v = (e.TRUST_PROXY || '').trim(); if (!v) return 'loopback'; if (/^\d+$/.test(v)) return Number(v); if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true'; return v; })(),
  modoDatos: (e.MODO_DATOS || 'memoria').toLowerCase(), // memoria | sqlserver
  planesPdf: e.PLANES_PDF_DIR || path.join(RAIZ, 'data', 'planes-pdf'), // PDF de los planes aprobados
  documentos: e.DOCUMENTOS_DIR || path.join(RAIZ, 'data', 'documentos'), // originales de los documentos cargados
  archivoDemo: e.ARCHIVO_DEMO || path.join(RAIZ, 'data', 'demo-estado.json'),
  sqlserver: {
    servidor: e.SQL_SERVIDOR,
    puerto: Number(e.SQL_PUERTO || 1433),
    base: e.SQL_BASE || 'SGF_SEGUIMIENTO',
    usuario: e.SQL_USUARIO,
    clave: e.SQL_CLAVE,
    cifrar: bool(e.SQL_CIFRAR, true),
    confiarCertificado: bool(e.SQL_CONFIAR_CERTIFICADO, true),
  },
  sesion: {
    secreto: e.SESION_SECRETO,
    horas: Number(e.SESION_HORAS || 10),
    cookieSegura: bool(e.COOKIE_SEGURA, false),
  },
  admin: { correo: e.ADMIN_CORREO, nombre: e.ADMIN_NOMBRE || 'Administrador OTI', clave: e.ADMIN_CLAVE_INICIAL },
  ia: {
    claveApi: e.ANTHROPIC_API_KEY,
    modelo: e.ANTHROPIC_MODELO || 'claude-haiku-5-5',
    maxTokens: Number(e.IA_MAX_TOKENS || 2048),
    maxIteraciones: Number(e.IA_MAX_ITERACIONES || 8),
  },
};

module.exports = config;
