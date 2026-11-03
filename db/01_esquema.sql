/* =====================================================================
   SEGUIMIENTO DE CONSULTORES BPS – GESTIONA FORESTAL (PI2 Bosques – UE 003)
   01_esquema.sql – Estructura de la base de datos
   Motor: Microsoft SQL Server 2016 o superior (nivel de compatibilidad >= 130)
   Requisitos usados: tablas temporales con control de versiones del sistema
   (historial automático de cada cambio), JSON nativo (ISJSON), DATETIME2.

   Orden de ejecución:
     01_esquema.sql  ->  02_vistas.sql  ->  03_seguridad.sql  ->  04_datos_iniciales.sql

   Antes de ejecutar: cree la base (o use una existente) y seleccione su nombre.
     -- CREATE DATABASE SGF_SEGUIMIENTO COLLATE Modern_Spanish_CI_AS;
     -- USE SGF_SEGUIMIENTO;
   ===================================================================== */
SET NOCOUNT ON;
GO
IF SCHEMA_ID(N'sgf') IS NULL EXEC (N'CREATE SCHEMA sgf AUTHORIZATION dbo;');
GO

/* ---------------------------------------------------------------------
   1. Seguridad de la aplicación y parámetros
   --------------------------------------------------------------------- */
CREATE TABLE sgf.usuario (
    usuario_id      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_usuario PRIMARY KEY,
    correo          NVARCHAR(150)  NOT NULL CONSTRAINT UQ_usuario_correo UNIQUE,
    nombre          NVARCHAR(150)  NOT NULL,
    rol             VARCHAR(10)    NOT NULL CONSTRAINT CK_usuario_rol CHECK (rol IN ('ADMIN','EDITOR','LECTOR')),
    clave_hash      NVARCHAR(200)  NOT NULL,          -- bcrypt; nunca la clave en claro
    debe_cambiar_clave BIT         NOT NULL CONSTRAINT DF_usuario_cambiar DEFAULT (1),
    activo          BIT            NOT NULL CONSTRAINT DF_usuario_activo DEFAULT (1),
    creado_en       DATETIME2(0)   NOT NULL CONSTRAINT DF_usuario_creado DEFAULT (SYSDATETIME()),
    ultimo_acceso   DATETIME2(0)   NULL
);
GO

CREATE TABLE sgf.parametro (
    codigo          VARCHAR(40)    NOT NULL CONSTRAINT PK_parametro PRIMARY KEY,
    valor           NVARCHAR(200)  NOT NULL,
    descripcion     NVARCHAR(300)  NULL,
    actualizado_en  DATETIME2(0)   NOT NULL CONSTRAINT DF_parametro_act DEFAULT (SYSDATETIME()),
    actualizado_por NVARCHAR(150)  NULL
);
GO

CREATE TABLE sgf.feriado (
    fecha           DATE           NOT NULL CONSTRAINT PK_feriado PRIMARY KEY,
    descripcion     NVARCHAR(150)  NOT NULL,
    tipo            VARCHAR(15)    NOT NULL CONSTRAINT CK_feriado_tipo CHECK (tipo IN ('FERIADO','NO_LABORABLE'))
);
GO

/* ---------------------------------------------------------------------
   2. Contratación: consultor -> contrato -> adendas
   Tablas temporales: cada UPDATE guarda la versión anterior en *_historial.
   --------------------------------------------------------------------- */
