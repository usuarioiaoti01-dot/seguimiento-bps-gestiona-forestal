'use strict';
/**
 * Etapa 2 de PLAN_DE_MEJORAS.md: modalidad del proyecto (db/16) y contrataciones por Orden de Servicio con
 * notificación y entregables (db/17). Decisiones D1, D2, D4, D5 y D6.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-etapa2-'));
Object.assign(process.env, {
  MODO_DATOS: 'memoria', ARCHIVO_DEMO: path.join(tmp, 'demo.json'), DOCUMENTOS_RAIZ: path.join(tmp, 'almacen'),
  PLANES_PDF_DIR: path.join(tmp, 'planes-pdf'), ADENDAS_PDF_DIR: path.join(tmp, 'adendas-pdf'), CONTRATOS_PDF_DIR: path.join(tmp, 'contratos-pdf'),
  PLANES_ORIGEN_DIR: path.join(tmp, 'planes-origen'), ACTIVIDADES_PDF_DIR: path.join(tmp, 'actividades-pdf'), DOCUMENTOS_DIR: path.join(tmp, 'documentos'),
  ADMIN_CORREO: 'admin.etapa2@serfor.gob.pe', ADMIN_CLAVE_INICIAL: 'ClaveEtapa2x2026', ANTHROPIC_API_KEY: '',
});
const { crearApp } = require('../server/server');
const { construirEstado } = require('../server/motor/estado');
const { aDia, aFecha, hoyLima } = require('../server/motor/calendario');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const HOY = hoyLima();
const haceDias = (n) => aFecha(aDia(HOY) - n);
let base; let servidor; let admin;

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
  /** Sube un PDF temporal y devuelve su ficha (token). */
  llamar.pdf = async (cuerpo = PDF, nombre = 'documento.pdf') => {
    const r = await fetch(`${base}/api/documentos/temporales`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-SGF': '1', 'X-Nombre': encodeURIComponent(nombre), Cookie: cookie }, body: cuerpo });
    return { estado: r.status, cuerpo: await r.json() };
  };
  llamar.cookie = () => cookie;
  return llamar;
}

test.before(async () => {
  const { app } = await crearApp();
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
  admin = cliente();
  assert.equal((await admin.entrar('admin.etapa2@serfor.gob.pe', 'ClaveEtapa2x2026')).estado, 200);
});
test.after(() => servidor.close());

test('motor: alerta de Orden de Servicio registrada sin notificar', () => {
  const datos = {
    proyectos: [{ proyecto_id: 9, codigo: 'PRY-X', modalidad: 'ORDEN_SERVICIO', con_orden_servicio: 1 }],
    consultores: [{ consultor_id: 1, clave: 'ABC', nombres: 'Ana Belén Cruz', proyecto_id: 9, activo: 1 }],
    contratos: [{ contrato_id: 1, consultor_id: 1, numero: 'OS-1', tipo_documento: 'ORDEN_SERVICIO', estado_contratacion: 'REGISTRADA', fecha_registro: '2026-11-10', activo: 1 }],
    adendas: [], planes: [], actividades: [], dependencias: [], linea_base: [], controles_cambio: [], feriados: [], parametros: [],
    entregables_servicio: [{ entregable_servicio_id: 1, contrato_id: 1, numero: 1, nombre: 'Informe', plazo_dias: 30, estado: 'PENDIENTE', fecha_limite: null, activo: 1 }],
  };
  const pocos = construirEstado(datos, { corte: '2026-11-12' });
  assert.ok(!pocos.alertas.some((a) => a.codigo === 'OS_SIN_NOTIFICAR'), 'aún dentro del umbral (5 días)');
  const e = construirEstado(datos, { corte: '2026-11-24' });
  const a = e.alertas.find((x) => x.codigo === 'OS_SIN_NOTIFICAR');
  assert.ok(a && a.prioridad === 'MEDIA' && /hace 14 días/.test(a.titulo));
  assert.equal(e.consultores[0].vigencia.semaforo, 'GRIS', 'sin notificación no corre el plazo');
  assert.equal(e.consultores[0].entregables[0].semaforo, 'GRIS');
  assert.equal(e.entregables.os_sin_notificar, 1);
});

