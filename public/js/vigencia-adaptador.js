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

/** Estados en que el entregable ya fue presentado (aunque espere conformidad o tenga observaciones). */
export const PRESENTADOS = ['PRESENTADO', 'EN_REVISION', 'OBSERVADO', 'SUBSANADO', 'CONFORME'];

/**
 * Avance (%) según los entregables presentados: la suma de su % de pago si todos lo tienen; si no, la proporción
 * de entregables presentados. null si no hay entregables.
 */
export function avanceEntregables(lista) {
  const vivos = (lista || []).filter((x) => x.estado !== 'ANULADO');
  if (!vivos.length) return null;
  const pres = vivos.filter((x) => PRESENTADOS.includes(x.estado));
  const conPct = vivos.every((x) => x.porcentaje_pago !== null && x.porcentaje_pago !== undefined && x.porcentaje_pago !== '');
  const total = conPct ? vivos.reduce((s, x) => s + Number(x.porcentaje_pago), 0) : 0;
  const v = conPct && total > 0 ? (pres.reduce((s, x) => s + Number(x.porcentaje_pago), 0) / total) * 100 : (pres.length / vivos.length) * 100;
  return Math.round(v);
}

/** Término de una Orden de Servicio (sin plan): la fecha límite de su último entregable o, si no la hay, el fin de la OS. */
function terminoDeOS(c, fin) {
  if (!c.estado_contratacion) return null; // contrato con adendas (GF2026): sin plan no hay término
  const limites = ((c.entregables && c.entregables.lista) || []).filter((x) => x.estado !== 'ANULADO' && x.fecha_limite).map((x) => fechaIso(x.fecha_limite)).sort();
  return limites[limites.length - 1] || fin;
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
        // Con plan aprobado, su término probable; en una Orden de Servicio sin plan, el término es el que fija la OS:
        // la fecha límite de su último entregable (o el fin de la OS), no «sin término probable»
        terminoProbable: fechaIso(c.pronostico && c.pronostico.fin_probable) || terminoDeOS(c, fin),
        // historial: adendas concluidas (gris), días sin cobertura (rojo) y superposiciones (inconsistencia)
        historial: (c.historial_adendas || []).map((h) => ({ numero: h.numero, inicio: fechaIso(h.fecha_inicio), fin: fechaIso(h.fecha_fin), plazoDias: h.plazo_dias ?? null, plazoSolicitadoDias: h.plazo_solicitado_dias ?? null })),
        brechas: ((c.cobertura && c.cobertura.brechas) || []).map((t) => ({ inicio: fechaIso(t.desde), fin: fechaIso(t.hasta), dias: t.dias })),
        superposiciones: ((c.cobertura && c.cobertura.superposiciones) || []).map((t) => ({ inicio: fechaIso(t.desde), fin: fechaIso(t.hasta), dias: t.dias })),
        // entregables de la Orden de Servicio vigente (marcas en su fecha límite y avance por los presentados)
        entregables: ((c.entregables && c.entregables.lista) || []).filter((x) => x.estado !== 'ANULADO').map((x) => ({
          numero: x.numero, nombre: x.nombre, fechaLimite: fechaIso(x.fecha_limite), fechaPresentacion: fechaIso(x.fecha_presentacion),
          presentado: PRESENTADOS.includes(x.estado), conforme: x.estado === 'CONFORME', vencido: !!x.vencido,
        })),
        avance: avanceEntregables(c.entregables && c.entregables.lista),
      });
      consultorPorId[String(c.clave)] = c.consultor_id;
    } catch (err) {
      descartados.push({ clave: String(c && c.clave), motivo: err.message });
    }
  }
  if (descartados.length) console.warn(`[vigencias] ${descartados.length} profesional(es) no se grafican:`, descartados);
  return { datos, descartados, consultorPorId };
}
