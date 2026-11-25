'use strict';
/**
 * Plantilla de Excel (.xlsx) para actualizar actividades, adendas y planes. Sin filas de ejemplo: lo que se escribe se procesa.
 * Con un proyecto: lleva su nombre, una hoja «Profesionales» (de referencia; el intérprete no la procesa) con sus claves,
 * la lista desplegable de claves y, si el proyecto no maneja adendas (modalidad Orden de Servicio), no incluye esa hoja.
 */
const ExcelJS = require('exceljs');

const HOJAS = [
  { nombre: 'Actividades', columnas: [['clave', 10], ['numero', 10], ['avance', 10], ['estado', 14], ['inicio_plan', 14], ['fin_plan', 14], ['inicio_real', 14], ['fin_real', 14], ['descripcion', 50], ['evidencia', 30], ['observacion', 30], ['clasificacion', 14]],
    listas: { estado: ['PENDIENTE', 'EN_CURSO', 'CONCLUIDA', 'SUSPENDIDA'], clasificacion: ['ALINEADA', 'REASIGNADA', 'NUEVA', 'TRANSVERSAL'] } },
  { nombre: 'Adendas', columnas: [['contrato', 34], ['numero', 10], ['estado', 14], ['inicio', 14], ['fin', 14], ['plazo_dias', 12], ['plazo_solicitado_dias', 20], ['fecha_suscripcion', 18], ['documento', 40], ['expediente', 20], ['observacion', 40]],
    listas: { estado: ['ANUNCIADA', 'EN_TRAMITE', 'FIRMADA', 'CONCLUIDA', 'ANULADA'] } },
  { nombre: 'Planes', columnas: [['clave', 10], ['estado', 16], ['fecha_recepcion', 16], ['observacion', 50]],
    listas: { estado: ['POR_REGISTRAR', 'RECIBIDO', 'OBSERVADO', 'APROBADO'] } },
];

function instrucciones({ proyecto, conAdendas, ejemplo }) {
  return [
    `PLANTILLA DE ACTUALIZACIÓN – ${proyecto ? `${proyecto.codigo} · ${proyecto.nombre}` : 'Seguimiento de Proyectos de la OTI – SERFOR'}`,
    '',
    'Complete solo las hojas que necesite y deje en blanco lo que no cambia. Al subirla, el sistema muestra una vista previa y usted confirma antes de aplicar.',
    ...(proyecto ? ['La hoja «Profesionales» es de consulta: muestra las claves de este proyecto y no se procesa.'] : []),
    '',
    `ACTIVIDADES – una fila por actividad. Se identifica por «clave» (siglas del profesional, p. ej. ${ejemplo}) y «numero» (N.° de la actividad en su plan, p. ej. 1.2).`,
    '  · Si la actividad existe, se actualizan solo las columnas con valor (avance 0–100, estado, fechas del plan y reales, evidencia, observación).',
    '  · Si no existe, se crea como actividad nueva: son obligatorias descripcion, inicio_plan y fin_plan (queda «NUEVA», fuera de línea base, y exigirá su Acta de Control de Cambios).',
    '  · Cambiar inicio_plan o fin_plan es una reprogramación y queda registrada con el nombre del documento como motivo.',
    '',
    ...(conAdendas ? [
      'ADENDAS – una fila por adenda. «contrato» es el número completo (p. ej. 035-2026-MIDAGRI-SERFOR-PKFW) o sus 3 primeros dígitos; «numero» es el N.° de adenda.',
      '  · Columnas: estado, inicio, fin, plazo_dias (otorgado), plazo_solicitado_dias, fecha_suscripcion, documento (obligatorio si está FIRMADA), expediente, observacion.',
      '  · Si la adenda no existe se crea (obligatorios inicio y fin).',
      '',
    ] : [
      'ÓRDENES DE SERVICIO – en este proyecto la notificación, las ampliaciones de plazo y los entregables se registran en sus pantallas (lista de profesionales del proyecto), no con esta plantilla.',
      '',
    ]),
    'PLANES – una fila por profesional: estado del plan (POR_REGISTRAR, RECIBIDO, OBSERVADO o APROBADO), fecha_recepcion y observacion.',
    '',
    'FECHAS: AAAA-MM-DD o DD/MM/AAAA. ESTADOS: los códigos de las listas desplegables (también se aceptan «En curso», «Concluida», «Firmada»…).',
    'CSV: sirve el mismo formato (una hoja por archivo, con los encabezados de la hoja que corresponda).',
    'CRONOGRAMAS: también puede subir el Excel de un profesional con las columnas N.°, Nombre de tarea, Inicio, Fin y % completado, o el XML exportado de MS Project; elija al profesional en pantalla.',
  ];
}

/** opts: { proyecto, profesionales: [{ clave, nombres }] } (sin proyecto: la plantilla general de siempre). */
async function plantillaXlsx({ proyecto = null, profesionales = [] } = {}) {
  const conAdendas = !proyecto || proyecto.con_adendas !== 0;
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Seguimiento de Proyectos de la OTI – SERFOR';
  const ins = libro.addWorksheet('Instrucciones');
  ins.getColumn(1).width = 140;
  instrucciones({ proyecto, conAdendas, ejemplo: (profesionales[0] && profesionales[0].clave) || 'ERB' }).forEach((t, i) => { const c = ins.getCell(i + 1, 1); c.value = t; c.alignment = { wrapText: true, vertical: 'top' }; if (i === 0) c.font = { bold: true, size: 13 }; });
  const cabecera = (hoja) => {
    const cab = hoja.getRow(1);
    cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5F45' } };
    hoja.views = [{ state: 'frozen', ySplit: 1 }];
  };
  const listaClaves = proyecto && profesionales.length ? `Profesionales!$A$2:$A$${profesionales.length + 1}` : null;
  for (const h of HOJAS.filter((x) => conAdendas || x.nombre !== 'Adendas')) {
    const hoja = libro.addWorksheet(h.nombre);
    hoja.columns = h.columnas.map(([key, width]) => ({ header: key, key, width }));
    cabecera(hoja);
    h.columnas.forEach(([key], i) => {
      const lista = h.listas[key];
      const formulae = lista ? [`"${lista.join(',')}"`] : key === 'clave' && listaClaves ? [listaClaves] : null;
      if (!formulae) return;
      for (let r = 2; r <= 300; r += 1) hoja.getCell(r, i + 1).dataValidation = { type: 'list', allowBlank: true, formulae };
    });
  }
  if (proyecto) {
    const ref = libro.addWorksheet('Profesionales');
    ref.columns = [{ header: 'clave', key: 'clave', width: 10 }, { header: 'nombres', key: 'nombres', width: 45 }];
    cabecera(ref);
    for (const p of profesionales) ref.addRow({ clave: p.clave, nombres: p.nombres });
  }
  return Buffer.from(await libro.xlsx.writeBuffer());
}

module.exports = { plantillaXlsx, HOJAS };
