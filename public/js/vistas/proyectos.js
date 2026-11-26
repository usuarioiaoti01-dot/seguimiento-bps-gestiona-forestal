import { api, esc, ff, titulo, modal, aviso, fallo, estado, puede, puedeProyecto, opciones, accionesCabecera, ICONOS } from '../util.js';
import { subirPdf } from './profesionales-proyecto.js';
import { registrarOrdenServicio } from './orden-servicio.js';

// Estados del proyecto (db/16) y su etiqueta
export const ESTADO_PROYECTO = { REGISTRADO: ['Registrado', 'b-azul'], EN_EJECUCION: ['En ejecución', 'b-verde'], SUSPENDIDO: ['Suspendido', 'b-ambar'], CONCLUIDO: ['Concluido', 'b-azul'], CERRADO: ['Cerrado', 'b-gris'], ANULADO: ['Anulado', 'b-gris'] };
const ESTADOS = Object.entries(ESTADO_PROYECTO).map(([k, [t]]) => [k, t]);
const ESTADOS_EDITABLES = (actual) => ESTADOS.filter(([k]) => k !== 'CERRADO' || actual === 'CERRADO'); // CERRADO solo con «Cerrar proyecto»
const chipEstado = (e) => `<span class="ins ins-neutro">${esc((ESTADO_PROYECTO[e] || [e])[0])}</span>`;
const NOMBRE_MODALIDAD = { ORDEN_SERVICIO: 'Orden de Servicio', CONTRATO_ADENDAS: 'Contrato con adendas', GESTION_INTERNA: 'Gestión interna' };
let catalogo = null;
const modalidades = async () => { if (!catalogo) catalogo = await api('GET', '/modalidades'); return catalogo.modalidades; };
const fecha = (s) => (s ? ff(String(s).slice(0, 10)) : '—');
// Días calendario (solo para mostrar; el servidor calcula y guarda el fin)
const DIA = 86400000;
const aDiaN = (s) => Math.floor(Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`) / DIA);
const deDia = (n) => new Date(n * DIA).toISOString().slice(0, 10);
const plazoDe = (p) => (p && p.fecha_inicio && p.fecha_fin ? aDiaN(p.fecha_fin) - aDiaN(p.fecha_inicio) + 1 : null);
const hoyCorte = () => estado.corte || new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
const DOCS = [['ORDEN_SERVICIO', 'Orden de Servicio', 'la Orden de Servicio'], ['TDR', 'Términos de Referencia', 'los Términos de Referencia']];

/** Los proyectos vigentes (menú lateral y lista); se vuelve a leer tras registrar o cambiar uno. */
export async function cargarProyectos() {
  try { estado.proyectos = await api('GET', '/proyectos'); } catch { estado.proyectos = []; }
  if (estado.proyecto_id && !estado.proyectos.some((p) => p.proyecto_id === estado.proyecto_id)) fijarProyecto(null);
  return estado.proyectos;
}

export function fijarProyecto(id) {
  estado.proyecto_id = id ? Number(id) : null;
  try { if (estado.proyecto_id) localStorage.setItem('sgf_proyecto', String(estado.proyecto_id)); else localStorage.removeItem('sgf_proyecto'); } catch { /* almacenamiento no disponible */ }
}

export function pintarSelectorProyecto() {
  const lista = estado.proyectos || [];
  if (window.sgfPintarMenu) window.sgfPintarMenu();
  const act = lista.find((p) => p.proyecto_id === estado.proyecto_id);
  const pie = document.getElementById('proy-pie');
  if (pie) pie.textContent = act ? `${act.codigo} · ${act.financiador || 'Proyecto'}` : 'Todos los proyectos';
}

/** Lo que el proyecto maneja: define las opciones del menú y los documentos que se solicitan. */
export function caracteristicas(p) {
  return [
    `Modalidad: ${NOMBRE_MODALIDAD[p.modalidad] || p.modalidad || '—'}`, p.es_atipico ? 'Caso atípico' : null,
    p.con_adendas ? 'Adendas' : null, p.con_linea_base ? 'Línea base' : null,
    p.con_orden_servicio ? 'TDR, OS y notificación' : null, p.con_profesionales ? null : 'Sin profesionales contratados',
  ].filter(Boolean);
}

/** PDF temporal (1 hora en el servidor) para analizarlo o registrarlo. */
async function subirTemporal(archivo, rotulo) {
  const r = await fetch('/api/documentos/temporales', { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-SGF': '1', 'X-Nombre': encodeURIComponent(archivo.name) }, body: archivo, credentials: 'same-origin' });
  const t = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${rotulo[0].toUpperCase()}${rotulo.slice(1)}: ${t.error || `Error ${r.status}`}`);
  return t.token;
}

