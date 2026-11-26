'use strict';
/**
 * Registro del proyecto a partir de sus documentos (Orden de Servicio y TDR).
 *
 * - leerDocumentos: lee los PDF temporales y propone nombre, objetivo, descripción, unidad usuaria, financiador y
 *   plazo. Con el asistente de IA (sin datos personales: redactarPersonales en el agente) y, si no está disponible o
 *   falla, leyendo el texto directamente (extraerDatosSinIA, función pura). No escribe nada: el usuario revisa.
 * - registrar / actualizar: el periodo se calcula con el inicio y el plazo (fin = inicio + plazo − 1, días
 *   calendario, como los plazos de la OS) y los PDF se guardan en el almacén como documentos del proyecto
 *   (la Orden de Servicio, confidencial). Toda validación del proyecto sigue en servicio.js.
 */
const { aDia, aFecha } = require('./motor/calendario');
const { validarEntregables } = require('./motor/plazos');

const error = (estado, mensaje, extra = {}) => Object.assign(new Error(mensaje), { estado, ...extra });
const PLAZO_MAX = 3650;
const DOCUMENTOS = [['TDR', 'los Términos de Referencia'], ['ORDEN_SERVICIO', 'la Orden de Servicio']];

// ---------------------------------------------------------------- lectura del texto sin IA (pura)
const limpiar = (s) => String(s || '').replace(/\s+/g, ' ').replace(/^[\s:.\-–—]+/, '').trim();
const recortar = (s, max) => { const t = limpiar(s); if (t.length <= max) return t; const c = t.slice(0, max); const p = Math.max(c.lastIndexOf('. '), c.lastIndexOf('; ')); return (p > max * 0.5 ? c.slice(0, p + 1) : c.slice(0, max - 1) + '…').trim(); };
// Encabezado de sección: línea numerada («3.», «3.1», «III.», «a)») o en mayúsculas
const ENCABEZADO = /\n\s*(?:(?:\d{1,2}(?:\.\d{1,2})*\.?|[IVX]{1,5}\.|[a-h]\))\s+[A-ZÁÉÍÓÚÑ][^\n]{2,90}|[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .,/()-]{5,90}:?)\s*\n/;

/** Texto que sigue a un encabezado (hasta el siguiente encabezado), o null. */
function seccion(texto, nombres) {
  const t = `\n${String(texto || '').replace(/\r/g, '')}\n`;
  for (const n of nombres) {
    const re = new RegExp(`\\n[\\s\\d.IVX)a-h-]*${n}[^\\n:]{0,40}:?[ \\t]*`, 'i');
    const m = re.exec(t);
    if (!m) continue;
    const resto = t.slice(m.index + m[0].length);
    const fin = ENCABEZADO.exec(resto.slice(1));
    const cuerpo = limpiar(fin ? resto.slice(0, fin.index + 1) : resto.slice(0, 1500));
    if (cuerpo.length >= 10) return cuerpo;
  }
  return null;
}

/** Plazo total en días calendario: «plazo de ejecución … noventa (90) días calendario». */
function plazoDe(texto) {
  const t = limpiar(texto);
  const re = /plazo[^.]{0,160}?\(?\b(\d{1,4})\b\)?\s*d[ií]as(?:\s+(calendario|calendarios|h[aá]biles))?/gi;
  let m;
  while ((m = re.exec(t))) {
    const n = Number(m[1]);
    if (n >= 1 && n <= PLAZO_MAX && !/h[aá]bil/i.test(m[2] || '')) return n;
  }
  return null;
}

/**
 * Propuesta de datos del proyecto leyendo el texto de la OS y del TDR, sin IA. Prefiere el TDR para el contenido
 * y la OS para el plazo (es el documento que obliga). Lo que no encuentra queda en null.
 */
