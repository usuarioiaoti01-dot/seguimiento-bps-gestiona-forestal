'use strict';
/**
 * Reporte mensual para Gerencia (Etapa 5 de PLAN_DE_MEJORAS.md; backlog «informe situacional»).
 * construirReporte: función PURA que arma el contenido del mes a partir de la foto de datos, el portafolio calculado al
 * corte (último día del mes, o hoy si el mes está en curso) y los partes del mes. generarPdfReporte: dibuja el PDF.
 * Los montos llegan ya filtrados por el servidor (solo los proyectos que el usuario puede ver).
 */
const PDFDocument = require('pdfkit');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
const ff = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const ESTADO = { REGISTRADO: 'Registrado', EN_EJECUCION: 'En ejecución', SUSPENDIDO: 'Suspendido', CONCLUIDO: 'Concluido', CERRADO: 'Cerrado', ANULADO: 'Anulado' };
const MODALIDAD = { ORDEN_SERVICIO: 'Orden de Servicio', CONTRATO_ADENDAS: 'Contrato con adendas', GESTION_INTERNA: 'Gestión interna' };
const SEM = { ROJO: 'Rojo', AMBAR: 'Ámbar', VERDE: 'Verde', AZUL: 'En revisión', GRIS: '—' };
const soles = (n) => `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n) => (n === null || n === undefined ? '—' : `${Number(n).toLocaleString('es-PE', { maximumFractionDigits: 1 })} %`);

/** Primer y último día del mes AAAA-MM. */
function rangoMes(mes) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes || ''))) throw Object.assign(new Error('Indique el mes en formato AAAA-MM'), { estado: 400 });
  const [a, m] = mes.split('-').map(Number);
  const fin = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  return { desde: `${mes}-01`, hasta: fin, nombre: `${MESES[m - 1]} de ${a}` };
}

/**
 * @param datos      foto de la base
 * @param estado     construirEstado(datos, { corte })
 * @param portafolio construirPortafolio(datos, estado) con los montos ya filtrados
 * @param partes     partes diarios del mes (repo.listarPartes)
 */
function construirReporte({ mes, datos, estado, portafolio, partes, montos, generado_por, generado_en }) {
  const { desde, hasta, nombre } = rangoMes(mes);
  const enMes = (f) => f && f >= desde && f <= hasta;
  const consultor = new Map(datos.consultores.map((c) => [c.consultor_id, c]));
  const contrato = new Map(datos.contratos.map((k) => [k.contrato_id, k]));
  const proyectoDeContrato = (id) => { const k = contrato.get(id); const c = k && consultor.get(k.consultor_id); return c ? c.proyecto_id : null; };
  const hechos = new Map(); // proyecto_id -> textos
  const anotar = (pid, texto) => { if (!pid) return; if (!hechos.has(pid)) hechos.set(pid, []); hechos.get(pid).push(texto); };

  for (const k of datos.contratos.filter((x) => x.tipo_documento === 'ORDEN_SERVICIO')) {
    const c = consultor.get(k.consultor_id); const pid = c && c.proyecto_id; const quien = c ? c.nombres : '';
    if (enMes(k.fecha_notificacion)) anotar(pid, `OS N.° ${k.numero} notificada el ${ff(k.fecha_notificacion)} (${quien}); vence el ${ff(k.fecha_fin)}.`);
    if (enMes(k.fecha_culminacion)) anotar(pid, `OS N.° ${k.numero} ${k.estado_contratacion === 'RESUELTA' ? 'resuelta' : 'culminada'} el ${ff(k.fecha_culminacion)} (${quien}).`);
  }
  for (const e of (datos.entregables_servicio || []).filter((x) => x.activo !== 0)) {
    const pid = proyectoDeContrato(e.contrato_id); const nom = `Entregable ${e.numero} «${String(e.nombre).slice(0, 60)}»`;
    if (enMes(e.fecha_presentacion)) anotar(pid, `${nom} presentado el ${ff(e.fecha_presentacion)}${e.fecha_limite && e.fecha_presentacion > e.fecha_limite ? ` (fuera de plazo; límite ${ff(e.fecha_limite)})` : ''}.`);
    if (enMes(e.fecha_observacion)) anotar(pid, `${nom} observado el ${ff(e.fecha_observacion)}.`);
    if (enMes(e.fecha_conformidad)) anotar(pid, `${nom} con conformidad el ${ff(e.fecha_conformidad)} (${e.conformidad_ref || 's/d'}).`);
  }
  const partesPorProyecto = new Map();
  for (const p of partes) partesPorProyecto.set(p.proyecto_id, (partesPorProyecto.get(p.proyecto_id) || 0) + 1);
  for (const [pid, n] of partesPorProyecto) anotar(pid, `${n} parte(s) diario(s) de supervisión registrados.`);
  for (const p of datos.proyectos.filter((x) => enMes(x.fecha_cierre))) anotar(p.proyecto_id, `Proyecto cerrado el ${ff(p.fecha_cierre)}.`);

  const filas = portafolio.proyectos.filter((p) => p.en_curso || hechos.has(p.proyecto_id) || (p.terminado && enMes(p.fin_terminado)));
  const proyectoDeConsultor = (id) => (consultor.get(id) || {}).proyecto_id;
  const codigo = new Map(portafolio.proyectos.map((p) => [p.proyecto_id, p.codigo]));
  const altas = estado.alertas.filter((a) => a.prioridad === 'ALTA').map((a) => ({ proyecto: codigo.get(proyectoDeConsultor(a.consultor_id)) || '—', profesional: a.nombres, titulo: a.titulo, accion: a.accion }));
  return {
    mes, nombre_mes: nombre, desde, hasta, corte: estado.corte, generado_por, generado_en,
    resumen: portafolio.resumen, montos,
    proyectos: filas.map((p) => ({ ...p, hechos: hechos.get(p.proyecto_id) || [] })),
    alertas_altas: altas,
    partes_mes: partes.length,
  };
}

function generarPdfReporte(r) {
  return new Promise((resolver, rechazar) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, info: { Title: `Reporte mensual de proyectos · ${r.nombre_mes}`, Author: 'OTI – SERFOR' } });
    const trozos = [];
    doc.on('data', (t) => trozos.push(t));
    doc.on('end', () => resolver(Buffer.concat(trozos)));
    doc.on('error', rechazar);
    const VERDE = '#1f5c44'; const GRIS = '#f1f3f1'; const LINEA = '#c9cfca';
    const COLOR = { ROJO: '#b42318', AMBAR: '#b54708', VERDE: '#1f7a4d', AZUL: '#1d4ed8', GRIS: '#8a8f8b' };
    const x0 = doc.page.margins.left;
    const ancho = doc.page.width - x0 - doc.page.margins.right;
    const fondo = () => doc.page.height - doc.page.margins.bottom;
    const titulo = (t) => { if (doc.y > fondo() - 60) doc.addPage(); doc.moveDown(0.6); doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(t, x0, doc.y); doc.moveDown(0.3); };

    doc.font('Helvetica-Bold').fontSize(15).fillColor(VERDE).text('REPORTE MENSUAL DE PROYECTOS', x0, 36, { width: ancho, align: 'center' });
    doc.font('Helvetica').fontSize(10).fillColor('#444').text(`Oficina de Tecnologías de la Información – SERFOR · ${r.nombre_mes[0].toUpperCase()}${r.nombre_mes.slice(1)} · corte al ${ff(r.corte)}`, { width: ancho, align: 'center' });
    doc.fontSize(8).fillColor('#777').text(`Generado por ${r.generado_por} el ${r.generado_en}`, { width: ancho, align: 'center' });

    // Resumen
    titulo('RESUMEN');
    const s = r.resumen;
    const datosResumen = [
      ['Proyectos en curso', `${s.en_curso} (${s.semaforo.ROJO} en rojo, ${s.semaforo.AMBAR} en ámbar)`], ['Proyectos terminados', `${s.terminados} en total; ${s.terminados_anio} en el año`],
      ['Órdenes de Servicio en ejecución', `${s.os_en_ejecucion} (${s.os_sin_notificar} registradas sin notificar)`], ['Entregables', `${s.entregables_vencidos} vencidos sin presentar · ${s.entregables_por_vencer} por vencer · ${s.conformidades_fuera_de_plazo} con conformidad fuera de plazo`],
      ['Vigencias por vencer', `${s.vencen_15_dias} profesional(es)`], ['Supervisión', `${r.partes_mes} parte(s) diario(s) en el mes · ${s.sin_parte} proyecto(s) con supervisión atrasada`],
      ...(r.montos && r.montos.proyectos_con_monto ? [['Monto comprometido', `${soles(r.montos.comprometido)} · con conformidad: ${soles(r.montos.conforme)} (${r.montos.proyectos_con_monto} proyecto(s))`]] : []),
    ];
    const wEt = 210;
    for (const [et, val] of datosResumen) {
      const alto = Math.max(doc.font('Helvetica').fontSize(9.5).heightOfString(val, { width: ancho - wEt - 16 }), 11) + 9;
      const y = doc.y;
      doc.rect(x0, y, wEt, alto).fillAndStroke(GRIS, LINEA);
      doc.rect(x0 + wEt, y, ancho - wEt, alto).strokeColor(LINEA).stroke();
      doc.fillColor('#444').font('Helvetica-Bold').fontSize(8.5).text(et.toUpperCase(), x0 + 8, y + 5, { width: wEt - 16 });
      doc.fillColor('#000').font('Helvetica').fontSize(9.5).text(val, x0 + wEt + 8, y + 4, { width: ancho - wEt - 16 });
      doc.y = y + alto;
    }

    // Proyectos
    titulo('PROYECTOS');
    const cols = [['PROYECTO', 230], ['MODALIDAD', 95], ['ESTADO', 70], ['RESPONSABLE', 105], ['AVANCE', 50], ['SEMÁFORO', 60], ['PRÓXIMO ENTREGABLE', 150], ['ALERTAS ALTAS', ancho - 760]];
    const encabezado = () => { const y = doc.y; let x = x0; doc.rect(x0, y, ancho, 18).fill(VERDE); doc.fillColor('#fff').font('Helvetica-Bold').fontSize(7.5); for (const [t, w] of cols) { doc.text(t, x + 4, y + 5, { width: w - 8 }); x += w; } doc.y = y + 18; };
    const fila = (celdas, colorSem) => {
      doc.font('Helvetica').fontSize(8);
      const alto = Math.max(...celdas.map((c, i) => doc.heightOfString(String(c), { width: cols[i][1] - 8 }))) + 8;
      if (doc.y + alto > fondo()) { doc.addPage(); encabezado(); }
      const y = doc.y; let x = x0;
      doc.rect(x0, y, ancho, alto).strokeColor(LINEA).stroke();
      celdas.forEach((c, i) => { doc.fillColor(i === 5 && colorSem ? colorSem : '#000').font(i === 0 || i === 5 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).text(String(c), x + 4, y + 4, { width: cols[i][1] - 8 }); x += cols[i][1]; });
      doc.y = y + alto;
    };
    encabezado();
    for (const p of r.proyectos) {
      const pe = p.proximo_entregable;
      fila([`${p.codigo} · ${p.nombre}${p.es_atipico ? ' (atípico)' : ''}`, MODALIDAD[p.modalidad] || p.modalidad, ESTADO[p.estado] || p.estado, p.responsable || '—', num(p.avance), SEM[p.semaforo] || p.semaforo,
        pe ? `${pe.numero}. ${pe.nombre} (${ff(pe.fecha_limite)})` : '—', String(p.alertas.altas)], COLOR[p.semaforo]);
    }
    if (!r.proyectos.length) doc.font('Helvetica').fontSize(9).fillColor('#666').text('Sin proyectos en curso ni movimientos en el mes.', x0, doc.y + 4);

    // Hechos del mes
    titulo(`HECHOS DEL MES (${r.nombre_mes.toUpperCase()})`);
    const conHechos = r.proyectos.filter((p) => p.hechos.length);
    if (!conHechos.length) doc.font('Helvetica').fontSize(9).fillColor('#666').text('Sin movimientos registrados en el mes.', x0, doc.y);
    for (const p of conHechos) {
      if (doc.y > fondo() - 40) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(VERDE).text(`${p.codigo} · ${p.nombre}`, x0, doc.y);
      doc.font('Helvetica').fontSize(8.5).fillColor('#000');
      for (const h of p.hechos) doc.text(`•  ${h}`, x0 + 10, doc.y, { width: ancho - 10 });
      doc.moveDown(0.3);
    }

    // Alertas altas
    titulo(`ALERTAS DE PRIORIDAD ALTA VIGENTES (${r.alertas_altas.length})`);
    if (!r.alertas_altas.length) doc.font('Helvetica').fontSize(9).fillColor('#666').text('Sin alertas de prioridad alta.', x0, doc.y);
    for (const a of r.alertas_altas.slice(0, 60)) {
      if (doc.y > fondo() - 30) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000').text(`${a.proyecto} · ${a.profesional}: `, x0, doc.y, { continued: true }).font('Helvetica').text(`${a.titulo}. ${a.accion}`, { width: ancho });
    }
    if (r.alertas_altas.length > 60) doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666').text(`… y ${r.alertas_altas.length - 60} más (ver el Tablero general).`, x0, doc.y);
    doc.end();
  });
}

module.exports = { construirReporte, generarPdfReporte, rangoMes };
