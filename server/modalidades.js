'use strict';
/**
 * Modalidades de proyecto (criterio C3 de PLAN_DE_MEJORAS.md; columna sgf.proyecto.modalidad, db/16).
 * La modalidad decide qué se pide al registrar, cómo empieza el plazo y qué opciones muestra el menú.
 * Las banderas con_* (db/13) se derivan de aquí: no las elige el usuario.
 */
const MODALIDADES = {
  ORDEN_SERVICIO: {
    nombre: 'Orden de Servicio',
    descripcion: 'Proceso estándar de la OTI: un TDR y una Orden de Servicio por profesional. El plazo corre desde el día siguiente de la notificación y se sigue por entregables.',
    banderas: { con_profesionales: 1, con_adendas: 0, con_linea_base: 0, con_orden_servicio: 1, con_tdr: 1 },
    documentos: ['TDR', 'ORDEN_SERVICIO', 'NOTIFICACION'],
    inicio: 'NOTIFICACION',
    entregables: true,
    atipico: false,
    estadoInicial: 'REGISTRADO',
  },
  CONTRATO_ADENDAS: {
    nombre: 'Contrato con adendas (caso atípico)',
    descripcion: 'Solo para casos como Gestiona Forestal (GF2026): contrato con adendas sucesivas y línea base propia. Exige el motivo.',
    banderas: { con_profesionales: 1, con_adendas: 1, con_linea_base: 1, con_orden_servicio: 0, con_tdr: 0 },
    documentos: [],
    inicio: 'ADENDA',
    entregables: false,
    atipico: true,
    estadoInicial: 'EN_EJECUCION',
  },
  GESTION_INTERNA: {
    nombre: 'Gestión interna',
    descripcion: 'Proyecto que ejecuta el propio personal de la OTI, sin profesionales contratados.',
    banderas: { con_profesionales: 0, con_adendas: 0, con_linea_base: 0, con_orden_servicio: 0, con_tdr: 0 },
    documentos: [],
    inicio: 'MANUAL',
    entregables: false,
    atipico: false,
    estadoInicial: 'REGISTRADO',
  },
};

const ESTADOS_PROYECTO = ['REGISTRADO', 'EN_EJECUCION', 'SUSPENDIDO', 'CONCLUIDO', 'CERRADO', 'ANULADO'];
/** Estados en los que el proyecto admite nuevas contrataciones o profesionales. */
const ESTADOS_ABIERTOS = ['REGISTRADO', 'EN_EJECUCION'];
const MEDIOS_NOTIFICACION = { CORREO: 'Correo electrónico', PRESENCIAL: 'Entrega presencial', MESA_PARTES: 'Mesa de partes', SISTEMA: 'Sistema de trámite' };

/** Modalidad de un proyecto (si no la tiene, se deduce de sus banderas, como en la migración de db/16). */
function modalidadDe(p) {
  if (p && MODALIDADES[p.modalidad]) return p.modalidad;
  if (!p || p.con_profesionales === 0) return 'GESTION_INTERNA';
  return p.con_adendas === 1 ? 'CONTRATO_ADENDAS' : 'ORDEN_SERVICIO';
}
const configDe = (p) => MODALIDADES[modalidadDe(p)];

/** Lo que el cliente necesita para formularios y menú. */
const publico = () => ({
  modalidades: Object.entries(MODALIDADES).map(([codigo, m]) => ({ codigo, nombre: m.nombre, descripcion: m.descripcion, documentos: m.documentos, entregables: m.entregables, atipico: m.atipico, banderas: m.banderas })),
  estados: ESTADOS_PROYECTO, medios_notificacion: MEDIOS_NOTIFICACION,
});

module.exports = { MODALIDADES, ESTADOS_PROYECTO, ESTADOS_ABIERTOS, MEDIOS_NOTIFICACION, modalidadDe, configDe, publico };