function extraerDatosSinIA({ tdr = '', os = '' } = {}) {
  const ambos = `${tdr}\n${os}`;
  const nombre = seccion(tdr, ['denominaci[oó]n de la contrataci[oó]n', 'denominaci[oó]n del servicio', 'objeto de la contrataci[oó]n', 'objeto del servicio', 'nombre del servicio'])
    || seccion(os, ['descripci[oó]n del servicio', 'concepto', 'por el servicio de']);
  const objetivo = seccion(tdr, ['objetivo general', 'objetivo de la contrataci[oó]n', 'objetivos?', 'finalidad p[uú]blica', 'finalidad']);
  const descripcion = seccion(tdr, ['antecedentes', 'justificaci[oó]n', 'alcance del servicio', 'descripci[oó]n del servicio']);
  const unidad = seccion(tdr, ['[aá]rea usuaria', 'unidad usuaria', '[oó]rgano que requiere', 'dependencia que requiere', 'unidad org[aá]nica que requiere'])
    || seccion(os, ['[aá]rea usuaria', 'unidad usuaria', 'dependencia']);
  const financiador = seccion(ambos, ['fuente de financiamiento', 'financiamiento']);
  const numero = (/orden\s+de\s+servicio\s*(?:n[°ºo.]*|nro\.?|n[uú]mero)\s*:?\s*([A-Z0-9][\w./-]{2,40})/i.exec(os) || [])[1] || null;
  return {
    nombre: nombre ? recortar(nombre.split(/(?<=\.)\s/)[0], 300) : null,
    objetivo: objetivo ? recortar(objetivo, 1000) : null,
    descripcion: descripcion ? recortar(descripcion, 1000) : null,
    unidad_usuaria: unidad ? recortar(unidad.split(/(?<=\.)\s/)[0], 200) : null,
    financiador: financiador ? recortar(financiador.split(/(?<=\.)\s/)[0], 150) : null,
    plazo_dias: plazoDe(os) || plazoDe(tdr),
    numero_os: numero,
  };
}

// ---------------------------------------------------------------- Orden de Servicio del profesional (pura)
const sinCeros = (s) => (s && /^\d+$/.test(s) ? String(Number(s)) : s || null);

/** «24,000.00», «24.000,00», «24000» → 24000 (null si no es un monto). */
function aMonto(s) {
  let t = String(s || '').replace(/\s/g, '');
  if (!/\d/.test(t)) return null;
  const coma = t.lastIndexOf(','); const punto = t.lastIndexOf('.');
  if (coma >= 0 && punto >= 0) t = coma > punto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (coma >= 0) t = /,\d{2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (punto >= 0 && !/\.\d{1,2}$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n < 1e10 ? Math.round(n * 100) / 100 : null;
}

/** Monto total de la OS: el que acompaña a «TOTAL» o, si no hay, el mayor importe en soles. */
function montoDe(texto) {
  const t = String(texto || '');
  const total = /\btotal(?:\s+(?:general|a\s+pagar|s\/\.?))*[^\d\n]{0,20}((?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{2})?)/gi;
  const totales = [...t.matchAll(total)].map((m) => aMonto(m[1])).filter(Boolean);
  if (totales.length) return Math.max(...totales);
  const soles = [...t.matchAll(/(?:S\/\.?|PEN)\s*((?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{2})?)/gi)].map((m) => aMonto(m[1])).filter(Boolean);
  return soles.length ? Math.max(...soles) : null;
}

/** Oculta los importes antes de enviar el texto al asistente: el monto es confidencial y se lee sin IA. */
function quitarMontos(texto) {
  return String(texto || '')
    .replace(/(?:S\/\.?|PEN|US\$|\$)\s*(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{2})?/gi, '[MONTO]')
    .replace(/\b\d{1,3}(?:[.,]\d{3})+[.,]\d{2}\b(?!\s*%)/g, '[MONTO]');
}

const PARTICULAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'E', 'SAN', 'SANTA']);
/** Clave de 2 a 5 letras con las iniciales («JUAN JOSE ARAMBULO AQUIJES» → JJA) que no esté usada. */
function sugerirClave(nombres, existentes = []) {
  const usadas = new Set(existentes.map((c) => String(c || '').toUpperCase()));
  const palabras = String(nombres || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/[^A-ZÑ]+/).filter((p) => p && !PARTICULAS.has(p));
  if (palabras.length < 2) return null;
  const ini = palabras.map((p) => p[0]);
  const candidatas = [ini.slice(0, 3).join(''), ini.slice(0, 4).join(''), ini[0] + ini[2] + (ini[3] || ''), ini[0] + ini[1] + (palabras[2] || palabras[1]).slice(0, 2), ini.slice(0, 2).join('') + (palabras[3] || palabras[1]).slice(0, 2)];
  return candidatas.find((c) => c.length >= 2 && c.length <= 5 && /^[A-ZÑ]+$/.test(c) && !usadas.has(c)) || null;
}

