/* =====================================================================
   11_actividad_agregada_por.sql – Quién agregó la actividad al plan
   Idempotente: se puede ejecutar más de una vez.

   agregada_por   NULL = la formuló el profesional; 'JEFE_PROYECTO' o 'ADMIN' = la agregó esa
                  persona al revisar el plan propuesto (se muestra marcada en el formulario y en el PDF).
   Instalación: después de 10 y antes de 05_verificacion.sql.
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF COL_LENGTH('sgf.actividad', 'agregada_por') IS NULL
    ALTER TABLE sgf.actividad ADD agregada_por VARCHAR(20) NULL;
GO

PRINT 'db/11: agregada_por listo.';
GO