test('modalidad del proyecto: ORDEN_SERVICIO por defecto; el caso atípico exige motivo; GF2026 es atípico', async () => {
  const mods = (await admin('GET', '/api/modalidades')).cuerpo;
  assert.deepEqual(mods.modalidades.map((m) => m.codigo), ['ORDEN_SERVICIO', 'CONTRATO_ADENDAS', 'GESTION_INTERNA']);
  const gf = (await admin('GET', '/api/proyectos')).cuerpo.find((p) => p.codigo === 'GF2026');
  assert.equal(gf.modalidad, 'CONTRATO_ADENDAS'); assert.equal(gf.es_atipico, 1); assert.equal(gf.estado, 'EN_EJECUCION');
  assert.match(gf.motivo_atipico, /Gestiona Forestal/);

  const p = await admin('POST', '/api/proyectos', { nombre: 'Sistema de trámite documental', unidad_usuaria: 'Oficina de Atención al Ciudadano', objetivo: 'Digitalizar el trámite', con_adendas: 1, motivo_atipico: 'Contrato con adendas heredado de otra unidad' });
  assert.equal(p.estado, 200, JSON.stringify(p.cuerpo));
  assert.equal(p.cuerpo.modalidad, 'CONTRATO_ADENDAS', 'por compatibilidad, la modalidad se deduce de las características enviadas…');
  assert.equal((await admin('POST', '/api/proyectos', { nombre: 'Proyecto atípico sin motivo', modalidad: 'CONTRATO_ADENDAS' })).estado, 400);
  const nuevo = await admin('POST', '/api/proyectos', { nombre: 'Plataforma de datos abiertos', unidad_usuaria: 'Dirección General de Información' });
  assert.equal(nuevo.cuerpo.modalidad, 'ORDEN_SERVICIO', '…pero sin ellas es ORDEN_SERVICIO');
  assert.equal(nuevo.cuerpo.estado, 'REGISTRADO');
  assert.deepEqual([nuevo.cuerpo.con_profesionales, nuevo.cuerpo.con_adendas, nuevo.cuerpo.con_linea_base, nuevo.cuerpo.con_orden_servicio, nuevo.cuerpo.con_tdr], [1, 0, 0, 1, 1], 'las características se derivan');
  // las características no se eligen a mano
  const ed = await admin('PATCH', `/api/proyectos/${nuevo.cuerpo.proyecto_id}`, { con_adendas: 1, estado: 'ACTIVO', revision: nuevo.cuerpo.revision });
  assert.equal(ed.estado, 400, 'ACTIVO ya no es un estado válido');
  const ed2 = await admin('PATCH', `/api/proyectos/${nuevo.cuerpo.proyecto_id}`, { con_adendas: 1, revision: nuevo.cuerpo.revision });
  assert.equal(ed2.cuerpo.fila.con_adendas, 0);
  const gi = await admin('POST', '/api/proyectos', { nombre: 'Renovación de equipos de red', modalidad: 'GESTION_INTERNA' });
  assert.equal(gi.cuerpo.con_profesionales, 0);
});

