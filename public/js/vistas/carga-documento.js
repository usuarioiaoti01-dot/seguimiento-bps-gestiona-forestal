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

const ESTADOS_ADENDA = [['ANUNCIADA', 'Anunciada (sin documento)'], ['EN_TRAMITE', 'En trámite'], ['FIRMADA', 'Firmada'], ['CONCLUIDA', 'Concluida'], ['ANULADA', 'Anulada']];
/** Valores con los que se muestran los ajustes de una adenda: lo que propone el documento o, si no, lo vigente. */
const baseAdenda = (c) => ({
  estado: c.campos.estado || (c.vigente && c.vigente.estado) || 'EN_TRAMITE',
  documento_ref: c.campos.documento_ref ?? (c.vigente && c.vigente.documento_ref) ?? '',
  fecha_suscripcion: c.campos.fecha_suscripcion ?? (c.vigente && c.vigente.fecha_suscripcion) ?? '',
});
const ajusteAdenda = (c) => {
  const b = baseAdenda(c);
  return `<div class="form" style="margin-top:8px">
    <div class="campo"><label>Estado al guardar</label><select name="estado_${esc(c.id)}">${opciones(ESTADOS_ADENDA, b.estado)}</select></div>
    <div class="campo"><label>Fecha de suscripción</label><input type="date" name="susc_${esc(c.id)}" value="${esc(String(b.fecha_suscripcion || '').slice(0, 10))}"></div>
    <div class="campo ancho"><label>Documento (obligatorio si queda firmada)</label><input name="doc_${esc(c.id)}" value="${esc(b.documento_ref || '')}"></div></div>
    <div class="mut2">Solo las adendas FIRMADAS amplían la vigencia; en trámite o anunciadas no la cambian.</div>`;
};

const filaCambio = (c, esAdenda = false) => `<tr>
  <td><input type="checkbox" name="c_${esc(c.id)}" ${c.accion === 'MODIFICAR' || esAdenda ? 'checked' : ''} aria-label="Aplicar ${esc(c.etiqueta)}"></td>
  <td><b>${esc(c.etiqueta)}</b><br><span class="mut2">${esc(ENTIDAD[c.entidad] || c.entidad)} · ${c.accion === 'CREAR' ? 'se crea' : 'se actualiza'}${c.fila ? ` · fila ${esc(c.fila)}` : ''}</span>
    ${c.descripcion ? `<br><span class="mut2">${esc(String(c.descripcion).slice(0, 90))}</span>` : ''}</td>
  <td>${c.diffs.map((d) => `<div><span class="mut2">${esc(ROTULOS[d.campo] || d.campo)}:</span> ${c.accion === 'CREAR' ? '' : `${valor(d.campo, d.antes)} → `}<b>${valor(d.campo, d.despues)}</b></div>`).join('')}
    ${c.advertencias.map((a) => `<div style="color:var(--ambar)">▲ ${esc(a)}</div>`).join('')}
    ${esAdenda && c.entidad === 'adenda' ? ajusteAdenda(c) : ''}</td></tr>`;

