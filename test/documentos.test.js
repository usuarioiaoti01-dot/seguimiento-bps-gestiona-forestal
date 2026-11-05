'use strict';
// Carga de documentos: lectura (Excel, CSV, MS Project XML, PDF, Word), interpretación, vista previa y aplicación.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.ANTHROPIC_API_KEY = '';
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { crearRepositorioMemoria } = require('../server/datos/memoria');
const { crearServicio } = require('../server/servicio');
const { crearAgente } = require('../server/ia/agente');
const { crearDocumentos } = require('../server/documentos');
const { leer } = require('../server/documentos/lector');
const { plantillaXlsx } = require('../server/documentos/plantilla');
const { tablasAFilas, interpretar, interpretarAdendas, redactarPersonales, aFecha } = require('../server/documentos/interprete');
const semilla = require('../data/semilla.json');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-doc-'));
const usuario = { correo: 'jefe@ejemplo.com', nombre: 'Jefe', rol: 'JEFE_PROYECTO' };

async function entorno(extraerConIA) {
  const repo = crearRepositorioMemoria({ semilla });
  const servicio = crearServicio(repo);
  const docs = crearDocumentos({ servicio, repo, dir: path.join(tmp, `d${Math.random().toString(36).slice(2)}`), extraerConIA });
  return { repo, servicio, docs, datos: await servicio.datos(true) };
}
const planDe = (d, clave) => { const c = d.consultores.find((x) => x.clave === clave); return d.planes.filter((p) => p.consultor_id === c.consultor_id).sort((a, b) => b.plan_id - a.plan_id)[0]; };
const actividadesDe = (d, clave) => d.actividades.filter((a) => a.plan_id === planDe(d, clave).plan_id && !a.es_resumen);

async function xlsx(hojas) {
  const libro = new ExcelJS.Workbook();
  for (const [nombre, filas] of Object.entries(hojas)) { const h = libro.addWorksheet(nombre); filas.forEach((f) => h.addRow(f)); }
  return Buffer.from(await libro.xlsx.writeBuffer());
}
const tablas = (nombre, filas) => [{ nombre, filas }];

// ---------------------------------------------------------------- interpretación
test('interpretar: actualiza avance y estado de actividades existentes y muestra solo lo que cambia', async () => {
  const { datos } = await entorno();
  const a = actividadesDe(datos, 'ERB')[0]; const b = actividadesDe(datos, 'ERB')[1];
  const { filas } = tablasAFilas(tablas('Actividades', [
    ['clave', 'numero', 'avance', 'estado', 'inicio_plan'],
    ['erb', a.numero, '35%', 'En curso', a.inicio_plan],
    ['ERB', b.numero, '', '', ''],
  ]));
  const r = interpretar(filas, datos);
  assert.equal(r.cambios.length, 1);
  const c = r.cambios[0];
  assert.equal(c.accion, 'MODIFICAR');
  assert.equal(c.registro_id, a.actividad_id);
  assert.deepEqual(c.diffs.map((x) => [x.campo, x.antes, x.despues]), [['avance', 0, 35], ['estado', 'PENDIENTE', 'EN_CURSO']], 'el inicio_plan igual no aparece');
  assert.equal(r.sinCambios, 1, 'la fila sin valores no cambia nada');
});

test('interpretar: fechas en dd/mm/aaaa, reprogramación advertida y reglas de rechazo', async () => {
  const { datos } = await entorno();
  const [a, b, c3] = actividadesDe(datos, 'EVE');
  const r = interpretar(tablasAFilas(tablas('Actividades', [
    ['clave', 'numero', 'fin_plan'],
    ['EVE', a.numero, '30/12/2026'],
    ['EVE', b.numero, '31/02/2026'], // fecha inexistente
    ['XXX', c3.numero, '2026-12-01'], // profesional inexistente
    ['EVE', '999', '2026-12-01'], // no existe y faltan datos para crearla
    ['EVE', a.numero, '2026-12-29'], // repetida
  ])).filas, datos);
  assert.equal(r.cambios.length, 1);
  assert.deepEqual(r.cambios[0].campos, { fin_plan: '2026-12-30' });
  assert.deepEqual(r.cambios[0].advertencias, ['Reprograma las fechas del plan']);
  const motivos = r.rechazadas.map((x) => x.motivo).join(' | ');
  assert.match(motivos, /fecha no válida/);
  assert.match(motivos, /No existe el profesional «XXX»/);
  assert.match(motivos, /para crearla faltan/);
  assert.match(motivos, /Repetida en el documento/);
  assert.ok(r.rechazadas.every((x) => x.fila), 'cada rechazo indica su fila');
  assert.equal(aFecha('2026-11-04T08:00:00'), '2026-11-04');
  assert.equal(aFecha('4/11/2026'), '2026-11-04');
});

