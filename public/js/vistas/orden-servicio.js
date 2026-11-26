// Contrataciones por Orden de Servicio (Etapa 2): registro con TDR, OS, monto y entregables; notificación; ampliación.
// Las fechas las calcula el servidor (motor/plazos.js); aquí solo se muestran.
import { api, esc, ff, modal, aviso, fallo, estado, ICONOS } from '../util.js';

const MAX_PDF = 15 * 1024 * 1024;
export const SEMAFORO_ENT = { ROJO: ['b-rojo', 'Atrasado'], AMBAR: ['b-ambar', 'Atención'], VERDE: ['b-verde', 'En plazo'], AZUL: ['b-azul', 'Presentado'], GRIS: ['b-gris', '—'] };
export const ESTADO_OS = { REGISTRADA: ['b-ambar', 'Sin notificar'], EN_EJECUCION: ['b-verde', 'En ejecución'], CULMINADA: ['b-azul', 'Culminada'], RESUELTA: ['b-gris', 'Resuelta'], ANULADA: ['b-gris', 'Anulada'] };
const ESTADO_ENT = { PENDIENTE: 'Pendiente', PRESENTADO: 'Presentado', EN_REVISION: 'En revisión', OBSERVADO: 'Observado', SUBSANADO: 'Subsanado', CONFORME: 'Conforme', ANULADO: 'Anulado' };
const soles = (n) => (n === null || n === undefined ? '—' : `S/ ${Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export { soles };

let catalogo = null;
async function medios() {
  if (!catalogo) catalogo = await api('GET', '/modalidades');
  return Object.entries(catalogo.medios_notificacion);
}

/** Sube un PDF al área temporal del servidor (1 hora) y devuelve su token. */
async function subirTemporal(archivo, rotulo) {
  if (!archivo) throw new Error(`Adjunte ${rotulo} (PDF)`);
  if (archivo.type !== 'application/pdf' && !/\.pdf$/i.test(archivo.name)) throw new Error(`${rotulo}: el archivo debe ser un PDF`);
  if (archivo.size > MAX_PDF) throw new Error(`${rotulo}: el PDF supera el máximo de 15 MB`);
  const r = await fetch('/api/documentos/temporales', { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-SGF': '1', 'X-Nombre': encodeURIComponent(archivo.name) }, body: archivo, credentials: 'same-origin' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${rotulo}: ${d.error || `Error ${r.status}`}`);
  return d.token;
}

const filaEntregable = (i, e = {}) => `<tr data-fila="${i}">
  <td class="num">${i}</td>
  <td><input name="e_nombre_${i}" maxlength="300" value="${esc(e.nombre || '')}" placeholder="Ej.: Plan de trabajo" aria-label="Nombre del entregable ${i}"></td>
  <td><input name="e_plazo_${i}" type="number" min="1" value="${esc(e.plazo_dias ?? '')}" style="width:7em" aria-label="Plazo del entregable ${i} en días"></td>
  <td><input name="e_pct_${i}" type="number" min="0" max="100" step="0.01" value="${esc(e.porcentaje_pago ?? '')}" style="width:6em" aria-label="Porcentaje de pago del entregable ${i}"></td>
  <td><button type="button" class="btn peq" data-quitar="${i}" aria-label="Quitar el entregable ${i}">Quitar</button></td></tr>`;

/** Lee las filas de entregables del formulario (en su orden). */
function leerEntregables(form) {
  return [...form.querySelectorAll('tr[data-fila]')].map((tr) => {
    const i = tr.dataset.fila;
    return { nombre: form.elements[`e_nombre_${i}`].value.trim(), plazo_dias: form.elements[`e_plazo_${i}`].value, porcentaje_pago: form.elements[`e_pct_${i}`].value };
  }).filter((e) => e.nombre || e.plazo_dias);
}

function tablaEntregablesEditable(lista) {
  return `<table class="tabla-ent"><thead><tr><th>N.°</th><th>Entregable (producto del TDR)</th><th>Plazo (días desde la notificación)</th><th>% de pago</th><th></th></tr></thead>
    <tbody id="filas-ent">${lista.map((e, i) => filaEntregable(i + 1, e)).join('')}</tbody></table>
    <button type="button" class="btn peq" id="b-mas-ent">Agregar entregable</button>`;
}

function enlazarEntregables(form) {
  const cuerpo = form.querySelector('#filas-ent');
  const renumerar = () => [...cuerpo.querySelectorAll('tr[data-fila]')].forEach((tr, i) => { tr.querySelector('td').textContent = i + 1; });
  const siguiente = () => Math.max(0, ...[...cuerpo.querySelectorAll('tr[data-fila]')].map((tr) => Number(tr.dataset.fila) || 0)) + 1; // nombres de campo únicos
  form.querySelector('#b-mas-ent').onclick = () => { cuerpo.insertAdjacentHTML('beforeend', filaEntregable(siguiente())); renumerar(); };
  if (cuerpo.dataset.enlazado) return; // el clic de «Quitar» se conecta una sola vez (las filas pueden reemplazarse)
  cuerpo.dataset.enlazado = '1';
  cuerpo.addEventListener('click', (ev) => { const b = ev.target.closest('[data-quitar]'); if (b && cuerpo.querySelectorAll('tr').length > 1) { b.closest('tr').remove(); renumerar(); } });
}

/**
 * Registrar una Orden de Servicio: profesional nuevo (o `consultor` para una nueva OS del mismo profesional),
 * datos de la OS, entregables y los PDF del TDR y de la OS. Queda «sin notificar» hasta registrar la notificación.
 *
 * Los datos se leen de los documentos: la primera OS usa la Orden de Servicio y los TDR que se cargaron al registrar
 * el proyecto (se analizan al abrir la ventana); para otra contratación se adjuntan sus PDF y se pulsa «Analizar».
 * Lo leído completa los campos vacíos; si el documento difiere de lo escrito, se ofrece «Usar». `st` conserva los
 * archivos elegidos si la ventana se vuelve a abrir tras un error.
 */
const DOCS_OS = [['ORDEN_SERVICIO', 'Orden de Servicio', 'la Orden de Servicio'], ['TDR', 'Términos de Referencia', 'los Términos de Referencia']];
const ETIQUETAS_OS = { nombres: 'Nombres y apellidos', clave: 'Clave', perfil: 'Perfil / servicio contratado', numero: 'N.° de Orden de Servicio', expediente: 'Expediente', titulo_tdr: 'Objeto del servicio', monto: 'Monto (S/)', plazo_dias: 'Plazo total (días calendario)' };
const tamano = (f) => (f.size < 1048576 ? `${Math.max(1, Math.round(f.size / 1024))} KB` : `${(f.size / 1048576).toFixed(1).replace('.', ',')} MB`);
const ENTREGABLES_INICIALES = [{ nombre: 'Plan de trabajo', plazo_dias: '' }, { nombre: 'Informe final', plazo_dias: '' }];

