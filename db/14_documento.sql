/* =====================================================================
   14_documento.sql – Almacén documental único (metadatos)
   Idempotente: se puede ejecutar más de una vez.

   Cada archivo que la aplicación guarda (PDF del plan, de la adenda, de la Orden de Servicio o contrato,
   TDR, evidencias de actividades, documentos de origen de planes y originales de cargas) queda registrado
   aquí con su huella SHA-256. El archivo vive en disco (DOCUMENTOS_RAIZ u otra carpeta configurada, ver
   la columna «raiz»); en SQL Server solo van sus metadatos. Nada se borra: retirar = activo = 0.
   Reemplazar = nueva fila con version + 1 y reemplaza_id; la vigente es la de mayor versión.
   La tabla es temporal (historial en sgf.documento_historial).
   Los permisos de sgf_app ya cubren el esquema completo (03_seguridad.sql).
   Instalación: después de 13 y antes de 05_verificacion.sql.
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF OBJECT_ID('sgf.documento') IS NULL
BEGIN
    CREATE TABLE sgf.documento (
        documento_id    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_documento PRIMARY KEY,
        tipo            VARCHAR(20)    NOT NULL CONSTRAINT CK_documento_tipo CHECK (tipo IN (
                            'TDR', 'ORDEN_SERVICIO', 'CONTRATO', 'NOTIFICACION', 'ENTREGABLE', 'CONFORMIDAD', 'OBSERVACION',
                            'EVIDENCIA', 'PLAN_TRABAJO', 'ADENDA', 'INFORME_CIERRE', 'ORIGEN_PLAN', 'CARGA', 'OTRO')),
        entidad         VARCHAR(40)    NOT NULL,      -- entidad dueña: contrato, adenda, plan_trabajo, actividad, proyecto, carga...
        entidad_id      INT            NULL,
        proyecto_id     INT            NULL CONSTRAINT FK_documento_proyecto REFERENCES sgf.proyecto (proyecto_id),
        consultor_id    INT            NULL CONSTRAINT FK_documento_consultor REFERENCES sgf.consultor (consultor_id),
        nombre_original NVARCHAR(260)  NOT NULL,      -- nombre con el que se subió (solo para mostrar)
        raiz            VARCHAR(20)    NOT NULL CONSTRAINT DF_documento_raiz DEFAULT ('ALMACEN')
                                       CONSTRAINT CK_documento_raiz CHECK (raiz IN ('ALMACEN', 'PLANES_PDF', 'ADENDAS_PDF', 'ACTIVIDADES_PDF', 'CONTRATOS_PDF', 'PLANES_ORIGEN', 'DOCUMENTOS')),
        ruta_relativa   NVARCHAR(400)  NOT NULL,      -- relativa a la carpeta de la raíz; el nombre lo genera el sistema
        tipo_mime       VARCHAR(100)   NOT NULL,
        bytes           BIGINT         NOT NULL,
        sha256          CHAR(64)       NOT NULL,
        version         INT            NOT NULL CONSTRAINT DF_documento_version DEFAULT (1),
        reemplaza_id    INT            NULL CONSTRAINT FK_documento_reemplaza REFERENCES sgf.documento (documento_id),
        confidencial    BIT            NOT NULL CONSTRAINT DF_documento_conf DEFAULT (0),   -- OS, notificación: solo ADMIN y el equipo del proyecto
        subido_por      NVARCHAR(150)  NOT NULL,
        subido_en       DATETIME2(3)   NOT NULL CONSTRAINT DF_documento_subido DEFAULT (SYSDATETIME()),
        activo          BIT            NOT NULL CONSTRAINT DF_documento_activo DEFAULT (1),
        revision        INT            NOT NULL CONSTRAINT DF_documento_rev DEFAULT (1),
        modificado_por  NVARCHAR(150)  NULL,
        valido_desde    DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
        valido_hasta    DATETIME2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
        PERIOD FOR SYSTEM_TIME (valido_desde, valido_hasta)
    ) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = sgf.documento_historial));
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_documento_entidad' AND object_id = OBJECT_ID('sgf.documento'))
    CREATE INDEX IX_documento_entidad ON sgf.documento (entidad, entidad_id, tipo, version);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_documento_proyecto' AND object_id = OBJECT_ID('sgf.documento'))
    CREATE INDEX IX_documento_proyecto ON sgf.documento (proyecto_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_documento_sha256' AND object_id = OBJECT_ID('sgf.documento'))
    CREATE INDEX IX_documento_sha256 ON sgf.documento (sha256);
GO

-- Verificación
SELECT tipo, raiz, COUNT(*) AS documentos, SUM(bytes) AS bytes FROM sgf.documento WHERE activo = 1 GROUP BY tipo, raiz ORDER BY tipo, raiz;
PRINT 'db/14: almacén documental listo.';
GO
