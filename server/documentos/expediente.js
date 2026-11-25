'use strict';
/**
 * Expediente del proyecto (§8 de PLAN_DE_MEJORAS.md, pestaña «Documentos»): todos los documentos del almacén que
 * pertenecen a un proyecto, con lo que cada uno respalda («a qué pertenece») y su versión. Función PURA.
 *
 * - Pertenece al proyecto el documento con ese proyecto_id (el almacén lo resuelve al guardar desde el consultor).
 * - Vigente = la versión más alta de su (tipo, entidad, registro); las anteriores se devuelven marcadas como históricas.
 * - Los confidenciales (OS, notificación, resolución) solo salen si `verConfidencial`; si no, se cuentan aparte.
 */

const ORDEN_TIPOS = ['TDR', 'ORDEN_SERVICIO', 'CONTRATO', 'NOTIFICACION', 'ADENDA', 'PLAN_TRABAJO', 'ORIGEN_PLAN', 'ENTREGABLE', 'OBSERVACION', 'CONFORMIDAD', 'EVIDENCIA', 'INFORME_CIERRE', 'CARGA', 'OTRO'];
const NOMBRE_TIPO = {
  TDR: 'Términos de Referencia', ORDEN_SERVICIO: 'Orden de Servicio', CONTRATO: 'Contrato', NOTIFICACION: 'Cargo de notificación', ADENDA: 'Adenda',
  PLAN_TRABAJO: 'Plan de trabajo aprobado', ORIGEN_PLAN: 'Documento de origen del plan', ENTREGABLE: 'Entregable presentado', OBSERVACION: 'Observación de entregable',
  CONFORMIDAD: 'Conformidad de entregable', EVIDENCIA: 'Evidencia', INFORME_CIERRE: 'Informe de cierre', CARGA: 'Documento cargado', OTRO: 'Otro documento',
};
const ff = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');

/**
 * @param documentos filas activas de sgf.documento (todas o ya filtradas)
 * @param datos      foto de la base (servicio.datos): consultores, contratos, adendas, planes, actividades, entregables_servicio
 * @param proyecto_id
 * @param partes     partes diarios del proyecto (para describir sus evidencias), opcional
 * @param verConfidencial ¿el usuario ve los documentos confidenciales de este proyecto?
 */
