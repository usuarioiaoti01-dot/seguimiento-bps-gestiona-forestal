'use strict';
// Componente VigenciaTimeline (OTI Visual): lógica de brecha y adaptador del estado del servidor.
// Los módulos del cliente son ES y se cargan con import() dinámico (public/js/package.json declara "type": "module").
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { crearRepositorioMemoria } = require('../server/datos/memoria');
const { crearServicio } = require('../server/servicio');
const semilla = require('../data/semilla.json');
const ejemplo = require('../oti-visual/demo/datos-ejemplo.json');

const cliente = (ruta) => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', ruta)).href);
let C; // compute.js
let A; // vigencia-adaptador.js
test.before(async () => {
  C = await cliente('vigencia-timeline/compute.js');
  A = await cliente('vigencia-adaptador.js');
});

const { corte, data } = ejemplo;
const porId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

// ---------------------------------------------------------------- lógica del componente (paquete OTI Visual)
test('brechas en modo firmada coinciden con el gráfico original', () => {
  const r = porId(C.computeRows(data, { corte }));
  const esperado = { PBQ: 0, ASL: null, EBS: 0, ERB: -16, EVE: -20, APA: -20, KAP: -2, CAC: -21, JCM: -4, ELP: 1, YMF: null };
  for (const [id, b] of Object.entries(esperado)) assert.equal(r[id].brecha, b, id);
});

test('estados con el umbral de diseño (-7)', () => {
  const r = porId(C.computeRows(data, { corte }));
  assert.equal(r.CAC.status, 'critical');
  assert.equal(r.JCM.status, 'warn');
  assert.equal(r.PBQ.status, 'ok');
  assert.equal(r.ELP.status, 'ok');
  assert.equal(r.ASL.status, 'none');
});

test('límite del umbral de diseño: -7 es atención, -8 es crítico', () => {
  const mk = (prob) => ({ id: 'X', inicio: '2026-11-01', fin: '2026-11-30', terminoProbable: prob });
  assert.equal(C.computeRows([mk('2026-12-07')], { corte }).at(0).status, 'warn');
  assert.equal(C.computeRows([mk('2026-12-08')], { corte }).at(0).status, 'critical');
});

test('con umbralAtencion = 0 (criterio del servidor) toda brecha negativa es sin cobertura', () => {
  // El semáforo ROJO del servidor es holgura < 0; el Tablero usa umbralAtencion = 0 para no contradecirse.
  const r = porId(C.computeRows(data, { corte, umbralAtencion: 0 }));
  assert.equal(r.KAP.status, 'critical'); // -2 d
  assert.equal(r.JCM.status, 'critical'); // -4 d
  assert.equal(r.PBQ.status, 'ok'); // 0 d
  assert.equal(r.ELP.status, 'ok'); // +1 d
  assert.equal(r.ASL.status, 'none');
  assert.ok(!Object.values(r).some((x) => x.status === 'warn'), 'no hay estado intermedio');
});

test('modo adenda usa el fin de la adenda', () => {
  const r = porId(C.computeRows(data, { corte, modo: 'adenda' }));
  assert.equal(r.ERB.brecha, 31);
  assert.equal(r.ERB.status, 'ok');
  assert.equal(r.KAP.brecha, -2); // sin adenda: no cambia
});

test('agrupación y orden por brecha', () => {
  const g = C.groupRows(C.computeRows(data, { corte }));
  assert.deepEqual(g.map((x) => x.key), ['critical', 'warn', 'ok', 'none']);
  assert.deepEqual(g[0].rows.map((r) => r.id), ['CAC', 'APA', 'EVE', 'ERB']);
});

test('resumen: plazo para firmar adendas', () => {
  const s = C.summarize(C.computeRows(data, { corte }), corte);
  assert.deepEqual(s.count, { critical: 4, warn: 2, ok: 3, none: 2 });
  assert.equal(s.plazoAdenda, C.toDay('2026-11-13'));
  assert.equal(s.diasPlazoAdenda, 9);
});

test('textos de insignia: la consecuencia, no el signo', () => {
  assert.equal(C.textoBrecha(-16), '16 d sin cobertura');
  assert.equal(C.textoBrecha(0), 'Justo al cierre');
  assert.equal(C.textoBrecha(1), '+1 d de margen');
  assert.equal(C.textoBrecha(null), 'Sin dato');
});

test('rechaza fechas inválidas', () => {
  assert.throws(() => C.computeRows([{ id: 'X', inicio: '04/11/2026', fin: '2026-12-31' }], { corte }));
});

