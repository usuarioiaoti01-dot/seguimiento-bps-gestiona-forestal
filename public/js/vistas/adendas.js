import { api, esc, ff, titulo, badge, dia, estado, puede, modal, opciones, aviso, fallo } from '../util.js';
import { abrirCargaDocumento } from './carga-documento.js';
import { editarAdenda } from './consultor.js';

export async function vistaAdendas(el) {
  const [adendas, e] = await Promise.all([api('GET', '/adendas'), api('GET', `/estado${estado.corte ? `?corte=${estado.corte}` : ''}`)]);
  titulo('Contratos y adendas', 'Vigencia por profesional · la vigencia solo se amplía con adendas FIRMADAS');
  const corte = e.corte;
  el.innerHTML = `
  <div class="tarjeta"><div class="cab"><h2>Adendas registradas</h2>
    ${puede('EDITOR') ? '<div class="acciones"><button class="btn peq" id="b-agregar">Agregar adenda</button><button class="btn peq prim" id="b-doc-adenda">Subir documento de adenda</button></div>' : ''}
    <div class="filtros"><input id="f-txt" placeholder="Buscar profesional o documento"><select id="f-est"><option value="">Todos los estados</option><option value="FIRMADA">Firmada</option><option value="EN_TRAMITE">En trámite</option><option value="ANUNCIADA">Anunciada</option><option value="ANULADA">Anulada</option></select></div></div>
    <div class="cuerpo sin tabla-env"><table><thead><tr><th>Profesional</th><th>Contrato</th><th class="c">Adenda</th><th>Estado</th><th>Inicio</th><th>Fin</th><th>Situación al corte</th><th>Documento</th><th>Expediente</th><th>Observación</th></tr></thead><tbody id="cuerpo"></tbody></table></div></div>
  <p class="mut2">Para editar una adenda, abra la ficha del profesional (clic en la fila). «Subir documento de adenda» lee el documento y propone los datos antes de guardar; «Agregar adenda» las registra a mano. Todos los cambios quedan en el historial y la bitácora.</p>`;
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
  const pintar = () => {
    const t = el.querySelector('#f-txt').value.toLowerCase();
    const s = el.querySelector('#f-est').value;
    const filas = adendas.filter((a) => (!s || a.estado === s) && (!t || `${a.nombres} ${a.documento_ref} ${a.contrato}`.toLowerCase().includes(t)));
    el.querySelector('#cuerpo').innerHTML = filas.map((a) => {
      const hoy = dia(corte);
      let sit = '';
      if (a.estado === 'FIRMADA') sit = hoy < dia(a.fecha_inicio) ? badge('PROGRAMADA', 'Por iniciar') : hoy > dia(a.fecha_fin) ? badge('GRIS', 'Concluida') : badge('VERDE', `Vigente · ${dia(a.fecha_fin) - hoy} d`);
      else if (a.estado !== 'ANULADA') sit = badge('AMBAR', 'No amplía vigencia aún');
      return `<tr class="clic" data-id="${a.consultor_id}"><td><b>${esc(a.nombres)}</b> <span class="mut2">${esc(a.clave)}</span></td><td class="num">${esc(a.contrato)}</td><td class="c num">${String(a.numero).padStart(2, '0')}</td><td>${badge(a.estado)}</td><td class="num">${ff(a.fecha_inicio)}</td><td class="num">${ff(a.fecha_fin)}</td><td>${sit}</td><td class="mut2">${esc(a.documento_ref || '—')}</td><td class="num mut2">${esc(a.expediente || '')}</td><td class="mut2 desc">${esc(a.observacion || '')}</td></tr>`;
    }).join('') || '<tr><td colspan="10" class="vacio">Sin resultados</td></tr>';
    el.querySelectorAll('tr.clic').forEach((tr) => { tr.onclick = () => { location.hash = `#/consultor/${tr.dataset.id}`; }; });
  };
  el.querySelector('#f-txt').oninput = pintar;
  el.querySelector('#f-est').onchange = pintar;
  pintar();
}
