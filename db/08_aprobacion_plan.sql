/* =====================================================================
   08_aprobacion_plan.sql – Aprobación del plan de trabajo
   Idempotente: se puede ejecutar más de una vez.

   Agrega a sgf.plan_trabajo los datos de la revisión del plan:
     fecha_aprobacion      fecha en que se aprobó el plan (estado APROBADO).
     fecha_subsanacion     plazo (fecha límite) para subsanar las observaciones (estado OBSERVADO).
     observacion_revision  observaciones formuladas al plan (estado OBSERVADO).
   La tabla es temporal: las versiones anteriores quedan en sgf.plan_trabajo_historial.
   Instalación: después de 07 y antes de 05_verificacion.sql.
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF COL_LENGTH('sgf.plan_trabajo', 'fecha_aprobacion') IS NULL
    ALTER TABLE sgf.plan_trabajo ADD fecha_aprobacion DATE NULL;
GO
IF COL_LENGTH('sgf.plan_trabajo', 'fecha_subsanacion') IS NULL
    ALTER TABLE sgf.plan_trabajo ADD fecha_subsanacion DATE NULL;
GO
IF COL_LENGTH('sgf.plan_trabajo', 'observacion_revision') IS NULL
    ALTER TABLE sgf.plan_trabajo ADD observacion_revision NVARCHAR(1000) NULL;
GO

PRINT 'db/08: columnas de aprobación del plan listas.';
GO