async function documentosDelProyecto(p) {
  if (Array.isArray(p.documentos)) return p.documentos;
  try { const l = await api('GET', '/proyectos'); return (l.find((x) => x.proyecto_id === p.proyecto_id) || {}).documentos || []; } catch { return []; }
}

export async function registrarOrdenServicio(p, consultor = null, previo = {}, st = null) {
  if (!st) {
    const docsProy = (await documentosDelProyecto(p)).filter((d) => !d.oculto);
    // La primera OS de un profesional nuevo usa los documentos del proyecto; otra contratación adjunta los suyos
    st = { docsProy, archivos: {}, subidos: {}, usar: Object.fromEntries(DOCS_OS.map(([t]) => [t, !consultor && docsProy.some((d) => d.tipo === t)])) };
  }
  const v = (n, d = '') => esc(previo[n] ?? d);
  const entregables = previo.entregables && previo.entregables.length ? previo.entregables : ENTREGABLES_INICIALES;
  const zona = ([tipo, nombre]) => `<div class="zona-caja"><label class="zona" data-zona="${tipo}"><input type="file" name="__${tipo}" accept="application/pdf,.pdf" aria-label="${esc(nombre)} (PDF)">
      <span class="zona-ico">${ICONOS.adendas}</span>
      <span class="zona-txt"><b>${esc(nombre)}</b><small>${tipo === 'ORDEN_SERVICIO' ? 'PDF · confidencial: la ven el Administrador y el equipo' : 'PDF, hasta 15 MB'}</small><span class="zona-arch" data-arch></span></span></label>
      ${st.docsProy.some((d) => d.tipo === tipo) ? `<button type="button" class="btn peq fantasma zona-proy" data-usar-proy="${tipo}" hidden>Usar ${tipo === 'TDR' ? 'los' : 'la'} del proyecto</button>` : ''}</div>`;
  const espera = modal({
    titulo: consultor ? `Nueva Orden de Servicio · ${consultor.nombres}` : `Registrar Orden de Servicio en ${p.codigo}`, ancho: 900,
    contenido: `<div class="reg">
      <section class="reg-paso"><span class="reg-num">1</span><div class="reg-cont"><h3>Orden de Servicio y Términos de Referencia <span class="etq-oblig">· obligatorios</span></h3>
        <p class="mut2">${st.docsProy.length && !consultor ? 'Se usan los documentos cargados al registrar el proyecto. Si esta contratación tiene otra Orden de Servicio, elija su PDF.' : 'Adjunte la Orden de Servicio y los TDR de esta contratación.'} Con «Analizar documentos» se completan los datos del profesional, de la orden y de los entregables; revíselos antes de registrar.</p>
        <div class="reg-docs">${DOCS_OS.map(zona).join('')}</div>
        <div class="reg-analisis"><button type="button" class="btn contorno med" id="b-analizar">${ICONOS.ia} Analizar documentos</button><span class="mut2" id="estado-analisis" role="status">${estado.ia ? 'Con el asistente de IA (sin datos personales ni montos)' : 'Lectura directa del texto de los PDF'}</span></div>
        <ul class="reg-dif" id="reg-dif" hidden aria-label="Diferencias con lo escrito"></ul>
        <ul class="reg-adv" id="reg-adv" hidden></ul></div></section>
      <section class="reg-paso"><span class="reg-num">2</span><div class="reg-cont"><h3>Profesional contratado</h3><div class="form">
        ${consultor ? `<div class="campo ancho"><label>Profesional</label><input value="${esc(consultor.nombres)} (${esc(consultor.clave)})" readonly disabled></div>` : `
        <div class="campo ancho"><label for="os-nombres">Nombres y apellidos</label><input id="os-nombres" name="nombres" maxlength="150" value="${v('nombres')}" required></div>
        <div class="campo"><label for="os-clave">Clave (2 a 5 letras)</label><input id="os-clave" name="clave" maxlength="5" value="${v('clave')}" placeholder="Iniciales, p. ej. JJA" style="text-transform:uppercase" required></div>
        <div class="campo"><label for="os-correo">Correo institucional</label><input id="os-correo" name="correo_institucional" type="email" maxlength="150" value="${v('correo_institucional')}" placeholder="No figura en la OS: opcional"></div>
        <div class="campo ancho"><label for="os-perfil">Perfil / servicio contratado</label><input id="os-perfil" name="perfil" maxlength="200" value="${v('perfil')}" placeholder="Ej.: Analista programador"></div>`}
      </div></div></section>
      <section class="reg-paso"><span class="reg-num">3</span><div class="reg-cont"><h3>Orden de Servicio</h3><div class="form">
        <div class="campo"><label for="os-num">N.° de Orden de Servicio</label><input id="os-num" name="numero" maxlength="60" value="${v('numero')}" required></div>
        <div class="campo"><label for="os-exp">Expediente</label><input id="os-exp" name="expediente" maxlength="40" value="${v('expediente')}"></div>
        <div class="campo ancho"><label for="os-obj">Objeto del servicio (título del TDR)</label><input id="os-obj" name="titulo_tdr" maxlength="300" value="${v('titulo_tdr')}"></div>
        <div class="campo"><label for="os-monto">Monto (S/) — confidencial</label><input id="os-monto" name="monto" type="number" min="0.01" step="0.01" value="${v('monto')}" required></div>
        <div class="campo"><label for="os-plazo">Plazo total (días calendario)</label><input id="os-plazo" name="plazo_dias" type="number" min="1" max="1095" value="${v('plazo_dias')}" required></div>
      </div><p class="mut2">Las fechas se calculan al registrar la <b>notificación</b>: el plazo corre desde el día siguiente, en días calendario.</p></div></section>
      <section class="reg-paso"><span class="reg-num">4</span><div class="reg-cont"><h3>Entregables del TDR</h3>
        <p class="mut2">Plazos crecientes, en días desde la notificación; el último suele coincidir con el plazo total.</p>${tablaEntregablesEditable(entregables)}</div></section>
      <p class="reg-error" id="reg-error" role="alert" hidden></p>
    </div>`,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Registrar Orden de Servicio', clase: 'prim', valor: 'ok' }],
  });
  const velo = [...document.querySelectorAll('.velo')].pop();
  const form = velo && velo.querySelector('form');
  let auto = false;
  if (form) { velo.querySelector('.modal').classList.add('modal-reg'); enlazarEntregables(form); auto = enlazarDocumentosOS(velo, p, st, previo); }
  if (auto) velo.querySelector('#b-analizar').click(); // la primera OS: se leen al abrir los documentos del proyecto
  const r = await espera;
  if (r.valor !== 'ok') return false;
  const datos = { ...r.datos, entregables: leerEntregables(r.form) };
  for (const k of Object.keys(datos)) if (/^(e_|__)/.test(k)) delete datos[k];
  if (datos.clave) datos.clave = String(datos.clave).toUpperCase();
  if (consultor) datos.consultor_id = consultor.consultor_id;
  try {
    const documentos = await documentosParaEnviar(st);
    const n = await api('POST', `/proyectos/${p.proyecto_id}/contrataciones`, { ...datos, documentos });
    aviso(`Orden de Servicio N.° ${n.contrato.numero} registrada. Registre la notificación para iniciar el plazo.`, 'exito');
    for (const a of n.advertencias || []) aviso(a);
    if (n.documentos_pendientes && n.documentos_pendientes.length) aviso(`No se pudo guardar: ${n.documentos_pendientes.join('; ')}. Adjúntelo desde la lista de profesionales.`, 'error');
    return true;
  } catch (err) { fallo(err); return registrarOrdenServicio(p, consultor, datos, st); }
}