// ---------------------------------------------------------------- ventana Registrar / Editar proyecto
function formProyecto(p, areas, mods, previo) {
  const v = { ...(p || { modalidad: 'ORDEN_SERVICIO' }), ...previo };
  const plazo = previo.plazo_dias ?? plazoDe(p) ?? '';
  const bloqueada = p && p.profesionales > 0;
  const mod = mods.find((m) => m.codigo === v.modalidad) || mods[0];
  const docs = (p && p.documentos) || [];
  const zona = ([tipo, nombre]) => {
    const act = docs.find((d) => d.tipo === tipo);
    return `<label class="zona" data-zona="${tipo}"><input type="file" name="__${tipo}" accept="application/pdf,.pdf" aria-label="${esc(nombre)} (PDF)">
      <span class="zona-ico">${ICONOS.adendas}</span>
      <span class="zona-txt"><b>${esc(nombre)}</b><small>${tipo === 'ORDEN_SERVICIO' ? 'PDF · confidencial: la ven el Administrador y el equipo' : 'PDF, hasta 15 MB'}</small>
        <span class="zona-arch" data-arch data-vacio="${act ? `Vigente: ${esc(act.nombre_original || 'documento confidencial')} · elija otro para reemplazarlo` : 'Arrastre el PDF aquí o pulse para elegirlo'}">${act ? `Vigente: ${esc(act.nombre_original || 'documento confidencial')} · elija otro para reemplazarlo` : 'Arrastre el PDF aquí o pulse para elegirlo'}</span></span></label>`;
  };
  const cuenta = (n, max) => `<span class="contador" data-contador="${n}">${String(v[n] || '').length} / ${max}</span>`;
  return `<div class="reg">
    <section class="reg-paso"><span class="reg-num">1</span><div class="reg-cont"><h3>Orden de Servicio y Términos de Referencia <span class="etq-oblig" id="docs-oblig"></span></h3>
      <p class="mut2">Son requisito para registrar el proyecto. Cargue los dos PDF y pulse «Analizar documentos»: el sistema propone el plazo, el nombre, el objetivo, la descripción y la unidad usuaria, y la primera Orden de Servicio del proyecto se registra con ellos. Revise lo propuesto antes de ${p ? 'guardar' : 'registrar'}.</p>
      <div class="reg-docs">${DOCS.map(zona).join('')}</div>
      <div class="reg-analisis"><button type="button" class="btn contorno med" id="b-analizar">${ICONOS.ia} Analizar documentos</button><span class="mut2" id="estado-analisis" role="status">${estado.ia ? 'Con el asistente de IA (sin datos personales)' : 'Lectura directa del texto de los PDF'}</span></div>
      <ul class="reg-dif" id="reg-dif" hidden aria-label="Diferencias con lo registrado"></ul>
      <ul class="reg-info" id="reg-info" hidden></ul>
      <ul class="reg-adv" id="reg-adv" hidden></ul></div></section>
    <section class="reg-paso"><span class="reg-num">2</span><div class="reg-cont"><h3>Modalidad</h3>
      ${bloqueada ? `<input class="en-bloque" value="${esc(mod.nombre)}" readonly disabled title="Con profesionales registrados la modalidad ya no cambia"><input type="hidden" name="modalidad" value="${esc(v.modalidad)}">`
        : `<div class="campo"><select name="modalidad" aria-label="Modalidad">${opciones(mods.map((m) => [m.codigo, m.nombre]), v.modalidad)}</select></div>`}
      <p class="desc-mod" id="desc-mod">${esc(mod.descripcion)}</p>
      <div class="campo" id="campo-atipico" ${mod.atipico ? '' : 'hidden'}><label>Motivo del caso atípico (obligatorio)</label><textarea name="motivo_atipico" maxlength="500" placeholder="Por qué este proyecto no sigue el proceso estándar de Orden de Servicio">${esc(v.motivo_atipico || '')}</textarea></div></div></section>
    <section class="reg-paso"><span class="reg-num">3</span><div class="reg-cont"><h3>Datos del proyecto</h3><div class="form">
      <div class="campo ancho"><label for="f-nombre">Nombre del proyecto</label><input id="f-nombre" name="nombre" value="${esc(v.nombre || '')}" maxlength="300" required placeholder="Denominación del servicio, como figura en el TDR"></div>
      <div class="campo"><label for="f-unidad">Unidad usuaria (quien requiere)</label><input id="f-unidad" name="unidad_usuaria" value="${esc(v.unidad_usuaria || '')}" maxlength="200" placeholder="Ej.: Dirección de Fortalecimiento de Capacidades"></div>
      <div class="campo"><label for="f-fin">Financiador / cooperante</label><input id="f-fin" name="financiador" value="${esc(v.financiador || '')}" maxlength="150" placeholder="Ej.: Presupuesto OTI, KfW, BID"></div>
      <div class="campo"><label for="f-area">Gestión del proyecto</label><select id="f-area" name="area_tecnica"><option value="">— Seleccione —</option>${opciones([...(v.area_tecnica && !areas.includes(v.area_tecnica) ? [v.area_tecnica] : []), ...areas].map((x) => [x, x]), v.area_tecnica)}</select></div>
      ${p ? `<div class="campo"><label for="f-estado">Estado</label><select id="f-estado" name="estado">${opciones(ESTADOS_EDITABLES(v.estado), v.estado)}</select></div>` : ''}
    </div></div></section>
    <section class="reg-paso"><span class="reg-num">4</span><div class="reg-cont"><h3>Periodo</h3><div class="form form-3">
      <div class="campo"><label for="f-ini">Inicio</label><input id="f-ini" type="date" name="fecha_inicio" value="${esc(String(v.fecha_inicio || '').slice(0, 10))}"></div>
      <div class="campo"><label for="f-plazo">Plazo (días calendario)</label><input id="f-plazo" type="number" min="1" max="3650" step="1" name="plazo_dias" value="${esc(plazo)}" placeholder="Del documento"></div>
      <div class="campo"><span class="lbl">Fin (calculado)</span><output class="reg-fin" id="f-fin-calc" aria-live="polite">—</output></div>
    </div><p class="mut2">Fin = inicio + plazo − 1, en días calendario, como los plazos de la Orden de Servicio.</p></div></section>
    <section class="reg-paso"><span class="reg-num">5</span><div class="reg-cont"><h3>Objetivo y descripción</h3>
      <div class="campo"><label for="f-obj">Objetivo</label><textarea id="f-obj" name="objetivo" maxlength="1000" rows="3">${esc(v.objetivo || '')}</textarea>${cuenta('objetivo', 1000)}</div>
      <div class="campo"><label for="f-desc">Descripción</label><textarea id="f-desc" name="descripcion" maxlength="1000" rows="4">${esc(v.descripcion || '')}</textarea>${cuenta('descripcion', 1000)}</div></div></section>
    <p class="reg-nota mut2">${p ? `Código ${esc(p.codigo)}: lo asignó el sistema y no se modifica.` : 'El código (PRY-AAAA-NNN) lo asigna el sistema al registrar.'} El equipo del proyecto y su responsable se asignan con el botón «Equipo».</p>
    <p class="reg-error" id="reg-error" role="alert" hidden></p>
  </div>`;
}

