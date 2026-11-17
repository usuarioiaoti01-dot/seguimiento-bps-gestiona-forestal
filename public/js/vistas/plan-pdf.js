import { api, esc, ff, badge, puede, modal, aviso, fallo } from '../util.js';

const MAX_MB = 15;

/** Texto del estado de la revisión del plan, para el visor y la lista de planes. */
export function textoRevision(p) {
  if (!p) return 'Sin plan de trabajo';
  if (p.estado === 'APROBADO') return p.fecha_aprobacion ? `Aprobado el ${ff(p.fecha_aprobacion)}` : 'Aprobado';
  if (p.estado === 'OBSERVADO') return p.fecha_subsanacion ? `Subsanar hasta el ${ff(p.fecha_subsanacion)}` : 'Observado';
  return p.estado === 'RECIBIDO' ? 'Pendiente de aprobación' : 'Por registrar';
}

const cerrarVelo = () => { const c = document.querySelector('.velo .cerrar'); if (c) c.click(); };

/** Pregunta si se aprueba el plan; si no, pide la observación y el plazo para subsanar. */
async function decidir(c) {
  const p = c.plan;
  const nombre = c.nombres.toUpperCase();
  const r = await modal({
    titulo: `Plan de trabajo · ${nombre}`, ancho: 520, cerrarTexto: true,
    contenido: '<p style="margin:12px 0;text-align:center;font-size:18px;font-weight:700">¿Aprueba el plan de trabajo?</p>',
    botones: [{ texto: 'Decidir después', valor: null }, { texto: 'No aprobar', valor: 'no' }, { texto: 'Aprobar', clase: 'prim', valor: 'si' }],
  });
  try {
    if (r.valor === 'si') {
      await api('POST', `/planes/${p.plan_id}/revision`, { decision: 'APROBAR' });
      aviso('Plan de trabajo aprobado', 'exito'); window.sgfRefrescar();
    } else if (r.valor === 'no') {
      const hoy = new Date().toISOString().slice(0, 10);
      const o = await modal({
        titulo: `Observación al plan · ${nombre}`, ancho: 560, cerrarTexto: true,
        contenido: `<div class="form">
          <div class="campo ancho"><label>Observación al plan de trabajo</label><textarea name="observacion" maxlength="1000" placeholder="Ej.: Falta detallar los entregables de agosto"></textarea></div>
          <div class="campo"><label>Plazo para subsanar (fecha límite)</label><input type="date" name="plazo" min="${hoy}"></div></div>`,
        botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Registrar observación', clase: 'prim', valor: 'ok' }],
      });
      if (o.valor !== 'ok') { window.sgfRefrescar(); return; }
      if (!(o.datos.observacion || '').trim() || !o.datos.plazo) { aviso('Indique la observación y el plazo para subsanar', 'error'); return decidir(c); }
      await api('POST', `/planes/${p.plan_id}/revision`, { decision: 'OBSERVAR', observacion: o.datos.observacion, plazo: o.datos.plazo });
      aviso('Plan observado · el plazo para subsanar quedó en las alertas del profesional', 'exito'); window.sgfRefrescar();
    } else { window.sgfRefrescar(); }
  } catch (err) { fallo(err); window.sgfRefrescar(); }
}

