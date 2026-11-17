/* =====================================================================
   09_formulacion_plan.sql – Formulación del plan de trabajo
   Idempotente: se puede ejecutar más de una vez.

   Flujo del plan: EN_FORMULACION (profesional) → EN_REVISION_JEFE (Jefe de Proyecto, puede modificar y aprobar)
   → EN_REVISION_ADMIN (Administrador: aprueba u observa con comentarios; OBSERVADO vuelve al Jefe de Proyecto)
   → APROBADO (el plan queda fijo y arranca el seguimiento). POR_REGISTRAR = sin plan formulado.

   Agrega a sgf.plan_trabajo los datos de la plantilla del cronograma (área usuaria, referencia de línea base,
   supuestos) y las fechas del flujo. Instalación: después de 08 y antes de 05_verificacion.sql.
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF COL_LENGTH('sgf.plan_trabajo', 'area_usuaria') IS NULL
    ALTER TABLE sgf.plan_trabajo ADD area_usuaria NVARCHAR(300) NULL;
GO
IF COL_LENGTH('sgf.plan_trabajo', 'referencia_lb') IS NULL
    ALTER TABLE sgf.plan_trabajo ADD referencia_lb NVARCHAR(300) NULL;
GO
IF COL_LENGTH('sgf.plan_trabajo', 'supuestos') IS NULL
    ALTER TABLE sgf.plan_trabajo ADD supuestos NVARCHAR(2000) NULL;
GO
IF COL_LENGTH('sgf.plan_trabajo', 'fecha_envio') IS NULL
    ALTER TABLE sgf.plan_trabajo ADD fecha_envio DATE NULL;
GO
IF COL_LENGTH('sgf.plan_trabajo', 'fecha_aprobacion_jefe') IS NULL
    ALTER TABLE sgf.plan_trabajo ADD fecha_aprobacion_jefe DATE NULL;
GO
IF COL_LENGTH('sgf.plan_trabajo', 'aprobado_jefe_por') IS NULL
    ALTER TABLE sgf.plan_trabajo ADD aprobado_jefe_por NVARCHAR(150) NULL;
GO

-- Nuevos estados del plan (la restricción antigua solo admitía cuatro)
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_plan_estado' AND parent_object_id = OBJECT_ID('sgf.plan_trabajo') AND definition NOT LIKE '%EN_REVISION_ADMIN%')
    ALTER TABLE sgf.plan_trabajo DROP CONSTRAINT CK_plan_estado;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_plan_estado' AND parent_object_id = OBJECT_ID('sgf.plan_trabajo'))
    ALTER TABLE sgf.plan_trabajo ADD CONSTRAINT CK_plan_estado
        CHECK (estado IN ('POR_REGISTRAR','RECIBIDO','EN_FORMULACION','EN_REVISION_JEFE','EN_REVISION_ADMIN','OBSERVADO','APROBADO'));
GO
IF (SELECT max_length FROM sys.columns WHERE object_id = OBJECT_ID('sgf.plan_trabajo') AND name = 'estado') < 20
    ALTER TABLE sgf.plan_trabajo ALTER COLUMN estado VARCHAR(20) NOT NULL;
GO

PRINT 'db/09: formulación del plan lista.';
GO
