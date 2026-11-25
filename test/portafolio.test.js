'use strict';
/** Etapa 4 de PLAN_DE_MEJORAS.md: tablero general de todos los proyectos (motor/portafolio.js y /api/portafolio). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-etapa4-'));
Object.assign(process.env, {
  MODO_DATOS: 'memoria', ARCHIVO_DEMO: path.join(tmp, 'demo.json'), DOCUMENTOS_RAIZ: path.join(tmp, 'almacen'),
  PLANES_PDF_DIR: path.join(tmp, 'planes-pdf'), ADENDAS_PDF_DIR: path.join(tmp, 'adendas-pdf'), CONTRATOS_PDF_DIR: path.join(tmp, 'contratos-pdf'),
  PLANES_ORIGEN_DIR: path.join(tmp, 'planes-origen'), ACTIVIDADES_PDF_DIR: path.join(tmp, 'actividades-pdf'), DOCUMENTOS_DIR: path.join(tmp, 'documentos'),
  ADMIN_CORREO: 'admin.etapa4@serfor.gob.pe', ADMIN_CLAVE_INICIAL: 'ClaveEtapa4x2026', ANTHROPIC_API_KEY: '',
});
const { crearRepositorioMemoria } = require('../server/datos/memoria');
const { construirEstado } = require('../server/motor/estado');
const { construirPortafolio, totalesMonto } = require('../server/motor/portafolio');
const { crearApp } = require('../server/server');
const { aDia, aFecha, hoyLima } = require('../server/motor/calendario');
const semilla = require('../data/semilla.json');

test('portafolio: avance, semáforo, entregables y montos por proyecto', async () => {
  const datos = await crearRepositorioMemoria({ semilla }).cargarTodo();
  const corte = '2026-12-01';
  // proyecto por Orden de Servicio: OS de S/ 10 000 con un entregable conforme (40 %) y otro vencido (60 %)
  datos.proyectos.push({ proyecto_id: 9, codigo: 'PRY-2026-009', nombre: 'Portal de datos abiertos', modalidad: 'ORDEN_SERVICIO', estado: 'EN_EJECUCION', con_profesionales: 1, con_orden_servicio: 1, activo: 1, area_tecnica: 'Equipo de Desarrollo' });
  datos.proyectos.push({ proyecto_id: 10, codigo: 'PRY-2025-001', nombre: 'Proyecto concluido', modalidad: 'GESTION_INTERNA', estado: 'CERRADO', fecha_cierre: '2026-06-30', con_profesionales: 0, activo: 1 });
  datos.consultores.push({ consultor_id: 900, clave: 'DAB', nombres: 'Diana Abad Bravo', proyecto_id: 9, estado: 'ACTIVO', activo: 1 });
  datos.contratos.push({ contrato_id: 900, consultor_id: 900, numero: 'OS-900', tipo_documento: 'ORDEN_SERVICIO', estado_contratacion: 'EN_EJECUCION', monto: 10000, plazo_dias: 60, fecha_notificacion: '2026-10-31', fecha_inicio: '2026-11-01', fecha_fin: '2026-12-30', activo: 1 });
  datos.adendas.push({ adenda_id: 900, contrato_id: 900, numero: 1, tipo_periodo: 'ORIGINAL', estado: 'FIRMADA', fecha_inicio: '2026-11-01', fecha_fin: '2026-12-30', activo: 1 });
  datos.entregables_servicio.push(
    { entregable_servicio_id: 901, contrato_id: 900, numero: 1, nombre: 'Plan de trabajo', plazo_dias: 15, fecha_limite: '2026-11-15', porcentaje_pago: 40, estado: 'CONFORME', activo: 1 },
    { entregable_servicio_id: 902, contrato_id: 900, numero: 2, nombre: 'Informe de avance', plazo_dias: 25, fecha_limite: '2026-11-25', porcentaje_pago: 60, estado: 'PENDIENTE', activo: 1 },
  );
  const e = construirEstado(datos, { corte });
  const r = construirPortafolio(datos, e, { equipos: { 9: [{ nombre: 'Ana Desarrollo', es_responsable: 1 }] } });
  const os9 = r.proyectos.find((p) => p.proyecto_id === 9);
  assert.equal(os9.avance, 40, 'OS al 40 %: un entregable conforme (40 % del pago) y el otro sin avance');
  assert.equal(os9.semaforo, 'ROJO', 'entregable vencido sin presentar');
  assert.equal(os9.entregables.vencidos, 1);
  assert.deepEqual([os9.proximo_entregable.numero, os9.proximo_entregable.semaforo], [2, 'ROJO']);
  assert.equal(os9.monto_comprometido, 10000); assert.equal(os9.monto_conforme, 4000);
  assert.equal(os9.responsable, 'Ana Desarrollo');
  assert.equal(os9.sin_parte, true, 'en ejecución desde el 01/11 sin partes diarios');
  assert.equal(os9.linea.length, 1); assert.equal(os9.linea[0].hitos.length, 2);
  const gf = r.proyectos.find((p) => p.codigo === 'GF2026');
  assert.equal(gf.modalidad, 'CONTRATO_ADENDAS'); assert.equal(gf.profesionales, 11); assert.equal(gf.os_total, 0);
  assert.equal(gf.sin_parte, false, 'a GF2026 no se le exige parte diario');
  const cerrado = r.proyectos.find((p) => p.proyecto_id === 10);
  assert.equal(cerrado.terminado, true); assert.equal(cerrado.semaforo, 'GRIS'); assert.equal(cerrado.avance, null);
  assert.equal(r.resumen.en_curso, 2); assert.equal(r.resumen.terminados, 1); assert.equal(r.resumen.terminados_anio, 1);
  assert.equal(r.resumen.entregables_vencidos, 1); assert.equal(r.resumen.os_en_ejecucion, 1);
  assert.equal(r.resumen.semaforo.ROJO >= 1, true);
  delete gf.monto_comprometido; delete gf.monto_conforme; delete cerrado.monto_comprometido; delete cerrado.monto_conforme;
  assert.deepEqual(totalesMonto(r.proyectos), { proyectos_con_monto: 1, comprometido: 10000, conforme: 4000 }, 'los totales solo suman lo visible');
});

test('API: todos los proyectos para el Jefe de Proyecto; el monto solo en los suyos; exportación CSV', async (t) => {
  const { app, generarReporteCorreo } = await crearApp();
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
      return { estado: r.status, cuerpo: j, tipo: r.headers.get('content-type') };
    };
    f.entrar = async (correo, clave) => { const i = await f('POST', '/api/auth/ingresar', { correo, clave }); if (i.cuerpo.usuario.cambiarClave) await f('POST', '/api/auth/cambiar-clave', { actual: clave, nueva: `Nueva${Date.now()}x9` }); };
    return f;
  };
  const admin = cliente(); await admin.entrar('admin.etapa4@serfor.gob.pe', 'ClaveEtapa4x2026');
  const jefe = async (correo) => { const r = await admin('POST', '/api/usuarios', { correo, nombre: correo.split('@')[0], rol: 'JEFE_PROYECTO' }); const c = cliente(); await c.entrar(correo, r.cuerpo.clave_temporal); return { id: r.cuerpo.usuario.usuario_id, c }; };
  const ana = await jefe('ana.p4@serfor.gob.pe'); const beto = await jefe('beto.p4@serfor.gob.pe');
  const p = (await admin('POST', '/api/proyectos', { nombre: 'Sistema de alertas tempranas', area_tecnica: 'Equipo de Desarrollo' })).cuerpo;
  await admin('POST', `/api/proyectos/${p.proyecto_id}/equipo`, { usuario_id: ana.id, es_responsable: true });
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const tmpPdf = async () => (await ana.c('POST', '/api/documentos/temporales', PDF, 'application/pdf')).cuerpo.token;
  const reg = await ana.c('POST', `/api/proyectos/${p.proyecto_id}/contrataciones`, { clave: 'SAT', nombres: 'Sara Arias Tello', numero: 'OS-P4-1', monto: 20000, plazo_dias: 30, entregables: [{ nombre: 'Informe final', plazo_dias: 30 }], documentos: { TDR: await tmpPdf(), ORDEN_SERVICIO: await tmpPdf() } });
  assert.equal(reg.estado, 200, JSON.stringify(reg.cuerpo));
  const k = (await ana.c('GET', `/api/contratos/${reg.cuerpo.contrato.contrato_id}/entregables`)).cuerpo.contrato;
  assert.equal((await ana.c('POST', `/api/contratos/${k.contrato_id}/notificacion`, { fecha_notificacion: aFecha(aDia(hoyLima()) - 3), medio_notificacion: 'CORREO', documento: await tmpPdf(), revision: k.revision })).estado, 200);

  const deAna = (await ana.c('GET', '/api/portafolio')).cuerpo;
  const deBeto = (await beto.c('GET', '/api/portafolio')).cuerpo;
  assert.equal(deBeto.proyectos.length, deAna.proyectos.length, 'todos ven todos los proyectos (D2)');
  const filaAna = deAna.proyectos.find((x) => x.proyecto_id === p.proyecto_id);
  const filaBeto = deBeto.proyectos.find((x) => x.proyecto_id === p.proyecto_id);
  assert.equal(filaAna.monto_comprometido, 20000); assert.equal(filaAna.mio, true); assert.equal(filaAna.escribe, true);
  assert.equal(filaBeto.monto_comprometido, undefined, 'un Jefe ajeno no ve el monto'); assert.equal(filaBeto.mio, false);
  assert.equal(deBeto.montos.comprometido, 0);
  assert.equal(filaAna.estado, 'EN_EJECUCION'); assert.equal(filaAna.os_en_ejecucion, 1); assert.equal(filaAna.responsable, 'ana.p4');
  assert.ok(deAna.resumen.en_curso >= 2);
  const csv = await beto.c('GET', '/api/portafolio.csv');
  assert.equal(csv.estado, 200); assert.match(csv.tipo, /text\/csv/);
  assert.match(csv.cuerpo, /codigo;proyecto;modalidad/); assert.match(csv.cuerpo, /Sistema de alertas tempranas/);
  assert.ok(!/20000/.test(csv.cuerpo), 'tampoco en la exportación');
  assert.match((await ana.c('GET', '/api/portafolio.csv')).cuerpo, /20000/);
  // reporte mensual: hechos del mes por proyecto; el monto, solo para quien puede verlo; PDF válido
  const mesNotif = aFecha(aDia(hoyLima()) - 3).slice(0, 7);
  const rep = (await ana.c('GET', `/api/reportes/mensual?mes=${mesNotif}`)).cuerpo;
  const filaRep = rep.proyectos.find((x) => x.proyecto_id === p.proyecto_id);
  assert.ok(filaRep && filaRep.hechos.some((h) => /OS N\.° OS-P4-1 notificada/.test(h)), JSON.stringify(filaRep && filaRep.hechos));
  assert.equal(rep.montos.comprometido, 20000);
  assert.equal((await beto.c('GET', `/api/reportes/mensual?mes=${mesNotif}`)).cuerpo.montos.comprometido, 0, 'un Jefe ajeno no ve montos en el reporte');
  assert.equal((await ana.c('GET', '/api/reportes/mensual?mes=2026-13')).estado, 400);
  assert.equal((await ana.c('GET', '/api/reportes/mensual?mes=2099-01')).estado, 400, 'mes que aún no empieza');
  const pdf = await fetch(`${base}/api/reportes/mensual.pdf?mes=${mesNotif}`);
  assert.equal(pdf.status, 401, 'sin sesión no se entrega');
  const pdfAna = await ana.c('GET', `/api/reportes/mensual.pdf?mes=${mesNotif}`);
  assert.equal(pdfAna.estado, 200); assert.match(pdfAna.tipo, /application\/pdf/); assert.ok(String(pdfAna.cuerpo).startsWith('%PDF-'));
  // reporte que se envía por correo: lo arma el sistema con todos los proyectos y, por defecto, sin montos
  const porCorreo = await generarReporteCorreo(mesNotif);
  assert.ok(porCorreo.reporte.proyectos.some((x) => x.proyecto_id === p.proyecto_id), 'incluye todos los proyectos');
  assert.equal(porCorreo.reporte.montos, null);
  assert.ok(porCorreo.reporte.proyectos.every((x) => !('monto_comprometido' in x) && !('monto_conforme' in x)), 'sin montos por proyecto');
  assert.match(porCorreo.reporte.generado_por, /Envío automático/);
  assert.equal(porCorreo.pdf.subarray(0, 5).toString(), '%PDF-');

  // el Profesional no accede al tablero general
  const pr = await admin('POST', '/api/usuarios/profesionales', { cuentas: [{ consultor_id: reg.cuerpo.consultor.consultor_id, correo: 'sara.arias@ejemplo.com' }] });
  const prof = cliente(); await prof.entrar('sara.arias@ejemplo.com', pr.cuerpo.cuentas[0].clave_temporal);
  assert.equal((await prof('GET', '/api/portafolio')).estado, 403);
});
