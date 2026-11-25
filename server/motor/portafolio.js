'use strict';
/**
 * Tablero general: todos los proyectos (en curso y terminados) con sus cifras (Etapa 4 de PLAN_DE_MEJORAS.md, §8).
 * Función PURA: recibe la foto de los datos y el estado ya calculado (construirEstado, sin filtro de proyecto) y
 * devuelve el portafolio. No toca la base. El monto se devuelve siempre: el servidor lo quita a quien no lo puede ver.
 *
 * Avance del proyecto (R-OS8):
 *   ORDEN_SERVICIO    promedio de sus OS (en ejecución o culminadas) ponderado por monto (o partes iguales si no hay);
 *                     avance de una OS = avance de sus entregables ponderado por % de pago (o partes iguales).
 *   CONTRATO_ADENDAS  avance ponderado de los planes de trabajo (el del motor de recálculo).
 *   GESTION_INTERNA   sin avance calculado.
 * Semáforo del proyecto: el peor entre el de sus entregables pendientes y el de la vigencia de sus profesionales activos
 * (ROJO > ÁMBAR > VERDE > AZUL > GRIS).
 * Resumen: además de los conteos, avance_promedio (promedio simple de los proyectos en curso con avance) y el ciclo de
 * la OS (registradas, en ejecución, entregables en revisión, observados y conformes, OS culminadas) para el tablero.
 */
const { aDia, crearCalendario } = require('./calendario');
const { parametro } = require('./estado');

const PESO = { ROJO: 4, AMBAR: 3, VERDE: 2, AZUL: 1, GRIS: 0 };
const EN_CURSO = ['REGISTRADO', 'EN_EJECUCION', 'SUSPENDIDO'];
const TERMINADOS = ['CONCLUIDO', 'CERRADO'];
const EN_REVISION = ['PRESENTADO', 'EN_REVISION', 'SUBSANADO']; // entregables presentados que esperan la conformidad del equipo
const peor = (lista) => lista.reduce((p, s) => ((PESO[s] ?? 0) > (PESO[p] ?? 0) ? s : p), 'GRIS');
const redondear = (n) => Math.round(n * 100) / 100;
const vivo = (x) => x && x.activo !== 0 && x.activo !== false;

/** Año del proyecto: el del código PRY-AAAA-NNN, o el de su inicio previsto. */
function anioDe(p) {
  const m = /^PRY-(\d{4})-/.exec(String(p.codigo || ''));
  if (m) return Number(m[1]);
  return p.fecha_inicio ? Number(String(p.fecha_inicio).slice(0, 4)) : null;
}

function avanceOS(entregables) {
  if (!entregables.length) return null;
  const conPct = entregables.every((e) => e.porcentaje_pago !== null && e.porcentaje_pago !== undefined && Number(e.porcentaje_pago) > 0);
  const peso = (e) => (conPct ? Number(e.porcentaje_pago) : 1);
  const tot = entregables.reduce((n, e) => n + peso(e), 0);
  return tot ? redondear(entregables.reduce((n, e) => n + peso(e) * (Number(e.avance) || 0), 0) / tot) : 0;
}

/**
 * @param datos  foto de la base (servicio.datos)
 * @param estado resultado de construirEstado(datos, { corte }) SIN proyecto_id
 * @param equipos { [proyecto_id]: [{ nombre, es_responsable }] }
 */
