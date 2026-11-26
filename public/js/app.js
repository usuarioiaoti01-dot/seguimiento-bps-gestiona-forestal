// Punto de entrada: sesión, estructura (menú lateral + cabecera, OTI Visual v2), enrutador y asistente.
import { api, estado, esc, ff, aviso, fallo, ICONOS, modal, esProfesional, NOMBRE_PERFIL, semInfo, accionesCabecera } from './util.js';
import { vistaTablero } from './vistas/tablero.js';
import { vistaConsultor } from './vistas/consultor.js';
import { vistaSeguimiento } from './vistas/seguimiento.js';
import { vistaAdendas } from './vistas/adendas.js';
import { vistaFormular } from './vistas/formulacion.js';
import { vistaLineaBase } from './vistas/lineabase.js';
import { vistaBitacora } from './vistas/bitacora.js';
import { vistaConfiguracion } from './vistas/configuracion.js';
import { vistaProyectos, cargarProyectos, fijarProyecto, pintarSelectorProyecto } from './vistas/proyectos.js';
import { vistaActualizarArchivo } from './vistas/actualizar-archivo.js';
import { vistaSupervision } from './vistas/supervision.js';
import { vistaPortafolio } from './vistas/portafolio.js';
import { vistaExpediente } from './vistas/expediente.js';
import { abrirAsistente } from './vistas/asistente.js';

const raiz = document.getElementById('app');
export const NOMBRE_APP = 'Seguimiento de Proyectos OTI';
export const AREA_APP = 'Oficina de Tecnologías de la Información';
const LOGO = '<img src="img/serfor.png" alt="SERFOR – Servicio Nacional Forestal y de Fauna Silvestre" width="265" height="60">';

