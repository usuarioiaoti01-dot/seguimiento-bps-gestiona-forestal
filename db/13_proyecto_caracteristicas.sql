/* =====================================================================
   13_proyecto_caracteristicas.sql – Características de cada proyecto y documentos del personal
   Idempotente: se puede ejecutar más de una vez.

   No todos los proyectos tienen profesionales, adendas o línea base. Quien registra el proyecto elige:
     con_profesionales   el proyecto tiene uno o más profesionales contratados.
     con_adendas         el proyecto maneja adendas (ampliaciones de plazo).
     con_linea_base      el proyecto tiene línea base (entregables del cronograma).
     con_orden_servicio  el personal se contrata por Orden de Servicio (se adjunta su PDF y se controla su vencimiento).
     con_tdr             se adjuntan los Términos de Referencia del personal.
   contrato.tipo_documento: CONTRATO u ORDEN_SERVICIO (según el proyecto).
   plan_trabajo.documento_origen: nombre del documento con el que se registró un plan ya elaborado.
   Instalación: después de 12 y antes de 05_verificacion.sql.
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF COL_LENGTH('sgf.proyecto', 'con_profesionales') IS NULL
    ALTER TABLE sgf.proyecto ADD con_profesionales BIT NOT NULL CONSTRAINT DF_proyecto_conprof DEFAULT (1);
GO
IF COL_LENGTH('sgf.proyecto', 'con_adendas') IS NULL
    ALTER TABLE sgf.proyecto ADD con_adendas BIT NOT NULL CONSTRAINT DF_proyecto_conaden DEFAULT (1);
GO
IF COL_LENGTH('sgf.proyecto', 'con_linea_base') IS NULL
    ALTER TABLE sgf.proyecto ADD con_linea_base BIT NOT NULL CONSTRAINT DF_proyecto_conlb DEFAULT (1);
GO
IF COL_LENGTH('sgf.proyecto', 'con_orden_servicio') IS NULL
    ALTER TABLE sgf.proyecto ADD con_orden_servicio BIT NOT NULL CONSTRAINT DF_proyecto_conos DEFAULT (0);
GO
IF COL_LENGTH('sgf.proyecto', 'con_tdr') IS NULL
    ALTER TABLE sgf.proyecto ADD con_tdr BIT NOT NULL CONSTRAINT DF_proyecto_contdr DEFAULT (0);
GO

IF COL_LENGTH('sgf.contrato', 'tipo_documento') IS NULL
    ALTER TABLE sgf.contrato ADD tipo_documento VARCHAR(20) NOT NULL CONSTRAINT DF_contrato_tipodoc DEFAULT ('CONTRATO');
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_contrato_tipodoc' AND parent_object_id = OBJECT_ID('sgf.contrato'))
    ALTER TABLE sgf.contrato ADD CONSTRAINT CK_contrato_tipodoc CHECK (tipo_documento IN ('CONTRATO','ORDEN_SERVICIO'));
GO

IF COL_LENGTH('sgf.plan_trabajo', 'documento_origen') IS NULL
    ALTER TABLE sgf.plan_trabajo ADD documento_origen NVARCHAR(300) NULL;
GO

PRINT 'db/13: características del proyecto listas.';
GO
