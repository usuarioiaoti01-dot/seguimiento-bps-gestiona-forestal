'use strict';
// Carga del historial de adendas (Adendas 01 y 02) en el modo demostración.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.ANTHROPIC_API_KEY = '';
const { crearRepositorioMemoria } = require('../server/datos/memoria');
const semilla = require('../data/semilla.json');

test('la semilla incluye 19 adendas concluidas ligadas a su contrato por número', async () => {
  const d = await crearRepositorioMemoria({ semilla }).cargarTodo();
  assert.equal(d.adendas.length, 34);
  const concluidas = d.adendas.filter((a) => a.estado === 'CONCLUIDA');
  assert.equal(concluidas.length, 19);
  const ctr = (n) => d.contratos.find((k) => k.numero.startsWith(n));
  const kap = concluidas.filter((a) => a.contrato_id === ctr('057').contrato_id);
  assert.deepEqual(kap.map((a) => [a.numero, a.fecha_inicio, a.fecha_fin, a.plazo_dias, a.plazo_solicitado_dias, a.inicio_calculado]),
    [[1, '2026-06-02', '2026-08-30', 90, null, 1], [2, '2026-08-31', '2026-10-29', 60, 180, 0]]);
  // los contratos 026 y 029 del Excel de Adendas 03 no existen: el historial usa 057 y 064
  assert.equal(d.contratos.some((k) => /^(026|029)-/.test(k.numero)), false);
});

test('un estado demo guardado antes del historial lo recibe una sola vez y sin tocar lo existente', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgf-hist-'));
  const archivo = path.join(dir, 'demo.json');
  const vieja = JSON.parse(JSON.stringify(semilla));
  vieja.adendas = vieja.adendas.filter((a) => a.estado !== 'CONCLUIDA');
  vieja.adendas.find((a) => a.numero === 3).observacion = 'editada por un usuario';
  fs.writeFileSync(archivo, JSON.stringify({ ...vieja, usuarios: [], bitacora: [], historial: [], recalculos: [], actividad_pronostico: {}, plan_pronostico: {}, plan_pronostico_historial: [], ia_conversaciones: [], ia_mensajes: [] }));

  const una = await crearRepositorioMemoria({ semilla, archivo }).cargarTodo();
  assert.equal(una.adendas.length, 34);
  assert.ok(una.adendas.some((a) => a.observacion === 'editada por un usuario'), 'lo ya existente se conserva');
  assert.equal(new Set(una.adendas.map((a) => a.adenda_id)).size, 34, 'ids únicos');

  // idempotente: cargar de nuevo el mismo archivo ya completo no duplica
  const repo = crearRepositorioMemoria({ semilla, archivo });
  assert.equal((await repo.cargarTodo()).adendas.length, 34);
  const bit = await repo.listarBitacora({ limite: 50 });
  assert.equal(bit.filter((b) => /historial de adendas/i.test(b.motivo || '')).length, 1);
});
