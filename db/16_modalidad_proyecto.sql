/* =====================================================================
   16_modalidad_proyecto.sql – Modalidad y estados del proyecto (Etapa 2 de PLAN_DE_MEJORAS.md)
   Idempotente: se puede ejecutar más de una vez.

   modalidad:
     ORDEN_SERVICIO    proceso estándar de la OTI: un TDR y una Orden de Servicio por profesional; el plazo corre
                       desde el día siguiente de la notificación y se sigue por entregables (db/17).
     CONTRATO_ADENDAS  caso atípico (GF2026, Dirección de Control – Gestiona Forestal): contrato con adendas
                       sucesivas y línea base propia. Solo el Administrador lo usa, con motivo escrito.
     GESTION_INTERNA   proyecto sin profesionales contratados.
   Las banderas con_* de db/13 se mantienen: la aplicación las deriva de la modalidad.
   estado: REGISTRADO → EN_EJECUCION → CONCLUIDO → CERRADO; también SUSPENDIDO y ANULADO. ACTIVO pasa a EN_EJECUCION.
   Nuevos datos: es_atipico, motivo_atipico, unidad_usuaria, objetivo, fecha_cierre, lecciones_aprendidas.
   Los permisos de sgf_app ya cubren el esquema completo (03_seguridad.sql).
   Instalación: después de 15 y antes de 05_verificacion.sql.
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF COL_LENGTH('sgf.proyecto', 'modalidad') IS NULL
    ALTER TABLE sgf.proyecto ADD modalidad VARCHAR(20) NULL;
GO
IF COL_LENGTH('sgf.proyecto', 'es_atipico') IS NULL
    ALTER TABLE sgf.proyecto ADD es_atipico BIT NOT NULL CONSTRAINT DF_proyecto_atipico DEFAULT (0);
GO
IF COL_LENGTH('sgf.proyecto', 'motivo_atipico') IS NULL
    ALTER TABLE sgf.proyecto ADD motivo_atipico NVARCHAR(500) NULL;
GO
IF COL_LENGTH('sgf.proyecto', 'unidad_usuaria') IS NULL
    ALTER TABLE sgf.proyecto ADD unidad_usuaria NVARCHAR(200) NULL;   -- dirección o unidad que requiere el proyecto
GO
IF COL_LENGTH('sgf.proyecto', 'objetivo') IS NULL
    ALTER TABLE sgf.proyecto ADD objetivo NVARCHAR(1000) NULL;
GO
IF COL_LENGTH('sgf.proyecto', 'fecha_cierre') IS NULL
    ALTER TABLE sgf.proyecto ADD fecha_cierre DATE NULL;
GO
IF COL_LENGTH('sgf.proyecto', 'lecciones_aprendidas') IS NULL
    ALTER TABLE sgf.proyecto ADD lecciones_aprendidas NVARCHAR(2000) NULL;
GO

-- Modalidad de los proyectos existentes, según sus características (db/13)
UPDATE sgf.proyecto
   SET modalidad = CASE WHEN con_profesionales = 0 THEN 'GESTION_INTERNA'
                        WHEN con_adendas = 1 THEN 'CONTRATO_ADENDAS'
                        ELSE 'ORDEN_SERVICIO' END,
       es_atipico = CASE WHEN con_profesionales = 1 AND con_adendas = 1 THEN 1 ELSE 0 END,
       motivo_atipico = CASE WHEN codigo = 'GF2026'
                             THEN N'Dirección de Control – Gestiona Forestal: equipo de profesionales BPS contratados desde 2025 con contrato y adendas sucesivas; cronograma propio (MS Project v3) financiado por KfW.'
                             WHEN con_profesionales = 1 AND con_adendas = 1 THEN N'Proyecto con contrato y adendas registrado antes de la modalidad (db/16).'
                             ELSE NULL END,
       modificado_por = N'db/16'
 WHERE modalidad IS NULL;
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('sgf.proyecto') AND name = 'modalidad' AND is_nullable = 1)
    ALTER TABLE sgf.proyecto ALTER COLUMN modalidad VARCHAR(20) NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_proyecto_modalidad')
    ALTER TABLE sgf.proyecto ADD CONSTRAINT DF_proyecto_modalidad DEFAULT ('ORDEN_SERVICIO') FOR modalidad;
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_proyecto_modalidad')
    ALTER TABLE sgf.proyecto ADD CONSTRAINT CK_proyecto_modalidad CHECK (modalidad IN ('ORDEN_SERVICIO', 'CONTRATO_ADENDAS', 'GESTION_INTERNA'));
GO

-- Estados del proyecto: se amplía la columna (VARCHAR(10) no alcanza para EN_EJECUCION) y la restricción
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_proyecto_estado' AND definition NOT LIKE '%EN_EJECUCION%')
    ALTER TABLE sgf.proyecto DROP CONSTRAINT CK_proyecto_estado;
GO
IF (SELECT max_length FROM sys.columns WHERE object_id = OBJECT_ID('sgf.proyecto') AND name = 'estado') < 20
BEGIN
    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_proyecto_estado')
        ALTER TABLE sgf.proyecto DROP CONSTRAINT DF_proyecto_estado;
    ALTER TABLE sgf.proyecto ALTER COLUMN estado VARCHAR(20) NOT NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_proyecto_estado')
    ALTER TABLE sgf.proyecto ADD CONSTRAINT DF_proyecto_estado DEFAULT ('REGISTRADO') FOR estado;
GO
UPDATE sgf.proyecto SET estado = 'EN_EJECUCION', modificado_por = N'db/16' WHERE estado = 'ACTIVO';
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_proyecto_estado')
    ALTER TABLE sgf.proyecto ADD CONSTRAINT CK_proyecto_estado CHECK (estado IN ('REGISTRADO', 'EN_EJECUCION', 'SUSPENDIDO', 'CONCLUIDO', 'CERRADO', 'ANULADO'));
GO

IF NOT EXISTS (SELECT 1 FROM sgf.bitacora WHERE usuario = N'db/16')
    INSERT INTO sgf.bitacora (usuario, entidad, accion, cambios_json, motivo, origen)
    VALUES (N'db/16', 'proyecto', 'MODIFICAR', N'{"modalidad":"derivada de las características","estado":"ACTIVO -> EN_EJECUCION"}',
            N'Modalidad y estados del proyecto (GF2026 queda como caso atípico CONTRATO_ADENDAS)', 'SCRIPT');
GO

-- Verificación
SELECT codigo, modalidad, es_atipico, estado, LEFT(motivo_atipico, 80) AS motivo_atipico FROM sgf.proyecto ORDER BY proyecto_id;
PRINT 'db/16: modalidad y estados del proyecto listos.';
GO
