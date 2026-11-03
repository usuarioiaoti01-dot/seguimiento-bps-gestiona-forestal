/* =====================================================================
   05_verificacion.sql – Comprobaciones posteriores a la instalación
   (solo lectura; puede ejecutarse cuantas veces se requiera)
   ===================================================================== */
SET NOCOUNT ON;

-- 1. Conteos de la carga inicial (esperado: 11 consultores, 15 adendas, 11 planes, 100 actividades, 61 dependencias, 62 entregables)
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
