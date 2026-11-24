'use strict';
/**
 * Almacén documental único (criterio C5 de PLAN_DE_MEJORAS.md; tabla sgf.documento, db/14).
 *
 * - Valida el tipo por su contenido (no por la extensión), el tamaño y calcula el SHA-256.
 * - El archivo va a DOCUMENTOS_RAIZ/<P{proyecto}|general>/<entidad>/<id>/<tipo>-<aaaammdd-hhmmss>-<sha8>.<ext>
 *   (el nombre lo genera el sistema; el original solo se guarda como dato).
 * - Los metadatos y la bitácora se escriben en la misma transacción (repo.crear). Si la base falla, el archivo
 *   recién escrito se elimina (nunca quedó referenciado); nada referenciado se borra jamás.
 * - Reemplazar = nueva versión (version + 1, reemplaza_id); la vigente es la de mayor versión.
 * - Retirar = activo = 0 (baja lógica con bitácora).
 * - Mantiene en memoria el índice de los activos, para responder `info()` sin ir a la base.
 *
 * Las carpetas anteriores (PLANES_PDF_DIR, ADENDAS_PDF_DIR…) se siguen leyendo: `coleccion()` busca primero en
 * el almacén y, si no hay registro, en el almacenamiento anterior. `registrarExistente()` anota archivos que
 * siguen en su carpeta de siempre (evidencias de actividades, documentos de origen, cargas y la migración).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 15 * 1024 * 1024;
const TIPOS = ['TDR', 'ORDEN_SERVICIO', 'CONTRATO', 'NOTIFICACION', 'ENTREGABLE', 'CONFORMIDAD', 'OBSERVACION', 'EVIDENCIA', 'PLAN_TRABAJO', 'ADENDA', 'INFORME_CIERRE', 'ORIGEN_PLAN', 'CARGA', 'OTRO'];
const RAICES = ['ALMACEN', 'PLANES_PDF', 'ADENDAS_PDF', 'ACTIVIDADES_PDF', 'CONTRATOS_PDF', 'PLANES_ORIGEN', 'DOCUMENTOS'];
const error = (estado, mensaje) => Object.assign(new Error(mensaje), { estado });

/** Formatos admitidos, reconocidos por su firma. Office (docx/xlsx) es un ZIP: se distingue por la extensión. */
const FORMATOS = {
  pdf: { mime: 'application/pdf', ext: 'pdf', es: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  jpg: { mime: 'image/jpeg', ext: 'jpg', es: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  png: { mime: 'image/png', ext: 'png', es: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx', es: (b, n) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && /\.docx$/i.test(n) },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx', es: (b, n) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && /\.xlsx$/i.test(n) },
};
const MIME_POR_EXT = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', docx: FORMATOS.docx.mime, xlsx: FORMATOS.xlsx.mime, csv: 'text/csv', xml: 'application/xml', json: 'application/json' };

function detectarFormato(buf, nombre, permitidos) {
  for (const k of permitidos) if (FORMATOS[k] && FORMATOS[k].es(buf, nombre || '')) return FORMATOS[k];
  return null;
}

const sello = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); // aaaammdd-hhmmss
const clave = (tipo, entidad, entidadId) => `${tipo}|${entidad}|${entidadId ?? ''}`;

/**
 * @param repo        repositorio (memoria o sqlserver) con crear/actualizar/listarDocumentos
 * @param raices      { ALMACEN: dir, PLANES_PDF: dir, ... } carpetas de cada raíz
 * @param resolverProyecto async (consultor_id) => proyecto_id | null
 */
function crearAlmacen({ repo, raices, resolverProyecto = async () => null }) {
  if (!raices || !raices.ALMACEN) throw new Error('El almacén documental requiere la carpeta raíz (DOCUMENTOS_RAIZ)');
  let indice = new Map(); // clave -> filas activas, ordenadas por versión
  let porId = new Map();

  function indexar(f) {
    if (!f || f.activo === 0 || f.activo === false) return;
    porId.set(f.documento_id, f);
    const k = clave(f.tipo, f.entidad, f.entidad_id);
    const lista = (indice.get(k) || []).filter((x) => x.documento_id !== f.documento_id);
    lista.push(f);
    lista.sort((a, b) => a.version - b.version || a.documento_id - b.documento_id);
    indice.set(k, lista);
  }
  function desindexar(id) {
    const f = porId.get(Number(id));
    if (!f) return;
    porId.delete(f.documento_id);
    const k = clave(f.tipo, f.entidad, f.entidad_id);
    indice.set(k, (indice.get(k) || []).filter((x) => x.documento_id !== f.documento_id));
  }

  /** Carga el índice desde la base (al arrancar). */
  async function cargar() {
    indice = new Map(); porId = new Map();
    for (const f of await repo.listarDocumentos()) indexar(f);
  }

  /** Ruta absoluta del archivo, sin salir de la carpeta de su raíz. */
  function rutaAbsoluta(f) {
    const base = raices[f.raiz];
    if (!base) return null;
    const abs = path.resolve(base, f.ruta_relativa);
    const raizAbs = path.resolve(base);
    if (abs !== raizAbs && !abs.startsWith(raizAbs + path.sep)) return null;
    return abs;
  }

  const vigente = (tipo, entidad, entidadId) => { const l = indice.get(clave(tipo, entidad, entidadId)) || []; return l[l.length - 1] || null; };
  const listar = (tipo, entidad, entidadId) => [...(indice.get(clave(tipo, entidad, entidadId)) || [])];
  const buscar = (id) => porId.get(Number(id)) || null;
  /** Todos los activos de una entidad (cualquier tipo), del más reciente al más antiguo. */
  const deEntidad = (entidad, entidadId) => [...porId.values()].filter((f) => f.entidad === entidad && String(f.entidad_id ?? '') === String(entidadId ?? '')).sort((a, b) => b.documento_id - a.documento_id);

  async function proyectoDe(e) {
    if (e.proyecto_id) return Number(e.proyecto_id);
    if (e.consultor_id) { try { return (await resolverProyecto(Number(e.consultor_id))) ?? null; } catch { return null; } }
    return null;
  }

  async function crearFila(fila, ctx, e) {
    const motivo = ctx.motivo || `Documento ${fila.tipo}: ${fila.nombre_original}`;
    const opts = { usuario: ctx.usuario, motivo, origen: ctx.origen || 'UI', consultor_id: e.consultor_id ?? null };
    const nueva = ctx.tx ? await ctx.tx.crear('documento', fila, opts) : await repo.crear('documento', fila, opts);
    indexar(nueva);
    return nueva;
  }

  /**
   * Guarda un archivo nuevo en el almacén.
   * e: { tipo, entidad, entidad_id, consultor_id?, proyecto_id?, buffer, nombre, confidencial?, permitidos?, maxBytes?, reemplazar? }
   * ctx: { usuario, motivo?, origen?, tx? (vista de repo.transaccion) }
   */
  async function guardar(e, ctx) {
    if (!TIPOS.includes(e.tipo)) throw error(400, `Tipo de documento no válido: ${e.tipo}`);
    if (ctx.tx) throw error(400, 'El almacén confirma sus metadatos en una operación independiente');
    if (!/^[a-z_]+$/.test(e.entidad) || (e.entidad_id != null && (!Number.isSafeInteger(e.entidad_id) || e.entidad_id < 1))) throw error(400, 'Entidad de documento no válida');
    const buf = e.buffer;
    const permitidos = e.permitidos || ['pdf'];
    const max = e.maxBytes || MAX_BYTES;
    if (!Buffer.isBuffer(buf) || !buf.length) throw error(400, permitidos.length === 1 && permitidos[0] === 'pdf' ? 'Adjunte el archivo PDF (Content-Type: application/pdf)' : 'Adjunte el archivo');
    if (buf.length > max) throw error(413, `El archivo supera el máximo de ${Math.round(max / 1048576)} MB`);
    const formato = detectarFormato(buf, e.nombre, permitidos);
    if (!formato) throw error(400, permitidos.length === 1 && permitidos[0] === 'pdf' ? 'El archivo no es un PDF válido' : `Formato no admitido (se aceptan: ${permitidos.join(', ')})`);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const previa = e.reemplazar === false ? null : vigente(e.tipo, e.entidad, e.entidad_id);
    const proyecto_id = await proyectoDe(e);
    const rel = path.posix.join(proyecto_id ? `P${proyecto_id}` : 'general', String(e.entidad), String(e.entidad_id ?? 'sin-id'), `${e.tipo.toLowerCase()}-${sello()}-${sha256.slice(0, 8)}-${crypto.randomUUID()}.${formato.ext}`);
    const abs = rutaAbsoluta({ raiz: 'ALMACEN', ruta_relativa: rel });
    if (!abs) throw error(400, 'Ruta de documento no válida');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf, { flag: 'wx' }); // nunca sobrescribe
    const fila = {
      tipo: e.tipo, entidad: String(e.entidad), entidad_id: e.entidad_id ?? null, proyecto_id, consultor_id: e.consultor_id ?? null,
      nombre_original: String(e.nombre || `${e.tipo.toLowerCase()}.${formato.ext}`).slice(0, 260), raiz: 'ALMACEN', ruta_relativa: rel,
      tipo_mime: formato.mime, bytes: buf.length, sha256, version: previa ? previa.version + 1 : 1, reemplaza_id: previa ? previa.documento_id : null,
      confidencial: e.confidencial ? 1 : 0, subido_por: ctx.usuario,
    };
    try {
      const nueva = await crearFila(fila, ctx, e);
      return { ...nueva, reemplaza: !!previa };
    } catch (err) {
      try { fs.unlinkSync(abs); } catch { /* no quedó escrito */ }
      throw err;
    }
  }

  /**
   * Registra un archivo que ya está en disco, en una carpeta conocida (no lo mueve ni lo copia).
   * e: { tipo, entidad, entidad_id, consultor_id?, proyecto_id?, raiz, ruta_relativa, nombre, confidencial?, buffer? }
   */
  async function registrarExistente(e, ctx) {
    if (!TIPOS.includes(e.tipo)) throw error(400, `Tipo de documento no válido: ${e.tipo}`);
    if (!RAICES.includes(e.raiz) || !raices[e.raiz]) throw error(400, `Raíz de documentos no válida: ${e.raiz}`);
    const rel = String(e.ruta_relativa).split(path.sep).join('/');
    const abs = rutaAbsoluta({ raiz: e.raiz, ruta_relativa: rel });
    if (!abs) throw error(400, 'Ruta de documento no válida');
    const buf = e.buffer || fs.readFileSync(abs);
    const ext = (rel.match(/\.([a-z0-9]+)$/i) || [])[1];
    const previa = e.reemplazar === false ? null : vigente(e.tipo, e.entidad, e.entidad_id);
    const fila = {
      tipo: e.tipo, entidad: String(e.entidad), entidad_id: e.entidad_id ?? null, proyecto_id: await proyectoDe(e), consultor_id: e.consultor_id ?? null,
      nombre_original: String(e.nombre || path.posix.basename(rel)).slice(0, 260), raiz: e.raiz, ruta_relativa: rel,
      tipo_mime: MIME_POR_EXT[String(ext || '').toLowerCase()] || 'application/octet-stream', bytes: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'), version: previa ? previa.version + 1 : 1, reemplaza_id: previa ? previa.documento_id : null,
      confidencial: e.confidencial ? 1 : 0, subido_por: e.subido_por || ctx.usuario,
    };
    return crearFila(fila, ctx, e);
  }

  /** Baja lógica de un documento (sigue en disco y en el historial). */
  async function retirar(id, ctx) {
    const f = buscar(id);
    if (!f) throw error(404, 'Documento no encontrado');
    const r = await repo.actualizar('documento', f.documento_id, { activo: 0 }, { usuario: ctx.usuario, motivo: ctx.motivo || `Documento retirado: ${f.nombre_original}`, origen: ctx.origen || 'UI', consultor_id: f.consultor_id ?? null, accion: 'ANULAR' });
    desindexar(f.documento_id);
    return r;
  }

  /** Busca un activo por su ubicación en disco (para retirar lo registrado con registrarExistente). */
  const porUbicacion = (raiz, rutaRelativa) => [...porId.values()].find((f) => f.raiz === raiz && f.ruta_relativa === String(rutaRelativa).split(path.sep).join('/')) || null;

  /**
   * Adaptador con la interfaz de `crearPlanesPdf` (info/ruta síncronos) para los PDF de plan, adenda, OS/contrato y TDR.
   * Busca primero en el almacén y, si no hay registro, en el almacenamiento anterior (`legado`).
   * opciones: { tipo | tipos[], entidad, legado, confidencial? }
   */
  function coleccion({ tipo, tipos, entidad, legado = null, confidencial = false }) {
    const lista = tipos || [tipo];
    const doc = (id) => lista.map((t) => vigente(t, entidad, Number(id))).filter(Boolean).sort((a, b) => b.documento_id - a.documento_id)[0] || null;
    return {
      MAX_BYTES,
      documento: doc,
      info(id) {
        const f = doc(id);
        if (f) return { existe: true, bytes: f.bytes, cargado: f.subido_en ? new Date(f.subido_en).toISOString() : null, documento_id: f.documento_id, version: f.version, confidencial: !!f.confidencial };
        return legado ? legado.info(id) : { existe: false };
      },
      ruta(id) {
        const f = doc(id);
        if (f) return rutaAbsoluta(f);
        return legado ? legado.ruta(id) : null;
      },
      /** opts: { usuario, motivo, origen, consultor_id, proyecto_id, nombre, tipo (si la colección admite varios), tx } */
      async guardar(id, buffer, opts = {}) {
        const t = opts.tipo || lista[0];
        const r = await guardar({ tipo: t, entidad, entidad_id: Number(id), consultor_id: opts.consultor_id, proyecto_id: opts.proyecto_id, buffer, nombre: opts.nombre, confidencial: opts.confidencial ?? confidencial }, opts);
        // si el documento vigente estaba en la carpeta anterior, el nuevo lo reemplaza igual (allí queda como versión previa)
        const habiaLegado = !r.reemplaza && legado && legado.info(id).existe;
        return { bytes: r.bytes, sha256: r.sha256, reemplaza: r.reemplaza || !!habiaLegado, documento_id: r.documento_id, version: r.version };
      },
    };
  }

  return { MAX_BYTES, TIPOS, cargar, guardar, registrarExistente, retirar, vigente, listar, buscar, deEntidad, porUbicacion, rutaAbsoluta, coleccion };
}

module.exports = { crearAlmacen, TIPOS, RAICES, detectarFormato, MAX_BYTES };
