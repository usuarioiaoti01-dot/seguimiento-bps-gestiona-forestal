'use strict';
/**
 * Lógica de negocio compartida por la API y el asistente de IA.
 * Todas las escrituras pasan por aquí: validan, aplican reglas de
 * consistencia, registran bitácora (vía repositorio) y disparan el recálculo.
 */
const { aDia, hoyLima } = require('./motor/calendario');
const { recalcularPlan } = require('./motor/recalculo');
const { construirEstado, coberturaLineaBase, parametro } = require('./motor/estado');
const { ENTIDADES, filtrarColumnas } = require('./datos/entidades');

const ESTADOS_ACTIVIDAD = ['PENDIENTE', 'EN_CURSO', 'CONCLUIDA', 'SUSPENDIDA', 'ANULADA'];
const CLASIFICACIONES = ['ALINEADA', 'REASIGNADA', 'NUEVA', 'TRANSVERSAL'];
const ESTADOS_ADENDA = ['ANUNCIADA', 'EN_TRAMITE', 'FIRMADA', 'ANULADA'];
const ESTADOS_PLAN = ['POR_REGISTRAR', 'RECIBIDO', 'OBSERVADO', 'APROBADO'];
const ESTADOS_CC = ['BORRADOR', 'APROBADO', 'RECHAZADO'];

