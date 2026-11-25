'use strict';
/**
 * Supervisión diaria y conformidad de entregables (Etapa 3 de PLAN_DE_MEJORAS.md; db/18).
 *
 * Parte diario (P4, R-PD1): el equipo del proyecto registra qué hizo el profesional, incidencias, riesgos, el avance de
 * las actividades del plan APROBADO y sus evidencias. Es de solo inserción: se corrige con otro parte que lo rectifica.
 * El parte, sus ítems y el avance de las actividades van en UNA transacción con su bitácora (C4); las evidencias, al
 * almacén documental (tipo EVIDENCIA). Todas las lecturas se hacen ANTES de abrir la transacción (en SQL Server una
 * lectura completa dentro de ella esperaría a sus propios bloqueos).
 *
 * Entregables (P5, R-OS7): PENDIENTE → PRESENTADO → OBSERVADO → SUBSANADO → CONFORME. La presentación exige el documento
 * del entregable. Conforme el último entregable, la OS pasa a CULMINADA (y el profesional a CULMINADO si no tiene otra
 * OS abierta); cuando todas las OS del proyecto culminan, el proyecto pasa a CONCLUIDO (R-PY2; origen SISTEMA).
 */
const { aDia, aFecha, hoyLima, crearCalendario } = require('./motor/calendario');
const { esFecha } = require('./motor/plazos');
const { parametro } = require('./motor/estado');
const { filtrarColumnas } = require('./datos/entidades');

const error = (estado, mensaje, extra = {}) => Object.assign(new Error(mensaje), { estado, ...extra });
const vivo = (x) => x && x.activo !== 0 && x.activo !== false;
const ff = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const ESTADOS_REPORTABLES = ['PENDIENTE', 'EN_CURSO', 'CONCLUIDA', 'SUSPENDIDA'];
const SIN_SEGUIMIENTO = ['EN_FORMULACION', 'EN_REVISION_JEFE', 'EN_REVISION_ADMIN', 'OBSERVADO', 'POR_REGISTRAR'];
const MAX_EVIDENCIAS = 10;

function exigirRevision(enviada, actual, que) {
  if (enviada === undefined || enviada === null || enviada === '') throw error(409, `Falta la revisión ${que}. Recargue y vuelva a intentar.`);
  if (Number(enviada) !== Number(actual)) throw error(409, `Otro usuario modificó ${que}. Recargue y vuelva a intentar.`);
}

