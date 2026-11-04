# -*- coding: utf-8 -*-
"""
Genera la semilla de datos de la aplicación a partir de la matriz de control
"Control Proyecto Desarrollo Gestiona Forestal 2026 - 031126.xlsx".

Salidas:
  data/semilla.json            -> usado por el modo demo (memoria) y por las pruebas
  db/04_datos_iniciales.sql    -> carga inicial en SQL Server

Uso:
  python herramientas/generar_semilla.py [ruta_matriz.xlsx]

No incluye datos personales sensibles (DNI, teléfono, correo personal): no son
necesarios para la finalidad del seguimiento (principio de proporcionalidad,
Ley N.° 29733). Si se requieren, se registran desde la aplicación con rol ADMIN.
"""
import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import openpyxl

RAIZ = Path(__file__).resolve().parent.parent
MATRIZ = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "herramientas" / "matriz_control.xlsx"

wb = openpyxl.load_workbook(MATRIZ, data_only=True)


def iso(v):
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = str(v).strip()
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", s)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return s[:10]


def filas(hoja, desde):
    ws = wb[hoja]
    for r in ws.iter_rows(min_row=desde, values_only=True):
        if r and r[0] not in (None, "", "Clave"):
            yield r


# ------------------------------------------------------------------ consultores
EXP_676 = {"ERB", "EVE", "APA", "CAC"}  # Expediente KFW-PB20260000676
consultores, contratos, adendas, planes = [], [], [], []
fuente_plan = {}
for r in filas("Plan_Trabajo", 4):
    fuente_plan.setdefault(r[0], r[9])

for i, r in enumerate(filas("Consultores", 4), start=1):
    clave, nombre, contrato, adenda_txt, ini, fin, tdr, servicio, recurso, plan_txt, obs = r[:11]
    consultores.append({
        "consultor_id": i, "clave": clave, "nombres": nombre, "perfil": servicio,
        "recurso_cronograma": recurso, "unidad_contratante": "OTI", "unidad_servicio": "DCGPFFS",
        "proyecto": "Gestiona Forestal (PI2 Bosques – UE 003)", "sede": "MIRAFLORES",
        "estado": "ACTIVO", "observacion": obs,
    })
    contratos.append({
        "contrato_id": i, "consultor_id": i, "numero": f"{contrato}-MIDAGRI-SERFOR-PKFW",
        "titulo_tdr": tdr, "servicio": servicio, "fecha_inicio": None,
        "expediente": "KFW-PB20260000676" if clave in EXP_676 else "KFW-PB20260000686",
        "observacion": None,
    })
    n_adenda = int(re.search(r"(\d+)", adenda_txt).group(1))
    adendas.append({
        "adenda_id": len(adendas) + 1, "contrato_id": i, "numero": n_adenda,
        "fecha_inicio": iso(ini), "fecha_fin": iso(fin), "estado": "FIRMADA",
        "expediente": contratos[-1]["expediente"], "documento_ref": f"Adenda N.° {n_adenda:02d} al Contrato N.° {contrato}-2026"
        if "2026" not in str(contrato) else f"Adenda N.° {n_adenda:02d} al Contrato N.° {contrato}",
        "fecha_suscripcion": None, "observacion": "Vigencia según Adendas 03 Consultores BPS 2026 V.03 (03/11/2026).",
    })
    if clave in EXP_676:
        fin_d = fin.date() if isinstance(fin, datetime) else fin
        adendas.append({
            "adenda_id": len(adendas) + 1, "contrato_id": i, "numero": n_adenda + 1,
            "fecha_inicio": (fin_d + timedelta(days=1)).isoformat(), "fecha_fin": "2026-12-31",
            "estado": "ANUNCIADA", "expediente": contratos[-1]["expediente"], "documento_ref": None,
            "fecha_suscripcion": None,
            "observacion": "Anunciada por BPS (M. Manrique) hasta el 31/12/2026; sin documento a la fecha de corte (03/11/2026).",
        })
    m = re.search(r"(\d{2}/\d{2}/\d{4})", plan_txt or "")
    por_registrar = "por registrar" in (obs or "").lower()
    planes.append({
        "plan_id": i, "consultor_id": i, "adenda_id": adendas[-1]["adenda_id"] if clave not in EXP_676 else adendas[-2]["adenda_id"],
        "nombre": f"Plan de trabajo {adenda_txt}", "version_plan": "v.01",
        "fuente": fuente_plan.get(clave), "fecha_recepcion": iso(m.group(1)) if m else None,
        "estado": "POR_REGISTRAR" if por_registrar else "RECIBIDO", "tipo_dias": "CALENDARIO",
        "observacion": plan_txt,
    })

