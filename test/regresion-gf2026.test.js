'use strict';
/**
 * Regresión de GF2026 (criterio C7 de PLAN_DE_MEJORAS.md): el estado calculado del proyecto atípico
 * (vigencias, holguras, semáforos, cobertura, pronósticos, alertas e indicadores) no debe cambiar con
 * las mejoras. La instantánea se guardó antes de la Etapa 1.
 * Para regenerarla A PROPÓSITO (un cambio de regla aprobado): ACTUALIZAR_INSTANTANEA=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { crearRepositorioMemoria } = require('../server/datos/memoria');
const { construirEstado } = require('../server/motor/estado');
const semilla = require('../data/semilla.json');

const ARCHIVO = path.join(__dirname, 'fixtures', 'gf2026-estado.json');
const CORTES = ['2026-08-17', '2026-11-24', '2027-01-15'];
// Columnas que se agregaron a las tablas después de guardar la instantánea: son datos nuevos, no cálculo, y se ignoran.
// (Nunca agregue aquí un campo calculado: si el cálculo cambia, la prueba debe fallar.)
const COLUMNAS_POSTERIORES = new Set(['tipo_periodo']); // db/17
const sinPosteriores = (v) => (Array.isArray(v) ? v.map(sinPosteriores)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !COLUMNAS_POSTERIORES.has(k)).map(([k, x]) => [k, sinPosteriores(x)])) : v);

function foto(e) {
  return {
    corte: e.corte,
    indicadores: e.indicadores,
    consultores: e.consultores.map((it) => ({
      clave: it.consultor.clave,
      contrato: it.contrato && it.contrato.numero,
      vigencia: it.vigencia,
      cobertura: it.cobertura,
      plan: it.plan ? { plan_id: it.plan.plan_id, estado: it.plan.estado } : null,
      pronostico: it.pronostico ? { inicio_plan: it.pronostico.inicio_plan, fin_plan: it.pronostico.fin_plan, fin_probable: it.pronostico.fin_probable, avance_ponderado: it.pronostico.avance_ponderado, avance_esperado: it.pronostico.avance_esperado, spi: it.pronostico.spi } : null,
      lb: (it.linea_base || []).length,
    })),
    alertas: e.alertas.map((a) => ({ prioridad: a.prioridad, codigo: a.codigo, clave: a.clave, titulo: a.titulo })),
  };
}

test('GF2026: el estado calculado no cambia (instantánea previa a la Etapa 1)', async () => {
  const repo = crearRepositorioMemoria({ semilla });
  const datos = await repo.cargarTodo();
  const gf = datos.proyectos.find((p) => p.codigo === 'GF2026');
  assert.ok(gf, 'existe el proyecto GF2026');
  const actual = CORTES.map((corte) => foto(construirEstado(datos, { corte, proyecto_id: gf.proyecto_id })));
  if (process.env.ACTUALIZAR_INSTANTANEA === '1') {
    fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true });
    fs.writeFileSync(ARCHIVO, `${JSON.stringify(actual, null, 1)}\n`);
  }
  const esperado = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
  assert.deepEqual(sinPosteriores(JSON.parse(JSON.stringify(actual))), esperado);
});
