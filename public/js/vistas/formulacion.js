import { verPlanPdf } from './plan-pdf.js';
import { api, estado, esc, ff, titulo, badge, puede, aviso, fallo, modal, esProfesional } from '../util.js';

const ETAPAS = ['Formulación', 'Revisión del Jefe de Proyecto', 'Revisión del Administrador', 'Plan aprobado'];
const ETAPA_DE = { POR_REGISTRAR: 0, EN_FORMULACION: 0, EN_REVISION_JEFE: 1, OBSERVADO: 1, EN_REVISION_ADMIN: 2, APROBADO: 3 };
const subDe = (a) => a.subactividades || []; // [{ texto, dias, producto, inicio_plan, fin_plan }]
const PENDIENTE_DE = { POR_REGISTRAR: 'Profesional', EN_FORMULACION: 'Profesional', EN_REVISION_JEFE: 'Jefe de Proyecto', OBSERVADO: 'Jefe de Proyecto', EN_REVISION_ADMIN: 'Administrador', APROBADO: '—' };

/** Formular Plan de Trabajo: el profesional entra a su plan; el Jefe de Proyecto y el Administrador ven la lista. */
export async function vistaFormular(el, [id]) {
  if (esProfesional()) return formulario(el, estado.usuario.consultor_id);
  if (id) return formulario(el, Number(id));
  const e = await api('GET', `/estado${estado.corte ? `?corte=${estado.corte}` : ''}`);
  titulo('FORMULAR PLAN DE TRABAJO', 'Plan de trabajo por profesional, con el periodo de su adenda vigente');
  el.innerHTML = `<div class="tarjeta"><div class="cab"><h2>Planes de trabajo</h2></div><div class="cuerpo sin tabla-env"><table>
    <thead><tr><th>Profesional</th><th>Adenda vigente</th><th>Estado del plan</th><th>Pendiente de</th><th>Aprobación</th><th></th></tr></thead>
    <tbody>${e.consultores.map((c) => {
    const est = c.plan ? c.plan.estado : 'POR_REGISTRAR';
    const v = c.vigencia.adenda_vigente;
    return `<tr class="clic" data-id="${c.consultor_id}"><td><b>${esc(c.nombres)}</b> <span class="mut2">${esc(c.clave)}</span><br><span class="mut2">${esc(c.perfil || '')}</span></td>
      <td class="num">${v ? `${ff(v.fecha_inicio)} – ${ff(c.vigencia.fin_vigencia)}<br><span class="mut2">Adenda ${String(v.numero).padStart(2, '0')}</span>` : '<span class="mut2">Sin adenda vigente</span>'}</td>
      <td>${badge(est)}</td><td>${PENDIENTE_DE[est] || '—'}</td><td class="num">${c.plan && c.plan.fecha_aprobacion ? `${ff(c.plan.fecha_aprobacion)}${c.plan.dias_aprobacion !== null && c.plan.dias_aprobacion !== undefined ? `<br><span class="mut2">${c.plan.dias_aprobacion} día(s) tras la adenda</span>` : ''}` : '<span class="mut2">—</span>'}</td><td><button type="button" class="btn peq">Abrir</button></td></tr>`;
  }).join('')}</tbody></table></div></div>
  <p class="mut2">Pulse un profesional para abrir su plan de trabajo. El plan se formula con la plantilla del cronograma de actividades; al enviarlo queda fijo y sigue las etapas de revisión.</p>`;
  el.querySelector('tbody').onclick = (ev) => { const tr = ev.target.closest('tr.clic'); if (tr) location.hash = `#/formular/${tr.dataset.id}`; };
}

