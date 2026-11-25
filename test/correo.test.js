'use strict';
/** Correo diario de alertas (P11): quién recibe qué, cuándo se envía y cómo queda registrado. Sin conexión real a Google. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-correo-'));
Object.assign(process.env, {
  MODO_DATOS: 'memoria', ARCHIVO_DEMO: path.join(tmp, 'demo.json'), DOCUMENTOS_RAIZ: path.join(tmp, 'almacen'),
  PLANES_PDF_DIR: path.join(tmp, 'planes-pdf'), ADENDAS_PDF_DIR: path.join(tmp, 'adendas-pdf'), CONTRATOS_PDF_DIR: path.join(tmp, 'contratos-pdf'),
  PLANES_ORIGEN_DIR: path.join(tmp, 'planes-origen'), ACTIVIDADES_PDF_DIR: path.join(tmp, 'actividades-pdf'), DOCUMENTOS_DIR: path.join(tmp, 'documentos'),
  ADMIN_CORREO: 'admin.correo@serfor.gob.pe', ADMIN_CLAVE_INICIAL: 'ClaveCorreo2026xx', ANTHROPIC_API_KEY: '', ALERTAS_CORREO: 'false', CORREO_REMITENTE: '',
});
const { construirCorreos } = require('../server/alertas-correo');
const { crearAlertasCorreo, crearReporteCorreo, diaHabilDelMes } = require('../server/correo');
const { mesAnterior, correoReporte } = require('../server/reporte-mensual');
const { construirEstado } = require('../server/motor/estado');

/** Dos proyectos OS: el 1 con un entregable vencido; el 2 sin alertas. */
function datos() {
  const k = (id, cid) => ({ contrato_id: id, consultor_id: cid, numero: `OS-${id}`, tipo_documento: 'ORDEN_SERVICIO', estado_contratacion: 'EN_EJECUCION', fecha_inicio: '2026-11-02', fecha_fin: '2026-12-31', monto: 12345, activo: 1 });
  return {
    proyectos: [1, 2].map((id) => ({ proyecto_id: id, codigo: `PRY-2026-00${id}`, nombre: id === 1 ? 'Portal <forestal>' : 'Sistema sin alertas', modalidad: 'ORDEN_SERVICIO', con_orden_servicio: 1, estado: 'EN_EJECUCION', activo: 1 })),
    consultores: [{ consultor_id: 1, proyecto_id: 1, clave: 'ABC', nombres: 'Ana Belén Cruz', estado: 'ACTIVO', activo: 1, dni: '12345678' }, { consultor_id: 2, proyecto_id: 2, clave: 'DEF', nombres: 'Diego Flores', estado: 'ACTIVO', activo: 1 }],
    contratos: [k(1, 1), k(2, 2)],
    adendas: [1, 2].map((id) => ({ adenda_id: id, contrato_id: id, numero: 1, tipo_periodo: 'ORIGINAL', estado: 'FIRMADA', fecha_inicio: '2026-11-02', fecha_fin: '2026-12-31', activo: 1 })),
    entregables_servicio: [{ entregable_servicio_id: 1, contrato_id: 1, numero: 1, nombre: 'Plan de trabajo', plazo_dias: 10, fecha_limite: '2026-11-12', estado: 'PENDIENTE', activo: 1 },
      { entregable_servicio_id: 2, contrato_id: 2, numero: 1, nombre: 'Informe', plazo_dias: 60, fecha_limite: '2026-12-31', estado: 'PENDIENTE', activo: 1 }],
    ultimos_partes: [{ consultor_id: 1, ultimo: '2026-11-20' }, { consultor_id: 2, ultimo: '2026-11-20' }],
    miembros: [{ proyecto_id: 1, usuario_id: 10, activo: 1 }, { proyecto_id: 2, usuario_id: 11, activo: 1 }, { proyecto_id: 1, usuario_id: 12, activo: 1 }],
    planes: [], actividades: [], dependencias: [], linea_base: [], controles_cambio: [], feriados: [], parametros: [],
  };
}
const usuarios = [
  { usuario_id: 1, correo: 'admin@serfor.gob.pe', nombre: 'Director OTI', rol: 'ADMIN', activo: 1 },
  { usuario_id: 10, correo: 'ana.jefe@serfor.gob.pe', nombre: 'Ana Jefa', rol: 'JEFE_PROYECTO', activo: 1 },
  { usuario_id: 11, correo: 'beto.jefe@serfor.gob.pe', nombre: 'Beto Jefe', rol: 'JEFE_PROYECTO', activo: 1 },
  { usuario_id: 12, correo: 'inactivo@serfor.gob.pe', nombre: 'Cuenta inactiva', rol: 'JEFE_PROYECTO', activo: 0 },
  { usuario_id: 13, correo: 'abc@serfor.gob.pe', nombre: 'Ana Belén Cruz', rol: 'PROFESIONAL', consultor_id: 1, activo: 1 },
];

