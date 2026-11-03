'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
// Aislar las pruebas del .env: sin clave real, ninguna prueba puede llamar a la API de Anthropic.
// (config.js no pisa variables ya definidas, aun vacías; debe fijarse antes de cargar los módulos.)
process.env.ANTHROPIC_API_KEY = '';
const { crearRepositorioMemoria } = require('../server/datos/memoria');
const { crearServicio } = require('../server/servicio');
const { crearAgente } = require('../server/ia/agente');
const semilla = require('../data/semilla.json');

/** Cliente simulado que reproduce el ciclo de herramientas de la API de mensajes. */
function clienteSimulado(guion) {
  const llamadas = [];
  return {
    llamadas,
    messages: {
      async create(req) {
        llamadas.push(req);
        const paso = guion[llamadas.length - 1];
        return { ...paso, usage: { input_tokens: 100, output_tokens: 20 } };
      },
    },
  };
}

test('el agente usa herramientas, propone cambios y la propuesta se aplica con trazabilidad', async () => {
  const repo = crearRepositorioMemoria({ semilla });
  const servicio = crearServicio(repo);
  await repo.guardarParametro('FECHA_CORTE', '2026-11-03', 'prueba');
  servicio.invalidar();
  const d = await servicio.datos(true);
  const plan = d.planes.find((p) => d.consultores.find((c) => c.clave === 'APA').consultor_id === p.consultor_id);
  const act = d.actividades.find((a) => a.plan_id === plan.plan_id && a.numero === '1');

  const cliente = clienteSimulado([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'detalle_consultor', input: { clave: 'APA' } }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'proponer_cambios', input: { resumen: 'Registrar actividad 1 concluida', motivo: 'Confirmado en reunión de seguimiento', cambios: [{ tipo: 'actualizar_actividad', actividad_id: act.actividad_id, campos: { estado: 'CONCLUIDA', fin_real: '2026-10-21' } }] } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Preparé la propuesta; aplíquela con el botón.' }] },
  ]);
  const agente = crearAgente({ servicio, cliente });
  const usuario = { correo: 'editor@serfor.gob.pe', nombre: 'Editor', rol: 'EDITOR' };
  const r = await agente.conversar({ texto: '¿Cómo va Armando Pimentel?', usuario });

  assert.equal(r.respuesta, 'Preparé la propuesta; aplíquela con el botón.');
  assert.deepEqual(r.herramientas, ['detalle_consultor', 'proponer_cambios']);
  assert.equal(r.propuestas.length, 1);
  assert.equal(r.uso.entrada, 300);
  // La respuesta de la herramienta no expone datos personales
  const resultado = JSON.stringify(cliente.llamadas[1].messages);
  assert.ok(!/dni|telefono|correo_personal/.test(resultado));
  // Nada se guardó antes de aplicar
  servicio.invalidar();
  assert.equal((await servicio.datos(true)).actividades.find((a) => a.actividad_id === act.actividad_id).estado, 'PENDIENTE');

  await agente.aplicarPropuesta(r.propuestas[0].propuesta_id, usuario);
  servicio.invalidar();
  const despues = (await servicio.datos(true)).actividades.find((a) => a.actividad_id === act.actividad_id);
  assert.equal(despues.estado, 'CONCLUIDA');
  const bit = await repo.listarBitacora({ entidad: 'actividad', entidad_id: act.actividad_id });
  assert.equal(bit[0].origen, 'IA');
  assert.match(bit[0].motivo, /aprobada por Editor/);
  const msgs = await repo.listarMensajes(r.conversacion_id);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].tokens_entrada, 300);
});

test('sin clave de API el asistente responde 503 con un mensaje claro', async () => {
  const servicio = crearServicio(crearRepositorioMemoria({ semilla }));
  const agente = crearAgente({ servicio });
  await assert.rejects(() => agente.conversar({ texto: 'hola', usuario: { correo: 'x@y.pe', nombre: 'X', rol: 'LECTOR' } }), (e) => e.estado === 503);
});

test('consultar_bitacora no entrega datos personales al modelo, aunque el usuario sea ADMIN', async () => {
  const repo = crearRepositorioMemoria({ semilla });
  const servicio = crearServicio(repo);
  const d = await servicio.datos(true);
  const c = d.consultores.find((x) => x.clave === 'APA');
  // Un ADMIN registra datos personales: quedan en la bitácora (trazabilidad)
  await repo.actualizar('consultor', c.consultor_id, { dni: '87654321', telefono: '999111222', correo_personal: 'privado@ejemplo.pe', observacion: 'dato de prueba' },
    { revision: c.revision, usuario: 'admin@serfor.gob.pe', motivo: 'Actualización de datos', origen: 'UI', consultor_id: c.consultor_id });
  const crudo = JSON.stringify(await repo.listarBitacora({ consultor_id: c.consultor_id }));
  assert.match(crudo, /87654321/, 'la bitácora conserva el valor para el ADMIN');

  const cliente = clienteSimulado([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'consultar_bitacora', input: { clave: 'APA' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Listo.' }] },
  ]);
  const agente = crearAgente({ servicio, cliente });
  await agente.conversar({ texto: 'Historial de APA', usuario: { correo: 'admin@serfor.gob.pe', nombre: 'Admin', rol: 'ADMIN' } });
  const enviado = JSON.stringify(cliente.llamadas[1].messages);
  assert.ok(!/87654321|999111222|privado@ejemplo/.test(enviado), 'ningún valor personal llega al modelo');
  assert.match(enviado, /dato de prueba/, 'el resto de los cambios sí se informa');
});
