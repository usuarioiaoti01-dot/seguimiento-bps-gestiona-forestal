'use strict';
/**
 * Utilidad de base de datos (usa las credenciales SQL_* del .env).
 *
 *   npm run bd:probar     -> prueba la conexión y verifica requisitos
 *   npm run bd:instalar   -> ejecuta db/01 a db/05 en orden (solo sobre una base sin el esquema sgf)
 */
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const config = require('../server/config');

const c = config.sqlserver;
const DB = path.join(config.raiz, 'db');
const ORDEN = ['01_esquema.sql', '02_vistas.sql', '03_seguridad.sql', '04_datos_iniciales.sql', '05_verificacion.sql'];

async function conectar() {
  const faltan = ['servidor', 'base', 'usuario', 'clave'].filter((k) => !c[k]);
  if (faltan.length) throw new Error(`Faltan en el .env: ${faltan.map((f) => `SQL_${f.toUpperCase()}`).join(', ')}`);
  console.log(`Conectando a ${c.servidor}:${c.puerto} · base ${c.base} · usuario ${c.usuario} ...`);
  return new sql.ConnectionPool({
    server: c.servidor, port: c.puerto, database: c.base, user: c.usuario, password: c.clave,
    options: { encrypt: c.cifrar, trustServerCertificate: c.confiarCertificado, enableArithAbort: true },
    connectionTimeout: 20000, requestTimeout: 300000,
  }).connect();
}

async function diagnostico(pool) {
  const r = await pool.request().query(`
    SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(50)) AS version,
           CAST(SERVERPROPERTY('Edition') AS NVARCHAR(100)) AS edicion,
           DB_NAME() AS base,
           (SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()) AS compatibilidad,
           (SELECT collation_name FROM sys.databases WHERE name = DB_NAME()) AS intercalacion,
           IS_ROLEMEMBER('db_owner') AS es_db_owner,
           HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE') AS puede_crear_tablas,
           CASE WHEN SCHEMA_ID('sgf') IS NULL THEN 0 ELSE 1 END AS existe_sgf,
           (SELECT COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'sgf') AS tablas_sgf;`);
  return r.recordset[0];
}

function mostrar(d) {
  const mayor = Number(String(d.version).split('.')[0]);
  console.log(`\n  SQL Server ${d.version} (${d.edicion})`);
  console.log(`  Base: ${d.base} · compatibilidad ${d.compatibilidad} · intercalación ${d.intercalacion}`);
  console.log(`  Permisos: db_owner=${d.es_db_owner ? 'sí' : 'no'} · crear tablas=${d.puede_crear_tablas ? 'sí' : 'no'}`);
  console.log(`  Esquema sgf: ${d.existe_sgf ? `existe (${d.tablas_sgf} tablas)` : 'no existe todavía'}\n`);
  const problemas = [];
  if (mayor < 13) problemas.push('Se requiere SQL Server 2016 (versión 13) o superior.');
  if (d.compatibilidad < 130) problemas.push(`El nivel de compatibilidad es ${d.compatibilidad}; se requiere 130 o más (ALTER DATABASE ... SET COMPATIBILITY_LEVEL = 130).`);
  if (!d.es_db_owner) problemas.push('El usuario no es db_owner: puede usar la aplicación, pero la instalación de los scripts la debe hacer un usuario db_owner o el DBA.');
  return problemas;
}

function lotes(texto) {
  return texto.replace(/^﻿/, '').split(/^\s*GO\s*;?\s*$/gim).map((b) => b.trim()).filter(Boolean);
}

