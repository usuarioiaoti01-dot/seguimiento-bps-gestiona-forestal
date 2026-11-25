'use strict';
/**
 * Etapa 3 de PLAN_DE_MEJORAS.md: parte diario del equipo (db/18), vínculo actividad–entregable y ciclo del entregable
 * (presentación → observación → subsanación → conformidad), con la OS culminada y el proyecto concluido al final.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-etapa3-'));
Object.assign(process.env, {
  MODO_DATOS: 'memoria', ARCHIVO_DEMO: path.join(tmp, 'demo.json'), DOCUMENTOS_RAIZ: path.join(tmp, 'almacen'),
  PLANES_PDF_DIR: path.join(tmp, 'planes-pdf'), ADENDAS_PDF_DIR: path.join(tmp, 'adendas-pdf'), CONTRATOS_PDF_DIR: path.join(tmp, 'contratos-pdf'),
  PLANES_ORIGEN_DIR: path.join(tmp, 'planes-origen'), ACTIVIDADES_PDF_DIR: path.join(tmp, 'actividades-pdf'), DOCUMENTOS_DIR: path.join(tmp, 'documentos'),
  ADMIN_CORREO: 'admin.etapa3@serfor.gob.pe', ADMIN_CLAVE_INICIAL: 'ClaveEtapa3x2026', ANTHROPIC_API_KEY: '',
});
const { crearApp } = require('../server/server');
const { aDia, aFecha, hoyLima } = require('../server/motor/calendario');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('imagen de prueba')]);
const HOY = hoyLima();
const haceDias = (n) => aFecha(aDia(HOY) - n);
let base; let servidor;

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
    return r.ok ? j.token : { estado: r.status, error: j.error };
  };
  return llamar;
}

test.before(async () => {
  const { app } = await crearApp();
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => servidor.close());

test('supervisión diaria y conformidad de entregables, hasta concluir el proyecto', async () => {
  const admin = cliente();
  assert.equal((await admin.entrar('admin.etapa3@serfor.gob.pe', 'ClaveEtapa3x2026')).estado, 200);
  const jefe = async (correo, nombre) => { const r = await admin('POST', '/api/usuarios', { correo, nombre, rol: 'JEFE_PROYECTO' }); const c = cliente(); await c.entrar(correo, r.cuerpo.clave_temporal); return { id: r.cuerpo.usuario.usuario_id, c }; };
  const ana = await jefe('ana.sup@serfor.gob.pe', 'Ana Supervisora');
  const beto = await jefe('beto.sup@serfor.gob.pe', 'Beto Ajeno');
  const p = (await admin('POST', '/api/proyectos', { nombre: 'Portal de transparencia forestal' })).cuerpo;
  const pid = p.proyecto_id;
  await admin('POST', `/api/proyectos/${pid}/equipo`, { usuario_id: ana.id, es_responsable: true });

  // OS con dos entregables, notificada hace 20 días
  const reg = await ana.c('POST', `/api/proyectos/${pid}/contrataciones`, {
    clave: 'LTV', nombres: 'Luis Torres Vega', perfil: 'Desarrollador', numero: 'OS-0777-2026', monto: 15000, plazo_dias: 60,
    entregables: [{ nombre: 'Plan de trabajo', plazo_dias: 10, porcentaje_pago: 20 }, { nombre: 'Informe final', plazo_dias: 60, porcentaje_pago: 80 }],
    documentos: { TDR: await ana.c.archivo(), ORDEN_SERVICIO: await ana.c.archivo() },
  });
  assert.equal(reg.estado, 200, JSON.stringify(reg.cuerpo));
  const kid = reg.cuerpo.contrato.contrato_id; const cid = reg.cuerpo.consultor.consultor_id;
  const [e1, e2] = reg.cuerpo.entregables;
  const rev = async () => (await ana.c('GET', `/api/contratos/${kid}/entregables`)).cuerpo;
  assert.equal((await ana.c('POST', `/api/contratos/${kid}/notificacion`, { fecha_notificacion: haceDias(20), medio_notificacion: 'CORREO', documento: await ana.c.archivo(), revision: (await rev()).contrato.revision })).estado, 200);

  // sin partes: alerta de supervisión
  let est = (await ana.c('GET', `/api/estado?proyecto_id=${pid}`)).cuerpo;
  assert.ok(est.alertas.some((a) => a.codigo === 'SIN_PARTE_DIARIO' && a.consultor_id === cid), 'sin partes desde el inicio del servicio');

  // plan de trabajo: cada actividad aporta a un entregable del TDR
  const form = await admin('GET', `/api/formulacion/${cid}`);
  assert.deepEqual(form.cuerpo.entregables.map((x) => x.numero), [1, 2]);
  assert.equal((await admin('POST', `/api/formulacion/${cid}/actividades`, { descripcion: 'Elaborar el plan', producto: 'Plan', dias_plan: 5, entregable_servicio_id: 99999 })).estado, 400, 'el entregable debe ser de su OS');
  const a1 = (await admin('POST', `/api/formulacion/${cid}/actividades`, { descripcion: 'Elaborar el plan de trabajo', producto: 'Plan de trabajo aprobado', dias_plan: 5, entregable_servicio_id: e1.entregable_servicio_id })).cuerpo;
  const a2 = (await admin('POST', `/api/formulacion/${cid}/actividades`, { descripcion: 'Desarrollar el portal', dias_plan: 20, entregable_servicio_id: e2.entregable_servicio_id, subactividades: [{ t: 'Módulo de consultas', d: 10, p: 'Código fuente' }, { t: 'Módulo de reportes', d: 10, p: 'Código fuente' }] })).cuerpo;
  assert.equal(a1.entregable_servicio_id, e1.entregable_servicio_id);
  for (const accion of ['ENVIAR', 'APROBAR_JEFE', 'APROBAR']) assert.equal((await admin('POST', `/api/formulacion/${cid}/transicion`, { accion, comentario: 'Conforme' })).estado, 200, accion);

  // parte diario: validaciones
  const parte = (c, cuerpo) => c('POST', `/api/proyectos/${pid}/partes`, cuerpo);
  const basico = { consultor_id: cid, fecha: HOY, descripcion: 'Reunión de inicio y avance del plan de trabajo' };
  assert.equal((await parte(beto.c, basico)).estado, 403, 'fuera del equipo no registra');
  assert.equal((await parte(ana.c, { ...basico, fecha: aFecha(aDia(HOY) + 1) })).estado, 400, 'no puede ser futuro');
  assert.equal((await parte(ana.c, { ...basico, descripcion: 'corto' })).estado, 400);
  const tarde = await parte(ana.c, { ...basico, fecha: haceDias(12) });
  assert.equal(tarde.estado, 400); assert.equal(tarde.cuerpo.error.includes('justifique'), true);
  assert.equal((await parte(ana.c, { ...basico, items: [{ actividad_id: a2.actividad_id, avance: 30 }] })).estado, 400, 'con subactividades se reporta por subactividad');
  assert.equal((await ana.c.archivo(Buffer.from('texto plano'), 'notas.txt', true)).estado, 400, 'formato de evidencia no admitido');

  // parte con avance y evidencia
  const evid = await ana.c.archivo(PNG, 'captura.png', true);
  const ok = await parte(ana.c, { ...basico, incidencias: 'Demora en accesos al servidor de pruebas', items: [{ actividad_id: a1.actividad_id, avance: 50 }, { actividad_id: a2.actividad_id, subactividad_indice: 0, avance: 100 }], evidencias: [evid] });
  assert.equal(ok.estado, 200, JSON.stringify(ok.cuerpo));
  assert.equal(ok.cuerpo.items.length, 2);
  assert.equal(ok.cuerpo.evidencias.length, 1);
  const det = (await ana.c('GET', `/api/consultores/${cid}`)).cuerpo;
  const act1 = det.actividades.find((a) => a.actividad_id === a1.actividad_id);
  const act2 = det.actividades.find((a) => a.actividad_id === a2.actividad_id);
  assert.equal(Number(act1.avance), 50); assert.equal(act1.estado, 'EN_CURSO');
  assert.equal(Number(act2.avance), 50, 'la actividad promedia sus subactividades');
  est = (await ana.c('GET', `/api/estado?proyecto_id=${pid}`)).cuerpo;
  assert.ok(!est.alertas.some((a) => a.codigo === 'SIN_PARTE_DIARIO' && a.consultor_id === cid), 'con el parte de hoy desaparece la alerta');

  // rectificación: bajar el avance exige explicarlo
  const corr = { ...basico, descripcion: 'Corrección: el plan de trabajo aún no tiene la mitad', rectifica_parte_id: ok.cuerpo.parte_id };
  assert.equal((await parte(ana.c, { ...corr, items: [{ actividad_id: a1.actividad_id, avance: 40 }] })).estado, 400);
  const r2 = await parte(ana.c, { ...corr, items: [{ actividad_id: a1.actividad_id, avance: 40, comentario: 'Se había contado una sección que no estaba terminada' }] });
  assert.equal(r2.estado, 200, JSON.stringify(r2.cuerpo));
  const lista = (await ana.c('GET', `/api/proyectos/${pid}/partes?consultor_id=${cid}`)).cuerpo;
  assert.equal(lista.length, 2);
  const original = lista.find((x) => x.parte_id === ok.cuerpo.parte_id);
  assert.deepEqual(original.rectificado_por, [r2.cuerpo.parte_id], 'el parte original no se modifica: queda rectificado');
  assert.equal(original.evidencias.length, 1);
  assert.equal(original.items.find((i) => i.actividad_id === a2.actividad_id).numero, '2.1');
  const tardeOk = await parte(ana.c, { ...basico, fecha: haceDias(12), justificacion: 'El supervisor estuvo en comisión de servicio' });
  assert.equal(tardeOk.estado, 200, 'registro tardío con justificación');

  // entregable 1: presentado tarde, observado, subsanado y conforme
  const ent = async (n) => (await rev()).entregables.find((x) => x.numero === n);
  let x1 = await ent(1);
  assert.equal(x1.semaforo, 'ROJO'); assert.equal(x1.vencido, true);
  assert.equal((await ana.c('POST', `/api/entregables/${x1.entregable_servicio_id}/observar`, { fecha: HOY, observacion: 'No corresponde aún', revision: x1.revision })).estado, 409, 'no se observa lo no presentado');
  assert.equal((await ana.c('POST', `/api/entregables/${x1.entregable_servicio_id}/presentar`, { fecha: HOY, revision: x1.revision })).estado, 400, 'la presentación exige el documento');
  assert.equal((await beto.c('POST', `/api/entregables/${x1.entregable_servicio_id}/presentar`, { fecha: HOY, documento: await beto.c.archivo(), revision: x1.revision })).estado, 403);
  const pres = await ana.c('POST', `/api/entregables/${x1.entregable_servicio_id}/presentar`, { fecha: haceDias(2), documento: await ana.c.archivo(PDF, 'plan de trabajo.pdf', true), revision: x1.revision });
  assert.equal(pres.estado, 200, JSON.stringify(pres.cuerpo));
  x1 = await ent(1);
  assert.equal(x1.estado, 'PRESENTADO'); assert.equal(x1.dias_atraso, 8, 'presentado 8 días después de la fecha límite'); assert.equal(x1.semaforo, 'AZUL');
  assert.equal(x1.documentos[0].tipo, 'ENTREGABLE');
  const obs = await ana.c('POST', `/api/entregables/${x1.entregable_servicio_id}/observar`, { fecha: haceDias(1), observacion: 'Falta el cronograma detallado por semana', plazo_subsanacion_dias: 3, revision: x1.revision });
  assert.equal(obs.estado, 200, JSON.stringify(obs.cuerpo));
  assert.equal(obs.cuerpo.fecha_limite_subsanacion, aFecha(aDia(haceDias(1)) + 3));
  x1 = await ent(1);
  assert.equal((await ana.c('POST', `/api/entregables/${x1.entregable_servicio_id}/conformidad`, { fecha: HOY, conformidad_ref: 'Informe 001', revision: x1.revision })).estado, 409, 'observado no admite conformidad');
  assert.equal((await ana.c('POST', `/api/entregables/${x1.entregable_servicio_id}/presentar`, { fecha: HOY, documento: await ana.c.archivo(), revision: x1.revision })).estado, 200, 'subsanación');
  x1 = await ent(1);
  assert.equal(x1.estado, 'SUBSANADO'); assert.equal(x1.fecha_subsanacion, HOY); assert.equal(x1.fecha_presentacion, haceDias(2), 'la primera presentación se conserva');
  const conf1 = await ana.c('POST', `/api/entregables/${x1.entregable_servicio_id}/conformidad`, { fecha: HOY, conformidad_ref: 'Informe N.° 001-2026-OTI', revision: x1.revision });
  assert.equal(conf1.estado, 200, JSON.stringify(conf1.cuerpo));
  assert.equal(conf1.cuerpo.os_culminada, false);

  // entregable 2: presentado hace 9 días sin respuesta → conformidad fuera de plazo (7 días)
  let x2 = await ent(2);
  assert.equal((await ana.c('POST', `/api/entregables/${x2.entregable_servicio_id}/presentar`, { fecha: haceDias(9), documento: await ana.c.archivo(), revision: x2.revision })).estado, 200);
  est = (await ana.c('GET', `/api/estado?proyecto_id=${pid}`)).cuerpo;
  assert.ok(est.alertas.some((a) => a.codigo === 'CONFORMIDAD_FUERA_DE_PLAZO' && a.prioridad === 'ALTA'));
  assert.equal(est.resumen_entregables.revision_vencida, 1);
  x2 = await ent(2);
  const conf2 = await ana.c('POST', `/api/entregables/${x2.entregable_servicio_id}/conformidad`, { fecha: HOY, conformidad_ref: 'Informe N.° 002-2026-OTI', documento: await ana.c.archivo(), revision: x2.revision });
  assert.equal(conf2.estado, 200, JSON.stringify(conf2.cuerpo));
  assert.equal(conf2.cuerpo.os_culminada, true);
  assert.equal(conf2.cuerpo.proyecto_concluido, true, 'era la única OS del proyecto');

  const prof = (await ana.c('GET', `/api/proyectos/${pid}/profesionales`)).cuerpo[0];
  assert.equal(prof.estado_contratacion, 'CULMINADA'); assert.equal(prof.estado, 'CULMINADO');
  assert.equal((await admin('GET', '/api/proyectos')).cuerpo.find((x) => x.proyecto_id === pid).estado, 'CONCLUIDO');
  assert.equal((await parte(ana.c, basico)).estado, 409, 'un proyecto concluido ya no recibe partes');
  const bit = (await admin('GET', `/api/bitacora?consultor_id=${cid}`)).cuerpo;
  assert.ok(bit.some((b) => /Conformidad del Entregable 2/.test(b.motivo || '')));
  assert.ok(bit.some((b) => b.entidad === 'parte_diario'));
});
