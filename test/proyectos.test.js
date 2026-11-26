'use strict';
/**
 * Registro del proyecto desde su Orden de Servicio y su TDR (server/proyectos.js): periodo calculado con el inicio
 * y el plazo, documentos del proyecto en el almacén (la OS confidencial) y lectura de los PDF con o sin IA.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-proyectos-'));
Object.assign(process.env, {
  MODO_DATOS: 'memoria', ARCHIVO_DEMO: path.join(tmp, 'demo.json'), DOCUMENTOS_RAIZ: path.join(tmp, 'almacen'),
  PLANES_PDF_DIR: path.join(tmp, 'planes-pdf'), ADENDAS_PDF_DIR: path.join(tmp, 'adendas-pdf'), CONTRATOS_PDF_DIR: path.join(tmp, 'contratos-pdf'),
  PLANES_ORIGEN_DIR: path.join(tmp, 'planes-origen'), ACTIVIDADES_PDF_DIR: path.join(tmp, 'actividades-pdf'), DOCUMENTOS_DIR: path.join(tmp, 'documentos'),
  ADMIN_CORREO: 'admin.proyectos@serfor.gob.pe', ADMIN_CLAVE_INICIAL: 'ClaveProyectos2026x', ANTHROPIC_API_KEY: '',
});
const { crearApp } = require('../server/server');
const { crearProyectos, extraerDatosSinIA, finPorPlazo, plazoDe } = require('../server/proyectos');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
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
  llamar.cookie = () => cookie;
  llamar.pdf = async (nombre = 'documento.pdf') => {
    const r = await fetch(`${base}/api/documentos/temporales`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-SGF': '1', 'X-Nombre': encodeURIComponent(nombre), Cookie: cookie }, body: PDF });
    return (await r.json()).token;
  };
  return llamar;
}
let admin;

test.before(async () => {
  const { app } = await crearApp();
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
  admin = cliente();
  assert.equal((await admin.entrar('admin.proyectos@serfor.gob.pe', 'ClaveProyectos2026x')).estado, 200);
});
test.after(() => servidor.close());

const TDR = `TÉRMINOS DE REFERENCIA
1. DENOMINACIÓN DE LA CONTRATACIÓN
Servicio de mejoras al aplicativo SISCATE de la Dirección de Fortalecimiento de Capacidades.
2. ÁREA USUARIA
Dirección de Fortalecimiento de Capacidades
3. ANTECEDENTES
La Dirección de Fortalecimiento de Capacidades utiliza el Sistema de Registros y Reportes de Capacitaciones y Asistencias Técnicas (SISCATE) para la gestión integral de los eventos de capacitación.
4. OBJETIVO GENERAL
Contar con el análisis, desarrollo y mantenimiento del SISCATE.
5. PLAZO DE EJECUCIÓN
El plazo de ejecución del servicio es de noventa (90) días calendario, contados desde el día siguiente de notificada la orden.
6. FUENTE DE FINANCIAMIENTO
Recursos Ordinarios.
`;
const OS = `ORDEN DE SERVICIO N° 0001234-2026
Concepto: servicio de mejoras al aplicativo SISCATE
Plazo de ejecución: 90 días calendario
Correo: alguien@ejemplo.com DNI 12345678
`;

test('lectura sin IA: nombre, unidad usuaria, objetivo, descripción, financiamiento, plazo y número de la OS', () => {
  const r = extraerDatosSinIA({ tdr: TDR, os: OS });
  assert.equal(r.nombre, 'Servicio de mejoras al aplicativo SISCATE de la Dirección de Fortalecimiento de Capacidades.');
  assert.equal(r.unidad_usuaria, 'Dirección de Fortalecimiento de Capacidades');
  assert.match(r.descripcion, /^La Dirección de Fortalecimiento de Capacidades utiliza el Sistema/);
  assert.equal(r.objetivo, 'Contar con el análisis, desarrollo y mantenimiento del SISCATE.');
  assert.equal(r.financiador, 'Recursos Ordinarios.');
  assert.equal(r.plazo_dias, 90);
  assert.equal(r.numero_os, '0001234-2026');
  // sin datos reconocibles: todo null
  const vacio = extraerDatosSinIA({ tdr: 'texto sin estructura', os: '' });
  assert.equal(vacio.nombre, null); assert.equal(vacio.plazo_dias, null);
  // los días hábiles no son el plazo calendario
  assert.equal(plazoDe('Plazo de revisión: 5 días hábiles. Plazo de ejecución: 60 días calendario.'), 60);
});

test('periodo: fin = inicio + plazo − 1 (días calendario)', () => {
  assert.equal(finPorPlazo('2026-08-24', 90), '2026-11-21');
  assert.equal(finPorPlazo('2026-12-31', 1), '2026-12-31');
  assert.throws(() => finPorPlazo('', 30), /fecha de inicio/);
  assert.throws(() => finPorPlazo('2026-08-24', 0), /días calendario/);
  assert.throws(() => finPorPlazo('2026-08-24', 2.5), /días calendario/);
});

test('API: registrar proyecto con OS y TDR calcula el periodo y guarda los documentos (OS confidencial)', async () => {
  const r = await admin('POST', '/api/proyectos', {
    nombre: 'Mejoras al Aplicativo SISCATE', modalidad: 'ORDEN_SERVICIO', unidad_usuaria: 'Dirección de Fortalecimiento de Capacidades',
    fecha_inicio: '2026-08-24', plazo_dias: 90, objetivo: 'Análisis y desarrollo del SISCATE',
    documentos: { TDR: await admin.pdf('tdr-siscate.pdf'), ORDEN_SERVICIO: await admin.pdf('os-siscate.pdf') },
  });
  assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
  assert.equal(String(r.cuerpo.fecha_fin).slice(0, 10), '2026-11-21');
  assert.equal(r.cuerpo.documentos.length, 2);
  assert.deepEqual(r.cuerpo.documentos_pendientes, []);
  const p = (await admin('GET', '/api/proyectos')).cuerpo.find((x) => x.proyecto_id === r.cuerpo.proyecto_id);
  assert.deepEqual(p.documentos.map((d) => d.tipo).sort(), ['ORDEN_SERVICIO', 'TDR']);
  assert.equal(p.documentos.find((d) => d.tipo === 'TDR').nombre_original, 'tdr-siscate.pdf');
  const docs = (await admin('GET', `/api/documentos?entidad=proyecto&entidad_id=${p.proyecto_id}`)).cuerpo;
  assert.equal(docs.find((d) => d.tipo === 'ORDEN_SERVICIO').confidencial, true);
  assert.equal(docs.find((d) => d.tipo === 'TDR').confidencial, false);

  // un Jefe de Proyecto fuera del equipo ve que existe la OS, pero no su archivo
  const alta = await admin('POST', '/api/usuarios', { correo: 'jefe.proyectos@serfor.gob.pe', nombre: 'Jefe de prueba', rol: 'JEFE_PROYECTO' });
  const jefe = cliente(); await jefe.entrar('jefe.proyectos@serfor.gob.pe', alta.cuerpo.clave_temporal);
  const visto = (await jefe('GET', '/api/proyectos')).cuerpo.find((x) => x.proyecto_id === p.proyecto_id);
  assert.deepEqual(visto.documentos.find((d) => d.tipo === 'ORDEN_SERVICIO'), { tipo: 'ORDEN_SERVICIO', oculto: true });
  assert.ok(visto.documentos.find((d) => d.tipo === 'TDR').documento_id);
  // solo el Administrador registra proyectos o lee sus documentos para registrarlos
  assert.equal((await jefe('POST', '/api/proyectos', { nombre: 'No permitido' })).estado, 403);
  assert.equal((await jefe('POST', '/api/proyectos/leer-documentos', { documentos: {} })).estado, 403);

  // editar: el plazo recalcula el fin con el inicio registrado; un documento nuevo es otra versión
  const e = await admin('PATCH', `/api/proyectos/${p.proyecto_id}`, { plazo_dias: 120, revision: p.revision, documentos: { TDR: await admin.pdf('tdr-v2.pdf') } });
  assert.equal(e.estado, 200, JSON.stringify(e.cuerpo));
  assert.equal(String(e.cuerpo.fecha_fin).slice(0, 10), '2026-12-21');
  assert.equal(e.cuerpo.documentos[0].version, 2);
  // el inicio enviado manda sobre el registrado
  const e2 = await admin('PATCH', `/api/proyectos/${p.proyecto_id}`, { fecha_inicio: '2026-09-01', plazo_dias: 30, revision: e.cuerpo.revision });
  assert.equal(String(e2.cuerpo.fecha_fin).slice(0, 10), '2026-09-30');
  // sin plazo, la edición no toca el fin
  const e3 = await admin('PATCH', `/api/proyectos/${p.proyecto_id}`, { objetivo: 'Otro objetivo', revision: e2.cuerpo.revision });
  assert.equal(String(e3.cuerpo.fecha_fin).slice(0, 10), '2026-09-30');
});

test('API: el plazo exige inicio y debe ser válido; sin documentos el proyecto se registra igual', async () => {
  assert.equal((await admin('POST', '/api/proyectos', { nombre: 'Proyecto sin inicio', plazo_dias: 30 })).estado, 400);
  assert.equal((await admin('POST', '/api/proyectos', { nombre: 'Proyecto con plazo raro', fecha_inicio: '2026-08-01', plazo_dias: -3 })).estado, 400);
  assert.equal((await admin('POST', '/api/proyectos', { nombre: 'Proyecto con token falso', documentos: { TDR: 'no-existe' } })).estado, 400);
  const r = await admin('POST', '/api/proyectos', { nombre: 'Gestión interna de prueba', modalidad: 'GESTION_INTERNA', fecha_inicio: '2026-08-01' });
  assert.equal(r.estado, 200);
  assert.equal(r.cuerpo.fecha_fin ?? null, null);
  assert.deepEqual(r.cuerpo.documentos, []);
  // un PDF sin texto: se informa y no se propone nada
  const leido = await admin('POST', '/api/proyectos/leer-documentos', { documentos: { TDR: await admin.pdf('escaneado.pdf') } });
  assert.equal(leido.estado, 200);
  assert.equal(leido.cuerpo.origen, null);
  assert.match(leido.cuerpo.advertencias[0], /No se pudo leer texto/);
  assert.equal((await admin('POST', '/api/proyectos/leer-documentos', { documentos: {} })).estado, 400);
});

test('lectura de documentos: la IA manda, el texto completa lo que falta y, si la IA falla, se usa el texto', async () => {
  const temporales = { t1: { nombre: 'tdr.pdf', buffer: Buffer.from('TDR') }, o1: { nombre: 'os.pdf', buffer: Buffer.from('OS') } };
  const contrataciones = { tomarTemporal: (tok) => { if (!temporales[tok]) throw Object.assign(new Error('Adjunte'), { estado: 400 }); return temporales[tok]; }, liberarTemporal: () => {} };
  const leerDocumento = async (buf) => ({ texto: String(buf) === 'TDR' ? TDR : OS });
  let enviado = '';
  const conIA = crearProyectos({ servicio: {}, almacen: {}, contrataciones, leerDocumento, extraerConIA: async ({ texto }) => { enviado = texto; return { proyecto: { nombre: 'Mejoras al Aplicativo SISCATE', objetivo: null, plazo_dias: 120 }, omitidos: 2 }; } });
  const r = await conIA.leerDocumentos({ TDR: 't1', ORDEN_SERVICIO: 'o1' }, { usuario: 'admin' });
  assert.equal(r.origen, 'IA');
  assert.equal(r.nombre, 'Mejoras al Aplicativo SISCATE'); // de la IA
  assert.equal(r.plazo_dias, 120); // la IA manda
  assert.equal(r.objetivo, 'Contar con el análisis, desarrollo y mantenimiento del SISCATE.'); // la IA no lo dio: del texto
  assert.equal(r.datos_personales_omitidos, 2);
  assert.match(enviado, /=== ORDEN DE SERVICIO ===[\s\S]*=== TÉRMINOS DE REFERENCIA ===/);

  const iaCaida = crearProyectos({ servicio: {}, almacen: {}, contrataciones, leerDocumento, extraerConIA: async () => { throw new Error('sin conexión'); } });
  const r2 = await iaCaida.leerDocumentos({ TDR: 't1', ORDEN_SERVICIO: 'o1' }, { usuario: 'admin' });
  assert.equal(r2.origen, 'TEXTO');
  assert.equal(r2.plazo_dias, 90);
  assert.match(r2.advertencias.join(' '), /No se pudo usar el asistente de IA \(sin conexión\)/);
});

// ---------------------------------------------------------------- Registrar Orden de Servicio desde la OS y el TDR
const { extraerOrdenServicioSinIA, sugerirClave, quitarMontos, aMonto, proveedorDeOS, ordenarNombre, mismaPersona } = require('../server/proyectos');
const { redactarPersonales } = require('../server/documentos/interprete');
const OS_SIGA = `ORDEN DE SERVICIO Nº 0001279
Fecha: 20/11/2026
Señor(es): ARAMBULO AQUIJES JUAN JOSE   R.U.C.: 10456789123
Exp. SIAF: 0000003316
Concepto: Servicio para el análisis, desarrollo, mejoramiento y mantenimiento en sistemas informáticos (SISCATE)
Plazo de ejecución: 120 días calendario
TOTAL S/ 24,000.00`;
const TDR_OS = `TÉRMINOS DE REFERENCIA
1. DENOMINACIÓN DE LA CONTRATACIÓN
Servicio para el análisis, desarrollo, mejoramiento y mantenimiento en sistemas informáticos (SISCATE).
2. PERFIL DEL PROFESIONAL
Analista programador.
3. ENTREGABLES
Primer entregable: plan de trabajo, hasta los 10 días calendario. Segundo entregable: informe de avance, hasta los 60 días calendario. Tercer entregable: informe final, hasta los ciento veinte (120) días calendario.
4. PLAZO DE EJECUCIÓN
El plazo es de ciento veinte (120) días calendario.`;

test('lectura sin IA de la OS y el TDR del profesional: número, expediente, monto, nombre, clave, plazo y entregables', () => {
  const r = extraerOrdenServicioSinIA({ os: OS_SIGA, tdr: TDR_OS, claves: ['MQR'] });
  assert.equal(r.numero, '1279');
  assert.equal(r.expediente, '3316');
  assert.equal(r.monto, 24000);
  assert.equal(r.nombres, 'JUAN JOSE ARAMBULO AQUIJES'); // «Señor(es)» de la OS (APELLIDOS NOMBRES), como nombres y apellidos
  assert.equal(r.clave, 'JJA');
  assert.equal(r.plazo_dias, 120);
  assert.equal(r.perfil, 'Analista programador');
  assert.match(r.titulo_tdr, /^Servicio para el análisis, desarrollo/);
  assert.deepEqual(r.entregables.map((x) => [x.numero, x.nombre, x.plazo_dias]), [[1, 'Plan de trabajo', 10], [2, 'Informe de avance', 60], [3, 'Informe final', 120]]);
  // clave: iniciales sin repetir las existentes
  assert.equal(sugerirClave('JUAN JOSE ARAMBULO AQUIJES', []), 'JJA');
  assert.equal(sugerirClave('JUAN JOSE ARAMBULO AQUIJES', ['JJA']), 'JJAA');
  assert.equal(sugerirClave('María de los Ángeles Pérez', []), 'MAP');
  assert.equal(sugerirClave('PEREZ', []), null);
  // montos en los dos formatos; al asistente no le llegan importes ni el RUC de persona natural
  assert.equal(aMonto('24.000,50'), 24000.5); assert.equal(aMonto('1,250'), 1250); assert.equal(aMonto('abc'), null);
  const oculto = quitarMontos(OS_SIGA);
  assert.doesNotMatch(oculto, /24,000/); assert.match(oculto, /\[MONTO\]/);
  assert.equal(quitarMontos('Pago del 33.33 % del total'), 'Pago del 33.33 % del total');
  assert.doesNotMatch(redactarPersonales(OS_SIGA).texto, /10456789123/);
});

test('leer la OS del profesional: la IA no recibe el monto ni lo propone; la clave se calcula; OS repetida se advierte', async () => {
  const proy = { proyecto_id: 7, activo: 1 };
  const servicio = { datos: async () => ({ proyectos: [proy], consultores: [{ clave: 'JJA' }], contratos: [{ numero: '1279', activo: 1 }] }) };
  const contrataciones = { tomarDocumento: (v, p, tipo) => { assert.equal(v, 'PROYECTO'); assert.equal(p, proy); return { nombre: `${tipo}.pdf`, buffer: Buffer.from(tipo) }; } };
  const leerDocumento = async (buf) => ({ texto: String(buf) === 'TDR' ? TDR_OS : OS_SIGA });
  let enviado = ''; let modo = '';
  const lector = crearProyectos({ servicio, almacen: {}, contrataciones, leerDocumento, extraerConIA: async ({ texto }, m) => { enviado = texto; modo = m; return { orden: { nombres: 'JUAN JOSE ARAMBULO AQUIJES', monto: 1, perfil: 'Desarrollador' }, omitidos: 1 }; } });
  const r = await lector.leerOrdenServicio(7, { TDR: 'PROYECTO', ORDEN_SERVICIO: 'PROYECTO' }, { usuario: 'admin' });
  assert.equal(modo, 'orden_servicio');
  assert.doesNotMatch(enviado, /24,000/);
  assert.equal(r.origen, 'IA');
  assert.equal(r.nombres, 'JUAN JOSE ARAMBULO AQUIJES');
  assert.equal(r.perfil, 'Desarrollador');
  assert.equal(r.monto, 24000); // del texto, no de la IA
  assert.equal(r.clave, 'JJAA'); // JJA ya existe
  assert.equal(r.repetida, true);
  assert.match(r.advertencias.join(' '), /N\.° 1279 ya está registrada/);
  await assert.rejects(lector.leerOrdenServicio(99, { TDR: 'PROYECTO' }, { usuario: 'admin' }), /Proyecto no encontrado/);
  await assert.rejects(lector.leerOrdenServicio(7, {}, { usuario: 'admin' }), /Adjunte la Orden de Servicio/);
});

test('API: la primera Orden de Servicio se lee y se registra con los documentos del proyecto', async () => {
  const PDFDocument = require('pdfkit');
  const pdfDe = (texto) => new Promise((ok) => { const d = new PDFDocument(); const partes = []; d.on('data', (b) => partes.push(b)); d.on('end', () => ok(Buffer.concat(partes))); d.text(texto); d.end(); });
  const subir = async (buf, nombre) => (await (await fetch(`${base}/api/documentos/temporales`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-SGF': '1', 'X-Nombre': nombre, Cookie: admin.cookie() }, body: buf })).json()).token;
  const p = await admin('POST', '/api/proyectos', { nombre: 'Mantenimiento del SISCATE', modalidad: 'ORDEN_SERVICIO', fecha_inicio: '2026-11-20', plazo_dias: 120,
    documentos: { TDR: await subir(await pdfDe(TDR_OS), 'tdr.pdf'), ORDEN_SERVICIO: await subir(await pdfDe(OS_SIGA), 'os.pdf') } });
  assert.equal(p.estado, 200, JSON.stringify(p.cuerpo));
  const id = p.cuerpo.proyecto_id;
  const l = await admin('POST', `/api/proyectos/${id}/contrataciones/leer-documentos`, { documentos: { TDR: 'PROYECTO', ORDEN_SERVICIO: 'PROYECTO' } });
  assert.equal(l.estado, 200, JSON.stringify(l.cuerpo));
  assert.equal(l.cuerpo.origen, 'TEXTO');
  assert.equal(l.cuerpo.numero, '1279'); assert.equal(l.cuerpo.monto, 24000); assert.equal(l.cuerpo.plazo_dias, 120); assert.equal(l.cuerpo.entregables.length, 3);
  // un Jefe de Proyecto fuera del equipo no lee la Orden de Servicio (confidencial)
  const alta = await admin('POST', '/api/usuarios', { correo: 'jefe.os@serfor.gob.pe', nombre: 'Jefe sin equipo', rol: 'JEFE_PROYECTO' });
  const jefe = cliente(); await jefe.entrar('jefe.os@serfor.gob.pe', alta.cuerpo.clave_temporal);
  assert.equal((await jefe('POST', `/api/proyectos/${id}/contrataciones/leer-documentos`, { documentos: { ORDEN_SERVICIO: 'PROYECTO' } })).estado, 403);
  // registrar con los documentos del proyecto: quedan también como documentos de la OS
  const n = await admin('POST', `/api/proyectos/${id}/contrataciones`, { clave: l.cuerpo.clave, nombres: l.cuerpo.nombres, numero: l.cuerpo.numero, expediente: l.cuerpo.expediente, titulo_tdr: l.cuerpo.titulo_tdr, monto: l.cuerpo.monto, plazo_dias: l.cuerpo.plazo_dias, entregables: l.cuerpo.entregables, documentos: { TDR: 'PROYECTO', ORDEN_SERVICIO: 'PROYECTO' } });
  assert.equal(n.estado, 200, JSON.stringify(n.cuerpo));
  assert.deepEqual(n.cuerpo.documentos_pendientes, []);
  const docs = (await admin('GET', `/api/documentos?entidad=contrato&entidad_id=${n.cuerpo.contrato.contrato_id}`)).cuerpo;
  assert.deepEqual(docs.map((d) => d.tipo).sort(), ['ORDEN_SERVICIO', 'TDR']);
  assert.equal(docs.find((d) => d.tipo === 'ORDEN_SERVICIO').confidencial, true);
  // la segunda lectura advierte que esa OS ya está registrada
  const l2 = await admin('POST', `/api/proyectos/${id}/contrataciones/leer-documentos`, { documentos: { ORDEN_SERVICIO: 'PROYECTO' } });
  assert.equal(l2.cuerpo.repetida, true);
  // un proyecto sin documentos: «PROYECTO» se rechaza
  const sin = await admin('POST', '/api/proyectos', { nombre: 'Proyecto sin documentos', modalidad: 'ORDEN_SERVICIO' });
  assert.equal((await admin('POST', `/api/proyectos/${sin.cuerpo.proyecto_id}/contrataciones/leer-documentos`, { documentos: { TDR: 'PROYECTO' } })).estado, 400);
});


// ---------------------------------------------------------------- Persona contratada: solo el campo «Señor(es)» de la OS
const OS_DOS_COLUMNAS = `ORDEN DE SERVICIO Nº 0001279
1. DATOS DEL PROVEEDOR                                   2. CONDICIONES GENERALES
Señor(es) : ARAMBULO AQUIJES JUAN JOSE                    Nº Cuadro Adquisic: 001305
Dirección : JR. VARELA                                    Tipo de Proceso : CM
LIMA / LIMA / BRENA        CCI:                           Nº Contrato :
RUC : 10422635047 Teléfono :           Fax :               Moneda : S/        T/C :
Concepto : SERVICIO PARA EL ANALISIS, DESARROLLO, MEJORAMIENTO Y MANTENIMIENTO EN SISTEMAS INFORMATICOS-SISCATE
Plazo de ejecución: 120 días calendario`;
const TDR_CON_OTRAS_PERSONAS = `${TDR_OS}
5. ÁREA USUARIA
Responsable: AARON PERALTA BRAVO, especialista de la Dirección de Fortalecimiento de Capacidades.`;

test('el nombre del profesional sale del campo «Señor(es)» de «1. DATOS DEL PROVEEDOR», en cualquier disposición del texto', () => {
  assert.equal(proveedorDeOS(OS_DOS_COLUMNAS), 'ARAMBULO AQUIJES JUAN JOSE');
  assert.equal(proveedorDeOS('Señor(es) : ARAMBULO AQUIJES JUAN JOSE Nº Cuadro Adquisic: 001305'), 'ARAMBULO AQUIJES JUAN JOSE');
  assert.equal(proveedorDeOS('Señor(es) :\nARAMBULO AQUIJES JUAN JOSE\nDirección : JR. VARELA'), 'ARAMBULO AQUIJES JUAN JOSE');
  assert.equal(proveedorDeOS('Señor(es) :\nDirección : JR. VARELA'), null);
  assert.equal(ordenarNombre('ARAMBULO AQUIJES JUAN JOSE'), 'JUAN JOSE ARAMBULO AQUIJES');
  assert.equal(ordenarNombre('DE LA CRUZ PEREZ MARIA DEL PILAR'), 'MARIA DEL PILAR DE LA CRUZ PEREZ');
  assert.equal(ordenarNombre(proveedorDeOS('Señor(es): SOLUCIONES TI S.A.C.  RUC: 20456789123')), 'SOLUCIONES TI S.A.C.');
  assert.equal(mismaPersona('JUAN JOSÉ ARAMBULO AQUIJES', 'ARAMBULO AQUIJES JUAN JOSE'), true);
  assert.equal(mismaPersona('AARON PERALTA BRAVO', 'ARAMBULO AQUIJES JUAN JOSE'), false);
  const r = extraerOrdenServicioSinIA({ os: OS_DOS_COLUMNAS, tdr: TDR_CON_OTRAS_PERSONAS });
  assert.equal(r.nombres, 'JUAN JOSE ARAMBULO AQUIJES');
});

test('si la IA propone otra persona (p. ej. una del TDR), manda la OS y se advierte; si solo reordena, se respeta su orden', async () => {
  const proy = { proyecto_id: 7, activo: 1 };
  const servicio = { datos: async () => ({ proyectos: [proy], consultores: [], contratos: [] }) };
  const contrataciones = { tomarDocumento: (v, p, tipo) => ({ nombre: `${tipo}.pdf`, buffer: Buffer.from(tipo) }) };
  const leerDocumento = async (buf) => ({ texto: String(buf) === 'TDR' ? TDR_CON_OTRAS_PERSONAS : OS_DOS_COLUMNAS });
  const conIA = (orden) => crearProyectos({ servicio, almacen: {}, contrataciones, leerDocumento, extraerConIA: async () => ({ orden }) });
  const docs = { TDR: 'PROYECTO', ORDEN_SERVICIO: 'PROYECTO' };
  const otra = await conIA({ nombres: 'AARON PERALTA BRAVO', numero: '1279' }).leerOrdenServicio(7, docs, { usuario: 'admin' });
  assert.equal(otra.nombres, 'JUAN JOSE ARAMBULO AQUIJES');
  assert.equal(otra.clave, 'JJA');
  assert.match(otra.advertencias.join(' '), /propuso «AARON PERALTA BRAVO».*«ARAMBULO AQUIJES JUAN JOSE»/);
  const reordenada = await conIA({ nombres: 'JUAN JOSÉ ARAMBULO AQUIJES' }).leerOrdenServicio(7, docs, { usuario: 'admin' });
  assert.equal(reordenada.nombres, 'JUAN JOSÉ ARAMBULO AQUIJES');
  assert.doesNotMatch(reordenada.advertencias.join(' '), /propuso/);
  const numeros = await conIA({ nombres: 'JUAN JOSE ARAMBULO AQUIJES', numero: '3316' }).leerOrdenServicio(7, docs, { usuario: 'admin' });
  assert.match(numeros.advertencias.join(' '), /Verifique el N\.° de Orden de Servicio: el asistente leyó «3316» y el texto de la Orden de Servicio dice «1279»/);
});