/** Comportamiento de la ventana: modalidad, zonas de carga, análisis de los PDF, periodo calculado y validación. */
function enlazarFormulario(velo, { p, mods, archivos, subidos }) {
  const form = velo.querySelector('form');
  const el = (n) => form.elements[n];
  const err = velo.querySelector('#reg-error');
  // La OS y los TDR son requisito del proyecto: al registrarlo y, al editar, si aún no los tiene (los anteriores a este cambio)
  const vigentes = (p && p.documentos) || [];
  const falta = (t) => !archivos[t] && !vigentes.some((d) => d.tipo === t);
  const pintarOblig = () => { velo.querySelector('#docs-oblig').textContent = DOCS.every(([t]) => vigentes.some((d) => d.tipo === t)) ? '· vigentes; elija otro PDF solo para reemplazarlos' : '· obligatorios'; };
  // modalidad
  const sel = el('modalidad');
  if (sel && sel.tagName === 'SELECT') sel.addEventListener('change', () => {
    const m = mods.find((x) => x.codigo === sel.value);
    velo.querySelector('#desc-mod').textContent = m ? m.descripcion : '';
    velo.querySelector('#campo-atipico').hidden = !(m && m.atipico);
    pintarOblig();
  });
  pintarOblig();
  // zonas de carga (clic o arrastrar)
  const pintarZona = (z) => {
    const f = archivos[z.dataset.zona];
    const t = z.querySelector('[data-arch]');
    const tam = f && (f.size < 1048576 ? `${Math.max(1, Math.round(f.size / 1024))} KB` : `${(f.size / 1048576).toFixed(1).replace('.', ',')} MB`);
    t.textContent = f ? `${f.name} · ${tam}` : t.dataset.vacio;
    z.classList.toggle('lista', !!f);
  };
  velo.querySelectorAll('.zona').forEach((z) => {
    const input = z.querySelector('input');
    if (archivos[z.dataset.zona]) { try { const dt = new DataTransfer(); dt.items.add(archivos[z.dataset.zona]); input.files = dt.files; } catch { /* navegador sin DataTransfer */ } }
    pintarZona(z);
    input.addEventListener('change', () => { archivos[z.dataset.zona] = input.files[0] || null; pintarZona(z); });
    z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('sobre'); });
    z.addEventListener('dragleave', () => z.classList.remove('sobre'));
    z.addEventListener('drop', (e) => {
      e.preventDefault(); z.classList.remove('sobre');
      const f = e.dataTransfer.files[0];
      if (!f) return;
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { aviso('Solo se admiten archivos PDF', 'error'); return; }
      archivos[z.dataset.zona] = f; try { input.files = e.dataTransfer.files; } catch { /* solo se recuerda el archivo */ }
      pintarZona(z);
    });
  });
  // periodo
  const pintarFin = () => {
    const ini = el('fecha_inicio').value; const n = Number(el('plazo_dias').value);
    velo.querySelector('#f-fin-calc').textContent = ini && Number.isInteger(n) && n >= 1 ? ff(deDia(aDiaN(ini) + n - 1)) : ini ? 'Indique el plazo' : 'Indique el inicio';
  };
  el('fecha_inicio').addEventListener('input', pintarFin); el('plazo_dias').addEventListener('input', pintarFin); pintarFin();
  // contadores de caracteres
  velo.querySelectorAll('[data-contador]').forEach((c) => { const t = el(c.dataset.contador); t.addEventListener('input', () => { c.textContent = `${t.value.length} / ${t.maxLength}`; }); });
  // lo propuesto por el análisis se resalta hasta que el usuario lo edita
  form.addEventListener('input', (e) => { if (e.target.classList.contains('leido')) { e.target.classList.remove('leido'); const etq = e.target.closest('.campo')?.querySelector('.etq-leido'); if (etq) etq.remove(); } });
  const poner = (c, valor) => {
    c.value = valor; c.dispatchEvent(new Event('input')); c.classList.add('leido');
    const lbl = c.closest('.campo')?.querySelector('label');
    if (lbl && !lbl.querySelector('.etq-leido')) lbl.insertAdjacentHTML('beforeend', ' <span class="etq-leido">Leído del documento</span>');
  };
  /** 'puesto' si se completó, 'distinto' si el documento dice otra cosa que lo ya escrito (no se pisa), o null. */
  const proponer = (n, valor) => {
    const c = el(n);
    if (!c || valor === null || valor === undefined || valor === '') return null;
    if (String(c.value) === String(valor)) return null;
    if (c.value && !c.classList.contains('leido')) return 'distinto';
    poner(c, valor);
    return 'puesto';
  };
  const ETIQUETAS = { nombre: 'Nombre', unidad_usuaria: 'Unidad usuaria', financiador: 'Financiador', plazo_dias: 'Plazo (días calendario)', objetivo: 'Objetivo', descripcion: 'Descripción' };
  // análisis de la OS y el TDR
  const bA = velo.querySelector('#b-analizar'); const est = velo.querySelector('#estado-analisis'); const adv = velo.querySelector('#reg-adv');
  const info = velo.querySelector('#reg-info'); const dif = velo.querySelector('#reg-dif');
  dif.addEventListener('click', (e) => {
    const b = e.target.closest('[data-usar]');
    if (!b) return;
    poner(el(b.dataset.usar), b.dataset.valor); pintarFin();
    b.closest('li').remove(); if (!dif.querySelector('li')) dif.hidden = true;
  });
  bA.onclick = async () => {
    const elegidos = DOCS.filter(([t]) => archivos[t]);
    if (!elegidos.length) { aviso('Elija primero la Orden de Servicio y los TDR (PDF)', 'error'); return; }
    bA.disabled = true; bA.classList.add('cargando'); est.textContent = 'Analizando los documentos…'; adv.hidden = true; info.hidden = true; dif.hidden = true;
    try {
      const documentos = {};
      for (const [t, , rotulo] of elegidos) {
        if (!subidos[t] || subidos[t].archivo !== archivos[t]) subidos[t] = { archivo: archivos[t], token: await subirTemporal(archivos[t], rotulo) };
        documentos[t] = subidos[t].token;
      }
      const r = await api('POST', '/proyectos/leer-documentos', { documentos });
      const res = Object.keys(ETIQUETAS).map((k) => [k, proponer(k, r[k])]);
      const puestos = res.filter(([, x]) => x === 'puesto').length;
      const distintos = res.filter(([, x]) => x === 'distinto').map(([k]) => k);
      pintarFin();
      const fuente = r.origen === 'IA' ? 'el asistente de IA' : 'el texto de los documentos';
      est.textContent = puestos ? `${puestos} dato(s) completado(s) con ${fuente}: revíselos.` : distintos.length ? `Sin datos vacíos que completar; revise las diferencias con ${fuente}.` : r.origen ? 'Lo registrado coincide con los documentos.' : '';
      dif.innerHTML = distintos.map((k) => `<li><span><b>${ETIQUETAS[k]}</b> según el documento: «${esc(String(r[k]).length > 160 ? `${String(r[k]).slice(0, 160)}…` : r[k])}»</span><button type="button" class="btn peq contorno" data-usar="${k}" data-valor="${esc(r[k])}">Usar</button></li>`).join('');
      dif.hidden = !distintos.length;
      const datos = [r.numero_os ? `Orden de Servicio N.° ${r.numero_os}` : null,
        Array.isArray(r.entregables) && r.entregables.length ? `Entregables del TDR: ${r.entregables.map((x) => `${x.nombre}${x.plazo_dias ? ` (día ${x.plazo_dias})` : ''}`).join('; ')}. Se registran con la Orden de Servicio de cada profesional.` : null].filter(Boolean);
      info.innerHTML = datos.map((a) => `<li>${esc(a)}</li>`).join(''); info.hidden = !datos.length;
      adv.innerHTML = (r.advertencias || []).map((a) => `<li>${esc(a)}</li>`).join(''); adv.hidden = !(r.advertencias || []).length;
    } catch (e) { est.textContent = ''; fallo(e); } finally { bA.disabled = false; bA.classList.remove('cargando'); }
  };
  // validación antes de cerrar (la ventana se queda abierta y muestra qué falta)
  const validar = () => {
    const faltan = [];
    if (String(el('nombre').value || '').trim().length < 5) faltan.push('el nombre del proyecto (al menos 5 caracteres)');
    for (const [t, , rotulo] of DOCS) if (falta(t)) faltan.push(`${rotulo} (PDF)`);
    const n = el('plazo_dias').value;
    if (n !== '' && (!Number.isInteger(Number(n)) || Number(n) < 1 || Number(n) > 3650)) faltan.push('un plazo válido (de 1 a 3650 días)');
    if (n !== '' && !el('fecha_inicio').value) faltan.push('la fecha de inicio (para calcular el periodo)');
    const at = velo.querySelector('#campo-atipico');
    if (at && !at.hidden && String(el('motivo_atipico').value || '').trim().length < 15) faltan.push('el motivo del caso atípico (al menos 15 caracteres)');
    if (!faltan.length) { err.hidden = true; return true; }
    err.textContent = `Falta: ${faltan.join('; ')}.`; err.hidden = false; err.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return false;
  };
  const prim = velo.querySelector('.pie .btn.prim');
  velo.querySelector('.pie').addEventListener('click', (e) => { if (e.target.closest('.btn') === prim && !validar()) e.stopPropagation(); }, true);
  velo.addEventListener('submit', (e) => { if (!validar()) { e.preventDefault(); e.stopPropagation(); } }, true);
}

