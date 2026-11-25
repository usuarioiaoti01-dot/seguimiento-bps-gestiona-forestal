'use strict';
/**
 * Metadatos de las entidades editables: tabla, clave, colección en memoria
 * y lista blanca de columnas que la API puede escribir.
 */
const ENTIDADES = {
  proyecto: {
    tabla: 'sgf.proyecto', pk: 'proyecto_id', coleccion: 'proyectos',
    columnas: ['codigo', 'nombre', 'financiador', 'area_tecnica', 'jefe_proyecto', 'fecha_inicio', 'fecha_fin', 'descripcion', 'con_profesionales', 'con_adendas', 'con_linea_base', 'con_orden_servicio', 'con_tdr', 'estado', 'activo',
      'modalidad', 'es_atipico', 'motivo_atipico', 'unidad_usuaria', 'objetivo', 'fecha_cierre', 'lecciones_aprendidas'], // db/16
  },
  consultor: {
    tabla: 'sgf.consultor', pk: 'consultor_id', coleccion: 'consultores',
    columnas: ['clave', 'nombres', 'perfil', 'recurso_cronograma', 'unidad_contratante', 'unidad_servicio', 'proyecto', 'proyecto_id', 'sede', 'estado', 'correo_institucional', 'dni', 'telefono', 'correo_personal', 'observacion', 'activo'],
    personales: ['dni', 'telefono', 'correo_personal'],
  },
  contrato: {
    tabla: 'sgf.contrato', pk: 'contrato_id', coleccion: 'contratos',
    columnas: ['consultor_id', 'numero', 'tipo_documento', 'titulo_tdr', 'servicio', 'fecha_inicio', 'expediente', 'observacion', 'activo',
      'fecha_notificacion', 'medio_notificacion', 'plazo_dias', 'fecha_fin', 'monto', 'estado_contratacion', 'contrato_anterior_id', 'fecha_culminacion', 'fecha_registro'], // db/17
    confidenciales: ['monto'], // decisión D4: solo el Administrador y el equipo del proyecto
  },
  adenda: {
    tabla: 'sgf.adenda', pk: 'adenda_id', coleccion: 'adendas',
    columnas: ['contrato_id', 'numero', 'fecha_inicio', 'fecha_fin', 'estado', 'expediente', 'documento_ref', 'fecha_suscripcion', 'plazo_dias', 'plazo_solicitado_dias', 'inicio_calculado', 'observacion', 'activo', 'tipo_periodo'],
  },
  plan_trabajo: {
    tabla: 'sgf.plan_trabajo', pk: 'plan_id', coleccion: 'planes',
    columnas: ['consultor_id', 'adenda_id', 'nombre', 'version_plan', 'fuente', 'fecha_recepcion', 'estado', 'tipo_dias', 'observacion', 'fecha_aprobacion', 'fecha_subsanacion', 'observacion_revision', 'area_usuaria', 'referencia_lb', 'supuestos', 'documento_origen', 'fecha_envio', 'fecha_aprobacion_jefe', 'aprobado_jefe_por', 'activo'],
  },
  actividad: {
    tabla: 'sgf.actividad', pk: 'actividad_id', coleccion: 'actividades',
    columnas: ['plan_id', 'numero', 'orden', 'descripcion', 'producto', 'edt_ref', 'clasificacion', 'entregable_id', 'control_cambio_id', 'es_hito', 'es_resumen', 'inicio_plan', 'fin_plan', 'inicio_real', 'fin_real', 'avance', 'estado', 'evidencia', 'observacion', 'fecha_revision', 'dias_plan', 'subactividades', 'agregada_por', 'activo', 'entregable_servicio_id'],
  },
  actividad_dependencia: {
    tabla: 'sgf.actividad_dependencia', pk: 'dependencia_id', coleccion: 'dependencias', sinRevision: true,
    columnas: ['actividad_id', 'predecesora_id', 'tipo', 'desfase_dias', 'activo'],
  },
  linea_base_entregable: {
    tabla: 'sgf.linea_base_entregable', pk: 'entregable_id', coleccion: 'linea_base',
    columnas: ['consultor_id', 'edt', 'nombre', 'inicio_lb', 'fin_lb', 'avance_corte', 'fecha_corte_lb', 'situacion', 'situacion_oti', 'fuente', 'activo'],
  },
  // db/17: entregables del TDR de cada Orden de Servicio (plazo en días calendario desde la notificación)
  entregable_servicio: {
    tabla: 'sgf.entregable_servicio', pk: 'entregable_servicio_id', coleccion: 'entregables_servicio',
    columnas: ['contrato_id', 'numero', 'nombre', 'descripcion', 'plazo_dias', 'fecha_limite', 'porcentaje_pago', 'estado', 'fecha_presentacion', 'fecha_observacion', 'plazo_subsanacion_dias', 'fecha_limite_subsanacion', 'fecha_conformidad', 'conformidad_ref', 'observacion', 'activo', 'fecha_subsanacion'],
  },
  // db/18: partes diarios del equipo del proyecto (solo inserción: se corrigen con otro parte que los rectifica)
  parte_diario: {
    tabla: 'sgf.parte_diario', pk: 'parte_id', coleccion: 'partes', sinRevision: true,
    columnas: ['proyecto_id', 'consultor_id', 'contrato_id', 'fecha', 'descripcion', 'incidencias', 'riesgos', 'justificacion', 'rectifica_parte_id', 'activo'],
  },
  parte_diario_item: {
    tabla: 'sgf.parte_diario_item', pk: 'item_id', coleccion: 'partes_items', sinRevision: true,
    columnas: ['parte_id', 'actividad_id', 'subactividad_indice', 'avance_anterior', 'avance_reportado', 'estado_reportado', 'comentario', 'activo'],
  },
  // db/14: metadatos de cada archivo guardado (el archivo vive en disco)
  documento: {
    tabla: 'sgf.documento', pk: 'documento_id', coleccion: 'documentos',
    columnas: ['tipo', 'entidad', 'entidad_id', 'proyecto_id', 'consultor_id', 'nombre_original', 'raiz', 'ruta_relativa', 'tipo_mime', 'bytes', 'sha256', 'version', 'reemplaza_id', 'confidencial', 'subido_por', 'activo'],
  },
  // db/15: equipo de cada proyecto (Jefes de Proyecto que escriben en él)
  proyecto_miembro: {
    tabla: 'sgf.proyecto_miembro', pk: 'miembro_id', coleccion: 'miembros',
    columnas: ['proyecto_id', 'usuario_id', 'es_responsable', 'desde', 'hasta', 'activo'],
  },
  control_cambio: {
    tabla: 'sgf.control_cambio', pk: 'control_cambio_id', coleccion: 'controles_cambio',
    columnas: ['consultor_id', 'titulo', 'estado', 'fecha', 'documento_ref', 'observacion', 'activo'],
  },
};

