'use strict';
/**
 * Estado y semáforo de los entregables del TDR (criterio C2 y regla R-OS5 de PLAN_DE_MEJORAS.md). Funciones PURAS.
 *
 * Semáforo del entregable:
 *   ROJO   vencido sin presentar; observado con el plazo de subsanación vencido; o el fin probable de sus actividades
 *          supera la fecha límite.
 *   AMBAR  vence en UMBRAL_ENTREGABLE_DIAS días o menos y no se ha presentado; o su holgura es menor que ese umbral.
 *   VERDE  en plazo y con holgura suficiente.
 *   AZUL   presentado, en revisión o subsanado (espera la conformidad).
 *   GRIS   conforme o anulado (cerrado), o sin fecha límite (la OS aún no se notifica).
 * El semáforo de la contratación es el peor de sus entregables pendientes.
 * «Vencido» es un cálculo, no un estado que se guarda.
 */
const { aDia } = require('./calendario');

const PESO = { ROJO: 4, AMBAR: 3, AZUL: 2, VERDE: 1, GRIS: 0 };
const CERRADOS = ['CONFORME', 'ANULADO'];
const ENTREGADOS = ['PRESENTADO', 'EN_REVISION', 'SUBSANADO'];

/**
 * @param e          fila de sgf.entregable_servicio
 * @param corte      fecha de corte (AAAA-MM-DD)
 * @param umbral     días de anticipación para el aviso (UMBRAL_ENTREGABLE_DIAS)
 * @param finProbable fin probable de las actividades del plan que aportan al entregable (o null)
 */
function evaluarEntregable(e, { corte, umbral = 7, finProbable = null, plazoRevision = 7 }) {
  const hoy = aDia(corte);
  const r = { estado: e.estado, vencido: false, dias_para_vencer: null, dias_atraso: null, holgura_dias: null, semaforo: 'GRIS', motivo: null, dias_en_revision: null, revision_vencida: false };
  if (e.fecha_limite) r.dias_para_vencer = aDia(e.fecha_limite) - hoy;
  if (e.fecha_limite && e.fecha_presentacion && aDia(e.fecha_presentacion) > aDia(e.fecha_limite)) r.dias_atraso = aDia(e.fecha_presentacion) - aDia(e.fecha_limite);
  if (CERRADOS.includes(e.estado)) { r.motivo = e.estado === 'CONFORME' ? 'Conforme' : 'Anulado'; return r; }
  if (!e.fecha_limite) { r.motivo = 'Sin fecha límite: la Orden de Servicio aún no se notifica'; return r; }
  if (ENTREGADOS.includes(e.estado)) {
    // R-OS7: el equipo tiene PLAZO_REVISION_DIAS (calendario) para dar la conformidad u observar
    const desde = e.fecha_subsanacion || e.fecha_presentacion;
    r.semaforo = 'AZUL'; r.motivo = e.estado === 'SUBSANADO' ? 'Subsanado: espera la conformidad' : 'Presentado: espera la conformidad';
    if (desde) {
      r.dias_en_revision = hoy - aDia(desde);
      if (r.dias_en_revision > plazoRevision) { r.revision_vencida = true; r.motivo = `Sin conformidad ni observación hace ${r.dias_en_revision} días (plazo: ${plazoRevision})`; }
    }
    return r;
  }
  if (e.estado === 'OBSERVADO') {
    if (e.fecha_limite_subsanacion && aDia(e.fecha_limite_subsanacion) < hoy) { r.semaforo = 'ROJO'; r.motivo = 'Observado con el plazo de subsanación vencido'; return r; }
    r.semaforo = 'AMBAR'; r.motivo = 'Observado: en plazo de subsanación'; return r;
  }
  // PENDIENTE
  if (r.dias_para_vencer < 0) { r.vencido = true; r.dias_atraso = -r.dias_para_vencer; r.semaforo = 'ROJO'; r.motivo = `Vencido hace ${-r.dias_para_vencer} día(s) sin presentar`; return r; }
  if (finProbable) {
    r.holgura_dias = aDia(e.fecha_limite) - aDia(finProbable);
    if (r.holgura_dias < 0) { r.semaforo = 'ROJO'; r.motivo = `Las actividades terminarían ${-r.holgura_dias} día(s) después de la fecha límite`; return r; }
  }
  if (r.dias_para_vencer <= umbral) { r.semaforo = 'AMBAR'; r.motivo = r.dias_para_vencer === 0 ? 'Vence hoy' : `Vence en ${r.dias_para_vencer} día(s)`; return r; }
  if (r.holgura_dias !== null && r.holgura_dias < umbral) { r.semaforo = 'AMBAR'; r.motivo = `Holgura de ${r.holgura_dias} día(s) frente a la fecha límite`; return r; }
  r.semaforo = 'VERDE'; r.motivo = 'En plazo';
  return r;
}

/** El peor semáforo de una lista de entregables evaluados (GRIS si no hay pendientes). */
function peorSemaforo(evaluados) {
  return evaluados.reduce((peor, x) => (PESO[x.semaforo] > PESO[peor] ? x.semaforo : peor), 'GRIS');
}

/**
 * Avance de un entregable (R-OS8): conforme = 100; si no, el avance ponderado por duración de sus actividades
 * (las que tienen entregable_servicio_id), o 0 si no tiene actividades.
 */
function avanceEntregable(e, actividades) {
  if (e.estado === 'CONFORME') return 100;
  const hojas = actividades.filter((a) => a.entregable_servicio_id === e.entregable_servicio_id && !a.es_resumen && a.estado !== 'ANULADA');
  const peso = (a) => Math.max(1, Number(a.dias_plan) || (a.inicio_plan && a.fin_plan ? aDia(a.fin_plan) - aDia(a.inicio_plan) + 1 : 1));
  const tot = hojas.reduce((n, a) => n + peso(a), 0);
  return tot ? Math.round(hojas.reduce((n, a) => n + peso(a) * (Number(a.avance) || 0), 0) / tot * 100) / 100 : 0;
}

module.exports = { evaluarEntregable, peorSemaforo, avanceEntregable, PESO };