/** Estado detallado de la instalación y de los permisos del usuario de la aplicación. */
async function estadoInstalacion(pool) {
  const r = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM sys.views v JOIN sys.schemas s ON s.schema_id = v.schema_id WHERE s.name = 'sgf') AS vistas,
      (SELECT COUNT(*) FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'sgf' AND t.temporal_type = 2) AS temporales,
      CASE WHEN DATABASE_PRINCIPAL_ID('sgf_app') IS NULL THEN 0 ELSE 1 END AS existe_rol_app,
      ISNULL(IS_ROLEMEMBER('sgf_app'), 0) AS miembro_sgf_app,
      HAS_PERMS_BY_NAME('sgf.actividad', 'OBJECT', 'SELECT') AS p_select,
      HAS_PERMS_BY_NAME('sgf.actividad', 'OBJECT', 'INSERT') AS p_insert,
      HAS_PERMS_BY_NAME('sgf.actividad', 'OBJECT', 'UPDATE') AS p_update,
      HAS_PERMS_BY_NAME('sgf.actividad_pronostico', 'OBJECT', 'DELETE') AS p_delete_pron,
      HAS_PERMS_BY_NAME('sgf.fn_hoy_lima', 'OBJECT', 'EXECUTE') AS p_exec_fn;`);
  const e = r.recordset[0];
  const conteos = {};
  for (const t of ['consultor', 'contrato', 'adenda', 'plan_trabajo', 'actividad', 'actividad_dependencia', 'linea_base_entregable', 'control_cambio', 'feriado', 'parametro', 'usuario', 'bitacora']) {
    try { conteos[t] = (await pool.request().query(`SELECT COUNT(*) AS n FROM sgf.${t};`)).recordset[0].n; }
    catch (err) { conteos[t] = `sin acceso (${err.message.slice(0, 60)})`; }
  }
  return { ...e, conteos };
}

function mostrarInstalacion(e) {
  const si = (v) => (v ? 'sí' : 'NO');
  console.log('  Instalación del esquema sgf:');
  console.log(`    01 tablas temporales: ${e.temporales} de 8 · 02 vistas: ${e.vistas} de 5 · 03 rol sgf_app: ${si(e.existe_rol_app)}`);
  console.log(`    04 datos iniciales: ${typeof e.conteos.consultor === 'number' && e.conteos.consultor > 0 ? 'cargados' : 'NO cargados'}`);
  console.log('  Filas por tabla:');
  for (const [t, n] of Object.entries(e.conteos)) console.log(`    ${t.padEnd(24)} ${n}`);
  console.log('  Permisos del usuario de la aplicación:');
  console.log(`    miembro de sgf_app: ${si(e.miembro_sgf_app)} · SELECT ${si(e.p_select)} · INSERT ${si(e.p_insert)} · UPDATE ${si(e.p_update)} · DELETE pronósticos ${si(e.p_delete_pron)} · EXECUTE ${si(e.p_exec_fn)}\n`);
  const pendientes = [];
  if (e.temporales < 8) pendientes.push('Script 01 incompleto: faltan tablas temporales.');
  if (e.vistas < 5) pendientes.push('Falta ejecutar db/02_vistas.sql (usuario db_owner).');
  if (!e.existe_rol_app) pendientes.push('Falta ejecutar db/03_seguridad.sql (usuario db_owner).');
  if (!(typeof e.conteos.consultor === 'number' && e.conteos.consultor > 0)) pendientes.push('Falta ejecutar db/04_datos_iniciales.sql (una sola vez).');
  if (!(e.p_select && e.p_insert && e.p_update)) pendientes.push('El usuario no tiene SELECT/INSERT/UPDATE sobre sgf: el DBA debe agregarlo al rol sgf_app (ALTER ROLE sgf_app ADD MEMBER <usuario>;).');
  else if (!e.p_delete_pron || e.p_exec_fn === 0) pendientes.push('Faltan permisos DELETE sobre sgf.actividad_pronostico/plan_pronostico/feriado o EXECUTE: agregar el usuario al rol sgf_app.');
  return pendientes;
}

async function ejecutarArchivo(pool, archivo) {
  const texto = fs.readFileSync(path.join(DB, archivo), 'utf8');
  const bs = lotes(texto);
  process.stdout.write(`→ ${archivo} (${bs.length} lotes) `);
  for (const [i, b] of bs.entries()) {
    const req = pool.request();
    const mensajes = [];
    req.on('info', (m) => mensajes.push(m.message));
    try {
      const r = await req.batch(b);
      if (archivo.startsWith('05') && r.recordsets) {
        console.log('');
        for (const rs of r.recordsets) if (rs.length) console.table(rs);
      }
    } catch (err) {
      console.log('✗');
      throw new Error(`${archivo}, lote ${i + 1}: ${err.message}`);
    }
    if (mensajes.length && !archivo.startsWith('05')) process.stdout.write('.');
  }
  console.log('✓');
}

async function main() {
  const accion = process.argv[2] || 'probar';
  const pool = await conectar();
  try {
    console.log('Conexión exitosa.');
    const d = await diagnostico(pool);
    const problemas = mostrar(d);
    if (accion === 'probar') {
      if (!d.existe_sgf) {
        problemas.forEach((p) => console.log(`  ⚠ ${p}`));
        if (!problemas.length) console.log('  ✓ Todo listo. Ejecute: npm run bd:instalar');
        return;
      }
      const pendientes = mostrarInstalacion(await estadoInstalacion(pool));
      if (pendientes.length) pendientes.forEach((p) => console.log(`  ⚠ ${p}`));
      else console.log('  ✓ Instalación completa y permisos correctos. Cambie MODO_DATOS=sqlserver en el .env y reinicie con npm run dev.');
      return;
    }
    if (accion === 'instalar') {
      if (problemas.length) throw new Error(`No se puede instalar:\n  - ${problemas.join('\n  - ')}`);
      if (d.existe_sgf && d.tablas_sgf > 0) throw new Error('El esquema sgf ya existe con tablas. La instalación no se repite para no duplicar datos. Use npm run bd:probar para verificar.');
      for (const a of ORDEN) await ejecutarArchivo(pool, a);
      console.log('\nInstalación completa. En el .env cambie MODO_DATOS=sqlserver y reinicie con npm run dev.');
      return;
    }
    throw new Error(`Acción desconocida: ${accion}. Use "probar" o "instalar".`);
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  if (/ETIMEOUT|ESOCKET|Failed to connect/i.test(err.message)) {
    console.error('Sugerencias: verifique que esté en la red de SERFOR o en la VPN, que el servidor acepte TCP/IP en el puerto 1433 y que el firewall lo permita.');
  }
  if (/Login failed/i.test(err.message)) console.error('Sugerencia: revise SQL_USUARIO y SQL_CLAVE en el .env (si la clave tiene # precedido de espacio, escríbala entre comillas).');
  process.exit(1);
});