CREATE TABLE sgf.consultor (
    consultor_id        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_consultor PRIMARY KEY,
    clave               VARCHAR(5)     NOT NULL CONSTRAINT UQ_consultor_clave UNIQUE,
    nombres             NVARCHAR(150)  NOT NULL,
    perfil              NVARCHAR(200)  NULL,          -- servicio verificado (adenda / BPS)
    recurso_cronograma  NVARCHAR(100)  NULL,          -- nombre del recurso en el MS Project
    unidad_contratante  NVARCHAR(50)   NOT NULL CONSTRAINT DF_consultor_ucont DEFAULT (N'OTI'),
    unidad_servicio     NVARCHAR(50)   NOT NULL CONSTRAINT DF_consultor_userv DEFAULT (N'DCGPFFS'),
    proyecto            NVARCHAR(100)  NOT NULL,
    sede                NVARCHAR(50)   NULL,
    estado              VARCHAR(15)    NOT NULL CONSTRAINT CK_consultor_estado CHECK (estado IN ('ACTIVO','NO_RENOVADO','CULMINADO')),
    correo_institucional NVARCHAR(150) NULL,
    -- Datos personales (Ley N.° 29733): visibles solo para ADMIN; no se envían al asistente de IA
    dni                 VARCHAR(12)    NULL,
    telefono            VARCHAR(20)    NULL,
    correo_personal     NVARCHAR(150)  NULL,
    observacion         NVARCHAR(1000) NULL,
    activo              BIT            NOT NULL CONSTRAINT DF_consultor_activo DEFAULT (1),
    revision            INT            NOT NULL CONSTRAINT DF_consultor_rev DEFAULT (1),
    modificado_por      NVARCHAR(150)  NULL,
    valido_desde        DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    valido_hasta        DATETIME2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (valido_desde, valido_hasta)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = sgf.consultor_historial));
GO

CREATE TABLE sgf.contrato (
    contrato_id     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_contrato PRIMARY KEY,
    consultor_id    INT            NOT NULL CONSTRAINT FK_contrato_consultor REFERENCES sgf.consultor (consultor_id),
    numero          NVARCHAR(60)   NOT NULL CONSTRAINT UQ_contrato_numero UNIQUE,  -- 033-2026-MIDAGRI-SERFOR-PKFW
    titulo_tdr      NVARCHAR(300)  NULL,
    servicio        NVARCHAR(300)  NULL,
    fecha_inicio    DATE           NULL,
    expediente      NVARCHAR(40)   NULL,          -- KFW-PB2026...
    observacion     NVARCHAR(1000) NULL,
    activo          BIT            NOT NULL CONSTRAINT DF_contrato_activo DEFAULT (1),
    revision        INT            NOT NULL CONSTRAINT DF_contrato_rev DEFAULT (1),
    modificado_por  NVARCHAR(150)  NULL,
    valido_desde    DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    valido_hasta    DATETIME2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (valido_desde, valido_hasta)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = sgf.contrato_historial));
GO
CREATE INDEX IX_contrato_consultor ON sgf.contrato (consultor_id);
GO

CREATE TABLE sgf.adenda (
    adenda_id       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_adenda PRIMARY KEY,
    contrato_id     INT            NOT NULL CONSTRAINT FK_adenda_contrato REFERENCES sgf.contrato (contrato_id),
    numero          TINYINT        NOT NULL,
    fecha_inicio    DATE           NOT NULL,
    fecha_fin       DATE           NOT NULL,
    estado          VARCHAR(12)    NOT NULL CONSTRAINT CK_adenda_estado CHECK (estado IN ('ANUNCIADA','EN_TRAMITE','FIRMADA','ANULADA')),
    expediente      NVARCHAR(40)   NULL,
    documento_ref   NVARCHAR(300)  NULL,
    fecha_suscripcion DATE         NULL,
    observacion     NVARCHAR(1000) NULL,
    activo          BIT            NOT NULL CONSTRAINT DF_adenda_activo DEFAULT (1),
    revision        INT            NOT NULL CONSTRAINT DF_adenda_rev DEFAULT (1),
    modificado_por  NVARCHAR(150)  NULL,
    valido_desde    DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    valido_hasta    DATETIME2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (valido_desde, valido_hasta),
    CONSTRAINT CK_adenda_fechas CHECK (fecha_fin >= fecha_inicio),
    CONSTRAINT UQ_adenda_numero UNIQUE (contrato_id, numero)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = sgf.adenda_historial));
GO

