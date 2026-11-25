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
  actividadesPdf: e.ACTIVIDADES_PDF_DIR || path.join(RAIZ, 'data', 'actividades-pdf'), // documentos PDF de las actividades del plan
  planesPdf: e.PLANES_PDF_DIR || path.join(RAIZ, 'data', 'planes-pdf'), // PDF de los planes aprobados
  adendasPdf: e.ADENDAS_PDF_DIR || path.join(RAIZ, 'data', 'adendas-pdf'), // PDF de las adendas
  contratosPdf: e.CONTRATOS_PDF_DIR || path.join(RAIZ, 'data', 'contratos-pdf'), // Orden de Servicio / contrato y Términos de Referencia del personal
  planesOrigen: e.PLANES_ORIGEN_DIR || path.join(RAIZ, 'data', 'planes-origen'), // documentos con los que se registró un plan ya elaborado
  documentos: e.DOCUMENTOS_DIR || path.join(RAIZ, 'data', 'documentos'), // originales de los documentos cargados
  almacen: e.DOCUMENTOS_RAIZ || path.join(RAIZ, 'data', 'almacen'), // almacén documental único (db/14): <proyecto>/<entidad>/<id>/<tipo>-<fecha>-<sha8>.<ext>
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
  // Correo diario de alertas (P11) por Google Workspace (smtp.gmail.com). Desactivado hasta que se configure.
  correo: {
    activo: bool(e.ALERTAS_CORREO, false),
    hora: /^\d{2}:\d{2}$/.test(e.ALERTAS_HORA || '') ? e.ALERTAS_HORA : '07:30', // hora de Lima
    soloHabiles: bool(e.ALERTAS_SOLO_HABILES, true),
    copiaAdmin: bool(e.ALERTAS_COPIA_ADMIN, true),
    remitente: (e.CORREO_REMITENTE || '').trim(), // cuenta @serfor.gob.pe que envía
    nombre: e.CORREO_NOMBRE || 'Seguimiento de Proyectos – OTI SERFOR',
    modo: (e.CORREO_MODO || 'clave').toLowerCase(), // clave (contraseña de aplicación) | cuenta_servicio (OAuth2 con delegación de dominio)
    clave: e.CORREO_CLAVE, // contraseña de aplicación de la cuenta remitente
    cuentaServicio: e.CORREO_CUENTA_SERVICIO_JSON, // ruta del JSON de la cuenta de servicio (fuera del repositorio)
    servidor: e.CORREO_SMTP || 'smtp.gmail.com',
    puerto: Number(e.CORREO_PUERTO || 465),
    urlAplicacion: (e.URL_APLICACION || 'https://serforia.serfor.gob.pe').replace(/\/+$/, ''),
  },
  // Reporte mensual para Gerencia por correo (usa la misma cuenta de Google Workspace). Desactivado por defecto.
  reporte: {
    activo: bool(e.REPORTE_MENSUAL_CORREO, false),
    para: String(e.REPORTE_MENSUAL_PARA || '').split(/[;,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean),
    diaHabil: Math.min(Math.max(Number(e.REPORTE_MENSUAL_DIA_HABIL) || 1, 1), 15), // N.° día hábil del mes siguiente
    hora: /^\d{2}:\d{2}$/.test(e.REPORTE_MENSUAL_HORA || '') ? e.REPORTE_MENSUAL_HORA : '08:00', // hora de Lima
    montos: bool(e.REPORTE_MENSUAL_MONTOS, false), // los montos son confidenciales (D4): solo si la Dirección lo decide
    copiaAdmin: bool(e.REPORTE_MENSUAL_COPIA_ADMIN, true),
  },
  // Ingreso con Google Workspace (OpenID Connect). Desactivado hasta que se configure; la clave local sigue funcionando.
  sso: {
    google: bool(e.SSO_GOOGLE, false),
    clienteId: (e.GOOGLE_CLIENT_ID || '').trim(),
    secreto: e.GOOGLE_CLIENT_SECRET,
    dominio: (e.GOOGLE_DOMINIO || 'serfor.gob.pe').trim().toLowerCase(),
    urlRetorno: `${(e.URL_APLICACION || 'https://serforia.serfor.gob.pe').replace(/\/+$/, '')}/api/auth/google/retorno`,
  },
  ia: {
    claveApi: e.ANTHROPIC_API_KEY,
    modelo: e.ANTHROPIC_MODELO || 'claude-haiku-5-5',
    maxTokens: Number(e.IA_MAX_TOKENS || 2048),
    maxIteraciones: Number(e.IA_MAX_ITERACIONES || 8),
  },
};

module.exports = config;
