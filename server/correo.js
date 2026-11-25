'use strict';
/**
 * Envío del correo diario de alertas por Google Workspace (P11). El contenido lo arma alertas-correo.js (puro).
 *
 * Autenticación (config.correo.modo):
 *   clave           contraseña de aplicación de la cuenta remitente (requiere verificación en dos pasos).
 *   cuenta_servicio OAuth2 de dos patas con una cuenta de servicio con delegación de dominio (alcance
 *                   https://mail.google.com/), que envía en nombre de la cuenta remitente.
 * Una vez al día, a la hora de Lima configurada (y, si se indica, solo en días hábiles). El envío queda en la bitácora
 * (entidad correo_alertas, origen SISTEMA o UI) con la fecha, que es lo que evita repetirlo el mismo día.
 * Las claves nunca se registran ni se devuelven por la API.
 */
const fs = require('fs');
const { aDia, hoyLima, crearCalendario } = require('./motor/calendario');
const { construirCorreos } = require('./alertas-correo');

const horaLima = (ahora = new Date()) => new Date(ahora.getTime() - 5 * 3600000).toISOString().slice(11, 16);

function crearAlertasCorreo({ config, servicio, repo, crearTransporte = null }) {
  let transporte = null; let enCurso = false; let reloj = null;

  /** ¿Está todo lo necesario para enviar? (sin revelar valores) */
  function diagnostico() {
    if (!config.remitente) return { configurado: false, motivo: 'Falta CORREO_REMITENTE en el .env' };
    if (!/@/.test(config.remitente)) return { configurado: false, motivo: 'CORREO_REMITENTE no es un correo válido' };
    if (config.modo === 'cuenta_servicio') {
      if (!config.cuentaServicio) return { configurado: false, motivo: 'Falta CORREO_CUENTA_SERVICIO_JSON en el .env' };
      try { const j = JSON.parse(fs.readFileSync(config.cuentaServicio, 'utf8')); if (!j.client_id || !j.private_key) return { configurado: false, motivo: 'El JSON de la cuenta de servicio no tiene client_id o private_key' }; } catch { return { configurado: false, motivo: 'No se pudo leer el JSON de la cuenta de servicio' }; }
    } else if (config.modo === 'clave') {
      if (!config.clave) return { configurado: false, motivo: 'Falta CORREO_CLAVE (contraseña de aplicación) en el .env' };
    } else return { configurado: false, motivo: 'CORREO_MODO debe ser clave o cuenta_servicio' };
    return { configurado: true, motivo: null };
  }

  function obtenerTransporte() {
    if (transporte) return transporte;
    const d = diagnostico();
    if (!d.configurado) throw Object.assign(new Error(`El correo no está configurado: ${d.motivo}`), { estado: 409 });
    let auth;
    if (config.modo === 'cuenta_servicio') {
      const j = JSON.parse(fs.readFileSync(config.cuentaServicio, 'utf8'));
      auth = { type: 'OAuth2', user: config.remitente, serviceClient: j.client_id, privateKey: j.private_key };
    } else auth = { user: config.remitente, pass: config.clave };
    const opciones = { host: config.servidor, port: config.puerto, secure: config.puerto === 465, auth };
    transporte = crearTransporte ? crearTransporte(opciones) : require('nodemailer').createTransport(opciones);
    return transporte;
  }

  /** Correos que se enviarían hoy (no envía). */
  async function vistaPrevia() {
    const d = await servicio.datos(true);
    const estado = await servicio.estado();
    const usuarios = await repo.listarUsuarios();
    return construirCorreos({ datos: d, estado, usuarios, miembros: d.miembros || [], urlAplicacion: config.urlAplicacion, copiaAdmin: config.copiaAdmin });
  }

  /** Último envío registrado (de la bitácora). */
  async function ultimoEnvio() {
    const filas = await repo.listarBitacora({ entidad: 'correo_alertas', limite: 5 });
    const f = filas.find((b) => b.accion === 'ENVIAR');
    if (!f) return null;
    let c = f.cambios_json; try { if (typeof c === 'string') c = JSON.parse(c); } catch { c = {}; }
    return { fecha: (c && c.fecha) || null, registrado: f.fecha, usuario: f.usuario, enviados: c && c.enviados, fallidos: c && c.fallidos ? c.fallidos.length : 0, origen: f.origen };
  }

  /**
   * Envía los correos del día. opts: { soloA: correo (prueba: solo el correo de ese destinatario, o el resumen si es
   * Administrador), usuario, origen }. Registra el envío en la bitácora salvo en la prueba.
   */
  async function enviar({ soloA = null, usuario = 'sistema/alertas', origen = 'SISTEMA' } = {}) {
    const t = obtenerTransporte();
    let correos = await vistaPrevia();
    if (soloA) {
      correos = correos.filter((c) => c.para.toLowerCase() === String(soloA).toLowerCase());
      if (!correos.length) {
        const texto = `Correo de prueba del Seguimiento de Proyectos de la OTI – SERFOR.\n\nLa cuenta ${config.remitente} puede enviar las alertas diarias. Hoy no hay alertas que le correspondan.\n\n${config.urlAplicacion}`;
        correos = [{ para: soloA, asunto: 'Prueba del correo diario de alertas', texto, html: `<p>${texto.replace(/\n\n/g, '</p><p>')}</p>` }];
      }
    }
    const enviados = []; const fallidos = [];
    for (const c of correos) {
      try {
        await t.sendMail({ from: { name: config.nombre, address: config.remitente }, to: c.para, subject: c.asunto, text: c.texto, html: c.html });
        enviados.push(c.para);
      } catch (err) { fallidos.push({ para: c.para, error: String(err.message || err).slice(0, 200) }); }
    }
    if (!soloA) {
      await repo.registrarBitacora({ usuario, entidad: 'correo_alertas', accion: 'ENVIAR', origen, motivo: `Correo diario de alertas: ${enviados.length} enviado(s)${fallidos.length ? `, ${fallidos.length} con error` : ''}`,
        cambios_json: { fecha: hoyLima(), enviados: enviados.length, destinatarios: enviados, fallidos } });
    }
    return { enviados, fallidos, correos: correos.length, prueba: !!soloA };
  }

  /** Comprueba la conexión y la autenticación con Google (no envía nada). */
  async function probarConexion() {
    await obtenerTransporte().verify();
    return { ok: true };
  }

  /** ¿Toca enviar ahora? (hora alcanzada, día hábil si corresponde y no enviado hoy) */
  async function tocaEnviar(ahora = new Date()) {
    if (!config.activo || !diagnostico().configurado) return false;
    if (horaLima(ahora) < config.hora) return false;
    const hoy = hoyLima(ahora);
    if (config.soloHabiles) {
      const d = await servicio.datos();
      if (!crearCalendario({ tipo: 'HABILES', feriados: (d.feriados || []).map((f) => f.fecha) }).esLaborable(aDia(hoy))) return false;
    }
    const u = await ultimoEnvio();
    return !(u && u.fecha === hoy);
  }

  async function tic(ahora = new Date()) {
    if (enCurso) return null;
    enCurso = true;
    try {
      if (!(await tocaEnviar(ahora))) return null;
      const r = await enviar();
      console.log(`[alertas] correo diario: ${r.enviados.length} enviado(s), ${r.fallidos.length} con error`);
      return r;
    } catch (err) { console.error('[alertas] no se pudo enviar el correo diario:', err.message); return null; } finally { enCurso = false; }
  }

  /** Revisa cada 5 minutos si toca enviar (no retiene el proceso al cerrar). */
  function programar(cadaMs = 5 * 60000) {
    if (reloj || !config.activo) return;
    reloj = setInterval(() => { tic(); }, cadaMs);
    if (reloj.unref) reloj.unref();
  }
  const detener = () => { if (reloj) clearInterval(reloj); reloj = null; };

  const publico = () => ({ activo: config.activo, hora: config.hora, solo_habiles: config.soloHabiles, copia_admin: config.copiaAdmin, remitente: config.remitente || null, modo: config.modo, ...diagnostico() });

  return { diagnostico, publico, vistaPrevia, enviar, probarConexion, ultimoEnvio, tocaEnviar, tic, programar, detener };
}

module.exports = { crearAlertasCorreo, horaLima };