function construirPortafolio(datos, estado, { equipos = {} } = {}) {
  const corte = estado.corte;
  const hoy = aDia(corte);
  const anioCorte = Number(String(corte).slice(0, 4));
  const umbralSinParte = Number(parametro(datos, 'UMBRAL_SIN_PARTE_DIAS', 3));
  const umbralVigencia = Number(estado.umbralVigencia ?? parametro(datos, 'UMBRAL_VIGENCIA_DIAS', 15));
  const habiles = crearCalendario({ tipo: 'HABILES', feriados: (datos.feriados || []).map((f) => f.fecha) });
  const proyectos = (datos.proyectos || []).filter(vivo);

  const filas = proyectos.map((p) => {
    const items = estado.consultores.filter((it) => it.consultor.proyecto_id === p.proyecto_id);
    const modalidad = p.modalidad || (p.con_profesionales === 0 ? 'GESTION_INTERNA' : p.con_adendas === 1 ? 'CONTRATO_ADENDAS' : 'ORDEN_SERVICIO');
    const contratos = items.flatMap((it) => it.contratos || []);
    const os = contratos.filter((k) => k.tipo_documento === 'ORDEN_SERVICIO');
    const entregables = items.flatMap((it) => it.entregables || []);
    const pendientes = entregables.filter((e) => !['CONFORME', 'ANULADO'].includes(e.estado));

    // avance
    let avance = null;
    if (modalidad === 'ORDEN_SERVICIO') {
      const contadas = os.filter((k) => ['EN_EJECUCION', 'CULMINADA'].includes(k.estado_contratacion));
      const conMonto = contadas.length && contadas.every((k) => Number(k.monto) > 0);
      const avances = contadas.map((k) => ({ k, a: avanceOS(entregables.filter((e) => e.contrato_id === k.contrato_id)) })).filter((x) => x.a !== null);
      const tot = avances.reduce((n, x) => n + (conMonto ? Number(x.k.monto) : 1), 0);
      avance = tot ? redondear(avances.reduce((n, x) => n + (conMonto ? Number(x.k.monto) : 1) * x.a, 0) / tot) : (contadas.length ? 0 : null);
    } else if (modalidad === 'CONTRATO_ADENDAS') {
      const conPlan = items.filter((it) => it.pronostico && it.pronostico.numero_actividades);
      const tot = conPlan.reduce((n, it) => n + it.pronostico.numero_actividades, 0);
      avance = tot ? redondear(conPlan.reduce((n, it) => n + it.pronostico.numero_actividades * (Number(it.pronostico.avance_ponderado) || 0), 0) / tot) : null;
    }

    // semáforo
    const activos = items.filter((it) => it.consultor.estado === 'ACTIVO');
    const semaforo = TERMINADOS.includes(p.estado) || ['ANULADO'].includes(p.estado) ? 'GRIS'
      : peor([...activos.map((it) => it.semaforo_entregables || 'GRIS'), ...activos.map((it) => (it.vigencia && it.vigencia.semaforo) || 'GRIS')]);

    // próximo entregable (incluye los vencidos sin presentar, que van primero)
    const proximo = pendientes.filter((e) => e.fecha_limite).sort((a, b) => a.fecha_limite.localeCompare(b.fecha_limite))[0] || null;
    const itemDe = (e) => items.find((it) => (it.contratos || []).some((k) => k.contrato_id === e.contrato_id));

    // supervisión: último parte del proyecto
    const ultimoParte = items.map((it) => it.ultimo_parte).filter(Boolean).sort().pop() || null;
    const enEjecucion = os.filter((k) => k.estado_contratacion === 'EN_EJECUCION' && k.fecha_inicio && k.fecha_inicio <= corte);
    let diasSinParte = null;
    if (modalidad === 'ORDEN_SERVICIO' && p.estado === 'EN_EJECUCION' && enEjecucion.length) {
      const inicio = enEjecucion.map((k) => k.fecha_inicio).sort()[0];
      const ref = ultimoParte && ultimoParte >= inicio ? aDia(ultimoParte) + 1 : aDia(inicio);
      diasSinParte = ref <= hoy ? habiles.duracion(ref, hoy) : 0;
    }

    // montos (el servidor los quita a quien no puede verlos)
    // monto comprometido: toda OS emitida y no anulada (también las resueltas)
    const montoComprometido = os.filter((k) => k.estado_contratacion !== 'ANULADA').reduce((n, k) => n + (Number(k.monto) || 0), 0);
    const montoConforme = os.reduce((n, k) => {
      const ents = entregables.filter((e) => e.contrato_id === k.contrato_id && e.estado === 'CONFORME');
      return n + ents.reduce((m, e) => m + (Number(k.monto) || 0) * (Number(e.porcentaje_pago) || 0) / 100, 0);
    }, 0);
    const finTerminado = p.fecha_cierre || os.map((k) => k.fecha_culminacion).filter(Boolean).sort().pop() || null;
    const alertas = estado.alertas.filter((a) => items.some((it) => it.consultor.consultor_id === a.consultor_id));
    const equipo = equipos[p.proyecto_id] || [];

    return {
      proyecto_id: p.proyecto_id, codigo: p.codigo, nombre: p.nombre, modalidad, es_atipico: p.es_atipico ? 1 : 0, estado: p.estado,
      area_tecnica: p.area_tecnica || null, unidad_usuaria: p.unidad_usuaria || null, anio: anioDe(p),
      responsable: (equipo.find((m) => m.es_responsable) || {}).nombre || null, equipo: equipo.map((m) => m.nombre),
      en_curso: EN_CURSO.includes(p.estado), terminado: TERMINADOS.includes(p.estado), fin_terminado: finTerminado,
      profesionales: items.length, profesionales_activos: activos.length,
      os_total: os.length, os_en_ejecucion: os.filter((k) => k.estado_contratacion === 'EN_EJECUCION').length,
      os_sin_notificar: os.filter((k) => k.estado_contratacion === 'REGISTRADA').length, os_culminadas: os.filter((k) => k.estado_contratacion === 'CULMINADA').length,
      avance, semaforo,
      entregables: { total: entregables.length, pendientes: pendientes.length, vencidos: pendientes.filter((e) => e.vencido).length,
        por_vencer: pendientes.filter((e) => e.estado === 'PENDIENTE' && !e.vencido && e.semaforo === 'AMBAR').length,
        revision_vencida: entregables.filter((e) => e.revision_vencida).length, conformes: entregables.filter((e) => e.estado === 'CONFORME').length,
        en_revision: entregables.filter((e) => EN_REVISION.includes(e.estado)).length, observados: entregables.filter((e) => e.estado === 'OBSERVADO').length },
      proximo_entregable: proximo && { numero: proximo.numero, nombre: proximo.nombre, fecha_limite: proximo.fecha_limite, dias: aDia(proximo.fecha_limite) - hoy, semaforo: proximo.semaforo, motivo: proximo.motivo, profesional: (itemDe(proximo) || { consultor: {} }).consultor.nombres || null },
      vencen_15_dias: items.filter((it) => it.consultor.estado === 'ACTIVO' && it.vigencia && it.vigencia.dias_restantes !== null && it.vigencia.dias_restantes >= 0 && it.vigencia.dias_restantes <= umbralVigencia).length,
      ultimo_parte: ultimoParte, dias_sin_parte: diasSinParte, sin_parte: diasSinParte !== null && diasSinParte > umbralSinParte,
      alertas: { total: alertas.length, altas: alertas.filter((a) => a.prioridad === 'ALTA').length },
      monto_comprometido: redondear(montoComprometido), monto_conforme: redondear(montoConforme),
      // línea de tiempo: una barra por OS en ejecución, con sus entregables como hitos
      linea: items.flatMap((it) => (it.contratos || []).filter((k) => k.tipo_documento === 'ORDEN_SERVICIO' && k.estado_contratacion === 'EN_EJECUCION' && k.fecha_inicio && k.fecha_fin).map((k) => ({
        contrato_id: k.contrato_id, numero: k.numero, profesional: it.consultor.nombres, inicio: k.fecha_inicio, fin: k.fecha_fin,
        hitos: (it.entregables || []).filter((e) => e.contrato_id === k.contrato_id && e.fecha_limite).map((e) => ({ numero: e.numero, nombre: e.nombre, fecha: e.fecha_limite, estado: e.estado, semaforo: e.semaforo })),
      }))),
    };
  });

  const enCurso = filas.filter((f) => f.en_curso);
  const conAvance = enCurso.filter((f) => f.avance !== null && f.avance !== undefined);
  const suma = (k) => filas.reduce((n, f) => n + f.entregables[k], 0);
  const resumen = {
    corte,
    proyectos: filas.length,
    en_curso: enCurso.length,
    terminados: filas.filter((f) => f.terminado).length,
    terminados_anio: filas.filter((f) => f.terminado && (!f.fin_terminado || Number(String(f.fin_terminado).slice(0, 4)) === anioCorte)).length,
    os_en_ejecucion: filas.reduce((n, f) => n + f.os_en_ejecucion, 0),
    os_sin_notificar: filas.reduce((n, f) => n + f.os_sin_notificar, 0),
    entregables_por_vencer: filas.reduce((n, f) => n + f.entregables.por_vencer, 0),
    entregables_vencidos: filas.reduce((n, f) => n + f.entregables.vencidos, 0),
    conformidades_fuera_de_plazo: filas.reduce((n, f) => n + f.entregables.revision_vencida, 0),
    vencen_15_dias: filas.reduce((n, f) => n + f.vencen_15_dias, 0),
    sin_parte: filas.filter((f) => f.sin_parte).length,
    semaforo: { ROJO: enCurso.filter((f) => f.semaforo === 'ROJO').length, AMBAR: enCurso.filter((f) => f.semaforo === 'AMBAR').length, VERDE: enCurso.filter((f) => ['VERDE', 'AZUL'].includes(f.semaforo)).length, GRIS: enCurso.filter((f) => f.semaforo === 'GRIS').length },
    // promedio simple del avance de los proyectos en curso que lo tienen calculado (gestión interna no cuenta)
    avance_promedio: conAvance.length ? Math.round((conAvance.reduce((n, f) => n + f.avance, 0) / conAvance.length) * 10) / 10 : null,
    // ciclo de la Orden de Servicio: registrada → en ejecución → entregables en revisión → conformes → culminada
    os_culminadas: filas.reduce((n, f) => n + f.os_culminadas, 0),
    entregables_pendientes: suma('pendientes'), entregables_en_revision: suma('en_revision'), entregables_observados: suma('observados'), entregables_conformes: suma('conformes'),
  };
  return { resumen, proyectos: filas };
}

/** Suma de montos solo de los proyectos que el usuario puede ver (los demás llegan sin monto). */
function totalesMonto(filas) {
  const visibles = filas.filter((f) => f.monto_comprometido !== undefined && f.monto_comprometido !== null);
  return { proyectos_con_monto: visibles.length, comprometido: redondear(visibles.reduce((n, f) => n + f.monto_comprometido, 0)), conforme: redondear(visibles.reduce((n, f) => n + f.monto_conforme, 0)) };
}

module.exports = { construirPortafolio, totalesMonto, anioDe, PESO };
