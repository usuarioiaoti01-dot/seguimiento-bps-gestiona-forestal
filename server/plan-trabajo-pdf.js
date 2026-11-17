'use strict';
/**
 * PDF del plan de trabajo aprobado (plantilla «Cronograma de actividades»): datos generales, actividades y comentarios.
 * Función pura: recibe el detalle de `formulacion.detalle()` y devuelve el PDF en un Buffer.
 */
const PDFDocument = require('pdfkit');

const ff = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const VERDE = '#1f5c44';
const GRIS = '#f1f3f1';
const LINEA = '#c9cfca';

function generarPdfPlan(d) {
  return new Promise((resolver, rechazar) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, info: { Title: `Cronograma de actividades · ${d.consultor.nombres}`, Author: 'OTI – SERFOR' } });
    const trozos = [];
    doc.on('data', (t) => trozos.push(t));
    doc.on('end', () => resolver(Buffer.concat(trozos)));
    doc.on('error', rechazar);

    const x0 = doc.page.margins.left;
    const ancho = doc.page.width - x0 - doc.page.margins.right;
    const fondo = () => doc.page.height - doc.page.margins.bottom;
    const p = d.plan; const per = d.periodo;

    doc.font('Helvetica-Bold').fontSize(16).fillColor(VERDE).text('CRONOGRAMA DE ACTIVIDADES', x0, 36, { width: ancho, align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor('#444').text(`${d.consultor.nombres}${d.consultor.perfil ? ` — ${d.consultor.perfil}` : ''}`, { width: ancho, align: 'center' });
    doc.moveDown(0.8);

    // Datos generales
    const filas = [
      ['Proyecto', d.proyecto],
      ['Gestión del Proyecto', d.area_tecnica],
      ['Jefe de Proyecto', (p && p.aprobado_jefe_por) || '—'],
      ['Consultor / Programador', `${d.consultor.nombres}${d.consultor.perfil ? ` — ${d.consultor.perfil}` : ''}`],
      ['Contrato / Adenda', per ? `Adenda N.° ${String(per.numero).padStart(2, '0')} al Contrato N.° ${d.contrato ? d.contrato.numero : '—'}` : (d.contrato ? d.contrato.numero : '—')],
      ['Periodo de ejecución', per ? `Del ${ff(per.inicio)} al ${ff(per.fin)} · ${per.dias_habiles} días hábiles (${per.dias_calendario} días calendario)` : '—'],
      ...(!d.aprobacion && p && p.estado === 'EN_REVISION_ADMIN' ? [['Estado del plan', `Pendiente de aprobación del Administrador · aprobado por el Jefe de Proyecto${p.aprobado_jefe_por ? ` ${p.aprobado_jefe_por}` : ''}${p.fecha_aprobacion_jefe ? ` el ${ff(p.fecha_aprobacion_jefe)}` : ''}. Las fechas son referenciales: variarán cuando el Administrador apruebe el plan.`]] : []),
      ...(d.aprobacion ? [['Aprobación del plan', `Aprobado el ${ff(d.aprobacion.fecha)}${d.aprobacion.dias !== null ? ` · ${d.aprobacion.dias} día(s) después de la suscripción de la adenda (${ff(d.aprobacion.suscripcion)})` : ''}`]] : []),
    ];
    const wEt = 170;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text('DATOS GENERALES', x0, doc.y);
    doc.moveDown(0.3);
    for (const [et, val] of filas) {
      const alto = Math.max(doc.font('Helvetica').fontSize(10).heightOfString(String(val), { width: ancho - wEt - 16 }), 12) + 10;
      const y = doc.y;
      doc.rect(x0, y, wEt, alto).fillAndStroke(GRIS, LINEA);
      doc.rect(x0 + wEt, y, ancho - wEt, alto).strokeColor(LINEA).stroke();
      doc.fillColor('#444').font('Helvetica-Bold').fontSize(9).text(et.toUpperCase(), x0 + 8, y + 6, { width: wEt - 16 });
      doc.fillColor('#000').font('Helvetica').fontSize(10).text(String(val), x0 + wEt + 8, y + 5, { width: ancho - wEt - 16 });
      doc.y = y + alto;
    }
    doc.moveDown(1);

    // Actividades
    const cols = [['N.°', 30], ['ACTIVIDAD', 300], ['PRODUCTO / EVIDENCIA VERIFICABLE', 260], ['INICIO', 60], ['FIN', 60], ['DÍAS HÁB.', ancho - 710]];
    const encabezado = () => {
      const y = doc.y; let x = x0;
      doc.rect(x0, y, ancho, 20).fill(VERDE);
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
      for (const [t, w] of cols) { doc.text(t, x + 4, y + 6, { width: w - 8 }); x += w; }
      doc.y = y + 20;
    };
    if (doc.y > fondo() - 80) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text('ACTIVIDADES', x0, doc.y);
    doc.moveDown(0.3);
    encabezado();
    const fila = (celdas, { negrita = false, relleno = null } = {}) => {
      doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      const alto = Math.max(...celdas.map((c, i) => doc.heightOfString(String(c), { width: cols[i][1] - 8 }))) + 10;
      if (doc.y + alto > fondo() ) { doc.addPage(); encabezado(); }
      const y = doc.y; let x = x0;
      if (relleno) doc.rect(x0, y, ancho, alto).fill(relleno);
      doc.rect(x0, y, ancho, alto).strokeColor(LINEA).stroke();
      doc.fillColor('#000').font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      celdas.forEach((c, i) => { doc.text(String(c), x + 4, y + 5, { width: cols[i][1] - 8 }); x += cols[i][1]; });
      doc.y = y + alto;
    };
    for (const a of d.actividades) {
      const subs = a.subactividades || [];
      const docsTxt = (a.documentos || []).length ? `Documentos: ${a.documentos.map((x) => x.nombre).join('; ')}` : '';
      fila([a.numero, a.descripcion + (a.agregada_por ? `\n(Agregada por ${a.agregada_por === 'ADMIN' ? 'el Administrador' : 'el Jefe de Proyecto'})` : ''), subs.length ? docsTxt : [a.producto || '', docsTxt].filter(Boolean).join('\n'), ff(a.inicio_plan), ff(a.fin_plan), String(a.dias_habiles)], { negrita: true, relleno: '#F2F4F2' });
      subs.forEach((s, k) => fila([`${a.numero}.${k + 1}`, `•  ${s.texto}`, s.producto || '', ff(s.inicio_plan), ff(s.fin_plan), String(s.dias)]));
    }
    if (!d.actividades.length) doc.font('Helvetica').fontSize(9).fillColor('#666').text('Sin actividades registradas', x0, doc.y + 6);
    doc.moveDown(1);

    // Comentarios
    if (doc.y > fondo() - 70) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text('COMENTARIOS', x0, doc.y);
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10).fillColor('#000').text((p && p.supuestos) || 'Sin comentarios', x0, doc.y, { width: ancho });
    if (p && p.fecha_aprobacion) {
      doc.moveDown(1);
      doc.font('Helvetica-Oblique').fontSize(9).fillColor('#555').text(`Plan de trabajo aprobado el ${ff(p.fecha_aprobacion)}.`, x0, doc.y, { width: ancho });
    }
    doc.end();
  });
}

module.exports = { generarPdfPlan };
