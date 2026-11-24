'use strict';
/**
 * Indexa en el almacén documental (sgf.documento, db/14) los archivos que ya están en las carpetas anteriores,
 * SIN moverlos ni copiarlos (criterio C5 de PLAN_DE_MEJORAS.md). Es idempotente: lo ya indexado (por carpeta y
 * ruta) se omite, aunque se haya retirado.
 *
 *   node herramientas/migrar_documentos.js            simula: muestra qué indexaría, no escribe nada
 *   node herramientas/migrar_documentos.js --aplicar  indexa (bitácora con origen SCRIPT)
 *
 * Usa MODO_DATOS y las carpetas del .env (PLANES_PDF_DIR, ADENDAS_PDF_DIR, CONTRATOS_PDF_DIR, ACTIVIDADES_PDF_DIR,
 * PLANES_ORIGEN_DIR, DOCUMENTOS_DIR). En modo memoria, detenga antes el servidor (comparten data/demo-estado.json).
 */
const fs = require('fs');
const path = require('path');
const config = require('../server/config');
const { crearRepositorio } = require('../server/datos');
const { crearAlmacen } = require('../server/documentos/almacen');

const APLICAR = process.argv.includes('--aplicar');
const CTX = { usuario: 'herramientas/migrar_documentos', origen: 'SCRIPT' };
const leerDir = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };

/** Archivos de las carpetas anteriores, en el orden en que se indexan (versiones antiguas primero). */
function inventario(d) {
  const salida = [];
  const consultorDeContrato = (id) => (d.contratos.find((k) => k.contrato_id === id) || {}).consultor_id ?? null;

  // PDF del plan (plan-<id>.pdf vigente; plan-<id>-<fecha>.pdf versiones anteriores), de la adenda y del contrato/OS/TDR
  const porPrefijo = (raiz, dir, prefijo, armar) => {
    const grupos = new Map();
    for (const f of leerDir(dir)) {
      const m = new RegExp(`^${prefijo}-(\\d+)(-.+)?\\.pdf$`, 'i').exec(f);
      if (!m) continue;
      const id = Number(m[1]);
      if (!grupos.has(id)) grupos.set(id, []);
      grupos.get(id).push({ archivo: f, vigente: !m[2] });
    }
    for (const [id, lista] of grupos) {
      lista.sort((a, b) => (a.vigente - b.vigente) || (mtime(path.join(dir, a.archivo)) - mtime(path.join(dir, b.archivo))));
      for (const x of lista) { const e = armar(id); if (e) salida.push({ ...e, raiz, ruta_relativa: x.archivo, nombre: x.archivo }); }
    }
  };
  porPrefijo('PLANES_PDF', config.planesPdf, 'plan', (id) => { const p = d.planes.find((x) => x.plan_id === id); return { tipo: 'PLAN_TRABAJO', entidad: 'plan_trabajo', entidad_id: id, consultor_id: p ? p.consultor_id : null }; });
  porPrefijo('ADENDAS_PDF', config.adendasPdf, 'adenda', (id) => { const a = d.adendas.find((x) => x.adenda_id === id); return { tipo: 'ADENDA', entidad: 'adenda', entidad_id: id, consultor_id: a ? consultorDeContrato(a.contrato_id) : null }; });
  porPrefijo('CONTRATOS_PDF', config.contratosPdf, 'contrato', (id) => { const k = d.contratos.find((x) => x.contrato_id === id); return { tipo: k && k.tipo_documento === 'ORDEN_SERVICIO' ? 'ORDEN_SERVICIO' : 'CONTRATO', entidad: 'contrato', entidad_id: id, consultor_id: k ? k.consultor_id : null, confidencial: true }; });
  porPrefijo('CONTRATOS_PDF', config.contratosPdf, 'tdr', (id) => ({ tipo: 'TDR', entidad: 'contrato', entidad_id: id, consultor_id: consultorDeContrato(id) }));

  // evidencias de actividades: act-<id>-<n>.pdf con su ficha .json (las retiradas no se indexan)
  for (const f of leerDir(config.actividadesPdf)) {
    const m = /^act-(\d+)-(\d+)\.pdf$/i.exec(f);
    if (!m) continue;
    let ficha = {};
    try { ficha = JSON.parse(fs.readFileSync(path.join(config.actividadesPdf, f.replace(/\.pdf$/i, '.json')), 'utf8')); } catch { /* sin ficha */ }
    if (ficha.quitado) continue;
    const act = d.actividades.find((a) => a.actividad_id === Number(m[1]));
    const plan = act && d.planes.find((p) => p.plan_id === act.plan_id);
    salida.push({ tipo: 'EVIDENCIA', entidad: 'actividad', entidad_id: Number(m[1]), consultor_id: plan ? plan.consultor_id : null, raiz: 'ACTIVIDADES_PDF', ruta_relativa: f, nombre: ficha.nombre || f, subido_por: ficha.subido_por, reemplazar: false });
  }

  // documentos de origen de planes: plan-<id>-<marca>.<ext>
  for (const f of leerDir(config.planesOrigen).sort()) {
    const m = /^plan-(\d+)-\d+\.[a-z0-9]+$/i.exec(f);
    if (!m) continue;
    const p = d.planes.find((x) => x.plan_id === Number(m[1]));
    salida.push({ tipo: 'ORIGEN_PLAN', entidad: 'plan_trabajo', entidad_id: Number(m[1]), consultor_id: p ? p.consultor_id : null, raiz: 'PLANES_ORIGEN', ruta_relativa: f, nombre: (p && p.documento_origen) || f });
  }

  // originales de cargas («Cargar documento» y «Actualizar Desde Archivo»): DOCUMENTOS_DIR/indice.json
  let indice = [];
  try { indice = JSON.parse(fs.readFileSync(path.join(config.documentos, 'indice.json'), 'utf8')); } catch { /* sin cargas */ }
  for (const e of Array.isArray(indice) ? indice : []) {
    if (e && e.ruta) salida.push({ tipo: 'CARGA', entidad: 'carga', entidad_id: Number(e.id) || null, raiz: 'DOCUMENTOS', ruta_relativa: e.ruta, nombre: e.archivo || path.basename(e.ruta), subido_por: e.usuario, reemplazar: false });
  }
  return salida;
}

