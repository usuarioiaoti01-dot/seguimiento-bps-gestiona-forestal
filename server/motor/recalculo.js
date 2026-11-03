'use strict';
/**
 * Motor de recálculo de fechas probables de término.
 *
 * Reglas (documentadas también en docs/motor-recalculo.md):
 *  R1. Las actividades ANULADAS no participan. Las de resumen (p. ej. "2" con
 *      hijas "2.1", "2.2") toman inicio mínimo, fin máximo y avance ponderado.
 *  R2. Dependencias fin-inicio (FS) con desfase: la sucesora no puede empezar
 *      antes de fin_probable(predecesora) + 1 + desfase. El desfase se obtiene
 *      del plan formulado, de modo que sin cambios el plan se reproduce tal cual.
 *  R3. CONCLUIDA (o avance 100 %): fin probable = fin real (o fin del plan).
 *  R4. Sin iniciar: conserva su duración; si su inicio planificado ya pasó,
 *      se reprograma desde la fecha de corte.
 *  R5. Iniciada: lo que falta se proyecta desde el día siguiente al corte.
 *      LINEAL: faltante = duración × (1 − avance).
 *      RENDIMIENTO: faltante = duración × (1 − avance) / SPI, con
 *      SPI = avance / avance esperado propio, acotado a [SPI_MINIMO, 1.5].
 *  R6. Desvío = fin probable − fin del plan (días calendario).
 *  R7. Ruta crítica: actividades cuyo retraso mueve el fin probable del plan.
 */

const { aDia, aFecha, crearCalendario } = require('./calendario');

const SPI_MAXIMO = 1.5;

function ordenTopologico(ids, predecesoras) {
  const grado = new Map(ids.map((id) => [id, 0]));
  const sucesoras = new Map(ids.map((id) => [id, []]));
  for (const id of ids) {
    for (const dep of predecesoras.get(id) || []) {
      if (!grado.has(dep.predecesora_id)) continue;
      grado.set(id, grado.get(id) + 1);
      sucesoras.get(dep.predecesora_id).push(id);
    }
  }
  const cola = ids.filter((id) => grado.get(id) === 0);
  const orden = [];
  while (cola.length) {
    const id = cola.shift();
    orden.push(id);
    for (const s of sucesoras.get(id)) {
      grado.set(s, grado.get(s) - 1);
      if (grado.get(s) === 0) cola.push(s);
    }
  }
  if (orden.length !== ids.length) {
    const enCiclo = ids.filter((id) => !orden.includes(id));
    const err = new Error(`Las dependencias forman un ciclo entre las actividades ${enCiclo.join(', ')}`);
    err.codigo = 'CICLO_DEPENDENCIAS';
    err.actividades = enCiclo;
    throw err;
  }
  return orden;
}

/**
 * @param {object} p
 * @param {object} p.plan            { plan_id, tipo_dias }
 * @param {object[]} p.actividades   actividades del plan
 * @param {object[]} p.dependencias  dependencias (cualquier plan; se filtran)
 * @param {string[]|object[]} p.feriados
 * @param {string} p.corte           'AAAA-MM-DD'
 * @param {string} [p.metodo]        'RENDIMIENTO' | 'LINEAL'
 * @param {number} [p.spiMinimo]
 */