async function registrarProyecto(p, previo = {}, archivos = {}, subidos = {}) {
  let areas = []; let mods = [];
  try { [areas, mods] = await Promise.all([api('GET', '/proyectos/areas'), modalidades()]); } catch (err) { fallo(err); return false; }
  const espera = modal({
    titulo: p ? `Editar ${p.codigo}` : 'Registrar proyecto', ancho: 880, contenido: formProyecto(p, areas, mods, previo),
    botones: [{ texto: 'Cancelar', valor: null }, { texto: p ? 'Guardar cambios' : 'Registrar proyecto', clase: 'prim', valor: 'ok' }],
  });
  const velo = [...document.querySelectorAll('.velo')].pop();
  if (velo) { velo.querySelector('.modal').classList.add('modal-reg'); enlazarFormulario(velo, { p, mods, archivos, subidos }); }
  const r = await espera;
  if (r.valor !== 'ok') return false;
  const datos = { ...r.datos };
  for (const k of Object.keys(datos)) if (k.startsWith('__')) delete datos[k];
  if (datos.plazo_dias === null) delete datos.plazo_dias; else datos.plazo_dias = Number(datos.plazo_dias);
  try {
    const documentos = {};
    for (const [t, , rotulo] of DOCS) {
      if (!archivos[t]) continue;
      if (!subidos[t] || subidos[t].archivo !== archivos[t]) subidos[t] = { archivo: archivos[t], token: await subirTemporal(archivos[t], rotulo) };
      documentos[t] = subidos[t].token;
    }
    const n = p ? await api('PATCH', `/proyectos/${p.proyecto_id}`, { ...datos, documentos, revision: p.revision })
      : await api('POST', '/proyectos', { ...datos, documentos });
    aviso(p ? 'Proyecto guardado' : `Proyecto registrado con el código ${n.codigo}. Asigne su equipo${n.modalidad === 'ORDEN_SERVICIO' ? ' y registre sus Órdenes de Servicio' : n.con_profesionales ? ' y registre sus profesionales' : ''}.`, 'exito');
    if (n.documentos_pendientes && n.documentos_pendientes.length) aviso(`No se pudo guardar: ${n.documentos_pendientes.join('; ')}. Vuelva a adjuntarlo con «Editar».`, 'error');
    await cargarProyectos(); pintarSelectorProyecto();
    return true;
  } catch (err) {
    fallo(err);
    if (err.estado === 409) { await cargarProyectos(); return false; }
    return registrarProyecto(p, datos, archivos, subidos);
  }
}

