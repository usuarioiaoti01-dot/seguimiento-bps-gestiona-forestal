'use strict';
/**
 * Formulación del plan de trabajo (plantilla «Cronograma de actividades»).
 *
 *   POR_REGISTRAR / EN_FORMULACION  el profesional formula (cabecera y actividades se graban al registrarlas)
 *   → EN_REVISION_JEFE              el plan queda fijo para el profesional; el Jefe de Proyecto puede modificarlo y aprobarlo
 *   → EN_REVISION_ADMIN             el Administrador lo aprueba o lo observa con comentarios (OBSERVADO vuelve al Jefe de Proyecto)
 *   → APROBADO                      el plan queda fijo y arranca el seguimiento (fechas y actividades)
 *
 * El periodo del plan es el de la adenda vigente y no se puede modificar. Las escrituras pasan por el repositorio
 * (bitácora en la misma transacción) y cada una recalcula el estado.
 */
const { aDia, aFecha, hoyLima, crearCalendario } = require('./motor/calendario');
const { generarPdfPlan } = require('./plan-trabajo-pdf');

const error = (estado, mensaje) => Object.assign(new Error(mensaje), { estado });
const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const vivo = (x) => x.activo !== 0 && x.activo !== false;
const PROYECTO = 'Gestiona Forestal 2026 – Proyecto Bosques PI 2 (UE 003 – CUI 2455355)';
const AREA_TECNICA = 'Oficina de Tecnologías de la Información (OTI)';
const EN_FORMULACION = ['POR_REGISTRAR', 'EN_FORMULACION'];
const EN_REVISION_JEFE = ['EN_REVISION_JEFE', 'OBSERVADO'];
const MAX = { area_usuaria: 300, referencia_lb: 300, supuestos: 2000, descripcion: 1000, producto: 1000 };
const MAX_SUB = { cantidad: 20, largo: 300, producto: 500, total: 20000 };

