'use strict';
/**
 * Metadatos de las entidades editables: tabla, clave, colección en memoria
 * y lista blanca de columnas que la API puede escribir.
 */
const ENTIDADES = {
  proyecto: {
    tabla: 'sgf.proyecto', pk: 'proyecto_id', coleccion: 'proyectos',
    columnas: ['codigo', 'nombre', 'financiador', 'area_tecnica', 'jefe_proyecto', 'fecha_inicio', 'fecha_fin', 'descripcion', 'con_profesionales', 'con_adendas', 'con_linea_base', 'con_orden_servicio', 'con_tdr', 'estado', 'activo'],
  },
  consultor: {
    tabla: 'sgf.consultor', pk: 'consultor_id', coleccion: 'consultores',
    columnas: ['clave', 'nombres', 'perfil', 'recurso_cronograma', 'unidad_contratante', 'unidad_servicio', 'proyecto', 'proyecto_id', 'sede', 'estado', 'correo_institucional', 'dni', 'telefono', 'correo_personal', 'observacion', 'activo'],
    personales: ['dni', 'telefono', 'correo_personal'],
  },
  contrato: {
    tabla: 'sgf.contrato', pk: 'contrato_id', coleccion: 'contratos',
    columnas: ['consultor_id', 'numero', 'tipo_documento', 'titulo_tdr', 'servicio', 'fecha_inicio', 'expediente', 'observacion', 'activo'],
  },
  adenda: {
    tabla: 'sgf.adenda', pk: 'adenda_id', coleccion: 'adendas',
    columnas: ['contrato_id', 'numero', 'fecha_inicio', 'fecha_fin', 'estado', 'expediente', 'documento_ref', 'fecha_suscripcion', 'plazo_dias', 'plazo_solicitado_dias', 'inicio_calculado', 'observacion', 'activo'],
  },
  plan_trabajo: {
    tabla: 'sgf.plan_trabajo', pk: 'plan_id', coleccion: 'planes',
    columnas: ['consultor_id', 'adenda_id', 'nombre', 'version_plan', 'fuente', 'fecha_recepcion', 'estado', 'tipo_dias', 'observacion', 'fecha_aprobacion', 'fecha_subsanacion', 'observacion_revision', 'area_usuaria', 'referencia_lb', 'supuestos', 'documento_origen', 'fecha_envio', 'fecha_aprobacion_jefe', 'aprobado_jefe_por', 'activo'],
  },
  actividad: {
    tabla: 'sgf.actividad', pk: 'actividad_id', coleccion: 'actividades',
    columnas: ['plan_id', 'numero', 'orden', 'descripcion', 'producto', 'edt_ref', 'clasificacion', 'entregable_id', 'control_cambio_id', 'es_hito', 'es_resumen', 'inicio_plan', 'fin_plan', 'inicio_real', 'fin_real', 'avance', 'estado', 'evidencia', 'observacion', 'fecha_revision', 'dias_plan', 'subactividades', 'agregada_por', 'activo'],
  },
  actividad_dependencia: {
    tabla: 'sgf.actividad_dependencia', pk: 'dependencia_id', coleccion: 'dependencias', sinRevision: true,
    columnas: ['actividad_id', 'predecesora_id', 'tipo', 'desfase_dias', 'activo'],
  },
  linea_base_entregable: {
    tabla: 'sgf.linea_base_entregable', pk: 'entregable_id', coleccion: 'linea_base',
    columnas: ['consultor_id', 'edt', 'nombre', 'inicio_lb', 'fin_lb', 'avance_corte', 'fecha_corte_lb', 'situacion', 'situacion_oti', 'fuente', 'activo'],
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
]);

const NUMERICAS = new Set(['con_profesionales', 'con_adendas', 'con_linea_base', 'con_orden_servicio', 'con_tdr', 'proyecto_id', 'consultor_id', 'contrato_id', 'adenda_id', 'plan_id', 'actividad_id', 'predecesora_id', 'entregable_id', 'control_cambio_id', 'orden', 'dias_plan', 'plazo_dias', 'plazo_solicitado_dias', 'inicio_calculado', 'es_hito', 'es_resumen', 'avance', 'avance_corte', 'desfase_dias', 'activo', 'entidad_id', 'bytes', 'version', 'reemplaza_id', 'confidencial', 'usuario_id', 'es_responsable']);

function filtrarColumnas(entidad, cambios) {
  const meta = ENTIDADES[entidad];
  if (!meta) throw Object.assign(new Error(`Entidad no válida: ${entidad}`), { estado: 400 });
  const out = {};
  for (const [k, v] of Object.entries(cambios || {})) {
    if (!meta.columnas.includes(k)) continue;
    let val = v === '' || v === undefined ? null : v;
    if (val !== null && (NUMERICAS.has(k) || (entidad === 'adenda' && k === 'numero'))) {
      val = Number(val);
      if (Number.isNaN(val)) throw Object.assign(new Error(`El campo ${k} debe ser numérico`), { estado: 400 });
    }
    out[k] = val;
  }
  return out;
}

module.exports = { ENTIDADES, COLUMNAS_FECHA, filtrarColumnas };