async function registrarProfesional(p, previo = {}) {
  const os = p.con_orden_servicio === 1;
  const doc = os ? 'Orden de Servicio' : 'contrato';
  const v = (n, d = '') => esc(previo[n] ?? d);
  const r = await modal({
    titulo: `Registrar profesional en ${p.codigo}`, ancho: 840,
    contenido: `<p class="mut" style="margin:0">Se crea el profesional con su ${doc}${os ? ' y su periodo de vigencia, del que se controla el vencimiento' : ' y, si indica las fechas, su primera adenda'}.${p.con_adendas ? '' : ' Este proyecto no maneja adendas.'}</p>
      <div class="form">
        <div class="campo"><label>Clave (2 a 5 letras)</label><input name="clave" maxlength="5" value="${v('clave')}" placeholder="Ej.: JQZ" style="text-transform:uppercase" required></div>
        <div class="campo"><label>Sede</label><input name="sede" maxlength="50" value="${v('sede')}" placeholder="Ej.: MIRAFLORES"></div>
        <div class="campo ancho"><label>Nombres y apellidos</label><input name="nombres" maxlength="150" value="${v('nombres')}" required></div>
        <div class="campo ancho"><label>Perfil / servicio contratado</label><input name="perfil" maxlength="200" value="${v('perfil')}" placeholder="Ej.: Analista de datos"></div>
        <div class="campo"><label>Correo institucional</label><input name="correo_institucional" type="email" maxlength="150" value="${v('correo_institucional')}"></div>
        ${p.con_linea_base ? `<div class="campo"><label>Recurso en el cronograma (MS Project)</label><input name="recurso_cronograma" maxlength="100" value="${v('recurso_cronograma')}"></div>` : ''}
        <div class="campo"><label>N.° de ${os ? 'Orden de Servicio' : 'contrato'}</label><input name="contrato_numero" maxlength="60" value="${v('contrato_numero')}" required></div>
        <div class="campo"><label>Expediente</label><input name="expediente" maxlength="40" value="${v('expediente')}"></div>
        <div class="campo ancho"><b>${os ? 'Vigencia de la Orden de Servicio' : 'Primera adenda / periodo vigente'}</b> <span class="mut2">${os ? '(obligatorio: de aquí se controla el vencimiento)' : '(opcional; también puede agregarla después)'}</span></div>
        ${!os && p.con_adendas ? `<div class="campo"><label>N.° de adenda</label><input type="number" min="0" name="adenda_numero" value="${v('adenda_numero', 1)}"></div>
        <div class="campo"><label>Estado</label><select name="adenda_estado">${opciones([['FIRMADA', 'Firmada'], ['EN_TRAMITE', 'En trámite']], previo.adenda_estado || 'FIRMADA')}</select></div>` : ''}
        <div class="campo"><label>Inicio</label><input type="date" name="adenda_inicio" value="${v('adenda_inicio')}"></div>
        <div class="campo"><label>Fin</label><input type="date" name="adenda_fin" value="${v('adenda_fin')}"></div>
        <div class="campo"><label>o plazo en días</label><input type="number" min="1" name="adenda_plazo_dias" value="${v('adenda_plazo_dias')}" placeholder="Si no indica el fin"></div>
        ${os || p.con_tdr ? '<div class="campo ancho"><b>Documentos del personal</b> <span class="mut2">(PDF, hasta 15 MB cada uno)</span></div>' : ''}
        ${os ? '<div class="campo ancho"><label>Orden de Servicio (PDF) — obligatoria</label><input type="file" name="__os" accept="application/pdf,.pdf"></div>' : ''}
        ${p.con_tdr ? '<div class="campo ancho"><label>Términos de Referencia (PDF) — obligatorios</label><input type="file" name="__tdr" accept="application/pdf,.pdf"></div>' : ''}
      </div>`,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Registrar profesional', clase: 'prim', valor: 'ok' }],
  });
  if (r.valor !== 'ok') return false;
  const archivoOS = os ? r.form.elements.__os.files[0] : null;
  const archivoTDR = p.con_tdr ? r.form.elements.__tdr.files[0] : null;
  const datos = { ...r.datos }; delete datos.__os; delete datos.__tdr;
  const faltan = [os && !archivoOS ? 'la Orden de Servicio' : null, p.con_tdr && !archivoTDR ? 'los Términos de Referencia' : null].filter(Boolean);
  if (faltan.length) { aviso(`Adjunte ${faltan.join(' y ')} (PDF) para registrar al profesional`, 'error'); return registrarProfesional(p, datos); }
  try {
    const n = await api('POST', `/proyectos/${p.proyecto_id}/profesionales`, datos);
    const pendientes = [];
    if (archivoOS) { try { await subirPdf(n.contrato.contrato_id, 'documento', archivoOS); } catch (e) { pendientes.push(`Orden de Servicio (${e.message})`); } }
    if (archivoTDR) { try { await subirPdf(n.contrato.contrato_id, 'tdr', archivoTDR); } catch (e) { pendientes.push(`Términos de Referencia (${e.message})`); } }
    aviso(`${n.consultor.nombres} registrado en ${p.codigo}`, 'exito');
    if (pendientes.length) aviso(`No se pudo adjuntar: ${pendientes.join('; ')}. Adjúntelo desde la lista de profesionales del proyecto.`, 'error');
    return true;
  } catch (err) { fallo(err); return registrarProfesional(p, datos); }
}

// ---------------------------------------------------------------- lista de proyectos (una ficha por proyecto, sin desplazamiento horizontal)
function cifraPeriodo(p) {
  if (!p.fecha_inicio) return '<div class="pry-cifra doble"><span class="ov">Periodo</span><b>Por definir</b><small class="pry-alerta">Indique el inicio y el plazo con «Editar»</small></div>';
  const plazo = plazoDe(p);
  if (!plazo || plazo < 1) return `<div class="pry-cifra doble"><span class="ov">Periodo</span><b>Desde el ${fecha(p.fecha_inicio)}</b><small class="pry-alerta">Falta el plazo para calcular el fin: indíquelo con «Editar»</small></div>`;
  const hoy = aDiaN(hoyCorte()); const ini = aDiaN(p.fecha_inicio); const fin = aDiaN(p.fecha_fin);
  const corrido = Math.min(plazo, Math.max(0, hoy - ini + 1)); const pct = Math.round((corrido * 100) / plazo);
  const terminado = ['CONCLUIDO', 'CERRADO', 'ANULADO'].includes(p.estado);
  const txt = terminado ? 'Proyecto terminado' : hoy < ini ? `Empieza en ${ini - hoy} día(s)` : hoy <= fin ? `Día ${corrido} de ${plazo} · quedan ${fin - hoy}` : `Plazo vencido hace ${hoy - fin} día(s)`;
  return `<div class="pry-cifra doble"><span class="ov">Periodo · ${plazo} días calendario</span><b>${fecha(p.fecha_inicio)} – ${fecha(p.fecha_fin)}</b>
    <div class="pry-tiempo${!terminado && hoy > fin ? ' vencido' : ''}" role="img" aria-label="Transcurrido el ${pct} % del plazo"><i style="width:${terminado ? 100 : pct}%"></i></div><small>${txt}</small></div>`;
}

