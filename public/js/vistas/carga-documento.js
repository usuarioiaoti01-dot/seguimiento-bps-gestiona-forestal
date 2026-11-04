import { api, esc, ff, modal, opciones, aviso, fallo, badge, ETIQ } from '../util.js';

const MAX_BYTES = 15 * 1024 * 1024;

const ROTULOS = {
  avance: 'Avance', estado: 'Estado', inicio_plan: 'Inicio del plan', fin_plan: 'Fin del plan', inicio_real: 'Inicio real', fin_real: 'Fin real',
  descripcion: 'Descripción', evidencia: 'Evidencia', observacion: 'Observación', clasificacion: 'Clasificación', numero: 'N.°',
  fecha_inicio: 'Inicio', fecha_fin: 'Fin', plazo_dias: 'Plazo otorgado (días)', plazo_solicitado_dias: 'Plazo solicitado (días)',
  fecha_suscripcion: 'Suscripción', documento_ref: 'Documento', expediente: 'Expediente', fecha_recepcion: 'Recepción',
};
const ENTIDAD = { actividad: 'Actividad', adenda: 'Adenda', plan_trabajo: 'Plan' };

function valor(campo, v) {
  if (v === null || v === undefined || v === '') return '<span class="mut2">—</span>';
  if (/^(inicio_|fin_|fecha_)/.test(campo) && /^\d{4}-\d{2}-\d{2}/.test(String(v))) return esc(ff(String(v).slice(0, 10)));
  if (campo === 'avance') return `${esc(v)} %`;
  if (campo === 'estado' && ETIQ[v]) return esc(ETIQ[v][0]);
  return esc(v);
}

const filaCambio = (c) => `<tr>
  <td><input type="checkbox" name="c_${esc(c.id)}" ${c.accion === 'MODIFICAR' ? 'checked' : ''} aria-label="Aplicar ${esc(c.etiqueta)}"></td>
  <td><b>${esc(c.etiqueta)}</b><br><span class="mut2">${esc(ENTIDAD[c.entidad] || c.entidad)} · ${c.accion === 'CREAR' ? 'se crea' : 'se actualiza'}${c.fila ? ` · fila ${esc(c.fila)}` : ''}</span>
    ${c.descripcion ? `<br><span class="mut2">${esc(String(c.descripcion).slice(0, 90))}</span>` : ''}</td>
  <td>${c.diffs.map((d) => `<div><span class="mut2">${esc(ROTULOS[d.campo] || d.campo)}:</span> ${c.accion === 'CREAR' ? '' : `${valor(d.campo, d.antes)} → `}<b>${valor(d.campo, d.despues)}</b></div>`).join('')}
    ${c.advertencias.map((a) => `<div style="color:var(--ambar)">▲ ${esc(a)}</div>`).join('')}</td></tr>`;

