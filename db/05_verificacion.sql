/* =====================================================================
   05_verificacion.sql – Comprobaciones posteriores a la instalación
   (solo lectura; puede ejecutarse cuantas veces se requiera)
   ===================================================================== */
SET NOCOUNT ON;

-- 1. Conteos de la carga inicial (esperado: 11 consultores, 34 adendas [15 de la carga inicial + 19 concluidas de 06], 11 planes, 100 actividades, 61 dependencias, 62 entregables)
SELECT 'consultor' AS tabla, COUNT(*) AS filas FROM sgf.consultor
UNION ALL SELECT 'adenda', COUNT(*) FROM sgf.adenda
UNION ALL SELECT 'plan_trabajo', COUNT(*) FROM sgf.plan_trabajo
UNION ALL SELECT 'actividad', COUNT(*) FROM sgf.actividad
UNION ALL SELECT 'actividad_dependencia', COUNT(*) FROM sgf.actividad_dependencia
UNION ALL SELECT 'linea_base_entregable', COUNT(*) FROM sgf.linea_base_entregable
UNION ALL SELECT 'feriado', COUNT(*) FROM sgf.feriado
UNION ALL SELECT 'parametro', COUNT(*) FROM sgf.parametro;

-- 2. Tablas temporales activas (deben figurar 8)
SELECT s.name + '.' + t.name AS tabla, h.name AS historial
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.tables h ON h.object_id = t.history_table_id
WHERE s.name = 'sgf' AND t.temporal_type = 2
ORDER BY tabla;

-- 3. Vigencia por consultor
SELECT clave, nombres, adenda_vigente, fin_vigencia, dias_restantes, adenda_siguiente, estado_adenda_siguiente, fin_vigencia_potencial
FROM sgf.v_vigencia_consultor ORDER BY dias_restantes;

-- 4. Último pronóstico persistido por la aplicación (vacío hasta que la aplicación arranque por primera vez)
SELECT clave, plan_trabajo, fin_plan, fin_probable, holgura_dias, semaforo, avance_ponderado, avance_esperado, spi, calculado_en
FROM sgf.v_estado_plan ORDER BY holgura_dias;

-- 5. Nivel de compatibilidad (se requiere >= 130 para OPENJSON)
SELECT name, compatibility_level FROM sys.databases WHERE name = DB_NAME();

-- 6. Historial de adendas (06): 19 concluidas (Adendas 01 y 02) y su cobertura contra la adenda siguiente
SELECT estado, COUNT(*) AS adendas FROM sgf.adenda GROUP BY estado ORDER BY estado;

-- 7. Días sin cobertura (>0) o superposición (<0) entre una adenda y la siguiente del mismo contrato
--    (se consideran CONCLUIDA y FIRMADA; 0 = vigencias contiguas). Debe devolver 0 filas con los datos actuales.
WITH v AS (
    SELECT contrato_id, numero, fecha_inicio, fecha_fin,
           LAG(fecha_fin)  OVER (PARTITION BY contrato_id ORDER BY fecha_inicio, numero) AS fin_anterior,
           LAG(numero)     OVER (PARTITION BY contrato_id ORDER BY fecha_inicio, numero) AS n_anterior
    FROM sgf.adenda WHERE activo = 1 AND estado IN ('CONCLUIDA', 'FIRMADA'))
SELECT k.numero AS contrato, v.n_anterior, v.numero AS n_siguiente, v.fin_anterior, v.fecha_inicio,
       DATEDIFF(DAY, v.fin_anterior, v.fecha_inicio) - 1 AS dias_sin_cobertura
FROM v JOIN sgf.contrato k ON k.contrato_id = v.contrato_id
WHERE v.fin_anterior IS NOT NULL AND DATEDIFF(DAY, v.fin_anterior, v.fecha_inicio) - 1 <> 0
ORDER BY k.numero;

-- 8. Perfiles de usuario (07): administrador, jefe de proyecto y un PROFESIONAL por consultor (11 una vez creadas las cuentas)
SELECT rol, activo, COUNT(*) AS cuentas FROM sgf.usuario GROUP BY rol, activo ORDER BY rol, activo;
SELECT c.clave, c.nombres, u.correo, u.activo, u.debe_cambiar_clave
FROM sgf.consultor c LEFT JOIN sgf.usuario u ON u.consultor_id = c.consultor_id
ORDER BY c.clave;
