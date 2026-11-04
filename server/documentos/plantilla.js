'use strict';
/** Plantilla de Excel (.xlsx) para actualizar actividades, adendas y planes. Sin filas de ejemplo: lo que se escribe se procesa. */
const ExcelJS = require('exceljs');

const HOJAS = [
  { nombre: 'Actividades', columnas: [['clave', 10], ['numero', 10], ['avance', 10], ['estado', 14], ['inicio_plan', 14], ['fin_plan', 14], ['inicio_real', 14], ['fin_real', 14], ['descripcion', 50], ['evidencia', 30], ['observacion', 30], ['clasificacion', 14]],
    listas: { estado: ['PENDIENTE', 'EN_CURSO', 'CONCLUIDA', 'SUSPENDIDA'], clasificacion: ['ALINEADA', 'REASIGNADA', 'NUEVA', 'TRANSVERSAL'] } },
  { nombre: 'Adendas', columnas: [['contrato', 34], ['numero', 10], ['estado', 14], ['inicio', 14], ['fin', 14], ['plazo_dias', 12], ['plazo_solicitado_dias', 20], ['fecha_suscripcion', 18], ['documento', 40], ['expediente', 20], ['observacion', 40]],
    listas: { estado: ['ANUNCIADA', 'EN_TRAMITE', 'FIRMADA', 'CONCLUIDA', 'ANULADA'] } },
  { nombre: 'Planes', columnas: [['clave', 10], ['estado', 16], ['fecha_recepcion', 16], ['observacion', 50]],
    listas: { estado: ['POR_REGISTRAR', 'RECIBIDO', 'OBSERVADO', 'APROBADO'] } },
];

const INSTRUCCIONES = [
  'PLANTILLA DE ACTUALIZACIÓN – Seguimiento Actividades Gestiona Forestal 2026',
  '',
  'Complete solo las hojas que necesite y deje en blanco lo que no cambia. Al subirla, el sistema muestra una vista previa y usted confirma antes de aplicar.',
  '',
  'ACTIVIDADES – una fila por actividad. Se identifica por «clave» (siglas del profesional, p. ej. ERB) y «numero» (N.° de la actividad en su plan, p. ej. 1.2).',
  '  · Si la actividad existe, se actualizan solo las columnas con valor (avance 0–100, estado, fechas del plan y reales, evidencia, observación).',
  '  · Si no existe, se crea como actividad nueva: son obligatorias descripcion, inicio_plan y fin_plan (queda «NUEVA», fuera de línea base, y exigirá su Acta de Control de Cambios).',
  '  · Cambiar inicio_plan o fin_plan es una reprogramación y queda registrada con el nombre del documento como motivo.',
  '',
  'ADENDAS – una fila por adenda. «contrato» es el número completo (p. ej. 035-2026-MIDAGRI-SERFOR-PKFW) o sus 3 primeros dígitos; «numero» es el N.° de adenda.',
  '  · Columnas: estado, inicio, fin, plazo_dias (otorgado), plazo_solicitado_dias, fecha_suscripcion, documento (obligatorio si está FIRMADA), expediente, observacion.',
  '  · Si la adenda no existe se crea (obligatorios inicio y fin).',
  '',
  'PLANES – una fila por profesional: estado del plan (POR_REGISTRAR, RECIBIDO, OBSERVADO o APROBADO), fecha_recepcion y observacion.',
  '',
  'FECHAS: AAAA-MM-DD o DD/MM/AAAA. ESTADOS: los códigos de las listas desplegables (también se aceptan «En curso», «Concluida», «Firmada»…).',
  'CSV: sirve el mismo formato (una hoja por archivo, con los encabezados de la hoja que corresponda).',
  'CRONOGRAMAS: también puede subir el Excel de un profesional con las columnas N.°, Nombre de tarea, Inicio, Fin y % completado, o el XML exportado de MS Project; elija al profesional en pantalla.',
];

async function plantillaXlsx() {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Seguimiento Actividades Gestiona Forestal 2026';
  const ins = libro.addWorksheet('Instrucciones');
  ins.getColumn(1).width = 140;
  INSTRUCCIONES.forEach((t, i) => { const c = ins.getCell(i + 1, 1); c.value = t; c.alignment = { wrapText: true, vertical: 'top' }; if (i === 0) c.font = { bold: true, size: 13 }; });
  for (const h of HOJAS) {
    const hoja = libro.addWorksheet(h.nombre);
    hoja.columns = h.columnas.map(([key, width]) => ({ header: key, key, width }));
    const cab = hoja.getRow(1);
    cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5F45' } };
    hoja.views = [{ state: 'frozen', ySplit: 1 }];
    h.columnas.forEach(([key], i) => {
      const lista = h.listas[key];
      if (!lista) return;
      const col = hoja.getColumn(i + 1);
      for (let r = 2; r <= 300; r += 1) hoja.getCell(r, col.number).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${lista.join(',')}"`] };
    });
  }
  return Buffer.from(await libro.xlsx.writeBuffer());
}

module.exports = { plantillaXlsx, HOJAS };
