'use strict';
/**
 * Lógica de negocio compartida por la API y el asistente de IA.
 * Todas las escrituras pasan por aquí: validan, aplican reglas de
 * consistencia, registran bitácora (vía repositorio) y disparan el recálculo.
 */
const { aDia, aFecha: diaAFecha, hoyLima, crearCalendario } = require('./motor/calendario');
const { recalcularPlan } = require('./motor/recalculo');
const { construirEstado, coberturaLineaBase, parametro } = require('./motor/estado');
const { ENTIDADES, filtrarColumnas } = require('./datos/entidades');
const { MODALIDADES, ESTADOS_PROYECTO, ESTADOS_ABIERTOS, modalidadDe, configDe } = require('./modalidades');

// Columnas de la Orden de Servicio (db/17) que no se editan por la vía genérica (PATCH /api/contratos/:id)
const COLUMNAS_CONTRATACION = ['fecha_notificacion', 'medio_notificacion', 'plazo_dias', 'fecha_fin', 'monto', 'estado_contratacion', 'contrato_anterior_id', 'fecha_culminacion', 'fecha_registro'];
const ESTADOS_ACTIVIDAD = ['PENDIENTE', 'EN_CURSO', 'CONCLUIDA', 'SUSPENDIDA', 'ANULADA'];
const CLASIFICACIONES = ['ALINEADA', 'REASIGNADA', 'NUEVA', 'TRANSVERSAL'];
const ESTADOS_ADENDA = ['ANUNCIADA', 'EN_TRAMITE', 'FIRMADA', 'ANULADA', 'CONCLUIDA'];
const ESTADOS_PLAN = ['POR_REGISTRAR', 'RECIBIDO', 'EN_FORMULACION', 'EN_REVISION_JEFE', 'EN_REVISION_ADMIN', 'OBSERVADO', 'APROBADO'];
const ESTADOS_CC = ['BORRADOR', 'APROBADO', 'RECHAZADO'];

const error = (estado, mensaje, extra = {}) => Object.assign(new Error(mensaje), { estado, ...extra });
const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Características que elige quien registra el proyecto (db/13). */
const BANDERAS_PROYECTO = ['con_profesionales', 'con_adendas', 'con_linea_base', 'con_orden_servicio', 'con_tdr'];
const BANDERAS_DEFECTO = { con_profesionales: 1, con_adendas: 1, con_linea_base: 1, con_orden_servicio: 0, con_tdr: 0 };

/** Áreas que la Dirección OTI puede designar para la gestión de un proyecto (la Dirección OTI es quien lo crea). */
const AREAS_TECNICAS = ['Equipo de Desarrollo', 'Equipo de Infraestructura', 'Seguridad de la Información', 'Equipo de Base de Datos'];

/** Jefes de proyecto que la Dirección OTI puede designar. */
const JEFES_PROYECTO = ['Alex Tantachuco', 'Iván Rengifo', 'Martín Chocce', 'José Carlos Gallardo'];

function validarFechas(obj, campos) {
  for (const c of campos) {
    if (obj[c] === undefined || obj[c] === null) continue;
    if (!esFecha(obj[c])) throw error(400, `El campo ${c} debe tener formato AAAA-MM-DD`);
  }
}