async function revisar(archivo, consultorId) {
  const r = await fetch('/api/documentos/previsualizar', {
    method: 'POST', credentials: 'same-origin', body: archivo,
    headers: { 'Content-Type': 'application/octet-stream', 'X-SGF': '1', 'X-Nombre': encodeURIComponent(archivo.name), ...(consultorId ? { 'X-Profesional': String(consultorId) } : {}) },
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || `Error ${r.status}`);
  return datos;
}

/** Cargar documento: elegir archivo → vista previa de los cambios → confirmar → resultado. */
export async function abrirCargaDocumento(consultores) {
  const paso1 = await modal({
    titulo: 'Cargar documento', ancho: 760,
    contenido: `<p class="mut" style="margin:0">Suba un documento del proyecto para actualizar actividades, avance, plazos de adendas o el estado de los planes. Antes de cambiar nada verá una <b>vista previa</b> y podrá elegir qué aplicar.</p>
      <div class="form">
        <div class="campo ancho"><label>Documento (máx. 15 MB)</label><input type="file" name="archivo" accept=".xlsx,.csv,.xml,.pdf,.docx"></div>
        <div class="campo ancho"><label>Profesional (para cronogramas y documentos que no lo indiquen)</label>
          <select name="consultor_id"><option value="">— Según lo que diga el documento —</option>${opciones(consultores.map((c) => [c.consultor_id, `${c.nombres} (${c.clave})`]))}</select></div>
      </div>
      <div class="mut2" style="line-height:1.5">
        <b>Excel o CSV</b> con la plantilla: <a href="/api/documentos/plantilla.xlsx">descargar plantilla (Excel)</a> · <b>Cronograma</b> de un profesional en Excel (N.°, Nombre de tarea, Inicio, Fin, % completado) o el XML exportado de MS Project ·
        <b>PDF con texto o Word (.docx)</b>: los lee el asistente de IA, que propone los datos; antes se le quitan DNI, teléfonos y correos, y nunca escribe: usted confirma.</div>`,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Revisar documento', clase: 'prim', valor: 'ok' }],
  });
  if (paso1.valor !== 'ok') return;
  const archivo = paso1.form.querySelector('input[type=file]').files[0];
  if (!archivo) { aviso('Seleccione un documento', 'error'); return abrirCargaDocumento(consultores); }
  if (archivo.size > MAX_BYTES) { aviso('El documento supera el máximo de 15 MB', 'error'); return abrirCargaDocumento(consultores); }

  let prev;
  try { aviso('Leyendo el documento…'); prev = await revisar(archivo, Number(paso1.datos.consultor_id) || null); } catch (err) { fallo(err); return abrirCargaDocumento(consultores); }

  const { resumen: s } = prev;
  const sinNada = !prev.cambios.length;
  const paso2 = await modal({
    titulo: `Vista previa · ${prev.archivo}`, ancho: 1000,
    contenido: `<div class="mut">${prev.origen === 'IA' ? '<b>Leído con el asistente de IA</b>' : 'Leído'} · ${s.modificar} por actualizar · ${s.crear} por crear · ${s.sin_cambios} sin cambios · ${s.rechazadas} rechazadas${prev.profesional ? ` · profesional: ${esc(prev.profesional.nombres)}` : ''}</div>
      ${prev.ia ? `<div class="mut2">Se omitieron ${prev.ia.omitidos} dato(s) personales antes de enviarlo al asistente.${prev.ia.truncado ? ' El documento es muy largo: solo se leyó la primera parte.' : ''} Revise cada valor: el asistente puede equivocarse.</div>` : ''}
      ${sinNada ? '<div class="vacio">El documento no propone ningún cambio aplicable.</div>' : `<div class="tabla-env" style="max-height:48vh;overflow:auto"><table>
        <thead><tr><th style="width:36px"></th><th>Registro</th><th>Cambio</th></tr></thead><tbody>${prev.cambios.map(filaCambio).join('')}</tbody></table></div>
        <div class="mut2">Las actividades nuevas vienen sin marcar. Cada cambio quedará en la bitácora con el nombre del documento como motivo, y el original se conserva.</div>`}
      ${prev.rechazadas.length ? `<details><summary class="mut">Filas rechazadas (${prev.rechazadas.length})</summary><ul class="mut2" style="margin:6px 0 0;padding-left:18px">${prev.rechazadas.map((x) => `<li>${x.hoja ? `${esc(x.hoja)}${x.fila ? ` · fila ${esc(x.fila)}` : ''}: ` : ''}${esc(x.motivo)}</li>`).join('')}</ul></details>` : ''}`,
    botones: [{ texto: sinNada ? 'Cerrar' : 'Cancelar', valor: null }, ...(sinNada ? [] : [{ texto: 'Aplicar los cambios marcados', clase: 'prim', valor: 'ok' }])],
  });
  if (paso2.valor !== 'ok') return;
  const ids = prev.cambios.filter((c) => paso2.datos[`c_${c.id}`]).map((c) => c.id);
  if (!ids.length) { aviso('No marcó ningún cambio', 'error'); return; }
  try {
    const r = await api('POST', '/documentos/aplicar', { carga_id: prev.carga_id, ids });
    await modal({
      titulo: 'Resultado de la carga', ancho: 720,
      contenido: `<div>${badge('CONCLUIDA', `${r.aplicados.length} aplicado(s)`)} ${r.fallidos.length ? badge('ROJO', `${r.fallidos.length} con error`) : ''} ${r.omitidos ? `<span class="mut2">${r.omitidos} sin marcar</span>` : ''}</div>
        ${r.fallidos.length ? `<ul style="margin:0;padding-left:18px">${r.fallidos.map((f) => `<li><b>${esc(f.etiqueta)}</b>: ${esc(f.motivo)}</li>`).join('')}</ul>` : '<p style="margin:0">Todos los cambios marcados se aplicaron y el pronóstico se recalculó.</p>'}`,
      botones: [{ texto: 'Cerrar', clase: 'prim', valor: 'ok' }],
    });
    window.sgfRefrescar();
  } catch (err) { fallo(err); }
}