function recalcularPlan({ plan, actividades, dependencias = [], feriados = [], corte, metodo = 'RENDIMIENTO', spiMinimo = 0.4 }) {
  const cal = crearCalendario({ tipo: plan.tipo_dias || 'CALENDARIO', feriados });
  const hoy = aDia(corte);
  const vivas = actividades.filter((a) => a.activo !== 0 && a.activo !== false && a.estado !== 'ANULADA');
  const resumenes = vivas.filter((a) => a.es_resumen);
  const hojas = vivas.filter((a) => !a.es_resumen);
  const ids = hojas.map((a) => a.actividad_id);
  const porId = new Map(hojas.map((a) => [a.actividad_id, a]));

  const predecesoras = new Map();
  for (const d of dependencias) {
    if (d.activo === 0 || d.activo === false) continue;
    if (!porId.has(d.actividad_id) || !porId.has(d.predecesora_id)) continue;
    if (!predecesoras.has(d.actividad_id)) predecesoras.set(d.actividad_id, []);
    predecesoras.get(d.actividad_id).push(d);
  }

  const orden = ordenTopologico(ids, predecesoras);
  const r = new Map(); // actividad_id -> resultado interno (días numéricos)

  for (const id of orden) {
    const a = porId.get(id);
    const iniPlan = aDia(a.inicio_plan);
    const finPlan = aDia(a.fin_plan);
    const dur = cal.duracion(iniPlan, finPlan);
    const avance = Math.max(0, Math.min(100, Number(a.avance) || 0));
    const p = avance / 100;

    let esperado;
    if (hoy < iniPlan) esperado = 0;
    else if (hoy >= finPlan) esperado = 100;
    else esperado = (cal.duracion(iniPlan, hoy) / dur) * 100;

    // R2: inicio más temprano por predecesoras
    let inicioMinimo = null;
    for (const dep of predecesoras.get(id) || []) {
      const pr = r.get(dep.predecesora_id);
      const desde = cal.desplazar(pr.fin, 1 + (Number(dep.desfase_dias) || 0));
      inicioMinimo = inicioMinimo === null ? desde : Math.max(inicioMinimo, desde);
    }

    let ini;
    let fin;
    let situacion;
    const iniReal = aDia(a.inicio_real);
    const finReal = aDia(a.fin_real);
    const iniciada = iniReal !== null || avance > 0 || a.estado === 'EN_CURSO' || a.estado === 'SUSPENDIDA';

    if (a.estado === 'CONCLUIDA' || avance >= 100) {
      // R3
      ini = iniReal ?? iniPlan;
      fin = finReal ?? Math.min(finPlan, Math.max(ini, hoy));
      situacion = 'CONCLUIDA';
    } else if (!iniciada) {
      // R4
      ini = Math.max(iniPlan, inicioMinimo ?? iniPlan);
      if (ini < hoy) ini = hoy;
      ini = cal.siguienteLaborable(ini);
      fin = cal.finDesde(ini, dur);
      situacion = iniPlan < hoy ? 'SIN_INICIAR_VENCIDA' : 'PROGRAMADA';
    } else {
      // R5
      ini = iniReal ?? iniPlan;
      const transcurrido = ini <= hoy ? cal.duracion(ini, hoy) : 0;
      let faltante = dur * (1 - p);
      if (metodo === 'RENDIMIENTO' && p > 0 && transcurrido > 0) {
        const esperadoPropio = Math.min(1, transcurrido / dur);
        const spi = Math.max(spiMinimo, Math.min(SPI_MAXIMO, p / esperadoPropio));
        faltante /= spi;
      } else if (metodo === 'RENDIMIENTO' && p === 0 && transcurrido > 0) {
        faltante = dur; // iniciada sin avance: queda toda la duración
      }
      faltante = Math.ceil(faltante - 1e-9);
      if (a.estado === 'SUSPENDIDA') situacion = 'SUSPENDIDA';
      if (faltante <= 0) {
        fin = Math.max(ini, hoy);
      } else {
        const base = Math.max(ini, hoy + 1);
        fin = cal.finDesde(base, faltante);
      }
      if (!situacion) situacion = fin > finPlan ? 'ATRASADA' : 'EN_PLAZO';
    }

    r.set(id, { ini, fin, iniPlan, finPlan, dur, avance, esperado, situacion });
  }

  // R7: ruta crítica (hacia atrás desde las de fin máximo)
  const finesHojas = [...r.values()].map((x) => x.fin);
  const finProbablePlan = finesHojas.length ? Math.max(...finesHojas) : null;
  const critica = new Set();
  const pila = [...r.entries()].filter(([, x]) => x.fin === finProbablePlan && x.situacion !== 'CONCLUIDA').map(([id]) => id);
  while (pila.length) {
    const id = pila.pop();
    if (critica.has(id)) continue;
    critica.add(id);
    for (const dep of predecesoras.get(id) || []) {
      const pr = r.get(dep.predecesora_id);
      if (pr.situacion === 'CONCLUIDA') continue;
      if (cal.desplazar(pr.fin, 1 + (Number(dep.desfase_dias) || 0)) >= r.get(id).ini) pila.push(dep.predecesora_id);
    }
  }

  // R1: resúmenes
  for (const s of resumenes) {
    const hijas = vivas.filter((h) => h.plan_id === s.plan_id && !h.es_resumen && String(h.numero).startsWith(`${s.numero}.`));
    const rs = hijas.map((h) => r.get(h.actividad_id)).filter(Boolean);
    if (!rs.length) {
      const iniPlan = aDia(s.inicio_plan);
      const finPlan = aDia(s.fin_plan);
      r.set(s.actividad_id, { ini: iniPlan, fin: finPlan, iniPlan, finPlan, dur: cal.duracion(iniPlan, finPlan), avance: Number(s.avance) || 0, esperado: 0, situacion: 'PROGRAMADA', resumen: true });
      continue;
    }
    const peso = rs.reduce((t, x) => t + x.dur, 0);
    const av = rs.reduce((t, x) => t + x.dur * x.avance, 0) / peso;
    const es = rs.reduce((t, x) => t + x.dur * x.esperado, 0) / peso;
    const fin = Math.max(...rs.map((x) => x.fin));
    const finPlan = aDia(s.fin_plan);
    r.set(s.actividad_id, {
      ini: Math.min(...rs.map((x) => x.ini)), fin, iniPlan: aDia(s.inicio_plan), finPlan,
      dur: peso, avance: av, esperado: es, resumen: true,
      situacion: rs.every((x) => x.situacion === 'CONCLUIDA') ? 'CONCLUIDA' : fin > finPlan ? 'ATRASADA' : 'EN_PLAZO',
    });
  }

  const actividadesR = {};
  for (const [id, x] of r) {
    actividadesR[id] = {
      actividad_id: id,
      inicio_probable: aFecha(x.ini),
      fin_probable: aFecha(x.fin),
      desvio_dias: x.fin - x.finPlan,
      avance_esperado: Math.round(x.esperado * 100) / 100,
      situacion: x.situacion,
      critica: critica.has(id),
      duracion: x.dur,
    };
  }

  const hs = [...r.entries()].filter(([id]) => porId.has(id)).map(([, x]) => x);
  const peso = hs.reduce((t, x) => t + x.dur, 0);
  const avancePond = peso ? hs.reduce((t, x) => t + x.dur * x.avance, 0) / peso : 0;
  const esperadoPond = peso ? hs.reduce((t, x) => t + x.dur * x.esperado, 0) / peso : 0;

  return {
    plan_id: plan.plan_id,
    fecha_corte: corte,
    metodo,
    tipo_dias: cal.tipo,
    inicio_plan: hs.length ? aFecha(Math.min(...hs.map((x) => x.iniPlan))) : null,
    fin_plan: hs.length ? aFecha(Math.max(...hs.map((x) => x.finPlan))) : null,
    fin_probable: aFecha(finProbablePlan),
    avance_ponderado: Math.round(avancePond * 100) / 100,
    avance_esperado: Math.round(esperadoPond * 100) / 100,
    spi: esperadoPond > 0 ? Math.round((avancePond / esperadoPond) * 1000) / 1000 : null,
    actividades: actividadesR,
    numero_actividades: hs.length,
  };
}

