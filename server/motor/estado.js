'use strict';
/**
 * Construye la "foto" completa del proyecto a una fecha de corte:
 * vigencia de cada consultor, pronóstico de su plan, cobertura de la línea
 * base, alertas e indicadores. Es una función pura: recibe los datos y
 * devuelve el resultado, sin tocar la base de datos.
 */
const { aDia } = require('./calendario');
const { recalcularPlan, evaluarVigencia } = require('./recalculo');
const { analizarCobertura } = require('./cobertura');

function parametro(datos, codigo, defecto) {
  const p = (datos.parametros || []).find((x) => x.codigo === codigo);
  return p && p.valor !== '' && p.valor !== null && p.valor !== undefined ? p.valor : defecto;
}

function construirEstado(datos, { corte, metodo, spiMinimo, umbralVigencia, umbralHolgura } = {}) {
  metodo = metodo || parametro(datos, 'METODO_PRONOSTICO', 'RENDIMIENTO');
  spiMinimo = Number(spiMinimo ?? parametro(datos, 'SPI_MINIMO', 0.4));
  umbralVigencia = Number(umbralVigencia ?? parametro(datos, 'UMBRAL_VIGENCIA_DIAS', 15));
  umbralHolgura = Number(umbralHolgura ?? parametro(datos, 'UMBRAL_HOLGURA_DIAS', 5));
  const feriados = (datos.feriados || []).map((f) => f.fecha);

  const consultores = datos.consultores.filter((c) => c.activo !== 0 && c.activo !== false);
  const resultado = [];

  for (const c of consultores) {
    const contrato = datos.contratos.find((k) => k.consultor_id === c.consultor_id && k.activo !== 0 && k.activo !== false) || null;
    const adendas = contrato ? datos.adendas.filter((a) => a.contrato_id === contrato.contrato_id && a.activo !== 0 && a.activo !== false) : [];
    const planes = datos.planes.filter((p) => p.consultor_id === c.consultor_id && p.activo !== 0 && p.activo !== false);
    const plan = planes.sort((x, y) => y.plan_id - x.plan_id)[0] || null;
    const actividades = plan ? datos.actividades.filter((a) => a.plan_id === plan.plan_id && a.activo !== 0 && a.activo !== false) : [];
    const pronostico = plan
      ? recalcularPlan({ plan, actividades, dependencias: datos.dependencias, feriados, corte, metodo, spiMinimo })
      : null;
    const vigencia = evaluarVigencia({ adendas, pronostico: pronostico && pronostico.numero_actividades ? pronostico : null, corte, umbralHolgura });
    const lb = datos.linea_base.filter((e) => e.consultor_id === c.consultor_id && e.activo !== 0 && e.activo !== false);
    resultado.push({ consultor: c, contrato, adendas, plan, actividades, pronostico, vigencia, cobertura: analizarCobertura(adendas), linea_base: lb });
  }

  const alertas = generarAlertas(resultado, datos, { corte, umbralVigencia, umbralHolgura });
  return { corte, metodo, spiMinimo, umbralVigencia, umbralHolgura, consultores: resultado, alertas, indicadores: indicadores(resultado, alertas, corte) };
}

function coberturaLineaBase(entregable, datos) {
  if (Number(entregable.avance_corte) >= 100) return 'CONCLUIDO';
  const n = datos.actividades.filter((a) => a.entregable_id === entregable.entregable_id && a.activo !== 0 && a.activo !== false && a.estado !== 'ANULADA').length;
  return n > 0 ? 'CUBIERTO' : 'NO_CUBIERTO';
}

const ff = (s) => (s ? s.split('-').reverse().join('/') : '—');

