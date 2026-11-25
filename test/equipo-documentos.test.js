'use strict';
/**
 * Etapa 1 de PLAN_DE_MEJORAS.md: transacciones compuestas (C4), almacén documental (C5, db/14) y
 * equipo por proyecto con alcance de escritura (C6, db/15; decisiones D1 y D2).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-etapa1-'));
process.env.MODO_DATOS = 'memoria';
process.env.ARCHIVO_DEMO = path.join(tmp, 'demo.json');
process.env.DOCUMENTOS_RAIZ = path.join(tmp, 'almacen');
process.env.PLANES_PDF_DIR = path.join(tmp, 'planes-pdf');
process.env.ADENDAS_PDF_DIR = path.join(tmp, 'adendas-pdf');
process.env.CONTRATOS_PDF_DIR = path.join(tmp, 'contratos-pdf');
process.env.PLANES_ORIGEN_DIR = path.join(tmp, 'planes-origen');
process.env.ACTIVIDADES_PDF_DIR = path.join(tmp, 'actividades-pdf');
process.env.DOCUMENTOS_DIR = path.join(tmp, 'documentos');
process.env.ADMIN_CORREO = 'admin.etapa1@serfor.gob.pe';
process.env.ADMIN_CLAVE_INICIAL = 'ClaveEtapa1x2026';
process.env.ANTHROPIC_API_KEY = '';

const { crearRepositorioMemoria } = require('../server/datos/memoria');
const { crearServicio } = require('../server/servicio');
const { crearAlmacen } = require('../server/documentos/almacen');
const permisos = require('../server/permisos');
const semilla = require('../data/semilla.json');
const { crearApp } = require('../server/server');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const rechaza = async (p, estado) => { await assert.rejects(p, (e) => { assert.equal(e.estado, estado, e.message); return true; }); };
const ctxSistema = { usuario: 'pruebas@serfor.gob.pe', origen: 'SCRIPT', motivo: 'Prueba' };

// ------------------------------------------------------------------ C4 transacciones
test('transacción compuesta: si un paso falla no queda nada escrito, ni en la bitácora', async () => {
  const repo = crearRepositorioMemoria({ semilla });
  const antes = await repo.cargarTodo();
  const bitAntes = (await repo.listarBitacora({ limite: 1000 })).length;
  await assert.rejects(repo.transaccion(async (t) => {
    await t.crear('consultor', { clave: 'TXA', nombres: 'Prueba Transacción', proyecto: 'X', proyecto_id: 1, estado: 'ACTIVO' }, ctxSistema);
    throw new Error('falla simulada');
  }), /falla simulada/);
  const despues = await repo.cargarTodo();
  assert.equal(despues.consultores.length, antes.consultores.length);
  assert.equal((await repo.listarBitacora({ limite: 1000 })).length, bitAntes);
  // y si todo sale bien, queda todo
  const r = await repo.transaccion(async (t) => t.crear('consultor', { clave: 'TXB', nombres: 'Prueba Transacción B', proyecto: 'X', proyecto_id: 1, estado: 'ACTIVO' }, ctxSistema));
  assert.ok((await repo.cargarTodo()).consultores.some((c) => c.consultor_id === r.consultor_id));
});

test('registrar profesional es atómico: si falla la adenda no quedan ni el consultor ni el contrato', async () => {
  const repo = crearRepositorioMemoria({ semilla });
  const original = repo.transaccion;
  repo.transaccion = (fn) => original((t) => fn({ ...t, crear: async (e, f, o) => { if (e === 'adenda') throw Object.assign(new Error('falla simulada en la adenda'), { estado: 500 }); return t.crear(e, f, o); } }));
  const servicio = crearServicio(repo);
  await rechaza(servicio.registrarProfesional({ proyecto_id: 1, clave: 'ATO', nombres: 'Profesional Atómico', contrato_numero: 'ATO-001', adenda_inicio: '2026-11-01', adenda_plazo_dias: 30 }, { ...ctxSistema, rol: 'ADMIN' }), 500);
  const d = await servicio.datos(true);
  assert.ok(!d.consultores.some((c) => c.clave === 'ATO'));
  assert.ok(!d.contratos.some((k) => k.numero === 'ATO-001'));
});

// ------------------------------------------------------------------ C5 almacén
test('almacén: valida el contenido, versiona, guarda la huella y nunca deja archivos huérfanos', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-alm-'));
  const repo = crearRepositorioMemoria({ semilla });
  const alm = crearAlmacen({ repo, raices: { ALMACEN: raiz }, resolverProyecto: async () => 1 });
  await alm.cargar();
  const base = { tipo: 'TDR', entidad: 'contrato', entidad_id: 7, consultor_id: 3 };
  await rechaza(alm.guardar({ ...base, buffer: Buffer.from('esto no es un pdf'), nombre: 'falso.pdf' }, ctxSistema), 400);
  await rechaza(alm.guardar({ ...base, buffer: PDF, maxBytes: 10 }, ctxSistema), 413);
  await rechaza(alm.guardar({ ...base, tipo: 'INVENTADO', buffer: PDF }, ctxSistema), 400);

  const v1 = await alm.guardar({ ...base, buffer: PDF, nombre: 'TDR analista.pdf' }, ctxSistema);
  assert.equal(v1.version, 1);
  assert.equal(v1.proyecto_id, 1);
  assert.match(v1.sha256, /^[0-9a-f]{64}$/);
  assert.match(v1.ruta_relativa, /^P1\/contrato\/7\/tdr-\d{8}-\d{6}-[0-9a-f]{8}-[0-9a-f-]{36}\.pdf$/);
  assert.equal(Buffer.compare(fs.readFileSync(alm.rutaAbsoluta(v1)), PDF), 0);
  const v2 = await alm.guardar({ ...base, buffer: Buffer.concat([PDF, Buffer.from('%v2')]), nombre: 'TDR corregido.pdf' }, ctxSistema);
  assert.equal(v2.version, 2);
  assert.equal(v2.reemplaza_id, v1.documento_id);
  assert.equal(alm.vigente('TDR', 'contrato', 7).documento_id, v2.documento_id);
  assert.ok(fs.existsSync(alm.rutaAbsoluta(v1)), 'la versión anterior sigue en disco');
  const bit = await repo.listarBitacora({ entidad: 'documento' });
  assert.equal(bit.length, 2, 'cada documento deja su registro en la bitácora');

  // si la base falla, el archivo recién escrito se elimina
  const contar = () => fs.readdirSync(path.join(raiz, 'P1', 'contrato', '7')).length;
  const n = contar();
  const roto = crearAlmacen({ repo: { ...repo, crear: async () => { throw new Error('base caída'); } }, raices: { ALMACEN: raiz }, resolverProyecto: async () => 1 });
  await assert.rejects(roto.guardar({ ...base, buffer: Buffer.concat([PDF, Buffer.from('%v3')]) }, ctxSistema), /base caída/);
  assert.equal(contar(), n, 'no quedó un archivo huérfano');

  // retirar es baja lógica: deja de ser vigente, el archivo sigue
  await alm.retirar(v2.documento_id, ctxSistema);
  assert.equal(alm.vigente('TDR', 'contrato', 7).documento_id, v1.documento_id);
  assert.ok(fs.existsSync(alm.rutaAbsoluta(v2)));
  assert.equal(alm.rutaAbsoluta({ raiz: 'ALMACEN', ruta_relativa: '../../fuera.pdf' }), null, 'no sale de su carpeta');

  // al reiniciar, el índice se reconstruye desde la base
  const otra = crearAlmacen({ repo, raices: { ALMACEN: raiz } });
  await otra.cargar();
  assert.equal(otra.vigente('TDR', 'contrato', 7).documento_id, v1.documento_id);
});

test('migración: indexa los archivos de las carpetas anteriores sin moverlos y es idempotente', () => {
  const { execFileSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-mig-'));
  const env = {
    ...process.env, MODO_DATOS: 'memoria', ARCHIVO_DEMO: path.join(dir, 'demo.json'), DOCUMENTOS_RAIZ: path.join(dir, 'almacen'),
    PLANES_PDF_DIR: path.join(dir, 'planes'), ADENDAS_PDF_DIR: path.join(dir, 'adendas'), CONTRATOS_PDF_DIR: path.join(dir, 'contratos'),
    ACTIVIDADES_PDF_DIR: path.join(dir, 'act'), PLANES_ORIGEN_DIR: path.join(dir, 'origen'), DOCUMENTOS_DIR: path.join(dir, 'docs'),
  };
  for (const k of ['PLANES_PDF_DIR', 'ADENDAS_PDF_DIR', 'CONTRATOS_PDF_DIR', 'ACTIVIDADES_PDF_DIR']) fs.mkdirSync(env[k], { recursive: true });
  fs.writeFileSync(path.join(env.PLANES_PDF_DIR, 'plan-1-2026-11-01T10-00-00-000Z.pdf'), PDF); // versión anterior
  fs.writeFileSync(path.join(env.PLANES_PDF_DIR, 'plan-1.pdf'), Buffer.concat([PDF, Buffer.from('%v2')])); // vigente
  fs.writeFileSync(path.join(env.ADENDAS_PDF_DIR, 'adenda-3.pdf'), PDF);
  fs.writeFileSync(path.join(env.CONTRATOS_PDF_DIR, 'contrato-1.pdf'), PDF);
  fs.writeFileSync(path.join(env.CONTRATOS_PDF_DIR, 'tdr-1.pdf'), PDF);
  fs.writeFileSync(path.join(env.ACTIVIDADES_PDF_DIR, 'act-5-1.pdf'), PDF);
  fs.writeFileSync(path.join(env.ACTIVIDADES_PDF_DIR, 'act-5-1.json'), JSON.stringify({ nombre: 'Acta.pdf' }));
  fs.writeFileSync(path.join(env.ACTIVIDADES_PDF_DIR, 'act-5-2.pdf'), PDF);
  fs.writeFileSync(path.join(env.ACTIVIDADES_PDF_DIR, 'act-5-2.json'), JSON.stringify({ nombre: 'Retirado.pdf', quitado: true }));
  const correr = (...a) => execFileSync(process.execPath, [path.join(__dirname, '..', 'herramientas', 'migrar_documentos.js'), ...a], { env, encoding: 'utf8' });

  assert.match(correr(), /Por indexar \(simulación\): 6/);
  assert.equal(JSON.parse(fs.readFileSync(env.ARCHIVO_DEMO, 'utf8')).documentos.length, 0, 'la simulación no indexa nada');
  assert.match(correr('--aplicar'), /Indexados: 6/);
  assert.match(correr('--aplicar'), /Indexados: 0 · ya indexados antes: 6/, 'idempotente');
  assert.ok(fs.existsSync(path.join(env.PLANES_PDF_DIR, 'plan-1.pdf')), 'los archivos no se mueven');
  const db = JSON.parse(fs.readFileSync(env.ARCHIVO_DEMO, 'utf8'));
  const planes = db.documentos.filter((f) => f.tipo === 'PLAN_TRABAJO').sort((a, b) => a.version - b.version);
  assert.deepEqual(planes.map((f) => f.ruta_relativa), ['plan-1-2026-11-01T10-00-00-000Z.pdf', 'plan-1.pdf'], 'la vigente queda como la última versión');
  assert.equal(db.documentos.find((f) => f.raiz === 'CONTRATOS_PDF' && f.tipo !== 'TDR').confidencial, 1, 'el contrato/OS queda confidencial');
  assert.ok(db.documentos.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
});

// ------------------------------------------------------------------ C6 permisos (unidad)
test('permisos: un Jefe de Proyecto solo escribe en los proyectos de su equipo, también dentro de una transacción', async () => {
  const base = crearRepositorioMemoria({ semilla });
  const d = await base.cargarTodo();
  await base.crear('proyecto', { codigo: 'PRY-X-001', nombre: 'Proyecto de prueba dos', estado: 'ACTIVO' }, ctxSistema);
  const repo = permisos.envolverRepositorio(base, { proyectoDeConsultor: async (id) => (d.consultores.find((c) => c.consultor_id === id) || {}).proyecto_id ?? null });
  const c1 = d.consultores[0];
  const alcance = (rol, proyectos) => permisos.alcanceDe({ rol, correo: 'x@serfor.gob.pe', proyectos });
  const editar = () => repo.actualizar('consultor', c1.consultor_id, { observacion: `nota ${Date.now()}` }, ctxSistema);

  await rechaza(permisos.ejecutarConAlcance(alcance('JEFE_PROYECTO', [2]), editar), 403);
  await permisos.ejecutarConAlcance(alcance('JEFE_PROYECTO', [1]), editar);
  await permisos.ejecutarConAlcance(alcance('ADMIN', []), editar);
  await editar(); // sin alcance (proceso del sistema)
  await rechaza(permisos.ejecutarConAlcance(alcance('JEFE_PROYECTO', [1]), () => repo.crear('proyecto', { codigo: 'PRY-X-002', nombre: 'Otro proyecto' }, ctxSistema)), 403);
  await rechaza(permisos.ejecutarConAlcance(alcance('JEFE_PROYECTO', [1]), () => repo.crear('proyecto_miembro', { proyecto_id: 1, usuario_id: 9 }, ctxSistema)), 403);
  await rechaza(permisos.ejecutarConAlcance(alcance('JEFE_PROYECTO', [1]), () => repo.actualizar('consultor', c1.consultor_id, { proyecto_id: 2 }, ctxSistema)), 403);
  // dentro de una transacción: el consultor creado en la misma petición se reconoce por su proyecto
  const alta = () => repo.transaccion(async (t) => {
    const n = await t.crear('consultor', { clave: 'PRM', nombres: 'Permiso En Transacción', proyecto: 'X', proyecto_id: 1, estado: 'ACTIVO' }, ctxSistema);
    return t.crear('contrato', { consultor_id: n.consultor_id, numero: 'PRM-1', tipo_documento: 'CONTRATO' }, { ...ctxSistema, consultor_id: n.consultor_id });
  });
  await permisos.ejecutarConAlcance(alcance('JEFE_PROYECTO', [1]), alta);
  await rechaza(permisos.ejecutarConAlcance(alcance('JEFE_PROYECTO', [2]), () => repo.transaccion((t) => t.crear('consultor', { clave: 'PRN', nombres: 'Fuera de equipo', proyecto: 'X', proyecto_id: 1, estado: 'ACTIVO' }, ctxSistema))), 403);
  assert.ok(!(await base.cargarTodo()).consultores.some((c) => c.clave === 'PRN'));
});

// ------------------------------------------------------------------ API: equipo y documentos confidenciales
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
  return llamar;
}

test('API: el Administrador define el equipo; el Jefe de Proyecto lee todo y escribe solo en lo suyo; la OS es confidencial', async (t) => {
  const { app } = await crearApp();
  await new Promise((ok) => { servidor = app.listen(0, ok); });
  t.after(() => servidor.close());
  base = `http://127.0.0.1:${servidor.address().port}`;
  const admin = cliente();
  assert.equal((await admin.entrar('admin.etapa1@serfor.gob.pe', 'ClaveEtapa1x2026')).estado, 200);

  const nuevoJefe = async (correo, nombre) => { const r = await admin('POST', '/api/usuarios', { correo, nombre, rol: 'JEFE_PROYECTO' }); assert.equal(r.estado, 200); const c = cliente(); await c.entrar(correo, r.cuerpo.clave_temporal); return { id: r.cuerpo.usuario.usuario_id, c }; };
  const ana = await nuevoJefe('ana.dev@serfor.gob.pe', 'Ana Desarrollo');
  const beto = await nuevoJefe('beto.dev@serfor.gob.pe', 'Beto Desarrollo');

  // proyecto por Orden de Servicio con un profesional y su OS (PDF) cargados por el Administrador
  const p = (await admin('POST', '/api/proyectos', { nombre: 'Proyecto con equipo de prueba' })).cuerpo; // modalidad ORDEN_SERVICIO
  const temporal = async (c) => (await (await fetch(`${base}/api/documentos/temporales`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-SGF': '1', Cookie: c.cookie() }, body: PDF })).json()).token;
  const alta = await admin('POST', `/api/proyectos/${p.proyecto_id}/contrataciones`, { clave: 'EQA', nombres: 'Elena Quispe Arias', numero: 'OS-EQ-001', monto: 12000, plazo_dias: 60, entregables: [{ nombre: 'Informe final', plazo_dias: 60 }], documentos: { TDR: await temporal(admin), ORDEN_SERVICIO: await temporal(admin) } });
  assert.equal(alta.estado, 200, JSON.stringify(alta.cuerpo));
  const kid = alta.cuerpo.contrato.contrato_id;
  const subir = (c, ruta) => fetch(`${base}/api/contratos/${kid}/${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-SGF': '1', Cookie: c.cookie() }, body: PDF });
  assert.equal((await subir(admin, 'documento')).status, 200);

  // solo el Administrador define el equipo, y solo con cuentas JEFE_PROYECTO activas
  assert.equal((await ana.c('POST', `/api/proyectos/${p.proyecto_id}/equipo`, { usuario_id: ana.id })).estado, 403);
  const yo = (await admin('GET', '/api/auth/yo')).cuerpo.usuario;
  const cuentaAdmin = (await admin('GET', '/api/usuarios')).cuerpo.find((u) => u.correo === yo.correo);
  assert.equal((await admin('POST', `/api/proyectos/${p.proyecto_id}/equipo`, { usuario_id: cuentaAdmin.usuario_id })).estado, 400);
  const mA = await admin('POST', `/api/proyectos/${p.proyecto_id}/equipo`, { usuario_id: ana.id, es_responsable: true });
  assert.equal(mA.estado, 200, JSON.stringify(mA.cuerpo));
  assert.equal((await admin('POST', `/api/proyectos/${p.proyecto_id}/equipo`, { usuario_id: ana.id })).estado, 409, 'no se repite');
  assert.equal((await ana.c('GET', '/api/auth/yo')).cuerpo.usuario.proyectos.includes(p.proyecto_id), true);

  // lee todo (D2) pero solo escribe en lo suyo
  assert.equal((await beto.c('GET', `/api/estado?proyecto_id=${p.proyecto_id}`)).estado, 200);
  const c = (await beto.c('GET', `/api/consultores/${alta.cuerpo.consultor.consultor_id}`)).cuerpo.consultor;
  assert.equal((await beto.c('PATCH', `/api/consultores/${c.consultor_id}`, { sede: 'LIMA', revision: c.revision })).estado, 403);
  assert.equal((await subir(beto.c, 'tdr')).status, 403, 'tampoco sube documentos');
  const okAna = await ana.c('PATCH', `/api/consultores/${c.consultor_id}`, { sede: 'LIMA', revision: c.revision });
  assert.equal(okAna.estado, 200, JSON.stringify(okAna.cuerpo));
  assert.equal((await subir(ana.c, 'tdr')).status, 200);

  // la Orden de Servicio es confidencial: el Jefe ajeno al proyecto no la ve
  assert.equal((await fetch(`${base}/api/contratos/${kid}/documento`, { headers: { Cookie: beto.c.cookie() } })).status, 403);
  assert.equal((await fetch(`${base}/api/contratos/${kid}/documento`, { headers: { Cookie: ana.c.cookie() } })).status, 200);
  assert.equal((await fetch(`${base}/api/contratos/${kid}/tdr`, { headers: { Cookie: beto.c.cookie() } })).status, 200, 'los TDR no son confidenciales');
  const docs = (await ana.c('GET', `/api/documentos?entidad=contrato&entidad_id=${kid}`)).cuerpo;
  const os_ = docs.find((d) => d.tipo === 'ORDEN_SERVICIO');
  assert.ok(os_ && os_.confidencial && docs.some((d) => d.tipo === 'TDR' && !d.confidencial));
  assert.equal((await fetch(`${base}/api/documentos/${os_.documento_id}/archivo`, { headers: { Cookie: beto.c.cookie() } })).status, 403);
  assert.equal((await fetch(`${base}/api/documentos/${os_.documento_id}/archivo`, { headers: { Cookie: ana.c.cookie() } })).status, 200);

  // un solo responsable: al designar a Beto, Ana deja de serlo
  const mB = await admin('POST', `/api/proyectos/${p.proyecto_id}/equipo`, { usuario_id: beto.id, es_responsable: true });
  assert.equal(mB.estado, 200);
  let equipo = (await admin('GET', `/api/proyectos/${p.proyecto_id}/equipo`)).cuerpo;
  assert.deepEqual(equipo.map((m) => [m.nombre, m.es_responsable]), [['Beto Desarrollo', 1], ['Ana Desarrollo', 0]]);
  assert.equal((await admin('PATCH', `/api/proyectos/${p.proyecto_id}/equipo/${mA.cuerpo.miembro_id}`, { es_responsable: true })).estado, 200);
  equipo = (await admin('GET', `/api/proyectos/${p.proyecto_id}/equipo`)).cuerpo;
  assert.equal(equipo.filter((m) => m.es_responsable).length, 1);
  assert.equal(equipo.find((m) => m.es_responsable).nombre, 'Ana Desarrollo');

  // al salir del equipo deja de escribir de inmediato (se lee en cada petición)
  assert.equal((await admin('POST', `/api/proyectos/${p.proyecto_id}/equipo/${mB.cuerpo.miembro_id}/quitar`)).estado, 200);
  const c2 = (await beto.c('GET', `/api/consultores/${c.consultor_id}`)).cuerpo.consultor;
  assert.equal((await beto.c('PATCH', `/api/consultores/${c.consultor_id}`, { sede: 'CUSCO', revision: c2.revision })).estado, 403);
  const bit = (await admin('GET', '/api/bitacora?entidad=proyecto_miembro')).cuerpo;
  assert.ok(bit.some((b) => b.accion === 'ANULAR') && bit.some((b) => b.accion === 'CREAR'), 'los cambios de equipo quedan en la bitácora');
});