function crearSupervision({ servicio, repo, almacen, contrataciones }) {
  const ultimoContrato = (d, consultorId) => d.contratos.filter((k) => k.consultor_id === consultorId && vivo(k) && k.estado_contratacion !== 'ANULADA').sort((a, b) => a.contrato_id - b.contrato_id).pop() || null;

  // ================================================================ partes diarios
  /**
   * entrada: { consultor_id, fecha, descripcion, incidencias?, riesgos?, justificacion?, rectifica_parte_id?,
   *            items: [{ actividad_id, subactividad_indice?, avance, estado?, comentario? }], evidencias: [token] }
   */
  async function registrarParte(proyecto_id, entrada, ctx) {
    const e = entrada || {};
    const d = await servicio.datos(true);
    const proy = d.proyectos.find((p) => p.proyecto_id === Number(proyecto_id) && vivo(p));
    if (!proy) throw error(404, 'Proyecto no encontrado');
    if (proy.estado !== 'EN_EJECUCION') throw error(409, 'Solo se registran partes diarios de proyectos en ejecución');
    const c = d.consultores.find((x) => x.consultor_id === Number(e.consultor_id) && vivo(x));
    if (!c || c.proyecto_id !== proy.proyecto_id) throw error(400, 'Elija un profesional del proyecto');
    const k = ultimoContrato(d, c.consultor_id);
    if (k && k.estado_contratacion === 'REGISTRADA' && !d.contratos.some((x) => x.consultor_id === c.consultor_id && x.estado_contratacion === 'EN_EJECUCION')) throw error(409, 'La Orden de Servicio del profesional aún no se notifica: el servicio no ha empezado');
    const hoy = hoyLima();
    if (!esFecha(e.fecha)) throw error(400, 'Indique la fecha del parte (AAAA-MM-DD)');
    if (e.fecha > hoy) throw error(400, 'La fecha del parte no puede ser posterior a hoy');
    const vigente = d.contratos.filter((x) => x.consultor_id === c.consultor_id && x.estado_contratacion === 'EN_EJECUCION' && x.fecha_inicio).sort((a, b) => b.contrato_id - a.contrato_id)[0];
    if (vigente && e.fecha < vigente.fecha_inicio && !d.contratos.some((x) => x.consultor_id === c.consultor_id && x.fecha_inicio && x.fecha_inicio <= e.fecha)) throw error(400, `La fecha es anterior al inicio del servicio (${ff(vigente.fecha_inicio)})`);
    const atras = Number(parametro(d, 'PARTE_DIAS_ATRAS', 3));
    const cal = crearCalendario({ tipo: 'HABILES', feriados: (d.feriados || []).map((f) => f.fecha) });
    const habiles = Math.max(0, cal.duracion(aDia(e.fecha), aDia(hoy)) - 1);
    const justificacion = String(e.justificacion || '').trim();
    if (habiles > atras && justificacion.length < 10) throw error(400, `El parte es de hace ${habiles} días hábiles (más de ${atras}): justifique el registro tardío (mínimo 10 caracteres)`, { requiereJustificacion: true });
    const descripcion = String(e.descripcion || '').trim();
    if (descripcion.length < 10 || descripcion.length > 2000) throw error(400, 'Describa lo realizado (de 10 a 2000 caracteres)');
    for (const [kk, n] of [['incidencias', 'Las incidencias'], ['riesgos', 'Los riesgos']]) if (e[kk] && String(e[kk]).length > 1000) throw error(400, `${n} admiten hasta 1000 caracteres`);
    let rectifica = null;
    if (e.rectifica_parte_id) {
      [rectifica] = await repo.listarPartes({ consultor_id: c.consultor_id, limite: 1000 }).then((l) => l.filter((x) => x.parte_id === Number(e.rectifica_parte_id)));
      if (!rectifica) throw error(400, 'El parte que se rectifica no es de este profesional');
    }

    // Avance de actividades: solo del plan aprobado (el motor ignora los demás)
    const items = Array.isArray(e.items) ? e.items : [];
    const plan = d.planes.filter((p) => p.consultor_id === c.consultor_id && vivo(p)).sort((a, b) => b.plan_id - a.plan_id)[0] || null;
    if (items.length && (!plan || SIN_SEGUIMIENTO.includes(plan.estado))) throw error(409, 'El plan de trabajo del profesional aún no está aprobado: registre el parte solo con la descripción');
    const vistos = new Set(); const porActividad = new Map(); const filas = [];
    for (const it of items) {
      const a = d.actividades.find((x) => x.actividad_id === Number(it.actividad_id) && vivo(x));
      if (!a || a.plan_id !== plan.plan_id) throw error(400, 'Una de las actividades no pertenece al plan aprobado del profesional');
      if (a.es_resumen || a.estado === 'ANULADA') throw error(400, `La actividad ${a.numero} no admite avance directo`);
      const subs = servicio.subsDe(a);
      const idx = it.subactividad_indice === undefined || it.subactividad_indice === null || it.subactividad_indice === '' ? null : Number(it.subactividad_indice);
      if (subs.length && idx === null) throw error(400, `La actividad ${a.numero} tiene subactividades: el avance se reporta por subactividad`);
      if (idx !== null && !(Number.isInteger(idx) && idx >= 0 && idx < subs.length)) throw error(400, `Subactividad no válida en la actividad ${a.numero}`);
      const clave = `${a.actividad_id}|${idx}`;
      if (vistos.has(clave)) throw error(400, `La actividad ${a.numero}${idx !== null ? `.${idx + 1}` : ''} está repetida en el parte`);
      vistos.add(clave);
      const avance = Number(it.avance);
      if (it.avance === '' || it.avance === null || it.avance === undefined || !Number.isFinite(avance) || avance < 0 || avance > 100) throw error(400, `Indique el avance de la actividad ${a.numero} (0 a 100)`);
      const actual = idx !== null ? Number(subs[idx].a) || 0 : Number(a.avance) || 0;
      const comentario = String(it.comentario || '').trim().slice(0, 500);
      if (avance < actual && comentario.length < 5) throw error(400, `El avance de la actividad ${a.numero}${idx !== null ? `.${idx + 1}` : ''} baja de ${actual} % a ${avance} %: explique el motivo en el comentario`);
      if (it.estado && !ESTADOS_REPORTABLES.includes(it.estado)) throw error(400, `Estado no válido para la actividad ${a.numero}`);
      if (!porActividad.has(a.actividad_id)) porActividad.set(a.actividad_id, { previa: a, subs: subs.map((s) => ({ ...s })), cambios: {} });
      const g = porActividad.get(a.actividad_id);
      if (idx !== null) g.subs[idx].a = Math.round(avance * 100) / 100;
      else g.cambios.avance = avance;
      if (it.estado) g.cambios.estado = it.estado;
      filas.push({ actividad_id: a.actividad_id, subactividad_indice: idx, avance_anterior: actual, avance_reportado: Math.round(avance * 100) / 100, estado_reportado: it.estado || null, comentario: comentario || null });
    }
    // reglas de consistencia de la actividad (avance → estado y fechas reales), calculadas antes de escribir
    const cambiosPorActividad = [];
    for (const g of porActividad.values()) {
      const cambios = { ...g.cambios };
      if (g.subs.length) { cambios.subactividades = JSON.stringify(g.subs); cambios.avance = servicio.avanceDeSubs(g.subs); }
      const { cambios: finales } = servicio.consolidarActividad(g.previa, filtrarColumnas('actividad', cambios), hoy, null);
      delete finales.plan_id;
      cambiosPorActividad.push({ a: g.previa, cambios: finales });
    }
    const evidencias = (Array.isArray(e.evidencias) ? e.evidencias : []).slice(0, MAX_EVIDENCIAS + 1);
    if (evidencias.length > MAX_EVIDENCIAS) throw error(400, `Cada parte admite hasta ${MAX_EVIDENCIAS} evidencias`);
    const archivos = evidencias.map((t) => contrataciones.tomarTemporal(t, ctx, 'la evidencia', { soloPdf: false }));

    const motivoBase = `Parte diario del ${ff(e.fecha)} de ${c.clave}${rectifica ? ` (rectifica el del ${ff(rectifica.fecha)})` : ''}`;
    const base = { usuario: ctx.usuario, origen: ctx.origen || 'UI', consultor_id: c.consultor_id };
    const parte = await repo.transaccion(async (t) => {
      const p = await t.crear('parte_diario', filtrarColumnas('parte_diario', {
        proyecto_id: proy.proyecto_id, consultor_id: c.consultor_id, contrato_id: (vigente || k || {}).contrato_id || null, fecha: e.fecha, descripcion,
        incidencias: e.incidencias ? String(e.incidencias).trim() : null, riesgos: e.riesgos ? String(e.riesgos).trim() : null, justificacion: justificacion || null, rectifica_parte_id: rectifica ? rectifica.parte_id : null,
      }), { ...base, motivo: motivoBase });
      for (const { a, cambios } of cambiosPorActividad) {
        await t.actualizar('actividad', a.actividad_id, cambios, { ...base, revision: a.revision, motivo: `${motivoBase} (parte N.° ${p.parte_id}): avance de la actividad ${a.numero}` });
      }
      const its = [];
      for (const f of filas) its.push(await t.crear('parte_diario_item', filtrarColumnas('parte_diario_item', { ...f, parte_id: p.parte_id }), { ...base, motivo: `Ítem del parte N.° ${p.parte_id}` }));
      return { ...p, items: its };
    });
    const guardadas = []; const pendientes = [];
    for (const [i, f] of archivos.entries()) {
      try {
        const g = await almacen.guardar({ tipo: 'EVIDENCIA', entidad: 'parte_diario', entidad_id: parte.parte_id, consultor_id: c.consultor_id, proyecto_id: proy.proyecto_id, buffer: f.buffer, nombre: f.nombre, permitidos: contrataciones.FORMATOS_EVIDENCIA, reemplazar: false }, { ...base, motivo: `Evidencia del parte N.° ${parte.parte_id}` });
        guardadas.push({ documento_id: g.documento_id, nombre: g.nombre_original });
      } catch (err) { pendientes.push(`${f.nombre}: ${err.message}`); }
      contrataciones.liberarTemporal(evidencias[i]);
    }
    if (cambiosPorActividad.length) await servicio.recalcularYGuardar(ctx.usuario, motivoBase); else servicio.invalidar();
    return { ...parte, evidencias: guardadas, evidencias_pendientes: pendientes };
  }

  /** Partes del proyecto (o de un profesional), con sus ítems, evidencias y quién los rectificó. */
  async function listarPartes(proyecto_id, { consultor_id, desde, hasta, limite } = {}) {
    const d = await servicio.datos();
    const partes = await repo.listarPartes({ proyecto_id, consultor_id, desde, hasta, limite });
    const act = new Map(d.actividades.map((a) => [a.actividad_id, a]));
    const cons = new Map(d.consultores.map((c) => [c.consultor_id, c]));
    return partes.map((p) => ({
      ...p, clave: (cons.get(p.consultor_id) || {}).clave, nombres: (cons.get(p.consultor_id) || {}).nombres,
      rectificado_por: partes.filter((x) => x.rectifica_parte_id === p.parte_id).map((x) => x.parte_id),
      items: p.items.map((i) => { const a = act.get(i.actividad_id) || {}; const s = i.subactividad_indice !== null && i.subactividad_indice !== undefined ? (servicio.subsDe(a)[i.subactividad_indice] || {}) : null; return { ...i, numero: a.numero ? `${a.numero}${s ? `.${i.subactividad_indice + 1}` : ''}` : '?', descripcion: s ? s.t : a.descripcion }; }),
      evidencias: almacen.deEntidad('parte_diario', p.parte_id).map((x) => ({ documento_id: x.documento_id, nombre: x.nombre_original, tipo_mime: x.tipo_mime, bytes: x.bytes })),
    }));
  }

  // ================================================================ entregables
  async function contextoEntregable(id) {
    const d = await servicio.datos(true);
    const e = (d.entregables_servicio || []).find((x) => x.entregable_servicio_id === Number(id) && vivo(x));
    if (!e) throw error(404, 'Entregable no encontrado');
    const k = d.contratos.find((x) => x.contrato_id === e.contrato_id);
    const c = k && d.consultores.find((x) => x.consultor_id === k.consultor_id);
    const proy = c && d.proyectos.find((p) => p.proyecto_id === c.proyecto_id);
    if (!k || k.estado_contratacion !== 'EN_EJECUCION') throw error(409, 'La Orden de Servicio no está en ejecución (se notifica antes de recibir entregables)');
    return { d, e, k, c, proy };
  }
  const nombreE = (e) => `Entregable ${e.numero} (${String(e.nombre).slice(0, 60)})`;
  function fechaValida(f, { desde, rotulo }) {
    if (!esFecha(f)) throw error(400, `Indique la fecha de ${rotulo} (AAAA-MM-DD)`);
    if (f > hoyLima()) throw error(400, `La fecha de ${rotulo} no puede ser posterior a hoy`);
    if (desde && f < desde) throw error(400, `La fecha de ${rotulo} no puede ser anterior al ${ff(desde)}`);
  }

  /** Guarda un documento del entregable desde un archivo temporal; si la escritura posterior falla, se retira. */
  async function conDocumento(token, { tipo, e, c, rotulo, obligatorio, soloPdf }, ctx, escribir) {
    let doc = null;
    if (token) {
      const f = contrataciones.tomarTemporal(token, ctx, rotulo, { soloPdf });
      doc = await almacen.guardar({ tipo, entidad: 'entregable_servicio', entidad_id: e.entregable_servicio_id, consultor_id: c.consultor_id, buffer: f.buffer, nombre: f.nombre, permitidos: soloPdf ? ['pdf'] : contrataciones.FORMATOS_EVIDENCIA, reemplazar: false }, { usuario: ctx.usuario, origen: ctx.origen || 'UI', motivo: `${rotulo[0].toUpperCase()}${rotulo.slice(1)}: ${nombreE(e)}` });
      contrataciones.liberarTemporal(token);
    } else if (obligatorio) throw error(400, `Adjunte ${rotulo}`);
    try { return await escribir(doc); } catch (err) {
      if (doc) { try { await almacen.retirar(doc.documento_id, { usuario: ctx.usuario, motivo: 'Operación no registrada: se retira su documento' }); } catch { /* queda registrado */ } }
      throw err;
    }
  }

  /** entrada: { fecha, documento (token: PDF, Word, Excel o imagen), observacion?, revision } — presentación o subsanación. */
  async function presentar(id, entrada, ctx) {
    const x = entrada || {};
    const { e, k, c } = await contextoEntregable(id);
    if (!['PENDIENTE', 'OBSERVADO'].includes(e.estado)) throw error(409, `${nombreE(e)} está ${e.estado.toLowerCase()}: no se puede presentar`);
    const subsana = e.estado === 'OBSERVADO';
    fechaValida(x.fecha, { desde: subsana ? e.fecha_observacion : k.fecha_inicio, rotulo: subsana ? 'subsanación' : 'presentación' });
    exigirRevision(x.revision, e.revision, 'el entregable');
    const obs = x.observacion ? String(x.observacion).trim().slice(0, 1000) : undefined;
    const r = await conDocumento(x.documento, { tipo: 'ENTREGABLE', e, c, rotulo: subsana ? 'el documento de la subsanación' : 'el documento del entregable', obligatorio: true, soloPdf: false }, ctx, () =>
      repo.actualizar('entregable_servicio', e.entregable_servicio_id, subsana ? { estado: 'SUBSANADO', fecha_subsanacion: x.fecha, ...(obs ? { observacion: obs } : {}) } : { estado: 'PRESENTADO', fecha_presentacion: x.fecha, ...(obs ? { observacion: obs } : {}) },
        { revision: x.revision, usuario: ctx.usuario, origen: ctx.origen || 'UI', consultor_id: c.consultor_id, motivo: `${subsana ? 'Subsanación' : 'Presentación'} del ${nombreE(e)} el ${ff(x.fecha)}${!subsana && e.fecha_limite && x.fecha > e.fecha_limite ? ` (${aDia(x.fecha) - aDia(e.fecha_limite)} día(s) después de la fecha límite)` : ''}` }));
    await servicio.recalcularYGuardar(ctx.usuario, `${subsana ? 'Subsanación' : 'Presentación'} del ${nombreE(e)}`);
    return r;
  }

  /** entrada: { fecha, observacion, plazo_subsanacion_dias?, documento? (PDF), revision } */
  async function observar(id, entrada, ctx) {
    const x = entrada || {};
    const { d, e, c } = await contextoEntregable(id);
    if (!['PRESENTADO', 'SUBSANADO', 'EN_REVISION'].includes(e.estado)) throw error(409, `${nombreE(e)} no está presentado: no se puede observar`);
    fechaValida(x.fecha, { desde: e.fecha_subsanacion || e.fecha_presentacion, rotulo: 'observación' });
    const texto = String(x.observacion || '').trim();
    if (texto.length < 10 || texto.length > 1000) throw error(400, 'Detalle la observación (de 10 a 1000 caracteres)');
    const plazo = x.plazo_subsanacion_dias === undefined || x.plazo_subsanacion_dias === '' || x.plazo_subsanacion_dias === null ? Number(parametro(d, 'PLAZO_SUBSANACION_DIAS', 5)) : Number(x.plazo_subsanacion_dias);
    if (!Number.isInteger(plazo) || plazo < 1 || plazo > 60) throw error(400, 'El plazo de subsanación es un número entero de 1 a 60 días');
    exigirRevision(x.revision, e.revision, 'el entregable');
    const limite = aFecha(aDia(x.fecha) + plazo);
    const r = await conDocumento(x.documento, { tipo: 'OBSERVACION', e, c, rotulo: 'el documento de la observación', obligatorio: false, soloPdf: true }, ctx, () =>
      repo.actualizar('entregable_servicio', e.entregable_servicio_id, { estado: 'OBSERVADO', fecha_observacion: x.fecha, plazo_subsanacion_dias: plazo, fecha_limite_subsanacion: limite, observacion: texto },
        { revision: x.revision, usuario: ctx.usuario, origen: ctx.origen || 'UI', consultor_id: c.consultor_id, motivo: `Observación del ${nombreE(e)}: subsanar hasta el ${ff(limite)}` }));
    await servicio.recalcularYGuardar(ctx.usuario, `Observación del ${nombreE(e)}`);
    return { ...r, fecha_limite_subsanacion: limite };
  }

  /** entrada: { fecha, conformidad_ref (documento de conformidad), documento? (PDF), revision } */
  async function conformidad(id, entrada, ctx) {
    const x = entrada || {};
    const { d, e, k, c, proy } = await contextoEntregable(id);
    if (!['PRESENTADO', 'SUBSANADO', 'EN_REVISION'].includes(e.estado)) throw error(409, `${nombreE(e)} no está presentado: no se puede dar la conformidad`);
    fechaValida(x.fecha, { desde: e.fecha_subsanacion || e.fecha_presentacion, rotulo: 'conformidad' });
    const ref = String(x.conformidad_ref || '').trim();
    if (ref.length < 5 || ref.length > 300) throw error(400, 'Indique el documento de conformidad (de 5 a 300 caracteres; p. ej. «Informe N.° 012-2026-OTI»)');
    exigirRevision(x.revision, e.revision, 'el entregable');
    // ¿Con esta conformidad culmina la OS? ¿Y el proyecto? (se decide con los datos leídos antes de escribir)
    const otros = (d.entregables_servicio || []).filter((y) => y.contrato_id === k.contrato_id && vivo(y) && y.entregable_servicio_id !== e.entregable_servicio_id);
    const culmina = otros.every((y) => ['CONFORME', 'ANULADO'].includes(y.estado));
    const otraAbierta = d.contratos.some((y) => y.consultor_id === c.consultor_id && y.contrato_id !== k.contrato_id && vivo(y) && ['REGISTRADA', 'EN_EJECUCION'].includes(y.estado_contratacion));
    const abiertasProyecto = d.contratos.filter((y) => vivo(y) && y.contrato_id !== k.contrato_id && ['REGISTRADA', 'EN_EJECUCION'].includes(y.estado_contratacion)
      && d.consultores.some((z) => z.consultor_id === y.consultor_id && z.proyecto_id === proy.proyecto_id));
    const concluye = culmina && proy.estado === 'EN_EJECUCION' && !abiertasProyecto.length;
    const base = { usuario: ctx.usuario, origen: ctx.origen || 'UI', consultor_id: c.consultor_id };
    const r = await conDocumento(x.documento, { tipo: 'CONFORMIDAD', e, c, rotulo: 'el documento de conformidad', obligatorio: false, soloPdf: true }, ctx, () => repo.transaccion(async (t) => {
      const fila = await t.actualizar('entregable_servicio', e.entregable_servicio_id, { estado: 'CONFORME', fecha_conformidad: x.fecha, conformidad_ref: ref }, { ...base, revision: x.revision, motivo: `Conformidad del ${nombreE(e)}: ${ref}` });
      if (culmina) {
        await t.actualizar('contrato', k.contrato_id, { estado_contratacion: 'CULMINADA', fecha_culminacion: x.fecha }, { ...base, motivo: `Orden de Servicio N.° ${k.numero} culminada: todos sus entregables tienen conformidad` });
        if (!otraAbierta && c.estado === 'ACTIVO') await t.actualizar('consultor', c.consultor_id, { estado: 'CULMINADO' }, { ...base, motivo: `Servicio culminado (Orden de Servicio N.° ${k.numero})` });
      }
      if (concluye) await t.actualizar('proyecto', proy.proyecto_id, { estado: 'CONCLUIDO' }, { ...base, consultor_id: null, origen: 'SISTEMA', motivo: 'Proyecto concluido: todas sus Órdenes de Servicio culminaron' });
      return fila;
    }));
    await servicio.recalcularYGuardar(ctx.usuario, `Conformidad del ${nombreE(e)}`);
    return { ...r, os_culminada: culmina, proyecto_concluido: concluye };
  }

  return { registrarParte, listarPartes, presentar, observar, conformidad };
}

module.exports = { crearSupervision };