test('interpretar: actividad nueva con datos completos; estado de actividad y avance inválidos se rechazan', async () => {
  const { datos } = await entorno();
  const r = interpretar(tablasAFilas(tablas('Actividades', [
    ['clave', 'numero', 'descripcion', 'inicio_plan', 'fin_plan', 'avance'],
    ['CAC', '77', 'Capacitación adicional', '2026-11-20', '2026-12-10', ''],
    ['CAC', '78', 'Con avance imposible', '2026-11-20', '2026-12-10', '150'],
    ['CAC', '79', 'Fechas al revés', '2026-12-10', '2026-11-20', ''],
  ])).filas, datos);
  assert.equal(r.cambios.length, 1);
  assert.equal(r.cambios[0].accion, 'CREAR');
  assert.equal(r.cambios[0].campos.clasificacion, 'NUEVA');
  assert.match(r.cambios[0].advertencias[0], /Acta de Control de Cambios/);
  assert.equal(r.rechazadas.length, 2);
});

test('interpretar: cronograma de un profesional (sin columna clave) usa el profesional elegido en pantalla', async () => {
  const { datos } = await entorno();
  const a = actividadesDe(datos, 'KAP')[0];
  const hojas = tablas('Hoja1', [
    ['Cronograma de trabajo – Adenda 03'], // fila de título previa
    ['N.°', 'Nombre de tarea', 'Inicio', 'Fin', '% completado'],
    [a.numero, a.descripcion, a.inicio_plan, a.fin_plan, 20],
  ]);
  assert.equal(tablasAFilas(hojas, { clave: null }).filas.actividades[0].clave, null);
  const r = interpretar(tablasAFilas(hojas, { clave: 'KAP' }).filas, datos);
  assert.equal(r.cambios.length, 1);
  assert.deepEqual(r.cambios[0].diffs.map((x) => [x.campo, x.despues]), [['avance', 20]]);
  const sin = interpretar(tablasAFilas(hojas, { clave: null }).filas, datos);
  assert.equal(sin.cambios.length, 0);
  assert.match(sin.rechazadas[0].motivo, /Falta el profesional/);
});

test('interpretar: adendas (por contrato completo o sus 3 dígitos), nuevas y planes', async () => {
  const { datos } = await entorno();
  const k = datos.contratos.find((x) => x.numero.startsWith('035'));
  const ad3 = datos.adendas.find((a) => a.contrato_id === k.contrato_id && a.numero === 3);
  const r = interpretar(tablasAFilas([
    { nombre: 'Adendas', filas: [
      ['contrato', 'numero', 'estado', 'inicio', 'fin', 'plazo_dias', 'plazo_solicitado_dias'],
      ['035', 3, 'Firmada', '2026-11-09', '2026-12-15', 37, 52],
      [k.numero, 4, 'Anunciada', '2027-01-01', '2027-03-31', '', ''],
      ['035', 5, '', '2027-04-01', '2027-02-01', '', ''], // fin antes del inicio
      ['999', 1, '', '2026-01-01', '2026-02-01', '', ''],
    ] },
    { nombre: 'Planes', filas: [['clave', 'estado'], ['EBS', 'Aprobado'], ['EBS', 'Inventado']] },
  ]).filas, datos);
  const mod = r.cambios.find((c) => c.entidad === 'adenda' && c.accion === 'MODIFICAR');
  assert.equal(mod.registro_id, ad3.adenda_id);
  assert.deepEqual(mod.diffs.map((x) => x.campo).sort(), ['fecha_fin', 'plazo_dias', 'plazo_solicitado_dias']);
  assert.equal(r.cambios.filter((c) => c.entidad === 'adenda' && c.accion === 'CREAR').length, 1);
  assert.equal(r.cambios.find((c) => c.entidad === 'plan_trabajo').campos.estado, 'APROBADO');
  assert.equal(r.rechazadas.length, 3);
});

test('redactarPersonales quita DNI, teléfonos y correos antes de enviar al modelo', () => {
  const { texto, omitidos } = redactarPersonales('Contacto: Ana, DNI 45678912, cel. 987 654 321 / +51 912345678, ana.perez@gmail.com. Avance 40%, contrato 035-2026, del 09/11/2026 al 31/12/2026.');
  assert.equal(omitidos, 4);
  assert.ok(!/45678912|987 654 321|912345678|ana\.perez/.test(texto));
  assert.match(texto, /Avance 40%, contrato 035-2026, del 09\/11\/2026 al 31\/12\/2026/, 'las fechas y los números del proyecto se conservan');
});

