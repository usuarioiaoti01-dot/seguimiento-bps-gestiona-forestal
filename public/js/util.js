// Utilidades de interfaz: API, formato, avisos, modales y markdown seguro.

export const estado = { usuario: null, ia: false, modo: '', corte: '' };

export async function api(metodo, ruta, cuerpo) {
  const r = await fetch(`/api${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'X-SGF': '1' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    credentials: 'same-origin',
  });
  let datos = null;
  try { datos = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) {
    const err = new Error((datos && datos.error) || `Error ${r.status}`);
    err.estado = r.status;
    err.datos = datos || {};
    if (r.status === 401 && !ruta.startsWith('/auth/')) window.dispatchEvent(new Event('sgf:sesion-expirada'));
    if (r.status === 403 && datos && datos.cambiarClave) window.dispatchEvent(new Event('sgf:cambiar-clave'));
    throw err;
  }
  return datos;
}

/** Envía y, si el servidor exige motivo (reprogramación/anulación), lo pide y reintenta. */
export async function enviarConMotivo(metodo, ruta, cuerpo, titulo = 'Motivo del cambio') {
  try {
    return await api(metodo, ruta, cuerpo);
  } catch (err) {
    if (err.estado === 400 && err.datos.requiereMotivo) {
      const motivo = await pedirTexto(titulo, err.message, 'Ej.: Reprogramado por dependencia con el módulo de sedes (acta de reunión 05/11)');
      if (!motivo) throw Object.assign(new Error('Cambio cancelado'), { cancelado: true });
      return api(metodo, ruta, { ...cuerpo, motivo });
    }
    throw err;
  }
}

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ff = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
export const ffc = (s) => { if (!s) return '—'; const [, m, d] = String(s).slice(0, 10).split('-'); return `${d}/${m}`; };
export const fh = (s) => { if (!s) return '—'; const d = new Date(s); return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }); };
export const pct = (n) => (n === null || n === undefined ? '—' : `${Math.round(Number(n) * 10) / 10} %`);
export const dia = (s) => Math.round(Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`) / 86400000);
// Perfiles: PROFESIONAL (1) < JEFE_PROYECTO (2) < ADMIN (3). LECTOR y EDITOR son alias de nivel (1 y 2) que usan las vistas.
const NIVEL = { PROFESIONAL: 1, LECTOR: 1, JEFE_PROYECTO: 2, EDITOR: 2, ADMIN: 3 };
export const puede = (rol) => (NIVEL[estado.usuario?.rol] || 0) >= NIVEL[rol];
export const esProfesional = () => estado.usuario?.rol === 'PROFESIONAL';
export const NOMBRE_PERFIL = { ADMIN: 'Administrador', JEFE_PROYECTO: 'Jefe de Proyecto', PROFESIONAL: 'Profesional' };

