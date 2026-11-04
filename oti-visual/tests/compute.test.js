// Ejecutar:  node --test tests/*.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeRows, groupRows, summarize, textoBrecha, toDay, filasTooltip } from '../src/vigencia-timeline/compute.js';

const { corte, data } = JSON.parse(readFileSync(new URL('../demo/datos-ejemplo.json', import.meta.url)));
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

test('brechas en modo firmada coinciden con el gráfico original', () => {
  const r = byId(computeRows(data, { corte }));
  const esperado = { PBQ: 0, ASL: null, EBS: 0, ERB: -16, EVE: -20, APA: -20, KAP: -2, CAC: -21, JCM: -4, ELP: 1, YMF: null };
  for (const [id, b] of Object.entries(esperado)) assert.equal(r[id].brecha, b, id);
});

test('estados con umbral -7', () => {
  const r = byId(computeRows(data, { corte }));
  assert.equal(r.CAC.status, 'critical');
  assert.equal(r.JCM.status, 'warn');
  assert.equal(r.PBQ.status, 'ok');
  assert.equal(r.ELP.status, 'ok');
  assert.equal(r.ASL.status, 'none');
});

test('límite del umbral: -7 es atención, -8 es crítico', () => {
  const mk = (prob) => ({ id: 'X', inicio: '2026-11-01', fin: '2026-11-30', terminoProbable: prob });
  assert.equal(computeRows([mk('2026-12-07')], { corte }).at(0).status, 'warn');
  assert.equal(computeRows([mk('2026-12-08')], { corte }).at(0).status, 'critical');
});

test('modo adenda usa el fin de la adenda', () => {
  const r = byId(computeRows(data, { corte, modo: 'adenda' }));
  assert.equal(r.ERB.brecha, 31);
  assert.equal(r.ERB.status, 'ok');
  assert.equal(r.KAP.brecha, -2); // sin adenda: no cambia
});

test('agrupación y orden por brecha', () => {
  const g = groupRows(computeRows(data, { corte }));
  assert.deepEqual(g.map((x) => x.key), ['critical', 'warn', 'ok', 'none']);
  assert.deepEqual(g[0].rows.map((r) => r.id), ['CAC', 'APA', 'EVE', 'ERB']);
});

test('resumen: plazo para firmar adendas', () => {
  const s = summarize(computeRows(data, { corte }), corte);
  assert.deepEqual(s.count, { critical: 4, warn: 2, ok: 3, none: 2 });
  assert.equal(s.plazoAdenda, toDay('2026-11-13'));
  assert.equal(s.diasPlazoAdenda, 9);
});

test('textos de insignia', () => {
  assert.equal(textoBrecha(-16), '16 d sin cobertura');
  assert.equal(textoBrecha(0), 'Justo al cierre');
  assert.equal(textoBrecha(1), '+1 d de margen');
  assert.equal(textoBrecha(null), 'Sin dato');
});

test('rechaza fechas inválidas', () => {
  assert.throws(() => computeRows([{ id: 'X', inicio: '04/11/2026', fin: '2026-12-31' }], { corte }));
});

test('tooltip "vigencia": solo inicio y fin; con adenda añade su vencimiento y el plazo para firmarla', () => {
  const r = byId(computeRows(data, { corte }));
  assert.deepEqual(filasTooltip(r.KAP, { detalle: 'vigencia' }).map((f) => f[0]), ['Inicio', 'Fin de vigencia']);
  const apa = filasTooltip(r.APA, { detalle: 'vigencia' });
  assert.deepEqual(apa.map((f) => f[0]), ['Inicio', 'Fin de vigencia', 'Vencimiento de la adenda', 'Plazo para firmar la adenda']);
  const dias = r.APA.fin - toDay(corte); // días entre el corte y el fin de la vigencia firmada
  assert.deepEqual(apa.at(-1), ['Plazo para firmar la adenda', `${dias} días`]);
  assert.ok(dias > 1);
  assert.ok(!apa.some((f) => /término probable|brecha/i.test(f[0])), 'sin término probable ni brecha');
});

test('tooltip "vigencia": en el escenario con adendas firmadas no hay plazo para firmar', () => {
  const r = byId(computeRows(data, { corte, modo: 'adenda' }));
  const filas = filasTooltip(r.APA, { modo: 'adenda', detalle: 'vigencia' });
  assert.deepEqual(filas.map((f) => f[0]), ['Inicio', 'Fin de vigencia', 'Vencimiento de la adenda']);
});

test('tooltip "vigencia": una adenda que no amplía la vigencia no se informa; 1 día va en singular', () => {
  const sin = computeRows([{ id: 'X', inicio: '2026-11-01', fin: '2026-11-30', adenda: '2026-11-30' }], { corte })[0];
  assert.equal(filasTooltip(sin, { detalle: 'vigencia' }).length, 2);
  const uno = computeRows([{ id: 'Y', inicio: '2026-10-01', fin: '2026-11-05', adenda: '2026-12-31' }], { corte })[0];
  assert.deepEqual(filasTooltip(uno, { detalle: 'vigencia' }).at(-1), ['Plazo para firmar la adenda', '1 día']);
});

test('tooltip "completo" (por defecto) conserva el contenido original', () => {
  const r = byId(computeRows(data, { corte }));
  assert.deepEqual(filasTooltip(r.APA).map((f) => f[0]), ['Inicio', 'Fin vigencia firmada', 'Adenda en trámite hasta', 'Término probable', 'Días para firmar adenda']);
  assert.deepEqual(filasTooltip(r.ASL).map((f) => f[0]), ['Inicio', 'Fin vigencia firmada', 'Término probable']);
  assert.equal(filasTooltip(r.ASL).find((f) => f[0] === 'Término probable')[1], '—');
});

test('historial: computeRows convierte los tramos y filasTooltip los describe (solo con historial: true)', () => {
  const r = computeRows([{
    id: 'X', inicio: '2026-11-09', fin: '2026-12-31',
    historial: [{ numero: 1, inicio: '2026-05-13', fin: '2026-08-10', plazoDias: 90 }, { numero: 2, inicio: '2026-08-20', fin: '2026-10-18', plazoDias: 60, plazoSolicitadoDias: 180 }],
    brechas: [{ inicio: '2026-08-11', fin: '2026-08-19', dias: 9 }],
  }], { corte: '2026-11-04' })[0];
  assert.equal(r.hist.length, 2);
  assert.equal(r.brechas.length, 1);
  assert.equal(r.superposiciones.length, 0);
  const filas = filasTooltip(r, { detalle: 'vigencia', historial: true });
  assert.deepEqual(filas[1], ['Adenda 02', '20/08/2026 – 18/10/2026 · 60 días (solicitados 180)']);
  assert.deepEqual(filas.find((f) => f[0] === 'Sin cobertura'), ['Sin cobertura', '9 días (11/08/2026 – 19/08/2026)']);
  assert.equal(filasTooltip(r, { detalle: 'vigencia' }).length, 2);
  // sin historial en los datos, las filas conservan su forma
  assert.deepEqual(computeRows([{ id: 'Y', inicio: '2026-11-01', fin: '2026-11-30' }], { corte: '2026-11-04' })[0].hist, []);
});