function construirExpediente({ documentos, datos, proyecto_id, partes = [], verConfidencial = false }) {
  const pid = Number(proyecto_id);
  const mapa = (lista, pk) => new Map((lista || []).map((x) => [x[pk], x]));
  const consultores = mapa(datos.consultores, 'consultor_id');
  const contratos = mapa(datos.contratos, 'contrato_id');
  const adendas = mapa(datos.adendas, 'adenda_id');
  const planes = mapa(datos.planes, 'plan_id');
  const actividades = mapa(datos.actividades, 'actividad_id');
  const entregables = mapa(datos.entregables_servicio, 'entregable_servicio_id');
  const partesPorId = mapa(partes, 'parte_id');
  const docTipoOS = (k) => (k && k.tipo_documento === 'ORDEN_SERVICIO' ? 'OS' : 'Contrato');

  /** A qué registro respalda el documento y de qué profesional es. */
  function contexto(f) {
    const id = f.entidad_id;
    let consultorId = f.consultor_id || null; let texto = '—';
    if (f.entidad === 'contrato') { const k = contratos.get(id); if (k) { consultorId = consultorId || k.consultor_id; texto = `${docTipoOS(k)} N.° ${k.numero}`; } }
    else if (f.entidad === 'adenda') { const a = adendas.get(id); const k = a && contratos.get(a.contrato_id); if (a) { consultorId = consultorId || (k && k.consultor_id); texto = `${a.tipo_periodo === 'AMPLIACION' ? 'Ampliación' : a.tipo_periodo === 'ORIGINAL' ? 'Periodo original' : 'Adenda'} N.° ${a.numero}${k ? ` · ${docTipoOS(k)} N.° ${k.numero}` : ''}`; } }
    else if (f.entidad === 'entregable_servicio') { const e = entregables.get(id); const k = e && contratos.get(e.contrato_id); if (e) { consultorId = consultorId || (k && k.consultor_id); texto = `Entregable ${e.numero}: ${String(e.nombre).slice(0, 80)}${k ? ` · OS N.° ${k.numero}` : ''}`; } }
    else if (f.entidad === 'plan_trabajo') { const p = planes.get(id); if (p) { consultorId = consultorId || p.consultor_id; texto = p.nombre ? String(p.nombre).slice(0, 100) : `Plan N.° ${id}`; } }
    else if (f.entidad === 'actividad') { const a = actividades.get(id); const p = a && planes.get(a.plan_id); if (a) { consultorId = consultorId || (p && p.consultor_id); texto = `Actividad ${a.numero}: ${String(a.descripcion || '').slice(0, 80)}`; } }
    else if (f.entidad === 'parte_diario') { const p = partesPorId.get(id); if (p) consultorId = consultorId || p.consultor_id; texto = p ? `Parte diario del ${ff(p.fecha)}` : `Parte diario N.° ${id}`; }
    else if (f.entidad === 'proyecto') texto = 'Proyecto';
    else if (f.entidad === 'carga') texto = 'Carga de documento';
    const c = consultorId && consultores.get(Number(consultorId));
    return { pertenece_a: texto, consultor_id: c ? c.consultor_id : null, profesional: c ? c.nombres : null, clave: c ? c.clave : null };
  }

  const propios = (documentos || []).filter((f) => Number(f.proyecto_id) === pid && f.activo !== 0 && f.activo !== false);
  const ocultos = verConfidencial ? 0 : propios.filter((f) => f.confidencial).length;
  const visibles = propios.filter((f) => verConfidencial || !f.confidencial);
  const ultima = new Map();
  for (const f of visibles) {
    const k = `${f.tipo}|${f.entidad}|${f.entidad_id ?? ''}`;
    const u = ultima.get(k);
    if (!u || Number(f.version) > Number(u.version) || (Number(f.version) === Number(u.version) && f.documento_id > u.documento_id)) ultima.set(k, f);
  }
  const vigentes = new Set([...ultima.values()].map((f) => f.documento_id));
  const filas = visibles.map((f) => ({
    documento_id: f.documento_id, tipo: f.tipo, tipo_nombre: NOMBRE_TIPO[f.tipo] || f.tipo, entidad: f.entidad, entidad_id: f.entidad_id,
    nombre: f.nombre_original, tipo_mime: f.tipo_mime, bytes: Number(f.bytes) || 0, version: Number(f.version) || 1, vigente: vigentes.has(f.documento_id),
    confidencial: !!f.confidencial, subido_por: f.subido_por || null, subido_en: f.subido_en || null, ...contexto(f),
  })).sort((a, b) => ORDEN_TIPOS.indexOf(a.tipo) - ORDEN_TIPOS.indexOf(b.tipo)
    || String(a.profesional || '').localeCompare(String(b.profesional || ''))
    || String(a.pertenece_a).localeCompare(String(b.pertenece_a), 'es', { numeric: true })
    || b.version - a.version || b.documento_id - a.documento_id);

  const porTipo = ORDEN_TIPOS.map((t) => ({ tipo: t, nombre: NOMBRE_TIPO[t], total: filas.filter((x) => x.tipo === t).length, vigentes: filas.filter((x) => x.tipo === t && x.vigente).length })).filter((g) => g.total);
  return { documentos: filas, por_tipo: porTipo, total: filas.length, vigentes: vigentes.size, confidenciales_ocultos: ocultos, bytes: filas.reduce((n, x) => n + x.bytes, 0) };
}

module.exports = { construirExpediente, NOMBRE_TIPO, ORDEN_TIPOS };
