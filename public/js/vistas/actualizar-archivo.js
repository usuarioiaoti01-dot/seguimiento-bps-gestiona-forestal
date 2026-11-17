import { api, esc, fh, titulo, modal, aviso, fallo } from '../util.js';

const MAX_BYTES = 50 * 1024 * 1024;
const FORMATOS = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', csv: 'CSV', 'project-xml': 'MS Project (XML)' };
const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Sube un archivo; el servidor lo lee, aplica lo que concuerda con la lógica de la aplicación y lo conserva. */
async function subir(archivo) {
  const r = await fetch('/api/actualizar-archivo', {
    method: 'POST', credentials: 'same-origin', body: archivo,
    headers: { 'Content-Type': 'application/octet-stream', 'X-SGF': '1', 'X-Nombre': encodeURIComponent(archivo.name) },
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || `Error ${r.status}`);
  return datos;
}

const lugar = (x) => [x.hoja ? `Hoja «${x.hoja}»` : '', x.fila ? `fila ${x.fila}` : '', x.referencia || ''].filter(Boolean).join(' · ');

function ventanaResultado(resultados) {
  const aplicados = resultados.reduce((n, r) => n + r.aplicados.length, 0);
  const problemas = resultados.filter((r) => r.inconsistencias.length);
  if (!problemas.length) {
    return modal({
      titulo: 'Carga exitosa', ancho: 520, botones: [{ texto: 'Aceptar', clase: 'prim', valor: true }],
      contenido: `<p style="margin:0">La carga fue exitosa.</p>
        <p class="mut" style="margin:8px 0 0">${resultados.length} archivo${resultados.length === 1 ? '' : 's'} procesado${resultados.length === 1 ? '' : 's'} · ${aplicados} registro${aplicados === 1 ? '' : 's'} actualizado${aplicados === 1 ? '' : 's'}${aplicados === 0 ? ' (los datos del archivo ya coincidían con los de la aplicación)' : ''}. Los documentos quedaron guardados y pueden verse abajo.</p>`,
    });
  }
  return modal({
    titulo: 'Datos que no se pudieron identificar o incorporar', ancho: 860, botones: [{ texto: 'Aceptar', clase: 'prim', valor: true }],
    contenido: `<p class="mut" style="margin:0 0 8px">${aplicados} registro${aplicados === 1 ? '' : 's'} se incorporó correctamente. Revise lo siguiente: no se modificó nada de lo que aparece aquí.</p>
      <div style="max-height:60vh;overflow:auto">${resultados.map((r) => `<div class="tarjeta" style="margin-bottom:10px"><div class="cab"><h2 style="font-size:1rem">${esc(r.archivo)}</h2>
        <span class="mut2">${r.aplicados.length} actualizado${r.aplicados.length === 1 ? '' : 's'} · ${r.inconsistencias.length} sin incorporar</span></div>
        <div class="cuerpo sin tabla-env">${r.inconsistencias.length ? `<table><thead><tr><th>Ubicación</th><th>Motivo</th></tr></thead><tbody>${r.inconsistencias.map((x) => `<tr><td class="desc">${esc(lugar(x)) || '<span class="mut2">—</span>'}</td><td class="desc">${esc(x.motivo)}</td></tr>`).join('')}</tbody></table>` : '<div class="vacio">Sin observaciones</div>'}</div></div>`).join('')}</div>`,
  });
}

/** Visor: PDF en línea; Excel, CSV, XML de Project y Word se muestran como tabla o texto. */
async function verDocumento(doc) {
  const url = `/api/actualizar-archivo/${doc.id}/archivo`;
  let cuerpo;
  if (doc.formato === 'pdf') {
    cuerpo = `<iframe src="${url}#navpanes=0&zoom=100" title="${esc(doc.archivo)}" style="width:100%;height:72vh;border:1px solid var(--borde);border-radius:8px;background:var(--superficie-2)"></iframe>`;
  } else {
    try {
      const c = await api('GET', `/actualizar-archivo/${doc.id}/contenido`);
      cuerpo = c.tipo === 'tablas'
        ? `<div style="max-height:70vh;overflow:auto">${c.hojas.map((h) => `<h3 style="margin:8px 0 4px;font-size:.95rem">${esc(h.nombre)} <span class="mut2">(${h.total} filas${h.total > h.filas.length ? `, se muestran ${h.filas.length}` : ''})</span></h3>
            <div class="tabla-env"><table><tbody>${h.filas.map((f) => `<tr>${f.map((v) => `<td class="desc">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`).join('')}</div>`
        : `<pre style="white-space:pre-wrap;max-height:70vh;overflow:auto;margin:0;font:inherit">${esc(c.texto)}</pre>`;
    } catch (err) { cuerpo = `<div class="vacio">${esc(err.message)}</div>`; }
  }
  await modal({
    titulo: doc.archivo, ancho: 1100, botones: [],
    contenido: `${cuerpo}<div class="mut2" style="margin-top:6px">Cargado el ${esc(fh(doc.fecha))} por ${esc(doc.usuario)} · <a href="${url}?descargar=1">Descargar el original</a></div>`,
  });
}

export async function vistaActualizarArchivo(el) {
  titulo('Actualizar desde archivo', 'Suba uno o más archivos (Excel, CSV, XML de MS Project, PDF o Word): se leen, se incorporan los datos que concuerdan y el documento queda guardado');
  el.innerHTML = `<div class="tarjeta"><div class="cab"><h2>Subir archivos</h2></div><div class="cuerpo">
      <input type="file" id="a-archivos" multiple accept=".xlsx,.csv,.xml,.pdf,.docx" style="display:none">
      <div class="acciones" style="gap:10px;align-items:center">
        <button class="btn prim" id="a-elegir" type="button">Elegir archivos</button>
        <button class="btn" id="a-subir" type="button" disabled>Actualizar</button>
        <span class="mut2" id="a-estado">Ningún archivo seleccionado</span></div>
      <div id="a-lista" class="mut2" style="margin-top:8px"></div>
      <p class="mut2" style="margin:10px 0 0">Los PDF y Word los lee el asistente de IA (antes se les quitan DNI, teléfonos y correos). Las actividades que no existan en el plan no se crean solas: se informan.</p></div></div>
    <div class="tarjeta"><div class="cab"><h2>Documentos utilizados</h2></div><div class="cuerpo sin tabla-env"><table><thead><tr><th>Fecha</th><th>Archivo</th><th>Formato</th><th>Usuario</th><th class="d">Actualizados</th><th class="d">Sin incorporar</th><th></th></tr></thead>
      <tbody id="a-cuerpo"><tr><td colspan="7" class="vacio">Cargando…</td></tr></tbody></table></div></div>`;

  const entrada = el.querySelector('#a-archivos');
  const btnSubir = el.querySelector('#a-subir');
  const estado = el.querySelector('#a-estado');
  let docs = [];
  let elegidos = [];

  const pintarLista = async () => {
    try { docs = await api('GET', '/actualizar-archivo'); } catch (err) { fallo(err); docs = []; }
    el.querySelector('#a-cuerpo').innerHTML = docs.map((x, i) => `<tr><td class="num">${esc(fh(x.fecha))}</td><td class="desc">${esc(x.archivo)}<small>${esc(kb(x.bytes))}</small></td><td>${esc(FORMATOS[x.formato] || x.formato)}</td><td>${esc(x.usuario)}</td>
      <td class="d num">${x.aplicados ?? 0}</td><td class="d num">${(x.inconsistencias || []).length ? `<span class="badge b-ambar" title="${esc((x.inconsistencias || []).join('\n'))}">${x.inconsistencias.length}</span>` : 0}</td>
      <td><button class="btn peq" data-ver="${i}">Ver documento</button></td></tr>`).join('') || '<tr><td colspan="7" class="vacio">Aún no se ha subido ningún archivo</td></tr>';
    el.querySelectorAll('[data-ver]').forEach((b) => { b.onclick = () => verDocumento(docs[Number(b.dataset.ver)]); });
  };

  el.querySelector('#a-elegir').onclick = () => entrada.click();
  entrada.onchange = () => {
    elegidos = [...entrada.files];
    const grandes = elegidos.filter((f) => f.size > MAX_BYTES);
    if (grandes.length) { aviso(`«${grandes[0].name}» supera el máximo de 50 MB`, 'error'); elegidos = elegidos.filter((f) => f.size <= MAX_BYTES); }
    btnSubir.disabled = !elegidos.length;
    estado.textContent = elegidos.length ? `${elegidos.length} archivo${elegidos.length === 1 ? '' : 's'} seleccionado${elegidos.length === 1 ? '' : 's'}` : 'Ningún archivo seleccionado';
    el.querySelector('#a-lista').innerHTML = elegidos.map((f) => `• ${esc(f.name)} <span class="mut2">(${esc(kb(f.size))})</span>`).join('<br>');
  };

  btnSubir.onclick = async () => {
    if (!elegidos.length) return;
    btnSubir.disabled = true; entrada.disabled = true;
    const resultados = [];
    for (let i = 0; i < elegidos.length; i += 1) {
      estado.textContent = `Procesando ${i + 1} de ${elegidos.length}: ${elegidos[i].name}…`;
      try { resultados.push(await subir(elegidos[i])); } catch (err) { resultados.push({ archivo: elegidos[i].name, aplicados: [], inconsistencias: [{ motivo: err.message }] }); }
    }
    elegidos = []; entrada.value = ''; entrada.disabled = false;
    estado.textContent = 'Ningún archivo seleccionado'; el.querySelector('#a-lista').innerHTML = '';
    await pintarLista();
    if (resultados.some((r) => r.aplicados.length)) window.sgfRefrescarDatos?.();
    await ventanaResultado(resultados);
  };

  await pintarLista();
}