export const ETIQ = {
  ALINEADA: ['Alineada', 'b-verde'], REASIGNADA: ['Reasignada', 'b-azul'], NUEVA: ['Nueva', 'b-ambar'], TRANSVERSAL: ['Transversal', 'b-gris'],
  PENDIENTE: ['Pendiente', 'b-gris'], EN_CURSO: ['En curso', 'b-azul'], CONCLUIDA: ['Concluida', 'b-verde'], SUSPENDIDA: ['Suspendida', 'b-ambar'], ANULADA: ['Anulada', 'b-gris'],
  ATRASADA: ['Atrasada', 'b-rojo'], SIN_INICIAR_VENCIDA: ['Sin iniciar (vencida)', 'b-rojo'], PROGRAMADA: ['Programada', 'b-gris'], EN_PLAZO: ['En plazo', 'b-verde'],
  FIRMADA: ['Firmada', 'b-verde'], ANUNCIADA: ['Anunciada', 'b-ambar'], EN_TRAMITE: ['En trámite', 'b-azul'],
  POR_REGISTRAR: ['Por registrar', 'b-ambar'], RECIBIDO: ['Recibido', 'b-azul'], OBSERVADO: ['Observado', 'b-rojo'], APROBADO: ['Aprobado', 'b-verde'],
  BORRADOR: ['Borrador', 'b-ambar'], RECHAZADO: ['Rechazado', 'b-rojo'],
  CONCLUIDO: ['Concluido', 'b-verde'], CUBIERTO: ['Cubierto', 'b-azul'], NO_CUBIERTO: ['No cubierto', 'b-rojo'],
  ALTA: ['Alta', 'b-rojo'], MEDIA: ['Media', 'b-ambar'], BAJA: ['Baja', 'b-gris'],
  VERDE: ['En plazo', 'b-verde'], AMBAR: ['Holgura baja', 'b-ambar'], ROJO: ['Excede vigencia', 'b-rojo'], GRIS: ['Sin plan', 'b-gris'],
};
export const badge = (k, texto) => { const [t, c] = ETIQ[k] || [k, 'b-gris']; return `<span class="badge ${c}">${esc(texto || t)}</span>`; };
export const semaforo = (s) => `<span class="punto p-${esc(s || 'GRIS')}" title="${esc((ETIQ[s] || [s])[0])}"></span>`;

export function diasBadge(n) {
  if (n === null || n === undefined) return '—';
  const c = n < 0 ? 'b-rojo' : n <= 10 ? 'b-rojo' : n <= 15 ? 'b-ambar' : 'b-gris';
  return `<span class="badge ${c} num">${n < 0 ? `vencida hace ${-n} d` : `${n} d`}</span>`;
}
export function holguraBadge(n) {
  if (n === null || n === undefined) return '<span class="mut2">—</span>';
  const c = n < 0 ? 'b-rojo' : n < 5 ? 'b-ambar' : 'b-verde';
  return `<span class="badge ${c} num">${n > 0 ? '+' : ''}${n} d</span>`;
}
export function barraAvance(real, esperado) {
  const r = Math.max(0, Math.min(100, Number(real) || 0));
  const e = Math.max(0, Math.min(100, Number(esperado) || 0));
  return `<div class="avance" title="Real ${pct(r)} · esperado ${pct(e)}"><div class="pista"><div class="real" style="width:${r}%"></div><div class="esp" style="left:${e}%"></div></div><small class="num">${pct(r)} <span class="mut2">/ esp. ${pct(e)}</span></small></div>`;
}

export function titulo(t, sub = '') {
  const el = document.getElementById('titulo');
  if (el) el.innerHTML = `<h1>${esc(t)}</h1>${sub ? `<small>${sub}</small>` : ''}`;
}

export function aviso(texto, tipo = '') {
  const el = document.createElement('div');
  el.className = `aviso ${tipo}`;
  el.textContent = texto;
  document.getElementById('avisos').appendChild(el);
  setTimeout(() => el.remove(), tipo === 'error' ? 7000 : 3500);
}
export const fallo = (err) => { if (!err.cancelado) aviso(err.message, 'error'); };