const ORDINALES = { primer: 1, primero: 1, segundo: 2, tercer: 3, tercero: 3, cuarto: 4, quinto: 5, sexto: 6, septimo: 7, octavo: 8, noveno: 9, decimo: 10, unico: 1 };
/** Entregables con su plazo: «Primer entregable: plan de trabajo, hasta los 10 días calendario». */
function entregablesDe(texto) {
  const t = limpiar(texto);
  const re = /\b(primer|primero|segundo|tercer|tercero|cuarto|quinto|sexto|s[eé]ptimo|octavo|noveno|d[eé]cimo|[uú]nico)\s+(?:entregable|producto|informe)\b\s*[:\-–(]?\s*([^.;]{0,200}?)\s*,?\s*(?:hasta\s+(?:los\s+)?|a\s+los\s+|dentro\s+de\s+los\s+|en\s+un\s+plazo\s+(?:m[aá]ximo\s+)?de\s+)(?:[a-záéíóúñ]+\s+){0,3}\(?(\d{1,4})\)?\s*d[ií]as/gi;
  const lista = [];
  for (const m of t.matchAll(re)) {
    const n = ORDINALES[m[1].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()];
    const nombre = limpiar(m[2]).replace(/[,:\-–]+$/, '').trim();
    if (!lista.some((x) => x.numero === n)) lista.push({ numero: n, nombre: nombre ? recortar(nombre[0].toUpperCase() + nombre.slice(1), 300) : `Entregable ${n}`, plazo_dias: Number(m[3]) });
  }
  return lista.sort((a, b) => a.numero - b.numero);
}

const SIN_TILDES = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
/** Lo que sigue al nombre en la misma línea de la OS (otra columna u otro rótulo) y se debe cortar. */
const TRAS_NOMBRE = /\s+(?:R\.?\s?U\.?\s?C\.?|D\.?\s?N\.?\s?I\.?|Direcci[oó]n|Domicilio|Tel[eé]fono|Fax|CCI|C\.?C\.?I\.?|N[º°]|Nro\.?|Cuadro|Tipo\s+de|Moneda|Concepto|Fecha|Contrato|\d)(?=[\s.:º°]|$).*$/i;
const EMPRESA = /\b(?:S\.?\s?A\.?\s?C\.?|S\.?\s?R\.?\s?L\.?|E\.?\s?I\.?\s?R\.?\s?L\.?|S\.?\s?A\.?\s?A\.?|S\.?\s?A\.?|SOCIEDAD|EMPRESA|CONSORCIO|ASOCIACI[OÓ]N|CORPORACI[OÓ]N|COMPA[ÑN][IÍ]A|INC\.?|LTDA\.?)(?=\s|$)/i;
function nombreDeCelda(s) {
  const v = limpiar(String(s || '').split(/\s{2,}|\t/)[0].replace(TRAS_NOMBRE, '')).replace(/[\s,;:-]+$/, '');
  return /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ .'&-]{3,149}$/.test(v) && v.includes(' ') ? v.toUpperCase() : null;
}
/**
 * Persona contratada tal como figura en la Orden de Servicio: el campo «Señor(es)» del bloque «1. DATOS DEL PROVEEDOR»
 * (formato SIGA: APELLIDOS NOMBRES). Solo se lee de la OS; el TDR menciona a otras personas (área usuaria, firmas).
 */
function proveedorDeOS(os) {
  const t = String(os || '').replace(/\r/g, '');
  const i = t.search(/datos\s+del\s+proveedor/i);
  const zonas = i >= 0 ? [t.slice(i), t] : [t];
  const re = /(?:se[ñn]or\s*\(?\s*es\s*\)?|se[ñn]ores|proveedor|contratista|locador|nombre\s+o\s+raz[oó]n\s+social|raz[oó]n\s+social)[ \t]*:[ \t]*([^\n]*)(?:\n[ \t]*([^\n]*))?/gi;
  for (const z of zonas) {
    for (const m of z.matchAll(re)) {
      const v = nombreDeCelda(m[1]) || (!limpiar(m[1]) ? nombreDeCelda(m[2]) : null);
      if (v) return v;
    }
  }
  return null;
}
/** «ARAMBULO AQUIJES JUAN JOSE» → «JUAN JOSE ARAMBULO AQUIJES» (dos apellidos primero, como en la OS); una empresa no cambia. */
function ordenarNombre(nombre) {
  const v = limpiar(nombre).toUpperCase();
  if (!v || EMPRESA.test(v)) return v || null;
  const grupos = []; let acc = [];
  for (const p of v.split(' ')) { acc.push(p); if (!PARTICULAS.has(SIN_TILDES(p))) { grupos.push(acc.join(' ')); acc = []; } }
  if (acc.length) grupos.push(acc.join(' '));
  return grupos.length < 3 ? v : [...grupos.slice(2), ...grupos.slice(0, 2)].join(' ');
}
/** Mismas palabras en cualquier orden (sin tildes): la IA solo pudo reordenar el nombre de la OS. */
function mismaPersona(a, b) {
  const w = (x) => SIN_TILDES(x).split(/[^A-ZÑ]+/).filter(Boolean).sort().join(' ');
  return !!a && !!b && w(a) === w(b);
}

/**
 * Propuesta para «Registrar Orden de Servicio» leyendo el texto de la OS y del TDR, sin IA: número, expediente,
 * monto (solo aquí: nunca va al asistente), nombre del profesional, objeto, perfil, plazo y entregables.
 */
function extraerOrdenServicioSinIA({ os = '', tdr = '', claves = [] } = {}) {
  const o = String(os || '');
  const numero = (/orden\s+de\s+servicio\s*(?:n[°ºo.]*|nro\.?|n[uú]mero)?\s*:?\s*([0-9][\w-]{0,30})/i.exec(o) || [])[1] || null;
  const expediente = (/\bexp(?:ediente)?\.?\s*(?:siaf|siga|sgd)?\s*(?:n[°ºo.]*|nro\.?)?\s*:?\s*(\d{1,12})\b/i.exec(o) || [])[1] || null;
  const proveedor = proveedorDeOS(o);
  const nombres = proveedor ? ordenarNombre(proveedor) : null;
  const objeto = seccion(tdr, ['denominaci[oó]n de la contrataci[oó]n', 'denominaci[oó]n del servicio', 'objeto de la contrataci[oó]n', 'objeto del servicio'])
    || seccion(o, ['concepto', 'descripci[oó]n del servicio', 'por el servicio de']);
  const perfil = seccion(tdr, ['perfil del (?:profesional|proveedor|consultor|locador)', 'cargo']);
  return {
    nombres,
    clave: sugerirClave(nombres, claves),
    numero: sinCeros(numero),
    expediente: sinCeros(expediente),
    titulo_tdr: objeto ? recortar(objeto.split(/(?<=\.)\s/)[0], 300) : null,
    perfil: perfil && perfil.split(/(?<=\.)\s/)[0].length <= 120 ? limpiar(perfil.split(/(?<=\.)\s/)[0]).replace(/\.$/, '') : null,
    monto: montoDe(o),
    plazo_dias: plazoDe(o) || plazoDe(tdr),
    entregables: entregablesDe(tdr).length ? entregablesDe(tdr) : entregablesDe(o),
  };
}

/** fin = inicio + plazo − 1 (días calendario), o error si faltan datos. */
function finPorPlazo(inicio, plazo) {
  const n = Number(plazo);
  if (!Number.isInteger(n) || n < 1 || n > PLAZO_MAX) throw error(400, `El plazo va en días calendario, de 1 a ${PLAZO_MAX}`);
  if (!inicio || !/^\d{4}-\d{2}-\d{2}$/.test(String(inicio).slice(0, 10))) throw error(400, 'Indique la fecha de inicio para calcular el periodo con el plazo');
  return aFecha(aDia(String(inicio).slice(0, 10)) + n - 1);
}

function crearProyectos({ servicio, almacen, contrataciones, leerDocumento = null, extraerConIA = null }) {
  /** Toma los PDF temporales indicados ({ TDR, ORDEN_SERVICIO }); valida antes de escribir nada. */
  function tomar(documentos, ctx) {
    const d = documentos || {};
    return DOCUMENTOS.filter(([t]) => d[t]).map(([tipo, rotulo]) => ({ tipo, rotulo, token: d[tipo], archivo: contrataciones.tomarTemporal(d[tipo], ctx, rotulo) }));
  }

  /** Guarda los PDF en el almacén como documentos del proyecto; lo que falle se informa, el proyecto ya existe. */
  async function guardarDocumentos(proyecto_id, tomados, ctx) {
    const guardados = []; const pendientes = [];
    for (const x of tomados) {
      try {
        const f = await almacen.guardar({ tipo: x.tipo, entidad: 'proyecto', entidad_id: Number(proyecto_id), proyecto_id: Number(proyecto_id), buffer: x.archivo.buffer, nombre: x.archivo.nombre, confidencial: x.tipo === 'ORDEN_SERVICIO' }, { usuario: ctx.usuario, origen: ctx.origen });
        contrataciones.liberarTemporal(x.token);
        guardados.push({ documento_id: f.documento_id, tipo: f.tipo, nombre_original: f.nombre_original, version: f.version });
      } catch (e) { pendientes.push(`${x.rotulo[0].toUpperCase()}${x.rotulo.slice(1)}: ${e.message}`); }
    }
    return { guardados, pendientes };
  }

  function periodo(datos, previa = {}) {
    const f = { ...datos };
    if (f.plazo_dias !== undefined && f.plazo_dias !== null && f.plazo_dias !== '') {
      f.fecha_fin = finPorPlazo(f.fecha_inicio !== undefined ? f.fecha_inicio : previa.fecha_inicio, f.plazo_dias);
    }
    delete f.plazo_dias;
    return f;
  }

  /** Alta del proyecto con su periodo y sus documentos (TDR y OS). */
  async function registrar(entrada, ctx) {
    const { documentos, ...resto } = entrada || {};
    const datos = periodo(resto);
    const tomados = tomar(documentos, ctx);
    const p = await servicio.crearEntidad('proyecto', datos, ctx);
    const { guardados, pendientes } = await guardarDocumentos(p.proyecto_id, tomados, ctx);
    return { ...p, documentos: guardados, documentos_pendientes: pendientes };
  }

  /** Edición: si llega el plazo, el fin se vuelve a calcular con el inicio (el enviado o el registrado). */
  async function actualizar(id, entrada, ctx) {
    const { documentos, ...resto } = entrada || {};
    const d = await servicio.datos(true);
    const previa = d.proyectos.find((p) => p.proyecto_id === Number(id));
    if (!previa) throw error(404, 'Proyecto no encontrado');
    const tomados = tomar(documentos, ctx);
    const r = await servicio.actualizarEntidad('proyecto', id, periodo(resto, previa), ctx);
    const { guardados, pendientes } = await guardarDocumentos(previa.proyecto_id, tomados, ctx);
    const fila = (await servicio.datos(true)).proyectos.find((p) => p.proyecto_id === previa.proyecto_id) || {};
    return { ...r, ...fila, documentos: guardados, documentos_pendientes: pendientes };
  }

  /** Texto de cada PDF ({ os, tdr }) y advertencias de los que no tienen texto (escaneados). */
  async function leerTextos(tomados, advertencias) {
    if (!leerDocumento) throw error(503, 'La lectura de documentos no está disponible');
    const textos = {};
    for (const x of tomados) {
      const l = await leerDocumento(x.archivo.buffer, x.archivo.nombre).catch(() => null);
      const t = (l && l.texto) || '';
      if (t.trim().length < 50) advertencias.push(`No se pudo leer texto de ${x.rotulo} (¿es un PDF escaneado?): complete los datos a mano`);
      else textos[x.tipo === 'TDR' ? 'tdr' : 'os'] = t;
    }
    return textos;
  }
  const juntar = (textos) => [textos.os ? `=== ORDEN DE SERVICIO ===\n${textos.os}` : '', textos.tdr ? `=== TÉRMINOS DE REFERENCIA ===\n${textos.tdr}` : ''].filter(Boolean).join('\n\n');
  const lleno = (v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length);

  /** Lee la OS y el TDR (PDF temporales) y propone los datos del proyecto; nada se graba. */
  async function leerDocumentos(documentos, ctx) {
    const tomados = tomar(documentos, ctx);
    if (!tomados.length) throw error(400, 'Adjunte la Orden de Servicio y los Términos de Referencia (PDF)');
    const advertencias = [];
    const textos = await leerTextos(tomados, advertencias);
    if (!textos.tdr && !textos.os) return { origen: null, advertencias, datos_personales_omitidos: 0 };
    const directo = extraerDatosSinIA(textos);
    let propuesta = directo; let origen = 'TEXTO'; let omitidos = 0;
    if (extraerConIA) {
      try {
        const r = await extraerConIA({ texto: juntar(textos), usuario: { correo: ctx.usuario } }, 'proyecto');
        const ia = r.proyecto || {};
        propuesta = Object.fromEntries(Object.keys({ ...directo, ...ia }).map((k) => [k, lleno(ia[k]) ? ia[k] : directo[k] ?? null]));
        origen = 'IA'; omitidos = r.omitidos || 0;
        if (r.truncado) advertencias.push('Los documentos son extensos: el asistente leyó solo la primera parte');
      } catch (e) {
        advertencias.push(`No se pudo usar el asistente de IA (${e.message}): los datos se tomaron del texto de los documentos`);
      }
    }
    if (!propuesta.plazo_dias) advertencias.push('No se identificó el plazo de ejecución: indíquelo para calcular el periodo');
    for (const [k, t] of [['nombre', 'el nombre'], ['objetivo', 'el objetivo'], ['descripcion', 'la descripción']]) if (!propuesta[k]) advertencias.push(`No se identificó ${t}: complételo`);
    return { ...propuesta, origen, advertencias, datos_personales_omitidos: omitidos };
  }

  /**
   * «Registrar Orden de Servicio»: lee la OS y el TDR (los del proyecto con «PROYECTO» o PDF temporales) y propone
   * el profesional, el número, el expediente, el objeto, el monto, el plazo y los entregables; nada se graba.
   * El monto se lee sin IA y al asistente se le envía el texto sin importes ni datos personales.
   */
  async function leerOrdenServicio(proyecto_id, documentos, ctx) {
    const d = await servicio.datos();
    const proy = d.proyectos.find((p) => p.proyecto_id === Number(proyecto_id) && p.activo !== 0 && p.activo !== false);
    if (!proy) throw error(404, 'Proyecto no encontrado');
    const docs = documentos || {};
    const tomados = DOCUMENTOS.filter(([t]) => docs[t]).map(([tipo, rotulo]) => ({ tipo, rotulo, archivo: contrataciones.tomarDocumento(docs[tipo], proy, tipo, ctx, rotulo) }));
    if (!tomados.length) throw error(400, 'Adjunte la Orden de Servicio y los Términos de Referencia (PDF)');
    const advertencias = [];
    const textos = await leerTextos(tomados, advertencias);
    if (!textos.tdr && !textos.os) return { origen: null, advertencias, datos_personales_omitidos: 0 };
    const claves = d.consultores.map((c) => c.clave);
    const directo = extraerOrdenServicioSinIA({ ...textos, claves });
    let propuesta = directo; let origen = 'TEXTO'; let omitidos = 0;
    if (extraerConIA) {
      try {
        const r = await extraerConIA({ texto: quitarMontos(juntar(textos)), usuario: { correo: ctx.usuario } }, 'orden_servicio');
        const ia = { ...(r.orden || {}) };
        delete ia.monto; delete ia.clave; // el monto solo se lee del texto; la clave se calcula aquí
        propuesta = Object.fromEntries(Object.keys({ ...directo, ...ia }).map((k) => [k, lleno(ia[k]) ? ia[k] : directo[k] ?? null]));
        // La persona contratada es la del campo «Señor(es)» de la OS: la IA solo puede reordenar ese nombre, no cambiarlo
        if (directo.nombres) {
          if (lleno(ia.nombres) && !mismaPersona(ia.nombres, directo.nombres)) advertencias.push(`El asistente propuso «${ia.nombres}», pero la Orden de Servicio indica «${proveedorDeOS(textos.os)}» en «Señor(es)»: se usó el de la Orden de Servicio`);
          propuesta.nombres = lleno(ia.nombres) && mismaPersona(ia.nombres, directo.nombres) ? ia.nombres : directo.nombres;
        }
        for (const [k, t] of [['numero', 'el N.° de Orden de Servicio'], ['expediente', 'el expediente']]) {
          if (directo[k] && lleno(ia[k]) && String(ia[k]) !== String(directo[k])) advertencias.push(`Verifique ${t}: el asistente leyó «${ia[k]}» y el texto de la Orden de Servicio dice «${directo[k]}»`);
        }
        propuesta.clave = sugerirClave(propuesta.nombres, claves) || directo.clave;
        origen = 'IA'; omitidos = r.omitidos || 0;
        if (r.truncado) advertencias.push('Los documentos son extensos: el asistente leyó solo la primera parte');
      } catch (e) {
        advertencias.push(`No se pudo usar el asistente de IA (${e.message}): los datos se tomaron del texto de los documentos`);
      }
    }
    const repetida = propuesta.numero && d.contratos.some((k) => k.activo !== 0 && k.activo !== false && String(k.numero).toLowerCase() === String(propuesta.numero).toLowerCase());
    if (repetida) advertencias.push(`La Orden de Servicio N.° ${propuesta.numero} ya está registrada: si es otra contratación, adjunte su Orden de Servicio y su TDR`);
    for (const [k, t] of [['numero', 'el número de la Orden de Servicio'], ['nombres', 'el nombre del profesional'], ['monto', 'el monto'], ['plazo_dias', 'el plazo total']]) if (!propuesta[k]) advertencias.push(`No se identificó ${t}: complételo`);
    if (!lleno(propuesta.entregables)) advertencias.push('No se identificaron entregables: regístrelos a mano');
    else if (propuesta.plazo_dias) {
      const { errores, advertencias: adv } = validarEntregables({ plazo_dias: propuesta.plazo_dias, entregables: propuesta.entregables.filter((x) => x.plazo_dias) });
      advertencias.push(...errores, ...adv);
    }
    return { ...propuesta, repetida: !!repetida, origen, advertencias, datos_personales_omitidos: omitidos };
  }

  return { registrar, actualizar, leerDocumentos, leerOrdenServicio };
}

module.exports = { crearProyectos, extraerDatosSinIA, extraerOrdenServicioSinIA, proveedorDeOS, ordenarNombre, mismaPersona, sugerirClave, quitarMontos, aMonto, finPorPlazo, plazoDe };
