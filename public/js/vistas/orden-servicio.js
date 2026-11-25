// Contrataciones por Orden de Servicio (Etapa 2): registro con TDR, OS, monto y entregables; notificación; ampliación.
// Las fechas las calcula el servidor (motor/plazos.js); aquí solo se muestran.
import { api, esc, ff, modal, aviso, fallo, estado } from '../util.js';

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
 */
export async function registrarOrdenServicio(p, consultor = null, previo = {}) {
  const v = (n, d = '') => esc(previo[n] ?? d);
  const entregables = previo.entregables && previo.entregables.length ? previo.entregables : [{ nombre: 'Plan de trabajo', plazo_dias: '' }, { nombre: 'Informe final', plazo_dias: '' }];
  const espera = modal({
    titulo: consultor ? `Nueva Orden de Servicio · ${consultor.nombres}` : `Registrar Orden de Servicio en ${p.codigo}`, ancho: 900,
    contenido: `<p class="mut" style="margin:0">Se registran el TDR, la Orden de Servicio, el monto y los entregables. Las fechas se calculan cuando registre la <b>notificación</b>: el plazo corre desde el día siguiente, en días calendario.</p>
      <div class="form">
        ${consultor ? `<div class="campo ancho"><label>Profesional</label><input value="${esc(consultor.nombres)} (${esc(consultor.clave)})" readonly disabled></div>` : `
        <div class="campo ancho"><b>Profesional contratado</b></div>
        <div class="campo"><label>Clave (2 a 5 letras)</label><input name="clave" maxlength="5" value="${v('clave')}" placeholder="Ej.: MQR" style="text-transform:uppercase" required></div>
        <div class="campo"><label>Correo institucional</label><input name="correo_institucional" type="email" maxlength="150" value="${v('correo_institucional')}"></div>
        <div class="campo ancho"><label>Nombres y apellidos</label><input name="nombres" maxlength="150" value="${v('nombres')}" required></div>
        <div class="campo ancho"><label>Perfil / servicio contratado</label><input name="perfil" maxlength="200" value="${v('perfil')}" placeholder="Ej.: Desarrollador full stack"></div>`}
        <div class="campo ancho"><b>Orden de Servicio</b></div>
        <div class="campo"><label>N.° de Orden de Servicio</label><input name="numero" maxlength="60" value="${v('numero')}" required></div>
        <div class="campo"><label>Expediente</label><input name="expediente" maxlength="40" value="${v('expediente')}"></div>
        <div class="campo ancho"><label>Objeto del servicio (título del TDR)</label><input name="titulo_tdr" maxlength="300" value="${v('titulo_tdr')}"></div>
        <div class="campo"><label>Monto (S/) — confidencial</label><input name="monto" type="number" min="0.01" step="0.01" value="${v('monto')}" required></div>
        <div class="campo"><label>Plazo total (días calendario)</label><input name="plazo_dias" type="number" min="1" max="1095" value="${v('plazo_dias')}" required></div>
        <div class="campo ancho"><b>Entregables del TDR</b> <span class="mut2">Plazos crecientes; el último suele coincidir con el plazo total.</span>${tablaEntregablesEditable(entregables)}</div>
        <div class="campo ancho"><b>Documentos</b> <span class="mut2">(PDF, hasta 15 MB cada uno; obligatorios)</span></div>
        <div class="campo ancho"><label>Términos de Referencia (PDF)</label><input type="file" name="__tdr" accept="application/pdf,.pdf">
          ${estado.ia ? '<div class="acciones" style="margin-top:6px"><button type="button" class="btn peq" id="b-leer-tdr" title="El asistente lee el TDR y propone el objeto, el plazo y los entregables; usted los revisa antes de registrar">Leer el TDR con IA</button><span class="mut2" id="estado-tdr"></span></div>' : ''}</div>
        <div class="campo ancho"><label>Orden de Servicio (PDF)</label><input type="file" name="__os" accept="application/pdf,.pdf"></div>
      </div>`,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Registrar Orden de Servicio', clase: 'prim', valor: 'ok' }],
  });
  const form = document.querySelector('.modal form');
  if (form) enlazarEntregables(form);
  // Lectura del TDR con IA: precarga objeto, perfil, plazo y entregables (el usuario revisa; nada se graba hasta registrar)
  let tdrLeido = null; // { archivo, token } para no volver a subir el mismo PDF al registrar
  const bLeer = form && form.querySelector('#b-leer-tdr');
  if (bLeer) bLeer.onclick = async () => {
    const archivo = form.elements.__tdr.files[0];
    const aviso_ = form.querySelector('#estado-tdr');
    if (!archivo) { aviso('Elija primero el PDF de los Términos de Referencia', 'error'); return; }
    bLeer.disabled = true; aviso_.textContent = ' Leyendo el TDR…';
    try {
      const token = await subirTemporal(archivo, 'los Términos de Referencia');
      const t = await api('POST', '/contrataciones/leer-tdr', { documento: token });
      tdrLeido = { archivo, token };
      if (t.objeto && !form.elements.titulo_tdr.value) form.elements.titulo_tdr.value = t.objeto;
      if (t.perfil && form.elements.perfil && !form.elements.perfil.value) form.elements.perfil.value = t.perfil;
      if (t.plazo_dias) form.elements.plazo_dias.value = t.plazo_dias;
      if (t.entregables && t.entregables.length) {
        form.querySelector('#filas-ent').innerHTML = t.entregables.map((x, i) => filaEntregable(i + 1, x)).join('');
      }
      aviso_.textContent = ` Propuesta cargada: revise los datos${t.advertencias.length ? ` (${t.advertencias.length} advertencia(s))` : ''}.`;
      for (const a of t.advertencias) aviso(a);
    } catch (err) { aviso_.textContent = ''; fallo(err); } finally { bLeer.disabled = false; }
  };
  const r = await espera;
  if (r.valor !== 'ok') return false;
  const datos = { ...r.datos, entregables: leerEntregables(r.form) };
  for (const k of Object.keys(datos)) if (/^(e_|__)/.test(k)) delete datos[k];
  if (consultor) datos.consultor_id = consultor.consultor_id;
  try {
    const archivoTdr = r.form.elements.__tdr.files[0];
    const tdr = tdrLeido && tdrLeido.archivo === archivoTdr ? tdrLeido.token : await subirTemporal(archivoTdr, 'los Términos de Referencia');
    const os = await subirTemporal(r.form.elements.__os.files[0], 'la Orden de Servicio');
    const n = await api('POST', `/proyectos/${p.proyecto_id}/contrataciones`, { ...datos, documentos: { TDR: tdr, ORDEN_SERVICIO: os } });
    aviso(`Orden de Servicio N.° ${n.contrato.numero} registrada. Registre la notificación para iniciar el plazo.`, 'exito');
    for (const a of n.advertencias || []) aviso(a);
    if (n.documentos_pendientes && n.documentos_pendientes.length) aviso(`No se pudo guardar: ${n.documentos_pendientes.join('; ')}. Adjúntelo desde la lista de profesionales.`, 'error');
    return true;
  } catch (err) { fallo(err); return registrarOrdenServicio(p, consultor, datos); }
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

/** Presentación (o subsanación), observación o conformidad de un entregable (Etapa 3). Devuelve true si se registró. */
async function accionEntregable(accion, e) {
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
  const r = await modal({ titulo: cfg.titulo, ancho: 640, contenido: `<p class="mut" style="margin:0">${esc(e.nombre)}</p><div class="form">${cfg.campos}</div>`, botones: [{ texto: 'Cancelar', valor: null }, { texto: cfg.boton, clase: 'prim', valor: 'ok' }] });
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
    const espera = modal({
      titulo: `Entregables · OS N.° ${k.numero}`, ancho: 1000,
      contenido: `<dl class="proy-datos">
          <div><dt>Profesional</dt><dd>${esc(c.nombres)}</dd></div>
          <div><dt>Estado</dt><dd><span class="badge ${(ESTADO_OS[k.estado_contratacion] || ESTADO_OS.REGISTRADA)[0]}">${(ESTADO_OS[k.estado_contratacion] || ESTADO_OS.REGISTRADA)[1]}</span></dd></div>
          <div><dt>Notificación</dt><dd>${k.fecha_notificacion ? `${ff(k.fecha_notificacion)}` : 'Pendiente'}</dd></div>
          <div><dt>Plazo</dt><dd>${k.plazo_dias ? `${k.plazo_dias} días: ${ff(k.fecha_inicio)} – ${ff(k.fecha_fin)}` : '—'}</dd></div>
          ${'monto' in k ? `<div><dt>Monto</dt><dd>${soles(k.monto)}</dd></div>` : ''}</dl>
        <table class="tabla-entregables"><thead><tr><th>N.°</th><th>Entregable</th><th>Fecha límite</th><th class="d">% pago</th><th class="d">Avance</th><th>Estado</th><th>Situación</th><th>Documentos</th><th></th></tr></thead><tbody>
        ${d.entregables.map((e) => { const [cl, tx] = SEMAFORO_ENT[e.semaforo] || SEMAFORO_ENT.GRIS; return `<tr>
          <td class="num">${e.numero}</td><td class="desc">${esc(e.nombre)}<small>${e.plazo_dias} días desde la notificación</small></td><td class="num">${ff(e.fecha_limite)}</td>
          <td class="d num">${e.porcentaje_pago ?? '—'}</td><td class="d num">${e.avance} %</td>
          <td>${ESTADO_ENT[e.estado] || e.estado}${e.fecha_presentacion ? `<small>Presentado ${ff(e.fecha_presentacion)}${e.dias_atraso ? ` · ${e.dias_atraso} d de atraso` : ''}</small>` : ''}${e.fecha_subsanacion ? `<small>Subsanado ${ff(e.fecha_subsanacion)}</small>` : ''}${e.fecha_conformidad ? `<small>Conforme ${ff(e.fecha_conformidad)}: ${esc(e.conformidad_ref || '')}</small>` : ''}${e.estado === 'OBSERVADO' ? `<small>${esc(e.observacion || '')} · subsanar hasta ${ff(e.fecha_limite_subsanacion)}</small>` : ''}</td>
          <td><span class="badge ${cl}">${tx}</span> <small class="mut2">${esc(e.motivo || '')}</small></td>
          <td>${(e.documentos || []).map((x) => `<a href="/api/documentos/${x.documento_id}/archivo" target="_blank" rel="noopener" title="${esc(x.nombre)}">${esc(TIPO_DOC[x.tipo] || x.tipo)}</a>`).join('<br>') || '<span class="mut2">—</span>'}</td>
          <td style="white-space:nowrap">${acciones(e)}</td></tr>`; }).join('') || '<tr><td colspan="9" class="vacio">Sin entregables</td></tr>'}
        </tbody></table>
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