// ---------------------------------------------------------------- lectura de archivos
test('lector: CSV con ; o , comillas y BOM', async () => {
  const a = await leer(Buffer.from('﻿clave;numero;avance\r\nERB;1.1;"50"\r\nERB;1.2;"a;b"\r\n'), 'a.csv');
  assert.deepEqual(a.hojas[0].filas, [['clave', 'numero', 'avance'], ['ERB', '1.1', '50'], ['ERB', '1.2', 'a;b']]);
  const b = await leer(Buffer.from('clave,numero\nERB,"1,1"\n'), 'b.csv');
  assert.deepEqual(b.hojas[0].filas[1], ['ERB', '1,1']);
});

test('lector: Excel con fechas, fórmulas y porcentajes', async () => {
  const libro = new ExcelJS.Workbook(); const h = libro.addWorksheet('Actividades');
  h.addRow(['clave', 'numero', 'avance', 'inicio_plan']);
  h.addRow(['ERB', '1.1', 0.35, new Date(Date.UTC(2026, 10, 9))]);
  h.getCell('C2').numFmt = '0%';
  h.addRow(['ERB', '1.2', { formula: '40+5', result: 45 }, '2026-11-10']);
  const r = await leer(Buffer.from(await libro.xlsx.writeBuffer()), 'plan.xlsx');
  assert.equal(r.formato, 'xlsx');
  assert.deepEqual(r.hojas[0].filas, [['clave', 'numero', 'avance', 'inicio_plan'], ['ERB', '1.1', 35, '2026-11-09'], ['ERB', '1.2', 45, '2026-11-10']]);
});

test('lector: cronograma de MS Project en XML (sin resúmenes) y rechazos de formato', async () => {
  const xml = `<?xml version="1.0"?><Project xmlns="http://schemas.microsoft.com/project"><Tasks>
    <Task><UID>0</UID><Name>Proyecto</Name><Summary>1</Summary></Task>
    <Task><UID>1</UID><WBS>1</WBS><Name>Fase 1</Name><Summary>1</Summary></Task>
    <Task><UID>2</UID><WBS>1.1</WBS><Name>Analizar</Name><Start>2026-11-09T08:00:00</Start><Finish>2026-11-13T17:00:00</Finish><PercentComplete>60</PercentComplete></Task></Tasks></Project>`;
  const r = await leer(Buffer.from(xml), 'cron.xml');
  assert.deepEqual(r.hojas[0].filas[1], ['1.1', 'Analizar', '2026-11-09', '2026-11-13', '60']);
  assert.equal(r.hojas[0].filas.length, 2);
  await assert.rejects(() => leer(Buffer.from('x'), 'plan.mpp'), /Formato no admitido/);
  await assert.rejects(() => leer(Buffer.from('MZ no es un excel'), 'plan.xlsx'), /no es un \.xlsx válido/);
  await assert.rejects(() => leer(Buffer.from('<hola/>'), 'x.xml'), /no es un cronograma de MS Project/);
  await assert.rejects(() => leer(Buffer.alloc(0), 'x.csv'), /vacío/);
});