function generarAlertas(items, datos, { corte, umbralVigencia, umbralHolgura }) {
  const hoy = aDia(corte);
  const alertas = [];
  const add = (prioridad, codigo, it, titulo, detalle, accion) =>
    alertas.push({ prioridad, codigo, consultor_id: it.consultor.consultor_id, clave: it.consultor.clave, nombres: it.consultor.nombres, titulo, detalle, accion });

  for (const it of items) {
    const v = it.vigencia;
    const pr = it.pronostico;
    // Vigencia
    if (v.dias_restantes !== null && v.dias_restantes < 0) {
      add('ALTA', 'VIGENCIA_VENCIDA', it, 'Vigencia contractual vencida',
        `La vigencia terminó el ${ff(v.fin_vigencia)} (hace ${-v.dias_restantes} días).`,
        v.adenda_siguiente ? `Gestionar la suscripción de la Adenda N.° ${v.adenda_siguiente.numero} (${v.adenda_siguiente.estado.toLowerCase()}).` : 'Confirmar si el servicio continúa; no otorgar conformidades por periodos sin contrato vigente.');
    } else if (v.dias_restantes !== null && v.dias_restantes <= umbralVigencia) {
      const sig = v.adenda_siguiente;
      add(sig && sig.estado === 'EN_TRAMITE' ? 'MEDIA' : 'ALTA', 'VIGENCIA_POR_VENCER', it, `Vigencia vence en ${v.dias_restantes} días`,
        `Fin de vigencia: ${ff(v.fin_vigencia)}.` + (sig ? ` Adenda N.° ${sig.numero} ${sig.estado === 'ANUNCIADA' ? 'anunciada, sin documento' : 'en trámite'} hasta el ${ff(sig.fecha_fin)}.` : ' No hay adenda posterior registrada.'),
        sig ? 'Hacer seguimiento a BPS y solicitar el plan de trabajo del nuevo periodo.' : 'Definir continuidad del servicio o el cierre ordenado de entregables.');
    }
    // Cobertura histórica entre adendas confirmadas (concluidas y firmadas)
    for (const t of it.cobertura.brechas) {
      add('ALTA', 'ADENDAS_SIN_COBERTURA', it, `${t.dias} día(s) sin cobertura entre las Adendas N.° ${t.anterior} y N.° ${t.siguiente}`,
        `Sin vigencia contractual del ${ff(t.desde)} al ${ff(t.hasta)}.`,
        'Verificar las fechas de las adendas y no otorgar conformidades por ese periodo sin sustento.');
    }
    for (const t of it.cobertura.superposiciones) {
      add('MEDIA', 'ADENDAS_SUPERPUESTAS', it, `Inconsistencia: las Adendas N.° ${t.anterior} y N.° ${t.siguiente} se superponen ${t.dias} día(s)`,
        `Ambas vigencias cubren del ${ff(t.desde)} al ${ff(t.hasta)}.`,
        'Corregir el inicio o el fin de la adenda que corresponda (con el documento de sustento).');
    }
    // Plan vs vigencia
    if (it.plan && it.plan.estado === 'POR_REGISTRAR') {
      add('MEDIA', 'PLAN_POR_REGISTRAR', it, 'Plan de trabajo por registrar', `El plan (${it.plan.fuente || 'sin fuente'}) no tiene actividades registradas.`, 'Registrar las actividades del plan para habilitar el pronóstico.');
    }
    if (pr && pr.numero_actividades && v.holgura_dias !== null) {
      if (v.holgura_dias < 0) {
        const cubre = v.holgura_potencial_dias !== null && v.holgura_potencial_dias >= 0;
        add('ALTA', 'PLAN_EXCEDE_VIGENCIA', it, `Término probable excede la vigencia en ${-v.holgura_dias} días`,
          `Fin probable del plan: ${ff(pr.fin_probable)}; fin de vigencia: ${ff(v.fin_vigencia)}.` + (v.adenda_siguiente ? ` La Adenda N.° ${v.adenda_siguiente.numero} ${cubre ? 'lo cubriría' : 'tampoco lo cubriría'} (hasta ${ff(v.fin_vigencia_potencial)}).` : ''),
          'Reprogramar actividades, priorizar entregables o sustentar la ampliación de plazo.');
      } else if (v.holgura_dias < umbralHolgura) {
        add('MEDIA', 'HOLGURA_REDUCIDA', it, `Holgura de ${v.holgura_dias} días frente a la vigencia`, `Fin probable ${ff(pr.fin_probable)}; vigencia hasta ${ff(v.fin_vigencia)}.`, 'Vigilar las actividades críticas.');
      }
    }
    // Actividades
    const hojas = it.actividades.filter((a) => !a.es_resumen && a.estado !== 'ANULADA');
    const vencidas = hojas.filter((a) => a.estado !== 'CONCLUIDA' && Number(a.avance) < 100 && aDia(a.fin_plan) < hoy);
    if (vencidas.length) {
      add(vencidas.some((a) => a.es_hito) ? 'ALTA' : 'MEDIA', 'ACTIVIDADES_VENCIDAS', it, `${vencidas.length} actividad(es) con fin planificado vencido sin concluir`,
        vencidas.slice(0, 6).map((a) => `${a.numero} ${a.descripcion.slice(0, 70)} (fin ${ff(a.fin_plan)}, ${Number(a.avance)} %)`).join(' · '),
        'Registrar el avance real y la evidencia; si no se ejecutaron, reprogramar con motivo.');
    }
    const iniciadoPlan = hojas.some((a) => aDia(a.inicio_plan) < hoy);
    if (hojas.length && iniciadoPlan && !hojas.some((a) => Number(a.avance) > 0 || a.estado !== 'PENDIENTE')) {
      add('MEDIA', 'SIN_AVANCE_REGISTRADO', it, 'Plan sin avance registrado', 'Ninguna actividad tiene avance o estado registrado, aunque el plan ya inició.', 'Actualizar el seguimiento con el consultor (estado, % y evidencia).');
    }
    const nuevas = hojas.filter((a) => a.clasificacion === 'NUEVA');
    if (nuevas.length) {
      const sinActa = nuevas.filter((a) => !a.control_cambio_id);
      const conBorrador = nuevas.filter((a) => {
        const cc = (datos.controles_cambio || []).find((x) => x.control_cambio_id === a.control_cambio_id);
        return cc && cc.estado !== 'APROBADO';
      });
      if (sinActa.length) add('ALTA', 'NUEVA_SIN_CONTROL_CAMBIO', it, `${sinActa.length} actividad(es) fuera de línea base sin Acta de Control de Cambios`, sinActa.slice(0, 5).map((a) => `${a.numero} ${a.descripcion.slice(0, 60)}`).join(' · '), 'Formalizar con Acta de Control de Cambios antes de otorgar conformidad.');
      if (conBorrador.length) add('MEDIA', 'CONTROL_CAMBIO_PENDIENTE', it, `Acta de Control de Cambios sin aprobar (${conBorrador.length} actividades)`, 'El acta vinculada está en borrador o fue rechazada.', 'Aprobar o rechazar el acta antes de la conformidad del entregable.');
    }
    // Línea base
    const noCub = it.linea_base.filter((e) => coberturaLineaBase(e, datos) === 'NO_CUBIERTO');
    if (noCub.length) {
      add('MEDIA', 'LINEA_BASE_NO_CUBIERTA', it, `${noCub.length} entregable(s) de la línea base sin actividad en el plan`, noCub.map((e) => `${e.edt} ${e.nombre.slice(0, 60)}`).join(' · '), 'Reprogramar o declarar fuera de alcance 2026 con sustento.');
    }
  }
  const peso = { ALTA: 0, MEDIA: 1, BAJA: 2 };
  return alertas.sort((a, b) => peso[a.prioridad] - peso[b.prioridad] || a.clave.localeCompare(b.clave));
}

