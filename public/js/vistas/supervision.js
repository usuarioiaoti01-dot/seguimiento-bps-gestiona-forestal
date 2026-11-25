// Supervisión diaria (Etapa 3): el equipo del proyecto registra el parte del día de cada profesional, con el avance de
// las actividades del plan aprobado y sus evidencias. Los partes no se modifican: se corrigen con otro que los rectifica.
import { api, esc, ff, fh, titulo, aviso, fallo, estado, puedeProyecto, opciones } from '../util.js';
import { cargarProyectos } from './proyectos.js';

const MAX_ARCHIVO = 15 * 1024 * 1024;
const hoy = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10); // fecha de Lima (UTC−5)

async function subirEvidencia(archivo) {
  if (archivo.size > MAX_ARCHIVO) throw new Error(`${archivo.name}: supera el máximo de 15 MB`);
  const r = await fetch('/api/documentos/temporales?formato=evidencia', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-SGF': '1', 'X-Nombre': encodeURIComponent(archivo.name) }, body: archivo, credentials: 'same-origin' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${archivo.name}: ${d.error || `Error ${r.status}`}`);
  return d.token;
}

/** Filas de avance: actividades sin subactividades y cada subactividad (el avance de la actividad se calcula). */
function filasAvance(det) {
  const hojas = det.actividades.filter((a) => !a.es_resumen && a.estado !== 'ANULADA');
  return hojas.flatMap((a) => (a.subactividades && a.subactividades.length
    ? a.subactividades.map((s) => ({ actividad_id: a.actividad_id, subactividad_indice: s.indice, numero: `${a.numero}.${s.indice + 1}`, texto: s.texto, avance: Number(s.avance) || 0 }))
    : [{ actividad_id: a.actividad_id, subactividad_indice: null, numero: a.numero, texto: a.descripcion, avance: Number(a.avance) || 0 }]));
}

export async function vistaSupervision(el) {
  titulo('SUPERVISIÓN DIARIA', 'Parte del día de cada profesional: lo realizado, el avance de sus actividades y las evidencias');
  const lista = estado.proyectos && estado.proyectos.length ? estado.proyectos : await cargarProyectos();
  const p = (lista || []).find((x) => x.proyecto_id === estado.proyecto_id);
  if (!p) { el.innerHTML = '<div class="tarjeta"><div class="vacio">Elija un proyecto en el menú lateral.</div></div>'; return; }
  let profesionales = [];
  try { profesionales = await api('GET', `/proyectos/${p.proyecto_id}/profesionales`); } catch (err) { el.innerHTML = `<div class="vacio">${esc(err.message)}</div>`; return; }
  const enServicio = profesionales.filter((c) => c.estado_contratacion !== 'REGISTRADA' || c.contrataciones > 1);
  const puedeEd = puedeProyecto(p.proyecto_id) && p.estado === 'EN_EJECUCION';
  let rectifica = null;

  el.innerHTML = `
    ${puedeEd ? `<div class="tarjeta" id="t-parte"><div class="cab"><h2 id="tit-parte">Registrar parte diario</h2></div><div class="cuerpo">
      <form id="f-parte" class="form" novalidate>
        <div class="campo"><label>Profesional</label><select name="consultor_id"><option value="">— Seleccione —</option>${opciones(enServicio.map((c) => [c.consultor_id, `${c.nombres} (${c.clave})`]))}</select></div>
        <div class="campo"><label>Fecha</label><input type="date" name="fecha" value="${hoy()}" max="${hoy()}"></div>
        <div class="campo ancho"><label>Lo realizado en el día</label><textarea name="descripcion" maxlength="2000" placeholder="Ej.: Se revisó con el profesional el módulo de consultas; quedan pendientes las pruebas de integración"></textarea></div>
        <div class="campo"><label>Incidencias (opcional)</label><textarea name="incidencias" maxlength="1000"></textarea></div>
        <div class="campo"><label>Riesgos (opcional)</label><textarea name="riesgos" maxlength="1000"></textarea></div>
        <div class="campo ancho" id="c-just" hidden><label>Justificación del registro tardío</label><textarea name="justificacion" maxlength="500" placeholder="Obligatoria si el parte es de hace más de 3 días hábiles"></textarea></div>
        <div class="campo ancho" id="c-avance"><span class="mut2">Elija al profesional para ver las actividades de su plan aprobado.</span></div>
        <div class="campo ancho"><label>Evidencias (PDF, JPG, PNG, Word o Excel; hasta 10 de 15 MB)</label><input type="file" name="evidencias" multiple accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx,application/pdf,image/jpeg,image/png"></div>
        <div class="campo ancho"><div class="acciones"><button type="button" class="btn" id="b-cancelar-rect" hidden>Cancelar la rectificación</button><button type="submit" class="btn prim">Registrar parte</button></div></div>
      </form></div></div>` : `<div class="tarjeta"><div class="vacio">${p.estado !== 'EN_EJECUCION' ? 'El proyecto no está en ejecución: no recibe partes diarios.' : 'Solo el equipo del proyecto registra partes diarios; usted puede consultarlos.'}</div></div>`}
    <div class="tarjeta"><div class="cab"><h2>Partes registrados</h2><div class="acciones"><select id="filtro-prof" aria-label="Filtrar por profesional"><option value="">Todos los profesionales</option>${opciones(profesionales.map((c) => [c.consultor_id, c.nombres]))}</select></div></div>
      <div class="cuerpo" id="historial"><div class="vacio">Cargando…</div></div></div>`;

  const form = el.querySelector('#f-parte');
  let filas = [];
  const pintarAvance = async () => {
    const cont = form.querySelector('#c-avance');
    const id = form.elements.consultor_id.value;
    filas = [];
    if (!id) { cont.innerHTML = '<span class="mut2">Elija al profesional para ver las actividades de su plan aprobado.</span>'; return; }
    try {
      const det = await api('GET', `/consultores/${id}`);
      if (!det.plan || det.plan.estado !== 'APROBADO') { cont.innerHTML = '<span class="mut2">Su plan de trabajo aún no está aprobado: registre el parte solo con la descripción y las evidencias.</span>'; return; }
      filas = filasAvance(det);
      cont.innerHTML = `<label>Avance de las actividades <span class="mut2">(deje en blanco las que no cambian)</span></label>
        <table class="tabla-ent"><thead><tr><th>N.°</th><th>Actividad</th><th class="d">Avance actual</th><th>Nuevo avance (%)</th><th>Comentario</th></tr></thead><tbody>
        ${filas.map((f, i) => `<tr><td class="num">${esc(f.numero)}</td><td class="desc">${esc(f.texto)}</td><td class="d num">${f.avance} %</td>
          <td><input type="number" min="0" max="100" step="1" name="av_${i}" style="width:6em" aria-label="Nuevo avance de ${esc(f.numero)}"></td>
          <td><input name="com_${i}" maxlength="500" placeholder="Obligatorio si el avance baja" aria-label="Comentario de ${esc(f.numero)}"></td></tr>`).join('')}</tbody></table>`;
    } catch (err) { cont.innerHTML = `<span class="mut2">${esc(err.message)}</span>`; }
  };
  const salirRectificacion = () => { rectifica = null; el.querySelector('#tit-parte').textContent = 'Registrar parte diario'; el.querySelector('#b-cancelar-rect').hidden = true; };

  if (form) {
    form.elements.consultor_id.addEventListener('change', pintarAvance);
    form.elements.fecha.addEventListener('change', () => { form.querySelector('#c-just').hidden = form.elements.fecha.value >= hoy(); });
    el.querySelector('#b-cancelar-rect').onclick = () => { salirRectificacion(); form.reset(); form.elements.fecha.value = hoy(); pintarAvance(); };
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const boton = form.querySelector('button[type=submit]');
      const items = filas.map((f, i) => ({ f, av: form.elements[`av_${i}`].value, com: form.elements[`com_${i}`].value.trim() }))
        .filter((x) => x.av !== '' && Number(x.av) !== x.f.avance)
        .map((x) => ({ actividad_id: x.f.actividad_id, subactividad_indice: x.f.subactividad_indice, avance: Number(x.av), comentario: x.com || undefined }));
      boton.disabled = true;
      try {
        const evidencias = [];
        for (const archivo of [...(form.elements.evidencias.files || [])].slice(0, 10)) evidencias.push(await subirEvidencia(archivo));
        const r = await api('POST', `/proyectos/${p.proyecto_id}/partes`, {
          consultor_id: Number(form.elements.consultor_id.value) || null, fecha: form.elements.fecha.value, descripcion: form.elements.descripcion.value,
          incidencias: form.elements.incidencias.value || undefined, riesgos: form.elements.riesgos.value || undefined, justificacion: form.elements.justificacion.value || undefined,
          rectifica_parte_id: rectifica || undefined, items, evidencias,
        });
        aviso(`Parte N.° ${r.parte_id} registrado${items.length ? ` con el avance de ${items.length} actividad(es)` : ''}`, 'exito');
        if (r.evidencias_pendientes && r.evidencias_pendientes.length) aviso(`No se guardó: ${r.evidencias_pendientes.join('; ')}`, 'error');
        salirRectificacion();
        const prof = form.elements.consultor_id.value;
        form.reset(); form.elements.fecha.value = hoy(); form.elements.consultor_id.value = prof; form.querySelector('#c-just').hidden = true;
        await pintarAvance(); await pintarHistorial();
      } catch (err) {
        if (err.datos && err.datos.requiereJustificacion) form.querySelector('#c-just').hidden = false;
        fallo(err);
      } finally { boton.disabled = false; }
    });
  }

  const pintarHistorial = async () => {
    const cont = el.querySelector('#historial');
    const filtro = el.querySelector('#filtro-prof').value;
    let partes = [];
    try { partes = await api('GET', `/proyectos/${p.proyecto_id}/partes${filtro ? `?consultor_id=${filtro}` : ''}`); } catch (err) { cont.innerHTML = `<div class="vacio">${esc(err.message)}</div>`; return; }
    if (!partes.length) { cont.innerHTML = '<div class="vacio">Aún no hay partes registrados.</div>'; return; }
    cont.innerHTML = partes.map((x) => `<div class="parte${x.rectificado_por.length ? ' rectificado' : ''}">
      <div class="parte-cab"><b>${ff(x.fecha)} · ${esc(x.nombres || '')}</b> <span class="mut2">Parte N.° ${x.parte_id} · registrado por ${esc(x.modificado_por)} el ${fh(x.registrado_en)}</span>
        ${x.rectifica_parte_id ? `<span class="badge b-azul">Rectifica el N.° ${x.rectifica_parte_id}</span>` : ''}${x.rectificado_por.length ? `<span class="badge b-ambar">Rectificado por el N.° ${x.rectificado_por.join(', ')}</span>` : ''}
        ${puedeEd ? `<button type="button" class="btn peq" data-rectificar="${x.parte_id}">Rectificar</button>` : ''}</div>
      <div style="white-space:pre-wrap">${esc(x.descripcion)}</div>
      ${x.incidencias ? `<div><b>Incidencias:</b> ${esc(x.incidencias)}</div>` : ''}${x.riesgos ? `<div><b>Riesgos:</b> ${esc(x.riesgos)}</div>` : ''}${x.justificacion ? `<div class="mut2"><b>Registro tardío:</b> ${esc(x.justificacion)}</div>` : ''}
      ${x.items.length ? `<table><thead><tr><th>N.°</th><th>Actividad</th><th class="d">Antes</th><th class="d">Reportado</th><th>Comentario</th></tr></thead><tbody>${x.items.map((i) => `<tr><td class="num">${esc(i.numero)}</td><td class="desc">${esc(i.descripcion || '')}</td><td class="d num">${i.avance_anterior ?? '—'} %</td><td class="d num"><b>${i.avance_reportado} %</b></td><td>${esc(i.comentario || '')}</td></tr>`).join('')}</tbody></table>` : ''}
      ${x.evidencias.length ? `<div>Evidencias: ${x.evidencias.map((d) => `<a href="/api/documentos/${d.documento_id}/archivo" target="_blank" rel="noopener">${esc(d.nombre)}</a>`).join(' · ')}</div>` : ''}
    </div>`).join('');
    cont.querySelectorAll('[data-rectificar]').forEach((b) => {
      b.onclick = async () => {
        const x = partes.find((y) => y.parte_id === Number(b.dataset.rectificar));
        rectifica = x.parte_id;
        el.querySelector('#tit-parte').textContent = `Rectificar el parte N.° ${x.parte_id} (${ff(x.fecha)})`;
        el.querySelector('#b-cancelar-rect').hidden = false;
        form.elements.consultor_id.value = x.consultor_id; form.elements.fecha.value = x.fecha; form.elements.descripcion.value = x.descripcion;
        form.elements.incidencias.value = x.incidencias || ''; form.elements.riesgos.value = x.riesgos || '';
        form.querySelector('#c-just').hidden = x.fecha >= hoy();
        await pintarAvance();
        el.querySelector('#t-parte').scrollIntoView({ behavior: 'smooth' });
      };
    });
  };
  el.querySelector('#filtro-prof').onchange = pintarHistorial;
  await pintarHistorial();
}
