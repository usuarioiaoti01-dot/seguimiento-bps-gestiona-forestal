'use strict';
/**
 * Correo diario de alertas (P11 de PLAN_DE_MEJORAS.md). Función PURA: arma los correos, no los envía.
 *
 * - Cada Jefe de Proyecto activo recibe las alertas de los proyectos de SU equipo (sgf.proyecto_miembro).
 * - Cada Administrador activo recibe, si `copiaAdmin`, el resumen de todos los proyectos.
 * - Solo las alertas que piden una acción del equipo (CODIGOS); sin alertas, no hay correo.
 * - No lleva datos personales ni montos: nombre del proyecto, del profesional, la alerta y la acción.
 */
const CODIGOS = ['ENTREGABLE_VENCIDO', 'SUBSANACION_VENCIDA', 'CONFORMIDAD_FUERA_DE_PLAZO', 'ENTREGABLE_EN_RIESGO', 'VIGENCIA_VENCIDA',
  'ENTREGABLE_POR_VENCER', 'SIN_PARTE_DIARIO', 'OS_SIN_NOTIFICAR', 'VIGENCIA_POR_VENCER'];
const PESO = { ALTA: 0, MEDIA: 1, BAJA: 2 };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ff = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const vivo = (x) => x && x.activo !== 0 && x.activo !== false;

/** Alertas relevantes agrupadas por proyecto: [{ proyecto, alertas }] (proyectos abiertos, alertas ordenadas). */
function alertasPorProyecto(datos, estado, proyectoIds = null) {
  const proyectoDe = new Map((datos.consultores || []).map((c) => [c.consultor_id, c.proyecto_id]));
  const proyectos = (datos.proyectos || []).filter((p) => vivo(p) && !['CERRADO', 'ANULADO'].includes(p.estado) && (!proyectoIds || proyectoIds.has(p.proyecto_id)));
  return proyectos.map((p) => ({
    proyecto: p,
    alertas: (estado.alertas || []).filter((a) => CODIGOS.includes(a.codigo) && proyectoDe.get(a.consultor_id) === p.proyecto_id)
      .sort((a, b) => (PESO[a.prioridad] ?? 9) - (PESO[b.prioridad] ?? 9) || String(a.clave).localeCompare(String(b.clave))),
  })).filter((g) => g.alertas.length).sort((a, b) => String(a.proyecto.codigo).localeCompare(String(b.proyecto.codigo)));
}

function cuerpo({ saludo, grupos, corte, urlAplicacion, pie }) {
  const altas = grupos.reduce((n, g) => n + g.alertas.filter((a) => a.prioridad === 'ALTA').length, 0);
  const total = grupos.reduce((n, g) => n + g.alertas.length, 0);
  const resumen = `${total} alerta(s) en ${grupos.length} proyecto(s)${altas ? `, ${altas} de prioridad alta` : ''}, al ${ff(corte)}.`;
  const texto = [saludo, '', resumen, '',
    ...grupos.flatMap((g) => [`${g.proyecto.codigo} · ${g.proyecto.nombre}`, ...g.alertas.map((a) => `  [${a.prioridad}] ${a.nombres || a.clave}: ${a.titulo}\n      → ${a.accion}`), '']),
    `Ver en la aplicación: ${urlAplicacion}`, '', pie].join('\n');
  const color = { ALTA: '#b42318', MEDIA: '#b54708', BAJA: '#475467' };
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1d2939;max-width:720px">
  <p>${esc(saludo)}</p><p><b>${esc(resumen)}</b></p>
  ${grupos.map((g) => `<h3 style="font-size:15px;margin:18px 0 6px;color:#14532d">${esc(g.proyecto.codigo)} · ${esc(g.proyecto.nombre)}</h3>
  <table cellpadding="6" style="border-collapse:collapse;width:100%">${g.alertas.map((a) => `<tr style="border-top:1px solid #eaecf0">
    <td style="white-space:nowrap;vertical-align:top"><span style="color:${color[a.prioridad] || '#475467'};font-weight:600">${esc(a.prioridad)}</span></td>
    <td style="vertical-align:top"><b>${esc(a.nombres || a.clave)}</b>: ${esc(a.titulo)}<br><span style="color:#475467">${esc(a.detalle || '')}</span><br>→ ${esc(a.accion)}</td></tr>`).join('')}</table>`).join('')}
  <p style="margin-top:20px"><a href="${esc(urlAplicacion)}" style="color:#14532d">Abrir la aplicación de seguimiento</a></p>
  <p style="color:#667085;font-size:12px">${esc(pie)}</p></div>`;
  return { texto, html, total, altas };
}

/**
 * @param datos     foto de la base (proyectos, consultores)
 * @param estado    construirEstado(datos, { corte }) sin filtro de proyecto
 * @param usuarios  cuentas (correo, nombre, rol, activo, usuario_id)
 * @param miembros  equipos activos (proyecto_id, usuario_id)
 * @returns [{ para, nombre, rol, asunto, texto, html, total, altas, proyectos }]
 */
function construirCorreos({ datos, estado, usuarios = [], miembros = [], urlAplicacion = '', copiaAdmin = true }) {
  const corte = estado.corte;
  const pie = 'Correo automático del Seguimiento de Proyectos de la OTI – SERFOR. Las alertas se calculan cada día; para dejar de recibirlas, pida al Administrador que lo retire del equipo del proyecto.';
  const asunto = (n, altas) => `Alertas de seguimiento del ${ff(corte)}: ${n} pendiente(s)${altas ? `, ${altas} alta(s)` : ''}`;
  const correos = [];
  for (const u of usuarios.filter((x) => vivo(x) && x.correo && x.rol === 'JEFE_PROYECTO')) {
    const ids = new Set(miembros.filter((m) => vivo(m) && m.usuario_id === u.usuario_id).map((m) => m.proyecto_id));
    if (!ids.size) continue;
    const grupos = alertasPorProyecto(datos, estado, ids);
    if (!grupos.length) continue;
    const c = cuerpo({ saludo: `Estimado(a) ${u.nombre || u.correo}: estas son las alertas de los proyectos de su equipo.`, grupos, corte, urlAplicacion, pie });
    correos.push({ para: u.correo, nombre: u.nombre, rol: u.rol, asunto: asunto(c.total, c.altas), texto: c.texto, html: c.html, total: c.total, altas: c.altas, proyectos: grupos.map((g) => g.proyecto.codigo) });
  }
  if (copiaAdmin) {
    const grupos = alertasPorProyecto(datos, estado);
    if (grupos.length) {
      for (const u of usuarios.filter((x) => vivo(x) && x.correo && x.rol === 'ADMIN')) {
        const c = cuerpo({ saludo: `Estimado(a) ${u.nombre || u.correo}: resumen de las alertas de todos los proyectos en curso.`, grupos, corte, urlAplicacion, pie });
        correos.push({ para: u.correo, nombre: u.nombre, rol: u.rol, asunto: `[Resumen OTI] ${asunto(c.total, c.altas)}`, texto: c.texto, html: c.html, total: c.total, altas: c.altas, proyectos: grupos.map((g) => g.proyecto.codigo) });
      }
    }
  }
  return correos;
}

module.exports = { construirCorreos, alertasPorProyecto, CODIGOS };
