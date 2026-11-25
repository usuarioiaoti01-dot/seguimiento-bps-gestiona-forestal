/* =====================================================================
   18_parte_diario.sql – Supervisión diaria y conformidad de entregables (Etapa 3 de PLAN_DE_MEJORAS.md)
   Idempotente: se puede ejecutar más de una vez.

   sgf.parte_diario: lo que el equipo del proyecto (Jefes de Proyecto del Equipo de Desarrollo) registra cada día
     sobre un profesional: qué se hizo, incidencias y riesgos. Es de SOLO INSERCIÓN (como la bitácora): no se
     modifica ni se borra; se corrige con otro parte que lo rectifica (rectifica_parte_id).
   sgf.parte_diario_item: avance reportado de cada actividad (o subactividad) del plan aprobado. El avance se
     aplica a la actividad en la misma transacción, con su bitácora.
   Las evidencias del parte van al almacén documental (sgf.documento, tipo EVIDENCIA, entidad parte_diario).
   sgf.entregable_servicio.fecha_subsanacion: fecha en que se presentó la subsanación de una observación.
   Parámetros: PLAZO_REVISION_DIAS (7), PLAZO_SUBSANACION_DIAS (5), PARTE_DIAS_ATRAS (3), UMBRAL_SIN_PARTE_DIAS (3).
   Permisos: sgf_app inserta y lee (03_seguridad.sql); aquí se le NIEGA modificar o borrar los partes.
   Instalación: después de 17 y antes de 05_verificacion.sql.
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF OBJECT_ID('sgf.parte_diario') IS NULL
BEGIN
    CREATE TABLE sgf.parte_diario (
        parte_id            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_parte_diario PRIMARY KEY,
        proyecto_id         INT            NOT NULL CONSTRAINT FK_parte_proyecto REFERENCES sgf.proyecto (proyecto_id),
        consultor_id        INT            NOT NULL CONSTRAINT FK_parte_consultor REFERENCES sgf.consultor (consultor_id),
        contrato_id         INT            NULL CONSTRAINT FK_parte_contrato REFERENCES sgf.contrato (contrato_id),
        fecha               DATE           NOT NULL,
        descripcion         NVARCHAR(2000) NOT NULL,
        incidencias         NVARCHAR(1000) NULL,
        riesgos             NVARCHAR(1000) NULL,
        justificacion       NVARCHAR(500)  NULL,      -- obligatoria si la fecha es anterior a PARTE_DIAS_ATRAS días hábiles
        rectifica_parte_id  INT            NULL CONSTRAINT FK_parte_rectifica REFERENCES sgf.parte_diario (parte_id),
        registrado_en       DATETIME2(0)   NOT NULL CONSTRAINT DF_parte_registrado DEFAULT (SYSDATETIME()),
        activo              BIT            NOT NULL CONSTRAINT DF_parte_activo DEFAULT (1),
        modificado_por      NVARCHAR(150)  NOT NULL   -- quien lo registró
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_parte_consultor' AND object_id = OBJECT_ID('sgf.parte_diario'))
    CREATE INDEX IX_parte_consultor ON sgf.parte_diario (consultor_id, fecha DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_parte_proyecto' AND object_id = OBJECT_ID('sgf.parte_diario'))
    CREATE INDEX IX_parte_proyecto ON sgf.parte_diario (proyecto_id, fecha DESC);
GO

IF OBJECT_ID('sgf.parte_diario_item') IS NULL
BEGIN
    CREATE TABLE sgf.parte_diario_item (
        item_id             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_parte_item PRIMARY KEY,
        parte_id            INT            NOT NULL CONSTRAINT FK_item_parte REFERENCES sgf.parte_diario (parte_id),
        actividad_id        INT            NOT NULL CONSTRAINT FK_item_actividad REFERENCES sgf.actividad (actividad_id),
        subactividad_indice INT            NULL,      -- 0, 1, 2… si el avance es de una subactividad
        avance_anterior     DECIMAL(5,2)   NULL,
        avance_reportado    DECIMAL(5,2)   NOT NULL CONSTRAINT CK_item_avance CHECK (avance_reportado >= 0 AND avance_reportado <= 100),
        estado_reportado    VARCHAR(12)    NULL,
        comentario          NVARCHAR(500)  NULL,
        activo              BIT            NOT NULL CONSTRAINT DF_item_activo DEFAULT (1),
        modificado_por      NVARCHAR(150)  NOT NULL
    );
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_item_parte' AND object_id = OBJECT_ID('sgf.parte_diario_item'))
    CREATE INDEX IX_item_parte ON sgf.parte_diario_item (parte_id);
GO

-- Los partes son de solo inserción para la aplicación (como sgf.bitacora)
IF DATABASE_PRINCIPAL_ID(N'sgf_app') IS NOT NULL
BEGIN
    DENY UPDATE, DELETE ON sgf.parte_diario TO sgf_app;
    DENY UPDATE, DELETE ON sgf.parte_diario_item TO sgf_app;
END
GO

IF COL_LENGTH('sgf.entregable_servicio', 'fecha_subsanacion') IS NULL
    ALTER TABLE sgf.entregable_servicio ADD fecha_subsanacion DATE NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sgf.parametro WHERE codigo = 'PLAZO_REVISION_DIAS')
    INSERT INTO sgf.parametro (codigo, valor, descripcion, actualizado_por) VALUES ('PLAZO_REVISION_DIAS', N'7', N'Días calendario que tiene el equipo para dar la conformidad u observar un entregable presentado.', N'db/18');
IF NOT EXISTS (SELECT 1 FROM sgf.parametro WHERE codigo = 'PLAZO_SUBSANACION_DIAS')
    INSERT INTO sgf.parametro (codigo, valor, descripcion, actualizado_por) VALUES ('PLAZO_SUBSANACION_DIAS', N'5', N'Días calendario para subsanar una observación, si el TDR no fija otro plazo.', N'db/18');
IF NOT EXISTS (SELECT 1 FROM sgf.parametro WHERE codigo = 'PARTE_DIAS_ATRAS')
    INSERT INTO sgf.parametro (codigo, valor, descripcion, actualizado_por) VALUES ('PARTE_DIAS_ATRAS', N'3', N'Días hábiles hacia atrás en que se puede registrar un parte diario sin justificación.', N'db/18');
IF NOT EXISTS (SELECT 1 FROM sgf.parametro WHERE codigo = 'UMBRAL_SIN_PARTE_DIAS')
    INSERT INTO sgf.parametro (codigo, valor, descripcion, actualizado_por) VALUES ('UMBRAL_SIN_PARTE_DIAS', N'3', N'Alerta cuando un profesional con Orden de Servicio en ejecución lleva más de estos días hábiles sin parte diario.', N'db/18');
GO

-- Verificación
SELECT OBJECT_NAME(major_id) AS tabla, permission_name, state_desc FROM sys.database_permissions
 WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID(N'sgf_app') AND major_id IN (OBJECT_ID('sgf.parte_diario'), OBJECT_ID('sgf.parte_diario_item'));
SELECT codigo, valor FROM sgf.parametro WHERE codigo IN ('PLAZO_REVISION_DIAS', 'PLAZO_SUBSANACION_DIAS', 'PARTE_DIAS_ATRAS', 'UMBRAL_SIN_PARTE_DIAS');
PRINT 'db/18: supervisión diaria y conformidad de entregables listas.';
GO
