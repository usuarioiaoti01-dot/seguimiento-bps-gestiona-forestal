/* =====================================================================
   03_seguridad.sql – Rol de base de datos para la aplicación (mínimo privilegio)
   La aplicación NO borra filas: las bajas son lógicas (activo = 0) y el
   historial vive en las tablas temporales. Por eso el rol no tiene DELETE,
   salvo en las tablas de resultados del recálculo, que se reemplazan,
   y en el calendario de feriados.
   ===================================================================== */
SET NOCOUNT ON;
GO

IF DATABASE_PRINCIPAL_ID(N'sgf_app') IS NULL CREATE ROLE sgf_app AUTHORIZATION dbo;
GO
GRANT SELECT, INSERT, UPDATE ON SCHEMA::sgf TO sgf_app;
GRANT EXECUTE ON SCHEMA::sgf TO sgf_app;
GRANT DELETE ON sgf.actividad_pronostico TO sgf_app;
GRANT DELETE ON sgf.plan_pronostico      TO sgf_app;
GRANT DELETE ON sgf.feriado              TO sgf_app;   -- calendario editable por ADMIN
DENY  UPDATE ON sgf.bitacora   TO sgf_app;   -- la bitácora es de solo inserción
DENY  UPDATE ON sgf.ia_mensaje TO sgf_app;
GO

/* Rol de solo lectura para reportes (Power BI / Excel) */
IF DATABASE_PRINCIPAL_ID(N'sgf_lectura') IS NULL CREATE ROLE sgf_lectura AUTHORIZATION dbo;
GO
GRANT SELECT ON SCHEMA::sgf TO sgf_lectura;
DENY  SELECT ON sgf.usuario TO sgf_lectura;
DENY  SELECT ON sgf.consultor (dni, telefono, correo_personal) TO sgf_lectura;
GO

/* ---------------------------------------------------------------------
   Plantilla para el DBA (no se ejecuta tal cual: defina la clave en el
   servidor y guárdela solo en el archivo .env del servidor de aplicación).

   USE master;
   CREATE LOGIN usr_sgf_app WITH PASSWORD = N'<definir por el DBA>', CHECK_POLICY = ON;
   USE SGF_SEGUIMIENTO;
   CREATE USER usr_sgf_app FOR LOGIN usr_sgf_app WITH DEFAULT_SCHEMA = sgf;
   ALTER ROLE sgf_app ADD MEMBER usr_sgf_app;
   --------------------------------------------------------------------- */
PRINT 'Roles sgf_app y sgf_lectura configurados.';
GO