async function revisar(archivo, consultorId, tipo) {
  const r = await fetch('/api/documentos/previsualizar', {
    method: 'POST', credentials: 'same-origin', body: archivo,
    headers: { 'Content-Type': 'application/octet-stream', 'X-SGF': '1', 'X-Nombre': encodeURIComponent(archivo.name), ...(consultorId ? { 'X-Profesional': String(consultorId) } : {}), ...(tipo ? { 'X-Tipo': tipo } : {}) },
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || `Error ${r.status}`);
  return datos;
}

/**
 * Cargar documento: elegir archivo → vista previa de los cambios → confirmar → resultado.
 * Con `{ tipo: 'adenda' }` es el flujo del documento de una adenda (Contratos y adendas): solo adendas, con ajuste
 * del estado, el documento y la suscripción antes de guardar.
 */
export async function abrirCargaDocumento(consultores, opts = {}) {
  const esAdenda = opts.tipo === 'adenda';
  const paso1 = await modal({
    titulo: esAdenda ? 'Subir documento de adenda' : 'Cargar documento', ancho: 760,
    contenido: esAdenda
      ? `<p class="mut" style="margin:0">Suba el documento de una adenda (PDF con texto o Word). El asistente de IA lee el contrato, el N.° de adenda, los plazos y las fechas, y se los muestra para revisarlos: <b>no se guarda nada hasta que usted confirme</b>. También acepta Excel o CSV con la hoja «Adendas» de la plantilla.</p>
      <div class="form">
        <div class="campo ancho"><label>Documento (máx. 15 MB)</label><input type="file" name="archivo" accept=".pdf,.docx,.xlsx,.csv"></div>
        <div class="campo ancho"><label>Profesional (opcional: si el documento no indica el contrato)</label>
          <select name="consultor_id"><option value="">— Según el contrato del documento —</option>${opciones(consultores.map((c) => [c.consultor_id, `${c.nombres} (${c.clave})`]))}</select></div>
      </div>
      <div class="mut2" style="line-height:1.5">Una adenda nueva se guarda <b>en trámite</b>, salvo que usted elija «Firmada» en la vista previa (entonces el documento es obligatorio). Si el documento trae el plazo pero no las fechas, el inicio se calcula desde el fin de la última adenda firmada. Antes de enviarlo al asistente se quitan DNI, teléfonos y correos, y el original se conserva.
        <a href="/api/documentos/plantilla.xlsx">Descargar plantilla (Excel)</a></div>`
      : `<p class="mut" style="margin:0">Suba un documento del proyecto para actualizar actividades, avance, plazos de adendas o el estado de los planes. Antes de cambiar nada verá una <b>vista previa</b> y podrá elegir qué aplicar.</p>
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
  if (!archivo) { aviso('Seleccione un documento', 'error'); return abrirCargaDocumento(consultores, opts); }
  if (archivo.size > MAX_BYTES) { aviso('El documento supera el máximo de 15 MB', 'error'); return abrirCargaDocumento(consultores, opts); }

  let prev;
  try { aviso('Leyendo el documento…'); prev = await revisar(archivo, Number(paso1.datos.consultor_id) || null, opts.tipo); } catch (err) { fallo(err); return abrirCargaDocumento(consultores, opts); }

  const { resumen: s } = prev;
  const sinNada = !prev.cambios.length;
  const paso2 = await modal({
    titulo: `Vista previa · ${prev.archivo}`, ancho: 1000,
    contenido: `<div class="mut">${prev.origen === 'IA' ? '<b>Leído con el asistente de IA</b>' : 'Leído'} · ${s.modificar} por actualizar · ${s.crear} por crear · ${s.sin_cambios} sin cambios · ${s.rechazadas} rechazadas${prev.profesional ? ` · profesional: ${esc(prev.profesional.nombres)}` : ''}</div>
      ${prev.ia ? `<div class="mut2">Se omitieron ${prev.ia.omitidos} dato(s) personales antes de enviarlo al asistente.${prev.ia.truncado ? ' El documento es muy largo: solo se leyó la primera parte.' : ''} Revise cada valor: el asistente puede equivocarse.</div>` : ''}
      ${sinNada ? '<div class="vacio">El documento no propone ningún cambio aplicable.</div>' : `<div class="tabla-env" style="max-height:48vh;overflow:auto"><table>
        <thead><tr><th style="width:36px"></th><th>Registro</th><th>Cambio</th></tr></thead><tbody>${prev.cambios.map((c) => filaCambio(c, esAdenda)).join('')}</tbody></table></div>
        <div class="mut2">${esAdenda ? (prev.origen === 'IA' ? 'Revise cada valor: el asistente puede equivocarse.' : 'Revise los valores antes de guardar.') : 'Las actividades nuevas vienen sin marcar.'} Cada cambio quedará en la bitácora con el nombre del documento como motivo, y el original se conserva.</div>`}
      ${prev.rechazadas.length ? `<details><summary class="mut">Filas rechazadas (${prev.rechazadas.length})</summary><ul class="mut2" style="margin:6px 0 0;padding-left:18px">${prev.rechazadas.map((x) => `<li>${x.hoja ? `${esc(x.hoja)}${x.fila ? ` · fila ${esc(x.fila)}` : ''}: ` : ''}${esc(x.motivo)}</li>`).join('')}</ul></details>` : ''}`,
    botones: [{ texto: sinNada ? 'Cerrar' : 'Cancelar', valor: null }, ...(sinNada ? [] : [{ texto: esAdenda ? 'Guardar la adenda' : 'Aplicar los cambios marcados', clase: 'prim', valor: 'ok' }])],
  });
  if (paso2.valor !== 'ok') return;
  const ids = prev.cambios.filter((c) => paso2.datos[`c_${c.id}`]).map((c) => c.id);
  if (!ids.length) { aviso('No marcó ningún cambio', 'error'); return; }
  // ajustes de adendas: solo lo que el usuario cambió respecto de lo que mostraba la vista previa
  const ajustes = {};
  if (esAdenda) {
    for (const c of prev.cambios.filter((x) => ids.includes(x.id) && x.entidad === 'adenda')) {
      const b = baseAdenda(c);
      const nuevo = { estado: paso2.datos[`estado_${c.id}`], documento_ref: paso2.datos[`doc_${c.id}`], fecha_suscripcion: paso2.datos[`susc_${c.id}`] };
      const dif = {};
      for (const k of Object.keys(nuevo)) if ((nuevo[k] || '') !== (String(b[k] || '').slice(0, k === 'fecha_suscripcion' ? 10 : 400))) dif[k] = nuevo[k] || '';
      if (Object.keys(dif).length) ajustes[c.id] = dif;
    }
  }
  try {
    const r = await api('POST', '/documentos/aplicar', { carga_id: prev.carga_id, ids, ajustes });
    await modal({
      titulo: 'Resultado de la carga', ancho: 720,
      contenido: `<div>${badge('CONCLUIDA', `${r.aplicados.length} aplicado(s)`)} ${r.fallidos.length ? badge('ROJO', `${r.fallidos.length} con error`) : ''} ${r.omitidos ? `<span class="mut2">${r.omitidos} sin marcar</span>` : ''}</div>
        ${r.fallidos.length ? `<ul style="margin:0;padding-left:18px">${r.fallidos.map((f) => `<li><b>${esc(f.etiqueta)}</b>: ${esc(f.motivo)}</li>`).join('')}</ul>` : '<p style="margin:0">Todos los cambios marcados se aplicaron y el pronóstico se recalculó.</p>'}`,
      botones: [{ texto: 'Cerrar', clase: 'prim', valor: 'ok' }],
    });
    window.sgfRefrescar();
  } catch (err) { fallo(err); }
}
