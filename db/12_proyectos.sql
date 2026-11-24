/* =====================================================================
   12_proyectos.sql – Varios proyectos
   Idempotente: se puede ejecutar más de una vez.

   La aplicación deja de gestionar un solo proyecto. Cada consultor pertenece a un proyecto
   (sgf.consultor.proyecto_id); contratos, adendas, planes y actividades cuelgan del consultor.
   Los consultores existentes pasan al proyecto «Gestiona Forestal» (se crea aquí).
   La tabla es temporal: las versiones anteriores quedan en sgf.proyecto_historial.
   Los permisos de sgf_app ya cubren el esquema completo (03_seguridad.sql).
   Instalación: después de 11 y antes de 05_verificacion.sql.
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF OBJECT_ID('sgf.proyecto') IS NULL
BEGIN
    CREATE TABLE sgf.proyecto (
        proyecto_id     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_proyecto PRIMARY KEY,
        codigo          VARCHAR(20)    NOT NULL CONSTRAINT UQ_proyecto_codigo UNIQUE,
        nombre          NVARCHAR(300)  NOT NULL,
        financiador     NVARCHAR(150)  NULL,          -- p. ej. KfW
        area_tecnica    NVARCHAR(300)  NULL,          -- gestión del proyecto: área designada por la Dirección OTI
        jefe_proyecto   NVARCHAR(150)  NULL,
        fecha_inicio    DATE           NULL,
        fecha_fin       DATE           NULL,
        descripcion     NVARCHAR(1000) NULL,
        estado          VARCHAR(10)    NOT NULL CONSTRAINT DF_proyecto_estado DEFAULT ('ACTIVO') CONSTRAINT CK_proyecto_estado CHECK (estado IN ('ACTIVO','CERRADO')),
        activo          BIT            NOT NULL CONSTRAINT DF_proyecto_activo DEFAULT (1),
        revision        INT            NOT NULL CONSTRAINT DF_proyecto_rev DEFAULT (1),
        modificado_por  NVARCHAR(150)  NULL,
        valido_desde    DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
        valido_hasta    DATETIME2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
        PERIOD FOR SYSTEM_TIME (valido_desde, valido_hasta)
    ) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = sgf.proyecto_historial));
END
GO

-- Proyecto inicial (el único que existía)
IF NOT EXISTS (SELECT 1 FROM sgf.proyecto)
    INSERT INTO sgf.proyecto (codigo, nombre, financiador, area_tecnica, estado, modificado_por)
    VALUES ('GF2026', N'Gestiona Forestal 2026 – Proyecto Bosques PI 2 (UE 003 – CUI 2455355)', N'KfW',
            N'Oficina de Tecnologías de la Información – OTI', 'ACTIVO', N'db/12');
GO

IF COL_LENGTH('sgf.consultor', 'proyecto_id') IS NULL
    ALTER TABLE sgf.consultor ADD proyecto_id INT NULL CONSTRAINT FK_consultor_proyecto REFERENCES sgf.proyecto (proyecto_id);
GO
UPDATE sgf.consultor SET proyecto_id = (SELECT TOP 1 proyecto_id FROM sgf.proyecto ORDER BY proyecto_id) WHERE proyecto_id IS NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_consultor_proyecto' AND object_id = OBJECT_ID('sgf.consultor'))
    CREATE INDEX IX_consultor_proyecto ON sgf.consultor (proyecto_id);
GO

PRINT 'db/12: proyectos listos.';
GO