test('construirCorreos: cada Jefe recibe solo las alertas de su equipo; el Administrador, el resumen; nada personal', () => {
  const d = datos();
  const estado = construirEstado(d, { corte: '2026-11-23' });
  const correos = construirCorreos({ datos: d, estado, usuarios, miembros: d.miembros, urlAplicacion: 'https://serforia.serfor.gob.pe' });
  assert.deepEqual(correos.map((c) => c.para).sort(), ['admin@serfor.gob.pe', 'ana.jefe@serfor.gob.pe'], 'Beto no tiene alertas; ni la cuenta inactiva ni el profesional reciben');
  const ana = correos.find((c) => c.para === 'ana.jefe@serfor.gob.pe');
  assert.deepEqual(ana.proyectos, ['PRY-2026-001']);
  assert.match(ana.asunto, /Alertas de seguimiento del 23\/11\/2026/);
  assert.match(ana.texto, /Entregable 1 \(Plan de trabajo\) vencido/);
  assert.match(ana.texto, /https:\/\/serforia\.serfor\.gob\.pe/);
  assert.ok(ana.html.includes('Portal &lt;forestal&gt;') && !ana.html.includes('<forestal>'), 'el HTML se escapa');
  for (const c of correos) assert.ok(!/12345678|12345/.test(c.texto + c.html), 'sin DNI ni monto');
  assert.match(correos.find((c) => c.rol === 'ADMIN').asunto, /^\[Resumen OTI\]/);
  assert.equal(construirCorreos({ datos: d, estado, usuarios, miembros: d.miembros, copiaAdmin: false }).length, 1, 'sin copia al Administrador');
});