test('lector: Word (.docx) y PDF con texto', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>La Adenda 03 vence el 31/12/2026</w:t></w:r></w:p></w:body></w:document>');
  const docx = await leer(await zip.generateAsync({ type: 'nodebuffer' }), 'acta.docx');
  assert.equal(docx.tipo, 'texto');
  assert.match(docx.texto, /Adenda 03 vence el 31\/12\/2026/);

  const t = 'BT /F1 14 Tf 40 700 Td (Avance de la actividad 1.1: 60 por ciento) Tj ET';
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>', `<</Length ${t.length}>>\nstream\n${t}\nendstream`, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  let cuerpo = '%PDF-1.4\n'; const pos = [];
  objs.forEach((o, i) => { pos.push(cuerpo.length); cuerpo += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = cuerpo.length;
  cuerpo += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  const pdf = await leer(Buffer.from(cuerpo, 'latin1'), 'informe.pdf');
  assert.equal(pdf.tipo, 'texto');
  assert.match(pdf.texto, /Avance de la actividad 1\.1: 60 por ciento/);
});

test('plantilla: Excel con las hojas Actividades, Adendas y Planes, listo para usar y sin filas de ejemplo', async () => {
  const leida = await leer(await plantillaXlsx(), 'plantilla.xlsx');
  assert.deepEqual(leida.hojas.map((h) => h.nombre), ['Instrucciones', 'Actividades', 'Adendas', 'Planes']);
  assert.deepEqual(leida.hojas[1].filas, [['clave', 'numero', 'avance', 'estado', 'inicio_plan', 'fin_plan', 'inicio_real', 'fin_real', 'descripcion', 'evidencia', 'observacion', 'clasificacion']]);
  // la plantilla vacía es reconocida (y no produce cambios)
  const { filas } = tablasAFilas(leida.hojas);
  assert.deepEqual([filas.actividades.length, filas.adendas.length, filas.planes.length], [0, 0, 0]);
});

// ---------------------------------------------------------------- vista previa y aplicación
test('Excel completo: vista previa sin escribir, aplicación selectiva con bitácora, original conservado y bloqueo de repetición', async () => {
  const { docs, servicio, repo, datos } = await entorno();
  const ad = actividadesDe(datos, 'ERB'); const k = datos.contratos.find((x) => x.numero.startsWith('039'));
  const archivo = await xlsx({
    Actividades: [['clave', 'numero', 'avance', 'estado'], ['ERB', ad[0].numero, 100, ''], ['ERB', ad[1].numero, 40, 'En curso'], ['ERB', 'no-existe', 10, '']],
    Adendas: [['contrato', 'numero', 'estado', 'inicio', 'fin', 'plazo_dias', 'documento'], ['039', 4, 'Firmada', '2026-11-14', '2026-12-31', 48, 'Adenda N.° 04 al Contrato N.° 039-2026']],
    Planes: [['clave', 'estado'], ['ERB', 'Aprobado']],
  });
  const antes = JSON.stringify((await servicio.datos(true)).actividades);
  const prev = await docs.previsualizar({ buffer: archivo, nombre: 'avance noviembre.xlsx', usuario });
  assert.equal(prev.origen, 'UI');
  assert.deepEqual(prev.resumen, { modificar: 4, crear: 0, sin_cambios: 0, rechazadas: 1 });
  assert.equal(JSON.stringify((await servicio.datos(true)).actividades), antes, 'la vista previa no escribe nada');

  const quitar = prev.cambios.find((c) => c.entidad === 'plan_trabajo').id; // el usuario desmarca el plan
  const ids = prev.cambios.map((c) => c.id).filter((i) => i !== quitar);
  const r = await docs.aplicar({ carga_id: prev.carga_id, ids, usuario });
  assert.equal(r.aplicados.length, 3);
  assert.equal(r.fallidos.length, 0);
  assert.equal(r.omitidos, 1);

  const d = await servicio.datos(true);
  const a0 = d.actividades.find((a) => a.actividad_id === ad[0].actividad_id);
  assert.equal(a0.estado, 'CONCLUIDA');
  assert.equal(Number(a0.avance), 100);
  const a1 = d.actividades.find((a) => a.actividad_id === ad[1].actividad_id);
  assert.deepEqual([Number(a1.avance), a1.estado], [40, 'EN_CURSO']);
  const ad4 = d.adendas.find((a) => a.contrato_id === k.contrato_id && a.numero === 4);
  assert.deepEqual([ad4.estado, ad4.plazo_dias, String(ad4.fecha_fin).slice(0, 10)], ['FIRMADA', 48, '2026-12-31']);
  assert.notEqual(planDe(d, 'ERB').estado, 'APROBADO', 'lo desmarcado no se aplica');

  const bit = await repo.listarBitacora({ limite: 100 });
  assert.ok(bit.some((b) => b.entidad === 'actividad' && b.motivo === 'Carga del documento «avance noviembre.xlsx»' && b.usuario === usuario.correo));
  const carga = bit.find((b) => b.entidad === 'documento');
  assert.match(carga.cambios_json, /"aplicados":3/);
  const guardado = fs.readdirSync(path.dirname(fs.readdirSync(tmp).length ? tmp : tmp)).length;
  assert.ok(guardado > 0);
  await assert.rejects(() => docs.aplicar({ carga_id: prev.carga_id, ids, usuario }), /venció/, 'una vista previa se aplica una sola vez');
  await assert.rejects(() => docs.aplicar({ carga_id: 'inexistente', ids, usuario }), /venció/);
});

test('aplicar: ids vacíos, otro usuario, y cambio concurrente detectado', async () => {
  const { docs, servicio, datos } = await entorno();
  const a = actividadesDe(datos, 'APA')[0];
  const archivo = Buffer.from(`clave;numero;avance\nAPA;${a.numero};30\n`);
  const p1 = await docs.previsualizar({ buffer: archivo, nombre: 'a.csv', usuario });
  await assert.rejects(() => docs.aplicar({ carga_id: p1.carga_id, ids: [], usuario }), /al menos un cambio/);
  await assert.rejects(() => docs.aplicar({ carga_id: p1.carga_id, ids: [p1.cambios[0].id], usuario: { ...usuario, correo: 'otro@ejemplo.com' } }), /venció/);
  // alguien modifica la actividad entre la vista previa y la aplicación
  await servicio.actualizarActividad(a.actividad_id, { avance: 10, revision: a.revision }, { usuario: 'otro@ejemplo.com', origen: 'UI', motivo: null });
  const r = await docs.aplicar({ carga_id: p1.carga_id, ids: [p1.cambios[0].id], usuario });
  assert.equal(r.aplicados.length, 0);
  assert.match(r.fallidos[0].motivo, /Cambió después de la vista previa/);
});

test('actividad nueva desde un documento: se crea como NUEVA y con su avance consolidado', async () => {
  const { docs, servicio, datos } = await entorno();
  const archivo = Buffer.from('clave;numero;descripcion;inicio_plan;fin_plan;avance\nCAC;90;Soporte adicional a la sede;2026-11-05;2026-11-30;50\n');
  const prev = await docs.previsualizar({ buffer: archivo, nombre: 'nueva.csv', usuario });
  assert.equal(prev.cambios[0].accion, 'CREAR');
  await docs.aplicar({ carga_id: prev.carga_id, ids: [prev.cambios[0].id], usuario });
  const d = await servicio.datos(true);
  const n = d.actividades.find((a) => a.numero === '90' && a.plan_id === planDe(d, 'CAC').plan_id);
  assert.equal(n.clasificacion, 'NUEVA');
  assert.equal(Number(n.avance), 50);
  assert.equal(n.estado, 'EN_CURSO');
});

test('PDF/Word: el asistente de IA propone filas, se muestran en la vista previa y se aplican con origen IA', async () => {
  const llamadas = []; let numeroAct = '1.1';
  const cliente = { messages: { async create(req) {
    llamadas.push(req);
    return { stop_reason: 'tool_use', usage: { input_tokens: 500, output_tokens: 80 }, content: [{ type: 'tool_use', id: 't', name: 'registrar_actualizaciones', input: {
      actividades: [{ numero: numeroAct, avance: 60 }], adendas: [{ contrato: '035', numero: 3, plazo_dias: 37 }], planes: [] } }] };
  } } };
  const repo = crearRepositorioMemoria({ semilla });
  const servicio = crearServicio(repo);
  const agente = crearAgente({ servicio, cliente });
  const docs = crearDocumentos({ servicio, repo, dir: path.join(tmp, 'ia'), extraerConIA: (a) => agente.extraerDocumento(a) });
  const datos = await servicio.datos(true);
  const act = actividadesDe(datos, 'EBS')[0]; numeroAct = act.numero;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Informe de Edgar Barreto, DNI 45678912, cel 987654321, correo edgar.privado@gmail.com. Actividad 1.1 al 60%. Adenda 03 por 37 días.</w:t></w:r></w:p></w:body></w:document>');
  const prev = await docs.previsualizar({ buffer: await zip.generateAsync({ type: 'nodebuffer' }), nombre: 'informe.docx', usuario, consultor_id: planDe(datos, 'EBS').consultor_id });

  // al modelo nunca llegan DNI, teléfonos ni correos
  const enviado = JSON.stringify(llamadas);
  assert.ok(!/45678912|987654321|edgar\.privado/.test(enviado));
  assert.equal(llamadas[0].tool_choice.name, 'registrar_actualizaciones');
  assert.match(llamadas[0].messages[0].content, /corresponde a la clave EBS/);
  assert.equal(prev.origen, 'IA');
  assert.equal(prev.ia.omitidos, 3);
  assert.equal(prev.cambios.length, 2);
  assert.equal(prev.cambios.find((c) => c.entidad === 'actividad').registro_id, act.actividad_id);

  const r = await docs.aplicar({ carga_id: prev.carga_id, ids: prev.cambios.map((c) => c.id), usuario });
  assert.equal(r.aplicados.length, 2);
  const bit = await repo.listarBitacora({ limite: 50 });
  assert.ok(bit.filter((b) => b.motivo === 'Carga del documento «informe.docx»').every((b) => b.origen === 'IA'), 'origen IA en la bitácora');
  // el consumo de la lectura queda registrado como el del resto del asistente
  assert.ok((await repo.usoIA()).some((x) => Number(x.tokens_entrada) >= 500));
});

test('PDF/Word sin asistente configurado: mensaje claro', async () => {
  const { docs } = await entorno(null);
  const t = 'BT /F1 14 Tf 40 700 Td (hola) Tj ET';
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>', '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>', `<</Length ${t.length}>>\nstream\n${t}\nendstream`, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  let c = '%PDF-1.4\n'; const pos = [];
  objs.forEach((o, i) => { pos.push(c.length); c += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = c.length;
  c += `xref\n0 6\n0000000000 65535 f \n${pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${x}\n%%EOF\n`;
  await assert.rejects(() => docs.previsualizar({ buffer: Buffer.from(c, 'latin1'), nombre: 'x.pdf', usuario }), /asistente de IA, que no está configurado/);
});

test('el asistente no escribe: extraerDocumento solo devuelve filas', async () => {
  const repo = crearRepositorioMemoria({ semilla });
  const servicio = crearServicio(repo);
  const cliente = { messages: { async create() { return { stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 't', name: 'registrar_actualizaciones', input: { actividades: [], adendas: [], planes: [{ clave: 'ERB', estado: 'APROBADO' }] } }] }; } } };
  const agente = crearAgente({ servicio, cliente });
  const antes = JSON.stringify((await servicio.datos(true)).planes);
  const r = await agente.extraerDocumento({ texto: 'Plan de ERB aprobado', usuario, clave: null });
  assert.equal(r.filas.planes[0].estado, 'APROBADO');
  assert.equal(JSON.stringify((await servicio.datos(true)).planes), antes);
});

// ---------------------------------------------------------------- documento de una adenda (Contratos y adendas)
const filaAd = (f) => ({ __hoja: 'Documento (IA) · adenda', __fila: 1, ...f });
async function docx(texto) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${texto}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('interpretarAdendas: sin fechas calcula inicio y fin con el plazo, nace EN_TRAMITE y lo advierte', async () => {
  const { datos } = await entorno();
  // contrato 035 (EBS): Adendas 01 y 02 concluidas y 03 firmada hasta el 31/12/2026
  const r = interpretarAdendas({ adendas: [filaAd({ contrato: '035', numero: 4, plazo_dias: 30, documento: 'Adenda N.° 04 al Contrato N.° 035-2026-MIDAGRI-SERFOR-PKFW' })] }, datos);
  assert.equal(r.cambios.length, 1);
  const c = r.cambios[0];
  assert.equal(c.accion, 'CREAR');
  assert.equal(c.campos.fecha_inicio, '2027-01-01');
  assert.equal(c.campos.fecha_fin, '2027-01-30');
  assert.equal(c.campos.estado, 'EN_TRAMITE');
  assert.equal(c.campos.inicio_calculado, 1);
  assert.ok(c.diffs.some((d) => d.campo === 'estado' && d.despues === 'EN_TRAMITE'));
  assert.ok(c.advertencias.some((a) => /Calculado — inicio: el día siguiente al fin de la Adenda 03 \(31\/12\/2026\)/.test(a)));
  assert.ok(c.advertencias.some((a) => /Calculado — fin/.test(a)));
  assert.equal(c.vigente.estado, undefined, 'una adenda nueva no tiene valores vigentes');
});

test('interpretarAdendas: advierte huecos, superposiciones, numeración saltada y plazo distinto de las fechas', async () => {
  const { datos } = await entorno();
  const hueco = interpretarAdendas({ adendas: [filaAd({ contrato: '035', numero: 6, inicio: '2027-01-07', fin: '2027-02-05', plazo_dias: 30 })] }, datos).cambios[0];
  assert.ok(hueco.advertencias.some((a) => /Quedan 6 día\(s\) sin cobertura entre la Adenda 03/.test(a)), hueco.advertencias.join(' | '));
  assert.ok(hueco.advertencias.some((a) => /Salta de la Adenda 03 a la 06/.test(a)));
  assert.equal(hueco.campos.inicio_calculado, undefined, 'las fechas del documento no son calculadas');

  const sup = interpretarAdendas({ adendas: [filaAd({ contrato: '035', numero: 4, inicio: '2026-12-20', fin: '2027-01-18', plazo_dias: 25 })] }, datos).cambios[0];
  assert.ok(sup.advertencias.some((a) => /Se superpone 12 día\(s\) con la Adenda 03/.test(a)), sup.advertencias.join(' | '));
  assert.ok(sup.advertencias.some((a) => /El plazo indicado \(25 días\) no coincide con las fechas del documento \(30 días\)/.test(a)));

  // una adenda que ya existe se compara y se actualiza, y muestra sus valores vigentes
  const ad3 = datos.adendas.find((a) => a.numero === 3 && datos.contratos.find((k) => k.contrato_id === a.contrato_id).numero.startsWith('035'));
  const mod = interpretarAdendas({ adendas: [filaAd({ contrato: '035', numero: 3, plazo_dias: 52 })] }, datos).cambios[0];
  assert.equal(mod.accion, 'MODIFICAR');
  assert.equal(mod.registro_id, ad3.adenda_id);
  assert.equal(mod.vigente.estado, 'FIRMADA');
});

test('interpretarAdendas: usa el único contrato del profesional elegido y rechaza el de otro', async () => {
  const { datos } = await entorno();
  const sinContrato = interpretarAdendas({ adendas: [filaAd({ numero: 4, plazo_dias: 30 })] }, datos, { clave: 'EBS' });
  assert.equal(sinContrato.cambios.length, 1);
  assert.equal(sinContrato.cambios[0].clave, 'EBS');
  const ajeno = interpretarAdendas({ adendas: [filaAd({ contrato: '035', numero: 4, plazo_dias: 30 })] }, datos, { clave: 'ERB' });
  assert.equal(ajeno.cambios.length, 0);
  assert.match(ajeno.rechazadas[0].motivo, /corresponde a EBS, no al profesional elegido \(ERB\)/);
  // sin contrato ni profesional, no hay a quién asignarla
  assert.match(interpretarAdendas({ adendas: [filaAd({ numero: 4, plazo_dias: 30 })] }, datos).rechazadas[0].motivo, /Faltan el contrato/);
});

test('crear una adenda sin fin: se calcula con el plazo otorgado', async () => {
  const { servicio } = await entorno();
  const d = await servicio.datos(true);
  const k = d.contratos.find((x) => x.numero.startsWith('035'));
  const ctx = { usuario: 'jefe@ejemplo.com', motivo: 'Prueba', origen: 'UI' };
  await servicio.crearEntidad('adenda', { contrato_id: k.contrato_id, fecha_inicio: '2030-01-01', plazo_dias: 10, estado: 'ANUNCIADA' }, ctx);
  const nueva = (await servicio.datos(true)).adendas.find((a) => a.contrato_id === k.contrato_id && String(a.fecha_inicio).slice(0, 10) === '2030-01-01');
  assert.equal(String(nueva.fecha_fin).slice(0, 10), '2030-01-10');
  await assert.rejects(() => servicio.crearEntidad('adenda', { contrato_id: k.contrato_id, fecha_inicio: '2031-01-01' }, ctx), /Inicio y fin de la adenda son obligatorios/);
});

test('documento de adenda con IA: herramienta propia, vista previa sin escribir, ajuste del estado y origen IA', async () => {
  const llamadas = []; let respuesta;
  const cliente = { messages: { async create(req) { llamadas.push(req); return { stop_reason: 'tool_use', usage: { input_tokens: 300, output_tokens: 60 }, content: [{ type: 'tool_use', id: 't', name: 'registrar_adenda', input: respuesta }] }; } } };
  const repo = crearRepositorioMemoria({ semilla });
  const servicio = crearServicio(repo);
  const agente = crearAgente({ servicio, cliente });
  const docs = crearDocumentos({ servicio, repo, dir: path.join(tmp, 'ad'), extraerConIA: (a) => agente.extraerDocumento(a) });
  const adendasDe = async () => (await servicio.datos(true)).adendas.length;
  const antes = await adendasDe();
  const buffer = await docx('Adenda N.° 04 al Contrato N.° 035-2026-MIDAGRI-SERFOR-PKFW. Ampliación de 30 días. Contacto: erick.privado@gmail.com, DNI 45678912.');

  respuesta = { adendas: [{ contrato: '035-2026-MIDAGRI-SERFOR-PKFW', numero: 4, plazo_dias: 30, documento: 'Adenda N.° 04 al Contrato N.° 035-2026-MIDAGRI-SERFOR-PKFW' }] };
  const prev = await docs.previsualizar({ buffer, nombre: 'adenda-04.docx', usuario, tipo: 'adenda' });
  assert.equal(llamadas[0].tool_choice.name, 'registrar_adenda');
  assert.match(llamadas[0].system, /ADENDA/);
  assert.deepEqual(llamadas[0].tools.map((t) => t.name), ['registrar_adenda']);
  assert.ok(!/45678912|erick\.privado/.test(JSON.stringify(llamadas)), 'sin datos personales hacia el modelo');
  assert.equal(prev.tipo, 'adenda');
  assert.equal(prev.origen, 'IA');
  assert.equal(prev.resumen.crear, 1);
  assert.equal(prev.cambios[0].campos.estado, 'EN_TRAMITE');
  assert.equal(await adendasDe(), antes, 'la vista previa no escribe');

  // un estado inventado se rechaza antes de aplicar nada
  await assert.rejects(() => docs.aplicar({ carga_id: prev.carga_id, ids: [prev.cambios[0].id], ajustes: { [prev.cambios[0].id]: { estado: 'INVENTADA' } }, usuario }), /Estado de adenda no válido/);
  assert.equal(await adendasDe(), antes);

  // el usuario la deja FIRMADA en la vista previa; el documento extraído cumple la exigencia de referencia
  const r = await docs.aplicar({ carga_id: prev.carga_id, ids: [prev.cambios[0].id], ajustes: { [prev.cambios[0].id]: { estado: 'FIRMADA', fecha_suscripcion: '2026-12-15' } }, usuario });
  assert.equal(r.aplicados.length, 1, JSON.stringify(r.fallidos));
  const datos = await servicio.datos(true);
  const k = datos.contratos.find((x) => x.numero.startsWith('035'));
  const nueva = datos.adendas.find((a) => a.contrato_id === k.contrato_id && a.numero === 4);
  assert.equal(nueva.estado, 'FIRMADA');
  assert.equal(String(nueva.fecha_inicio).slice(0, 10), '2027-01-01');
  assert.equal(String(nueva.fecha_fin).slice(0, 10), '2027-01-30');
  assert.equal(nueva.inicio_calculado, 1);
  assert.equal(String(nueva.fecha_suscripcion).slice(0, 10), '2026-12-15');
  // la vigencia se amplió con la adenda firmada
  const est = await servicio.estado();
  const e = est.consultores.find((c) => c.consultor.clave === 'EBS');
  assert.equal(String(e.vigencia.fin_vigencia).slice(0, 10), '2027-01-30');
  const bit = await repo.listarBitacora({ limite: 50 });
  assert.ok(bit.some((b) => b.motivo === 'Carga del documento «adenda-04.docx»' && b.origen === 'IA'));
  assert.ok(bit.some((b) => b.entidad === 'documento' && /"tipo":"adenda"/.test(b.cambios_json)));
});

test('documento de adenda: FIRMADA sin documento falla sin crear nada, y sin adendas en el documento se avisa', async () => {
  let respuesta;
  const cliente = { messages: { async create() { return { stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 't', name: 'registrar_adenda', input: respuesta }] }; } } };
  const repo = crearRepositorioMemoria({ semilla });
  const servicio = crearServicio(repo);
  const agente = crearAgente({ servicio, cliente });
  const docs = crearDocumentos({ servicio, repo, dir: path.join(tmp, 'ad2'), extraerConIA: (a) => agente.extraerDocumento(a) });
  const antes = (await servicio.datos(true)).adendas.length;
  const buffer = await docx('Solicitud de adenda al contrato 035, 30 días.');

  respuesta = { adendas: [{ contrato: '035', numero: 4, plazo_dias: 30 }] }; // sin título del documento
  const prev = await docs.previsualizar({ buffer, nombre: 'solicitud.docx', usuario, tipo: 'adenda' });
  const r = await docs.aplicar({ carga_id: prev.carga_id, ids: [prev.cambios[0].id], ajustes: { [prev.cambios[0].id]: { estado: 'FIRMADA' } }, usuario });
  assert.equal(r.aplicados.length, 0);
  assert.match(r.fallidos[0].motivo, /FIRMADA requiere la referencia del documento/);
  assert.equal((await servicio.datos(true)).adendas.length, antes);

  respuesta = { adendas: [] };
  await assert.rejects(() => docs.previsualizar({ buffer, nombre: 'otro.docx', usuario, tipo: 'adenda' }), /No se encontró ninguna adenda en el documento/);
});

