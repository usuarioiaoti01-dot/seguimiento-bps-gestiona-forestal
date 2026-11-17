'use strict';
/**
 * Reinicio de los planes de trabajo de todos los profesionales (nuevo flujo «Formular Plan de Trabajo»).
 *
 *   npm run planes:reiniciar
 *
 * Baja lógica de todas las actividades (activo = 0) y plan «por registrar»; nada se borra físicamente y la bitácora
 * (origen SCRIPT) conserva lo anterior. Usa el modo de datos del .env (MODO_DATOS). En modo memoria, detenga
 * antes el servidor; en SQL Server puede ejecutarse con el servicio activo.
 */
const { crearRepositorio } = require('../server/datos');
const { crearServicio } = require('../server/servicio');
const { crearFormulacion } = require('../server/formulacion');

(async () => {
  const repo = await crearRepositorio();
  const servicio = crearServicio(repo);
  const r = await crearFormulacion({ servicio, repo }).reiniciarPlanes('script:reiniciar_planes');
  console.log(`Planes reiniciados: ${r.planes} · actividades dadas de baja: ${r.actividades}`);
  if (repo.cerrar) await repo.cerrar();
  process.exit(0);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
