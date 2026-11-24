'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-form-'));
process.env.MODO_DATOS = 'memoria';
process.env.ARCHIVO_DEMO = path.join(tmp, 'demo.json');
process.env.DOCUMENTOS_RAIZ = path.join(tmp, 'almacen');
const { crearRepositorio } = require('../server/datos');
const { crearServicio } = require('../server/servicio');
const { crearFormulacion } = require('../server/formulacion');
const { crearActividadDocs } = require('../server/actividad-docs');
const { crearPlanesPdf } = require('../server/planes-pdf');

const rechaza = async (promesa, estado, patron) => {
  await assert.rejects(promesa, (e) => { assert.equal(e.estado, estado, e.message); if (patron) assert.match(e.message, patron); return true; });
};

test('Formular plan de trabajo: reinicio, etapas, permisos, plazos de la adenda y arranque del seguimiento', async () => {
  const repo = await crearRepositorio();
  const servicio = crearServicio(repo);
  const planesPdf = crearPlanesPdf({ dir: path.join(tmp, 'planes') });
  const f = crearFormulacion({ servicio, repo, docs: crearActividadDocs({ dir: path.join(tmp, 'docs') }), planesPdf });

  // Reinicio: baja lógica de todas las actividades; los planes quedan por registrar
  const r = await f.reiniciarPlanes('prueba');
  assert.ok(r.planes > 0 && r.actividades > 0);
  const d0 = await servicio.datos(true);
  assert.ok(d0.planes.every((p) => p.estado === 'POR_REGISTRAR'));
  assert.equal(d0.actividades.filter((a) => a.activo !== 0).length, 0, 'nada se borra: se dan de baja');
  assert.ok(d0.actividades.length > 0);
  assert.equal((await servicio.estado()).indicadores.actividades, 0);

  const est = await servicio.estado();
  const it = est.consultores.find((c) => c.vigencia.adenda_vigente);
  const id = it.consultor.consultor_id;
  const prof = { usuario: 'p@serfor.gob.pe', nombre: 'Profesional', rol: 'PROFESIONAL', consultor_id: id };
  const otro = { ...prof, consultor_id: id + 1000 };
  const jefe = { usuario: 'j@serfor.gob.pe', nombre: 'Jefe de Proyecto', rol: 'JEFE_PROYECTO' };
  const admin = { usuario: 'a@serfor.gob.pe', nombre: 'Administrador', rol: 'ADMIN' };

  const det0 = await f.detalle(id, prof);
  const per = det0.periodo;
  assert.equal(per.inicio, it.vigencia.adenda_vigente.fecha_inicio, 'el periodo es el de la adenda vigente');
  assert.equal(per.fin, it.vigencia.adenda_vigente.fecha_fin);
  assert.equal(det0.permisos.puedeEditar, true);
  await rechaza(f.detalle(id, otro), 403);

  const act = { descripcion: 'Desarrollar el servicio', producto: 'Servicio desplegado en desarrollo', dias_plan: 5 };
  await rechaza(f.agregarActividad(id, { ...act, producto: '' }, prof), 400, /producto/i);
  await rechaza(f.agregarActividad(id, { ...act, dias_plan: 0 }, prof), 400, /días hábiles/);
  await rechaza(f.agregarActividad(id, { ...act, dias_plan: per.dias_habiles + 1 }, prof), 400, /adenda vigente/);
  await rechaza(f.agregarActividad(id, { ...act, subactividades: [{ texto: 'A', dias: 3, producto: 'x' }, { texto: 'B', dias: 3, producto: 'y' }] }, prof), 400, /suman 6 días y no pueden exceder los 5/);
  await rechaza(f.agregarActividad(id, { ...act, subactividades: [{ texto: 'A', producto: 'x' }] }, prof), 400, /días hábiles de la subactividad/);
  await rechaza(f.agregarActividad(id, { ...act, subactividades: [{ texto: 'A', dias: 2 }] }, prof), 400, /producto .* de la subactividad/);
  await rechaza(f.agregarActividad(id, { ...act, dias_plan: 100 }, prof), 400, /1 a 99/);
  await rechaza(f.agregarActividad(id, act, otro), 403);
  await rechaza(f.agregarActividad(id, { ...act, subactividades: Array(21).fill({ texto: 'x', dias: 1, producto: 'p' }) }, prof), 400, /subactividades/);
  const a1 = await f.agregarActividad(id, { ...act, subactividades: [{ texto: 'Definir estructura de datos', dias: 2, producto: 'Acta de alcance' }, { texto: '  ', dias: null }, { texto: 'Desplegar en desarrollo', dias: 3, producto: 'Servicio desplegado' }] }, prof);
  assert.equal(a1.numero, '1');
  assert.deepEqual(JSON.parse(a1.subactividades), [{ t: 'Definir estructura de datos', d: 2, p: 'Acta de alcance' }, { t: 'Desplegar en desarrollo', d: 3, p: 'Servicio desplegado' }]);
  // documentos PDF de la actividad
  const pdfMin = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  await rechaza(f.agregarDocumento(a1.actividad_id, Buffer.from('no es pdf'), 'x.pdf', prof), 400);
  await rechaza(f.agregarDocumento(a1.actividad_id, pdfMin, 'x.pdf', otro), 403);
  const dc = await f.agregarDocumento(a1.actividad_id, pdfMin, 'Acta de alcance.pdf', prof);
  assert.equal(dc.n, 1);
  assert.equal((await f.detalle(id, prof)).actividades[0].documentos[0].nombre, 'Acta de alcance.pdf');
  assert.ok((await f.rutaDocumento(a1.actividad_id, 1, prof)).archivo.endsWith('.pdf'));
  await rechaza(f.rutaDocumento(a1.actividad_id, 1, otro), 403);
  await f.guardarCabecera(id, { area_usuaria: 'DCGPFFS', supuestos: 'Acta de alcance' }, prof);
  let det = await f.detalle(id, prof);
  assert.equal(det.plan.estado, 'EN_FORMULACION');
  assert.equal(det.plan.area_usuaria, 'DCGPFFS');
  assert.equal(det.actividades.length, 1);
  assert.equal(det.actividades[0].dias_habiles, 5);
  assert.deepEqual(det.actividades[0].subactividades.map((x) => x.dias), [2, 3]);
  assert.ok(det.actividades[0].inicio_plan >= per.inicio, 'las fechas se calculan desde el inicio de la adenda');
  assert.ok(det.actividades[0].fin_plan > det.actividades[0].inicio_plan);
  const s0 = det.actividades[0].subactividades;
  assert.equal(s0[0].inicio_plan, det.actividades[0].inicio_plan, 'la primera subactividad inicia con la actividad');
  assert.ok(s0[1].inicio_plan > s0[0].fin_plan && s0[1].fin_plan <= det.actividades[0].fin_plan, 'las subactividades se encadenan dentro de la actividad');
  assert.equal(s0[1].producto, 'Servicio desplegado');
  assert.equal(det.resumen.total_dias, 5);
  assert.equal((await servicio.estado()).indicadores.actividades, 0, 'en formulación aún no hay seguimiento');

  await rechaza(f.transicion(id, 'APROBAR_JEFE', '', prof), 409);
  det = await f.transicion(id, 'ENVIAR', '', prof);
  assert.equal(det.plan.estado, 'EN_REVISION_JEFE');
  assert.equal(det.permisos.puedeEditar, false, 'el plan enviado queda fijo para el profesional');
  await rechaza(f.modificarActividad(a1.actividad_id, { ...act, descripcion: 'Otra' }, prof), 409);
  await rechaza(f.agregarActividad(id, act, prof), 409);
  await rechaza(f.agregarDocumento(a1.actividad_id, pdfMin, 'otro.pdf', prof), 409);
  await rechaza(f.guardarCabecera(id, { supuestos: 'x' }, prof), 409);

  await f.quitarDocumento(a1.actividad_id, 1, jefe);
  assert.equal((await f.detalle(id, jefe)).actividades[0].documentos.length, 0, 'el documento retirado deja de mostrarse (el archivo se conserva)');
  // El Jefe de Proyecto puede modificar y aprobar; no puede aprobar en última instancia
  await f.modificarActividad(a1.actividad_id, { ...act, descripcion: 'Desarrollar el servicio (ajustado por el Jefe de Proyecto)' }, jefe);
  await rechaza(f.transicion(id, 'APROBAR', '', jefe), 409);
  det = await f.transicion(id, 'APROBAR_JEFE', 'Conforme', jefe);
  assert.equal(det.plan.estado, 'EN_REVISION_ADMIN');
  assert.equal(det.plan.aprobado_jefe_por, 'Jefe de Proyecto');
  assert.equal(det.plan.tiene_pdf, true, 'al aprobar el Jefe se genera el PDF que se remite al Administrador');
  assert.equal(planesPdf.info(det.plan.plan_id).existe, true);
  assert.equal(det.actividades[0].agregada_por, null, 'la actividad del profesional no lleva marca');
  await rechaza(f.modificarActividad(a1.actividad_id, act, jefe), 409);

  // El Administrador observa con comentarios y el plan vuelve al Jefe de Proyecto
  await rechaza(f.transicion(id, 'OBSERVAR', '', admin), 400);
  await rechaza(f.transicion(id, 'OBSERVAR', 'Falta detallar', jefe), 409);
  det = await f.transicion(id, 'OBSERVAR', 'Falta detallar las pruebas de integración', admin);
  assert.equal(det.plan.estado, 'OBSERVADO');
  assert.equal(det.plan.observacion_revision, 'Falta detallar las pruebas de integración');
  const aj = await f.agregarActividad(id, { ...act, descripcion: 'Pruebas de integración', producto: 'Informe de pruebas' }, jefe);
  assert.equal(aj.agregada_por, 'JEFE_PROYECTO', 'la actividad agregada por el Jefe de Proyecto queda marcada');
  await f.transicion(id, 'APROBAR_JEFE', '', jefe);
  assert.equal((await servicio.estado()).indicadores.actividades, 0, 'sin aprobar no hay seguimiento');

  // Aprobación final: el plan queda fijo y arranca el seguimiento
  det = await f.transicion(id, 'APROBAR', '', admin);
  assert.equal(det.plan.estado, 'APROBADO');
  assert.ok(det.actividades[0].inicio_plan >= det.plan.fecha_aprobacion, 'los plazos se cuentan desde la aprobación');
  assert.ok(det.actividades[1].inicio_plan > det.actividades[0].fin_plan, 'las actividades se encadenan');
  assert.equal(det.aprobacion.fecha, det.plan.fecha_aprobacion);
  assert.match(det.plan.fecha_aprobacion, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(det.actividades[1].agregada_por, 'JEFE_PROYECTO');
  assert.equal(det.plan.tiene_pdf, true, 'el plan aprobado queda con su PDF para el visor');
  const e = await servicio.estado();
  assert.equal(e.indicadores.actividades, 2);
  assert.equal(e.indicadores.planes_aprobados, 1);
  await rechaza(f.modificarActividad(a1.actividad_id, act, admin), 409);
  // PDF del plan aprobado: solo el Administrador
  await rechaza(f.generarPdf(id, jefe), 403);
  const g = await f.generarPdf(id, admin);
  assert.equal(g.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok(g.buffer.length > 1000);
  const hg = await f.historialGeneral(jefe);
  assert.ok(hg.some((h) => h.a === 'OBSERVADO' && h.comentario === 'Falta detallar las pruebas de integración' && h.clave));
  await rechaza(f.historialGeneral(prof), 403);
  assert.deepEqual(det.historial.map((h) => h.a).reverse(), ['POR_REGISTRAR', 'EN_FORMULACION', 'EN_REVISION_JEFE', 'EN_REVISION_ADMIN', 'OBSERVADO', 'EN_REVISION_ADMIN', 'APROBADO']);

  // Seguimiento: la actividad principal avanza a medida que avanzan sus subactividades (ponderado por días)
  const ac = (await servicio.detalleConsultor(id)).actividades.find((x) => x.actividad_id === a1.actividad_id);
  assert.equal(ac.subactividades.length, 2);
  assert.ok(ac.subactividades[0].inicio_plan && ac.subactividades[1].fin_plan, 'cada subactividad lleva su propia línea de tiempo');
  await rechaza(servicio.actualizarSubactividad(ac.actividad_id, 0, 120, ac.revision, prof), 400);
  await rechaza(servicio.actualizarSubactividad(ac.actividad_id, 5, 50, ac.revision, prof), 404);
  await servicio.actualizarSubactividad(ac.actividad_id, 0, 100, ac.revision, prof);
  let ac2 = (await servicio.detalleConsultor(id)).actividades.find((x) => x.actividad_id === a1.actividad_id);
  assert.equal(ac2.avance, 40, '2 de 5 días concluidos = 40 %');
  assert.equal(ac2.estado, 'EN_CURSO');
  assert.equal(ac2.subactividades[0].estado, 'CONCLUIDA');
  await servicio.actualizarSubactividad(ac2.actividad_id, 1, 100, ac2.revision, prof);
  ac2 = (await servicio.detalleConsultor(id)).actividades.find((x) => x.actividad_id === a1.actividad_id);
  assert.equal(ac2.avance, 100);
  assert.equal(ac2.estado, 'CONCLUIDA');
});

test('Registrar un plan ya elaborado en un documento: vista previa, confirmación y actividades en la aplicación', async () => {
  const { leer } = require('../server/documentos/lector');
  const { planDeTablas, normalizarPlan } = require('../server/documentos/plan');
  const repo = await crearRepositorio();
  const servicio = crearServicio(repo);
  const f = crearFormulacion({ servicio, repo, docs: crearActividadDocs({ dir: path.join(tmp, 'docs2') }), planesPdf: crearPlanesPdf({ dir: path.join(tmp, 'planes2') }), leerDocumento: leer, dirOrigen: path.join(tmp, 'origen'),
    extraerPlanConIA: async () => ({ plan: { area_usuaria: 'DCGPFFS', supuestos: 'Acceso a los servidores', actividades: [{ descripcion: 'Análisis del servicio', producto: 'Informe de análisis', dias: 4 }, { descripcion: 'Desarrollo', subactividades: [{ texto: 'Diseño', dias: 2, producto: 'Modelo de datos' }, { texto: 'Código', dias: 3, producto: 'Módulo desplegado' }] }] } }) });
  await f.reiniciarPlanes('prueba');
  const it = (await servicio.estado()).consultores.find((c) => c.vigencia.adenda_vigente);
  const id = it.consultor.consultor_id;
  const prof = { usuario: 'p@serfor.gob.pe', nombre: 'Profesional', rol: 'PROFESIONAL', consultor_id: id };
  const otro = { ...prof, consultor_id: id + 1000 };
  const nl = String.fromCharCode(10);

  // intérprete puro: filas 1, 1.1, 1.2 y días calculados con fechas
  const plan = planDeTablas([{ nombre: 'Plan', filas: [
    ['CRONOGRAMA DE ACTIVIDADES'], ['N.°', 'Actividad', 'Producto / evidencia verificable', 'Inicio', 'Fin', 'Días hábiles'],
    ['1', 'Análisis', 'Informe', '2026-11-02', '2026-11-06', ''], ['2', 'Desarrollo', '', '', '', 5],
    ['2.1', '• Diseño', 'Modelo', '', '', 2], ['2.2', '• Código', 'Módulo', '', '', 3], ['', 'Total', '', '', '', 10]] }]);
  assert.equal(plan.actividades.length, 2);
  assert.equal(plan.actividades[0].dias, 5, 'días hábiles entre las fechas del documento');
  assert.ok(plan.actividades[0].advertencias.some((a) => /fechas del documento/.test(a)));
  assert.deepEqual(plan.actividades[1].subactividades.map((s) => [s.texto, s.dias]), [['Diseño', 2], ['Código', 3]]);
  assert.equal(planDeTablas([{ nombre: 'x', filas: [['a', 'b'], ['1', '2']] }]), null);
  assert.equal(normalizarPlan({ actividades: [{ descripcion: 'X', subactividades: [{ texto: 'a', dias: 2 }, { texto: 'b', dias: 3 }] }] }).actividades[0].dias, 5);

  // Excel/CSV
  const csv = Buffer.from(['N.°;Actividad;Producto / evidencia;Días', '1;Análisis del servicio;Informe de análisis;4', '2;Desarrollo;;5', '2.1;Diseño;Modelo de datos;2', '2.2;Código;Módulo desplegado;3', '3;Pruebas;Acta de pruebas;100', ''].join(nl));
  await rechaza(f.previsualizarPlan(id, { buffer: csv, nombre: 'plan.csv' }, otro), 403);
  const vista = await f.previsualizarPlan(id, { buffer: csv, nombre: 'plan.csv' }, prof);
  assert.equal(vista.resumen.actividades, 3);
  assert.equal(vista.resumen.validas, 2, 'la de 100 días no es válida');
  assert.match(vista.plan.actividades[2].error, /1 a 99/);
  assert.equal((await f.detalle(id, prof)).actividades.length, 0, 'la vista previa no cambia nada');
  const ap = await f.aplicarPlan(id, { importacion_id: vista.importacion_id, indices: [0, 1, 2] }, prof);
  assert.equal(ap.creadas.length, 2);
  assert.equal(ap.fallidas.length, 1);
  const det = await f.detalle(id, prof);
  assert.equal(det.actividades.length, 2);
  assert.deepEqual(det.actividades[1].subactividades.map((s) => s.dias), [2, 3]);
  assert.equal(det.plan.documento_origen, 'plan.csv');
  const orig = await f.rutaOrigen(id, prof);
  assert.ok(fs.existsSync(orig.archivo));
  await rechaza(f.aplicarPlan(id, { importacion_id: vista.importacion_id }, prof), 404, undefined);

  // un archivo que no es un PDF válido se rechaza antes de llegar al asistente
  await assert.rejects(f.previsualizarPlan(id, { buffer: Buffer.from('no es pdf'), nombre: 'plan.pdf' }, prof));
});