function crearFormulacion({ servicio, repo, docs = null, planesPdf = null }) {
  const jefeOAdmin = (ctx) => ctx.rol === 'JEFE_PROYECTO' || ctx.rol === 'ADMIN';

  async function contexto(consultor_id, ctx) {
    if (ctx.rol === 'PROFESIONAL' && Number(ctx.consultor_id) !== Number(consultor_id)) throw error(403, 'Solo puede formular su propio plan de trabajo');
    const d = await servicio.datos(true);
    const consultor = d.consultores.find((c) => c.consultor_id === Number(consultor_id) && vivo(c));
    if (!consultor) throw error(404, 'Profesional no encontrado');
    const contrato = d.contratos.find((k) => k.consultor_id === consultor.consultor_id && vivo(k)) || null;
    const plan = d.planes.filter((p) => p.consultor_id === consultor.consultor_id && vivo(p)).sort((x, y) => y.plan_id - x.plan_id)[0] || null;
    const e = await servicio.estado();
    const it = e.consultores.find((x) => x.consultor.consultor_id === consultor.consultor_id);
    const adendaPlan = plan && plan.adenda_id && !EN_FORMULACION.includes(plan.estado) ? d.adendas.find((a) => a.adenda_id === plan.adenda_id) : null;
    const adenda = adendaPlan || (it && it.vigencia.adenda_vigente) || null;
    return { d, consultor, contrato, plan, adenda, corte: e.corte };
  }

  function permisos(plan, ctx, consultor_id) {
    const estado = plan ? plan.estado : 'POR_REGISTRAR';
    const dueno = ctx.rol === 'PROFESIONAL' && Number(ctx.consultor_id) === Number(consultor_id);
    const puedeEditar = (EN_FORMULACION.includes(estado) && (dueno || jefeOAdmin(ctx))) || (EN_REVISION_JEFE.includes(estado) && jefeOAdmin(ctx));
    return {
      estado,
      puedeEditar,
      puedeEnviar: puedeEditar && EN_FORMULACION.includes(estado),
      puedeAprobarJefe: jefeOAdmin(ctx) && EN_REVISION_JEFE.includes(estado),
      puedeRevisarAdmin: ctx.rol === 'ADMIN' && estado === 'EN_REVISION_ADMIN',
    };
  }

  const periodo = (adenda, d) => {
    if (!adenda) return null;
    const cal = crearCalendario({ tipo: 'HABILES', feriados: d.feriados });
    const ini = aDia(adenda.fecha_inicio); const fin = aDia(adenda.fecha_fin);
    return { adenda_id: adenda.adenda_id, numero: adenda.numero, inicio: adenda.fecha_inicio, fin: adenda.fecha_fin, dias_habiles: cal.duracion(ini, fin), dias_calendario: fin - ini + 1 };
  };

  // Subactividades: JSON [{ t: texto, d: días, p: producto / evidencia }]
  const subsDe = (a) => { try { const x = JSON.parse((a && a.subactividades) || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } };
  /** Cada subactividad, una tras otra dentro de la actividad (días hábiles). */
  const fechasSubs = (a, cal) => {
    let cursor = aDia(a.inicio_plan);
    return subsDe(a).map((s) => {
      const ini = cal.siguienteLaborable(cursor); const fin = cal.finDesde(ini, s.d || 1); cursor = fin + 1;
      return { texto: s.t, dias: s.d, producto: s.p || '', inicio_plan: aFecha(ini), fin_plan: aFecha(fin) };
    });
  };
  const filaActividad = (a, cal) => ({ ...a, subactividades: fechasSubs(a, cal), dias_habiles: a.dias_plan ?? cal.duracion(aDia(a.inicio_plan), aDia(a.fin_plan)), documentos: docs ? docs.listar(a.actividad_id) : [] });
  const activasDe = (d, plan) => d.actividades.filter((a) => a.plan_id === plan.plan_id && vivo(a) && a.estado !== 'ANULADA').sort((x, y) => (x.orden || 0) - (y.orden || 0));

  /** Formulario completo: datos de la plantilla, periodo de la adenda vigente, actividades, permisos e historial. */
  async function detalle(consultor_id, ctx) {
    const { d, consultor, contrato, plan, adenda } = await contexto(consultor_id, ctx);
    const cal = crearCalendario({ tipo: 'HABILES', feriados: d.feriados });
    const actividades = plan ? activasDe(d, plan).map((a) => filaActividad(a, cal)) : [];
    const per = periodo(adenda, d);
    let historial = [];
    if (plan) {
      const bit = await repo.listarBitacora({ entidad: 'plan_trabajo', entidad_id: plan.plan_id, limite: 100 });
      historial = bit.map((b) => {
        let c = b.cambios_json; try { if (typeof c === 'string') c = JSON.parse(c); } catch { c = null; }
        const despues = c && c.despues; const antes = c && c.antes;
        if (!despues || !despues.estado) return null;
        return { fecha: b.fecha, usuario: b.usuario, de: antes && antes.estado, a: despues.estado, comentario: b.motivo };
      }).filter(Boolean);
    }
    return {
      consultor: { consultor_id: consultor.consultor_id, clave: consultor.clave, nombres: consultor.nombres, perfil: consultor.perfil },
      contrato: contrato && { numero: contrato.numero, expediente: contrato.expediente },
      proyecto: PROYECTO, area_tecnica: AREA_TECNICA,
      periodo: per,
      resumen: { total_dias: actividades.reduce((s, a) => s + (Number(a.dias_habiles) || 0), 0), dias_periodo: per ? per.dias_habiles : null },
      aprobacion: plan && plan.fecha_aprobacion ? { fecha: plan.fecha_aprobacion, suscripcion: (adenda && adenda.fecha_suscripcion) || null, dias: adenda && adenda.fecha_suscripcion ? aDia(plan.fecha_aprobacion) - aDia(adenda.fecha_suscripcion) : null } : null,
      plan: plan && {
        plan_id: plan.plan_id, estado: plan.estado, revision: plan.revision, area_usuaria: plan.area_usuaria || '', referencia_lb: plan.referencia_lb || '', supuestos: plan.supuestos || '',
        fecha_envio: plan.fecha_envio || null, fecha_aprobacion_jefe: plan.fecha_aprobacion_jefe || null, aprobado_jefe_por: plan.aprobado_jefe_por || null,
        fecha_aprobacion: plan.fecha_aprobacion || null, observacion_revision: plan.observacion_revision || null,
        tiene_pdf: !!(planesPdf && planesPdf.info(plan.plan_id).existe),
      },
      actividades, permisos: permisos(plan, ctx, consultor_id), historial,
    };
  }

  /** Crea el plan en formulación la primera vez que el profesional graba algo (periodo = adenda vigente). */
  async function asegurarPlan(c, ctx) {
    if (!c.adenda) throw error(409, 'El profesional no tiene una adenda vigente: el plazo del plan lo fija la adenda');
    const opts = { usuario: ctx.usuario, origen: ctx.origen || 'UI', consultor_id: c.consultor.consultor_id };
    if (!c.plan) {
      await repo.crear('plan_trabajo', { consultor_id: c.consultor.consultor_id, adenda_id: c.adenda.adenda_id, nombre: `Plan de trabajo · Adenda N.° ${String(c.adenda.numero).padStart(2, '0')}`, estado: 'EN_FORMULACION', tipo_dias: 'HABILES' }, { ...opts, motivo: 'Inicio de la formulación del plan de trabajo' });
    } else if (EN_FORMULACION.includes(c.plan.estado) && (c.plan.estado !== 'EN_FORMULACION' || c.plan.adenda_id !== c.adenda.adenda_id || c.plan.tipo_dias !== 'HABILES')) {
      await repo.actualizar('plan_trabajo', c.plan.plan_id, { estado: 'EN_FORMULACION', adenda_id: c.adenda.adenda_id, tipo_dias: 'HABILES' }, { ...opts, motivo: 'Inicio de la formulación del plan de trabajo' });
    }
    return contexto(c.consultor.consultor_id, ctx);
  }

  const exigirEdicion = (c, ctx) => {
    if (!permisos(c.plan, ctx, c.consultor.consultor_id).puedeEditar) throw error(409, 'El plan no se puede modificar en su etapa actual o con su perfil');
  };

  /** Datos generales editables de la plantilla (área usuaria, referencia de línea base, supuestos). */
  async function guardarCabecera(consultor_id, entrada, ctx) {
    let c = await contexto(consultor_id, ctx);
    if (c.plan) exigirEdicion(c, ctx); else if (ctx.rol !== 'PROFESIONAL' && !jefeOAdmin(ctx)) throw error(403, 'Sin permiso');
    const campos = {};
    for (const k of ['area_usuaria', 'referencia_lb', 'supuestos']) {
      if (entrada[k] === undefined) continue;
      const v = String(entrada[k] ?? '').trim();
      if (v.length > MAX[k]) throw error(400, `El campo admite hasta ${MAX[k]} caracteres (tiene ${v.length})`);
      campos[k] = v || null;
    }
    c = await asegurarPlan(c, ctx);
    exigirEdicion(c, ctx);
    if (Object.keys(campos).length) await repo.actualizar('plan_trabajo', c.plan.plan_id, campos, { usuario: ctx.usuario, motivo: ctx.motivo || 'Datos del plan de trabajo', origen: ctx.origen || 'UI', consultor_id: c.consultor.consultor_id });
    return { ok: true };
  }

  /** Normaliza la entrada: campos de la actividad y lista de subactividades [{ t, d }]. */
  function preparar(e) {
    const crudas = Array.isArray(e.subactividades) ? e.subactividades : subsDe(e);
    const subs = crudas.map((s) => ({ t: String(s.t ?? s.texto ?? '').trim(), d: Number(s.d ?? s.dias), p: String(s.p ?? s.producto ?? '').trim() })).filter((s) => s.t || s.p || (Number.isFinite(s.d) && s.d > 0));
    return {
      subs,
      f: { descripcion: String(e.descripcion ?? '').trim(), producto: subs.length ? subs.map((s) => s.p).filter(Boolean).join('; ') : String(e.producto ?? '').trim(), dias_plan: Number(e.dias_plan), subactividades: subs.length ? JSON.stringify(subs) : null },
    };
  }

  function validarActividad(f, subs, c, otrasDias) {
    if (!f.descripcion) throw error(400, 'Indique la actividad');
    if (!subs.length && !f.producto) throw error(400, 'Indique el producto / evidencia verificable');
    if (f.descripcion.length > MAX.descripcion) throw error(400, `La actividad admite hasta ${MAX.descripcion} caracteres`);
    if (!subs.length && f.producto.length > MAX.producto) throw error(400, `El producto admite hasta ${MAX.producto} caracteres`);
    if (!Number.isInteger(f.dias_plan) || f.dias_plan < 1 || f.dias_plan > 99) throw error(400, 'Indique los días hábiles de la actividad (número entero de 1 a 99)');
    if (subs.length > MAX_SUB.cantidad) throw error(400, `Cada actividad admite hasta ${MAX_SUB.cantidad} subactividades`);
    for (const s of subs) {
      if (!s.t) throw error(400, 'Escriba la descripción de cada subactividad');
      if (s.t.length > MAX_SUB.largo) throw error(400, `Cada subactividad admite hasta ${MAX_SUB.largo} caracteres`);
      if (!Number.isInteger(s.d) || s.d < 1 || s.d > 99) throw error(400, `Indique los días hábiles de la subactividad «${s.t}» (entre 1 y 99)`);
      if (!s.p) throw error(400, `Indique el producto / evidencia verificable de la subactividad «${s.t}»`);
      if (s.p.length > MAX_SUB.producto) throw error(400, `El producto de cada subactividad admite hasta ${MAX_SUB.producto} caracteres`);
    }
    const suma = subs.reduce((t, s) => t + s.d, 0);
    if (suma > f.dias_plan) throw error(400, `Las subactividades suman ${suma} días y no pueden exceder los ${f.dias_plan} días de la actividad`);
    if (f.subactividades && f.subactividades.length > MAX_SUB.total) throw error(400, 'Las subactividades superan el máximo permitido');
    const per = periodo(c.adenda, c.d);
    if (otrasDias + f.dias_plan > per.dias_habiles) throw error(400, `Las actividades sumarían ${otrasDias + f.dias_plan} días hábiles y la adenda vigente tiene ${per.dias_habiles}`);
  }

  /**
   * Fechas de las actividades según sus días: una tras otra, en días hábiles, desde `desde` (día numérico).
   * En formulación son referenciales (desde el inicio de la adenda); al aprobar el Administrador se recalculan
   * contando los plazos desde ese día.
   */
  async function recalcularFechas(plan_id, desde, ctx, motivo) {
    const d = await servicio.datos(true);
    const plan = d.planes.find((p) => p.plan_id === Number(plan_id));
    const cal = crearCalendario({ tipo: 'HABILES', feriados: d.feriados });
    let cursor = desde;
    for (const a of activasDe(d, plan)) {
      const ini = cal.siguienteLaborable(cursor);
      const fin = cal.finDesde(ini, a.dias_plan || 1);
      const f = { inicio_plan: aFecha(ini), fin_plan: aFecha(fin) };
      if (a.inicio_plan !== f.inicio_plan || a.fin_plan !== f.fin_plan) {
        await repo.actualizar('actividad', a.actividad_id, f, { usuario: ctx.usuario, motivo, origen: ctx.origen || 'UI', consultor_id: plan.consultor_id, accion: 'REPROGRAMAR' });
      }
      cursor = fin + 1;
    }
  }
  const motivoFechas = 'Fechas recalculadas según los días de cada actividad';

  /** Agrega una actividad (se graba al registrarla). */
  async function agregarActividad(consultor_id, entrada, ctx) {
    let c = await contexto(consultor_id, ctx);
    if (c.plan) exigirEdicion(c, ctx); else if (ctx.rol !== 'PROFESIONAL' && !jefeOAdmin(ctx)) throw error(403, 'Sin permiso');
    c = await asegurarPlan(c, ctx);
    exigirEdicion(c, ctx);
    const { f, subs } = preparar(entrada);
    const otras = activasDe(c.d, c.plan).reduce((t, a) => t + (Number(a.dias_plan) || 0), 0);
    validarActividad(f, subs, c, otras);
    const hermanas = c.d.actividades.filter((a) => a.plan_id === c.plan.plan_id);
    const numero = String(Math.max(0, ...hermanas.filter((a) => vivo(a) && a.estado !== 'ANULADA').map((a) => parseInt(a.numero, 10) || 0)) + 1);
    const fila = await repo.crear('actividad', { ...f, inicio_plan: c.adenda.fecha_inicio, fin_plan: c.adenda.fecha_inicio, plan_id: c.plan.plan_id, agregada_por: ctx.rol !== 'PROFESIONAL' ? ctx.rol : null, numero, orden: Math.max(0, ...hermanas.map((a) => a.orden || 0)) + 10, clasificacion: 'ALINEADA', es_resumen: 0, avance: 0, estado: 'PENDIENTE' }, { usuario: ctx.usuario, motivo: ctx.motivo || 'Actividad del plan de trabajo', origen: ctx.origen || 'UI', consultor_id: c.consultor.consultor_id });
    await recalcularFechas(c.plan.plan_id, aDia(c.adenda.fecha_inicio), ctx, motivoFechas);
    await servicio.recalcularYGuardar(ctx.usuario, `Formulación del plan: actividad ${numero}`);
    return fila;
  }

  async function actividadDe(actividad_id, ctx) {
    const d = await servicio.datos(true);
    const a = d.actividades.find((x) => x.actividad_id === Number(actividad_id) && vivo(x));
    const plan = a && d.planes.find((p) => p.plan_id === a.plan_id);
    if (!plan) throw error(404, 'Actividad no encontrada');
    return { a, c: await contexto(plan.consultor_id, ctx) };
  }

  /** Modifica una actividad mientras el plan es editable (formulación o revisión del Jefe de Proyecto). */
  async function modificarActividad(actividad_id, entrada, ctx) {
    const { a, c } = await actividadDe(actividad_id, ctx);
    exigirEdicion(c, ctx);
    const { f, subs } = preparar({ ...a, ...entrada });
    const otras = activasDe(c.d, c.plan).filter((x) => x.actividad_id !== a.actividad_id).reduce((t, x) => t + (Number(x.dias_plan) || 0), 0);
    validarActividad(f, subs, c, otras);
    const r = await repo.actualizar('actividad', a.actividad_id, f, { revision: entrada.revision ?? a.revision, usuario: ctx.usuario, motivo: ctx.motivo || 'Actividad del plan de trabajo', origen: ctx.origen || 'UI', consultor_id: c.consultor.consultor_id });
    await recalcularFechas(c.plan.plan_id, aDia(c.adenda.fecha_inicio), ctx, motivoFechas);
    await servicio.recalcularYGuardar(ctx.usuario, `Formulación del plan: actividad ${a.numero}`);
    return r;
  }

  /** Documentos PDF de respaldo de la actividad (se pueden agregar mientras el plan es editable). */
  async function agregarDocumento(actividad_id, buf, nombre, ctx) {
    if (!docs) throw error(501, 'Los documentos de actividad no están habilitados');
    const { a, c } = await actividadDe(actividad_id, ctx);
    exigirEdicion(c, ctx);
    const r = docs.guardar(a.actividad_id, buf, { nombre, usuario: ctx.usuario });
    await repo.registrarBitacora({ usuario: ctx.usuario, entidad: 'actividad', entidad_id: a.actividad_id, consultor_id: c.consultor.consultor_id, accion: 'MODIFICAR', cambios_json: { documento_pdf: { nombre: r.nombre, bytes: r.bytes, sha256: r.sha256 } }, motivo: `Documento agregado a la actividad ${a.numero}`, origen: ctx.origen || 'UI' });
    return { n: r.n, nombre: r.nombre, bytes: r.bytes };
  }

  async function quitarDocumento(actividad_id, n, ctx) {
    if (!docs) throw error(501, 'Los documentos de actividad no están habilitados');
    const { a, c } = await actividadDe(actividad_id, ctx);
    exigirEdicion(c, ctx);
    const f = docs.quitar(a.actividad_id, n, ctx.usuario);
    await repo.registrarBitacora({ usuario: ctx.usuario, entidad: 'actividad', entidad_id: a.actividad_id, consultor_id: c.consultor.consultor_id, accion: 'MODIFICAR', cambios_json: { documento_pdf_retirado: { nombre: f.nombre } }, motivo: `Documento retirado de la actividad ${a.numero}`, origen: ctx.origen || 'UI' });
    return { ok: true };
  }

  /** Ruta del PDF para mostrarlo; respeta que el profesional solo vea los suyos. */
  async function rutaDocumento(actividad_id, n, ctx) {
    if (!docs) throw error(501, 'Los documentos de actividad no están habilitados');
    const { a } = await actividadDe(actividad_id, ctx);
    const r = docs.ruta(a.actividad_id, n);
    if (!r) throw error(404, 'Documento no encontrado');
    return r;
  }

  /** Baja lógica de la actividad (nada se borra). */
  async function quitarActividad(actividad_id, ctx) {
    const { a, c } = await actividadDe(actividad_id, ctx);
    exigirEdicion(c, ctx);
    const r = await repo.actualizar('actividad', a.actividad_id, { estado: 'ANULADA' }, { usuario: ctx.usuario, motivo: ctx.motivo || 'Actividad retirada del plan de trabajo', origen: ctx.origen || 'UI', consultor_id: c.consultor.consultor_id, accion: 'ANULAR' });
    await recalcularFechas(c.plan.plan_id, aDia(c.adenda.fecha_inicio), ctx, motivoFechas);
    await servicio.recalcularYGuardar(ctx.usuario, `Formulación del plan: actividad ${a.numero} retirada`);
    return r;
  }

  /** ENVIAR · APROBAR_JEFE · OBSERVAR (Administrador, con comentario) · APROBAR (Administrador). */
  async function transicion(consultor_id, accion, comentario, ctx) {
    const c = await contexto(consultor_id, ctx);
    if (!c.plan) throw error(409, 'El plan aún no tiene datos registrados');
    const p = permisos(c.plan, ctx, c.consultor.consultor_id);
    const hoy = hoyLima();
    const texto = String(comentario || '').trim();
    let campos; let motivo;
    if (accion === 'ENVIAR') {
      if (!p.puedeEnviar) throw error(409, 'El plan no se puede enviar en su etapa actual o con su perfil');
      const acts = c.d.actividades.filter((a) => a.plan_id === c.plan.plan_id && vivo(a) && a.estado !== 'ANULADA');
      if (!acts.length) throw error(400, 'Registre al menos una actividad antes de enviar el plan');
      campos = { estado: 'EN_REVISION_JEFE', fecha_envio: hoy }; motivo = 'Plan de trabajo enviado para revisión y aprobación';
    } else if (accion === 'APROBAR_JEFE') {
      if (!p.puedeAprobarJefe) throw error(409, 'El plan no está en revisión del Jefe de Proyecto o su perfil no lo permite');
      campos = { estado: 'EN_REVISION_ADMIN', fecha_aprobacion_jefe: hoy, aprobado_jefe_por: ctx.nombre || ctx.usuario, observacion_revision: null }; motivo = texto || 'Plan aprobado por el Jefe de Proyecto; pasa a revisión del Administrador';
    } else if (accion === 'OBSERVAR') {
      if (!p.puedeRevisarAdmin) throw error(409, 'Solo el Administrador puede observar un plan en su revisión');
      if (texto.length < 5) throw error(400, 'Escriba el comentario de la observación (mínimo 5 caracteres)');
      if (texto.length > 1000) throw error(400, 'El comentario admite hasta 1000 caracteres');
      campos = { estado: 'OBSERVADO', observacion_revision: texto, fecha_aprobacion_jefe: null }; motivo = texto;
    } else if (accion === 'APROBAR') {
      if (!p.puedeRevisarAdmin) throw error(409, 'Solo el Administrador puede aprobar un plan en su revisión');
      await recalcularFechas(c.plan.plan_id, aDia(hoy), ctx, 'Fechas recalculadas a partir de la aprobación del plan por el Administrador');
      campos = { estado: 'APROBADO', fecha_aprobacion: hoy, observacion_revision: null, fecha_subsanacion: null }; motivo = texto || 'Plan de trabajo aprobado; inicia el seguimiento';
    } else throw error(400, 'Acción no válida');
    await repo.actualizar('plan_trabajo', c.plan.plan_id, campos, { revision: c.plan.revision, usuario: ctx.usuario, motivo, origen: ctx.origen || 'UI', consultor_id: c.consultor.consultor_id });
    await servicio.recalcularYGuardar(ctx.usuario, `Plan de trabajo: ${accion}`);
    // Al aprobar el Jefe de Proyecto se genera el PDF que se remite al Administrador; al aprobar éste, el definitivo.
    if (accion === 'APROBAR_JEFE' || accion === 'APROBAR') await guardarPdfAutomatico(consultor_id, c.plan.plan_id, ctx, accion === 'APROBAR' ? 'PDF del plan aprobado' : 'PDF del plan remitido al Administrador');
    return detalle(consultor_id, ctx);
  }

  /** Genera y guarda el PDF del plan como PDF vigente del plan (la versión anterior se conserva). No interrumpe la etapa si falla. */
  async function guardarPdfAutomatico(consultor_id, plan_id, ctx, motivo) {
    if (!planesPdf) return null;
    try {
      const buffer = await generarPdfPlan(await detalle(consultor_id, ctx));
      const r = planesPdf.guardar(plan_id, buffer);
      await repo.registrarBitacora({ usuario: ctx.usuario, entidad: 'plan_trabajo', entidad_id: plan_id, consultor_id: Number(consultor_id), accion: 'MODIFICAR', cambios_json: { plan_pdf: { bytes: r.bytes, sha256: r.sha256, reemplaza: r.reemplaza } }, motivo, origen: ctx.origen || 'UI' });
      return r;
    } catch (err) { console.error('No se pudo generar el PDF del plan:', err.message); return null; }
  }

  /** Movimientos de etapa de todos los planes (para Configuración): quién, cuándo y con qué comentario. */
  async function historialGeneral(ctx) {
    if (!jefeOAdmin(ctx)) throw error(403, 'Sin permiso');
    const d = await servicio.datos();
    const bit = await repo.listarBitacora({ entidad: 'plan_trabajo', limite: 500 });
    return bit.map((b) => {
      let c = b.cambios_json; try { if (typeof c === 'string') c = JSON.parse(c); } catch { c = null; }
      if (!c || !c.despues || !c.despues.estado) return null;
      const k = d.consultores.find((x) => x.consultor_id === b.consultor_id);
      return { fecha: b.fecha, consultor: k ? k.nombres : '', clave: k ? k.clave : '', usuario: b.usuario, de: c.antes && c.antes.estado, a: c.despues.estado, comentario: b.motivo, origen: b.origen };
    }).filter(Boolean);
  }

  /** PDF del plan aprobado (solo el Administrador): se guarda como el PDF del plan y lo muestra el visor. */
  async function generarPdf(consultor_id, ctx) {
    if (ctx.rol !== 'ADMIN') throw error(403, 'Solo el Administrador puede generar el PDF del plan');
    const det = await detalle(consultor_id, ctx);
    if (!det.plan || !['EN_REVISION_ADMIN', 'APROBADO'].includes(det.plan.estado)) throw error(409, 'El PDF se genera cuando el plan pasa a revisión del Administrador o está aprobado');
    return { plan_id: det.plan.plan_id, consultor_id: det.consultor.consultor_id, buffer: await generarPdfPlan(det) };
  }

  /**
   * Reinicio de los planes de trabajo: baja lógica de todas las actividades y plan por registrar (nada se borra
   * físicamente; el historial y la bitácora conservan lo anterior). Origen SCRIPT.
   */
  async function reiniciarPlanes(usuario = 'script') {
    const d = await servicio.datos(true);
    let actividades = 0; let planes = 0;
    for (const p of d.planes.filter(vivo)) {
      const opts = { usuario, motivo: 'Reinicio de los planes: se formularán con el nuevo flujo de Formular Plan de Trabajo', origen: 'SCRIPT', consultor_id: p.consultor_id };
      for (const a of d.actividades.filter((x) => x.plan_id === p.plan_id && vivo(x))) { await repo.actualizar('actividad', a.actividad_id, { activo: 0 }, { ...opts, accion: 'ANULAR' }); actividades += 1; }
      await repo.actualizar('plan_trabajo', p.plan_id, { estado: 'POR_REGISTRAR', fecha_recepcion: null, fecha_aprobacion: null, fecha_subsanacion: null, observacion_revision: null, area_usuaria: null, referencia_lb: null, supuestos: null, fecha_envio: null, fecha_aprobacion_jefe: null, aprobado_jefe_por: null }, opts);
      planes += 1;
    }
    await servicio.recalcularYGuardar(usuario, 'Reinicio de los planes de trabajo');
    return { planes, actividades };
  }

  return { detalle, historialGeneral, generarPdf, agregarDocumento, quitarDocumento, rutaDocumento, guardarCabecera, agregarActividad, modificarActividad, quitarActividad, transicion, reiniciarPlanes };
}

module.exports = { crearFormulacion };