const COLUMNAS_FECHA = new Set([
  'fecha_inicio', 'fecha_fin', 'fecha_suscripcion', 'fecha_recepcion', 'fecha_aprobacion', 'fecha_subsanacion', 'fecha_envio', 'fecha_aprobacion_jefe', 'inicio_lb', 'fin_lb', 'fecha_corte_lb', 'fecha',
  'inicio_plan', 'fin_plan', 'inicio_real', 'fin_real', 'fecha_revision', 'fecha_corte', 'inicio_probable', 'fin_probable', 'fin_vigencia', 'desde', 'hasta',
  'fecha_notificacion', 'fecha_culminacion', 'fecha_registro', 'fecha_limite', 'fecha_presentacion', 'fecha_observacion', 'fecha_limite_subsanacion', 'fecha_conformidad', 'fecha_cierre', 'fecha_subsanacion',
]);

const NUMERICAS = new Set(['con_profesionales', 'con_adendas', 'con_linea_base', 'con_orden_servicio', 'con_tdr', 'proyecto_id', 'consultor_id', 'contrato_id', 'adenda_id', 'plan_id', 'actividad_id', 'predecesora_id', 'entregable_id', 'control_cambio_id', 'orden', 'dias_plan', 'plazo_dias', 'plazo_solicitado_dias', 'inicio_calculado', 'es_hito', 'es_resumen', 'avance', 'avance_corte', 'desfase_dias', 'activo', 'entidad_id', 'bytes', 'version', 'reemplaza_id', 'confidencial', 'usuario_id', 'es_responsable', 'es_atipico', 'contrato_anterior_id', 'entregable_servicio_id', 'plazo_subsanacion_dias', 'monto', 'porcentaje_pago', 'parte_id', 'rectifica_parte_id', 'item_id', 'subactividad_indice', 'avance_anterior', 'avance_reportado']);

function filtrarColumnas(entidad, cambios) {
  const meta = ENTIDADES[entidad];
  if (!meta) throw Object.assign(new Error(`Entidad no válida: ${entidad}`), { estado: 400 });
  const out = {};
  for (const [k, v] of Object.entries(cambios || {})) {
    if (!meta.columnas.includes(k)) continue;
    let val = v === '' || v === undefined ? null : v;
    if (val !== null && (NUMERICAS.has(k) || ((entidad === 'adenda' || entidad === 'entregable_servicio') && k === 'numero'))) {
      val = Number(val);
      if (Number.isNaN(val)) throw Object.assign(new Error(`El campo ${k} debe ser numérico`), { estado: 400 });
    }
    out[k] = val;
  }
  return out;
}

module.exports = { ENTIDADES, COLUMNAS_FECHA, filtrarColumnas };