id_por_clave = {c["clave"]: c["consultor_id"] for c in consultores}

# ------------------------------------------------------------------ línea base
linea_base = []
for r in filas("Linea_Base_2026", 4):
    clave, _, edt, nombre, ini, fin, av, situacion, sit_oti = r[:9]
    linea_base.append({
        "entregable_id": len(linea_base) + 1, "consultor_id": id_por_clave[clave], "edt": str(edt),
        "nombre": " ".join(str(nombre).split()), "inicio_lb": iso(ini), "fin_lb": iso(fin),
        "avance_corte": round(float(av or 0) * 100, 2), "fecha_corte_lb": "2026-08-17",
        "situacion": situacion, "situacion_oti": sit_oti or None,
        "fuente": "Gestiona Forestal 2026 v3.mpp (corte 17/08/2026)",
    })
edts = sorted(linea_base, key=lambda e: -len(e["edt"]))


def entregable_de(ref):
    m = re.search(r"\d+(?:\.\d+)+", ref or "")
    if not m:
        return None
    cod = m.group(0)
    for e in edts:
        if cod == e["edt"] or cod.startswith(e["edt"] + "."):
            return e["entregable_id"]
    return None


# ------------------------------------------------------------------ control de cambios
controles = [{
    "control_cambio_id": 1, "consultor_id": id_por_clave["EVE"],
    "titulo": "Acta de Control de Cambios – visualización geoespacial del recorrido de GTF",
    "estado": "BORRADOR", "fecha": "2026-10-15",
    "documento_ref": "Acta Control de Cambios Gestiona Forestal - Egor Villanueva (Borrador) v.01 - 151026.docx",
    "observacion": "Resolver antes de la conformidad del entregable del 13/11/2026.",
}]

# ------------------------------------------------------------------ actividades
CLASIF = {"Alineada a línea base": "ALINEADA", "Reasignada desde otro consultor": "REASIGNADA",
          "Nueva (fuera de línea base)": "NUEVA", "Transversal / soporte": "TRANSVERSAL"}
actividades, dependencias = [], []
plan_de = {p["consultor_id"]: p["plan_id"] for p in planes}
orden = {}
for r in filas("Plan_Trabajo", 4):
    clave, _, num, desc, ini, fin, prod, edt, clas, fuente = r[:10]
    if clas == "Pendiente de registro":
        continue
    cid = id_por_clave[clave]
    orden[cid] = orden.get(cid, 0) + 1
    a = {
        "actividad_id": len(actividades) + 1, "plan_id": plan_de[cid], "numero": str(num),
        "orden": orden[cid] * 10, "descripcion": desc, "producto": prod, "edt_ref": edt,
        "clasificacion": CLASIF[clas], "entregable_id": entregable_de(edt),
        "control_cambio_id": 1 if (clave == "EVE" and CLASIF[clas] == "NUEVA") else None,
        "es_hito": 1 if re.search(r"^(Presentar|Entregar|Presentación)", desc) else 0,
        "es_resumen": 0, "inicio_plan": iso(ini), "fin_plan": iso(fin),
        "inicio_real": None, "fin_real": None, "avance": 0, "estado": "PENDIENTE",
        "evidencia": None, "observacion": None,
    }
    actividades.append(a)

