'use strict';
/**
 * Prueba de integración contra SQL Server REAL (Etapas 2 a 5): escrituras en transacción, bitácora, permisos por
 * proyecto dentro de la transacción, concurrencia optimista y reversión. Las demás pruebas usan el repositorio en
 * memoria; esta recorre el mismo flujo con el repositorio de producción.
 *
 * Solo corre si se define PRUEBAS_SQL_BASE (si no, se omite). Por seguridad:
 *   - el nombre de la base debe contener «PRUEBA» o «TEST», y
 *   - debe ser distinto de SQL_BASE del .env (la base de producción).
 * La base debe tener instalados db/01 a db/18 (npm run bd:instalar con SQL_BASE apuntando a ella).
 * Servidor, puerto, usuario y clave salen de PRUEBAS_SQL_SERVIDOR, PRUEBAS_SQL_PUERTO, PRUEBAS_SQL_USUARIO y
 * PRUEBAS_SQL_CLAVE; si no se indican, se usan los del .env. Crea datos de prueba con códigos únicos en cada corrida.
 *
 *   $env:PRUEBAS_SQL_BASE = 'SGF_SEGUIMIENTO_PRUEBAS'; npm run test:sqlserver
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE_PRUEBAS = process.env.PRUEBAS_SQL_BASE || '';
const baseProduccion = (() => {
  try {
    const m = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').match(/^\s*SQL_BASE\s*=\s*["']?([^"'\r\n#]+)/m);
    return m ? m[1].trim() : 'SGF_SEGUIMIENTO';
  } catch { return 'SGF_SEGUIMIENTO'; }
})();
const motivoOmision = !BASE_PRUEBAS ? 'defina PRUEBAS_SQL_BASE para correr la integración con SQL Server'
  : !/PRUEBA|TEST/i.test(BASE_PRUEBAS) ? `la base «${BASE_PRUEBAS}» no parece de pruebas (debe contener PRUEBA o TEST)`
    : BASE_PRUEBAS.toLowerCase() === baseProduccion.toLowerCase() ? 'PRUEBAS_SQL_BASE no puede ser la base del .env (producción)' : null;

const opciones = motivoOmision ? { skip: motivoOmision } : { timeout: 300000 };

let base; let servidor; let crearApp; let crearRepositorioSqlServer; let config; let bcrypt; let aDia; let aFecha; let hoyLima;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('imagen de prueba')]);
const SUFIJO = Date.now().toString(36).toUpperCase();
const letras = () => Array.from({ length: 5 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
const ADMIN = { correo: `admin.integracion.${SUFIJO.toLowerCase()}@prueba.local`, clave: `Integra${SUFIJO}x9` };

if (!motivoOmision) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-sqlserver-'));
  for (const k of ['SERVIDOR', 'PUERTO', 'USUARIO', 'CLAVE', 'CIFRAR', 'CONFIAR_CERTIFICADO']) if (process.env[`PRUEBAS_SQL_${k}`]) process.env[`SQL_${k}`] = process.env[`PRUEBAS_SQL_${k}`];
  Object.assign(process.env, {
    MODO_DATOS: 'sqlserver', SQL_BASE: BASE_PRUEBAS, NODE_ENV: 'test', ANTHROPIC_API_KEY: '',
    DOCUMENTOS_RAIZ: path.join(tmp, 'almacen'), PLANES_PDF_DIR: path.join(tmp, 'planes-pdf'), ADENDAS_PDF_DIR: path.join(tmp, 'adendas-pdf'),
    CONTRATOS_PDF_DIR: path.join(tmp, 'contratos-pdf'), PLANES_ORIGEN_DIR: path.join(tmp, 'planes-origen'), ACTIVIDADES_PDF_DIR: path.join(tmp, 'actividades-pdf'), DOCUMENTOS_DIR: path.join(tmp, 'documentos'),
  });
  ({ crearApp } = require('../server/server'));
  ({ crearRepositorioSqlServer } = require('../server/datos/sqlserver'));
  config = require('../server/config');
  ({ bcrypt } = require('../server/seguridad'));
  ({ aDia, aFecha, hoyLima } = require('../server/motor/calendario'));
}

function cliente() {
  let cookie = '';
  const llamar = async (metodo, ruta, cuerpo) => {
    const r = await fetch(base + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', 'X-SGF': '1', Cookie: cookie }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { estado: r.status, cuerpo: j };
  };
  llamar.entrar = async (correo, clave) => {
    const ing = await llamar('POST', '/api/auth/ingresar', { correo, clave });
    if (ing.cuerpo.usuario && ing.cuerpo.usuario.cambiarClave) await llamar('POST', '/api/auth/cambiar-clave', { actual: clave, nueva: `Nueva${Date.now()}x9` });
    return ing;
  };
  llamar.archivo = async (cuerpo = PDF, nombre = 'documento.pdf', evidencia = false) => {
    const r = await fetch(`${base}/api/documentos/temporales${evidencia ? '?formato=evidencia' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-SGF': '1', 'X-Nombre': encodeURIComponent(nombre), Cookie: cookie }, body: cuerpo });
    const j = await r.json();
    if (!r.ok) throw new Error(`temporal: ${j.error}`);
    return j.token;
  };
  return llamar;
}

/** Conexión directa (solo lectura de comprobación y la cuenta de prueba). */
async function repoDirecto() { return crearRepositorioSqlServer(config.sqlserver); }