test('envío: configuración, hora, día hábil, una vez al día, registro en bitácora y prueba', async () => {
  const d = datos();
  const bitacora = [];
  const servicio = { datos: async () => d, estado: async () => construirEstado(d, { corte: '2026-11-23' }) };
  const repo = {
    listarUsuarios: async () => usuarios,
    listarBitacora: async ({ entidad }) => bitacora.filter((b) => b.entidad === entidad).slice().reverse(),
    registrarBitacora: async (e) => { bitacora.push({ ...e, fecha: new Date().toISOString(), cambios_json: JSON.stringify(e.cambios_json) }); },
  };
  const enviados = [];
  const transporte = { sendMail: async (m) => { if (m.to === 'admin@serfor.gob.pe' && transporte.fallarAdmin) throw new Error('454 límite de envío'); enviados.push(m); }, verify: async () => true };
  const base = { activo: true, hora: '07:30', soloHabiles: true, copiaAdmin: true, remitente: '', nombre: 'Seguimiento OTI', modo: 'clave', clave: '', servidor: 'smtp.gmail.com', puerto: 465, urlAplicacion: 'https://serforia.serfor.gob.pe' };

  const sin = crearAlertasCorreo({ config: base, servicio, repo, crearTransporte: () => transporte });
  assert.equal(sin.diagnostico().motivo, 'Falta CORREO_REMITENTE en el .env');
  await assert.rejects(sin.enviar(), /no está configurado/);
  assert.equal(crearAlertasCorreo({ config: { ...base, remitente: 'alertas@serfor.gob.pe' }, servicio, repo }).diagnostico().motivo, 'Falta CORREO_CLAVE (contraseña de aplicación) en el .env');
  assert.match(crearAlertasCorreo({ config: { ...base, remitente: 'alertas@serfor.gob.pe', modo: 'cuenta_servicio', cuentaServicio: path.join(tmp, 'no-existe.json') }, servicio, repo }).diagnostico().motivo, /No se pudo leer el JSON/);

  let opcionesTransporte = null;
  const a = crearAlertasCorreo({ config: { ...base, remitente: 'alertas@serfor.gob.pe', clave: 'abcd efgh ijkl mnop' }, servicio, repo, crearTransporte: (o) => { opcionesTransporte = o; return transporte; } });
  assert.equal(a.diagnostico().configurado, true);
  assert.ok(!JSON.stringify(a.publico()).includes('abcd'), 'la clave no sale por la API');
  // lunes 23/11/2026 (UTC−5): antes de la hora no toca; después sí; sábado no
  assert.equal(await a.tocaEnviar(new Date('2026-11-23T12:00:00Z')), false, '07:00 en Lima');
  assert.equal(await a.tocaEnviar(new Date('2026-11-23T13:00:00Z')), true, '08:00 en Lima');
  assert.equal(await a.tocaEnviar(new Date('2026-11-28T15:00:00Z')), false, 'sábado');
  d.feriados = [{ fecha: '2026-12-08' }];
  assert.equal(await a.tocaEnviar(new Date('2026-12-08T15:00:00Z')), false, 'feriado');

  // prueba: solo al que la pide y sin registrar el envío del día
  const p = await a.enviar({ soloA: 'beto.jefe@serfor.gob.pe' });
  assert.deepEqual(p.enviados, ['beto.jefe@serfor.gob.pe']);
  assert.match(enviados[0].subject, /Prueba/, 'Beto no tiene alertas: recibe el correo de prueba');
  assert.equal(bitacora.length, 0);
  assert.equal(opcionesTransporte.host, 'smtp.gmail.com'); assert.equal(opcionesTransporte.secure, true);

  // envío del día con un destinatario que falla: se registra igual, con el error
  transporte.fallarAdmin = true; enviados.length = 0;
  const r = await a.enviar();
  assert.deepEqual(r.enviados, ['ana.jefe@serfor.gob.pe']);
  assert.equal(r.fallidos[0].para, 'admin@serfor.gob.pe');
  assert.equal(enviados[0].from.address, 'alertas@serfor.gob.pe');
  assert.equal(bitacora.length, 1); assert.equal(bitacora[0].origen, 'SISTEMA');
  const u = await a.ultimoEnvio();
  assert.equal(u.enviados, 1); assert.equal(u.fallidos, 1);
  // ya se envió hoy: el reloj no vuelve a enviar
  const despuesDeLaHora = new Date(`${require('../server/motor/calendario').hoyLima()}T23:30:00Z`); // 18:30 en Lima, el mismo día del envío
  assert.equal(await crearAlertasCorreo({ config: { ...a.publico(), ...base, remitente: 'alertas@serfor.gob.pe', clave: 'x', soloHabiles: false }, servicio, repo, crearTransporte: () => transporte }).tocaEnviar(despuesDeLaHora), false, 'una vez al día');
  // desactivado: nunca toca
  assert.equal(await crearAlertasCorreo({ config: { ...base, activo: false, remitente: 'alertas@serfor.gob.pe', clave: 'x' }, servicio, repo }).tocaEnviar(new Date('2026-11-23T15:00:00Z')), false);
});

/** Reporte mínimo con la forma de construirReporte (sin montos). */
const reporteDe = (mes) => ({ mes, nombre_mes: mes === '2026-11' ? 'noviembre de 2026' : `mes ${mes}`, corte: '2026-11-30', partes_mes: 4, alertas_altas: [{ titulo: 'x' }],
  resumen: { en_curso: 3, semaforo: { ROJO: 1, AMBAR: 1 }, terminados_anio: 2, os_en_ejecucion: 2, os_sin_notificar: 1, entregables_vencidos: 1, entregables_por_vencer: 2, conformidades_fuera_de_plazo: 0, sin_parte: 1 }, montos: null, proyectos: [] });

test('reporte mensual por correo: día hábil, mes anterior y texto sin montos ni nombres', () => {
  assert.equal(mesAnterior('2026-01-05'), '2025-12');
  assert.equal(mesAnterior('2026-12-01'), '2026-11');
  assert.equal(diaHabilDelMes('2026-11', 1), '2026-11-02', 'el 01/11/2026 es domingo');
  assert.equal(diaHabilDelMes('2026-12', 1, ['2026-12-01']), '2026-12-02', 'salta el feriado');
  assert.equal(diaHabilDelMes('2026-12', 3), '2026-12-03');
  const c = correoReporte(reporteDe('2026-11'), { urlAplicacion: 'https://serforia.serfor.gob.pe' });
  assert.equal(c.asunto, 'Reporte mensual de proyectos de la OTI – noviembre de 2026');
  assert.equal(c.archivo, 'reporte-mensual-2026-11.pdf');
  assert.match(c.texto, /Proyectos en curso: 3 \(1 en rojo, 1 en ámbar\)/);
  assert.match(c.texto, /corte al 30\/11\/2026/);
  assert.match(c.html, /href="https:\/\/serforia\.serfor\.gob\.pe"/);
  assert.ok(!/S\/|monto/i.test(c.texto + c.html), 'el correo no lleva montos');
});

