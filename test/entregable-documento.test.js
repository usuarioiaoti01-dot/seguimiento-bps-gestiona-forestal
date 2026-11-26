'use strict';
/**
 * Lectura del documento de un entregable (server/documentos/entregable.js): fecha de presentación (sello de
 * recepción o fecha del documento), documento y expediente, número de entregable, y validaciones de la fecha.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { extraerEntregableSinIA, fechasDe, crearLectorEntregables } = require('../server/documentos/entregable');
const { hoyLima } = require('../server/motor/calendario');

const CARTA = `Lima, 20 de setiembre de 2026
CARTA N° 005-2026-JJAA
Señores: Oficina de Tecnologías de la Información
Asunto: Presentación del primer entregable - Diagnóstico técnico
Me dirijo a ustedes para remitir el Primer entregable de la Orden de Servicio N° 1279.
RECIBIDO - MESA DE PARTES 22/09/2026 10:15
Expediente N° 2026-0045123
Pago: S/ 9,000.00`;

test('sin IA: fecha de recepción antes que la del documento, documento, expediente y número de entregable', () => {
  const r = extraerEntregableSinIA(CARTA);
  assert.equal(r.fecha, '2026-09-22');
  assert.equal(r.fuente_fecha, 'RECEPCION');
  assert.equal(r.documento, 'Carta N.° 005-2026-JJAA');
  assert.equal(r.expediente, '2026-0045123');
  assert.equal(r.entregable_numero, 1);
  assert.equal(r.observacion, 'Presentado con Carta N.° 005-2026-JJAA, expediente 2026-0045123');
  // sin sello: la fecha del documento
  const s = extraerEntregableSinIA('Lima, 3 de octubre de 2026\nINFORME N° 02-2026\nSegundo entregable');
  assert.deepEqual([s.fecha, s.fuente_fecha, s.entregable_numero], ['2026-10-03', 'DOCUMENTO', 2]);
  assert.deepEqual(fechasDe('31/02/2026 y 2026-09-01').map((x) => x.f), ['2026-09-01']); // fechas imposibles fuera
  assert.equal(extraerEntregableSinIA('texto sin datos').fecha, null);
});

test('lector: valida la fecha, avisa si es otro entregable y la IA no recibe importes', async () => {
  const d = {
    entregables_servicio: [{ entregable_servicio_id: 5, contrato_id: 9, numero: 2, estado: 'PENDIENTE', fecha_limite: '2026-09-21', activo: 1 }],
    contratos: [{ contrato_id: 9, fecha_inicio: '2026-08-26' }],
  };
  const archivos = { t: { nombre: 'carta.pdf', buffer: Buffer.from('x'), formato: 'pdf' }, img: { nombre: 'foto.jpg', buffer: Buffer.from('x'), formato: 'jpg' } };
  const contrataciones = { tomarTemporal: (tok) => { if (!archivos[tok]) throw Object.assign(new Error('Adjunte'), { estado: 400 }); return archivos[tok]; } };
  let enviado = '';
  const sinIA = crearLectorEntregables({ servicio: { datos: async () => d }, contrataciones, leerDocumento: async () => ({ texto: CARTA }) });
  const r = await sinIA.leer(5, 't', { usuario: 'a' });
  assert.equal(r.origen, 'TEXTO');
  assert.equal(r.fecha, '2026-09-22');
  assert.equal(r.dias_atraso, 1);
  assert.equal(r.coincide, false);
  assert.match(r.advertencias.join(' '), /parece corresponder al entregable 1, no al 2/);
  // imagen: no se lee
  assert.equal((await sinIA.leer(5, 'img', { usuario: 'a' })).origen, null);
  await assert.rejects(sinIA.leer(99, 't', { usuario: 'a' }), /Entregable no encontrado/);
  // con IA: manda la IA; fecha futura se reemplaza por hoy
  const conIA = crearLectorEntregables({ servicio: { datos: async () => d }, contrataciones, leerDocumento: async () => ({ texto: CARTA }),
    extraerConIA: async ({ texto }, modo) => { enviado = texto; assert.equal(modo, 'entregable'); return { entregable: { fecha: '2099-01-01', entregable_numero: 2, documento: 'Carta N.° 005-2026' } }; } });
  const r2 = await conIA.leer(5, 't', { usuario: 'a' });
  assert.doesNotMatch(enviado, /9,000/);
  assert.equal(r2.origen, 'IA');
  assert.equal(r2.fecha, hoyLima());
  assert.equal(r2.coincide, true);
  assert.equal(r2.observacion, 'Presentado con Carta N.° 005-2026, expediente 2026-0045123');
  assert.match(r2.advertencias.join(' '), /posterior a hoy/);
  // fecha anterior al inicio del servicio: no se propone
  const viejo = crearLectorEntregables({ servicio: { datos: async () => d }, contrataciones, leerDocumento: async () => ({ texto: 'Lima, 1 de enero de 2026\nCarta N° 1-2026' }) });
  const r3 = await viejo.leer(5, 't', { usuario: 'a' });
  assert.equal(r3.fecha, null);
  assert.match(r3.advertencias.join(' '), /anterior al inicio del servicio/);
});