# resúmenes (p. ej., "2" con hijas "2.1", "2.2")
for a in actividades:
    if any(b["plan_id"] == a["plan_id"] and b["numero"].startswith(a["numero"] + ".") for b in actividades):
        a["es_resumen"] = 1


def d(s):
    return date.fromisoformat(s)


# dependencias FS secuenciales que reproducen exactamente las fechas del plan
for pid in sorted({a["plan_id"] for a in actividades}):
    previa = None
    for a in [x for x in actividades if x["plan_id"] == pid]:
        if a["es_resumen"] or a["clasificacion"] == "TRANSVERSAL":
            continue
        if previa:
            desfase = (d(a["inicio_plan"]) - d(previa["fin_plan"])).days - 1
            if -3 <= desfase <= 10:
                dependencias.append({"dependencia_id": len(dependencias) + 1, "actividad_id": a["actividad_id"],
                                     "predecesora_id": previa["actividad_id"], "tipo": "FS",
                                     "desfase_dias": desfase})
        previa = a

# ------------------------------------------------------------------ calendario y parámetros
feriados = [
    ("2026-01-01", "Año Nuevo"), ("2026-04-02", "Jueves Santo"), ("2026-04-03", "Viernes Santo"),
    ("2026-05-01", "Día del Trabajo"), ("2026-06-07", "Batalla de Arica y Día de la Bandera"),
    ("2026-06-29", "San Pedro y San Pablo"), ("2026-07-23", "Día de la Fuerza Aérea del Perú"),
    ("2026-07-28", "Fiestas Patrias"), ("2026-07-29", "Fiestas Patrias"), ("2026-08-06", "Batalla de Junín"),
    ("2026-08-30", "Santa Rosa de Lima"), ("2026-10-08", "Combate de Angamos"), ("2026-11-01", "Todos los Santos"),
    ("2026-12-08", "Inmaculada Concepción"), ("2026-12-09", "Batalla de Ayacucho"), ("2026-12-25", "Navidad"),
    ("2027-01-01", "Año Nuevo"), ("2027-03-25", "Jueves Santo"), ("2027-03-26", "Viernes Santo"),
]
parametros = [
    ("FECHA_CORTE", "", "Fecha de corte del pronóstico (AAAA-MM-DD). Vacío = fecha del día (hora de Lima)."),
    ("METODO_PRONOSTICO", "RENDIMIENTO", "RENDIMIENTO (usa el índice de desempeño del cronograma, SPI) o LINEAL."),
    ("SPI_MINIMO", "0.4", "Piso del SPI para evitar pronósticos desproporcionados con avances iniciales bajos."),
    ("UMBRAL_VIGENCIA_DIAS", "15", "Alerta cuando faltan estos días o menos para el fin de vigencia sin adenda firmada posterior."),
    ("UMBRAL_HOLGURA_DIAS", "5", "Holgura mínima (días) entre la fecha probable de término y el fin de vigencia."),
    ("MODELO_IA", "claude-haiku-5-5", "Modelo del asistente de IA."),
]

semilla = {
    "generado_en": datetime.now().isoformat(timespec="seconds"),
    "fuente": MATRIZ.name,
    "consultores": consultores, "contratos": contratos, "adendas": adendas, "planes": planes,
    "linea_base": linea_base, "controles_cambio": controles, "actividades": actividades,
    "dependencias": dependencias,
    "feriados": [{"fecha": f, "descripcion": n, "tipo": "FERIADO"} for f, n in feriados],
    "parametros": [{"codigo": c, "valor": v, "descripcion": t} for c, v, t in parametros],
}
(RAIZ / "data").mkdir(exist_ok=True)
(RAIZ / "data" / "semilla.json").write_text(json.dumps(semilla, ensure_ascii=False, indent=1), encoding="utf-8")


# ------------------------------------------------------------------ SQL
def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return str(v)
    return "N'" + str(v).replace("'", "''") + "'"