test('tooltip "vigencia": solo inicio y fin; con adenda añade su vencimiento y el plazo para firmarla', () => {
  const r = porId(C.computeRows(data, { corte }));
  assert.deepEqual(C.filasTooltip(r.KAP, { detalle: 'vigencia' }).map((f) => f[0]), ['Inicio', 'Fin de vigencia']);
  const apa = C.filasTooltip(r.APA, { detalle: 'vigencia' });
  assert.deepEqual(apa.map((f) => f[0]), ['Inicio', 'Fin de vigencia', 'Vencimiento de la adenda', 'Plazo para firmar la adenda']);
  const dias = r.APA.fin - C.toDay(corte); // días entre el corte y el fin de la vigencia firmada
  assert.deepEqual(apa.at(-1), ['Plazo para firmar la adenda', `${dias} días`]);
  assert.ok(dias > 1);
  assert.ok(!apa.some((f) => /término probable|brecha/i.test(f[0])), 'sin término probable ni brecha');
});

test('tooltip "vigencia": en el escenario con adendas firmadas no hay plazo para firmar', () => {
  const r = porId(C.computeRows(data, { corte, modo: 'adenda' }));
  const filas = C.filasTooltip(r.APA, { modo: 'adenda', detalle: 'vigencia' });
  assert.deepEqual(filas.map((f) => f[0]), ['Inicio', 'Fin de vigencia', 'Vencimiento de la adenda']);
});

test('tooltip "vigencia": una adenda que no amplía la vigencia no se informa; 1 día va en singular', () => {
  const sin = C.computeRows([{ id: 'X', inicio: '2026-11-01', fin: '2026-11-30', adenda: '2026-11-30' }], { corte })[0];
  assert.equal(C.filasTooltip(sin, { detalle: 'vigencia' }).length, 2);
  const uno = C.computeRows([{ id: 'Y', inicio: '2026-10-01', fin: '2026-11-05', adenda: '2026-12-31' }], { corte })[0];
  assert.deepEqual(C.filasTooltip(uno, { detalle: 'vigencia' }).at(-1), ['Plazo para firmar la adenda', '1 día']);
});

test('tooltip "completo" (por defecto) conserva el contenido original', () => {
  const r = porId(C.computeRows(data, { corte }));
  assert.deepEqual(C.filasTooltip(r.APA).map((f) => f[0]), ['Inicio', 'Fin vigencia firmada', 'Adenda en trámite hasta', 'Término probable', 'Días para firmar adenda']);
  assert.deepEqual(C.filasTooltip(r.ASL).map((f) => f[0]), ['Inicio', 'Fin vigencia firmada', 'Término probable']);
  assert.equal(C.filasTooltip(r.ASL).find((f) => f[0] === 'Término probable')[1], '—');
});

// ---------------------------------------------------------------- adaptador del estado del servidor
const profesional = (extra = {}) => ({
  consultor_id: 7, clave: 'ABC', nombres: 'Ana Campos Rojas',
  vigencia: {
    adenda_vigente: { numero: 3, fecha_inicio: '2026-07-01', fecha_fin: '2026-11-13' },
    fin_vigencia: '2026-11-13',
    adenda_siguiente: { numero: 4, estado: 'ANUNCIADA', fecha_fin: '2026-12-31' },
    fin_vigencia_potencial: '2026-12-31',
  },
  pronostico: { fin_probable: '2026-12-03' },
  ...extra,
});

test('adaptador: convierte un profesional al contrato ContratoVigencia', () => {
  const { datos, descartados, consultorPorId } = A.adaptarVigencias([profesional()]);
  assert.deepEqual(datos, [{ id: 'ABC', descripcion: 'Ana Campos Rojas', etiqueta: 'Ana Campos', inicio: '2026-07-01', fin: '2026-11-13', adenda: '2026-12-31', terminoProbable: '2026-12-03', historial: [], brechas: [], superposiciones: [] }]);
  assert.deepEqual(descartados, []);
  assert.equal(consultorPorId.ABC, 7);
});

test('adaptador: sin adenda siguiente o sin término probable, esos campos son null', () => {
  const p = profesional({ pronostico: null });
  p.vigencia = { ...p.vigencia, adenda_siguiente: null, fin_vigencia_potencial: null };
  const { datos } = A.adaptarVigencias([p]);
  assert.equal(datos[0].adenda, null);
  assert.equal(datos[0].terminoProbable, null);
});

test('adaptador: una adenda que no amplía la vigencia no se informa', () => {
  const p = profesional();
  p.vigencia.fin_vigencia_potencial = '2026-11-13';
  assert.equal(A.adaptarVigencias([p]).datos[0].adenda, null);
});

test('adaptador: acepta fechas-hora ISO y las recorta a AAAA-MM-DD', () => {
  const p = profesional();
  p.vigencia.fin_vigencia = '2026-11-13T00:00:00.000Z';
  p.pronostico = { fin_probable: '2026-12-03T05:00:00.000Z' };
  const f = A.adaptarVigencias([p]).datos[0];
  assert.equal(f.fin, '2026-11-13');
  assert.equal(f.terminoProbable, '2026-12-03');
});

