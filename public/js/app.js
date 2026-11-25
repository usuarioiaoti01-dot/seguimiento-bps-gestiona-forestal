// Punto de entrada: sesión, estructura, enrutador y asistente.
import { api, estado, esc, aviso, fallo, ICONOS, modal, esProfesional, NOMBRE_PERFIL } from './util.js';
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
import { montarAsistente } from './vistas/asistente.js';

const raiz = document.getElementById('app');

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
  { patron: /^#\/bitacora$/, vista: vistaBitacora, menu: 'bitacora' },
  { patron: /^#\/configuracion$/, vista: vistaConfiguracion, menu: 'config' },
];

function pantallaIngreso() {
  raiz.innerHTML = `<div class="ingreso"><form class="tarjeta" id="f-ingreso">
    <div class="logo" style="color:var(--marca)">${ICONOS.logo.replace('rgba(255,255,255,.14)', 'var(--marca)')}<div><b>SEGUIMIENTO DE PROYECTOS DE LA OFICINA DE TECNOLOGIAS DE LA INFORMACION</b><small class="mut">OTI – SERFOR</small></div></div>
    <div class="campo"><label for="correo">Correo electrónico</label><input id="correo" name="correo" type="email" autocomplete="username" required></div>
    <div class="campo"><label for="clave">Clave</label><input id="clave" name="clave" type="password" autocomplete="current-password" required></div>
    <button class="btn prim" type="submit">Ingresar</button>
    <p class="mut2" style="margin:0">Acceso restringido al personal autorizado. Las acciones quedan registradas en la bitácora.</p>
  </form></div>`;
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

/** Opciones que se repiten dentro de cada proyecto (las mismas que tenía el menú único). */
const OPCIONES_PROYECTO = [
  ['#/plazos', 'tablero', 'Adendas - Plazos', 'tablero'], ['#/adendas', 'adendas', 'Contratos y adendas', 'adendas'], ['#/formular', 'formular', 'Formular Plan de Trabajo', 'adendas'],
  ['#/seguimiento', 'seguimiento', 'Seguimiento Actividades', 'seguimiento'], ['#/supervision', 'supervision', 'Supervisión diaria', 'seguimiento'], ['#/linea-base', 'lb', 'Línea base 2026', 'lb'], ['#/actualizar-archivo', 'actualizar', 'Actualizar Desde Archivo', 'seguimiento'],
];
/** Las opciones dependen de lo que el proyecto maneja (profesionales, adendas, línea base). */
const opcionesDe = (p) => (p.con_profesionales === 0 ? [] : OPCIONES_PROYECTO
  .filter(([, menu]) => (menu !== 'actualizar' || p.escribe) && !(menu === 'adendas' && p.con_adendas === 0) && !(menu === 'lb' && p.con_linea_base === 0))
  .map((o) => (o[1] === 'tablero' && p.con_adendas === 0 ? [o[0], o[1], 'Plazos - Vencimientos', o[3]] : o)));
const abiertos = new Set(['grupo']); // grupos desplegados del menú (se conserva al repintar)

/** Menú «Proyectos»: cada proyecto creado se despliega con sus opciones; elegir una fija el proyecto y abre la pantalla. */
function pintarMenuProyectos() {
  const cont = document.getElementById('menu-proy');
  if (!cont) return;
  if (estado.proyecto_id) abiertos.add(`p${estado.proyecto_id}`);
  const lista = estado.proyectos || [];
  cont.innerHTML = `<details class="grupo-menu" data-k="grupo" ${abiertos.has('grupo') ? 'open' : ''}><summary>${ICONOS.config}<span>Proyectos</span></summary>
    ${lista.map((p) => `<details class="proy-menu" data-k="p${p.proyecto_id}" ${abiertos.has(`p${p.proyecto_id}`) ? 'open' : ''}><summary title="${esc(p.nombre)}"><span>${esc(p.codigo)} · ${esc(p.nombre)}</span></summary>
      ${opcionesDe(p).map(([href, menu, texto, icono]) => `<a href="${href}" class="sub2" data-menu="${menu}" data-proy="${p.proyecto_id}">${ICONOS[icono]}${esc(texto)}</a>`).join('') || '<span class="sub2 mut2">Sin profesionales: nada que seguir</span>'}</details>`).join('') || '<span class="sub mut2">Aún no hay proyectos</span>'}
  </details>
  <a href="#/proyectos" data-menu="proyectos">${ICONOS.adendas}Administrar proyectos</a>`;
  cont.querySelectorAll('details').forEach((d) => d.addEventListener('toggle', () => { if (d.open) abiertos.add(d.dataset.k); else abiertos.delete(d.dataset.k); }));
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
  document.querySelectorAll('.menu a').forEach((a) => {
    const deProyecto = a.dataset.proy !== undefined;
    a.classList.toggle('activo', a.dataset.menu === menu && (!deProyecto || Number(a.dataset.proy) === estado.proyecto_id));
  });
}
window.sgfPintarMenu = pintarMenuProyectos;

function estructura() {
  const u = estado.usuario;
  raiz.innerHTML = `<div class="marco">
    <aside class="lateral">
      <div class="logo">${ICONOS.logo}<div><b>SEGUIMIENTO DE PROYECTOS DE LA OFICINA DE TECNOLOGIAS DE LA INFORMACION</b><small id="proy-pie">OTI – SERFOR</small></div></div>
      <nav class="menu">${esProfesional() ? `
        <a href="#/consultor/${u.consultor_id}" data-menu="seguimiento">${ICONOS.tablero}Mi información</a>
        <a href="#/formular" data-menu="formular">${ICONOS.adendas}Formular Plan de Trabajo</a>` : `
        <a href="#/" data-menu="portafolio">${ICONOS.tablero}Tablero general</a>
        <div id="menu-proy"></div>
        <a href="#/bitacora" data-menu="bitacora">${ICONOS.bitacora}Bitácora</a>
        <a href="#/configuracion" data-menu="config">${ICONOS.config}Configuración</a>`}
      </nav>
      <div class="pie">
        <div><b>${esc(u.nombre)}</b><br><span style="opacity:.8">${esc(u.correo)} · ${esc(NOMBRE_PERFIL[u.rol] || u.rol)}</span></div>
        <button id="b-clave">Cambiar clave</button>
        <button id="b-salir">Cerrar sesión</button>
        ${estado.modo === 'memoria' ? '<span style="opacity:.75">Modo demostración (datos en memoria)</span>' : ''}
      </div>
    </aside>
    <main class="principal">
      <header class="barra"><div class="titulo" id="titulo"></div>
        <label class="corte" title="Ver el pronóstico a otra fecha de corte (solo consulta; no cambia el parámetro del sistema)">Actualizado al
          <input type="date" id="corte"></label>
      </header>
      <section class="contenido" id="vista"></section>
    </main>
  </div>`;
  document.getElementById('b-salir').onclick = async () => { await api('POST', '/auth/salir').catch(() => {}); location.hash = '#/'; location.reload(); };
  document.getElementById('b-clave').onclick = () => pantallaCambioClave(false);
  const corte = document.getElementById('corte');
  corte.value = estado.corte || '';
  corte.onchange = () => { estado.corte = corte.value; enrutar(); };
  if (!esProfesional()) cargarProyectos().then(pintarSelectorProyecto);
  montarAsistente();
}

async function enrutar() {
  let hash = location.hash || '#/';
  if (esProfesional()) { // el Profesional solo ve su propia ficha (el servidor también lo exige)
    const propia = `#/consultor/${estado.usuario.consultor_id}`;
    if (hash !== propia && hash !== '#/formular') { location.hash = propia; return; }
  }
  const ruta = RUTAS.find((r) => r.patron.test(hash)) || RUTAS[0];
  const m = hash.match(ruta.patron);
  marcarMenu(ruta.menu);
  const vista = document.getElementById('vista');
  vista.innerHTML = '<div class="vacio">Cargando…</div>';
  try {
    await ruta.vista(vista, m ? m.slice(1) : []);
  } catch (err) {
    vista.innerHTML = `<div class="tarjeta"><div class="vacio">No se pudo cargar la vista: ${esc(err.message)}</div></div>`;
  }
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

window.addEventListener('hashchange', () => { if (estado.usuario && document.getElementById('vista')) enrutar(); });
window.addEventListener('sgf:sesion-expirada', () => { estado.usuario = null; pantallaIngreso(); });
window.addEventListener('sgf:cambiar-clave', () => pantallaCambioClave(true));
iniciar();