test.before(async () => {
  if (motivoOmision) return;
  // Cuenta ADMIN propia de esta corrida (la base de pruebas puede tener ya otras cuentas)
  const repo = await repoDirecto();
  try {
    await repo.crearUsuario({ correo: ADMIN.correo, nombre: 'Administrador de integración', rol: 'ADMIN', clave_hash: await bcrypt.hash(ADMIN.clave, 4), debe_cambiar_clave: 0 });
  } finally { await repo.cerrar(); }
  const { app } = await crearApp();
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => { if (servidor) servidor.close(); });

test('repositorio SQL Server: la transacción revierte todas sus escrituras y su bitácora si algo falla', opciones, async () => {
  const repo = await repoDirecto();
  try {
    const codigo = `PRY-TX-${SUFIJO}`;
    let creado = null;
    await assert.rejects(repo.transaccion(async (t) => {
      creado = await t.crear('proyecto', { codigo, nombre: 'Proyecto que no debe quedar', modalidad: 'ORDEN_SERVICIO', con_profesionales: 1, con_adendas: 0, con_linea_base: 0, con_orden_servicio: 1, con_tdr: 1, estado: 'REGISTRADO' }, { usuario: ADMIN.correo, motivo: 'Prueba de reversión', origen: 'SCRIPT' });
      assert.ok(creado.proyecto_id, 'dentro de la transacción la fila existe');
      throw new Error('falla provocada');
    }), /falla provocada/);
    const d = await repo.cargarTodo();
    assert.ok(!d.proyectos.some((p) => p.codigo === codigo), 'el proyecto no quedó');
    const bit = await repo.listarBitacora({ entidad: 'proyecto', entidad_id: creado.proyecto_id, limite: 10 });
    assert.equal(bit.length, 0, 'ni su bitácora');
  } finally { await repo.cerrar(); }
});

test('flujo completo de la Orden de Servicio contra SQL Server', opciones, async () => {
  const HOY = hoyLima();
  const haceDias = (n) => aFecha(aDia(HOY) - n);
  const admin = cliente();
  assert.equal((await admin.entrar(ADMIN.correo, ADMIN.clave)).estado, 200);
  const jefe = async (n) => {
    const correo = `${n}.${SUFIJO.toLowerCase()}@prueba.local`;
    const r = await admin('POST', '/api/usuarios', { correo, nombre: `Jefe ${n}`, rol: 'JEFE_PROYECTO' });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    const c = cliente(); await c.entrar(correo, r.cuerpo.clave_temporal);
    return { id: r.cuerpo.usuario.usuario_id, c };
  };
  const ana = await jefe('ana'); const beto = await jefe('beto');

  // proyecto OS con equipo
  const p = await admin('POST', '/api/proyectos', { nombre: `Integración SQL Server ${SUFIJO}` });
  assert.equal(p.estado, 200, JSON.stringify(p.cuerpo));
  const pid = p.cuerpo.proyecto_id;
  assert.equal((await admin('POST', `/api/proyectos/${pid}/equipo`, { usuario_id: ana.id, es_responsable: true })).estado, 200);

  // 1. registro (consultor + contrato + entregables en una transacción); fuera del equipo se rechaza y no deja nada
  const clave = letras();
  const datos = {
    clave, nombres: 'Profesional de Integración', perfil: 'Desarrollador', numero: `OS-INT-${SUFIJO}`, monto: 15000.5, plazo_dias: 60,
    entregables: [{ nombre: 'Plan de trabajo', plazo_dias: 10, porcentaje_pago: 20 }, { nombre: 'Informe final', plazo_dias: 60, porcentaje_pago: 80 }],
  };
  const negado = await beto.c('POST', `/api/proyectos/${pid}/contrataciones`, { ...datos, documentos: { TDR: await beto.c.archivo(), ORDEN_SERVICIO: await beto.c.archivo() } });
  assert.equal(negado.estado, 403, JSON.stringify(negado.cuerpo));
  const repo = await repoDirecto();
  try { assert.ok(!(await repo.cargarTodo()).consultores.some((c) => c.clave === clave), 'el 403 dentro de la transacción no deja el consultor'); } finally { await repo.cerrar(); }
  const reg = await ana.c('POST', `/api/proyectos/${pid}/contrataciones`, { ...datos, documentos: { TDR: await ana.c.archivo(), ORDEN_SERVICIO: await ana.c.archivo() } });
  assert.equal(reg.estado, 200, JSON.stringify(reg.cuerpo));
  assert.deepEqual(reg.cuerpo.documentos_pendientes, []);
  const kid = reg.cuerpo.contrato.contrato_id; const cid = reg.cuerpo.consultor.consultor_id;
  assert.equal(reg.cuerpo.contrato.monto, 15000.5, 'DECIMAL ida y vuelta');
  let revision = reg.cuerpo.contrato.revision;

  // 2. corregir entregables: sube la revisión de la OS; la revisión vieja da 409
  const corr = await ana.c('POST', `/api/contratos/${kid}/entregables`, { revision, entregables: [{ nombre: 'Plan de trabajo', plazo_dias: 10, porcentaje_pago: 20 }, { nombre: 'Avance', plazo_dias: 30, porcentaje_pago: 30 }, { nombre: 'Informe final', plazo_dias: 60, porcentaje_pago: 50 }] });
  assert.equal(corr.estado, 200, JSON.stringify(corr.cuerpo));
  assert.equal(corr.cuerpo.revision, revision + 1);
  assert.equal((await ana.c('POST', `/api/contratos/${kid}/entregables`, { revision, entregables: [{ nombre: 'Único', plazo_dias: 60 }] })).estado, 409);
  revision = corr.cuerpo.revision;
  // volver a dos entregables (anula el tercero sin chocar con el índice único)
  const corr2 = await ana.c('POST', `/api/contratos/${kid}/entregables`, { revision, entregables: [{ nombre: 'Plan de trabajo', plazo_dias: 10, porcentaje_pago: 20 }, { nombre: 'Informe final', plazo_dias: 60, porcentaje_pago: 80 }] });
  assert.equal(corr2.estado, 200, JSON.stringify(corr2.cuerpo));
  revision = corr2.cuerpo.revision;

  // 3. notificación (contrato + periodo ORIGINAL + fechas límite + proyecto EN_EJECUCION con origen SISTEMA)
  const fn = haceDias(20);
  const notif = await ana.c('POST', `/api/contratos/${kid}/notificacion`, { fecha_notificacion: fn, medio_notificacion: 'CORREO', documento: await ana.c.archivo(), revision });
  assert.equal(notif.estado, 200, JSON.stringify(notif.cuerpo));
  assert.equal(notif.cuerpo.inicio, haceDias(19));
  assert.equal((await admin('GET', '/api/proyectos')).cuerpo.find((x) => x.proyecto_id === pid).estado, 'EN_EJECUCION');
  // corrección de la notificación con motivo
  const k1 = (await ana.c('GET', `/api/contratos/${kid}/entregables`)).cuerpo.contrato;
  const cor = await ana.c('POST', `/api/contratos/${kid}/notificacion`, { fecha_notificacion: haceDias(18), medio_notificacion: 'MESA_PARTES', motivo: 'El cargo tiene otra fecha', revision: k1.revision });
  assert.equal(cor.estado, 200, JSON.stringify(cor.cuerpo));

  // 4. plan aprobado y parte diario (parte + ítems + avance de actividades en una transacción; evidencia al almacén)
  const ents = (await ana.c('GET', `/api/contratos/${kid}/entregables`)).cuerpo.entregables;
  const [e1, e2] = ents;
  assert.equal((await admin('GET', `/api/formulacion/${cid}`)).estado, 200);
  const a1 = (await admin('POST', `/api/formulacion/${cid}/actividades`, { descripcion: 'Elaborar el plan de trabajo', producto: 'Plan aprobado', dias_plan: 5, entregable_servicio_id: e1.entregable_servicio_id })).cuerpo;
  const a2 = (await admin('POST', `/api/formulacion/${cid}/actividades`, { descripcion: 'Desarrollar el sistema', dias_plan: 20, entregable_servicio_id: e2.entregable_servicio_id, subactividades: [{ t: 'Módulo A', d: 10, p: 'Código' }, { t: 'Módulo B', d: 10, p: 'Código' }] })).cuerpo;
  assert.ok(a1.actividad_id && a2.actividad_id, JSON.stringify({ a1, a2 }));
  for (const accion of ['ENVIAR', 'APROBAR_JEFE', 'APROBAR']) assert.equal((await admin('POST', `/api/formulacion/${cid}/transicion`, { accion, comentario: 'Conforme' })).estado, 200, accion);
  const parte = (c, cuerpo) => c('POST', `/api/proyectos/${pid}/partes`, cuerpo);
  const basico = { consultor_id: cid, fecha: HOY, descripcion: 'Avance del plan de trabajo y del módulo A' };
  assert.equal((await parte(beto.c, { ...basico, items: [{ actividad_id: a1.actividad_id, avance: 50 }] })).estado, 403);
  const ok = await parte(ana.c, { ...basico, items: [{ actividad_id: a1.actividad_id, avance: 50 }, { actividad_id: a2.actividad_id, subactividad_indice: 0, avance: 100 }], evidencias: [await ana.c.archivo(PNG, 'pantalla.png', true)] });
  assert.equal(ok.estado, 200, JSON.stringify(ok.cuerpo));
  assert.equal(ok.cuerpo.items.length, 2);
  assert.equal(ok.cuerpo.evidencias.length, 1);
  const rect = await parte(ana.c, { ...basico, descripcion: 'Corrección del avance del plan de trabajo', rectifica_parte_id: ok.cuerpo.parte_id, items: [{ actividad_id: a1.actividad_id, avance: 40, comentario: 'Se contó una sección no terminada' }] });
  assert.equal(rect.estado, 200, JSON.stringify(rect.cuerpo));
  const partes = (await ana.c('GET', `/api/proyectos/${pid}/partes?consultor_id=${cid}`)).cuerpo;
  assert.equal(partes.length, 2);
  assert.deepEqual(partes.find((x) => x.parte_id === ok.cuerpo.parte_id).rectificado_por, [rect.cuerpo.parte_id]);
  const det = (await ana.c('GET', `/api/consultores/${cid}`)).cuerpo;
  assert.equal(Number(det.actividades.find((x) => x.actividad_id === a1.actividad_id).avance), 40);

  // 5. entregables: presentar → observar → subsanar → conformidad; el último culmina la OS y concluye el proyecto
  const leer = async (id) => (await ana.c('GET', `/api/contratos/${kid}/entregables`)).cuerpo.entregables.find((x) => x.entregable_servicio_id === id);
  let x1 = await leer(e1.entregable_servicio_id);
  assert.equal((await ana.c('POST', `/api/entregables/${x1.entregable_servicio_id}/presentar`, { fecha: haceDias(3), documento: await ana.c.archivo(), revision: x1.revision })).estado, 200);
  x1 = await leer(e1.entregable_servicio_id);
  assert.equal((await ana.c('POST', `/api/entregables/${x1.entregable_servicio_id}/observar`, { fecha: haceDias(2), observacion: 'Falta el cronograma por semana', plazo_subsanacion_dias: 3, revision: x1.revision })).estado, 200);
  x1 = await leer(e1.entregable_servicio_id);
  assert.equal((await ana.c('POST', `/api/entregables/${x1.entregable_servicio_id}/presentar`, { fecha: haceDias(1), documento: await ana.c.archivo(), revision: x1.revision })).estado, 200, 'subsanación');
  x1 = await leer(e1.entregable_servicio_id);
  assert.equal((await ana.c('POST', `/api/entregables/${x1.entregable_servicio_id}/conformidad`, { fecha: HOY, conformidad_ref: 'Informe N.° 001-2026-OTI', revision: x1.revision + 5 })).estado, 409, 'revisión vieja');
  assert.equal((await ana.c('POST', `/api/entregables/${x1.entregable_servicio_id}/conformidad`, { fecha: HOY, conformidad_ref: 'Informe N.° 001-2026-OTI', revision: x1.revision })).estado, 200);
  let x2 = await leer(e2.entregable_servicio_id);
  assert.equal((await ana.c('POST', `/api/entregables/${x2.entregable_servicio_id}/presentar`, { fecha: HOY, documento: await ana.c.archivo(), revision: x2.revision })).estado, 200);
  x2 = await leer(e2.entregable_servicio_id);
  const conf = await ana.c('POST', `/api/entregables/${x2.entregable_servicio_id}/conformidad`, { fecha: HOY, conformidad_ref: 'Informe N.° 002-2026-OTI', documento: await ana.c.archivo(), revision: x2.revision });
  assert.equal(conf.estado, 200, JSON.stringify(conf.cuerpo));
  assert.equal(conf.cuerpo.os_culminada, true);
  assert.equal(conf.cuerpo.proyecto_concluido, true);
  assert.equal((await admin('GET', '/api/proyectos')).cuerpo.find((x) => x.proyecto_id === pid).estado, 'CONCLUIDO');
  const est = (await ana.c('GET', `/api/estado?proyecto_id=${pid}`)).cuerpo;
  assert.ok(!est.alertas.some((a) => /^VIGENCIA_/.test(a.codigo)), 'OS culminada: sin alertas de vencimiento');

  // 6. cierre formal por el equipo (operación CIERRE en permisos.js)
  const ev = (await ana.c('GET', `/api/proyectos/${pid}/cierre`)).cuerpo;
  assert.equal(ev.puede_cerrar, true, JSON.stringify(ev.requisitos));
  const lecciones = 'La notificación oportuna y los partes diarios permitieron detectar a tiempo el atraso del primer entregable.';
  assert.equal((await beto.c('POST', `/api/proyectos/${pid}/cierre`, { lecciones_aprendidas: lecciones, revision: ev.proyecto.revision, informe: await beto.c.archivo() })).estado, 403);
  const cerr = await ana.c('POST', `/api/proyectos/${pid}/cierre`, { lecciones_aprendidas: lecciones, revision: ev.proyecto.revision, informe: await ana.c.archivo() });
  assert.equal(cerr.estado, 200, JSON.stringify(cerr.cuerpo));
  assert.equal((await ana.c('GET', `/api/proyectos/${pid}/cierre`)).cuerpo.proyecto.estado, 'CERRADO');

  // 7. bitácora: cada paso dejó su registro, con el monto visible solo para el equipo
  const bit = (await admin('GET', `/api/bitacora?consultor_id=${cid}&limite=500`)).cuerpo;
  for (const entidad of ['consultor', 'contrato', 'entregable_servicio', 'adenda', 'parte_diario', 'parte_diario_item', 'actividad']) assert.ok(bit.some((b) => b.entidad === entidad), `bitácora de ${entidad}`);
  assert.ok(!/15000\.5/.test(JSON.stringify((await beto.c('GET', `/api/bitacora?consultor_id=${cid}&limite=500`)).cuerpo)), 'un Jefe ajeno no ve el monto');
  // bitácora filtrada por proyecto (subconsultas en SQL Server): incluye la ficha, el equipo y los documentos del proyecto
  const bp = (await admin('GET', `/api/bitacora?proyecto_id=${pid}&limite=1000`)).cuerpo;
  for (const entidad of ['proyecto', 'proyecto_miembro', 'documento', 'contrato', 'parte_diario']) assert.ok(bp.some((b) => b.entidad === entidad), `bitácora del proyecto: ${entidad}`);
  assert.ok(bp.every((b) => !b.consultor_id || b.consultor_id === cid), 'solo su profesional');
});

test('anulación, resolución, tablero general y reporte mensual contra SQL Server', opciones, async () => {
  const HOY = hoyLima();
  const haceDias = (n) => aFecha(aDia(HOY) - n);
  const admin = cliente();
  assert.equal((await admin.entrar(ADMIN.correo, ADMIN.clave)).estado, 200);
  const p = (await admin('POST', '/api/proyectos', { nombre: `Integración término anticipado ${SUFIJO}` })).cuerpo;
  const pid = p.proyecto_id;
  const registrar = async (n) => {
    const r = await admin('POST', `/api/proyectos/${pid}/contrataciones`, {
      clave: letras(), nombres: `Profesional ${n} de integración`, numero: `OS-${n}-${SUFIJO}`, monto: 9000, plazo_dias: 30,
      entregables: [{ nombre: 'Informe único', plazo_dias: 30, porcentaje_pago: 100 }], documentos: { TDR: await admin.archivo(), ORDEN_SERVICIO: await admin.archivo() },
    });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    return r.cuerpo;
  };
  // anular una OS sin notificar
  const a = await registrar('ANU');
  const an = await admin('POST', `/api/contratos/${a.contrato.contrato_id}/anular`, { motivo: 'El profesional desistió del servicio', revision: a.contrato.revision });
  assert.equal(an.estado, 200, JSON.stringify(an.cuerpo));
  // resolver una OS notificada (anula sus entregables y concluye el proyecto)
  const b = await registrar('RES');
  const kb = b.contrato.contrato_id;
  const nb = await admin('POST', `/api/contratos/${kb}/notificacion`, { fecha_notificacion: haceDias(10), medio_notificacion: 'CORREO', documento: await admin.archivo(), revision: b.contrato.revision });
  assert.equal(nb.estado, 200, JSON.stringify(nb.cuerpo));
  const amp = await admin('POST', `/api/contratos/${kb}/ampliacion`, { plazo_dias: 15, documento_ref: 'Carta N.° 010-2026', motivo: 'Demora en accesos', revision: nb.cuerpo.contrato.revision });
  assert.equal(amp.estado, 200, JSON.stringify(amp.cuerpo));
  const res = await admin('POST', `/api/contratos/${kb}/resolver`, { fecha: HOY, documento_ref: 'Carta N.° 077-2026-OGA', motivo: 'Incumplimiento del plazo del entregable', documento: await admin.archivo(), revision: amp.cuerpo.contrato.revision });
  assert.equal(res.estado, 200, JSON.stringify(res.cuerpo));
  assert.equal(res.cuerpo.proyecto_concluido, true);

  // tablero general, CSV y reporte mensual leen la base real
  const port = await admin('GET', '/api/portafolio');
  assert.equal(port.estado, 200, JSON.stringify(port.cuerpo).slice(0, 300));
  const f = port.cuerpo.proyectos.find((x) => x.proyecto_id === pid);
  assert.equal(f.estado, 'CONCLUIDO');
  assert.equal(f.monto_comprometido, 9000, 'la OS resuelta cuenta; la anulada no');
  const csv = await admin('GET', '/api/portafolio.csv');
  assert.equal(csv.estado, 200);
  const rep = await admin('GET', `/api/reportes/mensual?mes=${HOY.slice(0, 7)}`);
  assert.equal(rep.estado, 200, JSON.stringify(rep.cuerpo).slice(0, 300));
  const pdf = await admin('GET', `/api/reportes/mensual.pdf?mes=${HOY.slice(0, 7)}`);
  assert.equal(pdf.estado, 200);
  assert.ok(String(pdf.cuerpo).startsWith('%PDF'), 'el reporte se genera en PDF');
});

test('concurrencia en SQL Server: operaciones simultáneas terminan en 200 o 409, sin bloqueos ni errores 500', opciones, async () => {
  const HOY = hoyLima();
  const haceDias = (n) => aFecha(aDia(HOY) - n);
  const admin = cliente();
  assert.equal((await admin.entrar(ADMIN.correo, ADMIN.clave)).estado, 200);
  const pid = (await admin('POST', '/api/proyectos', { nombre: `Integración concurrencia ${SUFIJO}` })).cuerpo.proyecto_id;
  const registrar = async (n) => {
    const r = await admin('POST', `/api/proyectos/${pid}/contrataciones`, {
      clave: letras(), nombres: `Profesional ${n} concurrente`, numero: `OS-C${n}-${SUFIJO}`, monto: 5000, plazo_dias: 30,
      entregables: [{ nombre: 'Informe único', plazo_dias: 30 }], documentos: { TDR: await admin.archivo(), ORDEN_SERVICIO: await admin.archivo() },
    });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    return r.cuerpo;
  };
  const os = [];
  for (const n of [1, 2, 3, 4]) os.push(await registrar(n));
  // cuatro notificaciones a la vez (cada una cambia contrato, periodo, entregables y, la primera, el proyecto)
  const docs = await Promise.all(os.map(() => admin.archivo()));
  const notifs = await Promise.all(os.map((o, i) => admin('POST', `/api/contratos/${o.contrato.contrato_id}/notificacion`, { fecha_notificacion: haceDias(5), medio_notificacion: 'CORREO', documento: docs[i], revision: o.contrato.revision })));
  const estados = notifs.map((r) => r.estado);
  assert.ok(estados.every((s) => s === 200 || s === 409), `notificaciones: ${JSON.stringify(notifs.map((r) => [r.estado, r.cuerpo && r.cuerpo.error]))}`);
  assert.ok(estados.includes(200));
  // la misma OS notificada dos veces a la vez con la misma revisión: una gana y la otra recibe 409
  const otra = await registrar(5);
  const [d1, d2] = [await admin.archivo(), await admin.archivo()];
  const dobles = await Promise.all([d1, d2].map((d) => admin('POST', `/api/contratos/${otra.contrato.contrato_id}/notificacion`, { fecha_notificacion: haceDias(3), medio_notificacion: 'CORREO', documento: d, revision: otra.contrato.revision })));
  assert.deepEqual(dobles.map((r) => r.estado).sort(), [200, 409], JSON.stringify(dobles.map((r) => [r.estado, r.cuerpo && r.cuerpo.error])));
  // partes diarios simultáneos de profesionales distintos
  const notificadas = os.filter((o, i) => notifs[i].estado === 200);
  const partes = await Promise.all(notificadas.map((o) => admin('POST', `/api/proyectos/${pid}/partes`, { consultor_id: o.consultor.consultor_id, fecha: HOY, descripcion: 'Parte registrado en paralelo con otros' })));
  assert.ok(partes.every((r) => r.estado === 200), JSON.stringify(partes.map((r) => [r.estado, r.cuerpo && r.cuerpo.error])));
});
