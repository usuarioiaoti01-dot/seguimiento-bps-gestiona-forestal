#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Incorpora el historial de adendas concluidas (Adendas 01 y 02) desde
db/fuentes/historial_adendas_01_02.csv (separador ";", fechas ISO).

  - Fusiona las filas en data/semilla.json (modo demo/memoria y pruebas). Es idempotente:
    reemplaza las filas CONCLUIDA anteriores y conserva el resto.
  - Genera db/06_historial_adendas.sql (SQL Server). 04_datos_iniciales.sql NO se toca.

Uso:
  python herramientas/generar_historial.py                 # semilla + db/06
  python herramientas/generar_historial.py --solo-semilla  # solo data/semilla.json (lo usa generar_semilla.py)
"""
import csv
import json
import re
import sys
from datetime import date
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

RAIZ = Path(__file__).resolve().parent.parent
CSV = RAIZ / "db" / "fuentes" / "historial_adendas_01_02.csv"
SEMILLA = RAIZ / "data" / "semilla.json"
SQL = RAIZ / "db" / "06_historial_adendas.sql"
ESTADOS = {"concluida": "CONCLUIDA"}


def leer():
    filas = []
    with open(CSV, encoding="utf-8-sig", newline="") as f:
        for n, r in enumerate(csv.DictReader(f, delimiter=";"), start=2):
            if not (r.get("contrato") or "").strip():
                continue
            estado = ESTADOS.get(r["estado"].strip().lower())
            if not estado:
                raise SystemExit(f"Línea {n}: estado no reconocido {r['estado']!r}")
            ini, fin = date.fromisoformat(r["inicio"]), date.fromisoformat(r["fin"])
            plazo = int(r["plazo_dias"])
            if (fin - ini).days + 1 != plazo:
                print(f"AVISO línea {n} ({r['contrato'][:3]} Ad. {r['adenda_n']}): plazo_dias={plazo} pero las fechas suman {(fin - ini).days + 1} días")
            obs = (r.get("observacion") or "").strip()
            sol = re.search(r"Solicitados?\s+(\d+)\s*d", obs, re.I)
            filas.append({
                "contrato": r["contrato"].strip(),
                "numero": int(r["adenda_n"]),
                "fecha_inicio": ini.isoformat(),
                "fecha_fin": fin.isoformat(),
                "estado": estado,
                "fecha_suscripcion": r["fecha_suscripcion"].strip() or None,
                "plazo_dias": plazo,
                "plazo_solicitado_dias": int(sol.group(1)) if sol else None,
                "inicio_calculado": 1 if r["inicio_calculado"].strip().upper() == "SI" else 0,
                "observacion": obs or None,
            })
    claves = [(f["contrato"], f["numero"]) for f in filas]
    if len(set(claves)) != len(claves):
        raise SystemExit("El CSV repite un par (contrato, adenda_n)")
    return filas


def fusionar_semilla(filas):
    s = json.loads(SEMILLA.read_text(encoding="utf-8"))
    por_numero = {c["numero"]: c["contrato_id"] for c in s["contratos"]}
    faltan = sorted({f["contrato"] for f in filas if f["contrato"] not in por_numero})
    if faltan:
        raise SystemExit(f"Contratos del CSV que no existen en la semilla: {faltan}")
    base = [a for a in s["adendas"] if a["estado"] != "CONCLUIDA"]
    sig = max(a["adenda_id"] for a in base) + 1
    nuevas = []
    for i, f in enumerate(filas):
        nuevas.append({
            "adenda_id": sig + i, "contrato_id": por_numero[f["contrato"]], "numero": f["numero"],
            "fecha_inicio": f["fecha_inicio"], "fecha_fin": f["fecha_fin"], "estado": f["estado"],
            "expediente": None, "documento_ref": None, "fecha_suscripcion": f["fecha_suscripcion"],
            "plazo_dias": f["plazo_dias"], "plazo_solicitado_dias": f["plazo_solicitado_dias"],
            "inicio_calculado": f["inicio_calculado"], "observacion": f["observacion"],
        })
    colision = {(a["contrato_id"], a["numero"]) for a in base} & {(a["contrato_id"], a["numero"]) for a in nuevas}
    if colision:
        raise SystemExit(f"El historial choca con adendas ya cargadas (contrato_id, n.°): {sorted(colision)}")
    s["adendas"] = base + nuevas
    SEMILLA.write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"data/semilla.json: {len(nuevas)} adendas concluidas (total {len(s['adendas'])})")


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, int):
        return str(v)
    return "N'" + str(v).replace("'", "''") + "'"


PLANTILLA = """/* =====================================================================
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
{valores};

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
    VALUES (N'sistema', 'adenda', 'CREAR', N'{{"adendas_concluidas_insertadas":' + CAST(@n AS NVARCHAR(10)) + N'}}',
            N'Carga del historial de adendas 01 y 02 (db/fuentes/historial_adendas_01_02.csv)', 'SCRIPT');

COMMIT TRANSACTION;
SELECT @n AS adendas_insertadas;
GO
"""


def generar_sql(filas):
    cols = ["contrato", "numero", "fecha_inicio", "fecha_fin", "fecha_suscripcion", "plazo_dias", "plazo_solicitado_dias", "inicio_calculado", "observacion"]
    valores = ",\n".join("    (" + ", ".join(q(f[c]) for c in cols) + ")" for f in filas)
    SQL.write_text(PLANTILLA.format(valores=valores), encoding="utf-8")
    print(f"{SQL.relative_to(RAIZ)}: {len(filas)} filas")


if __name__ == "__main__":
    filas = leer()
    fusionar_semilla(filas)
    if "--solo-semilla" not in sys.argv:
        generar_sql(filas)