function enlaceDocumento(d) {
  const nombre = d.tipo === 'TDR' ? 'TDR' : 'Orden de Servicio';
  if (d.oculto) return `<span class="pry-doc oculto" title="Documento confidencial: lo ven el Administrador y el equipo del proyecto">${ICONOS.adendas} ${nombre} · confidencial</span>`;
  return `<a class="pry-doc" href="/api/documentos/${d.documento_id}/archivo" target="_blank" rel="noopener" title="${esc(d.nombre_original || nombre)}">${ICONOS.adendas} ${nombre}${d.version > 1 ? ` · v${d.version}` : ''}</a>`;
}

function fichaProyecto(p) {
  const soloLectura = estado.usuario?.rol === 'JEFE_PROYECTO' && !p.escribe;
  const admite = ['REGISTRADO', 'EN_EJECUCION'].includes(p.estado);
  const docs = p.documentos || [];
  const acciones = [
    p.con_profesionales ? `<button class="btn prim peq" data-ver="${p.proyecto_id}" type="button">${ICONOS.seguimiento} Ver seguimiento</button>` : '',
    puedeProyecto(p.proyecto_id) && p.con_profesionales ? `<button class="btn peq" data-prof="${p.proyecto_id}" type="button" ${admite ? '' : 'disabled title="El proyecto no admite nuevas contrataciones en su estado actual"'}>${p.modalidad === 'ORDEN_SERVICIO' ? 'Registrar Orden de Servicio' : 'Registrar profesional'}</button>` : '',
    `<button class="btn peq" data-equipo="${p.proyecto_id}" type="button">Equipo</button>`,
    `<button class="btn peq" data-exp="${p.proyecto_id}" type="button">Expediente</button>`,
    puede('ADMIN') ? `<button class="btn peq" data-editar="${p.proyecto_id}" type="button">${ICONOS.editar} Editar</button>` : '',
    (puede('ADMIN') || p.escribe) && !['CERRADO', 'ANULADO'].includes(p.estado) ? `<button class="btn peq fantasma pry-cerrar" data-cerrar="${p.proyecto_id}" type="button">Cerrar proyecto</button>` : '',
  ].filter(Boolean).join('');
  const sinEquipo = !(p.equipo || []).length;
  return `<article class="pry" data-id="${p.proyecto_id}" aria-labelledby="pry-nom-${p.proyecto_id}">
    <header class="pry-cab">
      <div class="pry-chips"><span class="pry-cod">${esc(p.codigo)}</span>${chipEstado(p.estado)}<span class="ins ins-none">${esc(NOMBRE_MODALIDAD[p.modalidad] || p.modalidad || '—')}</span>${p.es_atipico ? '<span class="ins ins-warn">Caso atípico</span>' : ''}${soloLectura ? '<span class="ins ins-none" title="No integra el equipo de este proyecto: puede consultarlo, no modificarlo">Solo lectura</span>' : ''}</div>
      <h2 class="pry-nom" id="pry-nom-${p.proyecto_id}">${esc(p.nombre)}</h2>
      <p class="pry-sub">${[p.area_tecnica, p.unidad_usuaria].filter(Boolean).map(esc).join(' · ') || 'Sin gestión ni unidad usuaria registradas'}</p>
      <div class="acciones pry-acc">${acciones}</div>
    </header>
    <div class="pry-cifras">
      ${cifraPeriodo(p)}
      <div class="pry-cifra"><span class="ov">Profesionales activos</span><b>${p.activos} <span class="de">de ${p.profesionales}</span></b><small>${p.profesionales ? 'Registrados en el proyecto' : 'Aún no hay profesionales'}</small></div>
      <div class="pry-cifra"><span class="ov">Planes aprobados</span><b>${p.planes_aprobados} <span class="de">de ${p.profesionales}</span></b><small>El seguimiento arranca con el plan aprobado</small></div>
      <div class="pry-cifra"><span class="ov">Jefe de proyecto responsable</span><b class="${p.responsable ? '' : 'pry-alerta'}">${esc(p.responsable || 'Sin responsable')}</b><small>${p.responsable ? `${(p.equipo || []).length} integrante(s) en el equipo` : 'Asígnelo con «Equipo»'}</small></div>
    </div>
    <div class="pry-cuerpo">
      <div class="pry-texto">
        <section><span class="ov">Objetivo</span><p>${p.objetivo ? esc(p.objetivo) : '<span class="mut">Sin objetivo registrado</span>'}</p></section>
        <section><span class="ov">Descripción</span><p class="pry-desc recortada">${p.descripcion ? esc(p.descripcion) : '<span class="mut">Sin descripción registrada</span>'}</p><button class="pry-mas" type="button" hidden>Ver más</button></section>
        ${p.es_atipico ? `<section><span class="ov">Motivo del caso atípico</span><p>${esc(p.motivo_atipico || '—')}</p></section>` : ''}
        ${p.estado === 'CERRADO' ? `<section><span class="ov">Cierre${p.fecha_cierre ? ` del ${fecha(p.fecha_cierre)}` : ''} · lecciones aprendidas</span><p style="white-space:pre-wrap">${esc(p.lecciones_aprendidas || '—')}</p><button class="btn peq" type="button" data-informe="${p.proyecto_id}">Ver informe de cierre</button></section>` : ''}
      </div>
      <dl class="pry-ficha">
        <div><dt>Documentos</dt><dd>${docs.length ? docs.map(enlaceDocumento).join('') : `<span class="mut">${p.modalidad === 'ORDEN_SERVICIO' ? 'Sin Orden de Servicio ni TDR: adjúntelos con «Editar»' : 'Sin documentos del proyecto'}</span>`}</dd></div>
        <div><dt>Unidad usuaria</dt><dd>${esc(p.unidad_usuaria || '—')}</dd></div>
        <div><dt>Financiador</dt><dd>${esc(p.financiador || '—')}</dd></div>
        <div><dt>Gestión del proyecto</dt><dd>${esc(p.area_tecnica || '—')}</dd></div>
        <div><dt>Equipo del proyecto</dt><dd>${sinEquipo ? '<span class="pry-alerta">Sin equipo: solo el Administrador puede modificar este proyecto</span>' : p.equipo.map((m) => `<span class="ins ${m.es_responsable ? 'ins-ok' : 'ins-none'}">${m.es_responsable ? '✓ ' : ''}${esc(m.nombre)}</span>`).join('')}</dd></div>
        <div><dt>Características</dt><dd>${caracteristicas(p).map((x) => `<span class="ins ins-none">${esc(x)}</span>`).join('')}</dd></div>
      </dl>
    </div>
  </article>`;
}