test('adaptador: descarta y reporta los registros inválidos sin romper la vista', () => {
  const avisos = [];
  const original = console.warn;
  console.warn = (...a) => avisos.push(a);
  try {
    const sinAdenda = profesional({ clave: 'SIN', vigencia: { adenda_vigente: null, fin_vigencia: null } });
    const fechaMala = profesional({ clave: 'MAL' }); fechaMala.vigencia.fin_vigencia = '13/11/2026';
    const inexistente = profesional({ clave: 'INX' }); inexistente.vigencia.fin_vigencia = '2026-02-30';
    const invertida = profesional({ clave: 'INV' }); invertida.vigencia.fin_vigencia = '2026-06-30';
    const { datos, descartados, consultorPorId } = A.adaptarVigencias([profesional(), sinAdenda, fechaMala, inexistente, invertida]);
    assert.deepEqual(datos.map((d) => d.id), ['ABC']);
    assert.deepEqual(descartados.map((d) => d.clave), ['SIN', 'MAL', 'INX', 'INV']);
    assert.ok(descartados.every((d) => d.motivo));
    assert.deepEqual(Object.keys(consultorPorId), ['ABC']);
    assert.equal(avisos.length, 1, 'se reporta una vez en consola');
    // lo que queda es siempre procesable por el componente
    assert.doesNotThrow(() => C.computeRows(datos, { corte: '2026-11-04', umbralAtencion: 0 }));
  } finally { console.warn = original; }
});

test('nombreCorto: nombre y primer apellido', () => {
  assert.equal(A.nombreCorto('Pedro Bejar Quispe'), 'Pedro Bejar');
  assert.equal(A.nombreCorto('Carlos Álvarez Chumbiauca'), 'Carlos Álvarez');
  assert.equal(A.nombreCorto('Jenrry Yunior Montalbán Farroñan'), 'Jenrry Montalbán'); // dos nombres y dos apellidos
  assert.equal(A.nombreCorto('Ana Campos'), 'Ana Campos');
  assert.equal(A.nombreCorto('  Ana   Campos  Rojas '), 'Ana Campos'); // espacios sobrantes
  assert.equal(A.nombreCorto('Ana'), 'Ana');
  assert.equal(A.nombreCorto(''), '');
  assert.equal(A.nombreCorto(null), '');
});

test('adaptador: sin nombre, la etiqueta de la fila cae a la clave', () => {
  const { datos } = A.adaptarVigencias([profesional({ nombres: '' })]);
  assert.equal(datos[0].etiqueta, 'ABC');
});

test('adaptador: entrada vacía o ausente', () => {
  assert.deepEqual(A.adaptarVigencias([]).datos, []);
  assert.deepEqual(A.adaptarVigencias(undefined).datos, []);
});

test('adaptador con datos reales de la semilla: el componente los procesa sin errores', async () => {
  const repo = crearRepositorioMemoria({ semilla });
  const servicio = crearServicio(repo);
  await repo.guardarParametro('FECHA_CORTE', '2026-11-03', 'prueba');
  servicio.invalidar();
  const e = await servicio.estado({ corte: '2026-11-03' });
  // misma forma que entrega GET /api/estado (server.js)
  const consultores = e.consultores.map((it) => ({ consultor_id: it.consultor.consultor_id, clave: it.consultor.clave, nombres: it.consultor.nombres, vigencia: { ...it.vigencia }, pronostico: it.pronostico && { ...it.pronostico, actividades: undefined } }));
  const original = console.warn; console.warn = () => {};
  let r;
  try { r = A.adaptarVigencias(consultores); } finally { console.warn = original; }
  assert.equal(r.datos.length + r.descartados.length, consultores.length);
  assert.ok(r.datos.length >= 9, `se grafican la mayoría (${r.datos.length} de ${consultores.length})`);
  const filas = C.computeRows(r.datos, { corte: '2026-11-03', umbralAtencion: 0 });
  // coherencia con el servidor: sin cobertura en el gráfico ⇔ holgura negativa (ROJO por plan que excede la vigencia)
  for (const f of filas) {
    const it = e.consultores.find((x) => x.consultor.clave === f.id);
    if (f.brecha !== null) assert.equal(f.brecha, it.vigencia.holgura_dias, `${f.id}: brecha = holgura del servidor`);
    assert.equal(f.status === 'critical', it.vigencia.holgura_dias !== null && it.vigencia.holgura_dias < 0, `${f.id}: estado coherente con el servidor`);
  }
});