/* ---------------------------------------------------------------------
   3. Línea base 2026 y control de cambios
   --------------------------------------------------------------------- */
CREATE TABLE sgf.linea_base_entregable (
    entregable_id   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_linea_base PRIMARY KEY,
    consultor_id    INT            NOT NULL CONSTRAINT FK_lb_consultor REFERENCES sgf.consultor (consultor_id),
    edt             VARCHAR(20)    NOT NULL,
    nombre          NVARCHAR(400)  NOT NULL,
    inicio_lb       DATE           NULL,
    fin_lb          DATE           NULL,
    avance_corte    DECIMAL(5,2)   NOT NULL CONSTRAINT DF_lb_avance DEFAULT (0),
    fecha_corte_lb  DATE           NULL,
    situacion       NVARCHAR(200)  NULL,          -- situación frente al plan vigente
    situacion_oti   NVARCHAR(400)  NULL,          -- registro de la OTI
    fuente          NVARCHAR(200)  NULL,
    activo          BIT            NOT NULL CONSTRAINT DF_lb_activo DEFAULT (1),
    revision        INT            NOT NULL CONSTRAINT DF_lb_rev DEFAULT (1),
    modificado_por  NVARCHAR(150)  NULL,
    valido_desde    DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    valido_hasta    DATETIME2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (valido_desde, valido_hasta),
    CONSTRAINT UQ_lb_edt UNIQUE (edt)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = sgf.linea_base_entregable_historial));
GO

CREATE TABLE sgf.control_cambio (
    control_cambio_id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_control_cambio PRIMARY KEY,
    consultor_id    INT            NOT NULL CONSTRAINT FK_cc_consultor REFERENCES sgf.consultor (consultor_id),
    titulo          NVARCHAR(300)  NOT NULL,
    estado          VARCHAR(10)    NOT NULL CONSTRAINT CK_cc_estado CHECK (estado IN ('BORRADOR','APROBADO','RECHAZADO')),
    fecha           DATE           NULL,
    documento_ref   NVARCHAR(300)  NULL,
    observacion     NVARCHAR(1000) NULL,
    activo          BIT            NOT NULL CONSTRAINT DF_cc_activo DEFAULT (1),
    revision        INT            NOT NULL CONSTRAINT DF_cc_rev DEFAULT (1),
    modificado_por  NVARCHAR(150)  NULL,
    valido_desde    DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    valido_hasta    DATETIME2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (valido_desde, valido_hasta)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = sgf.control_cambio_historial));
GO

/* ---------------------------------------------------------------------
   4. Planes de trabajo y actividades
   --------------------------------------------------------------------- */
CREATE TABLE sgf.plan_trabajo (
    plan_id         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_plan PRIMARY KEY,
    consultor_id    INT            NOT NULL CONSTRAINT FK_plan_consultor REFERENCES sgf.consultor (consultor_id),
    adenda_id       INT            NULL     CONSTRAINT FK_plan_adenda REFERENCES sgf.adenda (adenda_id),
    nombre          NVARCHAR(200)  NOT NULL,
    version_plan    NVARCHAR(20)   NULL,
    fuente          NVARCHAR(300)  NULL,
    fecha_recepcion DATE           NULL,
    estado          VARCHAR(15)    NOT NULL CONSTRAINT CK_plan_estado CHECK (estado IN ('POR_REGISTRAR','RECIBIDO','OBSERVADO','APROBADO')),
    tipo_dias       VARCHAR(10)    NOT NULL CONSTRAINT DF_plan_tipo_dias DEFAULT ('CALENDARIO')
                                   CONSTRAINT CK_plan_tipo_dias CHECK (tipo_dias IN ('CALENDARIO','HABILES')),
    observacion     NVARCHAR(1000) NULL,
    activo          BIT            NOT NULL CONSTRAINT DF_plan_activo DEFAULT (1),
    revision        INT            NOT NULL CONSTRAINT DF_plan_rev DEFAULT (1),
    modificado_por  NVARCHAR(150)  NULL,
    valido_desde    DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    valido_hasta    DATETIME2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (valido_desde, valido_hasta)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = sgf.plan_trabajo_historial));
