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

// ---------------------------------------------------------------- cobertura entre adendas (historial)
const { analizarCobertura } = require('../server/motor/cobertura');
const ad = (numero, inicio, fin, estado = 'CONCLUIDA', extra = {}) => ({ adenda_id: numero, contrato_id: 1, numero, fecha_inicio: inicio, fecha_fin: fin, estado, activo: 1, ...extra });

test('cobertura: adendas contiguas no tienen días sin cobertura', () => {
  const c = analizarCobertura([ad(1, '2026-05-13', '2026-08-10'), ad(2, '2026-08-11', '2026-11-08'), ad(3, '2026-11-09', '2026-12-31', 'FIRMADA')]);
  assert.deepEqual(c.tramos.map((t) => [t.anterior, t.siguiente, t.tipo, t.dias]), [[1, 2, 'CONTINUA', 0], [2, 3, 'CONTINUA', 0]]);
  assert.equal(c.dias_sin_cobertura, 0);
  assert.equal(c.consistente, true);
});

test('cobertura: los días entre el fin de una adenda y el inicio de la siguiente son días sin cobertura', () => {
  // la Adenda 1 termina el 10/08 y la 2 inicia el 20/08: sin cobertura del 11/08 al 19/08 = 9 días
  const c = analizarCobertura([ad(1, '2026-05-13', '2026-08-10'), ad(2, '2026-08-20', '2026-11-08')]);
  assert.equal(c.brechas.length, 1);
  assert.deepEqual({ ...c.brechas[0] }, { anterior: 1, siguiente: 2, tipo: 'BRECHA', dias: 9, desde: '2026-08-11', hasta: '2026-08-19' });
  assert.equal(c.dias_sin_cobertura, 9);
  // un solo día de diferencia ya cuenta
  assert.equal(analizarCobertura([ad(1, '2026-05-01', '2026-05-31'), ad(2, '2026-06-02', '2026-06-30')]).brechas[0].dias, 1);
});

test('cobertura: vigencias superpuestas se marcan como inconsistencia, no como brecha', () => {
  const c = analizarCobertura([ad(1, '2026-05-13', '2026-08-10'), ad(2, '2026-08-05', '2026-11-08')]);
  assert.equal(c.brechas.length, 0);
  assert.equal(c.superposiciones.length, 1);
  assert.deepEqual({ ...c.superposiciones[0] }, { anterior: 1, siguiente: 2, tipo: 'SUPERPOSICION', dias: 6, desde: '2026-08-05', hasta: '2026-08-10' });
  assert.equal(c.consistente, false);
  assert.equal(c.dias_sin_cobertura, 0);
});

test('cobertura: una adenda larga que se superpone con una posterior no consecutiva también se detecta', () => {
  const c = analizarCobertura([ad(1, '2026-01-01', '2026-12-31'), ad(2, '2026-02-01', '2026-02-28'), ad(3, '2026-03-01', '2026-03-31')]);
  assert.deepEqual(c.superposiciones.map((t) => [t.anterior, t.siguiente]), [[1, 2], [1, 3]]);
});

test('cobertura: ignora adendas anuladas, anunciadas, en trámite e inactivas, y no depende del orden de llegada', () => {
  const c = analizarCobertura([
    ad(4, '2027-01-01', '2027-03-31', 'ANUNCIADA'), ad(5, '2027-02-01', '2027-02-10', 'EN_TRAMITE'), ad(6, '2026-09-01', '2026-09-05', 'ANULADA'),
    ad(7, '2026-09-10', '2026-09-20', 'CONCLUIDA', { activo: 0 }),
    ad(2, '2026-08-11', '2026-11-08'), ad(1, '2026-05-13', '2026-08-10'),
  ]);
  assert.deepEqual(c.tramos.map((t) => [t.anterior, t.siguiente, t.tipo]), [[1, 2, 'CONTINUA']]);
  assert.deepEqual(analizarCobertura([]).tramos, []);
  assert.equal(analizarCobertura([ad(1, '2026-05-13', '2026-08-10')]).consistente, true);
});