const RUTAS = [
  { patron: /^#?\/?$/, vista: vistaPortafolio, menu: 'portafolio' }, // tablero general: todos los proyectos (Etapa 4)
  { patron: /^#\/plazos$/, vista: vistaTablero, menu: 'tablero' }, // tablero del proyecto elegido (Adendas - Plazos / Plazos - Vencimientos)
  { patron: /^#\/seguimiento(?:\/(atrasadas|exceden))?$/, vista: vistaSeguimiento, menu: 'seguimiento' },
  { patron: /^#\/consultor\/(\d+)$/, vista: vistaConsultor, menu: 'seguimiento' },
  { patron: /^#\/contrato\/(\d+)$/, vista: (el, [id]) => vistaConsultor(el, [id], 'contrato'), menu: 'adendas' }, // ficha desde Contratos y adendas: sin plan de trabajo
  { patron: /^#\/adendas$/, vista: vistaAdendas, menu: 'adendas' },
  { patron: /^#\/formular(?:\/(\d+))?$/, vista: vistaFormular, menu: 'formular' },
  { patron: /^#\/linea-base$/, vista: vistaLineaBase, menu: 'lb' },
  { patron: /^#\/proyectos$/, vista: vistaProyectos, menu: 'proyectos' },
  { patron: /^#\/actualizar-archivo$/, vista: vistaActualizarArchivo, menu: 'actualizar' },
  { patron: /^#\/supervision$/, vista: vistaSupervision, menu: 'supervision' },
  { patron: /^#\/expediente$/, vista: vistaExpediente, menu: 'expediente' }, // todos los documentos del proyecto (§8 del plan)
  { patron: /^#\/bitacora$/, vista: vistaBitacora, menu: 'bitacora' },
  { patron: /^#\/bitacora\/(proyecto)$/, vista: vistaBitacora, menu: 'bitacora-proy' }, // la misma, filtrada por el proyecto elegido
  { patron: /^#\/configuracion$/, vista: vistaConfiguracion, menu: 'config' },
];

// Foto institucional de la pantalla de ingreso (banco del Sistema de Diseño SERFOR). El crédito es obligatorio
// (Manual de Identidad Gráfica, numeral 1.5): al cambiar la foto, cambie también su autor.
const FOTO_INGRESO = { archivo: 'fauna-mono-choro.jpg', alt: 'Mono choro en el bosque', credito: 'Álvaro García Alva' };

function pantallaIngreso() {
  raiz.innerHTML = `<div class="ingreso con-foto">
    <figure class="ingreso-foto">
      <img src="img/fotos/${FOTO_INGRESO.archivo}" alt="${FOTO_INGRESO.alt}">
      <div class="ingreso-lema"><b>Comprometidos con nuestros bosques y fauna silvestre</b><span>Servicio Nacional Forestal y de Fauna Silvestre</span></div>
      <figcaption class="ingreso-credito">Foto: ${FOTO_INGRESO.credito}</figcaption>
    </figure>
    <form class="tarjeta" id="f-ingreso">
    <div class="logo logo-ingreso"><div class="lat-logo">${LOGO}</div><div><b>${NOMBRE_APP}</b><small>${AREA_APP} – SERFOR</small></div></div>
    <div class="campo"><label for="correo">Correo electrónico</label><input id="correo" name="correo" type="email" autocomplete="username" required></div>
    <div class="campo"><label for="clave">Clave</label><input id="clave" name="clave" type="password" autocomplete="current-password" required></div>
    <button class="btn prim" type="submit">Ingresar</button>
    <div id="sso" hidden><div class="separador-sso"><span>o</span></div><a class="btn" id="b-google" href="/api/auth/google">Ingresar con Google</a></div>
    <p class="mut2" style="margin:0">Acceso restringido al personal autorizado. Las acciones quedan registradas en la bitácora.</p>
  </form></div>`;
  // Ingreso con Google Workspace (si está configurado) y el motivo si el regreso de Google no prosperó
  fetch('/api/auth/opciones', { credentials: 'same-origin' }).then((r) => r.json()).then((o) => {
    if (!o.google) return;
    document.getElementById('sso').hidden = false;
    document.getElementById('b-google').textContent = `Ingresar con Google (@${o.dominio})`;
  }).catch(() => { /* sin opciones: solo clave */ });
  const error = new URLSearchParams(location.search).get('sso_error');
  if (error) {
    const MENSAJES = {
      no_registrado: 'Su cuenta de Google no está registrada en la aplicación. Pida al Administrador que la cree.',
      inactivo: 'Su cuenta está desactivada. Comuníquese con el Administrador.',
      dominio: 'Use su cuenta institucional de Google Workspace.', correo: 'Google no confirmó el correo de la cuenta.',
      cancelado: 'Se canceló el ingreso con Google.', estado: 'El ingreso con Google expiró. Intente de nuevo.',
      desactivado: 'El ingreso con Google no está habilitado.',
    };
    aviso(MENSAJES[error] || 'No se pudo completar el ingreso con Google. Intente de nuevo o use su clave.', 'error');
    history.replaceState(null, '', location.pathname + location.hash);
  }
  document.getElementById('f-ingreso').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await api('POST', '/auth/ingresar', { correo: f.correo.value, clave: f.clave.value });
      estado.usuario = r.usuario;
      try { sessionStorage.removeItem('sgf-alertas-vistas'); } catch { /* sin almacenamiento: se mostrará al entrar */ }
      iniciar();
    } catch (err) { fallo(err); }
  };
}

async function pantallaCambioClave(obligatorio = true) {
  const r = await modal({
    titulo: obligatorio ? 'Defina su clave personal' : 'Cambiar clave',
    contenido: `${obligatorio ? '<p class="mut" style="margin:0">Por seguridad, reemplace la clave temporal antes de continuar.</p>' : ''}
      <div class="form"><div class="campo"><label>Clave actual</label><input name="actual" type="password" autocomplete="current-password"></div>
      <div class="campo"><label>Nueva clave (mín. 10, letras y números)</label><input name="nueva" type="password" autocomplete="new-password"></div>
      <div class="campo"><label>Repita la nueva clave</label><input name="repite" type="password" autocomplete="new-password"></div></div>`,
    botones: [...(obligatorio ? [] : [{ texto: 'Cancelar', valor: null }]), { texto: 'Guardar', clase: 'prim', valor: 'ok' }],
  });
  if (r.valor !== 'ok') { if (obligatorio) return pantallaCambioClave(true); return; }
  if (r.datos.nueva !== r.datos.repite) { aviso('Las claves no coinciden', 'error'); return pantallaCambioClave(obligatorio); }
  try {
    await api('POST', '/auth/cambiar-clave', { actual: r.datos.actual, nueva: r.datos.nueva });
    estado.usuario.cambiarClave = false;
    aviso('Clave actualizada', 'exito');
    if (obligatorio) iniciar();
  } catch (err) { fallo(err); return pantallaCambioClave(obligatorio); }
}

/** Opciones de cada proyecto, agrupadas (Contratación · Planificación · Ejecución · Registro). [ruta, menú, texto] */
const GRUPOS_PROYECTO = [
  ['Contratación', [['#/adendas', 'adendas', 'Contratos y adendas'], ['#/plazos', 'tablero', 'Adendas – plazos']]],
  ['Planificación', [['#/formular', 'formular', 'Formular plan de trabajo'], ['#/linea-base', 'lb', 'Línea base 2026'], ['#/actualizar-archivo', 'actualizar', 'Actualizar desde archivo']]],
  ['Ejecución', [['#/seguimiento', 'seguimiento', 'Seguimiento de actividades'], ['#/supervision', 'supervision', 'Supervisión diaria']]],
  ['Registro', [['#/expediente', 'expediente', 'Expediente'], ['#/bitacora/proyecto', 'bitacora-proy', 'Bitácora']]],
];
/** Las opciones dependen de lo que el proyecto maneja (profesionales, adendas, línea base); no se crean vistas nuevas. */
function opcionesDe(p, menu) {
  if (p.con_profesionales === 0) return ['expediente', 'bitacora-proy'].includes(menu);
  if (menu === 'actualizar') return !!p.escribe;
  if (menu === 'adendas') return p.con_adendas !== 0;
  if (menu === 'lb') return p.con_linea_base !== 0;
  return true;
}
const textoOpcion = (p, menu, texto) => (menu === 'tablero' && p.con_adendas === 0 ? 'Plazos – vencimientos' : texto);
let abierto; // proyecto desplegado en el menú (solo uno a la vez)

/** Glifo de semáforo del proyecto en el menú (▲ ● ✓ –), con su texto para lectores de pantalla. */
function glifoProyecto(id) {
  const s = (estado.semaforos || {})[id];
  if (!s) return '<span class="glifo g-none" aria-label="Sin dato de seguimiento">–</span>';
  if (s.terminado) return '<span class="glifo g-ok" aria-label="Terminado">✓</span>';
  const x = semInfo(s.semaforo);
  return `<span class="glifo g-${x.nivel}" aria-label="${esc(x.texto)}">${x.glifo}</span>`;
}

/** Menú «Proyectos»: un ítem por proyecto; solo el activo se despliega con su submenú agrupado. */
function pintarMenuProyectos() {
  const cont = document.getElementById('menu-proy');
  if (!cont) return;
  if (abierto === undefined) abierto = estado.proyecto_id || null;
  const lista = estado.proyectos || [];
  cont.innerHTML = `<div class="menu-cab"><span class="ov">Proyectos</span><a href="#/?situacion=todos">Ver todos ›</a></div>
    ${lista.map((p) => {
      const exp = abierto === p.proyecto_id;
      const grupos = GRUPOS_PROYECTO.map(([g, ops]) => [g, ops.filter(([, m]) => opcionesDe(p, m))]).filter(([, ops]) => ops.length);
      return `<button type="button" class="proy-item" data-abrir="${p.proyecto_id}" aria-expanded="${exp}" title="${esc(p.codigo)} · ${esc(p.nombre)}">${exp ? ICONOS.abajo : ICONOS.derecha}${glifoProyecto(p.proyecto_id)}<b>${esc(p.codigo)}</b><span class="proy-nom">${esc(p.nombre)}</span></button>
      ${exp ? `<div class="proy-sub">${grupos.map(([g, ops]) => `<div class="sub-grupo">${g}</div>${ops.map(([href, menu, texto]) => `<a href="${href}" class="sub2" data-menu="${menu}" data-proy="${p.proyecto_id}">${esc(textoOpcion(p, menu, texto))}</a>`).join('')}`).join('')}</div>` : ''}`;
    }).join('') || '<span class="vacio-menu">Aún no hay proyectos</span>'}`;
  cont.querySelectorAll('[data-abrir]').forEach((b) => {
    b.onclick = () => { const id = Number(b.dataset.abrir); abierto = abierto === id ? null : id; pintarMenuProyectos(); };
  });
  cont.querySelectorAll('a[data-proy]').forEach((a) => {
    a.addEventListener('click', () => {
      if (estado.proyecto_id !== Number(a.dataset.proy)) { fijarProyecto(a.dataset.proy); pintarSelectorProyecto(); }
      if (location.hash === a.getAttribute('href')) enrutar(); // mismo destino: no hay cambio de hash
    });
  });
  marcarMenu(rutaActual);
}
let rutaActual = '';
function marcarMenu(menu) {
  rutaActual = menu;
  document.querySelectorAll('.menu a[data-menu]').forEach((a) => {
    const deProyecto = a.dataset.proy !== undefined;
    const activo = a.dataset.menu === menu && (!deProyecto || Number(a.dataset.proy) === estado.proyecto_id);
    a.classList.toggle('activo', activo);
    if (activo) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}
window.sgfPintarMenu = () => { if (estado.proyecto_id) abierto = estado.proyecto_id; pintarMenuProyectos(); };

/** Semáforo de cada proyecto para el menú (del tablero general; solo Administrador y Jefes). */
async function cargarSemaforos() {
  if (esProfesional()) return;
  try { guardarSemaforos(await api('GET', '/portafolio')); } catch { /* el menú queda con «–» */ }
}
function guardarSemaforos(portafolio) {
  estado.semaforos = Object.fromEntries((portafolio.proyectos || []).map((p) => [p.proyecto_id, { semaforo: p.semaforo, terminado: p.terminado }]));
  pintarMenuProyectos();
}
window.sgfGuardarSemaforos = guardarSemaforos;

/** «Corte al dd/mm/aaaa»: botón que abre el selector de fecha (solo consulta; no cambia el parámetro del sistema). */
function pintarCorte() {
  const i = document.getElementById('corte'); const t = document.getElementById('corte-txt');
  if (i && t) t.textContent = i.value ? `Corte al ${ff(i.value)}` : 'Corte al día';
}
window.sgfPintarCorte = pintarCorte;

/** Variante del menú lateral (§5.1): institucional (por defecto) o clara; se recuerda en este navegador. */
const leerVariante = () => { try { return localStorage.getItem('sgf_menu_variante') === 'claro' ? 'claro' : 'institucional'; } catch { return 'institucional'; } };
const iniciales = (n) => String(n || '').replace(/\(.*?\)/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '—';

function estructura() {
  const u = estado.usuario;
  raiz.innerHTML = `<div class="marco">
    <aside class="lateral ${leerVariante() === 'claro' ? 'claro' : ''}" id="lateral" aria-label="Menú principal">
      <div class="lat-logo">${LOGO}</div>
      <div class="lat-app"><b>${NOMBRE_APP}</b><small>${AREA_APP}</small></div>
      ${esProfesional() ? `<nav class="menu" aria-label="Mi información">
        <a href="#/consultor/${u.consultor_id}" data-menu="seguimiento" title="Mi información">${ICONOS.cuadricula}<span class="txt-menu">Mi información</span></a>
        <a href="#/formular" data-menu="formular" title="Formular plan de trabajo">${ICONOS.adendas}<span class="txt-menu">Formular plan de trabajo</span></a></nav>` : `
      <nav class="menu" aria-label="Seguimiento">
        <a href="#/" data-menu="portafolio" title="Tablero general">${ICONOS.cuadricula}<span class="txt-menu">Tablero general</span></a>
        <a href="#/bitacora" data-menu="bitacora" title="Bitácora general">${ICONOS.libro}<span class="txt-menu">Bitácora general</span></a>
      </nav>
      <nav class="menu" aria-label="Proyectos" id="menu-proy"></nav>
      <nav class="menu" aria-label="Administración"><div class="ov">Administración</div>
        <a href="#/proyectos" data-menu="proyectos" title="Administrar proyectos">${ICONOS.editar}<span class="txt-menu">Administrar proyectos</span></a>
        <a href="#/configuracion" data-menu="config" title="Configuración">${ICONOS.ajustes}<span class="txt-menu">Configuración</span></a>
      </nav>`}
      <div class="lat-pie">
        ${estado.modo === 'memoria' ? '<div class="chip-demo">Modo demostración · datos en memoria</div>' : ''}
        <div class="usuario"><div class="usuario-ini" aria-hidden="true">${esc(iniciales(u.nombre))}</div>
          <div class="usuario-txt"><b>${esc(u.nombre)}</b><small>${esc(NOMBRE_PERFIL[u.rol] || u.rol)}</small></div>
          <button type="button" class="btn-icono" id="b-cuenta" aria-label="Opciones de cuenta: cambiar clave, cerrar sesión" aria-haspopup="menu" aria-expanded="false">${ICONOS.mas}</button>
          <div class="menu-usuario" id="menu-usuario" role="menu" hidden><small>${esc(u.correo)}</small>
            <button type="button" role="menuitem" id="b-clave">Cambiar clave</button><button type="button" role="menuitem" id="b-variante">${leerVariante() === 'claro' ? 'Menú institucional (verde)' : 'Menú claro'}</button><button type="button" role="menuitem" id="b-salir">Cerrar sesión</button></div>
        </div>
      </div>
    </aside>
    <div class="velo-menu" id="velo-menu"></div>
    <main class="principal">
      <header class="barra">
        <button type="button" class="btn-icono hamburguesa" id="b-menu" aria-label="Abrir el menú" aria-controls="lateral" aria-expanded="false">${ICONOS.menu}</button>
        <div class="titulo" id="titulo"></div>
        <div class="cab-acciones"><span id="cab-extra" class="cab-acciones"></span>
          <button type="button" class="btn corte-btn" id="b-corte" title="Ver las cifras a otra fecha de corte (solo consulta; no cambia el parámetro del sistema)">${ICONOS.calendario}<span id="corte-txt" class="num">Corte al día</span></button>
          <input type="date" id="corte" class="visual-oculto" aria-label="Fecha de corte" tabindex="-1">
          <button type="button" class="btn contorno" id="b-ia-cab">${ICONOS.ia}Asistente IA</button>
        </div>
      </header>
      <section class="contenido" id="vista"></section>
    </main>
  </div>`;
  // cuenta: menú ⋮
  const bc = document.getElementById('b-cuenta'); const mu = document.getElementById('menu-usuario');
  const cerrarCuenta = () => { mu.hidden = true; bc.setAttribute('aria-expanded', 'false'); };
  bc.onclick = (e) => { e.stopPropagation(); mu.hidden = !mu.hidden; bc.setAttribute('aria-expanded', String(!mu.hidden)); if (!mu.hidden) mu.querySelector('button').focus(); };
  document.addEventListener('click', (e) => { if (!mu.hidden && !mu.contains(e.target)) cerrarCuenta(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!mu.hidden) { cerrarCuenta(); bc.focus(); } cerrarCajon(); } });
  document.getElementById('b-salir').onclick = async () => { await api('POST', '/auth/salir').catch(() => {}); location.hash = '#/'; location.reload(); };
  document.getElementById('b-clave').onclick = () => { cerrarCuenta(); pantallaCambioClave(false); };
  document.getElementById('b-variante').onclick = (e) => {
    const nueva = leerVariante() === 'claro' ? 'institucional' : 'claro';
    try { localStorage.setItem('sgf_menu_variante', nueva); } catch { /* sin almacenamiento */ }
    document.getElementById('lateral').classList.toggle('claro', nueva === 'claro');
    e.currentTarget.textContent = nueva === 'claro' ? 'Menú institucional (verde)' : 'Menú claro';
    cerrarCuenta();
  };
  // menú como cajón en pantallas angostas
  const bm = document.getElementById('b-menu');
  bm.onclick = () => { const a = !document.body.classList.contains('menu-abierto'); document.body.classList.toggle('menu-abierto', a); bm.setAttribute('aria-expanded', String(a)); };
  document.getElementById('velo-menu').onclick = cerrarCajon;
  // fecha de corte
  const corte = document.getElementById('corte');
  corte.value = estado.corte || '';
  document.getElementById('b-corte').onclick = () => { try { corte.showPicker(); } catch { corte.focus(); corte.click(); } };
  corte.onchange = () => { estado.corte = corte.value; pintarCorte(); enrutar(); };
  pintarCorte();
  document.getElementById('b-ia-cab').onclick = () => abrirAsistente({});
  if (!esProfesional()) { cargarProyectos().then(pintarSelectorProyecto); cargarSemaforos(); }
}
function cerrarCajon() { document.body.classList.remove('menu-abierto'); const b = document.getElementById('b-menu'); if (b) b.setAttribute('aria-expanded', 'false'); }

async function enrutar() {
  const hash = location.hash || '#/';
  if (esProfesional()) { // el Profesional solo ve su propia ficha (el servidor también lo exige)
    const propia = `#/consultor/${estado.usuario.consultor_id}`;
    if (hash !== propia && hash !== '#/formular') { location.hash = propia; return; }
  }
  const ruta0 = hash.split('?')[0]; // los filtros del tablero viajan en la URL (#/?situacion=…)
  const ruta = RUTAS.find((r) => r.patron.test(ruta0)) || RUTAS[0];
  const m = ruta0.match(ruta.patron);
  marcarMenu(ruta.menu);
  cerrarCajon();
  accionesCabecera('');
  const vista = document.getElementById('vista');
  vista.innerHTML = '<div class="esqueleto" aria-label="Cargando"><i></i><i></i><i></i></div>';
  try {
    await ruta.vista(vista, m ? m.slice(1) : []);
  } catch (err) {
    vista.innerHTML = `<div class="tarjeta"><div class="vacio">No se pudo cargar la vista: ${esc(err.message)}</div></div>`;
  }
  pintarCorte();
}
window.sgfRefrescar = enrutar;

async function iniciar() {
  try {
    const r = await api('GET', '/auth/yo');
    Object.assign(estado, { usuario: r.usuario, ia: r.ia, modo: r.modo });
  } catch { pantallaIngreso(); return; }
  if (estado.usuario.cambiarClave) { raiz.innerHTML = '<div class="ingreso"></div>'; await pantallaCambioClave(true); return; }
  estructura();
  if (esProfesional() && location.hash !== `#/consultor/${estado.usuario.consultor_id}` && location.hash !== '#/formular') { location.hash = `#/consultor/${estado.usuario.consultor_id}`; return; }
  enrutar();
}

let ultimaRuta = (location.hash || '#/').split('?')[0];
window.addEventListener('hashchange', () => {
  if (!estado.usuario || !document.getElementById('vista')) return;
  const r = (location.hash || '#/').split('?')[0];
  // en el tablero, cambiar solo los filtros de la URL no recarga la vista (los aplica el propio tablero)
  if (r === ultimaRuta && /^#?\/?$/.test(r) && window.sgfFiltrosDesdeUrl) { window.sgfFiltrosDesdeUrl(); return; }
  ultimaRuta = r;
  enrutar();
});
window.addEventListener('sgf:sesion-expirada', () => { estado.usuario = null; pantallaIngreso(); });
window.addEventListener('sgf:cambiar-clave', () => pantallaCambioClave(true));
iniciar();
