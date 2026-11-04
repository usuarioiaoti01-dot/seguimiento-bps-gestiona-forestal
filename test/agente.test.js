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
  const usuario = { correo: 'editor@serfor.gob.pe', nombre: 'Editor', rol: 'JEFE_PROYECTO' };
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
  await assert.rejects(() => agente.conversar({ texto: 'hola', usuario: { correo: 'x@y.pe', nombre: 'X', rol: 'JEFE_PROYECTO' } }), (e) => e.estado === 503);
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

test('consultar_historial_adendas: plazos solicitados frente a otorgados, cobertura y sin datos personales', async () => {
  const repo = crearRepositorioMemoria({ semilla });
  const servicio = crearServicio(repo);
  const d = await servicio.datos(true);
  const c = d.consultores.find((x) => x.clave === 'CAC');
  await repo.actualizar('consultor', c.consultor_id, { dni: '45678912', telefono: '977123456', correo_personal: 'carlos.privado@ejemplo.pe' },
    { revision: c.revision, usuario: 'admin@serfor.gob.pe', motivo: 'Datos de prueba', origen: 'UI', consultor_id: c.consultor_id });
  servicio.invalidar();

  const cliente = clienteSimulado([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'consultar_historial_adendas', input: { clave: 'CAC' } }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'consultar_historial_adendas', input: {} }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Listo.' }] },
  ]);
  const agente = crearAgente({ servicio, cliente });
  await agente.conversar({ texto: '¿Qué plazos se pidieron y cuáles se otorgaron?', usuario: { correo: 'admin@serfor.gob.pe', nombre: 'Admin', rol: 'ADMIN' } });

  // el cliente simulado conserva una sola lista de mensajes: se buscan los resultados de las herramientas por su id
  const resultado = (id) => JSON.parse(cliente.llamadas.at(-1).messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((x) => x.type === 'tool_result' && x.tool_use_id === id).content);
  const [cac] = resultado('t1');
  assert.equal(cac.clave, 'CAC');
  const ad2 = cac.adendas.find((a) => a.numero === 2);
  assert.equal(ad2.estado, 'CONCLUIDA');
  assert.equal(ad2.plazo_otorgado_dias, 60);
  assert.equal(ad2.plazo_solicitado_dias, 180);
  assert.equal(ad2.diferencia_dias, 120);
  assert.equal(ad2.inicio_calculado, false);
  assert.equal(cac.adendas.find((a) => a.numero === 1).inicio_calculado, true);
  assert.equal(cac.cobertura.dias_sin_cobertura, 0);
  assert.equal(cac.cobertura.consistente, true);

  const todos = resultado('t2');
  assert.equal(todos.length, semilla.consultores.length);
  const enviado = JSON.stringify(cliente.llamadas.map((l) => l.messages));
  assert.ok(!/45678912|977123456|carlos\.privado/.test(enviado), 'ningún dato personal llega al modelo');
});

test('Profesional: el asistente solo consulta su propia información', async () => {
  const servicio = crearServicio(crearRepositorioMemoria({ semilla }));
  const d = await servicio.datos(true);
  const yo = d.consultores.find((x) => x.clave === 'CAC');
  const otro = d.consultores.find((x) => x.clave === 'ERB');
  const actividadAjena = d.actividades.find((a) => d.planes.find((p) => p.plan_id === a.plan_id).consultor_id === otro.consultor_id && !a.es_resumen);
  const cliente = clienteSimulado([
    { stop_reason: 'tool_use', content: [
      { type: 'tool_use', id: 't1', name: 'detalle_consultor', input: { clave: 'ERB' } },
      { type: 'tool_use', id: 't2', name: 'resumen_portafolio', input: {} },
      { type: 'tool_use', id: 't3', name: 'listar_alertas', input: {} },
      { type: 'tool_use', id: 't4', name: 'consultar_historial_adendas', input: { clave: 'ASL' } },
      { type: 'tool_use', id: 't5', name: 'simular_cambios', input: { cambios: [{ actividad_id: actividadAjena.actividad_id, avance: 100 }] } },
      { type: 'tool_use', id: 't6', name: 'proponer_cambios', input: { resumen: 'x', motivo: 'xxxxx', cambios: [] } },
      { type: 'tool_use', id: 't7', name: 'consultar_bitacora', input: {} },
      { type: 'tool_use', id: 't8', name: 'detalle_consultor', input: {} },
    ] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Listo.' }] },
  ]);
  const agente = crearAgente({ servicio, cliente });
  await agente.conversar({ texto: '¿Cómo va ERB?', usuario: { correo: 'carlos@ejemplo.com', nombre: 'Carlos', rol: 'PROFESIONAL', consultor_id: yo.consultor_id }, consultor_id: otro.consultor_id });

  // el modelo ni siquiera dispone de la herramienta que propone cambios, y sabe a quién atiende
  assert.ok(!cliente.llamadas[0].tools.some((t) => t.name === 'proponer_cambios'));
  assert.match(cliente.llamadas[0].system[0].text, /PERFIL PROFESIONAL: esta persona es Carlos/);
  assert.match(cliente.llamadas[0].messages[0].content, new RegExp(yo.clave), 'la pantalla de contexto es la propia, no la que se pidió');
  assert.ok(!cliente.llamadas[0].messages[0].content.includes(otro.nombres));

  const res = (id) => JSON.parse(cliente.llamadas.at(-1).messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((x) => x.type === 'tool_result' && x.tool_use_id === id).content);
  assert.match(res('t1').error, /propia información/, 'no consulta a otro profesional');
  assert.deepEqual(res('t2').consultores.map((c) => c.clave), ['CAC'], 'el resumen es solo el suyo');
  assert.ok(!('indicadores' in res('t2')), 'sin indicadores del portafolio');
  assert.ok(res('t3').every((a) => a.clave === 'CAC'), 'solo sus alertas');
  assert.match(res('t4').error, /propia información/);
  assert.match(res('t5').error, /propia información/, 'no simula actividades ajenas');
  assert.match(res('t6').error, /desconocida/, 'no propone cambios');
  assert.ok(Array.isArray(res('t7')), 'su bitácora');
  assert.equal(res('t8').consultor.clave, 'CAC', 'sin clave, usa la propia');
  const enviado = JSON.stringify(cliente.llamadas.map((l) => l.messages));
  assert.ok(!enviado.includes(otro.nombres), 'ningún dato de otro profesional llega al modelo');
});