test('la semilla con el historial: 34 adendas, 19 concluidas y sin días sin cobertura ni superposiciones', () => {
  assert.equal(semilla.adendas.length, 34);
  const concl = semilla.adendas.filter((a) => a.estado === 'CONCLUIDA');
  assert.equal(concl.length, 19);
  assert.ok(concl.every((a) => a.plazo_dias === aDia(a.fecha_fin) - aDia(a.fecha_inicio) + 1), 'plazo_dias coincide con las fechas');
  const e = construirEstado(semilla, { corte: '2026-11-04' });
  assert.ok(e.consultores.every((it) => it.cobertura.dias_sin_cobertura === 0 && it.cobertura.consistente));
  assert.ok(!e.alertas.some((a) => /^ADENDAS_/.test(a.codigo)));
  // Montalbán (contrato 123): Adenda 01 (hasta 30/10) y Adenda 02 firmada (desde 31/10)
  const ymf = e.consultores.find((it) => it.consultor.clave === 'YMF');
  assert.deepEqual(ymf.cobertura.tramos.map((t) => [t.anterior, t.siguiente, t.tipo]), [[1, 2, 'CONTINUA']]);
});

test('el historial concluido no cambia la vigencia: sigue siendo el fin de la última adenda FIRMADA', () => {
  const e = construirEstado(semilla, { corte: '2026-11-04' });
  const erb = e.consultores.find((it) => it.consultor.clave === 'ERB');
  assert.equal(erb.vigencia.adenda_vigente.numero, 3);
  assert.equal(erb.vigencia.adenda_vigente.estado, 'FIRMADA');
  assert.equal(erb.vigencia.adenda_siguiente.numero, 4);
  assert.equal(erb.vigencia.fin_vigencia, '2026-11-13');
  const copia = JSON.parse(JSON.stringify(semilla));
  copia.adendas = copia.adendas.filter((a) => a.estado !== 'CONCLUIDA');
  const sin = construirEstado(copia, { corte: '2026-11-04' }).consultores.find((it) => it.consultor.clave === 'ERB');
  assert.deepEqual(sin.vigencia, erb.vigencia);
});

test('alertas: los días sin cobertura generan una alerta ALTA y la superposición una alerta MEDIA en la ficha', () => {
  const copia = JSON.parse(JSON.stringify(semilla));
  const k = (clave) => copia.contratos.find((c) => c.consultor_id === copia.consultores.find((x) => x.clave === clave).consultor_id).contrato_id;
  // ASL: la Adenda 02 (11/08–08/11) pasa a terminar el 31/10 → 8 días sin cobertura (01/11–08/11)
  copia.adendas.find((a) => a.contrato_id === k('ASL') && a.numero === 2).fecha_fin = '2026-10-31';
  // EBS: la Adenda 02 pasa a comenzar el 01/08 → se superpone 10 días con la 01 (hasta el 10/08)
  copia.adendas.find((a) => a.contrato_id === k('EBS') && a.numero === 2).fecha_inicio = '2026-08-01';
  const e = construirEstado(copia, { corte: '2026-11-04' });
  const brecha = e.alertas.find((a) => a.codigo === 'ADENDAS_SIN_COBERTURA');
  assert.equal(brecha.clave, 'ASL');
  assert.equal(brecha.prioridad, 'ALTA');
  assert.match(brecha.titulo, /8 día\(s\) sin cobertura entre las Adendas N\.° 2 y N\.° 3/);
  assert.match(brecha.detalle, /01\/11\/2026 al 08\/11\/2026/);
  const sup = e.alertas.find((a) => a.codigo === 'ADENDAS_SUPERPUESTAS');
  assert.equal(sup.clave, 'EBS');
  assert.equal(sup.prioridad, 'MEDIA');
  assert.match(sup.titulo, /Inconsistencia/);
});