export async function vistaProyectos(el) {
  const pintar = async () => {
    const lista = await cargarProyectos();
    pintarSelectorProyecto();
    titulo('Proyectos', lista.length ? `${lista.length} proyecto${lista.length === 1 ? '' : 's'} registrado${lista.length === 1 ? '' : 's'} · documentos, periodo, equipo y profesionales de cada uno` : 'Cada proyecto se registra con su Orden de Servicio y sus TDR');
    accionesCabecera(puede('ADMIN') ? `<button class="btn prim" id="b-nuevo-proy" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg> Registrar proyecto</button>` : '');
    el.innerHTML = lista.length ? `<div class="pry-lista">${lista.map(fichaProyecto).join('')}</div>`
      : `<div class="tarjeta pry-vacio">${ICONOS.adendas}<h2>Aún no hay proyectos</h2><p class="mut">Registre el primero con su Orden de Servicio y sus Términos de Referencia: el sistema lee los documentos y propone el plazo, el nombre, el objetivo y la descripción.</p>
        ${puede('ADMIN') ? '<button class="btn prim" type="button" data-nuevo>Registrar el primer proyecto</button>' : '<p class="mut2">Los proyectos los registra el Administrador (Dirección OTI).</p>'}</div>`;
    // «Ver más» solo cuando la descripción no cabe en cinco líneas
    el.querySelectorAll('.pry-desc').forEach((d) => {
      const b = d.parentElement.querySelector('.pry-mas');
      if (d.scrollHeight > d.clientHeight + 2) { b.hidden = false; b.onclick = () => { const r = d.classList.toggle('recortada'); b.textContent = r ? 'Ver más' : 'Ver menos'; }; }
    });
    const buscar = (id) => lista.find((p) => p.proyecto_id === Number(id));
    const nuevo = async () => { if (await registrarProyecto(null)) pintar(); };
    const bNuevo = document.getElementById('b-nuevo-proy'); if (bNuevo) bNuevo.onclick = nuevo;
    el.querySelectorAll('[data-nuevo]').forEach((b) => { b.onclick = nuevo; });
    el.querySelectorAll('[data-editar]').forEach((b) => { b.onclick = async () => { if (await registrarProyecto(buscar(b.dataset.editar))) pintar(); }; });
    el.querySelectorAll('[data-equipo]').forEach((b) => { b.onclick = () => editarEquipo(Number(b.dataset.equipo)).then(pintar).catch(fallo); });
    el.querySelectorAll('[data-cerrar]').forEach((b) => { b.onclick = async () => { if (await cerrarProyecto(Number(b.dataset.cerrar))) pintar(); }; });
    el.querySelectorAll('[data-informe]').forEach((b) => {
      b.onclick = async () => {
        try { const ev = await api('GET', `/proyectos/${b.dataset.informe}/cierre`); if (ev.informe) window.open(`/api/documentos/${ev.informe.documento_id}/archivo`, '_blank', 'noopener'); else aviso('El proyecto no tiene informe de cierre registrado', 'error'); } catch (err) { fallo(err); }
      };
    });
    el.querySelectorAll('[data-prof]').forEach((b) => {
      b.onclick = async () => {
        const p = buscar(b.dataset.prof);
        if (await (p.modalidad === 'ORDEN_SERVICIO' ? registrarOrdenServicio(p) : registrarProfesional(p))) pintar();
      };
    });
    const ir = (id, hash) => { fijarProyecto(id); pintarSelectorProyecto(); location.hash = hash; };
    el.querySelectorAll('[data-ver]').forEach((b) => { b.onclick = () => ir(b.dataset.ver, '#/seguimiento'); });
    el.querySelectorAll('[data-exp]').forEach((b) => { b.onclick = () => ir(b.dataset.exp, '#/expediente'); });
  };
  await pintar();
}