/** Token del PDF elegido (se sube una sola vez) o «PROYECTO» (el documento que ya tiene el proyecto). */
async function documentosParaEnviar(st) {
  const documentos = {};
  for (const [t, , rotulo] of DOCS_OS) {
    const f = st.archivos[t];
    if (f) {
      if (!st.subidos[t] || st.subidos[t].archivo !== f) st.subidos[t] = { archivo: f, token: await subirTemporal(f, rotulo) };
      documentos[t] = st.subidos[t].token;
    } else if (st.usar[t] && st.docsProy.some((d) => d.tipo === t)) documentos[t] = 'PROYECTO';
  }
  return documentos;
}

/** Zonas de carga, análisis de la OS y el TDR y validación. Devuelve true si conviene analizar al abrir. */
function enlazarDocumentosOS(velo, p, st, previo) {
  const form = velo.querySelector('form');
  const el = (n) => form.elements[n];
  const err = velo.querySelector('#reg-error');
  const tieneDoc = (t) => !!st.archivos[t] || (st.usar[t] && st.docsProy.some((d) => d.tipo === t));
  const pintarZona = (z) => {
    const t = z.dataset.zona; const f = st.archivos[t]; const dp = st.docsProy.find((d) => d.tipo === t);
    z.querySelector('[data-arch]').textContent = f ? `${f.name} · ${tamano(f)}` : st.usar[t] && dp ? `Del proyecto: ${dp.nombre_original} · pulse para elegir otro PDF` : 'Arrastre el PDF aquí o pulse para elegirlo';
    z.classList.toggle('lista', tieneDoc(t));
    const b = velo.querySelector(`[data-usar-proy="${t}"]`);
    if (b) b.hidden = !f && st.usar[t];
  };
  const elegir = (z, f) => { st.archivos[z.dataset.zona] = f; st.usar[z.dataset.zona] = false; pintarZona(z); };
  velo.querySelectorAll('.zona').forEach((z) => {
    const input = z.querySelector('input');
    if (st.archivos[z.dataset.zona]) { try { const dt = new DataTransfer(); dt.items.add(st.archivos[z.dataset.zona]); input.files = dt.files; } catch { /* navegador sin DataTransfer */ } }
    pintarZona(z);
    input.addEventListener('change', () => { if (input.files[0]) elegir(z, input.files[0]); });
    z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('sobre'); });
    z.addEventListener('dragleave', () => z.classList.remove('sobre'));
    z.addEventListener('drop', (e) => {
      e.preventDefault(); z.classList.remove('sobre');
      const f = e.dataTransfer.files[0];
      if (!f) return;
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { aviso('Solo se admiten archivos PDF', 'error'); return; }
      try { input.files = e.dataTransfer.files; } catch { /* solo se recuerda el archivo */ }
      elegir(z, f);
    });
  });
  velo.querySelectorAll('[data-usar-proy]').forEach((b) => { b.onclick = () => {
    const t = b.dataset.usarProy; st.archivos[t] = null; st.usar[t] = true;
    const z = velo.querySelector(`.zona[data-zona="${t}"]`); z.querySelector('input').value = ''; pintarZona(z);
  }; });
  // lo leído se resalta hasta que el usuario lo edita
  form.addEventListener('input', (e) => { if (e.target.classList.contains('leido')) { e.target.classList.remove('leido'); const etq = e.target.closest('.campo')?.querySelector('.etq-leido'); if (etq) etq.remove(); } });
  const poner = (c, valor) => {
    c.value = valor; c.dispatchEvent(new Event('input')); c.classList.add('leido');
    const lbl = c.closest('.campo')?.querySelector('label');
    if (lbl && !lbl.querySelector('.etq-leido')) lbl.insertAdjacentHTML('beforeend', ' <span class="etq-leido">Leído del documento</span>');
  };
  const proponer = (n, valor) => {
    const c = el(n);
    if (!c || valor === null || valor === undefined || valor === '') return null;
    if (String(c.value).trim().toUpperCase() === String(valor).trim().toUpperCase()) return null;
    if (c.value && !c.classList.contains('leido')) return 'distinto';
    poner(c, valor);
    return 'puesto';
  };
  // entregables: se reemplazan si la tabla sigue con los iniciales o vacía; si no, se ofrece «Usar»
  const tablaIntacta = () => {
    const l = leerEntregables(form);
    return !l.length || (l.every((x) => !x.plazo_dias && !x.porcentaje_pago) && l.map((x) => x.nombre).join('|') === ENTREGABLES_INICIALES.map((x) => x.nombre).join('|'));
  };
  const ponerEntregables = (lista) => { form.querySelector('#filas-ent').innerHTML = lista.map((x, i) => filaEntregable(i + 1, x)).join(''); enlazarEntregables(form); };
  let entLeidos = [];
  const bA = velo.querySelector('#b-analizar'); const est = velo.querySelector('#estado-analisis');
  const adv = velo.querySelector('#reg-adv'); const dif = velo.querySelector('#reg-dif');
  dif.addEventListener('click', (e) => {
    const b = e.target.closest('[data-usar]');
    if (!b) return;
    if (b.dataset.usar === '__entregables') ponerEntregables(entLeidos); else poner(el(b.dataset.usar), b.dataset.valor);
    b.closest('li').remove(); if (!dif.querySelector('li')) dif.hidden = true;
  });
  bA.onclick = async () => {
    if (!DOCS_OS.some(([t]) => tieneDoc(t))) { aviso('Elija primero la Orden de Servicio y los TDR (PDF)', 'error'); return; }
    bA.disabled = true; bA.classList.add('cargando'); est.textContent = 'Leyendo la Orden de Servicio y los TDR…'; adv.hidden = true; dif.hidden = true;
    try {
      const r = await api('POST', `/proyectos/${p.proyecto_id}/contrataciones/leer-documentos`, { documentos: await documentosParaEnviar(st) });
      const res = Object.keys(ETIQUETAS_OS).map((k) => [k, proponer(k, r[k])]);
      const distintos = res.filter(([, x]) => x === 'distinto').map(([k]) => k);
      let puestos = res.filter(([, x]) => x === 'puesto').length;
      entLeidos = (r.entregables || []).filter((x) => x.nombre).map((x) => ({ nombre: x.nombre, plazo_dias: x.plazo_dias ?? '', porcentaje_pago: x.porcentaje_pago ?? '' }));
      let entDistintos = false;
      if (entLeidos.length) { if (tablaIntacta()) { ponerEntregables(entLeidos); puestos += 1; } else entDistintos = true; }
      const fuente = r.origen === 'IA' ? 'el asistente de IA' : 'el texto de los documentos';
      est.textContent = puestos ? `${puestos} dato(s) completado(s) con ${fuente}: revíselos.` : distintos.length || entDistintos ? `Revise las diferencias con ${fuente}.` : r.origen ? 'Lo escrito coincide con los documentos.' : '';
      const corto = (s) => (String(s).length > 160 ? `${String(s).slice(0, 160)}…` : String(s));
      dif.innerHTML = distintos.map((k) => `<li><span><b>${ETIQUETAS_OS[k]}</b> según el documento: «${esc(corto(r[k]))}»</span><button type="button" class="btn peq contorno" data-usar="${k}" data-valor="${esc(r[k])}">Usar</button></li>`).join('')
        + (entDistintos ? `<li><span><b>Entregables</b> según el TDR: ${esc(corto(entLeidos.map((x) => `${x.nombre}${x.plazo_dias ? ` (día ${x.plazo_dias})` : ''}`).join('; ')))}</span><button type="button" class="btn peq contorno" data-usar="__entregables">Usar</button></li>` : '');
      dif.hidden = !(distintos.length || entDistintos);
      adv.innerHTML = (r.advertencias || []).map((a) => `<li>${esc(a)}</li>`).join(''); adv.hidden = !(r.advertencias || []).length;
    } catch (e) { est.textContent = ''; fallo(e); } finally { bA.disabled = false; bA.classList.remove('cargando'); }
  };
  // validación antes de cerrar (la ventana se queda abierta y muestra qué falta)
  const validar = () => {
    const faltan = [];
    for (const [t, , rotulo] of DOCS_OS) if (!tieneDoc(t)) faltan.push(`${rotulo} (PDF)`);
    if (el('nombres') && String(el('nombres').value || '').trim().length < 5) faltan.push('los nombres y apellidos del profesional');
    if (el('clave') && !/^[A-Za-zÑñ]{2,5}$/.test(String(el('clave').value || '').trim())) faltan.push('la clave (2 a 5 letras)');
    if (!String(el('numero').value || '').trim()) faltan.push('el número de la Orden de Servicio');
    if (!(Number(el('monto').value) > 0)) faltan.push('el monto');
    const n = Number(el('plazo_dias').value);
    if (!Number.isInteger(n) || n < 1 || n > 1095) faltan.push('el plazo total (de 1 a 1095 días)');
    if (!leerEntregables(form).length) faltan.push('al menos un entregable');
    if (!faltan.length) { err.hidden = true; return true; }
    err.textContent = `Falta: ${faltan.join('; ')}.`; err.hidden = false; err.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return false;
  };
  const prim = velo.querySelector('.pie .btn.prim');
  velo.querySelector('.pie').addEventListener('click', (e) => { if (e.target.closest('.btn') === prim && !validar()) e.stopPropagation(); }, true);
  velo.addEventListener('submit', (e) => { if (!validar()) { e.preventDefault(); e.stopPropagation(); } }, true);
  // al abrir: si están los dos documentos del proyecto y la ventana viene vacía, se analizan de inmediato
  const vacio = !['numero', 'monto', 'nombres'].some((k) => previo[k]);
  return vacio && DOCS_OS.every(([t]) => st.usar[t]) && st.docsProy.length > 0;
}