test('Orden de Servicio: registro con TDR, OS, monto y entregables; notificación; corrección; ampliación; nueva OS', async () => {
  const nuevoJefe = async (correo, nombre) => { const r = await admin('POST', '/api/usuarios', { correo, nombre, rol: 'JEFE_PROYECTO' }); const c = cliente(); await c.entrar(correo, r.cuerpo.clave_temporal); return { id: r.cuerpo.usuario.usuario_id, c }; };
  const ana = await nuevoJefe('ana.os@serfor.gob.pe', 'Ana Supervisión');
  const beto = await nuevoJefe('beto.os@serfor.gob.pe', 'Beto Lectura');
  const p = (await admin('POST', '/api/proyectos', { nombre: 'Sistema de gestión de expedientes', unidad_usuaria: 'Secretaría General' })).cuerpo;
  assert.equal((await admin('POST', `/api/proyectos/${p.proyecto_id}/equipo`, { usuario_id: ana.id, es_responsable: true })).estado, 200);
  const pid = p.proyecto_id;

  // el registro antiguo (con fechas a mano) ya no aplica a esta modalidad
  assert.equal((await ana.c('POST', `/api/proyectos/${pid}/profesionales`, { clave: 'OLD', nombres: 'Registro Antiguo', contrato_numero: 'X-1', adenda_inicio: '2026-11-01', adenda_plazo_dias: 30 })).estado, 409);

  // PDF temporales
  assert.equal((await ana.c.pdf(Buffer.from('no es un pdf'))).estado, 400);
  const tdr = (await ana.c.pdf(PDF, 'TDR desarrollador.pdf')).cuerpo.token;
  const osPdf = (await ana.c.pdf(Buffer.concat([PDF, Buffer.from('%os')]), 'OS 0123-2026.pdf')).cuerpo.token;
  const datos = {
    clave: 'MQR', nombres: 'María Quispe Rojas', perfil: 'Desarrolladora full stack', numero: 'OS-0123-2026', expediente: 'EXP-123', titulo_tdr: 'Desarrollo del módulo de expedientes',
    monto: 18000, plazo_dias: 60,
    entregables: [{ nombre: 'Plan de trabajo', plazo_dias: 15, porcentaje_pago: 20 }, { nombre: 'Módulo de registro', plazo_dias: 40, porcentaje_pago: 40 }, { nombre: 'Informe final', plazo_dias: 60, porcentaje_pago: 40 }],
    documentos: { TDR: tdr, ORDEN_SERVICIO: osPdf },
  };
  const reg = (c, cuerpo) => c('POST', `/api/proyectos/${pid}/contrataciones`, cuerpo);
  assert.equal((await reg(ana.c, { ...datos, documentos: { ORDEN_SERVICIO: osPdf } })).estado, 400, 'sin TDR no se registra');
  assert.equal((await reg(ana.c, { ...datos, monto: undefined })).estado, 400, 'el monto es obligatorio (D4)');
  assert.equal((await reg(ana.c, { ...datos, entregables: [{ nombre: 'Informe', plazo_dias: 90 }] })).estado, 400, 'el entregable no puede superar el plazo');
  assert.equal((await reg(beto.c, datos)).estado, 400, 'los PDF temporales son de quien los subió');
  const tdrB = (await beto.c.pdf()).cuerpo.token; const osB = (await beto.c.pdf()).cuerpo.token;
  assert.equal((await reg(beto.c, { ...datos, documentos: { TDR: tdrB, ORDEN_SERVICIO: osB } })).estado, 403, 'fuera del equipo no registra');
  const r = await reg(ana.c, datos);
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
  assert.equal(r.cuerpo.contrato.estado_contratacion, 'REGISTRADA');
  assert.equal(r.cuerpo.contrato.fecha_inicio ?? null, null, 'sin notificación no hay fechas (D6)');
  assert.equal(r.cuerpo.entregables.length, 3);
  assert.ok(r.cuerpo.documentos.TDR && r.cuerpo.documentos.ORDEN_SERVICIO);
  assert.deepEqual(r.cuerpo.documentos_pendientes, []);
  const kid = r.cuerpo.contrato.contrato_id; const cid = r.cuerpo.consultor.consultor_id;
  let revision = r.cuerpo.contrato.revision;

  let lista = (await ana.c('GET', `/api/proyectos/${pid}/profesionales`)).cuerpo;
  assert.equal(lista[0].situacion, 'SIN_NOTIFICAR');
  assert.equal(lista[0].monto, 18000, 'el equipo ve el monto');
  assert.equal((await beto.c('GET', `/api/proyectos/${pid}/profesionales`)).cuerpo[0].monto, undefined, 'un Jefe ajeno no ve el monto');
  assert.equal((await beto.c('GET', `/api/consultores/${cid}`)).cuerpo.contrato.monto, undefined);
  assert.ok(!/18000/.test(JSON.stringify((await beto.c('GET', `/api/bitacora?consultor_id=${cid}`)).cuerpo)), 'ni en la bitácora');
  assert.ok(/18000/.test(JSON.stringify((await ana.c('GET', `/api/bitacora?consultor_id=${cid}`)).cuerpo)));
  assert.equal((await ana.c('GET', '/api/proyectos')).cuerpo.find((x) => x.proyecto_id === pid).estado, 'REGISTRADO');

  // corregir entregables antes de notificar
  const corr = await ana.c('POST', `/api/contratos/${kid}/entregables`, { revision, entregables: [{ nombre: 'Plan de trabajo', plazo_dias: 10, porcentaje_pago: 20 }, { nombre: 'Informe final', plazo_dias: 60, porcentaje_pago: 80 }] });
  assert.equal(corr.estado, 200, JSON.stringify(corr.cuerpo));
  assert.equal(corr.cuerpo.revision, revision + 1, 'corregir los entregables sube la revisión de la OS (raíz del agregado)');
  const vieja = await ana.c('POST', `/api/contratos/${kid}/entregables`, { revision, entregables: [{ nombre: 'Informe final', plazo_dias: 60 }] });
  assert.equal(vieja.estado, 409, 'otro reemplazo con la revisión anterior se rechaza');
  revision = corr.cuerpo.revision;
  assert.equal((await ana.c('GET', `/api/contratos/${kid}/entregables`)).cuerpo.entregables.length, 2);

  // la edición genérica del contrato no toca los datos de la contratación (solo los flujos de la OS)
  const patch = await ana.c('PATCH', `/api/contratos/${kid}`, { revision, estado_contratacion: 'CULMINADA', monto: -5, fecha_notificacion: haceDias(3), expediente: 'EXP-123-B' });
  assert.equal(patch.estado, 200, JSON.stringify(patch.cuerpo));
  assert.equal(patch.cuerpo.fila.estado_contratacion, 'REGISTRADA');
  assert.equal(patch.cuerpo.fila.monto, 18000);
  assert.equal(patch.cuerpo.fila.fecha_notificacion ?? null, null);
  assert.equal(patch.cuerpo.fila.expediente, 'EXP-123-B');
  revision = patch.cuerpo.fila.revision;

  // notificación: vista previa, validaciones y registro
  const fn = haceDias(12);
  const prev = await ana.c('POST', `/api/contratos/${kid}/notificacion/previsualizar`, { fecha_notificacion: fn });
  assert.equal(prev.cuerpo.inicio, haceDias(11));
  assert.equal(prev.cuerpo.fin, aFecha(aDia(fn) + 60));
  assert.deepEqual(prev.cuerpo.entregables.map((x) => x.fecha_limite), [aFecha(aDia(fn) + 10), aFecha(aDia(fn) + 60)]);
  const notif = (c, cuerpo) => c('POST', `/api/contratos/${kid}/notificacion`, cuerpo);
  assert.equal((await notif(ana.c, { fecha_notificacion: aFecha(aDia(HOY) + 1), medio_notificacion: 'CORREO', documento: (await ana.c.pdf()).cuerpo.token, revision })).estado, 400, 'no puede ser futura');
  assert.equal((await notif(ana.c, { fecha_notificacion: fn, medio_notificacion: 'CORREO', revision })).estado, 400, 'exige el cargo de notificación');
  assert.equal((await notif(ana.c, { fecha_notificacion: fn, medio_notificacion: 'PALOMA', documento: (await ana.c.pdf()).cuerpo.token, revision })).estado, 400);
  assert.equal((await notif(beto.c, { fecha_notificacion: fn, medio_notificacion: 'CORREO', documento: (await beto.c.pdf()).cuerpo.token, revision })).estado, 403);
  const ok = await notif(ana.c, { fecha_notificacion: fn, medio_notificacion: 'CORREO', documento: (await ana.c.pdf(PDF, 'cargo.pdf')).cuerpo.token, revision });
  assert.equal(ok.estado, 200, JSON.stringify(ok.cuerpo));
  assert.equal(ok.cuerpo.inicio, haceDias(11));
  revision = ok.cuerpo.contrato.revision;
  lista = (await ana.c('GET', `/api/proyectos/${pid}/profesionales`)).cuerpo;
  assert.equal(lista[0].estado_contratacion, 'EN_EJECUCION');
  assert.equal(lista[0].fin_vigencia, aFecha(aDia(fn) + 60), 'la vigencia es el fin de la OS');
  assert.equal(lista[0].situacion, 'VIGENTE');
  assert.ok(lista[0].notificacion.existe);
  assert.deepEqual([lista[0].entregables.proximo.numero, lista[0].entregables.proximo.semaforo], [1, 'ROJO'], 'el primero ya venció sin presentarse: es el que se muestra primero');
  assert.equal((await ana.c('GET', '/api/proyectos')).cuerpo.find((x) => x.proyecto_id === pid).estado, 'EN_EJECUCION', 'el proyecto inicia con su primera notificación');
  const est = (await ana.c('GET', `/api/estado?proyecto_id=${pid}`)).cuerpo;
  assert.ok(est.alertas.some((a) => a.codigo === 'ENTREGABLE_VENCIDO' && a.prioridad === 'ALTA'), 'el entregable 1 (10 días) ya venció sin presentarse');
  assert.equal(est.resumen_entregables.vencidos, 1);
  const docs = (await ana.c('GET', `/api/documentos?entidad=contrato&entidad_id=${kid}`)).cuerpo;
  assert.deepEqual(docs.map((d) => d.tipo).sort(), ['NOTIFICACION', 'ORDEN_SERVICIO', 'TDR']);
  assert.ok(docs.find((d) => d.tipo === 'NOTIFICACION').confidencial);
  // D3: el profesional con cuenta ve en su ficha su OS y sus entregables, sin el monto; no accede a la gestión
  const cuenta = await admin('POST', '/api/usuarios', { correo: 'mqr.os@serfor.gob.pe', nombre: 'María Quispe Rojas', rol: 'PROFESIONAL', consultor_id: cid });
  const prof = cliente(); await prof.entrar('mqr.os@serfor.gob.pe', cuenta.cuerpo.clave_temporal);
  const ficha = (await prof('GET', `/api/consultores/${cid}`)).cuerpo;
  assert.equal(ficha.entregables.length, 2);
  assert.ok(ficha.entregables.every((x) => x.fecha_limite && x.semaforo), 'con fecha límite y semáforo calculados en el servidor');
  assert.equal(ficha.contrato.estado_contratacion, 'EN_EJECUCION');
  assert.ok(!('monto' in ficha.contrato) && ficha.contrataciones.every((x) => !('monto' in x)), 'sin el monto (D4)');
  assert.equal((await prof('GET', `/api/contratos/${kid}/entregables`)).estado, 403);
  assert.equal((await ana.c('POST', `/api/contratos/${kid}/entregables`, { entregables: [{ nombre: 'Otro', plazo_dias: 60 }] })).estado, 409, 'notificada, los entregables ya no se cambian así');
  // el periodo ORIGINAL de la OS no se edita como una adenda
  const original = (await ana.c('GET', `/api/adendas?proyecto_id=${pid}`)).cuerpo.find((a) => a.contrato_id === kid && a.tipo_periodo === 'ORIGINAL');
  assert.ok(original);
  assert.equal((await ana.c('PATCH', `/api/adendas/${original.adenda_id}`, { fecha_fin: HOY, revision: original.revision })).estado, 409);
  assert.equal((await ana.c('PATCH', `/api/adendas/${original.adenda_id}`, { observacion: 'Nota de la supervisión', revision: original.revision })).estado, 200, 'otros campos sí');

  // corregir la fecha de notificación exige motivo y recalcula todo
  const k1 = (await ana.c('GET', `/api/contratos/${kid}/entregables`)).cuerpo.contrato;
  const sinMotivo = await notif(ana.c, { fecha_notificacion: haceDias(5), medio_notificacion: 'CORREO', revision: k1.revision });
  assert.equal(sinMotivo.estado, 400); assert.equal(sinMotivo.cuerpo.requiereMotivo, true);
  const cor = await notif(ana.c, { fecha_notificacion: haceDias(5), medio_notificacion: 'MESA_PARTES', motivo: 'El cargo de mesa de partes tiene otra fecha', revision: k1.revision });
  assert.equal(cor.estado, 200, JSON.stringify(cor.cuerpo));
  assert.equal(cor.cuerpo.fin, aFecha(aDia(haceDias(5)) + 60));
  revision = cor.cuerpo.contrato.revision;
  assert.equal((await notif(ana.c, { fecha_notificacion: haceDias(4), medio_notificacion: 'CORREO', motivo: 'Intento con una revisión anterior', revision: k1.revision })).estado, 409, 'una revisión obsoleta no corrige la notificación');

  // ampliación de plazo de la misma OS
  assert.equal((await ana.c('POST', `/api/contratos/${kid}/ampliacion`, { plazo_dias: 15, documento_ref: 'Carta 045-2026', motivo: '', revision })).estado, 400);
  const amp = await ana.c('POST', `/api/contratos/${kid}/ampliacion`, { plazo_dias: 15, documento_ref: 'Carta N.° 045-2026-MIDAGRI-SERFOR-OGA', motivo: 'Ampliación aprobada por demora en accesos', revision });
  assert.equal(amp.estado, 200, JSON.stringify(amp.cuerpo));
  assert.equal(amp.cuerpo.fecha_fin, aFecha(aDia(haceDias(5)) + 75));
  assert.equal((await ana.c('POST', `/api/contratos/${kid}/ampliacion`, { plazo_dias: 2, documento_ref: 'Carta N.° 046-2026', motivo: 'Intento concurrente', revision })).estado, 409, 'una revisión obsoleta no agrega otra ampliación');
  revision = amp.cuerpo.contrato.revision;
  lista = (await ana.c('GET', `/api/proyectos/${pid}/profesionales`)).cuerpo;
  assert.equal(lista[0].fin_vigencia, aFecha(aDia(haceDias(5)) + 75), 'la ampliación extiende la vigencia');

  // al corregir la notificación se desplaza la ampliación desde el fin del periodo ORIGINAL
  const corAmpliada = await notif(ana.c, { fecha_notificacion: haceDias(4), medio_notificacion: 'CORREO', motivo: 'El cargo corregido es del día siguiente', revision });
  assert.equal(corAmpliada.estado, 200, JSON.stringify(corAmpliada.cuerpo));
  assert.equal(corAmpliada.cuerpo.fin_original, aFecha(aDia(haceDias(4)) + 60));
  assert.equal(corAmpliada.cuerpo.fin, aFecha(aDia(haceDias(4)) + 75));
  revision = corAmpliada.cuerpo.contrato.revision;
  lista = (await ana.c('GET', `/api/proyectos/${pid}/profesionales`)).cuerpo;
  assert.equal(lista[0].fin_vigencia, aFecha(aDia(haceDias(4)) + 75));

  // nueva Orden de Servicio del mismo profesional = otra contratación enlazada
  const nueva = { consultor_id: cid, numero: 'OS-0456-2026', monto: 9000, plazo_dias: 30, entregables: [{ nombre: 'Informe de mantenimiento', plazo_dias: 30 }] };
  const n1 = await reg(ana.c, { ...nueva, documentos: { TDR: (await ana.c.pdf()).cuerpo.token, ORDEN_SERVICIO: (await ana.c.pdf()).cuerpo.token } });
  assert.equal(n1.estado, 200, JSON.stringify(n1.cuerpo));
  assert.equal(n1.cuerpo.contrato.contrato_anterior_id, kid);
  assert.equal((await reg(ana.c, { ...nueva, numero: 'OS-0789-2026', documentos: { TDR: (await ana.c.pdf()).cuerpo.token, ORDEN_SERVICIO: (await ana.c.pdf()).cuerpo.token } })).estado, 409, 'no dos OS sin notificar a la vez');
  lista = (await ana.c('GET', `/api/proyectos/${pid}/profesionales`)).cuerpo;
  assert.equal(lista.length, 1);
  assert.equal(lista[0].numero, 'OS-0456-2026'); assert.equal(lista[0].contrataciones, 2);
  assert.equal(lista[0].estado_contratacion, 'REGISTRADA');
  assert.equal(lista[0].fin_vigencia, aFecha(aDia(haceDias(4)) + 75), 'mientras no se notifique, sigue la vigencia de la OS anterior');
  // el proyecto con profesionales ya no cambia de modalidad
  const pr = (await admin('GET', '/api/proyectos')).cuerpo.find((x) => x.proyecto_id === pid);
  assert.equal((await admin('PATCH', `/api/proyectos/${pid}`, { modalidad: 'CONTRATO_ADENDAS', motivo_atipico: 'Prueba de cambio de modalidad', revision: pr.revision })).estado, 409);
});
