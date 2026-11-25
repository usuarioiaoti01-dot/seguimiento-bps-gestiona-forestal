/* =====================================================================
   17_orden_servicio_entregables.sql – Orden de Servicio con notificación y entregables del TDR (Etapa 2)
   Idempotente: se puede ejecutar más de una vez.

   Contratación (sgf.contrato) en la modalidad ORDEN_SERVICIO:
     - Se registra con TDR, Orden de Servicio, monto, plazo y entregables: queda REGISTRADA (sin fechas).
     - Al registrar la notificación (fecha, medio y PDF) pasa a EN_EJECUCION: inicio = día siguiente de la
       notificación; fin = notificación + plazo; plazos siempre en días calendario (decisión D5).
     - monto es confidencial (solo el Administrador y el equipo del proyecto; decisión D4).
     - Una OS nueva para el mismo profesional es otra contratación (contrato_anterior_id).
   sgf.adenda.tipo_periodo: ORIGINAL (periodo de la OS, lo genera el sistema), AMPLIACION (ampliación de plazo) o
     ADENDA (contratos con adendas). Los contratos existentes quedan EN_EJECUCION y sus adendas como ADENDA.
   sgf.entregable_servicio: productos del TDR con su plazo (días desde la notificación) y su fecha límite.
   sgf.actividad.entregable_servicio_id: la actividad del plan aporta a ese entregable.
   Parámetros: UMBRAL_ENTREGABLE_DIAS (7) y UMBRAL_BORRADOR_DIAS (5).
   Los permisos de sgf_app ya cubren el esquema completo (03_seguridad.sql).
   Instalación: después de 16 y antes de 05_verificacion.sql.
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- ---------------------------------------------------------------- contratación
IF COL_LENGTH('sgf.contrato', 'fecha_notificacion') IS NULL
    ALTER TABLE sgf.contrato ADD fecha_notificacion DATE NULL;
GO
IF COL_LENGTH('sgf.contrato', 'medio_notificacion') IS NULL
    ALTER TABLE sgf.contrato ADD medio_notificacion VARCHAR(15) NULL
        CONSTRAINT CK_contrato_medio CHECK (medio_notificacion IN ('CORREO', 'PRESENCIAL', 'MESA_PARTES', 'SISTEMA'));
GO
IF COL_LENGTH('sgf.contrato', 'plazo_dias') IS NULL
    ALTER TABLE sgf.contrato ADD plazo_dias INT NULL CONSTRAINT CK_contrato_plazo CHECK (plazo_dias > 0);
GO
IF COL_LENGTH('sgf.contrato', 'fecha_fin') IS NULL
    ALTER TABLE sgf.contrato ADD fecha_fin DATE NULL;
GO
IF COL_LENGTH('sgf.contrato', 'monto') IS NULL
    ALTER TABLE sgf.contrato ADD monto DECIMAL(12,2) NULL CONSTRAINT CK_contrato_monto CHECK (monto >= 0);
GO
IF COL_LENGTH('sgf.contrato', 'estado_contratacion') IS NULL
    ALTER TABLE sgf.contrato ADD estado_contratacion VARCHAR(15) NOT NULL CONSTRAINT DF_contrato_estado DEFAULT ('EN_EJECUCION')
        CONSTRAINT CK_contrato_estado CHECK (estado_contratacion IN ('REGISTRADA', 'EN_EJECUCION', 'CULMINADA', 'RESUELTA', 'ANULADA'));
GO
IF COL_LENGTH('sgf.contrato', 'contrato_anterior_id') IS NULL
    ALTER TABLE sgf.contrato ADD contrato_anterior_id INT NULL CONSTRAINT FK_contrato_anterior REFERENCES sgf.contrato (contrato_id);
GO
IF COL_LENGTH('sgf.contrato', 'fecha_culminacion') IS NULL
    ALTER TABLE sgf.contrato ADD fecha_culminacion DATE NULL;
GO
IF COL_LENGTH('sgf.contrato', 'fecha_registro') IS NULL   -- para la alerta de OS registrada sin notificar (las existentes toman la fecha de este script)
    ALTER TABLE sgf.contrato ADD fecha_registro DATE NOT NULL CONSTRAINT DF_contrato_registro DEFAULT (CAST(SYSDATETIME() AS DATE));
GO

-- ---------------------------------------------------------------- periodos
IF COL_LENGTH('sgf.adenda', 'tipo_periodo') IS NULL
    ALTER TABLE sgf.adenda ADD tipo_periodo VARCHAR(12) NOT NULL CONSTRAINT DF_adenda_tipo DEFAULT ('ADENDA')
        CONSTRAINT CK_adenda_tipo CHECK (tipo_periodo IN ('ORIGINAL', 'AMPLIACION', 'ADENDA'));
GO

-- ---------------------------------------------------------------- entregables del TDR
IF OBJECT_ID('sgf.entregable_servicio') IS NULL
BEGIN
    CREATE TABLE sgf.entregable_servicio (
        entregable_servicio_id   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_entregable_servicio PRIMARY KEY,
        contrato_id              INT            NOT NULL CONSTRAINT FK_entregable_contrato REFERENCES sgf.contrato (contrato_id),
        numero                   INT            NOT NULL CONSTRAINT CK_entregable_numero CHECK (numero > 0),
        nombre                   NVARCHAR(300)  NOT NULL,
        descripcion              NVARCHAR(1000) NULL,
        plazo_dias               INT            NOT NULL CONSTRAINT CK_entregable_plazo CHECK (plazo_dias > 0),  -- días calendario desde la notificación
        fecha_limite             DATE           NULL,          -- la calcula la aplicación al registrar la notificación
        porcentaje_pago          DECIMAL(5,2)   NULL CONSTRAINT CK_entregable_pct CHECK (porcentaje_pago >= 0 AND porcentaje_pago <= 100),
        estado                   VARCHAR(12)    NOT NULL CONSTRAINT DF_entregable_estado DEFAULT ('PENDIENTE')
                                                CONSTRAINT CK_entregable_estado CHECK (estado IN ('PENDIENTE', 'PRESENTADO', 'EN_REVISION', 'OBSERVADO', 'SUBSANADO', 'CONFORME', 'ANULADO')),
        fecha_presentacion       DATE           NULL,
        fecha_observacion        DATE           NULL,
        plazo_subsanacion_dias   INT            NULL,
        fecha_limite_subsanacion DATE           NULL,
        fecha_conformidad        DATE           NULL,
        conformidad_ref          NVARCHAR(300)  NULL,
        observacion              NVARCHAR(1000) NULL,
        activo                   BIT            NOT NULL CONSTRAINT DF_entregable_activo DEFAULT (1),
        revision                 INT            NOT NULL CONSTRAINT DF_entregable_rev DEFAULT (1),
        modificado_por           NVARCHAR(150)  NULL,
        valido_desde             DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
        valido_hasta             DATETIME2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
        PERIOD FOR SYSTEM_TIME (valido_desde, valido_hasta)
    ) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = sgf.entregable_servicio_historial));
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_entregable_numero' AND object_id = OBJECT_ID('sgf.entregable_servicio'))
    CREATE UNIQUE INDEX UX_entregable_numero ON sgf.entregable_servicio (contrato_id, numero) WHERE activo = 1;
GO

IF COL_LENGTH('sgf.actividad', 'entregable_servicio_id') IS NULL
    ALTER TABLE sgf.actividad ADD entregable_servicio_id INT NULL CONSTRAINT FK_actividad_entregable_servicio REFERENCES sgf.entregable_servicio (entregable_servicio_id);
GO

-- ---------------------------------------------------------------- parámetros
IF NOT EXISTS (SELECT 1 FROM sgf.parametro WHERE codigo = 'UMBRAL_ENTREGABLE_DIAS')
    INSERT INTO sgf.parametro (codigo, valor, descripcion, actualizado_por)
    VALUES ('UMBRAL_ENTREGABLE_DIAS', N'7', N'Alerta cuando faltan estos días o menos para la fecha límite de un entregable sin presentar.', N'db/17');
IF NOT EXISTS (SELECT 1 FROM sgf.parametro WHERE codigo = 'UMBRAL_BORRADOR_DIAS')
    INSERT INTO sgf.parametro (codigo, valor, descripcion, actualizado_por)
    VALUES ('UMBRAL_BORRADOR_DIAS', N'5', N'Alerta cuando una Orden de Servicio registrada lleva estos días o más sin notificación.', N'db/17');
GO

-- Verificación
SELECT estado_contratacion, COUNT(*) AS contrataciones FROM sgf.contrato GROUP BY estado_contratacion;
SELECT tipo_periodo, COUNT(*) AS periodos FROM sgf.adenda GROUP BY tipo_periodo;
SELECT codigo, valor FROM sgf.parametro WHERE codigo IN ('UMBRAL_ENTREGABLE_DIAS', 'UMBRAL_BORRADOR_DIAS');
PRINT 'db/17: Orden de Servicio con notificación y entregables listos.';
GO
