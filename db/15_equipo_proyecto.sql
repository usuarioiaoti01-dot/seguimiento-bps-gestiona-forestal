/* =====================================================================
   15_equipo_proyecto.sql – Equipo de cada proyecto (alcance de escritura por proyecto)
   Idempotente: se puede ejecutar más de una vez.

   El Equipo de Desarrollo usa el perfil JEFE_PROYECTO (decisión D1 de PLAN_DE_MEJORAS.md). Cada proyecto
   tiene un equipo de uno o más Jefes de Proyecto; uno es el responsable. Todos ven todos los proyectos,
   pero cada uno solo escribe en los suyos (D2). El Administrador escribe en todos.
   Baja lógica: activo = 0 y «hasta». La tabla es temporal (historial en sgf.proyecto_miembro_historial).
   Migración (solo si la tabla está vacía): para no cambiar el comportamiento de hoy, cada JEFE_PROYECTO
   activo queda como miembro de todos los proyectos existentes. El Administrador ajusta luego los equipos.
   Los permisos de sgf_app ya cubren el esquema completo (03_seguridad.sql).
   Instalación: después de 14 y antes de 05_verificacion.sql.
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF OBJECT_ID('sgf.proyecto_miembro') IS NULL
BEGIN
    CREATE TABLE sgf.proyecto_miembro (
        miembro_id      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_proyecto_miembro PRIMARY KEY,
        proyecto_id     INT           NOT NULL CONSTRAINT FK_miembro_proyecto REFERENCES sgf.proyecto (proyecto_id),
        usuario_id      INT           NOT NULL CONSTRAINT FK_miembro_usuario REFERENCES sgf.usuario (usuario_id),
        es_responsable  BIT           NOT NULL CONSTRAINT DF_miembro_resp DEFAULT (0),
        desde           DATE          NOT NULL CONSTRAINT DF_miembro_desde DEFAULT (CAST(SYSDATETIME() AS DATE)),
        hasta           DATE          NULL,
        activo          BIT           NOT NULL CONSTRAINT DF_miembro_activo DEFAULT (1),
        revision        INT           NOT NULL CONSTRAINT DF_miembro_rev DEFAULT (1),
        modificado_por  NVARCHAR(150) NULL,
        valido_desde    DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
        valido_hasta    DATETIME2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
        PERIOD FOR SYSTEM_TIME (valido_desde, valido_hasta)
    ) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = sgf.proyecto_miembro_historial));
END
GO

-- Un usuario figura una sola vez (activo) en cada proyecto, y cada proyecto tiene a lo más un responsable activo
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_miembro_activo' AND object_id = OBJECT_ID('sgf.proyecto_miembro'))
    CREATE UNIQUE INDEX UX_miembro_activo ON sgf.proyecto_miembro (proyecto_id, usuario_id) WHERE activo = 1;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_miembro_responsable' AND object_id = OBJECT_ID('sgf.proyecto_miembro'))
    CREATE UNIQUE INDEX UX_miembro_responsable ON sgf.proyecto_miembro (proyecto_id) WHERE activo = 1 AND es_responsable = 1;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_miembro_usuario' AND object_id = OBJECT_ID('sgf.proyecto_miembro'))
    CREATE INDEX IX_miembro_usuario ON sgf.proyecto_miembro (usuario_id) WHERE activo = 1;
GO

-- Migración inicial: conserva el acceso de hoy (los Jefes de Proyecto escriben en todos los proyectos existentes)
IF NOT EXISTS (SELECT 1 FROM sgf.proyecto_miembro)
BEGIN
    INSERT INTO sgf.proyecto_miembro (proyecto_id, usuario_id, es_responsable, modificado_por)
    SELECT p.proyecto_id, u.usuario_id, 0, N'db/15'
    FROM sgf.proyecto p CROSS JOIN sgf.usuario u
    WHERE p.activo = 1 AND u.activo = 1 AND u.rol = 'JEFE_PROYECTO';
    DECLARE @n INT = @@ROWCOUNT;

    INSERT INTO sgf.bitacora (usuario, entidad, accion, cambios_json, motivo, origen)
    VALUES (N'db/15', 'proyecto_miembro', 'CREAR', CONCAT('{"miembros":', @n, '}'),
            N'Migración inicial: cada Jefe de Proyecto activo queda en el equipo de los proyectos existentes', 'SCRIPT');
END
GO

-- Verificación
SELECT p.codigo, u.nombre, u.correo, m.es_responsable, m.desde
FROM sgf.proyecto_miembro m JOIN sgf.proyecto p ON p.proyecto_id = m.proyecto_id JOIN sgf.usuario u ON u.usuario_id = m.usuario_id
WHERE m.activo = 1 ORDER BY p.codigo, m.es_responsable DESC, u.nombre;
PRINT 'db/15: equipos de proyecto listos.';
GO