function crearServicio(repo) {
  let cache = null;
  let cacheEn = 0;
  const TTL = 5000;

  async function datos(forzar = false) {
    if (forzar || !cache || Date.now() - cacheEn > TTL) {
      cache = await repo.cargarTodo();
      cacheEn = Date.now();
    }
    return cache;
  }
  const invalidar = () => { cache = null; };

  async function corteVigente() {
    const d = await datos();
    const p = parametro(d, 'FECHA_CORTE', '');
    return esFecha(p) ? p : hoyLima();
  }

  async function estado({ corte, proyecto_id } = {}) {
    const d = await datos();
    return construirEstado(d, { corte: esFecha(corte) ? corte : await corteVigente(), proyecto_id: proyecto_id ? Number(proyecto_id) : null });
  }

  async function recalcularYGuardar(usuario, motivo) {
    invalidar();
    const e = await estado();
    const id = await repo.guardarRecalculo(e, { usuario, motivo });
    return { recalculo_id: id, indicadores: e.indicadores };
  }

  /** Recalcula y persiste una vez al día (primera consulta del día o arranque). */
  async function recalculoDiario() {
    const ultimo = await repo.ultimoRecalculo();
    const corte = await corteVigente();
    if (!ultimo || String(ultimo.fecha_corte).slice(0, 10) !== corte) {
      await recalcularYGuardar('sistema', `Recálculo automático del corte ${corte}`);
    }
  }

  function consultorDe(d, { plan_id, actividad_id, contrato_id }) {
    let pid = plan_id;
    if (actividad_id) pid = (d.actividades.find((a) => a.actividad_id === Number(actividad_id)) || {}).plan_id;
    if (pid) return (d.planes.find((p) => p.plan_id === Number(pid)) || {}).consultor_id ?? null;
    if (contrato_id) return (d.contratos.find((k) => k.contrato_id === Number(contrato_id)) || {}).consultor_id ?? null;
    return null;
  }

  /** Reglas de consistencia de una actividad (avance, estado y fechas reales). */
  function consolidarActividad(previa, cambios, hoy, motivo) {
    const c = { ...cambios };
    for (const k of ['avance', 'estado', 'inicio_plan', 'fin_plan', 'descripcion', 'numero', 'clasificacion', 'es_hito', 'orden']) {
      if (k in c && c[k] === null) delete c[k]; // columnas obligatorias: un valor vacío no las borra
    }
    if (c.avance !== undefined && c.avance !== null) {
      c.avance = Number(c.avance);
      if (Number.isNaN(c.avance) || c.avance < 0 || c.avance > 100) throw error(400, 'El avance debe estar entre 0 y 100');
      c.avance = Math.round(c.avance * 100) / 100;
    }
    if (c.estado !== undefined && !ESTADOS_ACTIVIDAD.includes(c.estado)) throw error(400, `Estado no válido: ${c.estado}`);
    if (c.clasificacion !== undefined && !CLASIFICACIONES.includes(c.clasificacion)) throw error(400, `Clasificación no válida: ${c.clasificacion}`);
    validarFechas(c, ['inicio_plan', 'fin_plan', 'inicio_real', 'fin_real', 'fecha_revision']);
    const m = { ...previa, ...c };

    if (c.estado === 'CONCLUIDA' || (c.avance !== undefined && c.avance >= 100 && m.estado !== 'ANULADA')) {
      c.estado = 'CONCLUIDA';
      c.avance = 100;
      // Sin fecha real informada se asume el fin planificado (o hoy, si aún no llegaba); el usuario puede corregirla
      if (!m.fin_real) { c.fin_real = m.fin_plan <= hoy ? m.fin_plan : hoy; c.__fin_real_asumido = true; }
      if (!m.inicio_real) c.inicio_real = m.inicio_plan <= (c.fin_real || m.fin_real) ? m.inicio_plan : (c.fin_real || m.fin_real);
    } else if (m.estado === 'CONCLUIDA' && c.avance !== undefined && c.avance < 100) {
      c.estado = 'EN_CURSO';
      c.fin_real = null;
    } else if (Number(m.avance) > 0 && m.estado === 'PENDIENTE') {
      c.estado = 'EN_CURSO';
    }
    const f = { ...previa, ...c };
    if (f.estado === 'EN_CURSO' && !f.inicio_real) c.inicio_real = f.inicio_plan <= hoy ? f.inicio_plan : hoy;
    if (f.estado === 'PENDIENTE' && Number(f.avance) === 0 && cambios.estado === 'PENDIENTE') { c.inicio_real = null; c.fin_real = null; }

    const asumido = !!c.__fin_real_asumido;
    delete c.__fin_real_asumido;
    const z = { ...previa, ...c };
    if (z.fin_plan < z.inicio_plan) throw error(400, 'El fin planificado no puede ser anterior al inicio planificado');
    if (z.fin_real && z.fin_real > hoy) throw error(400, 'La fecha de fin real no puede ser futura');
    if (z.inicio_real && z.inicio_real > hoy) throw error(400, 'La fecha de inicio real no puede ser futura');
    if (z.fin_real && z.inicio_real && z.fin_real < z.inicio_real) throw error(400, 'El fin real no puede ser anterior al inicio real');
    const reprograma = (c.inicio_plan !== undefined && c.inicio_plan !== previa.inicio_plan) || (c.fin_plan !== undefined && c.fin_plan !== previa.fin_plan);
    if (reprograma && !(motivo && String(motivo).trim().length >= 5)) {
      throw error(400, 'Cambiar las fechas del plan es una reprogramación: indique el motivo (mínimo 5 caracteres).', { requiereMotivo: true });
    }
    return { cambios: c, reprograma, finRealAsumido: asumido };
  }

  function pronosticoDePlan(d, plan_id, corte) {
    const plan = d.planes.find((p) => p.plan_id === Number(plan_id));
    const acts = d.actividades.filter((a) => a.plan_id === plan.plan_id);
    return recalcularPlan({ plan, actividades: acts, dependencias: d.dependencias, feriados: d.feriados.map((f) => f.fecha), corte, metodo: parametro(d, 'METODO_PRONOSTICO', 'RENDIMIENTO'), spiMinimo: Number(parametro(d, 'SPI_MINIMO', 0.4)) });
  }

  // ---------------------------------------------------------------- actividades
  async function actualizarActividad(id, cambiosEntrada, ctx) {
    const d = await datos(true);
    const previa = d.actividades.find((a) => a.actividad_id === Number(id));
    if (!previa) throw error(404, 'Actividad no encontrada');
    const hoy = hoyLima();
    const { cambios, reprograma, finRealAsumido } = consolidarActividad(previa, filtrarColumnas('actividad', cambiosEntrada), hoy, ctx.motivo);
    delete cambios.plan_id;
    // Validar que el cambio no rompa el cálculo (p. ej., datos incoherentes)
    const copia = { ...d, actividades: d.actividades.map((a) => (a.actividad_id === previa.actividad_id ? { ...a, ...cambios } : a)) };
    pronosticoDePlan(copia, previa.plan_id, await corteVigente());
    const r = await repo.actualizar('actividad', id, cambios, {
      revision: cambiosEntrada.revision, usuario: ctx.usuario, motivo: ctx.motivo, origen: ctx.origen,
      consultor_id: consultorDe(d, { actividad_id: id }), accion: reprograma ? 'REPROGRAMAR' : 'MODIFICAR',
    });
    await recalcularYGuardar(ctx.usuario, `Cambio en actividad ${previa.numero}`);
    return { ...r, finRealAsumido };
  }

  async function crearActividad(plan_id, entrada, ctx) {
    const d = await datos(true);
    const plan = d.planes.find((p) => p.plan_id === Number(plan_id));
    if (!plan) throw error(404, 'Plan no encontrado');
    const f = filtrarColumnas('actividad', entrada);
    if (!f.descripcion || !f.inicio_plan || !f.fin_plan) throw error(400, 'Descripción, inicio y fin planificados son obligatorios');
    validarFechas(f, ['inicio_plan', 'fin_plan']);
    if (f.fin_plan < f.inicio_plan) throw error(400, 'El fin planificado no puede ser anterior al inicio');
    const hermanas = d.actividades.filter((a) => a.plan_id === plan.plan_id);
    const fila = {
      clasificacion: 'ALINEADA', es_hito: 0, es_resumen: 0, avance: 0, estado: 'PENDIENTE',
      numero: String(hermanas.length + 1), orden: (Math.max(0, ...hermanas.map((a) => a.orden || 0)) + 10), ...f, plan_id: plan.plan_id,
    };
    if (!CLASIFICACIONES.includes(fila.clasificacion)) throw error(400, 'Clasificación no válida');
    const nueva = await repo.crear('actividad', fila, { usuario: ctx.usuario, motivo: ctx.motivo, origen: ctx.origen, consultor_id: plan.consultor_id });
    if (plan.estado === 'POR_REGISTRAR') await repo.actualizar('plan_trabajo', plan.plan_id, { estado: 'RECIBIDO' }, { usuario: ctx.usuario, motivo: 'Se registraron actividades del plan', consultor_id: plan.consultor_id, origen: ctx.origen });
    if (Array.isArray(entrada.predecesoras) && entrada.predecesoras.length) {
      invalidar();
      await definirDependencias(nueva.actividad_id, entrada.predecesoras, ctx, { sinRecalculo: true });
    }
    await recalcularYGuardar(ctx.usuario, `Nueva actividad ${fila.numero}`);
    return nueva;
  }

  async function anularActividad(id, ctx) {
    if (!ctx.motivo || ctx.motivo.trim().length < 5) throw error(400, 'Indique el motivo de la anulación', { requiereMotivo: true });
    const d = await datos(true);
    const a = d.actividades.find((x) => x.actividad_id === Number(id));
    if (!a) throw error(404, 'Actividad no encontrada');
    const r = await repo.actualizar('actividad', id, { estado: 'ANULADA' }, { usuario: ctx.usuario, motivo: ctx.motivo, origen: ctx.origen, consultor_id: consultorDe(d, { actividad_id: id }), accion: 'ANULAR' });
    await recalcularYGuardar(ctx.usuario, `Anulación de actividad ${a.numero}`);
    return r;
  }

  /** Reemplaza las predecesoras de una actividad. lista = [{predecesora_id, desfase_dias}] */
  async function definirDependencias(actividad_id, lista, ctx, { sinRecalculo = false } = {}) {
    const d = await datos(true);
    const a = d.actividades.find((x) => x.actividad_id === Number(actividad_id));
    if (!a) throw error(404, 'Actividad no encontrada');
    const nuevas = (lista || []).map((x) => ({ predecesora_id: Number(x.predecesora_id), desfase_dias: Number(x.desfase_dias) || 0 }));
    for (const n of nuevas) {
      const p = d.actividades.find((x) => x.actividad_id === n.predecesora_id);
      if (!p || p.plan_id !== a.plan_id) throw error(400, 'La predecesora debe pertenecer al mismo plan');
      if (n.predecesora_id === a.actividad_id) throw error(400, 'Una actividad no puede depender de sí misma');
    }
    const vigentes = d.dependencias.filter((x) => x.actividad_id === a.actividad_id && x.activo !== 0);
    const simulada = [...d.dependencias.filter((x) => x.actividad_id !== a.actividad_id), ...nuevas.map((n) => ({ ...n, actividad_id: a.actividad_id, activo: 1 }))];
    pronosticoDePlan({ ...d, dependencias: simulada }, a.plan_id, await corteVigente()); // lanza error si hay ciclo
    const consultor_id = consultorDe(d, { actividad_id });
    const opts = { usuario: ctx.usuario, motivo: ctx.motivo, origen: ctx.origen, consultor_id };
    for (const v of vigentes) {
      const n = nuevas.find((x) => x.predecesora_id === v.predecesora_id);
      if (!n) await repo.actualizar('actividad_dependencia', v.dependencia_id, { activo: 0 }, { ...opts, accion: 'ANULAR' });
      else if (Number(n.desfase_dias) !== Number(v.desfase_dias)) await repo.actualizar('actividad_dependencia', v.dependencia_id, { desfase_dias: n.desfase_dias }, opts);
    }
    const todas = d.dependencias.filter((x) => x.actividad_id === a.actividad_id);
    for (const n of nuevas) {
      if (vigentes.some((v) => v.predecesora_id === n.predecesora_id)) continue;
      const anulada = todas.find((x) => x.predecesora_id === n.predecesora_id);
      if (anulada) await repo.actualizar('actividad_dependencia', anulada.dependencia_id, { activo: 1, desfase_dias: n.desfase_dias }, opts);
      else await repo.crear('actividad_dependencia', { actividad_id: a.actividad_id, predecesora_id: n.predecesora_id, tipo: 'FS', desfase_dias: n.desfase_dias }, opts);
    }
    if (!sinRecalculo) await recalcularYGuardar(ctx.usuario, `Dependencias de la actividad ${a.numero}`);
    invalidar();
    return (await datos(true)).dependencias.filter((x) => x.actividad_id === a.actividad_id);
  }

  /**
   * Simulación ("¿qué pasa si...?") sin guardar.
   * cambios = [{ actividad_id, avance?, estado?, inicio_plan?, fin_plan?, inicio_real?, fin_real? }]
   */
  async function simular(cambios = [], { corte } = {}) {
    const d = JSON.parse(JSON.stringify(await datos()));
    const c = esFecha(corte) ? corte : await corteVigente();
    const antes = construirEstado(d, { corte: c });
    const hoy = hoyLima();
    for (const ch of cambios) {
      const a = d.actividades.find((x) => x.actividad_id === Number(ch.actividad_id));
      if (!a) throw error(400, `Actividad ${ch.actividad_id} no existe`);
      const { cambios: cc } = consolidarActividad(a, filtrarColumnas('actividad', ch), hoy, 'simulación');
      Object.assign(a, cc);
    }
    const despues = construirEstado(d, { corte: c });
    const impacto = [];
    for (const it of despues.consultores) {
      const prev = antes.consultores.find((x) => x.consultor.consultor_id === it.consultor.consultor_id);
      const pa = prev.pronostico;
      const pd = it.pronostico;
      if (!pd || !pa) continue;
      const actividades = Object.values(pd.actividades)
        .filter((x) => pa.actividades[x.actividad_id] && pa.actividades[x.actividad_id].fin_probable !== x.fin_probable)
        .map((x) => {
          const a = d.actividades.find((y) => y.actividad_id === x.actividad_id);
          return { actividad_id: x.actividad_id, numero: a.numero, descripcion: a.descripcion, fin_probable_antes: pa.actividades[x.actividad_id].fin_probable, fin_probable_despues: x.fin_probable };
        });
      if (pa.fin_probable !== pd.fin_probable || actividades.length) {
        impacto.push({
          clave: it.consultor.clave, nombres: it.consultor.nombres,
          fin_probable_antes: pa.fin_probable, fin_probable_despues: pd.fin_probable,
          holgura_antes: prev.vigencia.holgura_dias, holgura_despues: it.vigencia.holgura_dias,
          semaforo_antes: prev.vigencia.semaforo, semaforo_despues: it.vigencia.semaforo, actividades,
        });
      }
    }
    return { corte: c, impacto, indicadores_antes: antes.indicadores, indicadores_despues: despues.indicadores };
  }

  /** Adopta las fechas probables como nuevas fechas del plan (reprogramación formal). */
  /**
   * Revisión del plan de trabajo: aprobarlo (queda la fecha de aprobación) u observarlo (exige la observación y el
   * plazo para subsanar). Pasa por actualizarEntidad: validaciones, revisión optimista, bitácora y recálculo.
   */
  async function revisarPlan(plan_id, { decision, observacion, plazo } = {}, ctx) {
    const d = await datos(true);
    const plan = d.planes.find((p) => p.plan_id === Number(plan_id) && p.activo !== 0 && p.activo !== false);
    if (!plan) throw error(404, 'Plan no encontrado');
    const hoy = hoyLima();
    let campos;
    if (decision === 'APROBAR') {
      campos = { estado: 'APROBADO', fecha_aprobacion: hoy, fecha_subsanacion: null, observacion_revision: null };
    } else if (decision === 'OBSERVAR') {
      const obs = String(observacion || '').trim();
      if (obs.length < 5) throw error(400, 'Indique la observación al plan (mínimo 5 caracteres)');
      if (!esFecha(plazo)) throw error(400, 'Indique el plazo para subsanar (fecha límite)');
      if (plazo < hoy) throw error(400, 'El plazo para subsanar no puede ser anterior a hoy');
      campos = { estado: 'OBSERVADO', fecha_aprobacion: null, fecha_subsanacion: plazo, observacion_revision: obs };
    } else {
      throw error(400, 'Decisión no válida: use APROBAR u OBSERVAR');
    }
    const motivo = ctx.motivo || (decision === 'APROBAR' ? 'Aprobación del plan de trabajo' : 'Observación al plan de trabajo');
    return actualizarEntidad('plan_trabajo', plan.plan_id, { ...campos, revision: plan.revision }, { ...ctx, motivo });
  }

  async function adoptarPronostico(plan_id, ctx) {
    if (!ctx.motivo || ctx.motivo.trim().length < 5) throw error(400, 'La reprogramación formal requiere motivo', { requiereMotivo: true });
    const d = await datos(true);
    const plan = d.planes.find((p) => p.plan_id === Number(plan_id));
    if (!plan) throw error(404, 'Plan no encontrado');
    const pr = pronosticoDePlan(d, plan.plan_id, await corteVigente());
    let n = 0;
    for (const a of d.actividades.filter((x) => x.plan_id === plan.plan_id && x.estado !== 'ANULADA' && x.estado !== 'CONCLUIDA')) {
      const p = pr.actividades[a.actividad_id];
      if (!p || (p.inicio_probable === a.inicio_plan && p.fin_probable === a.fin_plan)) continue;
      await repo.actualizar('actividad', a.actividad_id, { inicio_plan: p.inicio_probable, fin_plan: p.fin_probable }, { usuario: ctx.usuario, motivo: ctx.motivo, origen: ctx.origen, consultor_id: plan.consultor_id, accion: 'REPROGRAMAR' });
      n += 1;
    }
    await recalcularYGuardar(ctx.usuario, `Reprogramación formal del plan ${plan.plan_id}`);
    return { actividades_reprogramadas: n };
  }

  // ---------------------------------------------------------------- otras entidades
  const VALIDADORES = {
    adenda: (f, previa = {}) => {
      validarFechas(f, ['fecha_inicio', 'fecha_fin', 'fecha_suscripcion']);
      const m = { ...previa, ...f };
      if (m.estado && !ESTADOS_ADENDA.includes(m.estado)) throw error(400, 'Estado de adenda no válido');
      if (m.fecha_inicio && m.fecha_fin && m.fecha_fin < m.fecha_inicio) throw error(400, 'El fin de la adenda no puede ser anterior a su inicio');
      if (m.estado === 'FIRMADA' && !m.documento_ref) throw error(400, 'Una adenda FIRMADA requiere la referencia del documento');
      for (const [k, max, nombre] of [['expediente', 40, 'El expediente'], ['documento_ref', 300, 'La referencia del documento'], ['observacion', 1000, 'La observación']]) {
        if (typeof f[k] === 'string' && f[k].length > max) throw error(400, `${nombre} admite hasta ${max} caracteres (tiene ${f[k].length})`); // los límites de sgf.adenda
      }
      for (const k of ['plazo_dias', 'plazo_solicitado_dias']) {
        if (m[k] !== null && m[k] !== undefined && !(Number.isInteger(Number(m[k])) && Number(m[k]) > 0)) throw error(400, `${k === 'plazo_dias' ? 'El plazo otorgado' : 'El plazo solicitado'} debe ser un número entero de días mayor que cero`);
      }
    },
    plan_trabajo: (f, previa = {}) => {
      validarFechas(f, ['fecha_recepcion', 'fecha_aprobacion', 'fecha_subsanacion', 'fecha_envio', 'fecha_aprobacion_jefe']);
      if (typeof f.observacion_revision === 'string' && f.observacion_revision.length > 1000) throw error(400, `La observación admite hasta 1000 caracteres (tiene ${f.observacion_revision.length})`);
      const m = { ...previa, ...f };
      if (m.estado && !ESTADOS_PLAN.includes(m.estado)) throw error(400, 'Estado de plan no válido');
      if (m.tipo_dias && !['CALENDARIO', 'HABILES'].includes(m.tipo_dias)) throw error(400, 'Tipo de días no válido');
    },
    control_cambio: (f, previa = {}) => {
      validarFechas(f, ['fecha']);
      const m = { ...previa, ...f };
      if (m.estado && !ESTADOS_CC.includes(m.estado)) throw error(400, 'Estado de control de cambios no válido');
    },
    proyecto: (f, previa = {}) => {
      validarFechas(f, ['fecha_inicio', 'fecha_fin', 'fecha_cierre']);
      const m = { ...previa, ...f };
      delete f.codigo; // el código lo genera el sistema y nadie lo modifica
      // Las características (con_*) y es_atipico se derivan de la modalidad (db/16): no las elige el usuario
      for (const k of BANDERAS_PROYECTO) delete f[k];
      delete f.es_atipico;
      if (f.modalidad !== undefined && f.modalidad !== null && f.modalidad !== modalidadDe(previa.proyecto_id ? previa : null) || (!previa.proyecto_id && f.modalidad)) {
        if (!MODALIDADES[f.modalidad]) throw error(400, `Modalidad no válida (use: ${Object.keys(MODALIDADES).join(', ')})`);
        Object.assign(f, MODALIDADES[f.modalidad].banderas, { es_atipico: MODALIDADES[f.modalidad].atipico ? 1 : 0 });
      } else delete f.modalidad;
      const modalidad = f.modalidad || modalidadDe(previa.proyecto_id ? previa : null);
      if ('motivo_atipico' in f) f.motivo_atipico = f.motivo_atipico ? String(f.motivo_atipico).trim() : null;
      const motivo = 'motivo_atipico' in f ? f.motivo_atipico : previa.motivo_atipico;
      if (MODALIDADES[modalidad].atipico && (!motivo || motivo.length < 15)) throw error(400, 'El caso atípico (contrato con adendas) exige el motivo: al menos 15 caracteres');
      for (const [k, max, nombre] of [['motivo_atipico', 500, 'El motivo del caso atípico'], ['unidad_usuaria', 200, 'La unidad usuaria'], ['objetivo', 1000, 'El objetivo'], ['lecciones_aprendidas', 2000, 'Las lecciones aprendidas']]) {
        if (f[k] && String(f[k]).length > max) throw error(400, `${nombre} admite hasta ${max} caracteres`);
      }
      if ('nombre' in f) { f.nombre = String(f.nombre || '').trim(); if (f.nombre.length < 5 || f.nombre.length > 300) throw error(400, 'El nombre del proyecto lleva de 5 a 300 caracteres'); }
      if (m.fecha_inicio && m.fecha_fin && String(m.fecha_fin) < String(m.fecha_inicio)) throw error(400, 'El fin del proyecto no puede ser anterior a su inicio');
      if (f.estado && !ESTADOS_PROYECTO.includes(f.estado)) throw error(400, `Estado de proyecto no válido (use: ${ESTADOS_PROYECTO.join(', ')})`);
      if (f.area_tecnica && !AREAS_TECNICAS.includes(f.area_tecnica) && f.area_tecnica !== previa.area_tecnica) throw error(400, `La gestión del proyecto debe ser una de: ${AREAS_TECNICAS.join(', ')}`);
      if (f.jefe_proyecto && !JEFES_PROYECTO.includes(f.jefe_proyecto) && f.jefe_proyecto !== previa.jefe_proyecto) throw error(400, `El jefe de proyecto debe ser uno de: ${JEFES_PROYECTO.join(', ')}`);
      for (const k of ['financiador', 'jefe_proyecto']) if (f[k] && String(f[k]).length > 300) throw error(400, `El campo ${k} es demasiado largo`);
      if (f.descripcion && String(f.descripcion).length > 1000) throw error(400, 'La descripción supera los 1000 caracteres');
    },
    linea_base_entregable: (f) => validarFechas(f, ['inicio_lb', 'fin_lb', 'fecha_corte_lb']),
    contrato: (f) => {
      // Los datos de la contratación (db/17) solo los escriben contrataciones.js y supervision.js, con sus reglas
      for (const k of COLUMNAS_CONTRATACION) delete f[k];
      validarFechas(f, ['fecha_inicio']);
    },
    consultor: () => {},
  };

  async function actualizarEntidad(entidad, id, entrada, ctx) {
    if (!VALIDADORES[entidad]) throw error(400, 'Entidad no editable por esta vía');
    const d = await datos(true);
    const meta = ENTIDADES[entidad];
    const previa = d[meta.coleccion].find((x) => x[meta.pk] === Number(id));
    if (!previa) throw error(404, 'Registro no encontrado');
    const f = filtrarColumnas(entidad, entrada);
    if (entidad === 'consultor' && ctx.rol !== 'ADMIN') for (const k of meta.personales) delete f[k];
    if (entidad === 'adenda') {
      delete f.tipo_periodo; // lo fija quien crea el periodo
      // Los periodos de una Orden de Servicio salen de la notificación y de las ampliaciones (contrataciones.js)
      if (['ORIGINAL', 'AMPLIACION'].includes(previa.tipo_periodo) && ['fecha_inicio', 'fecha_fin', 'plazo_dias', 'estado', 'contrato_id', 'activo'].some((k) => k in f && String(f[k] ?? '') !== String(previa[k] ?? ''))) {
        throw error(409, 'Este periodo es de una Orden de Servicio: sus fechas se corrigen con «Corregir notificación» o «Ampliar plazo»');
      }
    }
    VALIDADORES[entidad](f, previa);
    if (entidad === 'proyecto' && f.modalidad && f.modalidad !== modalidadDe(previa) && d.consultores.some((c) => c.proyecto_id === Number(id) && c.activo !== 0)) throw error(409, 'Con profesionales ya registrados no se puede cambiar la modalidad del proyecto');
    // El cierre formal (P9) se hace con «Cerrar proyecto» (cierre.js): exige el informe de cierre y las lecciones aprendidas
    if (entidad === 'proyecto' && f.estado === 'CERRADO' && previa.estado !== 'CERRADO') throw error(409, 'Para cerrar el proyecto use «Cerrar proyecto»: verifica los requisitos y pide el informe de cierre y las lecciones aprendidas');
    if (entidad === 'proyecto' && f.estado === 'ANULADO' && d.consultores.some((c) => c.proyecto_id === Number(id) && c.activo !== 0 && c.estado === 'ACTIVO')) throw error(409, 'No se puede anular el proyecto mientras tenga profesionales ACTIVOS: cambie su estado a CULMINADO o NO_RENOVADO');
    const consultor_id = entidad === 'proyecto' ? null : entidad === 'consultor' ? Number(id) : previa.consultor_id ?? consultorDe(d, { contrato_id: previa.contrato_id });
    const r = await repo.actualizar(entidad, id, f, { revision: entrada.revision, usuario: ctx.usuario, motivo: ctx.motivo, origen: ctx.origen, consultor_id });
    await recalcularYGuardar(ctx.usuario, `Cambio en ${entidad} ${id}`);
    return r;
  }

  /**
   * Valida los datos de un profesional nuevo y devuelve la fila de sgf.consultor (sin escribir).
   * La usan registrarProfesional y el registro de una Orden de Servicio (contrataciones.js).
   */
  function validarProfesionalNuevo(d, e, ctx, proy) {
    const clave = String(e.clave || '').trim().toUpperCase();
    if (!/^[A-Z]{2,5}$/.test(clave)) throw error(400, 'La clave del profesional lleva de 2 a 5 letras (p. ej. iniciales)');
    if (d.consultores.some((c) => c.clave === clave)) throw error(409, `Ya existe un profesional con la clave ${clave}`);
    const nombres = String(e.nombres || '').trim();
    if (nombres.length < 5 || nombres.length > 150) throw error(400, 'Los nombres y apellidos llevan de 5 a 150 caracteres');
    const cons = filtrarColumnas('consultor', { clave, nombres, perfil: e.perfil, recurso_cronograma: e.recurso_cronograma, sede: e.sede, correo_institucional: e.correo_institucional, observacion: e.observacion });
    if (ctx.rol === 'ADMIN') Object.assign(cons, filtrarColumnas('consultor', { dni: e.dni, telefono: e.telefono, correo_personal: e.correo_personal }));
    return Object.assign(cons, { proyecto_id: proy.proyecto_id, proyecto: String(proy.nombre).slice(0, 100), estado: 'ACTIVO' });
  }

  /**
   * Registra un profesional en un proyecto: consultor + contrato y, si se indica, su primera adenda.
   * Se valida todo antes de escribir; luego se recalcula una sola vez.
   */
  async function registrarProfesional(entrada, ctx) {
    const d = await datos(true);
    const e = entrada || {};
    const proy = d.proyectos.find((p) => p.proyecto_id === Number(e.proyecto_id) && p.activo !== 0);
    if (!proy) throw error(400, 'Seleccione el proyecto');
    if (!ESTADOS_ABIERTOS.includes(proy.estado)) throw error(409, `El proyecto está ${String(proy.estado).toLowerCase().replace('_', ' ')}: no admite nuevos profesionales`);
    if (proy.con_profesionales === 0) throw error(409, 'Este proyecto se registró sin profesionales');
    if (configDe(proy).inicio === 'NOTIFICACION') throw error(409, 'En la modalidad Orden de Servicio el profesional se registra con su Orden de Servicio, el TDR, el monto y los entregables («Registrar Orden de Servicio»)');
    const porOS = proy.con_orden_servicio === 1;
    const doc = porOS ? 'Orden de Servicio' : 'contrato';
    const clave = String(e.clave || '').trim().toUpperCase();
    if (!/^[A-Z]{2,5}$/.test(clave)) throw error(400, 'La clave del profesional lleva de 2 a 5 letras (p. ej. iniciales)');
    if (d.consultores.some((c) => c.clave === clave)) throw error(409, `Ya existe un profesional con la clave ${clave}`);
    const nombres = String(e.nombres || '').trim();
    if (nombres.length < 5 || nombres.length > 150) throw error(400, 'Los nombres y apellidos llevan de 5 a 150 caracteres');
    const numero = String(e.contrato_numero || '').trim();
    if (!numero || numero.length > 60) throw error(400, `El número de ${doc} es obligatorio (hasta 60 caracteres)`);
    if (d.contratos.some((k) => String(k.numero).toLowerCase() === numero.toLowerCase())) throw error(409, `Ya existe ${porOS ? 'la Orden de Servicio' : 'el contrato'} ${numero}`);
    const cons = filtrarColumnas('consultor', { clave, nombres, perfil: e.perfil, recurso_cronograma: e.recurso_cronograma, sede: e.sede, correo_institucional: e.correo_institucional, observacion: e.observacion });
    if (ctx.rol === 'ADMIN') Object.assign(cons, filtrarColumnas('consultor', { dni: e.dni, telefono: e.telefono, correo_personal: e.correo_personal }));
    Object.assign(cons, { proyecto_id: proy.proyecto_id, proyecto: String(proy.nombre).slice(0, 100), estado: 'ACTIVO' });
    const k = filtrarColumnas('contrato', { numero, tipo_documento: porOS ? 'ORDEN_SERVICIO' : 'CONTRATO', titulo_tdr: e.titulo_tdr || e.perfil, servicio: e.servicio || e.perfil, fecha_inicio: e.contrato_inicio, expediente: e.expediente });
    validarFechas(k, ['fecha_inicio']);
    let ad = null;
    if (porOS && !(e.adenda_inicio && (e.adenda_fin || e.adenda_plazo_dias))) throw error(400, 'La Orden de Servicio requiere su inicio y su plazo (en días) o su fin: de ahí se controla su vencimiento');
    if (e.adenda_inicio || e.adenda_fin || e.adenda_plazo_dias) {
      ad = filtrarColumnas('adenda', { numero: e.adenda_numero || 1, fecha_inicio: e.adenda_inicio, fecha_fin: e.adenda_fin, plazo_dias: e.adenda_plazo_dias, estado: e.adenda_estado || 'FIRMADA', expediente: e.expediente, documento_ref: e.adenda_documento || `${porOS ? 'Orden de Servicio' : 'Contrato'} N.° ${numero}`, fecha_suscripcion: e.adenda_suscripcion });
      if (!ad.fecha_fin && ad.fecha_inicio && ad.plazo_dias) ad.fecha_fin = diaAFecha(aDia(ad.fecha_inicio) + Number(ad.plazo_dias) - 1);
      if (!ad.fecha_inicio || !ad.fecha_fin) throw error(400, 'La adenda lleva inicio y fin (o inicio y plazo en días)');
      VALIDADORES.adenda(ad);
    }
    const base = { usuario: ctx.usuario, motivo: ctx.motivo || `Alta del profesional ${clave} en el proyecto ${proy.codigo}`, origen: ctx.origen };
    // consultor + contrato + primera adenda en UNA transacción: si algo falla, no queda un profesional a medias (C4)
    const { c, contrato, adenda } = await repo.transaccion(async (t) => {
      const nuevo = await t.crear('consultor', cons, { ...base, consultor_id: null });
      const kk = await t.crear('contrato', { ...k, consultor_id: nuevo.consultor_id }, { ...base, consultor_id: nuevo.consultor_id });
      const aa = ad ? await t.crear('adenda', { ...ad, contrato_id: kk.contrato_id }, { ...base, consultor_id: nuevo.consultor_id }) : null;
      return { c: nuevo, contrato: kk, adenda: aa };
    });
    await recalcularYGuardar(ctx.usuario, `Alta del profesional ${clave}`);
    return { consultor: c, contrato, adenda };
  }

  /**
   * Renueva o amplía una Orden de Servicio (proyectos sin adendas): registra el nuevo periodo, que empieza
   * al día siguiente del fin vigente (o en la fecha indicada) y mueve el vencimiento que se controla.
   */
  async function ampliarOrdenServicio(consultor_id, entrada, ctx) {
    const d = await datos(true);
    const c = d.consultores.find((x) => x.consultor_id === Number(consultor_id) && x.activo !== 0);
    if (!c) throw error(404, 'Profesional no encontrado');
    const proy = d.proyectos.find((p) => p.proyecto_id === c.proyecto_id);
    if (proy && configDe(proy).inicio === 'NOTIFICACION') throw error(409, 'En la modalidad Orden de Servicio use «Nueva Orden de Servicio» (otra contratación) o «Ampliación de plazo» de la Orden de Servicio vigente');
    if (proy && proy.con_adendas === 1) throw error(409, 'Este proyecto maneja adendas: registre una adenda en Contratos y adendas');
    const k = d.contratos.find((x) => x.consultor_id === c.consultor_id && x.activo !== 0);
    if (!k) throw error(409, 'El profesional no tiene Orden de Servicio registrada');
    const e = entrada || {};
    const previas = d.adendas.filter((a) => a.contrato_id === k.contrato_id && a.activo !== 0 && a.estado !== 'ANULADA');
    const ultimoFin = previas.reduce((m, a) => (a.fecha_fin > m ? a.fecha_fin : m), '');
    const inicio = e.inicio || (ultimoFin ? diaAFecha(aDia(ultimoFin) + 1) : '');
    if (!inicio) throw error(400, 'Indique el inicio del nuevo periodo');
    validarFechas({ inicio, fin: e.fin }, ['inicio', 'fin']);
    if (ultimoFin && inicio <= ultimoFin) throw error(400, `El nuevo periodo debe iniciar después del fin vigente (${ultimoFin.split('-').reverse().join('/')})`);
    let fin = e.fin;
    if (!fin && e.plazo_dias) fin = diaAFecha(aDia(inicio) + Number(e.plazo_dias) - 1);
    if (!fin) throw error(400, 'Indique el fin del nuevo periodo o su plazo en días');
    const numeroOS = String(e.os_numero || '').trim();
    const ad = filtrarColumnas('adenda', { contrato_id: k.contrato_id, numero: Math.max(0, ...previas.map((a) => Number(a.numero))) + 1, fecha_inicio: inicio, fecha_fin: fin, plazo_dias: e.plazo_dias, estado: 'FIRMADA', expediente: k.expediente, documento_ref: numeroOS ? `Orden de Servicio N.° ${numeroOS}` : `Ampliación de la Orden de Servicio N.° ${k.numero}` });
    VALIDADORES.adenda(ad);
    const r = await repo.crear('adenda', ad, { usuario: ctx.usuario, motivo: ctx.motivo || `Renovación de la Orden de Servicio de ${c.clave}`, origen: ctx.origen, consultor_id: c.consultor_id });
    await recalcularYGuardar(ctx.usuario, `Renovación de la Orden de Servicio de ${c.clave}`);
    return r;
  }

  /** Código del proyecto: PRY-AAAA-NNN, correlativo dentro del año (nunca se reutiliza ni se edita). */
  function codigoProyectoNuevo(d) {
    const anio = hoyLima().slice(0, 4);
    const usados = d.proyectos.map((p) => /^PRY-(\d{4})-(\d{3,})$/.exec(String(p.codigo))).filter((m) => m && m[1] === anio).map((m) => Number(m[2]));
    return `PRY-${anio}-${String(Math.max(0, ...usados) + 1).padStart(3, '0')}`;
  }

  async function crearEntidad(entidad, entrada, ctx) {
    if (!VALIDADORES[entidad]) throw error(400, 'Entidad no creable por esta vía');
    const d = await datos(true);
    const f = filtrarColumnas(entidad, entrada);
    // Proyecto nuevo: modalidad ORDEN_SERVICIO salvo que se indique otra (o, por compatibilidad, que se deduzca de las características enviadas)
    if (entidad === 'proyecto' && !f.modalidad) f.modalidad = BANDERAS_PROYECTO.some((k) => k in (entrada || {})) ? modalidadDe({ ...BANDERAS_DEFECTO, ...Object.fromEntries(BANDERAS_PROYECTO.filter((k) => k in f).map((k) => [k, f[k] ? 1 : 0])) }) : 'ORDEN_SERVICIO';
    VALIDADORES[entidad](f);
    if (entidad === 'adenda') {
      f.tipo_periodo = 'ADENDA'; // los periodos ORIGINAL y AMPLIACION de una OS los crea solo contrataciones.js
      const k = d.contratos.find((x) => x.contrato_id === Number(f.contrato_id));
      if (!k) throw error(400, 'Contrato no encontrado');
      if (!f.numero) f.numero = Math.max(0, ...d.adendas.filter((a) => a.contrato_id === k.contrato_id).map((a) => a.numero)) + 1;
      if (!f.estado) f.estado = 'EN_TRAMITE';
      if (!f.expediente) f.expediente = k.expediente;
      if (!f.fecha_fin && f.fecha_inicio && f.plazo_dias) f.fecha_fin = diaAFecha(aDia(f.fecha_inicio) + Number(f.plazo_dias) - 1); // el fin se calcula con el plazo otorgado
      if (d.adendas.some((a) => a.contrato_id === k.contrato_id && Number(a.numero) === Number(f.numero))) throw error(409, `La Adenda N.° ${f.numero} ya existe para este contrato`);
      if (!f.fecha_inicio || !f.fecha_fin) throw error(400, 'Inicio y fin de la adenda son obligatorios');
    }
    if (entidad === 'proyecto') {
      if (!f.nombre) throw error(400, 'El nombre del proyecto es obligatorio');
      f.codigo = codigoProyectoNuevo(d); // lo asigna el sistema: único, correlativo por año y no editable
      f.estado = f.estado || MODALIDADES[f.modalidad].estadoInicial;
    }
    if (entidad === 'plan_trabajo') {
      if (!f.consultor_id || !f.nombre) throw error(400, 'Consultor y nombre del plan son obligatorios');
      f.estado = f.estado || 'POR_REGISTRAR';
      f.tipo_dias = f.tipo_dias || 'CALENDARIO';
    }
    if (entidad === 'control_cambio') {
      if (!f.consultor_id || !f.titulo) throw error(400, 'Consultor y título son obligatorios');
      f.estado = f.estado || 'BORRADOR';
    }
    const consultor_id = entidad === 'proyecto' ? null : f.consultor_id ?? consultorDe(d, { contrato_id: f.contrato_id });
    const r = await repo.crear(entidad, f, { usuario: ctx.usuario, motivo: ctx.motivo, origen: ctx.origen, consultor_id });
    await recalcularYGuardar(ctx.usuario, `Nuevo registro en ${entidad}`);
    return r;
  }

  // ---------------------------------------------------------------- equipo de cada proyecto (db/15)
  // El Equipo de Desarrollo usa el perfil JEFE_PROYECTO (D1); cada proyecto tiene uno o más miembros y a lo más
  // un responsable. Solo el Administrador define los equipos (la ruta lo exige y permisos.js lo vuelve a impedir).
  async function proyectoVivo(d, proyecto_id) {
    const p = d.proyectos.find((x) => x.proyecto_id === Number(proyecto_id) && x.activo !== 0);
    if (!p) throw error(404, 'Proyecto no encontrado');
    return p;
  }

  /** Miembros activos del proyecto con el nombre y el correo de su cuenta. */
  async function equipoDe(proyecto_id) {
    const d = await datos();
    const usuarios = new Map((await repo.listarUsuarios()).map((u) => [u.usuario_id, u]));
    return (d.miembros || []).filter((m) => m.proyecto_id === Number(proyecto_id) && m.activo !== 0)
      .map((m) => { const u = usuarios.get(m.usuario_id) || {}; return { miembro_id: m.miembro_id, proyecto_id: m.proyecto_id, usuario_id: m.usuario_id, es_responsable: m.es_responsable ? 1 : 0, desde: m.desde, revision: m.revision, nombre: u.nombre || '(cuenta no encontrada)', correo: u.correo || null, rol: u.rol || null, cuenta_activa: u.activo ? 1 : 0 }; })
      .sort((a, b) => b.es_responsable - a.es_responsable || String(a.nombre).localeCompare(String(b.nombre)));
  }

  /** Deja a `miembro_id` como único responsable del proyecto (en la transacción `t`). */
  async function fijarResponsable(t, d, proyecto, miembro_id, ctx) {
    for (const m of (d.miembros || []).filter((x) => x.proyecto_id === proyecto.proyecto_id && x.activo !== 0 && x.es_responsable && x.miembro_id !== miembro_id)) {
      await t.actualizar('proyecto_miembro', m.miembro_id, { es_responsable: 0 }, { usuario: ctx.usuario, motivo: `Cambio de responsable del proyecto ${proyecto.codigo}`, origen: ctx.origen });
    }
  }

  async function agregarMiembro(proyecto_id, entrada, ctx) {
    const d = await datos(true);
    const proyecto = await proyectoVivo(d, proyecto_id);
    const u = await repo.buscarUsuarioId(Number((entrada || {}).usuario_id));
    if (!u) throw error(400, 'Seleccione la cuenta del Jefe de Proyecto');
    if (!u.activo) throw error(409, 'La cuenta está desactivada');
    if (u.rol !== 'JEFE_PROYECTO') throw error(400, 'Solo las cuentas con perfil Jefe de Proyecto forman el equipo de un proyecto (el Administrador ya escribe en todos)');
    if ((d.miembros || []).some((m) => m.proyecto_id === proyecto.proyecto_id && m.usuario_id === u.usuario_id && m.activo !== 0)) throw error(409, `${u.nombre} ya es parte del equipo de ${proyecto.codigo}`);
    const responsable = (entrada || {}).es_responsable ? 1 : 0;
    const r = await repo.transaccion(async (t) => {
      if (responsable) await fijarResponsable(t, d, proyecto, null, ctx);
      return t.crear('proyecto_miembro', { proyecto_id: proyecto.proyecto_id, usuario_id: u.usuario_id, es_responsable: responsable, desde: hoyLima() }, { usuario: ctx.usuario, motivo: ctx.motivo || `${u.nombre} se integra al equipo del proyecto ${proyecto.codigo}${responsable ? ' como responsable' : ''}`, origen: ctx.origen });
    });
    invalidar();
    return r;
  }

  async function actualizarMiembro(proyecto_id, miembro_id, entrada, ctx) {
    const d = await datos(true);
    const proyecto = await proyectoVivo(d, proyecto_id);
    const m = (d.miembros || []).find((x) => x.miembro_id === Number(miembro_id) && x.proyecto_id === proyecto.proyecto_id && x.activo !== 0);
    if (!m) throw error(404, 'Miembro del equipo no encontrado');
    const responsable = (entrada || {}).es_responsable ? 1 : 0;
    const r = await repo.transaccion(async (t) => {
      if (responsable) await fijarResponsable(t, d, proyecto, m.miembro_id, ctx);
      return t.actualizar('proyecto_miembro', m.miembro_id, { es_responsable: responsable }, { revision: (entrada || {}).revision, usuario: ctx.usuario, motivo: ctx.motivo || (responsable ? `Nuevo responsable del proyecto ${proyecto.codigo}` : `Deja de ser responsable del proyecto ${proyecto.codigo}`), origen: ctx.origen });
    });
    invalidar();
    return r;
  }

  /** Baja lógica del miembro (nada se borra). */
  async function quitarMiembro(proyecto_id, miembro_id, ctx) {
    const d = await datos(true);
    const proyecto = await proyectoVivo(d, proyecto_id);
    const m = (d.miembros || []).find((x) => x.miembro_id === Number(miembro_id) && x.proyecto_id === proyecto.proyecto_id && x.activo !== 0);
    if (!m) throw error(404, 'Miembro del equipo no encontrado');
    const r = await repo.actualizar('proyecto_miembro', m.miembro_id, { activo: 0, es_responsable: 0, hasta: hoyLima() }, { revision: ctx.revision, usuario: ctx.usuario, motivo: ctx.motivo || `Sale del equipo del proyecto ${proyecto.codigo}`, origen: ctx.origen, accion: 'ANULAR' });
    invalidar();
    return r;
  }

  // ---------------------------------------------------------------- lecturas
  // Subactividades: JSON [{ t, d, p, a }] (texto, días hábiles, producto, avance 0-100)
  const subsDe = (a) => { try { const x = JSON.parse((a && a.subactividades) || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } };
  const avanceDeSubs = (subs) => {
    const tot = subs.reduce((n, s) => n + (Number(s.d) || 1), 0);
    return tot ? Math.round(subs.reduce((n, s) => n + (Number(s.d) || 1) * (Number(s.a) || 0), 0) / tot * 100) / 100 : 0;
  };
  /** Subactividades con sus fechas (encadenadas en días hábiles dentro de la actividad) y su avance. */
  function subsConFechas(a, cal) {
    let cursor = aDia(a.inicio_plan);
    return subsDe(a).map((s, i) => {
      const ini = cal.siguienteLaborable(cursor); const fin = cal.finDesde(ini, s.d || 1); cursor = fin + 1;
      const av = Number(s.a) || 0;
      return { indice: i, texto: s.t, dias: s.d, producto: s.p || '', avance: av, estado: av >= 100 ? 'CONCLUIDA' : av > 0 ? 'EN_CURSO' : 'PENDIENTE', inicio_plan: diaAFecha(ini), fin_plan: diaAFecha(fin) };
    });
  }

  /** Avance de una subactividad: el de la actividad principal se recalcula (promedio ponderado por días). */
  async function actualizarSubactividad(id, indice, avance, revision, ctx) {
    const d = await datos(true);
    const previa = d.actividades.find((a) => a.actividad_id === Number(id));
    if (!previa) throw error(404, 'Actividad no encontrada');
    const subs = subsDe(previa);
    const k = Number(indice);
    if (!Number.isInteger(k) || k < 0 || k >= subs.length) throw error(404, 'Subactividad no encontrada');
    const av = Number(avance);
    if (Number.isNaN(av) || av < 0 || av > 100) throw error(400, 'El avance debe estar entre 0 y 100');
    subs[k] = { ...subs[k], a: Math.round(av * 100) / 100 };
    return actualizarActividad(id, { subactividades: JSON.stringify(subs), avance: avanceDeSubs(subs), revision }, ctx);
  }

  async function detalleConsultor(id, { verPersonales = false, corte } = {}) {
    const e = await estado({ corte });
    const d = await datos();
    const it = e.consultores.find((x) => x.consultor.consultor_id === Number(id));
    if (!it) throw error(404, 'Consultor no encontrado');
    const consultor = { ...it.consultor };
    if (!verPersonales) for (const k of ENTIDADES.consultor.personales) delete consultor[k];
    const cal = crearCalendario({ tipo: 'HABILES', feriados: d.feriados });
    const deps = it.plan ? d.dependencias.filter((x) => x.activo !== 0 && it.actividades.some((a) => a.actividad_id === x.actividad_id)) : [];
    return {
      corte: e.corte, metodo: e.metodo, consultor, contrato: it.contrato, contrataciones: it.contratos, entregables: it.entregables, semaforo_entregables: it.semaforo_entregables,
      adendas: [...it.adendas].sort((a, b) => a.numero - b.numero),
      plan: it.plan, pronostico: it.pronostico && { ...it.pronostico, actividades: undefined },
      vigencia: it.vigencia,
      cobertura: it.cobertura,
      actividades: [...it.actividades].sort((a, b) => a.orden - b.orden).map((a) => ({ ...a, subactividades: subsConFechas(a, cal), pronostico: it.pronostico ? it.pronostico.actividades[a.actividad_id] || null : null, predecesoras: deps.filter((x) => x.actividad_id === a.actividad_id).map((x) => ({ predecesora_id: x.predecesora_id, desfase_dias: x.desfase_dias })) })),
      linea_base: it.linea_base.map((lb) => ({ ...lb, cobertura: coberturaLineaBase(lb, d), actividades: d.actividades.filter((a) => a.entregable_id === lb.entregable_id && a.estado !== 'ANULADA').map((a) => a.numero) })),
      controles_cambio: (d.controles_cambio || []).filter((c) => c.consultor_id === Number(id)),
      alertas: e.alertas.filter((a) => a.consultor_id === Number(id)),
      historial_pronostico: it.plan ? await repo.historialPronostico(it.plan.plan_id) : [],
    };
  }

  async function lineaBase({ proyecto_id } = {}) {
    const d = await datos();
    const deProyecto = (lb) => { if (!proyecto_id) return true; const c = d.consultores.find((x) => x.consultor_id === lb.consultor_id); return !!c && c.proyecto_id === Number(proyecto_id); };
    return d.linea_base.filter(deProyecto).map((lb) => {
      const c = d.consultores.find((x) => x.consultor_id === lb.consultor_id);
      return { ...lb, clave: c && c.clave, nombres: c && c.nombres, cobertura: coberturaLineaBase(lb, d), actividades: d.actividades.filter((a) => a.entregable_id === lb.entregable_id && a.estado !== 'ANULADA').map((a) => ({ actividad_id: a.actividad_id, numero: a.numero, clave: c && c.clave })) };
    });
  }

  /**
   * Quita los datos personales (dni, telefono, correo_personal) de `cambios_json` en las filas
   * de bitácora. Sin `verPersonales` (rol distinto de ADMIN, o consumo por el modelo de IA)
   * los valores nunca salen del servidor. Devuelve copias; no modifica las filas originales.
   */
  /** Quita de la bitácora los datos personales (salvo ADMIN) y el monto de la OS a quien no es del equipo (`verMonto(fila)`). */
  function sanearBitacora(filas, { verPersonales = false, verMonto = () => true } = {}) {
    if (verPersonales) return filas;
    const personales = new Set(ENTIDADES.consultor.personales);
    const conMonto = new Set([...personales, ...ENTIDADES.contrato.confidenciales]);
    const limpiar = (v, prohibidas) => {
      if (Array.isArray(v)) return v.map((x) => limpiar(x, prohibidas));
      if (v && typeof v === 'object') {
        return Object.fromEntries(Object.entries(v).filter(([k]) => !prohibidas.has(k)).map(([k, x]) => [k, limpiar(x, prohibidas)]));
      }
      return v;
    };
    return filas.map((f) => {
      if (!f.cambios_json) return f;
      const prohibidas = verMonto(f) ? personales : conMonto;
      const texto = typeof f.cambios_json === 'string';
      let obj = f.cambios_json;
      if (texto) { try { obj = JSON.parse(f.cambios_json); } catch { return { ...f, cambios_json: null }; } }
      const limpio = limpiar(obj, prohibidas);
      return { ...f, cambios_json: texto ? JSON.stringify(limpio) : limpio };
    });
  }

  return {
    repo, datos, invalidar, estado, corteVigente, recalcularYGuardar, recalculoDiario,
    AREAS_TECNICAS, JEFES_PROYECTO, validarProfesionalNuevo, registrarProfesional, ampliarOrdenServicio, actualizarActividad, actualizarSubactividad, crearActividad, anularActividad, definirDependencias, simular, adoptarPronostico, revisarPlan,
    actualizarEntidad, crearEntidad, detalleConsultor, lineaBase, sanearBitacora,
    equipoDe, agregarMiembro, actualizarMiembro, quitarMiembro,
    consolidarActividad, aDia, subsDe, avanceDeSubs,
  };
}

module.exports = { crearServicio, ESTADOS_ACTIVIDAD, CLASIFICACIONES, ESTADOS_ADENDA, ESTADOS_PLAN, ESTADOS_CC };