// ---------------------------------------------------------------- historial de adendas (gris) y días sin cobertura (rojo)
test('adaptador: pasa el historial concluido, los días sin cobertura y las superposiciones al componente', () => {
  const { datos } = A.adaptarVigencias([profesional({
    historial_adendas: [{ numero: 1, fecha_inicio: '2026-05-13', fecha_fin: '2026-08-10', plazo_dias: 90, plazo_solicitado_dias: null },
      { numero: 2, fecha_inicio: '2026-08-20', fecha_fin: '2026-11-08', plazo_dias: 60, plazo_solicitado_dias: 180 }],
    cobertura: { brechas: [{ desde: '2026-08-11', hasta: '2026-08-19', dias: 9 }], superposiciones: [{ desde: '2026-09-01', hasta: '2026-09-03', dias: 3 }] },
  })]);
  assert.deepEqual(datos[0].historial, [
    { numero: 1, inicio: '2026-05-13', fin: '2026-08-10', plazoDias: 90, plazoSolicitadoDias: null },
    { numero: 2, inicio: '2026-08-20', fin: '2026-11-08', plazoDias: 60, plazoSolicitadoDias: 180 }]);
  assert.deepEqual(datos[0].brechas, [{ inicio: '2026-08-11', fin: '2026-08-19', dias: 9 }]);
  assert.deepEqual(datos[0].superposiciones, [{ inicio: '2026-09-01', fin: '2026-09-03', dias: 3 }]);
});

test('tooltip con historial: adendas concluidas con plazo otorgado y solicitado, y los días sin cobertura', () => {
  const r = C.computeRows([{
    id: 'X', inicio: '2026-11-09', fin: '2026-12-31',
    historial: [{ numero: 1, inicio: '2026-05-13', fin: '2026-08-10', plazoDias: 90 }, { numero: 2, inicio: '2026-08-20', fin: '2026-10-18', plazoDias: 60, plazoSolicitadoDias: 180 }],
    brechas: [{ inicio: '2026-08-11', fin: '2026-08-19', dias: 9 }, { inicio: '2026-10-19', fin: '2026-11-08', dias: 21 }],
    superposiciones: [{ inicio: '2026-09-01', fin: '2026-09-03', dias: 3 }],
  }], { corte })[0];
  const filas = C.filasTooltip(r, { detalle: 'vigencia', historial: true });
  assert.deepEqual(filas.slice(0, 2), [['Adenda 01', '13/05/2026 – 10/08/2026 · 90 días'], ['Adenda 02', '20/08/2026 – 18/10/2026 · 60 días (solicitados 180)']]);
  assert.deepEqual(filas.filter((f) => f[0] === 'Sin cobertura').map((f) => f[1]), ['9 días (11/08/2026 – 19/08/2026)', '21 días (19/10/2026 – 08/11/2026)']);
  assert.ok(filas.some((f) => f[0] === 'Superposición'));
  assert.deepEqual(filas.slice(-2), [['Inicio', '09/11/2026'], ['Fin de vigencia', '31/12/2026']]);
  // sin el modo historial el tooltip no cambia
  assert.deepEqual(C.filasTooltip(r, { detalle: 'vigencia' }).map((f) => f[0]), ['Inicio', 'Fin de vigencia']);
});

test('con los datos reales de la semilla, el historial se grafica: 19 adendas concluidas y ninguna brecha', async () => {
  const servicio = crearServicio(crearRepositorioMemoria({ semilla }));
  const e = await servicio.estado({ corte: '2026-11-04' });
  // misma forma que entrega GET /api/estado (server.js)
  const consultores = e.consultores.map((it) => ({
    consultor_id: it.consultor.consultor_id, clave: it.consultor.clave, nombres: it.consultor.nombres, vigencia: { ...it.vigencia },
    pronostico: it.pronostico && { ...it.pronostico, actividades: undefined }, cobertura: it.cobertura,
    historial_adendas: it.adendas.filter((a) => a.estado === 'CONCLUIDA').map((a) => ({ numero: a.numero, fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin, plazo_dias: a.plazo_dias, plazo_solicitado_dias: a.plazo_solicitado_dias })),
  }));
  const original = console.warn; console.warn = () => {};
  let r;
  try { r = A.adaptarVigencias(consultores); } finally { console.warn = original; }
  assert.equal(r.datos.reduce((n, d) => n + d.historial.length, 0), 19);
  assert.ok(r.datos.every((d) => d.brechas.length === 0 && d.superposiciones.length === 0));
  const filas = C.computeRows(r.datos, { corte: '2026-11-04', umbralAtencion: 0 });
  // cada adenda concluida termina antes del inicio de la vigencia actual
  for (const f of filas) for (const h of f.hist) assert.ok(h.fin < f.ini, `${f.id}: Adenda ${h.numero} termina antes de la vigencia actual`);
});