def insert(tabla, filas_, columnas, identidad=True):
    out = []
    if identidad:
        out.append(f"SET IDENTITY_INSERT {tabla} ON;")
    for f in filas_:
        out.append(f"INSERT INTO {tabla} ({', '.join(columnas)}) VALUES ({', '.join(q(f[c]) for c in columnas)});")
    if identidad:
        out.append(f"SET IDENTITY_INSERT {tabla} OFF;")
    return "\n".join(out) + "\n"


sql = [f"""/* =====================================================================
   04_datos_iniciales.sql – Carga inicial
   Generado por herramientas/generar_semilla.py desde: {MATRIZ.name}
   Fecha de generación: {semilla['generado_en']}
   Ejecutar UNA sola vez, después de 01, 02 y 03, sobre una base vacía.
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
"""]
sql.append(insert("sgf.parametro", semilla["parametros"], ["codigo", "valor", "descripcion"], identidad=False))
sql.append(insert("sgf.feriado", semilla["feriados"], ["fecha", "descripcion", "tipo"], identidad=False))
sql.append(insert("sgf.consultor", consultores, ["consultor_id", "clave", "nombres", "perfil", "recurso_cronograma",
                                                 "unidad_contratante", "unidad_servicio", "proyecto", "sede", "estado", "observacion"]))
sql.append(insert("sgf.contrato", contratos, ["contrato_id", "consultor_id", "numero", "titulo_tdr", "servicio",
                                              "fecha_inicio", "expediente", "observacion"]))
sql.append(insert("sgf.adenda", adendas, ["adenda_id", "contrato_id", "numero", "fecha_inicio", "fecha_fin", "estado",
                                          "expediente", "documento_ref", "fecha_suscripcion", "observacion"]))
sql.append(insert("sgf.plan_trabajo", planes, ["plan_id", "consultor_id", "adenda_id", "nombre", "version_plan", "fuente",
                                               "fecha_recepcion", "estado", "tipo_dias", "observacion"]))
sql.append(insert("sgf.linea_base_entregable", linea_base, ["entregable_id", "consultor_id", "edt", "nombre", "inicio_lb",
                                                            "fin_lb", "avance_corte", "fecha_corte_lb", "situacion",
                                                            "situacion_oti", "fuente"]))
sql.append(insert("sgf.control_cambio", controles, ["control_cambio_id", "consultor_id", "titulo", "estado", "fecha",
                                                   "documento_ref", "observacion"]))
sql.append(insert("sgf.actividad", actividades, ["actividad_id", "plan_id", "numero", "orden", "descripcion", "producto",
                                                 "edt_ref", "clasificacion", "entregable_id", "control_cambio_id",
                                                 "es_hito", "es_resumen", "inicio_plan", "fin_plan", "avance", "estado"]))
sql.append(insert("sgf.actividad_dependencia", dependencias, ["dependencia_id", "actividad_id", "predecesora_id", "tipo",
                                                              "desfase_dias"]))
sql.append("""INSERT INTO sgf.bitacora (usuario, entidad, entidad_id, accion, cambios_json, motivo, origen)
VALUES (N'sistema', N'carga_inicial', NULL, N'CREAR', NULL,
        N'Carga inicial desde la matriz de control del 03/11/2026', N'SCRIPT');
COMMIT TRANSACTION;
PRINT 'Carga inicial completada.';
GO
""")
(RAIZ / "db" / "04_datos_iniciales.sql").write_text("\n".join(sql), encoding="utf-8")

print(f"consultores={len(consultores)} adendas={len(adendas)} planes={len(planes)} "
      f"actividades={len(actividades)} dependencias={len(dependencias)} linea_base={len(linea_base)}")

# El historial de adendas concluidas (db/fuentes/*.csv) se vuelve a fusionar en la semilla; 04_datos_iniciales.sql no lo incluye.
import subprocess
subprocess.run([sys.executable, str(RAIZ / "herramientas" / "generar_historial.py"), "--solo-semilla"], check=True)