/**
 * Actividades de seguimiento (hojas, no anuladas) de un profesional, con dos medidas que no dependen de
 * estimaciones: los días vencidos (corte − fin del plan, solo si siguen sin concluir) y si no tienen avance.
 */
function medidasActividades(it, hoy) {
  const hojas = it.actividades.filter((a) => !a.es_resumen && a.estado !== 'ANULADA');
  let dias = 0; let vencidas = 0; let sinInicio = 0;
  for (const a of hojas) {
    const concluida = a.estado === 'CONCLUIDA' || Number(a.avance) >= 100;
    if (!concluida && aDia(a.fin_plan) < hoy) { dias += hoy - aDia(a.fin_plan); vencidas += 1; }
    if (a.estado !== 'CONCLUIDA' && (a.estado === 'PENDIENTE' || Number(a.avance) === 0)) sinInicio += 1;
  }
  return { dias, vencidas, sinInicio };
}

function indicadores(items, alertas, corte) {
  const hoy = aDia(corte);
  const medidas = items.map((i) => medidasActividades(i, hoy));
  const conPlan = items.filter((i) => i.pronostico && i.pronostico.numero_actividades);
  const sum = (f) => conPlan.reduce((t, i) => t + f(i), 0);
  const peso = sum((i) => i.pronostico.numero_actividades);
  return {
    corte,
    consultores: items.length,
    vencen_15_dias: items.filter((i) => i.vigencia.dias_restantes !== null && i.vigencia.dias_restantes >= 0 && i.vigencia.dias_restantes <= 15).length,
    planes_exceden_vigencia: items.filter((i) => i.vigencia.holgura_dias !== null && i.vigencia.holgura_dias < 0).length,
    actividades: sum((i) => i.pronostico.numero_actividades),
    actividades_atrasadas: sum((i) => Object.values(i.pronostico.actividades).filter((a) => ['ATRASADA', 'SIN_INICIAR_VENCIDA'].includes(a.situacion) && !i.actividades.find((x) => x.actividad_id === a.actividad_id).es_resumen).length),
    avance_ponderado: peso ? Math.round((sum((i) => i.pronostico.avance_ponderado * i.pronostico.numero_actividades) / peso) * 10) / 10 : 0,
    avance_esperado: peso ? Math.round((sum((i) => i.pronostico.avance_esperado * i.pronostico.numero_actividades) / peso) * 10) / 10 : 0,
    dias_atraso: medidas.reduce((t, m) => t + m.dias, 0), // suma de los días vencidos de las actividades sin concluir de todos los profesionales
    actividades_vencidas: medidas.reduce((t, m) => t + m.vencidas, 0),
    actividades_sin_inicio: medidas.reduce((t, m) => t + m.sinInicio, 0), // sin iniciar o sin avance registrado
    planes_aprobados: items.filter((i) => i.plan && i.plan.estado === 'APROBADO').length,
    alertas_altas: alertas.filter((a) => a.prioridad === 'ALTA').length,
    alertas_total: alertas.length,
  };
}

module.exports = { construirEstado, coberturaLineaBase, parametro };
