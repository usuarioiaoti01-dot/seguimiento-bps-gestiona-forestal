/* =====================================================================
   02_vistas.sql – Vistas de consulta y reporte
   Pensadas para reportes (Power BI, Excel) y para auditoría; la aplicación
   calcula el pronóstico en el servidor y lo persiste en *_pronostico.
   La fecha "hoy" se toma en hora de Lima (SA Pacific Standard Time).
   ===================================================================== */
SET NOCOUNT ON;
GO

CREATE OR ALTER FUNCTION sgf.fn_hoy_lima ()
RETURNS DATE
AS
BEGIN
    RETURN CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'SA Pacific Standard Time' AS DATE);
END;
GO

/* Vigencia contractual por consultor: última adenda FIRMADA y adenda en curso */
CREATE OR ALTER VIEW sgf.v_vigencia_consultor
AS
SELECT
    c.consultor_id, c.clave, c.nombres, c.perfil, c.estado AS estado_consultor,
    k.contrato_id, k.numero AS contrato, k.expediente,
    v.adenda_id        AS adenda_vigente_id,
    v.numero           AS adenda_vigente,
    v.fecha_inicio     AS inicio_vigencia,
    v.fecha_fin        AS fin_vigencia,
    DATEDIFF(DAY, sgf.fn_hoy_lima(), v.fecha_fin) AS dias_restantes,
    s.adenda_id        AS adenda_siguiente_id,
    s.numero           AS adenda_siguiente,
    s.estado           AS estado_adenda_siguiente,
    s.fecha_fin        AS fin_vigencia_potencial
FROM sgf.consultor c
JOIN sgf.contrato k ON k.consultor_id = c.consultor_id AND k.activo = 1
OUTER APPLY (SELECT TOP (1) a.adenda_id, a.numero, a.fecha_inicio, a.fecha_fin
             FROM sgf.adenda a
             WHERE a.contrato_id = k.contrato_id AND a.activo = 1 AND a.estado = 'FIRMADA'
             ORDER BY a.fecha_fin DESC, a.numero DESC) v
OUTER APPLY (SELECT TOP (1) a.adenda_id, a.numero, a.estado, a.fecha_fin
             FROM sgf.adenda a
             WHERE a.contrato_id = k.contrato_id AND a.activo = 1 AND a.estado IN ('ANUNCIADA','EN_TRAMITE')
             ORDER BY a.numero DESC) s
WHERE c.activo = 1;
GO

/* Estado de cada plan con el último pronóstico persistido */
CREATE OR ALTER VIEW sgf.v_estado_plan
AS
SELECT
    p.plan_id, p.nombre AS plan_trabajo, p.estado AS estado_plan, p.tipo_dias, p.fecha_recepcion,
    v.consultor_id, v.clave, v.nombres, v.contrato, v.adenda_vigente, v.fin_vigencia, v.dias_restantes,
    v.adenda_siguiente, v.estado_adenda_siguiente, v.fin_vigencia_potencial,
    pp.fecha_corte, pp.inicio_plan, pp.fin_plan, pp.fin_probable,
    pp.avance_ponderado, pp.avance_esperado, pp.spi, pp.holgura_dias, pp.semaforo, pp.calculado_en,
    (SELECT COUNT(*) FROM sgf.actividad a WHERE a.plan_id = p.plan_id AND a.activo = 1 AND a.estado <> 'ANULADA') AS actividades
FROM sgf.plan_trabajo p
JOIN sgf.v_vigencia_consultor v ON v.consultor_id = p.consultor_id
LEFT JOIN sgf.plan_pronostico pp ON pp.plan_id = p.plan_id
WHERE p.activo = 1;
GO

/* Actividades con su pronóstico */
CREATE OR ALTER VIEW sgf.v_actividad_seguimiento
AS
SELECT
    c.clave, c.nombres, p.plan_id, a.actividad_id, a.numero, a.orden, a.descripcion, a.producto,
    a.clasificacion, lb.edt AS edt_linea_base, a.edt_ref, a.es_hito, a.es_resumen,
    a.inicio_plan, a.fin_plan, a.inicio_real, a.fin_real, a.avance, a.estado,
    ap.inicio_probable, ap.fin_probable, ap.desvio_dias, ap.avance_esperado, ap.situacion, ap.critica,
    cc.estado AS estado_control_cambio, a.evidencia, a.observacion, a.fecha_revision, a.modificado_por
FROM sgf.actividad a
JOIN sgf.plan_trabajo p ON p.plan_id = a.plan_id
JOIN sgf.consultor c ON c.consultor_id = p.consultor_id
LEFT JOIN sgf.actividad_pronostico ap ON ap.actividad_id = a.actividad_id
LEFT JOIN sgf.linea_base_entregable lb ON lb.entregable_id = a.entregable_id
LEFT JOIN sgf.control_cambio cc ON cc.control_cambio_id = a.control_cambio_id
WHERE a.activo = 1;
GO

/* Cobertura de la línea base por los planes vigentes */
CREATE OR ALTER VIEW sgf.v_cobertura_linea_base
AS
SELECT
    c.clave, c.nombres, lb.entregable_id, lb.edt, lb.nombre, lb.inicio_lb, lb.fin_lb, lb.avance_corte,
    lb.situacion, lb.situacion_oti,
    x.actividades_vinculadas,
    CASE WHEN lb.avance_corte >= 100 THEN 'CONCLUIDO'
         WHEN x.actividades_vinculadas > 0 THEN 'CUBIERTO'
         ELSE 'NO_CUBIERTO' END AS cobertura
FROM sgf.linea_base_entregable lb
JOIN sgf.consultor c ON c.consultor_id = lb.consultor_id
OUTER APPLY (SELECT COUNT(*) AS actividades_vinculadas
             FROM sgf.actividad a
             WHERE a.entregable_id = lb.entregable_id AND a.activo = 1 AND a.estado <> 'ANULADA') x
WHERE lb.activo = 1;
GO

/* Consumo del asistente de IA (sustento para el dimensionamiento de tokens) */
CREATE OR ALTER VIEW sgf.v_uso_ia
AS
SELECT
    c.usuario, CAST(m.creado_en AS DATE) AS dia, m.modelo,
    COUNT(*) AS respuestas,
    SUM(ISNULL(m.tokens_entrada, 0)) AS tokens_entrada,
    SUM(ISNULL(m.tokens_salida, 0))  AS tokens_salida
FROM sgf.ia_mensaje m
JOIN sgf.ia_conversacion c ON c.conversacion_id = m.conversacion_id
WHERE m.rol = 'assistant'
GROUP BY c.usuario, CAST(m.creado_en AS DATE), m.modelo;
GO

/* Historial completo de una actividad (tabla temporal):
     SELECT * FROM sgf.actividad FOR SYSTEM_TIME ALL WHERE actividad_id = 42 ORDER BY valido_desde;
   Estado de todo el proyecto a una fecha:
     SELECT * FROM sgf.actividad FOR SYSTEM_TIME AS OF '2026-11-15T23:59:59';  */
PRINT 'Vistas creadas.';
GO