/** Registrar (o corregir) la notificación: fecha, medio y cargo en PDF. Muestra las fechas calculadas antes de confirmar. */
export async function registrarNotificacion(c) {
  const corregir = c.estado_contratacion === 'EN_EJECUCION' && !!c.fecha_notificacion;
  let lista;
  try { lista = await medios(); } catch (err) { fallo(err); return false; }
  const espera = modal({
    titulo: `${corregir ? 'Corregir la notificación' : 'Registrar la notificación'} · OS N.° ${c.numero}`, ancho: 720,
    contenido: `<p class="mut" style="margin:0">${esc(c.nombres)}. ${corregir ? 'Corregir la fecha cambia el inicio, el fin y las fechas límite de los entregables: quedará en la bitácora con su motivo.' : 'El plazo empieza al día siguiente de la notificación, en días calendario.'}</p>
      <div class="form">
        <div class="campo"><label>Fecha de notificación</label><input type="date" name="fecha_notificacion" value="${esc(c.fecha_notificacion || '')}" required></div>
        <div class="campo"><label>Medio</label><select name="medio_notificacion"><option value="">— Seleccione —</option>${lista.map(([k, t]) => `<option value="${k}" ${c.medio_notificacion === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
        <div class="campo ancho"><label>Cargo o constancia de notificación (PDF)${corregir ? ' — opcional al corregir' : ' — obligatorio'}</label><input type="file" name="__notif" accept="application/pdf,.pdf"></div>
        ${corregir ? '<div class="campo ancho"><label>Motivo de la corrección (quedará en la bitácora)</label><textarea name="motivo" required></textarea></div>' : ''}
        <div class="campo ancho" id="vista-plazos"><span class="mut2">Elija la fecha para ver el inicio, el fin y las fechas límite.</span></div>
      </div>`,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: corregir ? 'Corregir notificación' : 'Registrar notificación', clase: 'prim', valor: 'ok' }],
  });
  const form = document.querySelector('.modal form');
  const vista = form && form.querySelector('#vista-plazos');
  const previsualizar = async () => {
    const fecha = form.elements.fecha_notificacion.value;
    if (!fecha) return;
    try {
      const p = await api('POST', `/contratos/${c.contrato_id}/notificacion/previsualizar`, { fecha_notificacion: fecha });
      vista.innerHTML = `<b>Fechas que se registrarán</b><dl class="proy-datos"><div><dt>Inicio del plazo</dt><dd>${ff(p.inicio)}</dd></div><div><dt>Fin de la Orden de Servicio</dt><dd>${ff(p.fin)}</dd></div></dl>
        <table><thead><tr><th>N.°</th><th>Entregable</th><th>Fecha límite</th></tr></thead><tbody>${p.entregables.map((e) => `<tr><td class="num">${e.numero}</td><td>${esc(e.nombre || '')}</td><td class="num">${ff(e.fecha_limite)}</td></tr>`).join('')}</tbody></table>
        ${(p.advertencias || []).map((a) => `<div class="mut2">⚠ ${esc(a)}</div>`).join('')}`;
    } catch (err) { vista.innerHTML = `<span class="mut2">${esc(err.message)}</span>`; }
  };
  if (form) { form.elements.fecha_notificacion.addEventListener('change', previsualizar); if (c.fecha_notificacion) previsualizar(); }
  const r = await espera;
  if (r.valor !== 'ok') return false;
  try {
    const archivo = r.form.elements.__notif.files[0];
    const documento = archivo || !corregir ? await subirTemporal(archivo, 'el cargo o constancia de notificación') : undefined;
    const n = await api('POST', `/contratos/${c.contrato_id}/notificacion`, { fecha_notificacion: r.datos.fecha_notificacion, medio_notificacion: r.datos.medio_notificacion, motivo: r.datos.motivo || undefined, documento, revision: c.revision });
    aviso(`Notificación registrada: el plazo va del ${ff(n.inicio)} al ${ff(n.fin)}`, 'exito');
    return true;
  } catch (err) { fallo(err); return false; }
}

/** Resolución de una OS en ejecución (termina antes de completar sus entregables). */
export async function resolverOS(c) {
  const hoy = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
  const r = await modal({
    titulo: `Resolver la Orden de Servicio N.° ${c.numero}`, ancho: 640,
    contenido: `<p class="mut" style="margin:0">${esc(c.nombres)}. La Orden de Servicio termina antes de completar sus entregables: los pendientes se anulan con el motivo y, si era la última OS abierta, el proyecto queda concluido. No se puede deshacer.</p>
      <div class="form">
        <div class="campo"><label>Fecha de la resolución</label><input type="date" name="fecha" value="${hoy}" max="${hoy}"></div>
        <div class="campo ancho"><label>Documento que la resuelve</label><input name="documento_ref" maxlength="300" placeholder="Ej.: Carta N.° 077-2026-MIDAGRI-SERFOR-OGA" required></div>
        <div class="campo ancho"><label>Motivo (quedará en la bitácora)</label><textarea name="motivo" maxlength="800" required></textarea></div>
        <div class="campo ancho"><label>PDF del documento (opcional)</label><input type="file" name="__doc" accept="application/pdf,.pdf"></div></div>`,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Resolver la Orden de Servicio', clase: 'prim', valor: 'ok' }],
  });
  if (r.valor !== 'ok') return false;
  try {
    const archivo = r.form.elements.__doc.files[0];
    const documento = archivo ? await subirTemporal(archivo, 'el documento de resolución') : undefined;
    const datos = { ...r.datos, documento, revision: c.revision }; delete datos.__doc;
    const n = await api('POST', `/contratos/${c.contrato_id}/resolver`, datos);
    aviso(`Orden de Servicio N.° ${c.numero} resuelta${n.proyecto_concluido ? '. El proyecto quedó concluido' : ''}`, 'exito');
    return true;
  } catch (err) { fallo(err); return false; }
}

/** Anulación de una OS registrada y nunca notificada. */
export async function anularOS(c) {
  const r = await modal({
    titulo: `Anular la Orden de Servicio N.° ${c.numero}`, ancho: 600,
    contenido: `<p class="mut" style="margin:0">${esc(c.nombres)}. La Orden de Servicio no llegó a notificarse: se anula con sus entregables (no se borra; queda en la bitácora). No se puede deshacer.</p>
      <div class="form"><div class="campo ancho"><label>Motivo de la anulación</label><textarea name="motivo" maxlength="800" required></textarea></div></div>`,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Anular la Orden de Servicio', clase: 'prim', valor: 'ok' }],
  });
  if (r.valor !== 'ok') return false;
  try {
    await api('POST', `/contratos/${c.contrato_id}/anular`, { motivo: r.datos.motivo, revision: c.revision });
    aviso(`Orden de Servicio N.° ${c.numero} anulada`, 'exito');
    return true;
  } catch (err) { fallo(err); return false; }
}

/** Ampliación de plazo de la misma Orden de Servicio (con el documento que la aprueba). */
export async function ampliarPlazo(c) {
  const r = await modal({
    titulo: `Ampliación de plazo · OS N.° ${c.numero}`, ancho: 640,
    contenido: `<p class="mut" style="margin:0">${esc(c.nombres)}. La Orden de Servicio vence el ${ff(c.fecha_fin || c.fin_vigencia)}; la ampliación empieza al día siguiente. Para un servicio nuevo use «Nueva OS».</p>
      <div class="form">
        <div class="campo"><label>Días de ampliación</label><input type="number" name="plazo_dias" min="1" max="365" required></div>
        <div class="campo ancho"><label>Documento que la aprueba</label><input name="documento_ref" maxlength="300" placeholder="Ej.: Carta N.° 045-2026-MIDAGRI-SERFOR-OGA" required></div>
        <div class="campo ancho"><label>Motivo (quedará en la bitácora)</label><textarea name="motivo" required></textarea></div></div>`,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Registrar ampliación', clase: 'prim', valor: 'ok' }],
  });
  if (r.valor !== 'ok') return false;
  try {
    const n = await api('POST', `/contratos/${c.contrato_id}/ampliacion`, { ...r.datos, revision: c.revision });
    aviso(`Plazo ampliado hasta el ${ff(n.fecha_fin)}`, 'exito');
    for (const a of n.advertencias || []) aviso(a);
    return true;
  } catch (err) { fallo(err); return false; }
}

/** Entregables de la Orden de Servicio con su fecha límite, estado y semáforo (calculados en el servidor). */
const hoyLima = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
/** «Primer entregable: Diagnóstico…» → «Diagnóstico…» (el número del entregable ya se muestra aparte). */
export const nombreEntregable = (n) => { const s = String(n || ''); const t = s.replace(/^\s*(?:(?:primer|primero|segundo|tercer|tercero|cuarto|quinto|sexto|s[eé]ptimo|octavo|noveno|d[eé]cimo|[uú]nico|\d{1,2}\s*[°º.]?)\s+)?(?:entregable|producto)(?:\s*(?:n[°º.o]*\s*)?\d{1,2})?\s*[:.\-–—]\s*/i, ''); return t.trim() ? t.trim() : s; };
const TIPO_DOC = { ENTREGABLE: 'Entregable', OBSERVACION: 'Observación', CONFORMIDAD: 'Conformidad' };

/** Sube un documento temporal: el del entregable admite PDF, Word, Excel o imagen; los demás, solo PDF. */
async function subirDocumento(archivo, rotulo, evidencia) {
  if (!archivo) return undefined;
  if (archivo.size > MAX_PDF) throw new Error(`${rotulo}: supera el máximo de 15 MB`);
  const r = await fetch(`/api/documentos/temporales${evidencia ? '?formato=evidencia' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-SGF': '1', 'X-Nombre': encodeURIComponent(archivo.name) }, body: archivo, credentials: 'same-origin' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${rotulo}: ${d.error || `Error ${r.status}`}`);
  return d.token;
}

/**
 * Presentación o subsanación de un entregable: primero se sube el documento; el sistema lo lee y propone la fecha de
 * presentación (sello de recepción o fecha del documento) y la observación (documento y expediente), y avisa si
 * parece de otro entregable. El usuario revisa y registra; el mismo archivo subido es el que se guarda.
 */
async function presentarEntregable(e) {
  const subsana = e.estado === 'OBSERVADO';
  const st = { archivo: null, token: null };
  const espera = modal({
    titulo: `ENTREGABLE ${e.numero}${subsana ? ' · SUBSANACIÓN' : ''}`, ancho: 680,
    contenido: `<div class="reg">
      <p class="mut" style="margin:0">${esc(nombreEntregable(e.nombre))}</p>
      <section class="reg-paso"><span class="reg-num">1</span><div class="reg-cont"><h3>Documento ${subsana ? 'de la subsanación' : 'del entregable'} <span class="etq-oblig">· obligatorio</span></h3>
        <label class="zona" data-zona="DOC"><input type="file" name="__doc" accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png" aria-label="Documento del entregable">
          <span class="zona-ico">${ICONOS.adendas}</span>
          <span class="zona-txt"><b>Suba el documento con que se presentó</b><small>PDF, Word, Excel o imagen, hasta 15 MB. Se analiza al elegirlo.</small><span class="zona-arch" data-arch>Arrastre el archivo aquí o pulse para elegirlo</span></span></label>
        <div class="reg-analisis"><span class="mut2" id="estado-analisis" role="status">${estado.ia ? 'Se lee con el asistente de IA (sin datos personales ni montos)' : 'Se lee el texto del documento'}</span></div>
        <ul class="reg-info" id="reg-info" hidden></ul>
        <ul class="reg-adv" id="reg-adv" hidden></ul></div></section>
      <section class="reg-paso"><span class="reg-num">2</span><div class="reg-cont"><h3>Datos de la ${subsana ? 'subsanación' : 'presentación'}</h3><div class="form">
        <div class="campo"><label for="ent-fecha">Fecha de ${subsana ? 'subsanación' : 'presentación'}</label><input id="ent-fecha" type="date" name="fecha" max="${hoyLima()}"></div>
        <div class="campo ancho"><label for="ent-obs">Observación (opcional)</label><textarea id="ent-obs" name="observacion" maxlength="1000" placeholder="Ej.: Presentado con Carta N.° 005-2026, expediente 2026-0123"></textarea></div>
      </div>
      ${subsana ? `<p class="mut2" style="margin:0">Observación pendiente: ${esc(e.observacion || '')} (subsanar hasta el ${ff(e.fecha_limite_subsanacion)}).</p>` : e.fecha_limite ? `<p class="mut2" style="margin:0" id="ent-limite">Fecha límite: ${ff(e.fecha_limite)}. Si se presenta después, quedan registrados los días de atraso.</p>` : ''}</div></section>
      <p class="reg-error" id="reg-error" role="alert" hidden></p></div>`,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: subsana ? 'Registrar subsanación' : 'Registrar presentación', clase: 'prim', valor: 'ok' }],
  });
  const velo = [...document.querySelectorAll('.velo')].pop();
  const form = velo.querySelector('form');
  velo.querySelector('.modal').classList.add('modal-reg');
  const el = (n) => form.elements[n];
  const zona = velo.querySelector('.zona'); const input = zona.querySelector('input');
  const est = velo.querySelector('#estado-analisis'); const info = velo.querySelector('#reg-info'); const adv = velo.querySelector('#reg-adv'); const err = velo.querySelector('#reg-error');
  form.addEventListener('input', (ev) => { if (ev.target.classList.contains('leido')) { ev.target.classList.remove('leido'); const etq = ev.target.closest('.campo')?.querySelector('.etq-leido'); if (etq) etq.remove(); } });
  const poner = (c, valor) => {
    if (valor === null || valor === undefined || valor === '') return false;
    if (c.value && !c.classList.contains('leido') && c.value !== valor) return false; // lo escrito por el usuario no se pisa
    c.value = valor; c.classList.add('leido');
    const lbl = c.closest('.campo')?.querySelector('label');
    if (lbl && !lbl.querySelector('.etq-leido')) lbl.insertAdjacentHTML('beforeend', ' <span class="etq-leido">Leído del documento</span>');
    return true;
  };
  const analizar = async (f) => {
    st.archivo = f; st.token = null;
    const tam = f.size < 1048576 ? `${Math.max(1, Math.round(f.size / 1024))} KB` : `${(f.size / 1048576).toFixed(1).replace('.', ',')} MB`;
    zona.querySelector('[data-arch]').textContent = `${f.name} · ${tam}`; zona.classList.add('lista');
    est.textContent = 'Leyendo el documento…'; info.hidden = true; adv.hidden = true; err.hidden = true;
    try {
      st.token = await subirDocumento(f, 'El documento', true);
      const r = await api('POST', `/entregables/${e.entregable_servicio_id}/leer-documento`, { documento: st.token });
      const puestos = [poner(el('fecha'), r.fecha), poner(el('observacion'), r.observacion)].filter(Boolean).length;
      const fuente = r.origen === 'IA' ? 'el asistente de IA' : 'el texto del documento';
      est.textContent = r.origen ? (puestos ? `${puestos} dato(s) completado(s) con ${fuente}: revíselos.` : `Revise los datos leídos con ${fuente}.`) : '';
      const datos = [
        r.documento ? `Documento: ${r.documento}${r.expediente ? ` · expediente ${r.expediente}` : ''}` : null,
        r.fecha ? `Fecha leída: ${ff(r.fecha)} (${r.fuente_fecha === 'RECEPCION' ? 'sello o cargo de recepción' : 'fecha del documento'})${r.dias_atraso ? ` · ${r.dias_atraso} día(s) después de la fecha límite` : ''}` : null,
        r.coincide ? `Corresponde al entregable ${e.numero}` : null,
        r.resumen ? `Contenido: ${r.resumen}` : null,
      ].filter(Boolean);
      info.innerHTML = datos.map((a) => `<li>${esc(a)}</li>`).join(''); info.hidden = !datos.length;
      adv.innerHTML = (r.advertencias || []).map((a) => `<li>${esc(a)}</li>`).join(''); adv.hidden = !(r.advertencias || []).length;
    } catch (ex) { est.textContent = ''; fallo(ex); }
  };
  input.addEventListener('change', () => { if (input.files[0]) analizar(input.files[0]); });
  zona.addEventListener('dragover', (ev) => { ev.preventDefault(); zona.classList.add('sobre'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('sobre'));
  zona.addEventListener('drop', (ev) => { ev.preventDefault(); zona.classList.remove('sobre'); const f = ev.dataTransfer.files[0]; if (f) analizar(f); });
  const validar = () => {
    const faltan = [];
    if (!st.archivo) faltan.push(`el documento ${subsana ? 'de la subsanación' : 'del entregable'}`);
    if (!el('fecha').value) faltan.push(`la fecha de ${subsana ? 'subsanación' : 'presentación'}`);
    else if (el('fecha').value > hoyLima()) faltan.push('una fecha que no sea posterior a hoy');
    if (!faltan.length) { err.hidden = true; return true; }
    err.textContent = `Falta: ${faltan.join('; ')}.`; err.hidden = false;
    return false;
  };
  const prim = velo.querySelector('.pie .btn.prim');
  velo.querySelector('.pie').addEventListener('click', (ev) => { if (ev.target.closest('.btn') === prim && !validar()) ev.stopPropagation(); }, true);
  velo.addEventListener('submit', (ev) => { if (!validar()) { ev.preventDefault(); ev.stopPropagation(); } }, true);
  const r = await espera;
  if (r.valor !== 'ok') return false;
  try {
    const documento = st.token || await subirDocumento(st.archivo, 'El documento', true);
    await api('POST', `/entregables/${e.entregable_servicio_id}/presentar`, { fecha: r.datos.fecha, observacion: r.datos.observacion, documento, revision: e.revision });
    aviso(`Entregable ${e.numero} ${subsana ? 'subsanado' : 'presentado'}`, 'exito');
    return true;
  } catch (ex) { fallo(ex); return false; }
}

/** Presentación (o subsanación), observación o conformidad de un entregable (Etapa 3). Devuelve true si se registró. */
async function accionEntregable(accion, e) {
  if (accion === 'presentar') return presentarEntregable(e);
  const subsana = accion === 'presentar' && e.estado === 'OBSERVADO';
  const cfg = {
    presentar: { titulo: `${subsana ? 'Subsanación' : 'Presentación'} · Entregable ${e.numero}`, boton: subsana ? 'Registrar subsanación' : 'Registrar presentación',
      campos: `<div class="campo"><label>Fecha de ${subsana ? 'subsanación' : 'presentación'}</label><input type="date" name="fecha" value="${hoyLima()}" max="${hoyLima()}"></div>
        <div class="campo ancho"><label>Documento ${subsana ? 'de la subsanación' : 'del entregable'} (PDF, Word, Excel o imagen) — obligatorio</label><input type="file" name="__doc" accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png"></div>
        <div class="campo ancho"><label>Observación (opcional)</label><textarea name="observacion" maxlength="1000" placeholder="Ej.: Presentado por mesa de partes, expediente 2026-0123"></textarea></div>
        ${subsana ? `<p class="mut2 ancho" style="margin:0">Observación pendiente: ${esc(e.observacion || '')} (subsanar hasta el ${ff(e.fecha_limite_subsanacion)}).</p>` : e.fecha_limite ? `<p class="mut2 ancho" style="margin:0">Fecha límite: ${ff(e.fecha_limite)}. Si se presenta después, quedan registrados los días de atraso.</p>` : ''}`, evidencia: true },
    observar: { titulo: `Observar · Entregable ${e.numero}`, boton: 'Registrar observación',
      campos: `<div class="campo"><label>Fecha de la observación</label><input type="date" name="fecha" value="${hoyLima()}" max="${hoyLima()}"></div>
        <div class="campo"><label>Plazo para subsanar (días calendario)</label><input type="number" name="plazo_subsanacion_dias" min="1" max="60" placeholder="Según el TDR (por defecto, el parámetro)"></div>
        <div class="campo ancho"><label>Observaciones</label><textarea name="observacion" maxlength="1000" required></textarea></div>
        <div class="campo ancho"><label>Documento de la observación (PDF, opcional)</label><input type="file" name="__doc" accept="application/pdf,.pdf"></div>`, evidencia: false },
    conformidad: { titulo: `Conformidad · Entregable ${e.numero}`, boton: 'Dar la conformidad',
      campos: `<div class="campo"><label>Fecha de conformidad</label><input type="date" name="fecha" value="${hoyLima()}" max="${hoyLima()}"></div>
        <div class="campo ancho"><label>Documento de conformidad</label><input name="conformidad_ref" maxlength="300" placeholder="Ej.: Informe N.° 012-2026-MIDAGRI-SERFOR-OTI" required></div>
        <div class="campo ancho"><label>PDF del documento de conformidad (opcional)</label><input type="file" name="__doc" accept="application/pdf,.pdf"></div>
        <p class="mut2 ancho" style="margin:0">Si es el último entregable, la Orden de Servicio queda culminada.</p>`, evidencia: false },
  }[accion];
  const r = await modal({ titulo: cfg.titulo, ancho: 640, contenido: `<p class="mut" style="margin:0">${esc(nombreEntregable(e.nombre))}</p><div class="form">${cfg.campos}</div>`, botones: [{ texto: 'Cancelar', valor: null }, { texto: cfg.boton, clase: 'prim', valor: 'ok' }] });
  if (r.valor !== 'ok') return false;
  try {
    const documento = await subirDocumento(r.form.elements.__doc.files[0], 'El documento', cfg.evidencia);
    const datos = { ...r.datos, documento, revision: e.revision }; delete datos.__doc;
    const n = await api('POST', `/entregables/${e.entregable_servicio_id}/${accion}`, datos);
    aviso(accion === 'observar' ? `Entregable ${e.numero} observado: subsanar hasta el ${ff(n.fecha_limite_subsanacion)}` : accion === 'conformidad' ? `Conformidad del entregable ${e.numero} registrada${n.os_culminada ? '. La Orden de Servicio quedó culminada' : ''}${n.proyecto_concluido ? ' y el proyecto, concluido' : ''}` : `Entregable ${e.numero} ${subsana ? 'subsanado' : 'presentado'}`, 'exito');
    return true;
  } catch (err) { fallo(err); return false; }
}

/**
 * Entregables de la Orden de Servicio con su fecha límite, estado, semáforo y documentos (calculados en el servidor).
 * Con `editable` (equipo del proyecto) se registran la presentación, la observación y la conformidad.
 * Devuelve true si se registró algún cambio (para refrescar la lista).
 */
export async function verEntregables(c, { editable = false } = {}) {
  let cambio = false;
  for (;;) {
    let d;
    try { d = await api('GET', `/contratos/${c.contrato_id}/entregables`); } catch (err) { fallo(err); return cambio; }
    const k = d.contrato;
    const ejec = k.estado_contratacion === 'EN_EJECUCION';
    const acciones = (e) => (!editable || !ejec ? '' : ['PENDIENTE', 'OBSERVADO'].includes(e.estado)
      ? `<button type="button" class="btn peq prim" data-acc="presentar|${e.entregable_servicio_id}">${e.estado === 'OBSERVADO' ? 'Subsanar' : 'Presentar'}</button>`
      : ['PRESENTADO', 'SUBSANADO', 'EN_REVISION'].includes(e.estado)
        ? `<button type="button" class="btn peq" data-acc="observar|${e.entregable_servicio_id}">Observar</button> <button type="button" class="btn peq prim" data-acc="conformidad|${e.entregable_servicio_id}">Conformidad</button>` : '');
    let elegido = null;
    // Una fila por entregable (sin tabla ancha): número, nombre, datos en fichas que se acomodan y acciones a la derecha
    // estado en una línea con su fecha («Presentado el 23/09/2026»); el detalle (atraso, observación) debajo
    const estadoDe = (e) => {
      const base = ESTADO_ENT[e.estado] || e.estado;
      const fecha = e.estado === 'CONFORME' ? e.fecha_conformidad : e.estado === 'SUBSANADO' ? e.fecha_subsanacion : ['PRESENTADO', 'EN_REVISION'].includes(e.estado) ? e.fecha_presentacion : e.estado === 'OBSERVADO' ? e.fecha_observacion : null;
      const extra = [
        e.fecha_presentacion && e.dias_atraso ? `${e.dias_atraso} d de atraso` : null,
        e.estado === 'CONFORME' && e.conformidad_ref ? e.conformidad_ref : null,
        e.estado === 'OBSERVADO' ? `${e.observacion || ''} · subsanar hasta ${ff(e.fecha_limite_subsanacion)}` : null,
      ].filter(Boolean);
      return `${base}${fecha ? ` el ${ff(fecha)}` : ''}${extra.map((t) => `<small>${esc(t)}</small>`).join('')}`;
    };
    const espera = modal({
      titulo: `Entregables · OS N.° ${k.numero}`, ancho: 1000, botones: [],
      contenido: `<dl class="ent-resumen">
          <div><dt>Profesional</dt><dd>${esc(c.nombres)}</dd></div>
          <div><dt>Estado</dt><dd><span class="badge ${(ESTADO_OS[k.estado_contratacion] || ESTADO_OS.REGISTRADA)[0]}">${(ESTADO_OS[k.estado_contratacion] || ESTADO_OS.REGISTRADA)[1]}</span></dd></div>
          <div><dt>Notificación</dt><dd>${k.fecha_notificacion ? `${ff(k.fecha_notificacion)}` : 'Pendiente'}</dd></div>
          <div><dt>Plazo</dt><dd>${k.plazo_dias ? `${k.plazo_dias} días<small>${ff(k.fecha_inicio)} – ${ff(k.fecha_fin)}</small>` : '—'}</dd></div>
          ${'monto' in k ? `<div><dt>Monto</dt><dd>${soles(k.monto)}</dd></div>` : ''}</dl>
        <ol class="ent-lista">
        ${d.entregables.map((e) => { const [cl, tx] = SEMAFORO_ENT[e.semaforo] || SEMAFORO_ENT.GRIS; const acc = acciones(e); return `<li class="ent">
          <span class="ent-num" aria-label="Entregable ${e.numero}">${e.numero}</span>
          <div class="ent-cuerpo">
            <div class="ent-cab"><b>${esc(nombreEntregable(e.nombre))}</b><span class="badge ${cl}">${tx}</span>${e.motivo && e.motivo !== tx ? `<span class="ent-motivo">${esc(e.motivo)}</span>` : ''}</div>
            <dl class="ent-datos">
              <div><dt>Fecha límite</dt><dd>${ff(e.fecha_limite)} <span class="mut2" title="Días calendario desde la notificación">· día ${e.plazo_dias}</span></dd></div>
              <div><dt>% pago · avance</dt><dd>${e.porcentaje_pago ?? '—'} % · ${e.avance} %</dd></div>
              <div><dt>Estado</dt><dd>${estadoDe(e)}</dd></div>
              <div><dt>Documentos</dt><dd>${(e.documentos || []).map((x) => `<a href="/api/documentos/${x.documento_id}/archivo" target="_blank" rel="noopener" title="${esc(x.nombre)}">${esc(TIPO_DOC[x.tipo] || x.tipo)}</a>`).join(' · ') || '<span class="mut2">—</span>'}</dd></div>
            </dl>
          </div>
          ${acc ? `<div class="ent-acc">${acc}</div>` : ''}</li>`; }).join('') || '<li class="vacio">Sin entregables</li>'}
        </ol>
        ${!ejec ? '<p class="mut2" style="margin:0">Los entregables se reciben cuando la Orden de Servicio está en ejecución (notificada).</p>' : ''}`,
    });
    const velo = document.querySelector('.velo');
    if (velo) velo.addEventListener('click', (ev) => { const b = ev.target.closest('[data-acc]'); if (b) { elegido = b.dataset.acc; velo.querySelector('.cerrar').click(); } });
    await espera;
    if (!elegido) return cambio;
    const [accion, id] = elegido.split('|');
    if (await accionEntregable(accion, d.entregables.find((x) => x.entregable_servicio_id === Number(id)))) cambio = true;
  }
}