/** Modal genérico. contenido: HTML; botones: [{texto, clase, valor}] ; devuelve promesa con {valor, form}. */
export function modal({ titulo, contenido, botones = [{ texto: 'Cerrar', valor: null }], ancho, cerrarTexto = false }) {
  return new Promise((resolver) => {
    const velo = document.createElement('div');
    velo.className = 'velo';
    velo.innerHTML = `<div class="modal" role="dialog" aria-modal="true" ${ancho ? `style="width:min(${ancho}px,100%)"` : ''}>
      <div class="cab"><h2>${esc(titulo)}</h2><button class="cerrar${cerrarTexto ? ' texto' : ''}" aria-label="Cerrar">${cerrarTexto ? 'Cerrar' : '×'}</button></div>
      <form class="cuerpo" novalidate>${contenido}</form>
      ${botones.length ? `<div class="pie">${botones.map((b, i) => `<button type="button" class="btn ${b.clase || ''}" data-i="${i}">${esc(b.texto)}</button>`).join('')}</div>` : ''}</div>`;
    const cerrar = (valor) => { velo.remove(); document.removeEventListener('keydown', tecla); resolver({ valor, form: velo.querySelector('form'), datos: datosForm(velo.querySelector('form')) }); };
    const tecla = (e) => { if (e.key === 'Escape') cerrar(null); };
    document.addEventListener('keydown', tecla);
    velo.querySelector('.cerrar').onclick = () => cerrar(null);
    velo.addEventListener('mousedown', (e) => { if (e.target === velo) cerrar(null); });
    velo.querySelectorAll('.pie button').forEach((b) => { b.onclick = () => cerrar(botones[b.dataset.i].valor); });
    velo.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); const prim = botones.find((b) => b.clase && b.clase.includes('prim')); if (prim) cerrar(prim.valor); });
    document.body.appendChild(velo);
    const primero = velo.querySelector('input, select, textarea');
    if (primero) primero.focus();
  });
}
export function datosForm(form) {
  const out = {};
  if (!form) return out;
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked ? 1 : 0;
    else out[el.name] = el.value === '' ? null : el.value;
  }
  return out;
}
export async function pedirTexto(titulo, explicacion, ejemplo = '') {
  const r = await modal({
    titulo,
    contenido: `<p class="mut" style="margin:0">${esc(explicacion)}</p><div class="campo"><label>Motivo (quedará en la bitácora)</label><textarea name="texto" placeholder="${esc(ejemplo)}" required></textarea></div>`,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Confirmar', clase: 'prim', valor: 'ok' }],
  });
  return r.valor === 'ok' ? (r.datos.texto || '').trim() : null;
}
export const opciones = (lista, actual) => lista.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(actual ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('');

/** Markdown mínimo y seguro (se escapa primero): títulos, negrita, cursiva, listas, tablas, código. */
export function markdown(texto) {
  const lineas = esc(texto || '').split(/\r?\n/);
  const out = [];
  let lista = null;
  let tabla = [];
  const inline = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  const cerrarLista = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };
  const cerrarTabla = () => {
    if (!tabla.length) return;
    const filas = tabla.filter((f) => !/^\s*\|?\s*:?-{2,}/.test(f));
    const celdas = (f) => f.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => inline(c.trim()));
    out.push(`<div class="tabla-env"><table><thead><tr>${celdas(filas[0]).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${filas.slice(1).map((f) => `<tr>${celdas(f).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    tabla = [];
  };
  for (const l of lineas) {
    if (/^\s*\|.*\|\s*$/.test(l)) { cerrarLista(); tabla.push(l); continue; }
    cerrarTabla();
    let m;
    if ((m = l.match(/^\s*#{1,4}\s+(.*)$/))) { cerrarLista(); out.push(`<p><b>${inline(m[1])}</b></p>`); }
    else if ((m = l.match(/^\s*[-*•]\s+(.*)$/))) { if (lista !== 'ul') { cerrarLista(); out.push('<ul>'); lista = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { if (lista !== 'ol') { cerrarLista(); out.push('<ol>'); lista = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if (!l.trim()) { cerrarLista(); }
    else { cerrarLista(); out.push(`<p>${inline(l)}</p>`); }
  }
  cerrarTabla(); cerrarLista();
  return out.join('');
}

export const ICONOS = {
  tablero: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  seguimiento: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg>',
  adendas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>',
  lb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h10M4 12h16M4 18h7"/><circle cx="18" cy="6" r="2"/><circle cx="15" cy="18" r="2"/></svg>',
  bitacora: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  config: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  ia: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>',
  logo: '<svg width="34" height="34" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="rgba(255,255,255,.14)"/><path d="M16 5l7 10h-4l5 7h-5v5h-6v-5H8l5-7H9z" fill="#e8f3ec"/></svg>',
};
