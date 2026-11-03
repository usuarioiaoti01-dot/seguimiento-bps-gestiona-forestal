'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearCalendario, aDia, aFecha } = require('../server/motor/calendario');
const { recalcularPlan, evaluarVigencia } = require('../server/motor/recalculo');
const { construirEstado } = require('../server/motor/estado');
const semilla = require('../data/semilla.json');

const plan = { plan_id: 1, tipo_dias: 'CALENDARIO' };
const act = (id, ini, fin, extra = {}) => ({ actividad_id: id, plan_id: 1, numero: String(id), descripcion: `A${id}`, inicio_plan: ini, fin_plan: fin, avance: 0, estado: 'PENDIENTE', es_resumen: 0, ...extra });

test('calendario hábil salta fin de semana y feriados', () => {
  const cal = crearCalendario({ tipo: 'HABILES', feriados: ['2026-12-08', '2026-12-09'] });
  // vie 04/12 + 1 hábil = lun 07/12; + 2 hábiles = jue 10/12 (08 y 09 feriados)
  assert.equal(aFecha(cal.desplazar(aDia('2026-12-04'), 1)), '2026-12-07');
  assert.equal(aFecha(cal.desplazar(aDia('2026-12-04'), 2)), '2026-12-10');
  assert.equal(cal.duracion(aDia('2026-12-07'), aDia('2026-12-11')), 3);
});

test('sin cambios, el plan formulado se reproduce exactamente (corte antes del inicio)', () => {
  const r = recalcularPlan({
    plan, corte: '2026-11-01',
    actividades: [act(1, '2026-11-09', '2026-11-11'), act(2, '2026-11-11', '2026-11-13')],
    dependencias: [{ actividad_id: 2, predecesora_id: 1, desfase_dias: -1 }],
  });
  assert.equal(r.actividades[1].fin_probable, '2026-11-11');
  assert.equal(r.actividades[2].inicio_probable, '2026-11-11');
  assert.equal(r.actividades[2].fin_probable, '2026-11-13');
  assert.equal(r.fin_probable, '2026-11-13');
});

test('actividad sin iniciar con inicio vencido se reprograma desde el corte y arrastra a su sucesora', () => {
  const r = recalcularPlan({
    plan, corte: '2026-11-05',
    actividades: [act(1, '2026-11-01', '2026-11-03'), act(2, '2026-11-04', '2026-11-06')],
    dependencias: [{ actividad_id: 2, predecesora_id: 1, desfase_dias: 0 }],
  });
  assert.equal(r.actividades[1].inicio_probable, '2026-11-05');
  assert.equal(r.actividades[1].fin_probable, '2026-11-07');
  assert.equal(r.actividades[1].situacion, 'SIN_INICIAR_VENCIDA');
  assert.equal(r.actividades[2].inicio_probable, '2026-11-08');
  assert.equal(r.actividades[2].fin_probable, '2026-11-10');
  assert.equal(r.actividades[2].desvio_dias, 4);
  assert.equal(r.actividades[2].critica, true);
});

test('método por rendimiento: avance bajo alarga el faltante (SPI)', () => {
  // 10 días (01–10); al corte 05 se esperaba 50 %, hay 25 % -> SPI 0,5 -> faltan 7,5/0,5 = 15 días
  const base = { plan, corte: '2026-11-05', actividades: [act(1, '2026-11-01', '2026-11-10', { avance: 25, estado: 'EN_CURSO' })] };
  const rend = recalcularPlan({ ...base, metodo: 'RENDIMIENTO', spiMinimo: 0.4 });
  const lin = recalcularPlan({ ...base, metodo: 'LINEAL' });
  assert.equal(rend.actividades[1].fin_probable, '2026-11-20');
  assert.equal(lin.actividades[1].fin_probable, '2026-11-13');
  assert.equal(rend.actividades[1].situacion, 'ATRASADA');
});

test('actividad concluida usa su fin real y libera a la sucesora', () => {
  const r = recalcularPlan({
    plan, corte: '2026-11-05',
    actividades: [act(1, '2026-11-01', '2026-11-04', { estado: 'CONCLUIDA', avance: 100, fin_real: '2026-11-06' }), act(2, '2026-11-05', '2026-11-06')],
    dependencias: [{ actividad_id: 2, predecesora_id: 1, desfase_dias: 0 }],
  });
  assert.equal(r.actividades[1].fin_probable, '2026-11-06');
  assert.equal(r.actividades[2].inicio_probable, '2026-11-07');
});

test('las actividades de resumen toman fechas y avance de sus hijas', () => {
  const r = recalcularPlan({
    plan, corte: '2026-10-01',
    actividades: [act(10, '2026-11-01', '2026-11-20', { numero: '2', es_resumen: 1 }), act(11, '2026-11-01', '2026-11-10', { numero: '2.1' }), act(12, '2026-11-11', '2026-11-20', { numero: '2.2' })],
  });
  assert.equal(r.actividades[10].inicio_probable, '2026-11-01');
  assert.equal(r.actividades[10].fin_probable, '2026-11-20');
  assert.equal(r.numero_actividades, 2);
});

test('un ciclo de dependencias se rechaza', () => {
  assert.throws(() => recalcularPlan({
    plan, corte: '2026-11-01',
    actividades: [act(1, '2026-11-01', '2026-11-02'), act(2, '2026-11-03', '2026-11-04')],
    dependencias: [{ actividad_id: 2, predecesora_id: 1 }, { actividad_id: 1, predecesora_id: 2 }],
  }), /ciclo/);
});

test('vigencia: holgura negativa es ROJO y la adenda anunciada se informa como potencial', () => {
  const v = evaluarVigencia({
    corte: '2026-11-03',
    pronostico: { fin_probable: '2026-11-20' },
    adendas: [{ numero: 3, estado: 'FIRMADA', fecha_inicio: '2026-10-15', fecha_fin: '2026-11-13' }, { numero: 4, estado: 'ANUNCIADA', fecha_inicio: '2026-11-14', fecha_fin: '2026-12-31' }],
  });
  assert.equal(v.fin_vigencia, '2026-11-13');
  assert.equal(v.dias_restantes, 10);
  assert.equal(v.holgura_dias, -7);
  assert.equal(v.semaforo, 'ROJO');
  assert.equal(v.holgura_potencial_dias, 41);
});

test('semilla real: estado completo sin errores y alertas esperadas al 03/11/2026', () => {
  const e = construirEstado(JSON.parse(JSON.stringify(semilla)), { corte: '2026-11-03' });
  assert.equal(e.consultores.length, 11);
  const claves = new Set(e.alertas.filter((a) => a.codigo === 'VIGENCIA_POR_VENCER').map((a) => a.clave));
  for (const k of ['ERB', 'EVE', 'APA', 'CAC']) assert.ok(claves.has(k), `falta alerta de vigencia de ${k}`);
  assert.ok(e.alertas.some((a) => a.codigo === 'PLAN_POR_REGISTRAR' && a.clave === 'ASL'));
  assert.ok(e.alertas.some((a) => a.codigo === 'NUEVA_SIN_CONTROL_CAMBIO' && a.clave === 'PBQ'));
  assert.ok(e.alertas.some((a) => a.codigo === 'CONTROL_CAMBIO_PENDIENTE' && a.clave === 'EVE'));
  const pbq = e.consultores.find((c) => c.consultor.clave === 'PBQ');
  assert.equal(pbq.pronostico.fin_probable, '2026-12-31'); // plan intacto: inicia el 09/11
});