GO
CREATE INDEX IX_plan_consultor ON sgf.plan_trabajo (consultor_id);
GO

CREATE TABLE sgf.actividad (
    actividad_id    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_actividad PRIMARY KEY,
    plan_id         INT            NOT NULL CONSTRAINT FK_actividad_plan REFERENCES sgf.plan_trabajo (plan_id),
    numero          NVARCHAR(20)   NOT NULL,
    orden           INT            NOT NULL,
    descripcion     NVARCHAR(500)  NOT NULL,
    producto        NVARCHAR(300)  NULL,
    edt_ref         NVARCHAR(120)  NULL,
    clasificacion   VARCHAR(12)    NOT NULL CONSTRAINT CK_actividad_clasif CHECK (clasificacion IN ('ALINEADA','REASIGNADA','NUEVA','TRANSVERSAL')),
    entregable_id   INT            NULL CONSTRAINT FK_actividad_lb REFERENCES sgf.linea_base_entregable (entregable_id),
    control_cambio_id INT          NULL CONSTRAINT FK_actividad_cc REFERENCES sgf.control_cambio (control_cambio_id),
    es_hito         BIT            NOT NULL CONSTRAINT DF_actividad_hito DEFAULT (0),
    es_resumen      BIT            NOT NULL CONSTRAINT DF_actividad_resumen DEFAULT (0),
    inicio_plan     DATE           NOT NULL,      -- fechas formuladas en el plan de trabajo
    fin_plan        DATE           NOT NULL,
    inicio_real     DATE           NULL,
    fin_real        DATE           NULL,
    avance          DECIMAL(5,2)   NOT NULL CONSTRAINT DF_actividad_avance DEFAULT (0)
                                   CONSTRAINT CK_actividad_avance CHECK (avance BETWEEN 0 AND 100),
    estado          VARCHAR(10)    NOT NULL CONSTRAINT DF_actividad_estado DEFAULT ('PENDIENTE')
                                   CONSTRAINT CK_actividad_estado CHECK (estado IN ('PENDIENTE','EN_CURSO','CONCLUIDA','SUSPENDIDA','ANULADA')),
    evidencia       NVARCHAR(500)  NULL,
    observacion     NVARCHAR(1000) NULL,
    fecha_revision  DATE           NULL,
    activo          BIT            NOT NULL CONSTRAINT DF_actividad_activo DEFAULT (1),
    revision        INT            NOT NULL CONSTRAINT DF_actividad_rev DEFAULT (1),
    modificado_por  NVARCHAR(150)  NULL,
    valido_desde    DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    valido_hasta    DATETIME2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (valido_desde, valido_hasta),
    CONSTRAINT CK_actividad_fechas CHECK (fin_plan >= inicio_plan),
    CONSTRAINT CK_actividad_real   CHECK (fin_real IS NULL OR inicio_real IS NULL OR fin_real >= inicio_real)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = sgf.actividad_historial));
GO
CREATE INDEX IX_actividad_plan ON sgf.actividad (plan_id, orden);
GO

CREATE TABLE sgf.actividad_dependencia (
    dependencia_id  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_dependencia PRIMARY KEY,
    actividad_id    INT            NOT NULL CONSTRAINT FK_dep_actividad   REFERENCES sgf.actividad (actividad_id),
    predecesora_id  INT            NOT NULL CONSTRAINT FK_dep_predecesora REFERENCES sgf.actividad (actividad_id),
    tipo            CHAR(2)        NOT NULL CONSTRAINT DF_dep_tipo DEFAULT ('FS') CONSTRAINT CK_dep_tipo CHECK (tipo IN ('FS')),
    desfase_dias    INT            NOT NULL CONSTRAINT DF_dep_desfase DEFAULT (0),   -- negativo = solapamiento
    activo          BIT            NOT NULL CONSTRAINT DF_dep_activo DEFAULT (1),
    modificado_por  NVARCHAR(150)  NULL,
    valido_desde    DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    valido_hasta    DATETIME2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (valido_desde, valido_hasta),
    CONSTRAINT CK_dep_distinta CHECK (actividad_id <> predecesora_id),
    CONSTRAINT UQ_dep UNIQUE (actividad_id, predecesora_id)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = sgf.actividad_dependencia_historial));
