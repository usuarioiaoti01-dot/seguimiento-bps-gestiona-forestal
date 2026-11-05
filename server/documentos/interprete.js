'use strict';
/**
 * Interpreta el contenido de un documento (tablas leídas de Excel/CSV/MS Project, o filas extraídas por el
 * asistente de IA) y lo convierte en una lista de CAMBIOS propuestos sobre los datos vigentes: qué registro,
 * qué campos y su valor anterior y nuevo. Es una función pura: no escribe nada; la aplicación (con la
 * confirmación del usuario) la hace server/documentos/index.js por los mismos servicios de siempre.
 *
 * Entrada canónica (`filas`): { actividades: [...], adendas: [...], planes: [...] } con las claves que fija
 * la plantilla; `tablasAFilas` convierte las hojas leídas (con encabezados libres) a esa forma.
 */
const { aDia, aFecha: diaAIso } = require('../motor/calendario');

const ESTADOS_ACTIVIDAD = { pendiente: 'PENDIENTE', 'en curso': 'EN_CURSO', concluida: 'CONCLUIDA', concluido: 'CONCLUIDA', terminada: 'CONCLUIDA', terminado: 'CONCLUIDA', completada: 'CONCLUIDA', completado: 'CONCLUIDA', suspendida: 'SUSPENDIDA', suspendido: 'SUSPENDIDA' };
const ESTADOS_ADENDA = { anunciada: 'ANUNCIADA', 'en tramite': 'EN_TRAMITE', tramite: 'EN_TRAMITE', firmada: 'FIRMADA', anulada: 'ANULADA', concluida: 'CONCLUIDA' };
const ESTADOS_PLAN = { 'por registrar': 'POR_REGISTRAR', recibido: 'RECIBIDO', observado: 'OBSERVADO', aprobado: 'APROBADO' };
const CLASIFICACIONES = { alineada: 'ALINEADA', reasignada: 'REASIGNADA', nueva: 'NUEVA', transversal: 'TRANSVERSAL' };

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
const vacio = (v) => v === null || v === undefined || String(v).trim() === '';

/** Encabezados aceptados (ya normalizados) para cada campo canónico. */
const SINONIMOS = {
  clave: ['clave', 'profesional', 'consultor', 'codigo', 'cod'],
  numero: ['numero', 'n', 'nro', 'no', 'id', 'wbs', 'edt', 'item', 'numero de actividad', 'n actividad', 'esquema'],
  descripcion: ['descripcion', 'actividad', 'tarea', 'nombre', 'nombre de tarea', 'nombre de la tarea', 'task name', 'name'],
  avance: ['avance', '% avance', '% completado', '% completo', 'porcentaje de avance', 'porcentaje completado', 'percent complete', '% complete', 'avance %'],
  estado: ['estado', 'situacion'],
  inicio_plan: ['inicio plan', 'inicio planificado', 'inicio', 'comienzo', 'fecha de inicio', 'fecha inicio', 'start'],
  fin_plan: ['fin plan', 'fin planificado', 'fin', 'termino', 'fecha de fin', 'fecha fin', 'fecha de termino', 'finish'],
  inicio_real: ['inicio real', 'comienzo real'],
  fin_real: ['fin real', 'termino real'],
  evidencia: ['evidencia'],
  observacion: ['observacion', 'observaciones'],
  clasificacion: ['clasificacion'],
  contrato: ['contrato', 'n contrato', 'numero de contrato'],
  inicio: ['inicio adenda', 'inicio de la adenda', 'inicio'],
  fin: ['fin adenda', 'fin de la adenda', 'fin'],
  plazo_dias: ['plazo dias', 'plazo otorgado', 'plazo otorgado dias', 'plazo'],
  plazo_solicitado_dias: ['plazo solicitado', 'plazo solicitado dias', 'dias solicitados'],
  fecha_suscripcion: ['fecha de suscripcion', 'fecha suscripcion', 'suscripcion'],
  documento: ['documento', 'documento ref', 'referencia'],
  expediente: ['expediente'],
  fecha_recepcion: ['fecha de recepcion', 'fecha recepcion', 'recepcion'],
};

