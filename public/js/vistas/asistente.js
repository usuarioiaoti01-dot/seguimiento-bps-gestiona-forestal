import { api, estado, esc, ff, markdown, ICONOS, puede, aviso, fallo, badge } from '../util.js';

const SUGERENCIAS = [
  '¿Qué contratos vencen en los próximos 15 días y qué falta para renovarlos?',
  '¿Qué planes no caben en su vigencia y qué actividades los empujan?',
  'Redacta un correo a BPS solicitando el estado de las adendas pendientes',
  '¿Qué entregables de la línea base quedaron sin responsable?',
];

let conversacion = null;
let panel = null;
let contextoConsultor = null;

export function montarAsistente() {
  if (document.querySelector('.fab')) return;
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.innerHTML = `${ICONOS.ia} Asistente IA`;
  fab.onclick = () => abrirAsistente({});
  document.body.appendChild(fab);
}

export function abrirAsistente({ consultor_id = null, texto = '' } = {}) {
  contextoConsultor = consultor_id;
  if (!panel) crearPanel();
  panel.style.display = 'flex';
  const t = panel.querySelector('textarea');
  if (texto) t.value = texto;
  t.focus();
}

function crearPanel() {
  panel = document.createElement('aside');
  panel.className = 'asistente';
  panel.setAttribute('aria-label', 'Asistente de IA');
  panel.innerHTML = `<div class="cab">${ICONOS.ia}<div><b>Asistente de seguimiento</b><br><span class="mut2">Claude Haiku · consulta, simula y propone; usted aprueba</span></div>
      <button class="btn peq" id="ia-nueva" title="Nueva conversación">Nueva</button><button class="cerrar" id="ia-cerrar" aria-label="Cerrar">×</button></div>
    <div class="chat" id="ia-chat">${estado.ia ? '<div class="msg assistant"><p>Hola. Puedo revisar vigencias, fechas probables, actividades críticas y la línea base; simular reprogramaciones y preparar propuestas de actualización que usted aplica. ¿Qué necesita?</p></div>' : '<div class="msg assistant"><p>El asistente no está configurado en este servidor. Un administrador debe definir <code>ANTHROPIC_API_KEY</code> en el archivo .env.</p></div>'}</div>
    <div class="sugerencias">${SUGERENCIAS.map((s) => `<button>${esc(s)}</button>`).join('')}</div>
    <form class="entrada"><textarea placeholder="Escriba su consulta… (Enter envía, Mayús+Enter nueva línea)"></textarea><button class="btn prim" type="submit">Enviar</button></form>`;
  document.body.appendChild(panel);
  const chat = panel.querySelector('#ia-chat');
  const t = panel.querySelector('textarea');
  panel.querySelector('#ia-cerrar').onclick = () => { panel.style.display = 'none'; };
  panel.querySelector('#ia-nueva').onclick = () => { conversacion = null; chat.innerHTML = '<div class="msg assistant"><p>Nueva conversación iniciada.</p></div>'; };
  panel.querySelectorAll('.sugerencias button').forEach((b) => { b.onclick = () => { t.value = b.textContent; enviar(); }; });
  t.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } });
  panel.querySelector('form').onsubmit = (e) => { e.preventDefault(); enviar(); };

  async function enviar() {
    const texto = t.value.trim();
    if (!texto) return;
    t.value = '';
    agregar('user', `<p>${esc(texto)}</p>`);
    const espera = agregar('assistant', '<span class="escribiendo">Analizando con las herramientas del sistema…</span>');
    try {
      const r = await api('POST', '/ia/mensaje', { texto, conversacion_id: conversacion, consultor_id: contextoConsultor });
      conversacion = r.conversacion_id;
      espera.innerHTML = `${markdown(r.respuesta)}<div class="meta">${esc(r.modelo)} · ${r.uso.entrada.toLocaleString('es-PE')} tokens entrada / ${r.uso.salida.toLocaleString('es-PE')} salida${r.herramientas.length ? ` · consultó: ${esc([...new Set(r.herramientas)].join(', '))}` : ''}</div>`;
      for (const p of r.propuestas) chat.appendChild(tarjetaPropuesta(p));
    } catch (err) {
      espera.innerHTML = `<p class="bad">${esc(err.message)}</p>`;
    }
    chat.scrollTop = chat.scrollHeight;
  }
  function agregar(rol, html) {
    const m = document.createElement('div');
    m.className = `msg ${rol}`;
    m.innerHTML = html;
    chat.appendChild(m);
    chat.scrollTop = chat.scrollHeight;
    return m;
  }
}

function tarjetaPropuesta(p) {
  const el = document.createElement('div');
  el.className = 'propuesta';
  const cambios = p.cambios.map((c) => `<li><b>${esc(c.tipo.replace('_', ' '))}</b> ${c.actividad_id ? `act. ${c.actividad_id}` : c.adenda_id ? `adenda ${c.adenda_id}` : c.plan_id ? `plan ${c.plan_id}` : ''}: ${esc(Object.entries(c.campos || {}).map(([k, v]) => `${k} = ${v}`).join(', '))}</li>`).join('');
  const imp = (p.impacto || []).map((i) => `<li>${esc(i.clave)}: término probable ${ff(i.fin_probable_antes)} → <b>${ff(i.fin_probable_despues)}</b> · ${badge(i.semaforo_antes)} → ${badge(i.semaforo_despues)}</li>`).join('');
  el.innerHTML = `<div><b>Propuesta:</b> ${esc(p.resumen)}</div><ul style="margin:0 0 0 18px;padding:0">${cambios}</ul>
    ${imp ? `<div><b>Impacto simulado</b><ul style="margin:0 0 0 18px;padding:0">${imp}</ul></div>` : ''}
    <div class="mut2">Motivo para la bitácora: ${esc(p.motivo)}</div>
    <div class="acciones">${puede('EDITOR') ? '<button class="btn prim peq" data-a="aplicar">Aplicar cambios</button>' : '<span class="mut2">Requiere rol Editor para aplicar.</span>'}<button class="btn peq" data-a="descartar">Descartar</button></div>`;
  el.querySelector('[data-a="descartar"]').onclick = () => { el.remove(); };
  const ap = el.querySelector('[data-a="aplicar"]');
  if (ap) ap.onclick = async () => {
    ap.disabled = true;
    try {
      const r = await api('POST', '/ia/aplicar', { propuesta_id: p.propuesta_id });
      el.querySelector('.acciones').innerHTML = `<span class="ok">✓ ${r.aplicados} cambio(s) aplicado(s) y registrados en la bitácora con origen IA.</span>`;
      aviso('Propuesta aplicada · pronóstico recalculado', 'exito');
      window.sgfRefrescar();
    } catch (err) { ap.disabled = false; fallo(err); }
  };
  return el;
}
