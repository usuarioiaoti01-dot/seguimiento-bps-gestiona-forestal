'use strict';
/**
 * Documentos PDF de respaldo de cada actividad del plan en formulación (ACTIVIDADES_PDF_DIR).
 * Archivo: act-<actividad_id>-<n>.pdf + act-<actividad_id>-<n>.json (nombre original, tamaño, huella, quién y cuándo).
 * Nada se borra: «quitar» marca el documento como retirado en su ficha y conserva el archivo.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_POR_ACTIVIDAD = 10;
const error = (estado, mensaje) => Object.assign(new Error(mensaje), { estado });

function crearActividadDocs({ dir }) {
  const base = (actId, n) => path.join(dir, `act-${Number(actId)}-${Number(n)}`);

  function leerFicha(actId, n) {
    try { return JSON.parse(fs.readFileSync(`${base(actId, n)}.json`, 'utf8')); } catch { return null; }
  }

  /** Documentos vigentes de la actividad, en orden de carga. */
  function listar(actId) {
    let nombres = [];
    try { nombres = fs.readdirSync(dir); } catch { return []; }
    const re = new RegExp(`^act-${Number(actId)}-(\\d+)\\.json$`);
    return nombres.map((f) => re.exec(f)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b)
      .map((n) => ({ n, ...leerFicha(actId, n) })).filter((x) => x.nombre && !x.quitado)
      .map((x) => ({ n: x.n, nombre: x.nombre, bytes: x.bytes, subido_por: x.subido_por, fecha: x.fecha }));
  }

  function guardar(actId, buf, { nombre, usuario }) {
    if (!Buffer.isBuffer(buf) || !buf.length) throw error(400, 'Adjunte el archivo PDF (Content-Type: application/pdf)');
    if (buf.length > MAX_BYTES) throw error(413, 'El PDF supera el máximo de 15 MB');
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw error(400, 'El archivo no es un PDF válido');
    if (listar(actId).length >= MAX_POR_ACTIVIDAD) throw error(409, `Cada actividad admite hasta ${MAX_POR_ACTIVIDAD} documentos`);
    fs.mkdirSync(dir, { recursive: true });
    let n = 1;
    while (fs.existsSync(`${base(actId, n)}.json`)) n += 1;
    const ficha = { nombre: String(nombre || `documento-${n}.pdf`).slice(0, 200), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), subido_por: usuario, fecha: new Date().toISOString() };
    fs.writeFileSync(`${base(actId, n)}.pdf`, buf);
    fs.writeFileSync(`${base(actId, n)}.json`, JSON.stringify(ficha));
    return { n, ...ficha };
  }

  function ruta(actId, n) {
    const f = leerFicha(actId, n);
    if (!f || f.quitado || !fs.existsSync(`${base(actId, n)}.pdf`)) return null;
    return { archivo: `${base(actId, n)}.pdf`, nombre: f.nombre };
  }

  function quitar(actId, n, usuario) {
    const f = leerFicha(actId, n);
    if (!f || f.quitado) throw error(404, 'Documento no encontrado');
    fs.writeFileSync(`${base(actId, n)}.json`, JSON.stringify({ ...f, quitado: true, quitado_por: usuario, quitado_en: new Date().toISOString() }));
    return f;
  }

  return { MAX_BYTES, listar, guardar, ruta, quitar };
}

module.exports = { crearActividadDocs };
