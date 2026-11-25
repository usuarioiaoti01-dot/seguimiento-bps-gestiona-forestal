'use strict';
/** Expediente del proyecto (§8 de PLAN_DE_MEJORAS.md): documentos por tipo, versión vigente y confidencialidad. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-expediente-'));
Object.assign(process.env, {
  MODO_DATOS: 'memoria', ARCHIVO_DEMO: path.join(tmp, 'demo.json'), DOCUMENTOS_RAIZ: path.join(tmp, 'almacen'),
  PLANES_PDF_DIR: path.join(tmp, 'planes-pdf'), ADENDAS_PDF_DIR: path.join(tmp, 'adendas-pdf'), CONTRATOS_PDF_DIR: path.join(tmp, 'contratos-pdf'),
  PLANES_ORIGEN_DIR: path.join(tmp, 'planes-origen'), ACTIVIDADES_PDF_DIR: path.join(tmp, 'actividades-pdf'), DOCUMENTOS_DIR: path.join(tmp, 'documentos'),
  ADMIN_CORREO: 'admin.expediente@serfor.gob.pe', ADMIN_CLAVE_INICIAL: 'ClaveExpediente2026x', ANTHROPIC_API_KEY: '',
});
const { construirExpediente } = require('../server/documentos/expediente');
const { crearApp } = require('../server/server');
const { aDia, aFecha, hoyLima } = require('../server/motor/calendario');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

test('construirExpediente: contexto, versión vigente, orden por tipo y confidenciales', () => {
  const datos = {
    consultores: [{ consultor_id: 1, clave: 'ABC', nombres: 'Ana Belén Cruz' }],
    contratos: [{ contrato_id: 10, consultor_id: 1, numero: 'OS-1', tipo_documento: 'ORDEN_SERVICIO' }],
    adendas: [{ adenda_id: 20, contrato_id: 10, numero: 1, tipo_periodo: 'AMPLIACION' }],
    planes: [], actividades: [], entregables_servicio: [{ entregable_servicio_id: 30, contrato_id: 10, numero: 2, nombre: 'Informe final' }],
  };
  const doc = (id, extra) => ({ documento_id: id, proyecto_id: 5, activo: 1, version: 1, bytes: 1000, nombre_original: `d${id}.pdf`, ...extra });
  const documentos = [
    doc(1, { tipo: 'ORDEN_SERVICIO', entidad: 'contrato', entidad_id: 10, confidencial: 1 }),
    doc(2, { tipo: 'TDR', entidad: 'contrato', entidad_id: 10 }),
    doc(3, { tipo: 'TDR', entidad: 'contrato', entidad_id: 10, version: 2 }),
    doc(4, { tipo: 'ENTREGABLE', entidad: 'entregable_servicio', entidad_id: 30 }),
    doc(5, { tipo: 'ADENDA', entidad: 'adenda', entidad_id: 20 }),
    doc(6, { tipo: 'TDR', entidad: 'contrato', entidad_id: 99, proyecto_id: 7 }), // de otro proyecto
    doc(7, { tipo: 'INFORME_CIERRE', entidad: 'proyecto', entidad_id: 5, activo: 0 }), // retirado
  ];
  const r = construirExpediente({ documentos, datos, proyecto_id: 5, verConfidencial: true });
  assert.equal(r.total, 5);
  assert.equal(r.vigentes, 4, 'el TDR tiene dos versiones: una vigente');
  assert.deepEqual(r.documentos.map((d) => d.documento_id), [3, 2, 1, 5, 4], 'TDR (más reciente primero), OS, adenda, entregable');
  assert.equal(r.documentos.find((d) => d.documento_id === 2).vigente, false);
  assert.equal(r.documentos.find((d) => d.documento_id === 4).pertenece_a, 'Entregable 2: Informe final · OS N.° OS-1');
  assert.equal(r.documentos.find((d) => d.documento_id === 5).pertenece_a, 'Ampliación N.° 1 · OS N.° OS-1');
  assert.equal(r.documentos[0].profesional, 'Ana Belén Cruz');
  const sin = construirExpediente({ documentos, datos, proyecto_id: 5, verConfidencial: false });
  assert.equal(sin.confidenciales_ocultos, 1);
  assert.ok(!sin.documentos.some((d) => d.tipo === 'ORDEN_SERVICIO'));
});

test('API del expediente: el equipo ve todo; un Jefe ajeno, sin los confidenciales', async () => {
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
      llamar.pdf = async () => { const r = await fetch(`${base}/api/documentos/temporales`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-SGF': '1', 'X-Nombre': 'doc.pdf', Cookie: cookie }, body: PDF }); return (await r.json()).token; };
      return llamar;
    };
    const admin = cliente(); await admin.entrar('admin.expediente@serfor.gob.pe', 'ClaveExpediente2026x');
    const jefe = async (correo) => { const r = await admin('POST', '/api/usuarios', { correo, nombre: correo, rol: 'JEFE_PROYECTO' }); const c = cliente(); await c.entrar(correo, r.cuerpo.clave_temporal); return { id: r.cuerpo.usuario.usuario_id, c }; };
    const ana = await jefe('ana.exp@serfor.gob.pe'); const beto = await jefe('beto.exp@serfor.gob.pe');
    const pid = (await admin('POST', '/api/proyectos', { nombre: 'Proyecto con expediente' })).cuerpo.proyecto_id;
    await admin('POST', `/api/proyectos/${pid}/equipo`, { usuario_id: ana.id, es_responsable: true });
    const reg = await ana.c('POST', `/api/proyectos/${pid}/contrataciones`, { clave: 'EXP', nombres: 'Elena Ximena Pardo', numero: 'OS-EXP-1', monto: 8000, plazo_dias: 30, entregables: [{ nombre: 'Informe', plazo_dias: 30 }], documentos: { TDR: await ana.c.pdf(), ORDEN_SERVICIO: await ana.c.pdf() } });
    assert.equal(reg.estado, 200, JSON.stringify(reg.cuerpo));
    const k = reg.cuerpo.contrato;
    const hoy = hoyLima();
    assert.equal((await ana.c('POST', `/api/contratos/${k.contrato_id}/notificacion`, { fecha_notificacion: aFecha(aDia(hoy) - 2), medio_notificacion: 'CORREO', documento: await ana.c.pdf(), revision: k.revision })).estado, 200);

    const propio = (await ana.c('GET', `/api/proyectos/${pid}/expediente`)).cuerpo;
    assert.deepEqual(propio.documentos.map((d) => d.tipo), ['TDR', 'ORDEN_SERVICIO', 'NOTIFICACION']);
    assert.equal(propio.confidenciales_ocultos, 0);
    assert.ok(propio.documentos.every((d) => d.profesional === 'Elena Ximena Pardo' && d.pertenece_a === 'OS N.° OS-EXP-1'));
    const ajeno = (await beto.c('GET', `/api/proyectos/${pid}/expediente`)).cuerpo;
    assert.deepEqual(ajeno.documentos.map((d) => d.tipo), ['TDR']);
    assert.equal(ajeno.confidenciales_ocultos, 2);
    const os = propio.documentos.find((d) => d.tipo === 'ORDEN_SERVICIO');
    const desc = await fetch(`${base}/api/documentos/${os.documento_id}/archivo`, { headers: { 'X-SGF': '1' } });
    assert.equal(desc.status, 401, 'sin sesión no se descarga');
    assert.equal((await admin('GET', '/api/proyectos/999999/expediente')).estado, 404);
  } finally { servidor.close(); }
});