test('reporte mensual por correo: programación, una vez por mes, reintento si nadie lo recibió, prueba y bitácora', async () => {
  const d = datos();
  const bitacora = [];
  const servicio = { datos: async () => d, estado: async () => construirEstado(d, { corte: '2026-11-23' }) };
  const repo = {
    listarUsuarios: async () => usuarios,
    listarBitacora: async ({ entidad }) => bitacora.filter((b) => b.entidad === entidad).slice().reverse(),
    registrarBitacora: async (e) => { bitacora.push({ ...e, fecha: new Date().toISOString(), cambios_json: JSON.stringify(e.cambios_json) }); },
  };
  const enviados = [];
  const transporte = { sendMail: async (m) => { if (transporte.fallar) throw new Error('550 rechazado'); enviados.push(m); }, verify: async () => true };
  const correo = crearAlertasCorreo({ config: { activo: false, hora: '07:30', soloHabiles: true, copiaAdmin: true, remitente: 'alertas@serfor.gob.pe', nombre: 'Seguimiento OTI', modo: 'clave', clave: 'x', servidor: 'smtp.gmail.com', puerto: 465, urlAplicacion: 'https://serforia.serfor.gob.pe' }, servicio, repo, crearTransporte: () => transporte });
  const generar = async (mes) => ({ reporte: reporteDe(mes), pdf: Buffer.from('%PDF-1.4 prueba') });
  const base = { activo: true, para: ['gerencia@serfor.gob.pe', 'admin@serfor.gob.pe'], diaHabil: 1, hora: '08:00', montos: false, copiaAdmin: true };

  assert.match(crearReporteCorreo({ config: { ...base, para: ['gerencia@'] }, correo, generar, servicio, repo }).diagnostico().motivo, /no válidos: gerencia@/);
  const sinCuenta = crearAlertasCorreo({ config: { remitente: '' }, servicio, repo });
  assert.equal(crearReporteCorreo({ config: base, correo: sinCuenta, generar, servicio, repo }).diagnostico().motivo, 'Falta CORREO_REMITENTE en el .env');

  const rc = crearReporteCorreo({ config: base, correo, generar, servicio, repo });
  assert.deepEqual(await rc.destinatarios(), ['gerencia@serfor.gob.pe', 'admin@serfor.gob.pe'], 'el Administrador activo no se repite');
  // martes 01/12/2026 es el primer día hábil de diciembre: informa noviembre desde las 08:00 de Lima
  assert.equal(await rc.tocaEnviar(new Date('2026-12-01T12:30:00Z')), false, '07:30 en Lima');
  assert.equal(await rc.tocaEnviar(new Date('2026-12-01T13:05:00Z')), true, '08:05 en Lima');
  assert.equal((await rc.programacion(new Date('2026-12-01T13:05:00Z'))).mes, '2026-11');
  assert.equal(await rc.tocaEnviar(new Date('2026-12-04T20:00:00Z')), true, 'si el servidor estuvo apagado, se envía después');

  // prueba: solo al que la pide, con el PDF y sin registrar
  const p = await rc.enviar({ mes: '2026-11', soloA: 'Admin@serfor.gob.pe' });
  assert.deepEqual(p.enviados, ['admin@serfor.gob.pe']);
  assert.match(enviados[0].subject, /^\[Prueba\] Reporte mensual/);
  assert.equal(enviados[0].attachments[0].filename, 'reporte-mensual-2026-11.pdf');
  assert.equal(enviados[0].attachments[0].contentType, 'application/pdf');
  assert.equal(bitacora.length, 0);

  // envío que nadie recibe: se registra, pero el mes sigue pendiente (se reintenta)
  transporte.fallar = true;
  const f = await rc.enviar({ mes: '2026-11' });
  assert.equal(f.enviados.length, 0); assert.equal(f.fallidos.length, 2);
  assert.equal(bitacora.length, 1);
  assert.equal(await rc.enviadoMes('2026-11'), false);
  assert.equal(await rc.tocaEnviar(new Date('2026-12-02T15:00:00Z')), true);

  // envío correcto: ya no se repite en el mes
  transporte.fallar = false; enviados.length = 0;
  const ok = await rc.enviar({ mes: '2026-11' });
  assert.deepEqual(ok.enviados, ['gerencia@serfor.gob.pe', 'admin@serfor.gob.pe']);
  assert.equal(enviados[0].from.address, 'alertas@serfor.gob.pe');
  assert.equal(bitacora[1].entidad, 'correo_reporte'); assert.equal(bitacora[1].origen, 'SISTEMA');
  assert.equal(JSON.parse(bitacora[1].cambios_json).montos, false);
  assert.equal(await rc.enviadoMes('2026-11'), true);
  assert.equal(await rc.tocaEnviar(new Date('2026-12-02T15:00:00Z')), false, 'una vez por mes');
  const u = await rc.ultimoEnvio();
  assert.equal(u.mes, '2026-11'); assert.equal(u.enviados, 2);
  // desactivado: nunca toca
  assert.equal(await crearReporteCorreo({ config: { ...base, activo: false }, correo, generar, servicio, repo }).tocaEnviar(new Date('2027-01-04T15:00:00Z')), false);
});