GO

/* ---------------------------------------------------------------------
   5. Resultados del recálculo (no temporales: se sobreescriben en cada corte)
   --------------------------------------------------------------------- */
CREATE TABLE sgf.recalculo (
    recalculo_id    BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_recalculo PRIMARY KEY,
    fecha_corte     DATE           NOT NULL,
    metodo          VARCHAR(12)    NOT NULL,
    ejecutado_en    DATETIME2(0)   NOT NULL CONSTRAINT DF_recalculo_en DEFAULT (SYSDATETIME()),
    ejecutado_por   NVARCHAR(150)  NOT NULL,
    motivo          NVARCHAR(300)  NULL,
    resumen_json    NVARCHAR(MAX)  NULL CONSTRAINT CK_recalculo_json CHECK (resumen_json IS NULL OR ISJSON(resumen_json) = 1)
);
GO

CREATE TABLE sgf.actividad_pronostico (
    actividad_id    INT            NOT NULL CONSTRAINT PK_act_pron PRIMARY KEY
                                   CONSTRAINT FK_act_pron_actividad REFERENCES sgf.actividad (actividad_id),
    recalculo_id    BIGINT         NOT NULL CONSTRAINT FK_act_pron_recalculo REFERENCES sgf.recalculo (recalculo_id),
    inicio_probable DATE           NULL,
    fin_probable    DATE           NULL,
    desvio_dias     INT            NULL,          -- fin_probable - fin_plan (días calendario)
    avance_esperado DECIMAL(5,2)   NULL,
    situacion       VARCHAR(20)    NULL,          -- A_TIEMPO, ATRASADA, SIN_INICIAR_VENCIDA, CONCLUIDA...
    critica         BIT            NOT NULL CONSTRAINT DF_act_pron_critica DEFAULT (0),
    calculado_en    DATETIME2(0)   NOT NULL CONSTRAINT DF_act_pron_en DEFAULT (SYSDATETIME())
);
GO

CREATE TABLE sgf.plan_pronostico (
    plan_id             INT          NOT NULL CONSTRAINT PK_plan_pron PRIMARY KEY
                                     CONSTRAINT FK_plan_pron_plan REFERENCES sgf.plan_trabajo (plan_id),
    recalculo_id        BIGINT       NOT NULL CONSTRAINT FK_plan_pron_recalculo REFERENCES sgf.recalculo (recalculo_id),
    fecha_corte         DATE         NOT NULL,
    inicio_plan         DATE         NULL,
    fin_plan            DATE         NULL,
    fin_probable        DATE         NULL,
    avance_ponderado    DECIMAL(5,2) NULL,
    avance_esperado     DECIMAL(5,2) NULL,
    spi                 DECIMAL(6,3) NULL,
    fin_vigencia        DATE         NULL,
    holgura_dias        INT          NULL,          -- fin_vigencia - fin_probable
    semaforo            VARCHAR(8)   NULL,          -- VERDE / AMBAR / ROJO / GRIS
    calculado_en        DATETIME2(0) NOT NULL CONSTRAINT DF_plan_pron_en DEFAULT (SYSDATETIME())
);
GO

