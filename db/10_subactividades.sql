/* =====================================================================
   10_subactividades.sql – Días y subactividades de las actividades del plan
   Idempotente: se puede ejecutar más de una vez.

   dias_plan        días hábiles de la actividad; las fechas se calculan con ellos.
   subactividades   JSON [{"t":"texto","d":días,"p":"producto / evidencia"}]; la suma de sus días no excede dias_plan.
   La tabla es temporal: las versiones anteriores quedan en sgf.actividad_historial.
   Instalación: después de 09 y antes de 05_verificacion.sql.
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF COL_LENGTH('sgf.actividad', 'dias_plan') IS NULL
    ALTER TABLE sgf.actividad ADD dias_plan INT NULL;
GO
IF COL_LENGTH('sgf.actividad', 'subactividades') IS NULL
    ALTER TABLE sgf.actividad ADD subactividades NVARCHAR(MAX) NULL;
GO
IF (SELECT max_length FROM sys.columns WHERE object_id = OBJECT_ID('sgf.actividad') AND name = 'subactividades') <> -1
    ALTER TABLE sgf.actividad ALTER COLUMN subactividades NVARCHAR(MAX) NULL;
GO

PRINT 'db/10: días y subactividades listos.';
GO
