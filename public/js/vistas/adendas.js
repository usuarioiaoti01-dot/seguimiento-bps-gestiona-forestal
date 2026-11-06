import { api, esc, ff, titulo, badge, estado, puede, modal, opciones, aviso, fallo, pedirTexto } from '../util.js';
import { abrirCargaDocumento } from './carga-documento.js';
import { editarAdenda } from './consultor.js';

export async function vistaAdendas(el) {
  const [adendas, e] = await Promise.all([api('GET', '/adendas'), api('GET', `/estado${estado.corte ? `?corte=${estado.corte}` : ''}`)]);
  titulo('CONTRATOS Y ADENDAS', 'Vigencia por profesional · la vigencia solo se amplía con adendas FIRMADAS');
  el.innerHTML = `
  <div class="tarjeta"><div class="cab"><h2>Adendas registradas</h2>
    ${puede('EDITOR') ? '<div class="acciones"><button class="btn peq" id="b-agregar">Agregar adenda</button><button class="btn peq prim" id="b-doc-adenda">Subir documento de adenda</button></div>' : ''}
    <div class="filtros"><select id="f-est"><option value="">Todos los estados</option><option value="FIRMADA">Firmada</option><option value="EN_TRAMITE">En trámite</option><option value="ANUNCIADA">Anunciada</option><option value="ANULADA">Anulada</option></select></div></div>
    <div class="cuerpo sin tabla-env"><table class="tabla-adendas"><tbody id="cuerpo"></tbody></table></div></div>
  <p class="mut2">Pulse un profesional para desplegar sus adendas; «Ver ficha» abre su ficha completa. «Subir documento de adenda» lee el documento y propone los datos antes de guardar; «Agregar adenda» las registra a mano. Todos los cambios quedan en el historial y la bitácora.</p>`;
  const bd = el.querySelector('#b-doc-adenda');
  if (bd) bd.onclick = () => abrirCargaDocumento(e.consultores, { tipo: 'adenda' });
  const ba = el.querySelector('#b-agregar');
  if (ba) {
    ba.onclick = async () => {
      const r = await modal({
        titulo: 'Agregar adenda', ancho: 520,
        contenido: `<p class="mut" style="margin:0">Elija al profesional y complete los datos de la adenda en el siguiente paso.</p>
          <div class="form"><div class="campo ancho"><label>Profesional</label><select name="consultor_id">${opciones(e.consultores.map((c) => [c.consultor_id, `${c.nombres} (${c.clave})`]))}</select></div></div>`,
        botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Continuar', clase: 'prim', valor: 'ok' }],
      });
      if (r.valor !== 'ok') return;
      try {
        const d = await api('GET', `/consultores/${r.datos.consultor_id}${estado.corte ? `?corte=${estado.corte}` : ''}`);
        if (!d.contrato) { aviso('El profesional no tiene un contrato registrado', 'error'); return; }
        await editarAdenda(null, d, true);
      } catch (err) { fallo(err); }
    };
  }
  const abiertos = new Set(); // profesionales desplegados
  const editor = puede('EDITOR');

  // Visor del PDF de la adenda; si el sistema no lo tiene, avisa y permite cargarlo.
  function verAdendaPdf(a) {
    const url = `/api/adendas/${a.adenda_id}/pdf`;
    const nombre = `Adenda N.° ${String(a.numero).padStart(2, '0')} · ${a.nombres.toUpperCase()}`;
    const cerrarVelo = () => document.querySelector('.velo .cerrar').click();
    const subir = (velo) => {
      const f = document.createElement('input'); f.type = 'file'; f.accept = 'application/pdf,.pdf';
      f.onchange = async () => {
        const arch = f.files[0]; if (!arch) return;
        if (arch.type !== 'application/pdf' && !/\.pdf$/i.test(arch.name)) { aviso('Seleccione un archivo PDF', 'error'); return; }
        if (arch.size > 15 * 1024 * 1024) { aviso('El PDF supera el máximo de 15 MB', 'error'); return; }
        const motivo = await pedirTexto(a.tiene_pdf ? 'Reemplazar el PDF de la adenda' : 'Cargar el PDF de la adenda', `Se adjuntará «${arch.name}» a la ${nombre}. La versión anterior, si existe, se conserva.`, 'Ej.: Adenda suscrita, copia remitida por BPS el 05/11/2026');
        if (!motivo) return;
        try {
          const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-SGF': '1', 'X-Motivo': encodeURIComponent(motivo) }, body: arch, credentials: 'same-origin' });
          const dat = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(dat.error || `Error ${r.status}`);
          // se confirma con el servidor que el archivo quedó guardado antes de mostrarlo
          const lista = await api('GET', '/adendas');
          a.tiene_pdf = !!(lista.find((x) => x.adenda_id === a.adenda_id) || {}).tiene_pdf;
          if (!a.tiene_pdf) { aviso('El servidor respondió, pero el PDF no quedó guardado. Revise la carpeta ADENDAS_PDF_DIR.', 'error'); return; }
          aviso('PDF de la adenda guardado', 'exito');
          cerrarVelo(); verAdendaPdf(a);
        } catch (err) { fallo(err); }
      };
      f.click();
    };
    if (a.tiene_pdf) {
      modal({
        titulo: nombre, ancho: 1100, botones: [], cerrarTexto: true,
        contenido: `<iframe src="${url}#navpanes=0&zoom=100" title="${esc(nombre)}" style="width:100%;height:72vh;border:1px solid var(--borde);border-radius:8px;background:var(--superficie-2)"></iframe>
          <div class="acciones" style="justify-content:space-between"><span class="mut2">Si el visor no se muestra, <a href="${url}" target="_blank" rel="noopener">abra el PDF en una pestaña nueva</a>.</span>${editor ? '<button type="button" class="btn peq" id="b-subir-pdf">Reemplazar PDF</button>' : ''}</div>`,
      });
    } else {
      modal({
        titulo: nombre, ancho: 560, botones: [], cerrarTexto: true,
        contenido: `${a.documento_ref
          ? `<p style="margin:12px 0;text-align:center;font-size:18px;font-weight:700;color:var(--ambar, #b7791f)">ADENDA REGISTRADA · FALTA CARGAR EL PDF</p><p class="mut" style="text-align:center;margin:0 0 8px">${esc(a.documento_ref)}</p>`
          : '<p style="margin:12px 0;text-align:center;font-size:18px;font-weight:700;color:var(--rojo)">SIN ADENDA REGISTRADA EN EL SISTEMA</p>'}
          <p class="mut" style="text-align:center;margin:0 0 12px">${editor ? 'Cargue el archivo PDF de la adenda para registrarlo.' : 'Solicite a un responsable que cargue el PDF de la adenda.'}</p>
          ${editor ? '<div style="text-align:center"><button type="button" class="btn prim" id="b-ir-documento">Cargar PDF de la adenda</button></div><p class="mut2" style="text-align:center;margin:12px 0 0">¿Es un escaneo, sin texto? <a href="#" id="b-subir-pdf">Guardar el PDF sin leerlo</a></p>' : ''}`,
      });
    }
    const velo = document.querySelector('.velo');
    const b = velo.querySelector('#b-subir-pdf');
    if (b) b.onclick = (ev) => { ev.preventDefault(); subir(velo); };
    // «Cargar PDF de la adenda» lleva a «Subir documento de adenda», con el profesional ya elegido
    const ir = velo.querySelector('#b-ir-documento');
    if (ir) ir.onclick = () => { cerrarVelo(); abrirCargaDocumento(e.consultores, { tipo: 'adenda', consultor_id: a.consultor_id }); };
  }
  // Texto largo: tres líneas y, si no cabe, «Ver todo» en una ventana emergente.
  const largo = (t, titulo) => {
    const x = String(t || '').trim();
    if (!x) return '<span class="mut2">—</span>';
    return `<div class="clamp3">${esc(x)}</div>${x.length > 110 ? `<a href="#" class="ver-todo" data-t="${esc(titulo)}" data-x="${esc(x)}">Ver todo</a>` : ''}`;
  };
  const pintar = () => {
    const s = el.querySelector('#f-est').value;
    const grupos = new Map();
    for (const a of adendas.filter((x) => !s || x.estado === s)) {
      if (!grupos.has(a.consultor_id)) grupos.set(a.consultor_id, []);
      grupos.get(a.consultor_id).push(a);
    }
    el.querySelector('#cuerpo').innerHTML = [...grupos.values()].map((lista) => {
      const p = lista[0];
      const abierto = abiertos.has(p.consultor_id);
      const cab = `<tr class="grupo clic" data-id="${p.consultor_id}" aria-expanded="${abierto}"><td colspan="9"><span class="flecha">${abierto ? '▾' : '▸'}</span> <b>${esc(p.nombres.toUpperCase())}</b> <a href="#/contrato/${p.consultor_id}" class="ver-ficha">Ver ficha</a></td></tr>`;
      if (!abierto) return cab;
      const enc = '<tr class="enc"><th>Profesional</th><th>Contrato</th><th class="c">Adenda</th><th>Estado</th><th>Inicio</th><th>Fin</th><th>Documento</th><th>Expediente</th><th>Observación</th></tr>';
      return cab + enc + lista.map((a) => `<tr class="hija clic" data-adenda="${a.adenda_id}" title="Clic para ver el PDF de la adenda"><td></td><td class="num mut2">${esc(a.contrato)}</td><td class="c num">${String(a.numero).padStart(2, '0')}</td><td>${badge(a.estado)}</td><td class="num">${ff(a.fecha_inicio)}</td><td class="num">${ff(a.fecha_fin)}</td><td class="mut2">${largo(a.documento_ref, `Documento · ${p.nombres} · Adenda ${String(a.numero).padStart(2, '0')}`)}</td><td class="num mut2">${esc(a.expediente || '')}</td><td class="mut2 desc">${largo(a.observacion, `Observación · ${p.nombres} · Adenda ${String(a.numero).padStart(2, '0')}`)}</td></tr>`).join('');
    }).join('') || '<tr><td colspan="9" class="vacio">Sin resultados</td></tr>';
  };
  el.querySelector('#cuerpo').onclick = async (ev) => {
    if (ev.target.closest('.ver-ficha')) return; // el enlace navega solo
    const v = ev.target.closest('.ver-todo');
    if (v) {
      ev.preventDefault();
      const r = modal({ titulo: v.dataset.t, ancho: 620, botones: [], contenido: `<p style="white-space:pre-wrap;margin:0">${esc(v.dataset.x)}</p>` });
      const c = document.querySelector('.velo .cerrar'); c.textContent = 'Cerrar'; c.classList.add('texto');
      await r;
      return;
    }
    const h = ev.target.closest('tr.hija');
    if (h) { verAdendaPdf(adendas.find((x) => x.adenda_id === Number(h.dataset.adenda))); return; }
    const g = ev.target.closest('tr.grupo');
    if (!g) return;
    const id = Number(g.dataset.id);
    if (abiertos.has(id)) abiertos.delete(id); else abiertos.add(id);
    pintar();
  };
  el.querySelector('#f-est').onchange = pintar;
  pintar();
}
