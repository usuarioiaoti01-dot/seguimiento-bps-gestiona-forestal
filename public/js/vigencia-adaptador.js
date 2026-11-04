// Adaptador: estado del servidor (/api/estado) → contrato ContratoVigencia del componente VigenciaTimeline.
// El servidor calcula el término probable (regla 6); aquí solo se transforman y validan los datos.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Devuelve 'AAAA-MM-DD' (acepta también fechas-hora ISO) o null si no hay valor. Lanza error si la fecha es inválida. */
function fechaIso(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const s = String(valor).slice(0, 10);
  if (!ISO.test(s)) throw new Error(`fecha inválida: ${JSON.stringify(valor)}`);
  const [a, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  if (t.getUTCFullYear() !== a || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) throw new Error(`fecha inexistente: ${s}`);
  return s;
}

/**
 * "Nombre y primer apellido" a partir de `nombres` (formato "Nombre ApellidoPaterno [ApellidoMaterno]").
 * Con cuatro o más palabras se asume "Nombre Nombre ApellidoPaterno ApellidoMaterno" y se toma el primer nombre
 * y el primer apellido. No contempla apellidos compuestos con partículas ("De la Cruz").
 */
export function nombreCorto(nombres) {
  const t = String(nombres || '').trim().split(/\s+/).filter(Boolean);
  if (t.length <= 3) return t.slice(0, 2).join(' ');
  return `${t[0]} ${t[t.length - 2]}`;
}

/**
 * @param {Array} consultores  `consultores` de GET /api/estado
 * @returns {{ datos: Array, descartados: Array<{clave: string, motivo: string}>, consultorPorId: Object }}
 *   datos: filas ContratoVigencia válidas; descartados: profesionales que no se grafican (con el motivo);
 *   consultorPorId: clave → consultor_id (para abrir la ficha al pulsar una fila).
 */
export function adaptarVigencias(consultores) {
  const datos = [];
  const descartados = [];
  const consultorPorId = {};
  for (const c of consultores || []) {
    try {
      const v = c.vigencia || {};
      if (!v.adenda_vigente) throw new Error('sin adenda vigente registrada');
      const inicio = fechaIso(v.adenda_vigente.fecha_inicio);
      const fin = fechaIso(v.fin_vigencia);
      if (!inicio || !fin) throw new Error('falta el inicio o el fin de la vigencia');
      if (fin < inicio) throw new Error('el fin de la vigencia es anterior a su inicio');
      const potencial = v.adenda_siguiente ? fechaIso(v.fin_vigencia_potencial) : null;
      datos.push({
        id: String(c.clave),
        descripcion: c.nombres || '',
        etiqueta: nombreCorto(c.nombres) || String(c.clave), // nombre que se ve en la fila del gráfico
        inicio,
        fin,
        adenda: potencial && potencial > fin ? potencial : null, // solo si la adenda en trámite amplía la vigencia
        terminoProbable: fechaIso(c.pronostico && c.pronostico.fin_probable),
        // historial: adendas concluidas (gris), días sin cobertura (rojo) y superposiciones (inconsistencia)
        historial: (c.historial_adendas || []).map((h) => ({ numero: h.numero, inicio: fechaIso(h.fecha_inicio), fin: fechaIso(h.fecha_fin), plazoDias: h.plazo_dias ?? null, plazoSolicitadoDias: h.plazo_solicitado_dias ?? null })),
        brechas: ((c.cobertura && c.cobertura.brechas) || []).map((t) => ({ inicio: fechaIso(t.desde), fin: fechaIso(t.hasta), dias: t.dias })),
        superposiciones: ((c.cobertura && c.cobertura.superposiciones) || []).map((t) => ({ inicio: fechaIso(t.desde), fin: fechaIso(t.hasta), dias: t.dias })),
      });
      consultorPorId[String(c.clave)] = c.consultor_id;
    } catch (err) {
      descartados.push({ clave: String(c && c.clave), motivo: err.message });
    }
  }
  if (descartados.length) console.warn(`[vigencias] ${descartados.length} profesional(es) no se grafican:`, descartados);
  return { datos, descartados, consultorPorId };
}
