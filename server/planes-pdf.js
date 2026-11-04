'use strict';
/**
 * PDF del plan de trabajo aprobado: un archivo por plan (plan-<plan_id>.pdf) en el directorio configurado
 * (PLANES_PDF_DIR). Al reemplazarlo, la versión anterior se conserva con la fecha en el nombre (nada se borra).
 * El archivo no va al repositorio (.gitignore). En un despliegue con disco efímero debe montarse un volumen.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 15 * 1024 * 1024;
const error = (estado, mensaje) => Object.assign(new Error(mensaje), { estado });

function crearPlanesPdf({ dir }) {
  const ruta = (planId) => path.join(dir, `plan-${Number(planId)}.pdf`);

  function info(planId) {
    try {
      const s = fs.statSync(ruta(planId));
      return { existe: true, bytes: s.size, cargado: s.mtime.toISOString() };
    } catch { return { existe: false }; }
  }

  function guardar(planId, buf) {
    if (!Buffer.isBuffer(buf) || !buf.length) throw error(400, 'Adjunte el archivo PDF del plan (Content-Type: application/pdf)');
    if (buf.length > MAX_BYTES) throw error(413, 'El PDF supera el máximo de 15 MB');
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw error(400, 'El archivo no es un PDF válido');
    fs.mkdirSync(dir, { recursive: true });
    const destino = ruta(planId);
    const reemplaza = fs.existsSync(destino);
    if (reemplaza) fs.renameSync(destino, path.join(dir, `plan-${Number(planId)}-${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`));
    fs.writeFileSync(destino, buf);
    return { bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), reemplaza };
  }

  return { MAX_BYTES, ruta, info, guardar };
}

module.exports = { crearPlanesPdf };
