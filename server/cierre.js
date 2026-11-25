'use strict';
/**
 * Cierre formal del proyecto (P9 y R-PY2 de PLAN_DE_MEJORAS.md; Etapa 5).
 * CERRADO exige: ninguna Orden de Servicio abierta (registrada o en ejecución), todos los entregables con conformidad o
 * anulados (los de una OS resuelta se anulan con su motivo), ningún profesional ACTIVO, el informe de cierre (PDF)
 * y las lecciones aprendidas. Lo hacen el Administrador o el equipo del proyecto (permisos.js admite esta operación).
 * El cambio de estado a CERRADO ya no se hace editando el proyecto: solo por aquí.
 */
const { hoyLima } = require('./motor/calendario');
const { esFecha } = require('./motor/plazos');
const { configDe } = require('./modalidades');

const error = (estado, mensaje, extra = {}) => Object.assign(new Error(mensaje), { estado, ...extra });
const vivo = (x) => x && x.activo !== 0 && x.activo !== false;
const ff = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');

function crearCierre({ servicio, repo, almacen, contrataciones }) {
  /** Requisitos del cierre, con su detalle (no escribe). */
  async function evaluar(proyecto_id, forzar = false) {
    const d = await servicio.datos(forzar);
    const p = d.proyectos.find((x) => x.proyecto_id === Number(proyecto_id) && vivo(x));
    if (!p) throw error(404, 'Proyecto no encontrado');
    const consultores = d.consultores.filter((c) => c.proyecto_id === p.proyecto_id && vivo(c));
    const ids = new Set(consultores.map((c) => c.consultor_id));
    const contratos = d.contratos.filter((k) => ids.has(k.consultor_id) && vivo(k));
    const abiertas = contratos.filter((k) => ['REGISTRADA', 'EN_EJECUCION'].includes(k.estado_contratacion) && k.tipo_documento === 'ORDEN_SERVICIO');
    const kids = new Set(contratos.map((k) => k.contrato_id));
    const sinConformidad = (d.entregables_servicio || []).filter((e) => kids.has(e.contrato_id) && vivo(e) && !['CONFORME', 'ANULADO'].includes(e.estado));
    const activos = consultores.filter((c) => c.estado === 'ACTIVO');
    const os = configDe(p).entregables;
    const requisitos = [
      { codigo: 'ESTADO', texto: 'El proyecto no está cerrado ni anulado', cumple: !['CERRADO', 'ANULADO'].includes(p.estado), detalle: `Estado actual: ${p.estado}` },
      ...(os ? [
        { codigo: 'OS_ABIERTAS', texto: 'Ninguna Orden de Servicio abierta (registrada o en ejecución)', cumple: !abiertas.length, detalle: abiertas.length ? `Abiertas: ${abiertas.map((k) => `${k.numero} (${k.estado_contratacion === 'REGISTRADA' ? 'sin notificar' : 'en ejecución'})`).join(', ')}. Culmínelas con la conformidad de sus entregables, resuélvalas o anúlelas.` : 'Todas culminadas, resueltas o anuladas' },
        { codigo: 'ENTREGABLES', texto: 'Todos los entregables con conformidad (o anulados por resolución)', cumple: !sinConformidad.length, detalle: sinConformidad.length ? `${sinConformidad.length} entregable(s) sin conformidad` : 'Completos' },
      ] : []),
      { codigo: 'PROFESIONALES', texto: 'Ningún profesional ACTIVO', cumple: !activos.length, detalle: activos.length ? `Activos: ${activos.map((c) => c.nombres).join(', ')} (cámbielos a CULMINADO o NO_RENOVADO)` : `${consultores.length} profesional(es), ninguno activo` },
    ];
    return {
      proyecto: { proyecto_id: p.proyecto_id, codigo: p.codigo, nombre: p.nombre, estado: p.estado, revision: p.revision, fecha_cierre: p.fecha_cierre || null, lecciones_aprendidas: p.lecciones_aprendidas || null },
      requisitos, puede_cerrar: requisitos.every((r) => r.cumple),
      informe: (() => { const f = almacen.vigente('INFORME_CIERRE', 'proyecto', p.proyecto_id); return f ? { documento_id: f.documento_id, nombre: f.nombre_original, subido_en: f.subido_en } : null; })(),
    };
  }

  /** entrada: { informe (token PDF), lecciones_aprendidas, fecha_cierre? (hoy por defecto), revision } */
  async function cerrar(proyecto_id, entrada, ctx) {
    const e = entrada || {};
    const ev = await evaluar(proyecto_id, true);
    const faltan = ev.requisitos.filter((r) => !r.cumple);
    if (faltan.length) throw error(409, `No se puede cerrar el proyecto: ${faltan.map((r) => `${r.texto} — ${r.detalle}`).join('; ')}`, { requisitos: ev.requisitos });
    if (e.revision === undefined || e.revision === null || Number(e.revision) !== Number(ev.proyecto.revision)) throw error(409, 'Otro usuario modificó el proyecto. Recargue y vuelva a intentar.');
    const lecciones = String(e.lecciones_aprendidas || '').trim();
    if (lecciones.length < 30 || lecciones.length > 2000) throw error(400, 'Registre las lecciones aprendidas (de 30 a 2000 caracteres)');
    const fecha = e.fecha_cierre || hoyLima();
    if (!esFecha(fecha) || fecha > hoyLima()) throw error(400, 'La fecha de cierre debe tener formato AAAA-MM-DD y no ser posterior a hoy');
    const pdf = contrataciones.tomarTemporal(e.informe, ctx, 'el informe de cierre');
    const p = ev.proyecto;
    const motivo = `Cierre del proyecto ${p.codigo} el ${ff(fecha)}`;
    const doc = await almacen.guardar({ tipo: 'INFORME_CIERRE', entidad: 'proyecto', entidad_id: p.proyecto_id, proyecto_id: p.proyecto_id, buffer: pdf.buffer, nombre: pdf.nombre }, { usuario: ctx.usuario, origen: ctx.origen || 'UI', motivo: `Informe de cierre del proyecto ${p.codigo}` });
    let r;
    try {
      r = await repo.actualizar('proyecto', p.proyecto_id, { estado: 'CERRADO', fecha_cierre: fecha, lecciones_aprendidas: lecciones }, { revision: e.revision, usuario: ctx.usuario, origen: ctx.origen || 'UI', motivo, operacion: 'CIERRE' });
    } catch (err) {
      // solo si el cierre NO quedó registrado se retira el informe
      try { await almacen.retirar(doc.documento_id, { usuario: ctx.usuario, motivo: 'Cierre no registrado: se retira el informe' }); } catch { /* queda registrado */ }
      throw err;
    }
    contrataciones.liberarTemporal(e.informe);
    await servicio.recalcularYGuardar(ctx.usuario, motivo);
    return { ...r, informe: { documento_id: doc.documento_id } };
  }

  return { evaluar, cerrar };
}

module.exports = { crearCierre };