function aFecha(v) {
  if (vacio(v)) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  let a; let mes; let d;
  if (m) [, a, mes, d] = m;
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [, d, mes, a] = m;
  else return undefined;
  const t = new Date(Date.UTC(+a, +mes - 1, +d));
  if (t.getUTCFullYear() !== +a || t.getUTCMonth() !== +mes - 1 || t.getUTCDate() !== +d) return undefined;
  return t.toISOString().slice(0, 10);
}
function aNumero(v) {
  if (vacio(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const s = String(v).trim().replace('%', '').replace(',', '.').trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : undefined;
}
const aEnum = (v, mapa) => (vacio(v) ? null : (mapa[norm(v)] ?? undefined));

/** Localiza la fila de encabezados (la primera, entre las 10 primeras, con al menos 2 encabezados conocidos). */
function encontrarEncabezados(filas) {
  const todos = new Set(Object.values(SINONIMOS).flat());
  for (let i = 0; i < Math.min(10, filas.length); i += 1) {
    const reconocidos = filas[i].filter((c) => todos.has(norm(c))).length;
    if (reconocidos >= 2) return i;
  }
  return -1;
}

/** Asigna cada columna a su campo canónico; `permitidos` limita los campos que admite el tipo de hoja. */
function mapaColumnas(encabezados, permitidos) {
  const mapa = {};
  encabezados.forEach((c, i) => {
    const n = norm(c);
    if (!n) return;
    const campo = permitidos.find((f) => SINONIMOS[f].includes(n) && !(f in mapa));
    if (campo) mapa[campo] = i;
  });
  return mapa;
}

const CAMPOS_ACTIVIDADES = ['clave', 'numero', 'descripcion', 'avance', 'estado', 'inicio_plan', 'fin_plan', 'inicio_real', 'fin_real', 'evidencia', 'observacion', 'clasificacion'];
const CAMPOS_ADENDAS = ['contrato', 'numero', 'estado', 'inicio', 'fin', 'plazo_dias', 'plazo_solicitado_dias', 'fecha_suscripcion', 'documento', 'expediente', 'observacion'];
const CAMPOS_PLANES = ['clave', 'estado', 'observacion', 'fecha_recepcion'];

/**
 * Convierte hojas ({ nombre, filas: [[celdas]] }) en filas canónicas. Reconoce el tipo de cada hoja por su nombre
 * o por sus encabezados: Actividades, Adendas, Planes o un cronograma sin columna de profesional (MS Project).
 */
function tablasAFilas(hojas, { clave = null } = {}) {
  const salida = { actividades: [], adendas: [], planes: [] };
  const rechazadas = []; const hojasLeidas = [];
  for (const h of hojas) {
    const nombre = norm(h.nombre);
    if (['instrucciones', 'leeme', 'ayuda'].includes(nombre)) continue;
    const ie = encontrarEncabezados(h.filas);
    if (ie < 0) { if (h.filas.length) rechazadas.push({ hoja: h.nombre, fila: null, motivo: 'No se reconocieron los encabezados de la hoja' }); continue; }
    const enc = h.filas[ie];
    const cols = (permitidos) => mapaColumnas(enc, permitidos);
    let tipo; let mapa;
    const mAd = cols(CAMPOS_ADENDAS); const mAc = cols(CAMPOS_ACTIVIDADES); const mPl = cols(CAMPOS_PLANES);
    if ('contrato' in mAd && 'numero' in mAd) { tipo = 'adendas'; mapa = mAd; }
    else if ('clave' in mAc && 'numero' in mAc) { tipo = 'actividades'; mapa = mAc; }
    else if ('clave' in mPl && 'estado' in mPl && !('numero' in mAc)) { tipo = 'planes'; mapa = mPl; }
    else if ('numero' in mAc && ('descripcion' in mAc || 'avance' in mAc) && ['inicio_plan', 'fin_plan', 'avance'].some((c) => c in mAc)) { tipo = 'actividades'; mapa = mAc; } // cronograma de un solo profesional
    else { rechazadas.push({ hoja: h.nombre, fila: null, motivo: 'No se pudo determinar si la hoja trae actividades, adendas o planes' }); continue; }
    hojasLeidas.push({ hoja: h.nombre, tipo });
    for (let r = ie + 1; r < h.filas.length; r += 1) {
      const fila = h.filas[r];
      if (fila.every(vacio)) continue;
      const o = { __hoja: h.nombre, __fila: r + 1 };
      for (const [campo, i] of Object.entries(mapa)) o[campo] = fila[i];
      if (tipo === 'actividades' && vacio(o.clave)) o.clave = clave; // cronograma: el profesional lo elige el usuario
      salida[tipo].push(o);
    }
  }
  return { filas: salida, rechazadas, hojas: hojasLeidas };
}

/**
 * @param {{actividades:Array, adendas:Array, planes:Array}} filas  filas canónicas
 * @param {object} datos  `servicio.datos()`
 * @returns {{ cambios: Array, rechazadas: Array, sinCambios: number }}
 */
function interpretar(filas, datos) {
  const cambios = []; const rechazadas = []; let sinCambios = 0;
  const activo = (x) => x.activo !== 0 && x.activo !== false;
  const consultores = datos.consultores.filter(activo);
  const porClave = (c) => consultores.find((x) => String(x.clave).toUpperCase() === String(c).trim().toUpperCase());
  const planDe = (consultor) => datos.planes.filter((p) => activo(p) && p.consultor_id === consultor.consultor_id).sort((a, b) => b.plan_id - a.plan_id)[0];
  const vistos = new Set();
  const rechazar = (f, motivo) => rechazadas.push({ hoja: f.__hoja || null, fila: f.__fila || null, motivo });
  const registrar = (f, c) => {
    const clave = `${c.entidad}:${c.registro_id ?? 'nuevo'}:${c.etiqueta}`;
    if (vistos.has(clave)) { rechazar(f, `Repetida en el documento: ${c.etiqueta} (se usa la primera fila)`); return; }
    vistos.add(clave);
    c.id = `c${cambios.length + 1}`; c.hoja = f.__hoja || null; c.fila = f.__fila || null;
    cambios.push(c);
  };
  /** Compara los valores nuevos con los vigentes y devuelve solo lo que cambia. */
  const diferencias = (actual, nuevos, formato = (x) => x) => {
    const diffs = [];
    for (const [campo, valor] of Object.entries(nuevos)) {
      if (valor === null || valor === undefined) continue;
      const antes = actual ? formato(actual[campo]) : null;
      const igual = antes === valor || (typeof valor === 'number' && Number(antes) === valor) || (typeof valor === 'string' && String(antes ?? '').slice(0, 10) === valor && /^\d{4}-\d{2}-\d{2}$/.test(valor));
      if (!igual) diffs.push({ campo, antes: antes ?? null, despues: valor });
    }
    return diffs;
  };

  // ---------------------------------------------------------------- actividades
  for (const f of filas.actividades || []) {
    if (vacio(f.clave)) { rechazar(f, 'Falta el profesional (columna «clave» o selección en pantalla)'); continue; }
    const c = porClave(f.clave);
    if (!c) { rechazar(f, `No existe el profesional «${f.clave}»`); continue; }
    const plan = planDe(c);
    if (!plan) { rechazar(f, `${c.clave} no tiene plan de trabajo`); continue; }
    if (vacio(f.numero)) { rechazar(f, 'Falta el N.° de la actividad'); continue; }
    const numero = String(f.numero).trim().replace(/\.0+$/, '');
    const v = {}; let error = null;
    const fecha = (campo) => { const x = aFecha(f[campo]); if (x === undefined) error = `${campo}: fecha no válida «${f[campo]}»`; else v[campo] = x; };
    for (const campo of ['inicio_plan', 'fin_plan', 'inicio_real', 'fin_real']) fecha(campo);
    if (!vacio(f.avance)) { const a = aNumero(f.avance); if (a === undefined || a < 0 || a > 100) error = `avance: debe estar entre 0 y 100 («${f.avance}»)`; else v.avance = Math.round(a * 100) / 100; }
    if (!vacio(f.estado)) { const e = aEnum(f.estado, ESTADOS_ACTIVIDAD); if (!e) error = `estado no válido «${f.estado}»`; else v.estado = e; }
    if (!vacio(f.clasificacion)) { const e = aEnum(f.clasificacion, CLASIFICACIONES); if (!e) error = `clasificación no válida «${f.clasificacion}»`; else v.clasificacion = e; }
    for (const campo of ['descripcion', 'evidencia', 'observacion']) if (!vacio(f[campo])) v[campo] = String(f[campo]).trim();
    if (error) { rechazar(f, error); continue; }
    const actual = datos.actividades.find((a) => a.plan_id === plan.plan_id && activo(a) && String(a.numero).trim() === numero);
    const etiqueta = `${c.clave} · ${numero}`;
    if (actual) {
      if (actual.es_resumen) { rechazar(f, `${etiqueta} es una actividad resumen: se calcula sola`); continue; }
      if (actual.estado === 'ANULADA') { rechazar(f, `${etiqueta} está anulada`); continue; }
      delete v.descripcion; // el texto de una actividad existente no se reescribe desde un documento
      const diffs = diferencias(actual, v);
      if (!diffs.length) { sinCambios += 1; continue; }
      const reprograma = diffs.some((d) => d.campo === 'inicio_plan' || d.campo === 'fin_plan');
      registrar(f, { entidad: 'actividad', accion: 'MODIFICAR', etiqueta, descripcion: actual.descripcion, registro_id: actual.actividad_id, revision: actual.revision, clave: c.clave,
        diffs, campos: Object.fromEntries(diffs.map((d) => [d.campo, d.despues])), advertencias: reprograma ? ['Reprograma las fechas del plan'] : [] });
    } else {
      const faltan = ['descripcion', 'inicio_plan', 'fin_plan'].filter((k) => !v[k]);
      if (faltan.length) { rechazar(f, `La actividad ${etiqueta} no existe y para crearla faltan: ${faltan.join(', ')}`); continue; }
      if (v.fin_plan < v.inicio_plan) { rechazar(f, `${etiqueta}: el fin del plan es anterior al inicio`); continue; }
      registrar(f, { entidad: 'actividad', accion: 'CREAR', etiqueta, descripcion: v.descripcion, registro_id: null, plan_id: plan.plan_id, clave: c.clave,
        diffs: Object.entries(v).map(([campo, despues]) => ({ campo, antes: null, despues })), campos: { numero, clasificacion: 'NUEVA', ...v },
        advertencias: ['Actividad nueva (fuera de línea base): exigirá su Acta de Control de Cambios'] });
    }
  }

  // ---------------------------------------------------------------- adendas
  for (const f of filas.adendas || []) {
    if (vacio(f.contrato) || vacio(f.numero)) { rechazar(f, 'Faltan el contrato y el N.° de adenda'); continue; }
    const texto = String(f.contrato).trim();
    const contratos = buscarContratos(texto, datos);
    if (contratos.length !== 1) { rechazar(f, contratos.length ? `El contrato «${texto}» es ambiguo` : `No existe el contrato «${texto}»`); continue; }
    const k = contratos[0];
    const n = aNumero(f.numero);
    if (n === undefined || n === null || !Number.isInteger(n) || n < 1) { rechazar(f, `N.° de adenda no válido «${f.numero}»`); continue; }
    const v = {}; let error = null;
    for (const [campo, destino] of [['inicio', 'fecha_inicio'], ['fin', 'fecha_fin'], ['fecha_suscripcion', 'fecha_suscripcion']]) {
      const x = aFecha(f[campo]); if (x === undefined) error = `${campo}: fecha no válida «${f[campo]}»`; else if (x) v[destino] = x;
    }
    for (const campo of ['plazo_dias', 'plazo_solicitado_dias']) {
      if (vacio(f[campo])) continue;
      const x = aNumero(f[campo]); if (x === undefined || !Number.isInteger(x) || x < 1) error = `${campo}: debe ser un número entero de días («${f[campo]}»)`; else v[campo] = x;
    }
    if (!vacio(f.estado)) { const e = aEnum(f.estado, ESTADOS_ADENDA); if (!e) error = `estado no válido «${f.estado}»`; else v.estado = e; }
    const recortes = []; // el modelo puede devolver el título completo del documento: se ajusta al largo de la columna
    for (const [campo, destino, max, nombre] of [['documento', 'documento_ref', 300, 'La referencia del documento'], ['expediente', 'expediente', 40, 'El expediente'], ['observacion', 'observacion', 1000, 'La observación']]) {
      if (vacio(f[campo])) continue;
      const t = String(f[campo]).trim();
      v[destino] = t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
      if (t.length > max) recortes.push(`${nombre} se recortó a ${max} caracteres`);
    }
    if (error) { rechazar(f, error); continue; }
    const actual = datos.adendas.find((a) => a.contrato_id === k.contrato_id && Number(a.numero) === n && activo(a));
    const etiqueta = `${k.numero.slice(0, 3)} · Adenda ${String(n).padStart(2, '0')}`;
    const consultor = datos.consultores.find((c) => c.consultor_id === k.consultor_id);
    if (actual) {
      const diffs = diferencias(actual, v);
      if (!diffs.length) { sinCambios += 1; continue; }
      const fin = v.fecha_fin || String(actual.fecha_fin).slice(0, 10); const ini = v.fecha_inicio || String(actual.fecha_inicio).slice(0, 10);
      if (fin < ini) { rechazar(f, `${etiqueta}: el fin es anterior al inicio`); continue; }
      registrar(f, { entidad: 'adenda', accion: 'MODIFICAR', etiqueta, descripcion: consultor ? consultor.nombres : '', registro_id: actual.adenda_id, revision: actual.revision, clave: consultor && consultor.clave,
        diffs, campos: Object.fromEntries(diffs.map((d) => [d.campo, d.despues])), advertencias: recortes });
    } else {
      if (!v.fecha_inicio || !v.fecha_fin) { rechazar(f, `La adenda ${etiqueta} no existe y para crearla faltan el inicio y el fin`); continue; }
      if (v.fecha_fin < v.fecha_inicio) { rechazar(f, `${etiqueta}: el fin es anterior al inicio`); continue; }
      registrar(f, { entidad: 'adenda', accion: 'CREAR', etiqueta, descripcion: consultor ? consultor.nombres : '', registro_id: null, contrato_id: k.contrato_id, clave: consultor && consultor.clave,
        diffs: Object.entries(v).map(([campo, despues]) => ({ campo, antes: null, despues })), campos: { numero: n, ...v },
        advertencias: [...recortes, ...(v.estado === 'FIRMADA' && !v.documento_ref ? ['Una adenda FIRMADA requiere la referencia del documento'] : [])] });
    }
  }

  // ---------------------------------------------------------------- planes
  for (const f of filas.planes || []) {
    if (vacio(f.clave)) { rechazar(f, 'Falta el profesional'); continue; }
    const c = porClave(f.clave);
    if (!c) { rechazar(f, `No existe el profesional «${f.clave}»`); continue; }
    const plan = planDe(c);
    if (!plan) { rechazar(f, `${c.clave} no tiene plan de trabajo`); continue; }
    const v = {}; let error = null;
    if (!vacio(f.estado)) { const e = aEnum(f.estado, ESTADOS_PLAN); if (!e) error = `estado del plan no válido «${f.estado}»`; else v.estado = e; }
    const fr = aFecha(f.fecha_recepcion); if (fr === undefined) error = `fecha_recepcion no válida «${f.fecha_recepcion}»`; else if (fr) v.fecha_recepcion = fr;
    if (!vacio(f.observacion)) v.observacion = String(f.observacion).trim();
    if (error) { rechazar(f, error); continue; }
    const diffs = diferencias(plan, v);
    if (!diffs.length) { sinCambios += 1; continue; }
    registrar(f, { entidad: 'plan_trabajo', accion: 'MODIFICAR', etiqueta: `${c.clave} · Plan`, descripcion: plan.nombre, registro_id: plan.plan_id, revision: plan.revision, clave: c.clave,
      diffs, campos: Object.fromEntries(diffs.map((d) => [d.campo, d.despues])), advertencias: [] });
  }
  return { cambios, rechazadas, sinCambios };
}

/** Contratos activos que corresponden al texto: número completo, su prefijo o sus 3 primeros dígitos (p. ej. «035»). */
function buscarContratos(texto, datos) {
  const t = String(texto).trim();
  return datos.contratos.filter((k) => k.activo !== 0 && k.activo !== false && (k.numero === t || k.numero.startsWith(`${t}-`) || (/^\d{1,3}$/.test(t) && k.numero.startsWith(`${t.padStart(3, '0')}-`))));
}

const COBERTURAN = new Set(['FIRMADA', 'CONCLUIDA']); // mismas adendas que cuentan para la cobertura (motor/cobertura.js)
const dosDigitos = (n) => String(n).padStart(2, '0');
const ddmmaaaa = (s) => String(s).slice(0, 10).split('-').reverse().join('/');

/**
 * Documento de UNA adenda (PDF/Word leído por el asistente, o la hoja «Adendas»): igual que `interpretar` pero solo
 * para adendas y con ayudas propias de este flujo:
 *  - sin contrato en el documento, usa el único contrato del profesional elegido en pantalla;
 *  - sin fechas pero con plazo otorgado, calcula el inicio (día siguiente al fin de la última adenda firmada o
 *    concluida) y el fin (inicio + plazo − 1), y lo advierte; el inicio calculado queda marcado (`inicio_calculado`);
 *  - una adenda nueva nace EN_TRAMITE (el usuario puede elegir otro estado en la vista previa; solo FIRMADA amplía la vigencia);
 *  - advierte numeración saltada, plazo distinto de las fechas, días sin cobertura y superposiciones;
 *  - si se eligió un profesional, rechaza el contrato que no sea suyo.
 * Cada cambio lleva `vigente` (estado, documento y suscripción actuales) para que la pantalla los muestre y permita ajustarlos.
 */
function interpretarAdendas(filas, datos, { clave = null } = {}) {
  const activo = (x) => x.activo !== 0 && x.activo !== false;
  const elegido = clave ? datos.consultores.filter(activo).find((c) => String(c.clave).toUpperCase() === String(clave).trim().toUpperCase()) : null;
  const propias = (contratoId) => datos.adendas.filter((a) => a.contrato_id === contratoId && activo(a));

  const preparadas = (filas.adendas || []).map((f) => {
    const g = { ...f, __calculado: [] };
    if (vacio(g.contrato) && elegido) {
      const suyos = datos.contratos.filter((k) => activo(k) && k.consultor_id === elegido.consultor_id);
      if (suyos.length === 1) g.contrato = suyos[0].numero;
    }
    const ks = vacio(g.contrato) ? [] : buscarContratos(g.contrato, datos);
    const n = aNumero(g.numero); const plazo = aNumero(g.plazo_dias);
    if (ks.length !== 1 || !Number.isInteger(n) || !Number.isInteger(plazo) || plazo < 1) return g;
    if (propias(ks[0].contrato_id).some((a) => Number(a.numero) === n)) return g; // ya existe: se compara tal cual
    let inicio = aFecha(g.inicio);
    if (inicio === null) {
      const previas = propias(ks[0].contrato_id).filter((a) => COBERTURAN.has(a.estado) && a.fecha_fin && Number(a.numero) !== n);
      if (previas.length) {
        const tope = previas.reduce((m, a) => (aDia(a.fecha_fin) > aDia(m.fecha_fin) ? a : m));
        inicio = diaAIso(aDia(tope.fecha_fin) + 1);
        g.inicio = inicio;
        g.__calculado.push(`inicio: el día siguiente al fin de la Adenda ${dosDigitos(tope.numero)} (${ddmmaaaa(tope.fecha_fin)})`);
      }
    }
    if (inicio && vacio(g.fin)) { g.fin = diaAIso(aDia(inicio) + plazo - 1); g.__calculado.push('fin: inicio + plazo otorgado − 1'); }
    return g;
  });

  const r = interpretar({ actividades: [], planes: [], adendas: preparadas }, datos);
  const rechazadas = [...r.rechazadas];
  const cambios = [];
  for (const c of r.cambios) {
    if (elegido && c.clave && String(c.clave).toUpperCase() !== String(elegido.clave).toUpperCase()) {
      rechazadas.push({ hoja: c.hoja, fila: c.fila, motivo: `El contrato del documento corresponde a ${c.clave}, no al profesional elegido (${elegido.clave})` });
      continue;
    }
    cambios.push(c);
  }

  for (const c of cambios) {
    const origen = preparadas.find((p) => p.__fila === c.fila && p.__hoja === c.hoja) || {};
    const actual = c.registro_id ? datos.adendas.find((a) => a.adenda_id === c.registro_id) : null;
    const contratoId = actual ? actual.contrato_id : c.contrato_id;
    const dia10 = (x) => (x ? String(x).slice(0, 10) : null);
    c.vigente = actual ? { estado: actual.estado, documento_ref: actual.documento_ref ?? null, fecha_suscripcion: dia10(actual.fecha_suscripcion) } : {};
    if (c.accion === 'CREAR') {
      if (!c.campos.estado) { c.campos.estado = 'EN_TRAMITE'; c.diffs.unshift({ campo: 'estado', antes: null, despues: 'EN_TRAMITE' }); }
      if (origen.__calculado && origen.__calculado.some((t) => t.startsWith('inicio'))) c.campos.inicio_calculado = 1;
    }
    for (const t of origen.__calculado || []) c.advertencias.push(`Calculado — ${t}`);

    const numero = actual ? Number(actual.numero) : Number(c.campos.numero);
    const ini = dia10(c.campos.fecha_inicio) || dia10(actual && actual.fecha_inicio);
    const fin = dia10(c.campos.fecha_fin) || dia10(actual && actual.fecha_fin);
    const otras = propias(contratoId).filter((a) => Number(a.numero) !== numero);
    if (c.accion === 'CREAR' && otras.length) {
      const ultimo = Math.max(...otras.map((a) => Number(a.numero)));
      if (numero > ultimo + 1) c.advertencias.push(`Salta de la Adenda ${dosDigitos(ultimo)} a la ${dosDigitos(numero)}: ¿falta registrar alguna?`);
      else if (numero < ultimo) c.advertencias.push(`Ya hay adendas posteriores registradas (hasta la ${dosDigitos(ultimo)})`);
    }
    const plazo = c.campos.plazo_dias ?? (actual && actual.plazo_dias);
    if (plazo && ini && fin && !(origen.__calculado || []).length) {
      const dias = aDia(fin) - aDia(ini) + 1;
      if (dias !== Number(plazo)) c.advertencias.push(`El plazo indicado (${plazo} días) no coincide con las fechas del documento (${dias} días)`);
    }
    if (ini && fin) {
      const cubren = otras.filter((a) => COBERTURAN.has(a.estado) && a.fecha_inicio && a.fecha_fin);
      const antes = cubren.filter((a) => aDia(a.fecha_inicio) < aDia(ini));
      if (antes.length) {
        const prev = antes.reduce((m, a) => (aDia(a.fecha_fin) > aDia(m.fecha_fin) ? a : m));
        const hueco = aDia(ini) - aDia(prev.fecha_fin) - 1;
        if (hueco > 0) c.advertencias.push(`Quedan ${hueco} día(s) sin cobertura entre la Adenda ${dosDigitos(prev.numero)} (fin ${ddmmaaaa(prev.fecha_fin)}) y esta`);
        else if (hueco < 0) c.advertencias.push(`Se superpone ${-hueco} día(s) con la Adenda ${dosDigitos(prev.numero)} (fin ${ddmmaaaa(prev.fecha_fin)})`);
      }
      const despues = cubren.filter((a) => aDia(a.fecha_inicio) > aDia(ini)).sort((x, y) => aDia(x.fecha_inicio) - aDia(y.fecha_inicio))[0];
      if (despues) {
        const hueco = aDia(despues.fecha_inicio) - aDia(fin) - 1;
        if (hueco > 0) c.advertencias.push(`Quedan ${hueco} día(s) sin cobertura entre esta y la Adenda ${dosDigitos(despues.numero)} (inicio ${ddmmaaaa(despues.fecha_inicio)})`);
        else if (hueco < 0) c.advertencias.push(`Se superpone ${-hueco} día(s) con la Adenda ${dosDigitos(despues.numero)} (inicio ${ddmmaaaa(despues.fecha_inicio)})`);
      }
    }
  }
  return { cambios, rechazadas, sinCambios: r.sinCambios };
}

/** Quita lo que no debe llegar al modelo de IA (regla 8): DNI, teléfonos y correos. */
function redactarPersonales(texto) {
  let n = 0;
  const marca = () => { n += 1; return '[DATO PERSONAL OMITIDO]'; };
  const limpio = String(texto)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, marca)
    // un punto final («DNI 45678912.») no protege al número; sí lo protegen dígitos, «/» y «-» pegados (fechas, códigos) y «.» entre dígitos
    .replace(/(?<!\d|[/-]|\d\.)(\+?51[\s-]?)?9\d{2}[\s-]?\d{3}[\s-]?\d{3}(?!\d|[/-]|\.\d)/g, marca)
    .replace(/(?<!\d|[/-]|\d\.)\d{8}(?!\d|[/-]|\.\d)/g, marca);
  return { texto: limpio, omitidos: n };
}

module.exports = { norm, aFecha, aNumero, tablasAFilas, interpretar, interpretarAdendas, redactarPersonales, SINONIMOS };