test('API del correo de alertas: solo el Administrador; sin configurar, lo informa y no envía', async () => {
  const { crearApp } = require('../server/server');
  const { app } = await crearApp();
  const servidor = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const cliente = () => {
      let cookie = '';
      const llamar = async (metodo, ruta, cuerpo) => {
        const r = await fetch(base + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-SGF': '1', Cookie: cookie }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
        const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
        const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
        return { estado: r.status, cuerpo: j };
      };
      llamar.entrar = async (correo, clave) => { const ing = await llamar('POST', '/api/auth/ingresar', { correo, clave }); if (ing.cuerpo.usuario && ing.cuerpo.usuario.cambiarClave) await llamar('POST', '/api/auth/cambiar-clave', { actual: clave, nueva: `Nueva${Date.now()}x9` }); };
      return llamar;
    };
    const admin = cliente(); await admin.entrar('admin.correo@serfor.gob.pe', 'ClaveCorreo2026xx');
    const r = await admin('GET', '/api/alertas-correo');
    assert.equal(r.estado, 200);
    assert.equal(r.cuerpo.configuracion.configurado, false);
    assert.equal(r.cuerpo.configuracion.activo, false);
    assert.ok(Array.isArray(r.cuerpo.correos));
    assert.ok(r.cuerpo.correos.every((c) => !('html' in c)), 'la vista previa va sin HTML salvo que se pida');
    assert.equal((await admin('POST', '/api/alertas-correo/enviar', {})).estado, 409, 'sin configurar no envía');
    const j = await admin('POST', '/api/usuarios', { correo: 'jefe.correo@serfor.gob.pe', nombre: 'Jefe', rol: 'JEFE_PROYECTO' });
    const jefe = cliente(); await jefe.entrar('jefe.correo@serfor.gob.pe', j.cuerpo.clave_temporal);
    assert.equal((await jefe('GET', '/api/alertas-correo')).estado, 403);
    assert.equal((await jefe('POST', '/api/alertas-correo/enviar', { prueba: true })).estado, 403);
    // reporte mensual por correo: mismo criterio
    const rep = await admin('GET', '/api/reporte-correo');
    assert.equal(rep.estado, 200);
    assert.equal(rep.cuerpo.configuracion.configurado, false);
    assert.equal(rep.cuerpo.configuracion.montos, false, 'sin montos por defecto');
    assert.match(rep.cuerpo.mes, /^\d{4}-\d{2}$/);
    assert.ok(rep.cuerpo.destinatarios.includes('admin.correo@serfor.gob.pe'), 'copia al Administrador');
    assert.equal((await admin('POST', '/api/reporte-correo/enviar', {})).estado, 409, 'sin configurar no envía');
    assert.equal((await admin('POST', '/api/reporte-correo/enviar', { mes: '2026-13' })).estado, 400);
    assert.equal((await jefe('GET', '/api/reporte-correo')).estado, 403);
    assert.equal((await jefe('POST', '/api/reporte-correo/enviar', { prueba: true })).estado, 403);
  } finally { servidor.close(); }
});
