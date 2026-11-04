/* =====================================================================
   06_historial_adendas.sql – Historial de adendas concluidas (Adendas 01 y 02)
   Generado por herramientas/generar_historial.py desde db/fuentes/historial_adendas_01_02.csv.
   NO editar a mano: se cambia el CSV y se vuelve a generar.

   - Agrega a sgf.adenda: plazo_dias, plazo_solicitado_dias e inicio_calculado
     (fecha_suscripcion y observacion ya existen) y admite el estado CONCLUIDA.
   - Idempotente: cada fila se identifica por (contrato, n.° de adenda); si ya existe, no se toca.
   - Cada adenda se vincula con su consultor por el número de contrato (sgf.contrato.numero).
   - No modifica 04_datos_iniciales.sql. Instalación: después de 04 y antes de 05_verificacion.sql.

   Pendientes de verificación (no corregidos aquí):
   - Contratos 057 (K. Atuncar) y 064 (J. Correa): el Excel de Adendas 03 los consigna como 026 y 029.
   - Adenda 01: fecha de suscripción exacta por confirmar (entre 04 y 05/06/2026); el inicio está calculado.
   - Contrato 123 (J. Montalbán): el Excel de Adendas 03 indica inicio 02/10 de la siguiente; aquí 31/10 (verificar).
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- 1. Columnas nuevas (la tabla es temporal: las columnas nulables se propagan solas a sgf.adenda_historial)
IF COL_LENGTH('sgf.adenda', 'plazo_dias') IS NULL ALTER TABLE sgf.adenda ADD plazo_dias SMALLINT NULL;
IF COL_LENGTH('sgf.adenda', 'plazo_solicitado_dias') IS NULL ALTER TABLE sgf.adenda ADD plazo_solicitado_dias SMALLINT NULL;
IF COL_LENGTH('sgf.adenda', 'inicio_calculado') IS NULL ALTER TABLE sgf.adenda ADD inicio_calculado BIT NULL;
GO

-- 2. Estado CONCLUIDA y validación de plazos
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_adenda_estado' AND parent_object_id = OBJECT_ID('sgf.adenda') AND definition LIKE '%CONCLUIDA%')
BEGIN
    ALTER TABLE sgf.adenda DROP CONSTRAINT CK_adenda_estado;
    ALTER TABLE sgf.adenda ADD CONSTRAINT CK_adenda_estado CHECK (estado IN ('ANUNCIADA','EN_TRAMITE','FIRMADA','ANULADA','CONCLUIDA'));
END
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_adenda_plazo' AND parent_object_id = OBJECT_ID('sgf.adenda'))
    ALTER TABLE sgf.adenda ADD CONSTRAINT CK_adenda_plazo CHECK (
        (plazo_dias IS NULL OR plazo_dias > 0) AND (plazo_solicitado_dias IS NULL OR plazo_solicitado_dias > 0));
GO

-- 3. Carga del historial
DECLARE @h TABLE (
    contrato NVARCHAR(60) NOT NULL, numero TINYINT NOT NULL, fecha_inicio DATE NOT NULL, fecha_fin DATE NOT NULL,
    fecha_suscripcion DATE NULL, plazo_dias SMALLINT NULL, plazo_solicitado_dias SMALLINT NULL,
    inicio_calculado BIT NULL, observacion NVARCHAR(1000) NULL);

INSERT INTO @h (contrato, numero, fecha_inicio, fecha_fin, fecha_suscripcion, plazo_dias, plazo_solicitado_dias, inicio_calculado, observacion) VALUES
    (N'034-2026-MIDAGRI-SERFOR-PKFW', 1, N'2026-05-13', N'2026-08-10', NULL, 90, NULL, 1, N'Suscrita entre 04 y 05/06/2026 (fecha exacta por confirmar)'),
    (N'034-2026-MIDAGRI-SERFOR-PKFW', 2, N'2026-08-11', N'2026-11-08', N'2026-09-09', 90, 180, 0, N'Solicitados 180 dias'),
    (N'035-2026-MIDAGRI-SERFOR-PKFW', 1, N'2026-05-13', N'2026-08-10', NULL, 90, NULL, 1, N'Suscrita entre 04 y 05/06/2026 (fecha exacta por confirmar)'),
    (N'035-2026-MIDAGRI-SERFOR-PKFW', 2, N'2026-08-11', N'2026-11-08', N'2026-09-09', 90, 180, 0, N'Solicitados 180 dias'),
    (N'037-2026-MIDAGRI-SERFOR-PKFW', 1, N'2026-05-17', N'2026-08-14', NULL, 90, NULL, 1, N'Suscrita entre 04 y 05/06/2026 (fecha exacta por confirmar)'),
    (N'037-2026-MIDAGRI-SERFOR-PKFW', 2, N'2026-08-15', N'2026-10-13', N'2026-09-09', 60, 180, 0, N'Solicitados 180 dias'),
    (N'040-2026-MIDAGRI-SERFOR-PKFW', 1, N'2026-05-18', N'2026-08-15', NULL, 90, NULL, 1, N'Suscrita entre 04 y 05/06/2026 (fecha exacta por confirmar)'),
    (N'040-2026-MIDAGRI-SERFOR-PKFW', 2, N'2026-08-16', N'2026-10-14', N'2026-09-09', 60, 180, 0, N'Solicitados 180 dias'),
    (N'039-2026-MIDAGRI-SERFOR-PKFW', 1, N'2026-05-18', N'2026-08-15', NULL, 90, NULL, 1, N'Suscrita entre 04 y 05/06/2026 (fecha exacta por confirmar)'),
    (N'039-2026-MIDAGRI-SERFOR-PKFW', 2, N'2026-08-16', N'2026-10-14', N'2026-09-09', 60, 180, 0, N'Solicitados 180 dias'),
    (N'038-2026-MIDAGRI-SERFOR-PKFW', 1, N'2026-05-18', N'2026-08-15', NULL, 90, NULL, 1, N'Suscrita entre 04 y 05/06/2026 (fecha exacta por confirmar)'),
    (N'038-2026-MIDAGRI-SERFOR-PKFW', 2, N'2026-08-16', N'2026-10-14', N'2026-09-09', 60, 180, 0, N'Solicitados 180 dias'),
    (N'057-2026-MIDAGRI-SERFOR-PKFW', 1, N'2026-06-02', N'2026-08-30', NULL, 90, NULL, 1, N'Contrato figura como 026-2026 en el Excel de Adendas 03 (verificar)'),
    (N'057-2026-MIDAGRI-SERFOR-PKFW', 2, N'2026-08-31', N'2026-10-29', N'2026-09-09', 60, 180, 0, N'Solicitados 180 dias'),
    (N'064-2026-MIDAGRI-SERFOR-PKFW', 1, N'2026-06-03', N'2026-08-31', NULL, 90, NULL, 1, N'Contrato figura como 029-2026 en el Excel de Adendas 03 (verificar)'),
    (N'064-2026-MIDAGRI-SERFOR-PKFW', 2, N'2026-09-01', N'2026-10-30', N'2026-09-09', 60, 180, 0, N'Solicitados 180 dias'),
    (N'101-2026-MIDAGRI-SERFOR-PKFW', 1, N'2026-06-25', N'2026-09-22', NULL, 90, NULL, 1, N'Suscrita entre 04 y 05/06/2026 (fecha exacta por confirmar)'),
    (N'101-2026-MIDAGRI-SERFOR-PKFW', 2, N'2026-09-23', N'2026-10-22', N'2026-09-09', 30, 180, 0, N'Solicitados 180 dias'),
    (N'123-2026-MIDAGRI-SERFOR-PKFW', 1, N'2026-08-02', N'2026-10-30', N'2026-08-31', 90, NULL, 0, N'Unica adenda previa del contrato 123. Excel de Adendas 03 indica inicio 02/10 de la siguiente (probable 31/10, verificar)');

IF EXISTS (SELECT 1 FROM @h h WHERE NOT EXISTS (SELECT 1 FROM sgf.contrato k WHERE k.numero = h.contrato))
    THROW 50006, 'El historial de adendas referencia contratos que no existen en sgf.contrato.', 1;

BEGIN TRANSACTION;

INSERT INTO sgf.adenda (contrato_id, numero, fecha_inicio, fecha_fin, estado, fecha_suscripcion, plazo_dias, plazo_solicitado_dias, inicio_calculado, observacion, modificado_por)
SELECT k.contrato_id, h.numero, h.fecha_inicio, h.fecha_fin, 'CONCLUIDA', h.fecha_suscripcion, h.plazo_dias, h.plazo_solicitado_dias, h.inicio_calculado, h.observacion, N'script 06_historial_adendas'
FROM @h h
JOIN sgf.contrato k ON k.numero = h.contrato
WHERE NOT EXISTS (SELECT 1 FROM sgf.adenda a WHERE a.contrato_id = k.contrato_id AND a.numero = h.numero);

DECLARE @n INT = @@ROWCOUNT;
IF @n > 0
    INSERT INTO sgf.bitacora (usuario, entidad, accion, cambios_json, motivo, origen)
    VALUES (N'sistema', 'adenda', 'CREAR', N'{"adendas_concluidas_insertadas":' + CAST(@n AS NVARCHAR(10)) + N'}',
            N'Carga del historial de adendas 01 y 02 (db/fuentes/historial_adendas_01_02.csv)', 'SCRIPT');

COMMIT TRANSACTION;
SELECT @n AS adendas_insertadas;
GO