/** Cierre formal (P9): muestra los requisitos y, si se cumplen, pide el informe de cierre y las lecciones aprendidas. */
async function cerrarProyecto(id) {
  let ev;
  try { ev = await api('GET', `/proyectos/${id}/cierre`); } catch (err) { fallo(err); return false; }
  const hoy = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
  const r = await modal({
    titulo: `Cerrar el proyecto ${ev.proyecto.codigo}`, ancho: 720,
    contenido: `<p class="mut" style="margin:0">${esc(ev.proyecto.nombre)}. El cierre deja el proyecto como terminado: ya no recibe Órdenes de Servicio, partes ni cambios.</p>
      <table><thead><tr><th>Requisito</th><th>Situación</th></tr></thead><tbody>${ev.requisitos.map((q) => `<tr><td>${q.cumple ? '✔' : '✘'} ${esc(q.texto)}</td><td class="mut2">${esc(q.detalle)}</td></tr>`).join('')}</tbody></table>
      ${ev.puede_cerrar ? `<div class="form">
        <div class="campo"><label>Fecha de cierre</label><input type="date" name="fecha_cierre" value="${hoy}" max="${hoy}"></div>
        <div class="campo ancho"><label>Informe de cierre (PDF) — obligatorio</label><input type="file" name="__informe" accept="application/pdf,.pdf"></div>
        <div class="campo ancho"><label>Lecciones aprendidas</label><textarea name="lecciones_aprendidas" maxlength="2000" placeholder="Qué funcionó, qué no y qué conviene repetir o evitar en el próximo proyecto"></textarea></div></div>`
        : '<p class="mut2" style="margin:0">Complete los requisitos pendientes para poder cerrar el proyecto.</p>'}`,
    botones: ev.puede_cerrar ? [{ texto: 'Cancelar', valor: null }, { texto: 'Cerrar el proyecto', clase: 'prim', valor: 'ok' }] : [{ texto: 'Cerrar', valor: null }],
  });
  if (r.valor !== 'ok') return false;
  try {
    const archivo = r.form.elements.__informe.files[0];
    if (!archivo) throw new Error('Adjunte el informe de cierre (PDF)');
    const sub = await fetch('/api/documentos/temporales', { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-SGF': '1', 'X-Nombre': encodeURIComponent(archivo.name) }, body: archivo, credentials: 'same-origin' });
    const t = await sub.json().catch(() => ({}));
    if (!sub.ok) throw new Error(`Informe de cierre: ${t.error || `Error ${sub.status}`}`);
    await api('POST', `/proyectos/${id}/cierre`, { informe: t.token, lecciones_aprendidas: r.datos.lecciones_aprendidas, fecha_cierre: r.datos.fecha_cierre, revision: ev.proyecto.revision });
    aviso(`Proyecto ${ev.proyecto.codigo} cerrado`, 'exito');
    await cargarProyectos(); pintarSelectorProyecto();
    return true;
  } catch (err) { fallo(err); return false; }
}

/**
 * Equipo del proyecto (db/15): Jefes de Proyecto del Equipo de Desarrollo que registran y supervisan el proyecto.
 * Todos lo consultan; solo el Administrador agrega, quita o cambia al responsable (el servidor lo vuelve a validar).
 */
async function editarEquipo(id) {
  const p = (estado.proyectos || []).find((x) => x.proyecto_id === Number(id)) || { codigo: '' };
  for (;;) {
    const miembros = await api('GET', `/proyectos/${id}/equipo`);
    const admin = puede('ADMIN');
    const usuarios = admin ? (await api('GET', '/usuarios')).filter((u) => u.activo && u.rol === 'JEFE_PROYECTO' && !miembros.some((m) => m.usuario_id === u.usuario_id)) : [];
    const filas = miembros.map((m) => `<tr>
        ${admin ? `<td><input type="radio" name="miembro_id" value="${m.miembro_id}" aria-label="Elegir a ${esc(m.nombre)}"></td>` : ''}
        <td><b>${esc(m.nombre)}</b>${m.correo ? `<br><span class="mut2">${esc(m.correo)}</span>` : ''}${m.cuenta_activa ? '' : ' <span class="badge b-gris">Cuenta desactivada</span>'}</td>
        <td>${m.es_responsable ? '<span class="badge b-verde">Responsable</span>' : '<span class="badge b-gris">Miembro</span>'}</td>
        <td class="num">${fecha(m.desde)}</td></tr>`).join('');
    const r = await modal({
      titulo: `Equipo del proyecto ${p.codigo}`, ancho: 720,
      contenido: `<p class="mut" style="margin:0">Los miembros del equipo registran los avances, los documentos y las aprobaciones de este proyecto. Los demás Jefes de Proyecto solo lo consultan; el Administrador puede modificar todos.</p>
        <table><thead><tr>${admin ? '<th></th>' : ''}<th>Jefe de Proyecto</th><th>Rol en el proyecto</th><th>Desde</th></tr></thead>
        <tbody>${filas || `<tr><td colspan="${admin ? 4 : 3}" class="vacio">Sin equipo asignado: solo el Administrador puede modificar este proyecto.</td></tr>`}</tbody></table>
        ${admin ? `<div class="form"><div class="campo ancho"><label>Agregar al equipo (cuentas con perfil Jefe de Proyecto)</label><select name="usuario_id"><option value="">— Seleccione —</option>${opciones(usuarios.map((u) => [u.usuario_id, `${u.nombre} · ${u.correo}`]))}</select>
          ${usuarios.length ? '' : '<small class="mut2">No hay otras cuentas activas con perfil Jefe de Proyecto. Créelas en Configuración.</small>'}</div>
          <label class="caja-car"><input type="checkbox" name="es_responsable"><span><b>Agregar como responsable</b><small>Reemplaza al responsable actual</small></span></label></div>` : ''}`,
      botones: admin
        ? [{ texto: 'Cerrar', valor: null }, { texto: 'Quitar del equipo', valor: 'quitar' }, { texto: 'Marcar como responsable', valor: 'responsable' }, { texto: 'Agregar', clase: 'prim', valor: 'agregar' }]
        : [{ texto: 'Cerrar', valor: null }],
    });
    if (!r.valor) return;
    try {
      if (r.valor === 'agregar') {
        if (!r.datos.usuario_id) { aviso('Elija la cuenta que se agrega al equipo', 'error'); continue; }
        await api('POST', `/proyectos/${id}/equipo`, { usuario_id: Number(r.datos.usuario_id), es_responsable: !!r.datos.es_responsable });
        aviso('Integrante agregado al equipo', 'exito');
      } else {
        const m = miembros.find((x) => x.miembro_id === Number(r.datos.miembro_id));
        if (!m) { aviso('Elija en la lista al integrante del equipo', 'error'); continue; }
        if (r.valor === 'responsable') await api('PATCH', `/proyectos/${id}/equipo/${m.miembro_id}`, { es_responsable: 1, revision: m.revision });
        else await api('POST', `/proyectos/${id}/equipo/${m.miembro_id}/quitar`, { revision: m.revision });
        aviso(r.valor === 'responsable' ? `${m.nombre} es ahora el responsable del proyecto` : `${m.nombre} salió del equipo`, 'exito');
      }
    } catch (e) { fallo(e); }
  }
}
