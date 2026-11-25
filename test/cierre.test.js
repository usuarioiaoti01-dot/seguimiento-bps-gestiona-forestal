'use strict';
/** Etapa 5 de PLAN_DE_MEJORAS.md: anulación y resolución de una OS, y cierre formal del proyecto (P9). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-etapa5-'));
Object.assign(process.env, {
  MODO_DATOS: 'memoria', ARCHIVO_DEMO: path.join(tmp, 'demo.json'), DOCUMENTOS_RAIZ: path.join(tmp, 'almacen'),
  PLANES_PDF_DIR: path.join(tmp, 'planes-pdf'), ADENDAS_PDF_DIR: path.join(tmp, 'adendas-pdf'), CONTRATOS_PDF_DIR: path.join(tmp, 'contratos-pdf'),
  PLANES_ORIGEN_DIR: path.join(tmp, 'planes-origen'), ACTIVIDADES_PDF_DIR: path.join(tmp, 'actividades-pdf'), DOCUMENTOS_DIR: path.join(tmp, 'documentos'),
  ADMIN_CORREO: 'admin.etapa5@serfor.gob.pe', ADMIN_CLAVE_INICIAL: 'ClaveEtapa5x2026', ANTHROPIC_API_KEY: '',
});
const { crearApp } = require('../server/server');
const { aDia, aFecha, hoyLima } = require('../server/motor/calendario');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const HOY = hoyLima();
const haceDias = (n) => aFecha(aDia(HOY) - n);

test('anular y resolver Órdenes de Servicio; el proyecto concluye y el equipo lo cierra con su informe', async (t) => {
  const { app } = await crearApp();
  let servidor;
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  t.after(() => servidor.close());
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const cliente = () => {
    let cookie = '';
    const f = async (metodo, ruta, cuerpo, tipo) => {
      const r = await fetch(base + ruta, { method: metodo, headers: { 'Content-Type': tipo || 'application/json', 'X-SGF': '1', Cookie: cookie }, body: cuerpo === undefined ? undefined : tipo ? cuerpo : JSON.stringify(cuerpo) });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = txt; }
      return { estado: r.status, cuerpo: j };
    };
    f.entrar = async (correo, clave) => { const i = await f('POST', '/api/auth/ingresar', { correo, clave }); if (i.cuerpo.usuario.cambiarClave) await f('POST', '/api/auth/cambiar-clave', { actual: clave, nueva: `Nueva${Date.now()}x9` }); };
    f.pdf = async () => (await f('POST', '/api/documentos/temporales', PDF, 'application/pdf')).cuerpo.token;
    return f;
  };
  const admin = cliente(); await admin.entrar('admin.etapa5@serfor.gob.pe', 'ClaveEtapa5x2026');
  const jefe = async (correo) => { const r = await admin('POST', '/api/usuarios', { correo, nombre: correo.split('@')[0], rol: 'JEFE_PROYECTO' }); const c = cliente(); await c.entrar(correo, r.cuerpo.clave_temporal); return { id: r.cuerpo.usuario.usuario_id, c }; };
  const ana = await jefe('ana.cierre@serfor.gob.pe'); const beto = await jefe('beto.cierre@serfor.gob.pe');
  const p = (await admin('POST', '/api/proyectos', { nombre: 'Migración del repositorio documental' })).cuerpo;
  const pid = p.proyecto_id;
  await admin('POST', `/api/proyectos/${pid}/equipo`, { usuario_id: ana.id, es_responsable: true });
  const registrar = async (clave, nombres, numero) => (await ana.c('POST', `/api/proyectos/${pid}/contrataciones`, { clave, nombres, numero, monto: 8000, plazo_dias: 30, entregables: [{ nombre: 'Informe final', plazo_dias: 30 }], documentos: { TDR: await ana.c.pdf(), ORDEN_SERVICIO: await ana.c.pdf() } })).cuerpo;
  const entregablesDe = async (kid) => (await ana.c('GET', `/api/contratos/${kid}/entregables`)).cuerpo;

  // OS registrada que no llega a notificarse: se anula
  const a = await registrar('ANU', 'Profesional Anulado', 'OS-ANU-1');
  let k = (await entregablesDe(a.contrato.contrato_id)).contrato;
  assert.equal((await ana.c('POST', `/api/contratos/${k.contrato_id}/resolver`, { fecha: HOY, documento_ref: 'Carta 1', motivo: 'No corresponde aún', revision: k.revision })).estado, 409, 'sin notificar no se resuelve: se anula');
  assert.equal((await ana.c('POST', `/api/contratos/${k.contrato_id}/anular`, { motivo: 'corto', revision: k.revision })).estado, 400);
  assert.equal((await beto.c('POST', `/api/contratos/${k.contrato_id}/anular`, { motivo: 'El profesional desistió del servicio', revision: k.revision })).estado, 403);
  assert.equal((await ana.c('POST', `/api/contratos/${k.contrato_id}/anular`, { motivo: 'El profesional desistió del servicio', revision: k.revision })).estado, 200);
  let lista = (await ana.c('GET', `/api/proyectos/${pid}/profesionales`)).cuerpo;
  assert.equal(lista.find((x) => x.clave === 'ANU').estado, 'NO_RENOVADO');

  // OS notificada que termina antes: se resuelve y anula sus entregables pendientes
  const b = await registrar('RES', 'Profesional Resuelto', 'OS-RES-1');
  k = (await entregablesDe(b.contrato.contrato_id)).contrato;
  assert.equal((await ana.c('POST', `/api/contratos/${k.contrato_id}/notificacion`, { fecha_notificacion: haceDias(10), medio_notificacion: 'CORREO', documento: await ana.c.pdf(), revision: k.revision })).estado, 200);
  assert.equal((await admin('GET', '/api/proyectos')).cuerpo.find((x) => x.proyecto_id === pid).estado, 'EN_EJECUCION');
  let ev = (await ana.c('GET', `/api/proyectos/${pid}/cierre`)).cuerpo;
  assert.equal(ev.puede_cerrar, false);
  assert.ok(ev.requisitos.some((r) => r.codigo === 'OS_ABIERTAS' && !r.cumple));
  k = (await entregablesDe(b.contrato.contrato_id)).contrato;
  assert.equal((await ana.c('POST', `/api/contratos/${k.contrato_id}/anular`, { motivo: 'No corresponde anular esta orden', revision: k.revision })).estado, 409, 'en ejecución no se anula: se resuelve');
  const res = await ana.c('POST', `/api/contratos/${k.contrato_id}/resolver`, { fecha: HOY, documento_ref: 'Carta N.° 077-2026-MIDAGRI-SERFOR-OGA', motivo: 'Incumplimiento del plazo del primer entregable', documento: await ana.c.pdf(), revision: k.revision });
  assert.equal(res.estado, 200, JSON.stringify(res.cuerpo));
  assert.equal(res.cuerpo.proyecto_concluido, true, 'era la última OS abierta');
  const ent = await entregablesDe(b.contrato.contrato_id);
  assert.equal(ent.contrato.estado_contratacion, 'RESUELTA');
  lista = (await ana.c('GET', `/api/proyectos/${pid}/profesionales`)).cuerpo;
  assert.equal(lista.find((x) => x.clave === 'RES').estado, 'CULMINADO');
  assert.equal((await admin('GET', '/api/proyectos')).cuerpo.find((x) => x.proyecto_id === pid).estado, 'CONCLUIDO');

  // cierre formal: el equipo cierra con su informe; un Jefe ajeno no puede
  ev = (await ana.c('GET', `/api/proyectos/${pid}/cierre`)).cuerpo;
  assert.equal(ev.puede_cerrar, true, JSON.stringify(ev.requisitos));
  const datos = { lecciones_aprendidas: 'Conviene exigir el plan de trabajo en la primera semana y revisar los avances con partes diarios.', revision: ev.proyecto.revision };
  assert.equal((await beto.c('POST', `/api/proyectos/${pid}/cierre`, { ...datos, informe: await beto.c.pdf() })).estado, 403);
  assert.equal((await ana.c('POST', `/api/proyectos/${pid}/cierre`, { ...datos, revision: 999, informe: await ana.c.pdf() })).estado, 409, 'concurrencia optimista');
  const c = await ana.c('POST', `/api/proyectos/${pid}/cierre`, { ...datos, informe: await ana.c.pdf() });
  assert.equal(c.estado, 200, JSON.stringify(c.cuerpo));
  ev = (await ana.c('GET', `/api/proyectos/${pid}/cierre`)).cuerpo;
  assert.equal(ev.proyecto.estado, 'CERRADO'); assert.equal(ev.proyecto.fecha_cierre, HOY); assert.ok(ev.informe);
  assert.match(ev.proyecto.lecciones_aprendidas, /partes diarios/);
  assert.equal((await ana.c('POST', `/api/proyectos/${pid}/cierre`, { ...datos, revision: ev.proyecto.revision, informe: await ana.c.pdf() })).estado, 409, 'ya cerrado');
  const port = (await admin('GET', '/api/portafolio')).cuerpo.proyectos.find((x) => x.proyecto_id === pid);
  assert.equal(port.terminado, true);
  const bit = (await admin('GET', '/api/bitacora?entidad=proyecto')).cuerpo;
  assert.ok(bit.some((x) => /Cierre del proyecto/.test(x.motivo || '')));
});