async function formulario(el, consultorId) {
  const cargar = async () => api('GET', `/formulacion/${consultorId}`);
  let d = await cargar();
  titulo('CRONOGRAMA DE ACTIVIDADES', 'Formulación del plan de trabajo');

  const pintar = () => {
    const p = d.plan; const per = d.periodo; const perm = d.permisos; const ed = perm.puedeEditar;
    const etapa = ETAPA_DE[perm.estado] ?? 0;
    const dis = ed ? '' : 'disabled';
    const aviso1 = (() => {
      if (!per) return '<div class="alerta"><div class="t">Sin adenda vigente</div><div class="d">El plazo del plan lo fija la adenda vigente del profesional; registre la adenda para poder formular el plan.</div></div>';
      if (perm.estado === 'OBSERVADO' && p.observacion_revision) return `<div class="alerta"><span class="badge b-rojo">Observado</span><div class="t">Observación del Administrador</div><div class="d">${esc(p.observacion_revision)}</div><div class="a">→ ${perm.puedeAprobarJefe ? 'Corrija el plan y vuelva a aprobarlo para el Administrador.' : 'Pendiente de la corrección del Jefe de Proyecto.'}</div></div>`;
      if (perm.estado === 'APROBADO') return `<div class="alerta"><span class="badge b-verde">Aprobado</span><div class="t">Plan aprobado el ${ff(p.fecha_aprobacion)}</div><div class="d">El plan quedó fijo y el seguimiento de fechas y actividades está en marcha.</div><div class="a">→ <a href="#/consultor/${d.consultor.consultor_id}">Ver en Seguimiento Actividades</a></div></div>`;
      if (!ed) return `<div class="alerta"><div class="t">Plan fijo</div><div class="d">${perm.estado === 'EN_REVISION_JEFE' ? 'Enviado para revisión del Jefe de Proyecto; ya no admite cambios del profesional.' : 'En revisión del Administrador.'}</div></div>`;
      if (perm.estado === 'EN_REVISION_JEFE') return '<div class="alerta"><div class="t">Revisión del Jefe de Proyecto</div><div class="d">Puede modificar las actividades; al terminar, apruebe el plan para pasarlo a revisión del Administrador.</div></div>';
      return '';
    })();
    el.innerHTML = `
    <div class="tarjeta"><div class="cuerpo">
      <div class="etapas">${ETAPAS.map((t, i) => `<span class="etapa ${i < etapa ? 'hecha' : i === etapa ? 'actual' : ''}"><i>${i + 1}</i>${esc(t)}</span>`).join('')}</div>
      <div style="margin-top:10px">${badge(perm.estado)}${p && p.fecha_envio ? ` <span class="mut2">Enviado el ${ff(p.fecha_envio)}</span>` : ''}</div>
      ${aviso1}</div></div>

    <div class="tarjeta"><div class="cab"><h2>DATOS GENERALES</h2></div>
      <div class="cuerpo sin"><table class="tabla-datos"><tbody>
        <tr><th>Proyecto</th><td>${esc(d.proyecto)}</td></tr>
        <tr><th>Gestión del Proyecto</th><td>${esc(d.area_tecnica)}</td></tr>
        <tr><th>Jefe de Proyecto</th><td>${p && p.aprobado_jefe_por ? esc(p.aprobado_jefe_por) : '<span class="mut2">Se registra al aprobar el plan</span>'}</td></tr>
        <tr><th>Consultor / Programador</th><td>${esc(d.consultor.nombres)}${d.consultor.perfil ? ` — ${esc(d.consultor.perfil)}` : ''}</td></tr>
        <tr><th>Contrato / Adenda</th><td>${per ? `Adenda N.° ${String(per.numero).padStart(2, '0')} al Contrato N.° ${esc(d.contrato ? d.contrato.numero : '—')}` : esc(d.contrato ? d.contrato.numero : '—')}</td></tr>
        <tr><th>Periodo de ejecución</th><td>${per ? `<b>Del ${ff(per.inicio)} al ${ff(per.fin)}</b> · ${per.dias_habiles} días hábiles (${per.dias_calendario} días calendario)` : '—'}</td></tr>
        ${d.aprobacion ? `<tr><th>Aprobación del plan</th><td><b>Aprobado el ${ff(d.aprobacion.fecha)}</b>${d.aprobacion.dias !== null ? ` · ${d.aprobacion.dias} día(s) después de la suscripción de la adenda (${ff(d.aprobacion.suscripcion)})` : ''}</td></tr>` : ''}
      </tbody></table></div></div>

    <div class="tarjeta"><div class="cab"><h2>ACTIVIDADES</h2><span class="acciones">${p && p.tiene_pdf && !esProfesional() && ['EN_REVISION_ADMIN', 'APROBADO'].includes(perm.estado) ? '<button type="button" class="btn peq" id="b-ver-pdf">Ver PDF del plan</button>' : ''}${p && p.documento_origen ? '<button type="button" class="btn peq" id="b-origen" title="Documento con el que se registró el plan">Documento de origen</button>' : ''}${ed && per ? '<button type="button" class="btn peq" id="b-importar" title="Registrar un plan ya elaborado en un documento: Excel, CSV, PDF o Word">Registrar plan desde documento</button><input type="file" id="f-plan" accept=".xlsx,.csv,.pdf,.docx" hidden><button type="button" class="btn peq" id="b-agregar">Agregar actividad</button>' : ''}${perm.puedeAprobarJefe ? '<button type="button" class="btn peq prim" id="b-aprobar-jefe">Aprobar plan propuesto</button>' : ''}</span></div>
      ${perm.estado !== 'APROBADO' ? '<div class="cuerpo" style="padding-bottom:0"><div class="alerta"><div class="t">Fechas referenciales</div><div class="d">Las fechas se calculan según los días hábiles de cada actividad, una tras otra, desde el inicio de la adenda vigente. Variarán cuando el Administrador apruebe el plan: los plazos se cuentan a partir de esa aprobación.</div></div></div>' : ''}
      ${ed && per && !d.actividades.length ? `<div class="cuerpo"><div class="opciones-plan">
        <div class="opcion-plan"><b>Cargar un documento con el plan</b><span>Si ya tiene el plan elaborado en Excel, CSV, PDF o Word, súbalo: se lee, se le muestra lo que se entendió y al confirmar se genera el plan en la aplicación.</span><button type="button" class="btn prim" id="o-importar">Cargar documento del plan</button></div>
        <div class="opcion-plan"><b>Registrar las actividades una a una</b><span>Complete cada actividad con sus subactividades, su producto o evidencia y sus días hábiles; las fechas las calcula la aplicación.</span><button type="button" class="btn" id="o-agregar">Agregar actividad</button></div></div></div>` : ''}
      <div class="cuerpo sin tabla-env"><table>
        <thead><tr><th></th><th>N.°</th><th style="min-width:300px">Actividad</th><th style="min-width:220px">Producto / evidencia verificable</th><th>Documentos</th><th>Inicio</th><th>Fin</th><th class="d">Días háb.</th><th></th></tr></thead>
        ${d.actividades.map((a) => `<tbody class="grupo${a.agregada_por ? ' de-jefe' : ''}" data-id="${a.actividad_id}"><tr class="act-cab"><td>${subDe(a).length ? '<button type="button" class="btn peq desplegar" data-desplegar aria-expanded="true" title="Mostrar u ocultar las subactividades">▾</button>' : ''}</td><td class="num"><b>${esc(a.numero)}</b></td>
          <td class="desc"><b style="white-space:pre-wrap">${esc(a.descripcion)}</b>${a.agregada_por ? `<div><span class="marca-jefe">Agregada por ${a.agregada_por === 'ADMIN' ? 'el Administrador' : 'el Jefe de Proyecto'}</span></div>` : ''}${(() => { const en = (d.entregables || []).find((x) => x.entregable_servicio_id === a.entregable_servicio_id); return en ? `<div><span class="badge b-azul" title="Entregable del TDR al que aporta">Entregable ${en.numero}: ${esc(en.nombre)}</span></div>` : ''; })()}</td>
          <td class="desc" style="white-space:pre-wrap">${subDe(a).length ? '' : esc(a.producto || '')}</td>
          <td>${(a.documentos || []).map((x) => `<a class="doc-pdf" href="/api/formulacion/actividades/${a.actividad_id}/documentos/${x.n}" target="_blank" rel="noopener" title="${esc(x.nombre)}">${esc(x.nombre)}</a>`).join('') || '<span class="mut2">—</span>'}</td>
          <td class="num"><b>${ff(a.inicio_plan)}</b></td><td class="num"><b>${ff(a.fin_plan)}</b></td><td class="d num"><b>${a.dias_habiles}</b></td>
          <td>${ed ? '<button type="button" class="btn peq" data-editar>Editar</button> <button type="button" class="btn peq" data-quitar>Quitar</button>' : ''}</td></tr>
          ${subDe(a).map((x, k) => `<tr class="act-sub"><td></td><td class="num mut2">${esc(a.numero)}.${k + 1}</td><td class="desc" style="white-space:pre-wrap">${esc(x.texto)}</td><td class="desc" style="white-space:pre-wrap">${esc(x.producto || '')}</td><td></td><td class="num">${ff(x.inicio_plan)}</td><td class="num">${ff(x.fin_plan)}</td><td class="d num">${x.dias}</td><td></td></tr>`).join('')}</tbody>`).join('') || `<tbody><tr><td colspan="9" class="vacio">${ed ? 'Aún no hay actividades: pulse «Agregar actividad» y registre una por una.' : 'Sin actividades'}</td></tr></tbody>`}</table></div>
      <div class="cuerpo mut2">Total de las actividades: <b>${d.resumen.total_dias}</b>${d.resumen.dias_periodo ? ` de ${d.resumen.dias_periodo}` : ''} días hábiles de la adenda vigente.</div></div>

    <div class="tarjeta"><div class="cab"><h2>COMENTARIOS</h2><span class="mut2" id="guardado" aria-live="polite">${ed ? 'Se graba al escribir' : ''}</span></div><div class="cuerpo">
      <textarea class="en-linea" style="width:100%;min-height:110px" name="supuestos" maxlength="2000" placeholder="Escriba los comentarios del plan de trabajo" ${dis}>${esc(p ? p.supuestos : '')}</textarea></div></div>

    <div class="tarjeta"><div class="cuerpo" style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
      ${esProfesional() ? '' : '<a class="btn" href="#/formular" style="margin-right:auto">← Volver a lo Anterior</a>'}
      ${perm.puedeEnviar ? '<button type="button" class="btn prim" id="b-enviar">Enviar para revisión y aprobación</button>' : ''}
      ${perm.puedeRevisarAdmin ? '<button type="button" class="btn peligro" id="b-observar">Observar con comentarios</button><button type="button" class="btn prim" id="b-aprobar">Aprobar el plan</button>' : ''}
      ${perm.estado === 'APROBADO' && puede('ADMIN') ? '<button type="button" class="btn prim" id="b-pdf">Volver a generar el PDF</button>' : ''}</div></div>`;
    conectar();
  };

  const recargar = async () => { d = await cargar(); pintar(); };
  const marca = (t, tipo = '') => { const g = el.querySelector('#guardado'); if (g) { g.textContent = t; g.style.color = tipo === 'error' ? 'var(--rojo)' : ''; } };

  /** Datos generales y supuestos: se graban solos poco después de escribir. */
  const autoguardar = (campo) => {
    let t = null;
    const guardar = async () => {
      marca('Guardando…');
      try { await api('PUT', `/formulacion/${consultorId}/cabecera`, { [campo.name]: campo.value }); marca('Guardado'); if (!d.plan) d = await cargar(); } catch (err) { marca(err.message, 'error'); }
    };
    campo.oninput = () => { clearTimeout(t); marca('Escribiendo…'); t = setTimeout(guardar, 700); };
    campo.onchange = () => { clearTimeout(t); guardar(); };
  };

  /** Sube los PDF elegidos a la actividad; informa los que no se pudieron guardar. */
  const subirDocumentos = async (actividadId, archivos) => {
    for (const f of archivos) {
      try {
        if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) throw new Error('no es un PDF');
        if (f.size > 15 * 1024 * 1024) throw new Error('supera los 15 MB');
        const r = await fetch(`/api/formulacion/actividades/${actividadId}/documentos`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-SGF': '1', 'X-Nombre': encodeURIComponent(f.name) }, body: f, credentials: 'same-origin' });
        const dat = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(dat.error || `Error ${r.status}`);
      } catch (err) { aviso(`No se guardó «${f.name}»: ${err.message}`, 'error'); }
    }
  };

  /** Registro de una actividad (nueva o existente) con sus subactividades y documentos PDF; se graba al aceptar. */
  const pedirActividad = async (a) => {
    const per = d.periodo;
    let v = a || { descripcion: '', producto: '', dias_plan: '', entregable_servicio_id: '' };
    let subs = a ? subDe(a) : [];
    const fila = (t = '', dias = '', prod = '') => `<div class="fila-sub"><div class="sub-cab"><div class="sub-txt"><label class="sub-et">Subactividad</label><input name="sub" maxlength="300" value="${esc(t)}" placeholder="Subactividad"></div><div><label class="sub-et" style="text-align:center">Días</label><input class="dias2" name="sub_dias" type="number" min="1" max="99" step="1" value="${esc(dias)}" aria-label="Días hábiles de la subactividad"></div><button type="button" class="btn peq" data-quitar-sub>Quitar</button></div><label class="sub-et">Evidencia</label><textarea name="sub_prod" maxlength="500" placeholder="Producto / evidencia verificable de la subactividad">${esc(prod)}</textarea></div>`;
    for (;;) {
      const cerrada = modal({
        titulo: a ? `Actividad ${a.numero}` : 'Agregar actividad', ancho: 760,
        contenido: `<div class="form">
          <div class="campo ancho"><label>Actividad</label><textarea name="descripcion" maxlength="1000">${esc(v.descripcion)}</textarea></div>
          <div class="campo"><label>Días Totales</label><input class="dias2" type="number" name="dias_plan" min="1" max="99" step="1" value="${esc(v.dias_plan ?? '')}"></div>
          ${(d.entregables || []).length ? `<div class="campo ancho"><label>Entregable del TDR al que aporta</label><select name="entregable_servicio_id"><option value="">— Ninguno —</option>${d.entregables.map((x) => `<option value="${x.entregable_servicio_id}" ${Number(v.entregable_servicio_id) === x.entregable_servicio_id ? 'selected' : ''}>Entregable ${x.numero}: ${esc(x.nombre)} (${x.plazo_dias} días)</option>`).join('')}</select></div>` : ''}
          <div class="campo"><label>Total del plan</label><div class="mut" style="padding-top:8px">${d.resumen.total_dias - (a ? Number(a.dias_habiles) || 0 : 0)} de ${per.dias_habiles} días hábiles ya asignados a otras actividades</div></div>
          <div class="campo ancho"><label>Subactividades <span class="mut2" id="sub-total"></span></label><div id="subs">${subs.map((s) => fila(s.texto, s.dias, s.producto)).join('')}</div><div><button type="button" class="btn peq" id="b-sub">Agregar subactividad</button></div></div>
          <div class="campo ancho" id="c-producto"><label>Producto / evidencia verificable</label><textarea name="producto" maxlength="1000" placeholder="Ej.: Informe de pruebas con casos y resultados; código fuente en GitLab">${esc(v.producto || '')}</textarea></div>
          <div class="campo ancho"><label>Documentos (PDF)</label>
            ${a ? (a.documentos || []).map((x) => `<div class="fila-doc"><a href="/api/formulacion/actividades/${a.actividad_id}/documentos/${x.n}" target="_blank" rel="noopener">${esc(x.nombre)}</a> <button type="button" class="btn peq" data-quitar-doc="${x.n}">Quitar</button></div>`).join('') : ''}
            <input type="file" name="archivos" accept="application/pdf,.pdf" multiple></div>
          <p class="mut2 ancho" style="margin:0">Cada subactividad lleva su producto / evidencia verificable. Las fechas se calculan solas con los días hábiles; la suma de los días de las subactividades no puede exceder los días de la actividad.</p></div>`,
        botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Guardar actividad', clase: 'prim', valor: 'ok' }],
      });
      const velo = document.querySelector('.velo');
      const totalSubs = () => {
        const suma = [...velo.querySelectorAll('[name=sub_dias]')].reduce((t, i) => t + (Number(i.value) || 0), 0);
        const max = Number(velo.querySelector('[name=dias_plan]').value) || 0;
        const e = velo.querySelector('#sub-total');
        e.textContent = suma ? `— suman ${suma} de ${max} días` : '';
        e.style.color = suma > max ? 'var(--rojo)' : '';
      };
      velo.querySelector('#b-sub').onclick = () => { velo.querySelector('#subs').insertAdjacentHTML('beforeend', fila()); velo.querySelector('#subs').lastElementChild.querySelector('input').focus(); alternar(); };
      const alternar = () => { velo.querySelector('#c-producto').style.display = velo.querySelector('.fila-sub') ? 'none' : ''; };
      velo.addEventListener('input', (ev) => { if (ev.target.classList.contains('dias2') && ev.target.value.length > 2) ev.target.value = ev.target.value.slice(0, 2); totalSubs(); });
      totalSubs(); alternar();
      velo.addEventListener('click', async (ev) => {
        const qs = ev.target.closest('[data-quitar-sub]'); if (qs) { qs.closest('.fila-sub').remove(); totalSubs(); alternar(); return; }
        const qd = ev.target.closest('[data-quitar-doc]');
        if (qd) {
          try { await api('POST', `/formulacion/actividades/${a.actividad_id}/documentos/${qd.dataset.quitarDoc}/quitar`, {}); qd.parentElement.remove(); a.documentos = a.documentos.filter((x) => String(x.n) !== qd.dataset.quitarDoc); } catch (err) { fallo(err); }
        }
      });
      const r = await cerrada;
      if (r.valor !== 'ok') { if (a) await recargar(); return; }
      subs = [...r.form.querySelectorAll('.fila-sub')].map((f) => ({ texto: f.querySelector('[name=sub]').value.trim(), dias: f.querySelector('[name=sub_dias]').value === '' ? null : Number(f.querySelector('[name=sub_dias]').value), producto: f.querySelector('[name=sub_prod]').value.trim() })).filter((x) => x.texto || x.dias || x.producto);
      const archivos = [...(r.form.querySelector('[name=archivos]').files || [])];
      v = { descripcion: r.datos.descripcion, producto: r.datos.producto, dias_plan: r.datos.dias_plan === '' ? null : Number(r.datos.dias_plan), ...('entregable_servicio_id' in r.datos ? { entregable_servicio_id: r.datos.entregable_servicio_id ? Number(r.datos.entregable_servicio_id) : null } : {}) };
      try {
        let id;
        if (a) { await api('PATCH', `/formulacion/actividades/${a.actividad_id}`, { ...v, subactividades: subs, revision: a.revision }); id = a.actividad_id; }
        else { const n = await api('POST', `/formulacion/${consultorId}/actividades`, { ...v, subactividades: subs }); id = n.actividad_id; }
        await subirDocumentos(id, archivos);
        aviso('Actividad guardada', 'exito'); await recargar(); return;
      } catch (err) { fallo(err); }
    }
  };

  /** Pregunta antes de pasar de etapa; con `comentario` pide el texto (obligatorio si `requerido`). */
  const decidir = async (accion, { titulo: t, texto, boton, comentario = false, requerido = false, clase = 'prim' }) => {
    const r = await modal({
      titulo: t, ancho: 560,
      contenido: `<p class="mut" style="margin:0">${esc(texto)}</p>${comentario ? `<div class="campo"><label>Comentarios${requerido ? '' : ' (opcional)'}</label><textarea name="comentario" maxlength="1000"></textarea></div>` : ''}`,
      botones: [{ texto: 'Cancelar', valor: null }, { texto: boton, clase, valor: 'ok' }],
    });
    if (r.valor !== 'ok') return;
    if (requerido && !(r.datos.comentario || '').trim()) { aviso('Escriba el comentario de la observación', 'error'); return decidir(accion, { titulo: t, texto, boton, comentario, requerido, clase }); }
    try {
      d = await api('POST', `/formulacion/${consultorId}/transicion`, { accion, comentario: r.datos.comentario });
      aviso({ ENVIAR: 'Plan enviado para revisión y aprobación', APROBAR_JEFE: 'Plan aprobado; el PDF fue generado y remitido al Administrador', OBSERVAR: 'Observación registrada; el plan vuelve al Jefe de Proyecto', APROBAR: 'Plan aprobado: inicia el seguimiento' }[accion], 'exito');
      pintar();
      if (accion === 'APROBAR') window.sgfRefrescar && window.sgfRefrescar();
    } catch (err) { fallo(err); await recargar(); }
  };

  /** Plan ya elaborado en un documento: se lee, se muestra lo que se entendió y, al confirmar, se crean las actividades. */
  async function importarPlan(archivo) {
    if (archivo.size > 50 * 1024 * 1024) { aviso('El documento supera el máximo de 50 MB', 'error'); return; }
    aviso('Leyendo el documento…');
    let vista;
    try {
      const r = await fetch(`/api/formulacion/${consultorId}/plan-documento/previsualizar`, { method: 'POST', credentials: 'same-origin', body: archivo, headers: { 'Content-Type': 'application/octet-stream', 'X-SGF': '1', 'X-Nombre': encodeURIComponent(archivo.name) } });
      vista = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(vista.error || `Error ${r.status}`);
    } catch (err) { fallo(err); return; }
    const r = vista.resumen;
    const filas = vista.plan.actividades.map((a, i) => `<div class="tarjeta" style="margin-bottom:8px"><div class="cuerpo" style="padding:10px 12px">
      <label style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" name="a_${i}" ${a.valida ? 'checked' : 'disabled'}>
        <span style="flex:1"><b>${i + 1}. ${esc(a.descripcion)}</b> <span class="mut2">· ${a.dias ?? '—'} días hábiles</span>
        ${a.producto ? `<br><span class="mut2">Producto: ${esc(a.producto)}</span>` : ''}
        ${a.subactividades.map((s, k) => `<br><span class="mut2">${i + 1}.${k + 1} ${esc(s.texto)} · ${s.dias ?? '—'} d${s.producto ? ` · ${esc(s.producto)}` : ''}</span>`).join('')}
        ${a.valida ? '' : `<br><span style="color:var(--rojo)">✖ No se puede incorporar: ${esc(a.error)}</span>`}
        ${(a.advertencias || []).map((w) => `<br><span style="color:var(--ambar)">▲ ${esc(w)}</span>`).join('')}</span></label></div></div>`).join('');
    const res = await modal({
      titulo: 'Plan registrado desde documento', ancho: 860,
      contenido: `<p class="mut" style="margin:0 0 8px">«${esc(vista.archivo)}»: se entendieron ${r.actividades} actividad${r.actividades === 1 ? '' : 'es'} (${r.validas} lista${r.validas === 1 ? '' : 's'} para incorporar, ${r.dias_total} días hábiles de ${r.dias_periodo ?? '—'} del periodo). Las fechas las calcula la aplicación con los días hábiles; las del documento no se copian. Revise y confirme: nada se guardó todavía.${vista.existentes ? ` El plan ya tiene ${vista.existentes} actividad(es): las nuevas se agregan a continuación.` : ''}</p>
        <div style="max-height:56vh;overflow:auto">${filas}</div>`,
      botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Incorporar al plan', clase: 'prim', valor: 'ok' }],
    });
    if (res.valor !== 'ok') return;
    const indices = vista.plan.actividades.map((_, i) => i).filter((i) => res.datos[`a_${i}`] === 1);
    if (!indices.length) { aviso('No seleccionó ninguna actividad', 'error'); return; }
    try {
      const x = await api('POST', `/formulacion/${consultorId}/plan-documento/aplicar`, { importacion_id: vista.importacion_id, indices });
      if (x.fallidas.length) {
        await modal({ titulo: 'Actividades que no se pudieron incorporar', ancho: 700, botones: [{ texto: 'Aceptar', clase: 'prim', valor: true }],
          contenido: `<p class="mut" style="margin:0 0 8px">Se incorporaron ${x.creadas.length}. Estas no:</p>${x.fallidas.map((f) => `<div class="alerta"><div class="t">${esc(f.descripcion)}</div><div class="d">${esc(f.motivo)}</div></div>`).join('')}` });
      } else aviso(`Se incorporaron ${x.creadas.length} actividades al plan`, 'exito');
      await recargar();
    } catch (err) { fallo(err); }
  }

  function conectar() {
    const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = fn; };
    el.querySelectorAll('[name=supuestos]').forEach((c) => { if (!c.disabled) autoguardar(c); });
    on('#b-agregar', () => pedirActividad(null));
    on('#b-importar', () => el.querySelector('#f-plan').click());
    on('#o-importar', () => el.querySelector('#f-plan').click());
    on('#o-agregar', () => pedirActividad(null));
    const fp = el.querySelector('#f-plan');
    if (fp) fp.onchange = () => { const arch = fp.files[0]; fp.value = ''; if (arch) importarPlan(arch); };
    on('#b-origen', () => { window.open(`/api/formulacion/${consultorId}/plan-documento`, '_blank', 'noopener'); });
    on('#b-pdf', async () => {
      try {
        const r = await api('POST', `/formulacion/${consultorId}/pdf`, {});
        aviso('PDF del plan generado', 'exito');
        window.open(`/api/planes/${r.plan_id}/pdf`, '_blank', 'noopener');
      } catch (err) { fallo(err); }
    });
    el.querySelectorAll('tbody.grupo[data-id]').forEach((tr) => {
      const bd = tr.querySelector('[data-desplegar]');
      if (bd) bd.onclick = () => { const p = tr.classList.toggle('plegado'); bd.textContent = p ? '▸' : '▾'; bd.setAttribute('aria-expanded', String(!p)); };
      const a = d.actividades.find((x) => x.actividad_id === Number(tr.dataset.id));
      const be = tr.querySelector('[data-editar]'); if (be) be.onclick = () => pedirActividad(a);
      const bq = tr.querySelector('[data-quitar]');
      if (bq) bq.onclick = async () => {
        const r = await modal({ titulo: 'Quitar actividad', contenido: `<p style="margin:0">¿Quitar la actividad ${esc(a.numero)} del plan? Queda registrada en la bitácora.</p>`, botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Quitar', clase: 'peligro', valor: 'ok' }] });
        if (r.valor !== 'ok') return;
        try { await api('POST', `/formulacion/actividades/${a.actividad_id}/quitar`, {}); await recargar(); } catch (err) { fallo(err); }
      };
    });
    on('#b-enviar', () => decidir('ENVIAR', { titulo: 'Enviar para revisión y aprobación', texto: 'Una vez enviado, el plan quedará fijo y no podrá modificarlo. Pasará al Jefe de Proyecto. ¿Desea enviarlo?', boton: 'Enviar plan' }));
    on('#b-aprobar-jefe', () => decidir('APROBAR_JEFE', { titulo: 'Aprobar el plan propuesto', texto: 'Se generará el Plan de Trabajo en PDF y se remitirá al Administrador para su aprobación. Puede dejar un comentario.', boton: 'Aprobar y remitir al Administrador', comentario: true }));
    on('#b-ver-pdf', () => verPlanPdf({ plan_id: p.plan_id, titulo: `Plan de trabajo · ${d.consultor.nombres.toUpperCase()}`, aprobado: perm.estado === 'APROBADO' }));
    on('#b-observar', () => decidir('OBSERVAR', { titulo: 'Observar el plan', texto: 'El plan volverá al Jefe de Proyecto con sus comentarios.', boton: 'Registrar observación', comentario: true, requerido: true, clase: 'peligro' }));
    on('#b-aprobar', () => decidir('APROBAR', { titulo: 'Aprobar el plan', texto: 'El plan quedará fijo y comenzará el seguimiento de sus fechas y actividades.', boton: 'Aprobar el plan', comentario: true }));
  }
  pintar();
}
