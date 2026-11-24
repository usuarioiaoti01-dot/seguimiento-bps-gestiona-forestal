import { api, esc, ff, modal, aviso, fallo, puede } from '../util.js';

const MAX_PDF = 15 * 1024 * 1024;
const fecha = (s) => (s ? ff(String(s).slice(0, 10)) : '—');

/** Adjunta (o reemplaza) un PDF del profesional: «documento» (Orden de Servicio / contrato) o «tdr». */
export async function subirPdf(contratoId, ruta, archivo) {
  if (archivo.type !== 'application/pdf' && !/\.pdf$/i.test(archivo.name)) throw new Error('El archivo debe ser un PDF');
  if (archivo.size > MAX_PDF) throw new Error('El PDF supera el máximo de 15 MB');
  const r = await fetch(`/api/contratos/${contratoId}/${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-SGF': '1' }, body: archivo, credentials: 'same-origin' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
}

export function verPdf(url, titulo) {
  return modal({
    titulo, ancho: 1100, botones: [],
    contenido: `<iframe src="${url}#navpanes=0&zoom=100" title="${esc(titulo)}" style="width:100%;height:72vh;border:1px solid var(--borde);border-radius:8px;background:var(--superficie-2)"></iframe>
      <div class="mut2">Si el visor no se muestra, <a href="${url}" target="_blank" rel="noopener">abra el PDF en una pestaña nueva</a>.</div>`,
  });
}

async function renovarOS(p, c) {
  const r = await modal({
    titulo: `Renovar la Orden de Servicio de ${c.nombres}`, ancho: 640,
    contenido: `<p class="mut" style="margin:0">Vigente hasta el ${fecha(c.fin_vigencia)}. El nuevo periodo empieza al día siguiente, salvo que indique otra fecha.</p>
      <div class="form">
        <div class="campo"><label>N.° de la nueva Orden de Servicio</label><input name="os_numero" maxlength="60"></div>
        <div class="campo"><label>Inicio (opcional)</label><input type="date" name="inicio"></div>
        <div class="campo"><label>Plazo en días</label><input type="number" min="1" name="plazo_dias"></div>
        <div class="campo"><label>o fin del periodo</label><input type="date" name="fin"></div>
        <div class="campo ancho"><label>Orden de Servicio (PDF) — reemplaza a la anterior, que se conserva</label><input type="file" name="__os" accept="application/pdf,.pdf"></div></div>`,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Renovar', clase: 'prim', valor: 'ok' }],
  });
  if (r.valor !== 'ok') return false;
  const archivo = r.form.elements.__os.files[0];
  const datos = { ...r.datos }; delete datos.__os;
  try {
    await api('POST', `/proyectos/${p.proyecto_id}/profesionales/${c.consultor_id}/renovar`, datos);
    if (archivo) { try { await subirPdf(c.contrato_id, 'documento', archivo); } catch (e) { aviso(`Se renovó el plazo, pero no se pudo adjuntar el PDF: ${e.message}`, 'error'); } }
    aviso('Orden de Servicio renovada', 'exito');
    return true;
  } catch (err) { fallo(err); return false; }
}

const SITUACION = {
  VIGENTE: ['b-verde', 'Vigente'], POR_VENCER: ['b-ambar', 'Por vencer'], VENCIDA: ['b-rojo', 'Vencida'], SIN_PERIODO: ['b-gris', 'Sin periodo'],
};

/** Profesionales del proyecto con el vencimiento de su Orden de Servicio / contrato y sus documentos. */
function tabla(p, lista) {
  if (!lista.length) return '<div class="vacio">Aún no hay profesionales registrados en este proyecto.</div>';
  const os = p.con_orden_servicio === 1;
  const puedeEd = puedeProyecto(p.proyecto_id);
  const celdaPdf = (c, ruta, info, etiqueta) => (info.existe
    ? `<button class="btn peq" type="button" data-pdf="/api/contratos/${c.contrato_id}/${ruta}" data-titulo="${esc(etiqueta)} · ${esc(c.nombres)}">Ver</button>${puedeEd ? ` <button class="btn peq" type="button" data-subir="${c.contrato_id}|${ruta}">Reemplazar</button>` : ''}`
    : `<span class="badge b-ambar">Pendiente</span>${puedeEd ? ` <button class="btn peq" type="button" data-subir="${c.contrato_id}|${ruta}">Adjuntar</button>` : ''}`);
  return `<table><thead><tr><th>Profesional</th><th>${os ? 'Orden de Servicio' : 'Contrato'}</th><th>Vence</th>${os ? '<th>Orden de Servicio (PDF)</th>' : ''}${p.con_tdr ? '<th>Términos de Referencia</th>' : ''}<th></th></tr></thead><tbody>
    ${lista.map((c) => {
      const [clase, texto] = SITUACION[c.situacion] || SITUACION.SIN_PERIODO;
      const dias = c.dias_restantes === null ? '' : c.dias_restantes < 0 ? ` · hace ${-c.dias_restantes} d` : ` · ${c.dias_restantes} d`;
      return `<tr><td class="desc"><b>${esc(c.nombres)}</b><small>${esc(c.clave)}${c.perfil ? ` · ${esc(c.perfil)}` : ''}</small></td>
        <td class="num">${esc(c.numero || '—')}</td>
        <td class="num">${fecha(c.fin_vigencia)}${dias} <span class="badge ${clase}">${texto}</span></td>
        ${os ? `<td>${c.contrato_id ? celdaPdf(c, 'documento', c.documento, 'Orden de Servicio') : '—'}</td>` : ''}
        ${p.con_tdr ? `<td>${c.contrato_id ? celdaPdf(c, 'tdr', c.tdr, 'Términos de Referencia') : '—'}</td>` : ''}
        <td>${puedeEd && !p.con_adendas && c.contrato_id ? `<button class="btn peq" type="button" data-renovar="${c.consultor_id}">Renovar</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table>`;
}

/** Dibuja en `cont` los profesionales del proyecto `p` (sección Plazos - Vencimientos) y conecta sus acciones. */
export async function montarProfesionales(cont, p) {
  const pintar = async () => {
    let profesionales;
    try { profesionales = await api('GET', `/proyectos/${p.proyecto_id}/profesionales`); } catch (err) { cont.innerHTML = `<div class="vacio">${esc(err.message)}</div>`; return; }
    cont.innerHTML = tabla(p, profesionales);
    cont.querySelectorAll('[data-pdf]').forEach((b) => { b.onclick = () => verPdf(b.dataset.pdf, b.dataset.titulo); });
    cont.querySelectorAll('[data-subir]').forEach((b) => {
      b.onclick = () => {
        const entrada = document.createElement('input'); entrada.type = 'file'; entrada.accept = 'application/pdf,.pdf';
        entrada.onchange = async () => {
          const [id, ruta] = b.dataset.subir.split('|');
          if (!entrada.files[0]) return;
          try { await subirPdf(id, ruta, entrada.files[0]); aviso('PDF guardado', 'exito'); pintar(); } catch (err) { fallo(err); }
        };
        entrada.click();
      };
    });
    cont.querySelectorAll('[data-renovar]').forEach((b) => { b.onclick = async () => { if (await renovarOS(p, profesionales.find((c) => c.consultor_id === Number(b.dataset.renovar)))) { if (window.sgfRefrescar) window.sgfRefrescar(); } }; });
  };
  await pintar();
}