const error = (estado, mensaje, extra = {}) => Object.assign(new Error(mensaje), { estado, ...extra });
const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

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

  async function estado({ corte } = {}) {
    const d = await datos();
    return construirEstado(d, { corte: esFecha(corte) ? corte : await corteVigente() });
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
    },
    plan_trabajo: (f, previa = {}) => {
      validarFechas(f, ['fecha_recepcion']);
      const m = { ...previa, ...f };
      if (m.estado && !ESTADOS_PLAN.includes(m.estado)) throw error(400, 'Estado de plan no válido');
      if (m.tipo_dias && !['CALENDARIO', 'HABILES'].includes(m.tipo_dias)) throw error(400, 'Tipo de días no válido');
    },
    control_cambio: (f, previa = {}) => {
      validarFechas(f, ['fecha']);
      const m = { ...previa, ...f };
      if (m.estado && !ESTADOS_CC.includes(m.estado)) throw error(400, 'Estado de control de cambios no válido');
    },
    linea_base_entregable: (f) => validarFechas(f, ['inicio_lb', 'fin_lb', 'fecha_corte_lb']),
    contrato: (f) => validarFechas(f, ['fecha_inicio']),
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
    VALIDADORES[entidad](f, previa);
    const consultor_id = entidad === 'consultor' ? Number(id) : previa.consultor_id ?? consultorDe(d, { contrato_id: previa.contrato_id });
    const r = await repo.actualizar(entidad, id, f, { revision: entrada.revision, usuario: ctx.usuario, motivo: ctx.motivo, origen: ctx.origen, consultor_id });
    await recalcularYGuardar(ctx.usuario, `Cambio en ${entidad} ${id}`);
    return r;
  }

  async function crearEntidad(entidad, entrada, ctx) {
    if (!VALIDADORES[entidad]) throw error(400, 'Entidad no creable por esta vía');
    const d = await datos(true);
    const f = filtrarColumnas(entidad, entrada);
    VALIDADORES[entidad](f);
    if (entidad === 'adenda') {
      const k = d.contratos.find((x) => x.contrato_id === Number(f.contrato_id));
      if (!k) throw error(400, 'Contrato no encontrado');
      if (!f.numero) f.numero = Math.max(0, ...d.adendas.filter((a) => a.contrato_id === k.contrato_id).map((a) => a.numero)) + 1;
      if (!f.estado) f.estado = 'EN_TRAMITE';
      if (!f.expediente) f.expediente = k.expediente;
      if (d.adendas.some((a) => a.contrato_id === k.contrato_id && Number(a.numero) === Number(f.numero))) throw error(409, `La Adenda N.° ${f.numero} ya existe para este contrato`);
      if (!f.fecha_inicio || !f.fecha_fin) throw error(400, 'Inicio y fin de la adenda son obligatorios');
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
    const consultor_id = f.consultor_id ?? consultorDe(d, { contrato_id: f.contrato_id });
    const r = await repo.crear(entidad, f, { usuario: ctx.usuario, motivo: ctx.motivo, origen: ctx.origen, consultor_id });
    await recalcularYGuardar(ctx.usuario, `Nuevo registro en ${entidad}`);
    return r;
  }

  // ---------------------------------------------------------------- lecturas
  async function detalleConsultor(id, { verPersonales = false, corte } = {}) {
    const e = await estado({ corte });
    const d = await datos();
    const it = e.consultores.find((x) => x.consultor.consultor_id === Number(id));
    if (!it) throw error(404, 'Consultor no encontrado');
    const consultor = { ...it.consultor };
    if (!verPersonales) for (const k of ENTIDADES.consultor.personales) delete consultor[k];
    const deps = it.plan ? d.dependencias.filter((x) => x.activo !== 0 && it.actividades.some((a) => a.actividad_id === x.actividad_id)) : [];
    return {
      corte: e.corte, metodo: e.metodo, consultor, contrato: it.contrato,
      adendas: [...it.adendas].sort((a, b) => a.numero - b.numero),
      plan: it.plan, pronostico: it.pronostico && { ...it.pronostico, actividades: undefined },
      vigencia: it.vigencia,
      actividades: [...it.actividades].sort((a, b) => a.orden - b.orden).map((a) => ({ ...a, pronostico: it.pronostico ? it.pronostico.actividades[a.actividad_id] || null : null, predecesoras: deps.filter((x) => x.actividad_id === a.actividad_id).map((x) => ({ predecesora_id: x.predecesora_id, desfase_dias: x.desfase_dias })) })),
      linea_base: it.linea_base.map((lb) => ({ ...lb, cobertura: coberturaLineaBase(lb, d), actividades: d.actividades.filter((a) => a.entregable_id === lb.entregable_id && a.estado !== 'ANULADA').map((a) => a.numero) })),
      controles_cambio: (d.controles_cambio || []).filter((c) => c.consultor_id === Number(id)),
      alertas: e.alertas.filter((a) => a.consultor_id === Number(id)),
      historial_pronostico: it.plan ? await repo.historialPronostico(it.plan.plan_id) : [],
    };
  }

  async function lineaBase() {
    const d = await datos();
    return d.linea_base.map((lb) => {
      const c = d.consultores.find((x) => x.consultor_id === lb.consultor_id);
      return { ...lb, clave: c && c.clave, nombres: c && c.nombres, cobertura: coberturaLineaBase(lb, d), actividades: d.actividades.filter((a) => a.entregable_id === lb.entregable_id && a.estado !== 'ANULADA').map((a) => ({ actividad_id: a.actividad_id, numero: a.numero, clave: c && c.clave })) };
    });
  }

  /**
   * Quita los datos personales (dni, telefono, correo_personal) de `cambios_json` en las filas
   * de bitácora. Sin `verPersonales` (rol distinto de ADMIN, o consumo por el modelo de IA)
   * los valores nunca salen del servidor. Devuelve copias; no modifica las filas originales.
   */
  function sanearBitacora(filas, { verPersonales = false } = {}) {
    if (verPersonales) return filas;
    const prohibidas = new Set(ENTIDADES.consultor.personales);
    const limpiar = (v) => {
      if (Array.isArray(v)) return v.map(limpiar);
      if (v && typeof v === 'object') {
        return Object.fromEntries(Object.entries(v).filter(([k]) => !prohibidas.has(k)).map(([k, x]) => [k, limpiar(x)]));
      }
      return v;
    };
    return filas.map((f) => {
      if (!f.cambios_json) return f;
      const texto = typeof f.cambios_json === 'string';
      let obj = f.cambios_json;
      if (texto) { try { obj = JSON.parse(f.cambios_json); } catch { return { ...f, cambios_json: null }; } }
      const limpio = limpiar(obj);
      return { ...f, cambios_json: texto ? JSON.stringify(limpio) : limpio };
    });
  }

  return {
    repo, datos, invalidar, estado, corteVigente, recalcularYGuardar, recalculoDiario,
    actualizarActividad, crearActividad, anularActividad, definirDependencias, simular, adoptarPronostico,
    actualizarEntidad, crearEntidad, detalleConsultor, lineaBase, sanearBitacora,
    consolidarActividad, aDia,
  };
}

module.exports = { crearServicio, ESTADOS_ACTIVIDAD, CLASIFICACIONES, ESTADOS_ADENDA, ESTADOS_PLAN, ESTADOS_CC };