-- Serie histórica del pronóstico por plan (permite ver cómo "se desliza" la fecha probable)
CREATE TABLE sgf.plan_pronostico_historial (
    recalculo_id        BIGINT       NOT NULL CONSTRAINT FK_pph_recalculo REFERENCES sgf.recalculo (recalculo_id),
    plan_id             INT          NOT NULL CONSTRAINT FK_pph_plan REFERENCES sgf.plan_trabajo (plan_id),
    fecha_corte         DATE         NOT NULL,
    fin_probable        DATE         NULL,
    avance_ponderado    DECIMAL(5,2) NULL,
    avance_esperado     DECIMAL(5,2) NULL,
    spi                 DECIMAL(6,3) NULL,
    holgura_dias        INT          NULL,
    semaforo            VARCHAR(8)   NULL,
    CONSTRAINT PK_pph PRIMARY KEY (recalculo_id, plan_id)
);
GO
CREATE INDEX IX_pph_plan ON sgf.plan_pronostico_historial (plan_id, fecha_corte);
GO

/* ---------------------------------------------------------------------
   6. Bitácora funcional (quién, qué, por qué) y asistente de IA
   La bitácora complementa a las tablas temporales: estas guardan el "qué",
   la bitácora añade el usuario, el motivo y el origen (UI, IA, script).
   --------------------------------------------------------------------- */
CREATE TABLE sgf.bitacora (
    bitacora_id     BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_bitacora PRIMARY KEY,
    fecha           DATETIME2(0)   NOT NULL CONSTRAINT DF_bitacora_fecha DEFAULT (SYSDATETIME()),
    usuario         NVARCHAR(150)  NOT NULL,
    entidad         VARCHAR(40)    NOT NULL,
    entidad_id      INT            NULL,
    consultor_id    INT            NULL,
    accion          VARCHAR(30)    NOT NULL,      -- CREAR, MODIFICAR, ANULAR, RECALCULAR, IA_APLICADA, ACCESO
    cambios_json    NVARCHAR(MAX)  NULL CONSTRAINT CK_bitacora_json CHECK (cambios_json IS NULL OR ISJSON(cambios_json) = 1),
    motivo          NVARCHAR(500)  NULL,
    origen          VARCHAR(10)    NOT NULL CONSTRAINT DF_bitacora_origen DEFAULT ('UI')
                                   CONSTRAINT CK_bitacora_origen CHECK (origen IN ('UI','IA','SCRIPT','SISTEMA'))
);
GO
CREATE INDEX IX_bitacora_fecha ON sgf.bitacora (fecha DESC);
CREATE INDEX IX_bitacora_entidad ON sgf.bitacora (entidad, entidad_id);
CREATE INDEX IX_bitacora_consultor ON sgf.bitacora (consultor_id, fecha DESC);
GO

CREATE TABLE sgf.ia_conversacion (
    conversacion_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_ia_conv PRIMARY KEY CONSTRAINT DF_ia_conv_id DEFAULT (NEWID()),
    usuario         NVARCHAR(150)  NOT NULL,
    titulo          NVARCHAR(200)  NULL,
    iniciada_en     DATETIME2(0)   NOT NULL CONSTRAINT DF_ia_conv_en DEFAULT (SYSDATETIME())
);
GO

CREATE TABLE sgf.ia_mensaje (
    mensaje_id      BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ia_mensaje PRIMARY KEY,
    conversacion_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_ia_msg_conv REFERENCES sgf.ia_conversacion (conversacion_id),
    rol             VARCHAR(10)    NOT NULL CONSTRAINT CK_ia_msg_rol CHECK (rol IN ('user','assistant')),
    contenido_json  NVARCHAR(MAX)  NOT NULL CONSTRAINT CK_ia_msg_json CHECK (ISJSON(contenido_json) = 1),
    modelo          VARCHAR(60)    NULL,
    tokens_entrada  INT            NULL,
    tokens_salida   INT            NULL,
    creado_en       DATETIME2(0)   NOT NULL CONSTRAINT DF_ia_msg_en DEFAULT (SYSDATETIME())
);
GO
CREATE INDEX IX_ia_msg_conv ON sgf.ia_mensaje (conversacion_id, mensaje_id);
GO

PRINT 'Esquema sgf creado.';
GO