/** Sube el PDF del plan y pregunta si se aprueba. */
function cargarPdf(c) {
  const f = document.createElement('input'); f.type = 'file'; f.accept = 'application/pdf,.pdf';
  f.onchange = async () => {
    const arch = f.files[0]; if (!arch) return;
    if (arch.type !== 'application/pdf' && !/\.pdf$/i.test(arch.name)) { aviso('Seleccione un archivo PDF', 'error'); return; }
    if (arch.size > MAX_MB * 1024 * 1024) { aviso(`El PDF supera el máximo de ${MAX_MB} MB`, 'error'); return; }
    try {
      const r = await fetch(`/api/planes/${c.plan.plan_id}/pdf`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-SGF': '1', 'X-Motivo': encodeURIComponent(`Plan de trabajo cargado desde Seguimiento Actividades (${arch.name})`) }, body: arch, credentials: 'same-origin' });
      const dat = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(dat.error || `Error ${r.status}`);
      cerrarVelo();
      c.plan.tiene_pdf = true;
      await decidir(c);
    } catch (err) { fallo(err); }
  };
  f.click();
}

/**
 * Visor del PDF del plan de trabajo de un profesional (c = fila de /api/estado). Sin PDF: avisa y permite cargarlo,
 * y tras cargarlo pregunta si se aprueba. Con PDF: lo muestra y, si el plan no está aprobado, permite decidir.
 */
export function abrirPlanDeTrabajo(c) {
  const p = c.plan;
  const editor = puede('EDITOR');
  const nombre = `Plan de trabajo · ${c.nombres.toUpperCase()}`;
  if (p && p.tiene_pdf) {
    const url = `/api/planes/${p.plan_id}/pdf`;
    modal({
      titulo: nombre, ancho: 1100, botones: [], cerrarTexto: true,
      contenido: `<div class="mut2" style="margin-bottom:8px">${badge(p.estado)} ${esc(textoRevision(p))}${p.estado === 'OBSERVADO' && p.observacion_revision ? ` · ${esc(p.observacion_revision)}` : ''}</div>
        <iframe src="${url}#navpanes=0&zoom=100" title="${esc(nombre)}" style="width:100%;height:68vh;border:1px solid var(--borde);border-radius:8px;background:var(--superficie-2)"></iframe>
        <div class="acciones" style="justify-content:space-between"><span class="mut2">Si el visor no se muestra, <a href="${url}" target="_blank" rel="noopener">abra el PDF en una pestaña nueva</a>.</span>
        ${editor ? `<span class="acciones"><button type="button" class="btn peq" id="b-reemplazar">Reemplazar PDF</button>${p.estado === 'APROBADO' ? '' : '<button type="button" class="btn peq prim" id="b-decidir">Aprobar u observar el plan</button>'}</span>` : ''}</div>`,
    });
  } else {
    modal({
      titulo: nombre, ancho: 560, botones: [], cerrarTexto: true,
      contenido: `<p style="margin:12px 0;text-align:center;font-size:18px;font-weight:700;color:var(--rojo)">SIN PLAN DE TRABAJO REGISTRADO EN EL SISTEMA</p>
        ${p ? `<p class="mut" style="text-align:center;margin:0 0 12px">${editor ? 'Cargue el archivo PDF del plan de trabajo para registrarlo.' : 'Solicite a un responsable que cargue el PDF del plan de trabajo.'}</p>
        ${editor ? '<div style="text-align:center"><button type="button" class="btn prim" id="b-cargar-plan">Cargar PDF - Plan de Trabajo</button></div>' : ''}` : '<p class="mut" style="text-align:center;margin:0 0 12px">El profesional aún no tiene un plan de trabajo creado.</p>'}`,
    });
  }
  const velo = document.querySelector('.velo');
  const on = (sel, fn) => { const b = velo.querySelector(sel); if (b) b.onclick = fn; };
  on('#b-cargar-plan', () => cargarPdf(c));
  on('#b-reemplazar', () => cargarPdf(c));
  on('#b-decidir', () => { cerrarVelo(); decidir(c); });
}

/** Lista de los planes de todos los profesionales (tarjeta «Plan aprobado»); cada fila abre el visor del plan. */
export function abrirListaPlanes(consultores) {
  modal({
    titulo: 'Planes de trabajo', ancho: 760, botones: [], cerrarTexto: true,
    contenido: `<div class="tabla-env"><table><thead><tr><th>Profesional</th><th>Plan de trabajo</th><th>Revisión</th></tr></thead><tbody>${consultores.map((c) => `<tr class="clic" data-id="${c.consultor_id}"><td><b>${esc(c.nombres)}</b> <span class="mut2">${esc(c.clave)}</span></td><td>${c.plan && c.plan.tiene_pdf ? 'PDF cargado' : '<span class="mut2">Sin PDF</span>'}</td><td>${c.plan ? `${badge(c.plan.estado)} <span class="mut2">${esc(textoRevision(c.plan))}</span>` : '<span class="mut2">Sin plan</span>'}</td></tr>`).join('')}</tbody></table></div>
      <p class="mut2" style="margin:8px 0 0">Pulse un profesional para ver su plan de trabajo o cargarlo.</p>`,
  });
  const velo = document.querySelector('.velo');
  velo.querySelector('tbody').onclick = (ev) => {
    const tr = ev.target.closest('tr.clic'); if (!tr) return;
    const c = consultores.find((x) => x.consultor_id === Number(tr.dataset.id));
    cerrarVelo(); abrirPlanDeTrabajo(c);
  };
}

/** Visor del PDF del plan de trabajo (solo lectura): el generado por Formular Plan de Trabajo. */
export function verPlanPdf({ plan_id, titulo, aprobado = false }) {
  const url = `/api/planes/${plan_id}/pdf`;
  modal({
    titulo, ancho: 1100, botones: [], cerrarTexto: true,
    contenido: `<div class="mut2" style="margin-bottom:8px">${aprobado ? 'Plan Aprobado' : 'Plan de trabajo remitido al Administrador para su aprobación'}</div>
      <iframe src="${url}#navpanes=0&zoom=100" title="${esc(titulo)}" style="width:100%;height:68vh;border:1px solid var(--borde);border-radius:8px;background:var(--superficie-2)"></iframe>
      <div class="acciones"><span class="mut2">Si el visor no se muestra, <a href="${url}" target="_blank" rel="noopener">abra el PDF en una pestaña nueva</a>.</span></div>`,
  });
}
