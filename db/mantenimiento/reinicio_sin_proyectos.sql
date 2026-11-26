/* =====================================================================================================================
   MANTENIMIENTO · REINICIO SIN PROYECTOS («empezar de cero»)
   Decisión del usuario del 25/11/2026: al actualizar producción, la aplicación queda sin ningún proyecto.
   Es una excepción expresa a la regla «nada se borra físicamente» (CLAUDE.md §3.2). No lo ejecuta bd:instalar.

   CONSERVA
     · sgf.usuario   Administrador y Jefes de Proyecto, con su clave. Las cuentas PROFESIONAL quedan desactivadas y sin
                     vínculo con un profesional (las cuentas no se eliminan).
     · sgf.parametro y sgf.feriado.
   BORRA (también de sus tablas de historial temporal)
     proyectos, equipos, profesionales, contratos y órdenes de servicio, adendas, entregables, planes, actividades,
     dependencias, línea base, controles de cambio, partes diarios, metadatos de documentos, pronósticos, recálculos,
     conversaciones del asistente de IA y la bitácora. Deja una sola fila en la bitácora con este reinicio.

   ANTES DE EJECUTARLO
     1. Respaldo completo de la base (BACKUP DATABASE … TO DISK). Es la única forma de recuperar lo borrado.
     2. Servicio de la aplicación detenido.
     3. Cambie la línea @confirmacion de abajo. Sin ese texto exacto no se borra nada.
   Lo ejecuta el DBA (necesita ALTER sobre las tablas del esquema sgf). Corre en una sola transacción: si algo falla,
   no queda nada a medias.
   ===================================================================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @confirmacion NVARCHAR(60) = N'';   -- escriba aquí, entre las comillas:  BORRAR TODOS LOS PROYECTOS

IF @confirmacion <> N'BORRAR TODOS LOS PROYECTOS'
BEGIN
    RAISERROR(N'No se borró nada. Escriba BORRAR TODOS LOS PROYECTOS en @confirmacion para ejecutar el reinicio.', 16, 1);
    RETURN;
END;
IF SCHEMA_ID(N'sgf') IS NULL
BEGIN
    RAISERROR(N'Esta base no tiene el esquema sgf.', 16, 1);
    RETURN;
END;

PRINT N'Base: ' + DB_NAME() + N' · inicio: ' + CONVERT(NVARCHAR(30), SYSDATETIME(), 120);

-- Tablas temporales (con historial) y tablas comunes que se vacían
DECLARE @temporales TABLE (nombre SYSNAME PRIMARY KEY);
INSERT INTO @temporales VALUES (N'proyecto'), (N'proyecto_miembro'), (N'consultor'), (N'contrato'), (N'adenda'),
    (N'entregable_servicio'), (N'plan_trabajo'), (N'actividad'), (N'actividad_dependencia'), (N'linea_base_entregable'),
    (N'control_cambio'), (N'documento');
DECLARE @comunes TABLE (nombre SYSNAME PRIMARY KEY);
INSERT INTO @comunes VALUES (N'parte_diario_item'), (N'parte_diario'), (N'actividad_pronostico'), (N'plan_pronostico'),
    (N'plan_pronostico_historial'), (N'recalculo'), (N'ia_mensaje'), (N'ia_conversacion'), (N'bitacora');

-- solo las que existen en esta base
DELETE t FROM @temporales t WHERE OBJECT_ID(N'sgf.' + t.nombre, N'U') IS NULL;
DELETE c FROM @comunes c WHERE OBJECT_ID(N'sgf.' + c.nombre, N'U') IS NULL;

-- conteo previo
DECLARE @conteo NVARCHAR(MAX) = N'';
SELECT @conteo = @conteo + N'SELECT ''' + nombre + N''' AS tabla, COUNT(*) AS filas FROM sgf.' + QUOTENAME(nombre) + N' UNION ALL '
FROM (SELECT nombre FROM @temporales UNION ALL SELECT nombre FROM @comunes) x;
SET @conteo = LEFT(@conteo, LEN(@conteo) - 10) + N' ORDER BY tabla;';
PRINT N'Filas antes del reinicio:';
EXEC sys.sp_executesql @conteo;

DECLARE @sql NVARCHAR(MAX), @n SYSNAME;
BEGIN TRANSACTION;

    -- 1. historial temporal apagado (para poder vaciar también las tablas de historial)
    SET @sql = N'';
    SELECT @sql = @sql + N'ALTER TABLE sgf.' + QUOTENAME(nombre) + N' SET (SYSTEM_VERSIONING = OFF); '
    FROM @temporales t WHERE OBJECTPROPERTY(OBJECT_ID(N'sgf.' + t.nombre), N'TableTemporalType') = 2;
    EXEC sys.sp_executesql @sql;

    -- 2. cuentas: los Profesionales quedan desactivados y sin vínculo; Administrador y Jefes, sin cambios
    UPDATE sgf.usuario
       SET consultor_id = NULL,
           activo = CASE WHEN rol = N'PROFESIONAL' THEN 0 ELSE activo END
     WHERE consultor_id IS NOT NULL OR (rol = N'PROFESIONAL' AND activo = 1);

    -- 3. llaves foráneas en pausa, borrado de filas e historiales, y llaves verificadas otra vez
    SET @sql = N'';
    SELECT @sql = @sql + N'ALTER TABLE sgf.' + QUOTENAME(nombre) + N' NOCHECK CONSTRAINT ALL; '
    FROM (SELECT nombre FROM @temporales UNION ALL SELECT nombre FROM @comunes) x;
    EXEC sys.sp_executesql @sql;

    SET @sql = N'';
    SELECT @sql = @sql + N'DELETE FROM sgf.' + QUOTENAME(nombre) + N'; '
    FROM (SELECT nombre FROM @temporales UNION ALL SELECT nombre FROM @comunes) x;
    SELECT @sql = @sql + N'DELETE FROM sgf.' + QUOTENAME(nombre + N'_historial') + N'; '
    FROM @temporales t WHERE OBJECT_ID(N'sgf.' + t.nombre + N'_historial', N'U') IS NOT NULL;
    EXEC sys.sp_executesql @sql;

    SET @sql = N'';
    SELECT @sql = @sql + N'ALTER TABLE sgf.' + QUOTENAME(nombre) + N' WITH CHECK CHECK CONSTRAINT ALL; '
    FROM (SELECT nombre FROM @temporales UNION ALL SELECT nombre FROM @comunes) x;
    EXEC sys.sp_executesql @sql;

    -- 4. historial temporal encendido otra vez, con la misma tabla de historial
    SET @sql = N'';
    SELECT @sql = @sql + N'ALTER TABLE sgf.' + QUOTENAME(nombre) + N' SET (SYSTEM_VERSIONING = ON (HISTORY_TABLE = sgf.'
                 + QUOTENAME(nombre + N'_historial') + N', DATA_CONSISTENCY_CHECK = ON)); '
    FROM @temporales t WHERE OBJECT_ID(N'sgf.' + t.nombre + N'_historial', N'U') IS NOT NULL
                         AND OBJECTPROPERTY(OBJECT_ID(N'sgf.' + t.nombre), N'TableTemporalType') = 0;
    EXEC sys.sp_executesql @sql;

    -- 5. numeración desde 1 (solo en las tablas que ya habían usado su contador)
    DECLARE c CURSOR LOCAL FAST_FORWARD FOR
        SELECT o.name FROM sys.identity_columns ic JOIN sys.objects o ON o.object_id = ic.object_id
        WHERE o.schema_id = SCHEMA_ID(N'sgf') AND ic.last_value IS NOT NULL
          AND o.name IN (SELECT nombre FROM @temporales UNION ALL SELECT nombre FROM @comunes);
    OPEN c; FETCH NEXT FROM c INTO @n;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @sql = N'DBCC CHECKIDENT (''sgf.' + @n + N''', RESEED, 0) WITH NO_INFOMSGS;';
        EXEC sys.sp_executesql @sql;
        FETCH NEXT FROM c INTO @n;
    END;
    CLOSE c; DEALLOCATE c;

    -- 6. constancia en la bitácora
    INSERT INTO sgf.bitacora (usuario, entidad, entidad_id, accion, cambios_json, motivo, origen)
    VALUES (ORIGINAL_LOGIN(), N'sistema', NULL, N'REINICIO', NULL,
            N'Reinicio sin proyectos: la aplicación empieza de cero (decisión del usuario del 25/11/2026). Lo borrado está en el respaldo previo de la base.',
            N'SCRIPT');

COMMIT TRANSACTION;

PRINT N'Filas después del reinicio:';
EXEC sys.sp_executesql @conteo;
SELECT rol, activo, COUNT(*) AS cuentas FROM sgf.usuario GROUP BY rol, activo ORDER BY rol, activo;
SELECT (SELECT COUNT(*) FROM sgf.parametro) AS parametros, (SELECT COUNT(*) FROM sgf.feriado) AS feriados;
PRINT N'Reinicio terminado: ' + CONVERT(NVARCHAR(30), SYSDATETIME(), 120);