async function principal() {
  const repo = await crearRepositorio();
  try {
    const d = await repo.cargarTodo();
    const proyectoDe = async (consultorId) => (d.consultores.find((c) => c.consultor_id === consultorId) || {}).proyecto_id ?? null;
    const almacen = crearAlmacen({ repo, resolverProyecto: proyectoDe, raices: { ALMACEN: config.almacen, PLANES_PDF: config.planesPdf, ADENDAS_PDF: config.adendasPdf, ACTIVIDADES_PDF: config.actividadesPdf, CONTRATOS_PDF: config.contratosPdf, PLANES_ORIGEN: config.planesOrigen, DOCUMENTOS: config.documentos } });
    await almacen.cargar();
    const ya = new Set((await repo.listarDocumentos({ incluirRetirados: true })).map((f) => `${f.raiz}|${f.ruta_relativa}`));
    const pendientes = inventario(d).filter((e) => !ya.has(`${e.raiz}|${e.ruta_relativa}`));
    const resumen = {};
    let hechos = 0; let fallidos = 0;
    for (const e of pendientes) {
      resumen[e.tipo] = (resumen[e.tipo] || 0) + 1;
      if (!APLICAR) { console.log(`  ${e.tipo.padEnd(14)} ${e.raiz}/${e.ruta_relativa}${e.entidad_id ? ` → ${e.entidad} ${e.entidad_id}` : ''}`); continue; }
      try {
        await almacen.registrarExistente(e, { ...CTX, motivo: `Migración al almacén documental: ${e.raiz}/${e.ruta_relativa}` });
        hechos += 1;
      } catch (err) { fallidos += 1; console.error(`  ✗ ${e.raiz}/${e.ruta_relativa}: ${err.message}`); }
    }
    console.log(`\n${APLICAR ? 'Indexados' : 'Por indexar (simulación)'}: ${APLICAR ? hechos : pendientes.length} · ya indexados antes: ${ya.size}${fallidos ? ` · con error: ${fallidos}` : ''}`);
    for (const [t, n] of Object.entries(resumen)) console.log(`  ${t}: ${n}`);
    if (!APLICAR && pendientes.length) console.log('\nPara indexarlos: node herramientas/migrar_documentos.js --aplicar');
  } finally {
    await repo.cerrar();
  }
}

if (require.main === module) principal().catch((err) => { console.error('No se pudo migrar:', err.message); process.exit(1); });

module.exports = { inventario };