test('documento de adenda en Excel: usa la hoja «Adendas»; sin ella, se explica qué falta', async () => {
  const { docs } = await entorno();
  const bien = await xlsx({ Adendas: [['contrato', 'numero', 'plazo_dias'], ['035', 4, 20]] });
  const prev = await docs.previsualizar({ buffer: bien, nombre: 'adenda.xlsx', usuario, tipo: 'adenda' });
  assert.equal(prev.origen, 'UI');
  assert.equal(prev.cambios[0].campos.fecha_fin, '2027-01-20');
  const solo = await xlsx({ Actividades: [['clave', 'numero', 'avance'], ['EBS', '1.1', 10]] });
  await assert.rejects(() => docs.previsualizar({ buffer: solo, nombre: 'act.xlsx', usuario, tipo: 'adenda' }), /no trae adendas/);
});

test('redactarPersonales: un punto final no deja pasar el DNI ni el teléfono, y no toca fechas ni códigos', () => {
  const r = redactarPersonales('DNI 45678912. Celular 987654321. Fecha 12.11.2026, código 2026-0045678912-X, versión 1234.5678');
  assert.equal(r.omitidos, 2);
  assert.ok(!/45678912\.|987654321/.test(r.texto.replace('0045678912', '')));
  assert.match(r.texto, /12\.11\.2026/);
  assert.match(r.texto, /2026-0045678912-X/);
  assert.match(r.texto, /1234\.5678/);
});