/**
 * Vigencia contractual frente al pronóstico del plan.
 * @param {object[]} adendas del contrato del consultor
 */
function evaluarVigencia({ adendas = [], pronostico, corte, umbralHolgura = 5 }) {
  const hoy = aDia(corte);
  const vivas = adendas.filter((a) => a.activo !== 0 && a.activo !== false && a.estado !== 'ANULADA');
  const firmadas = vivas.filter((a) => a.estado === 'FIRMADA').sort((x, y) => aDia(y.fecha_fin) - aDia(x.fecha_fin));
  const vigente = firmadas[0] || null;
  const siguiente = vivas
    .filter((a) => (a.estado === 'ANUNCIADA' || a.estado === 'EN_TRAMITE') && (!vigente || a.numero > vigente.numero))
    .sort((x, y) => y.numero - x.numero)[0] || null;
  const finVig = vigente ? aDia(vigente.fecha_fin) : null;
  const finProb = pronostico && pronostico.fin_probable ? aDia(pronostico.fin_probable) : null;
  const holgura = finVig !== null && finProb !== null ? finVig - finProb : null;
  const finPot = siguiente ? aDia(siguiente.fecha_fin) : null;
  const holguraPotencial = finPot !== null && finProb !== null ? finPot - finProb : null;

  let semaforo = 'GRIS';
  if (finVig !== null && hoy > finVig) semaforo = 'ROJO';
  else if (holgura !== null) semaforo = holgura < 0 ? 'ROJO' : holgura < umbralHolgura ? 'AMBAR' : 'VERDE';

  return {
    adenda_vigente: vigente,
    adenda_siguiente: siguiente,
    fin_vigencia: vigente ? vigente.fecha_fin : null,
    dias_restantes: finVig !== null ? finVig - hoy : null,
    holgura_dias: holgura,
    fin_vigencia_potencial: siguiente ? siguiente.fecha_fin : null,
    holgura_potencial_dias: holguraPotencial,
    semaforo,
  };
}

module.exports = { recalcularPlan, evaluarVigencia, ordenTopologico };
