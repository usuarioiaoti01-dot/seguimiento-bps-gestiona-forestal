# Seguimiento Actividades Gestiona Forestal 2026

Aplicación web de la OTI del SERFOR para el seguimiento de la **contratación (adendas) y vigencia**, los **planes de trabajo** y la **fecha probable de término** de los consultores BPS que desarrollan el Gestiona Forestal (PI2 Bosques – UE 003), con **asistente de IA (Claude Haiku)** y **trazabilidad completa en SQL Server**.

Datos iniciales: matriz de control del 03/11/2026 (11 profesionales de la Adenda V.03, 100 actividades de planes de trabajo, 61 dependencias, 62 entregables de la línea base 2026 y 15 adendas, incluidas las N.° 04 anunciadas para E. Ramírez, E. Villanueva, A. Pimentel y C. Álvarez).

---

## 1. Puesta en marcha rápida (modo demostración, sin base de datos)

Requisitos: Node.js 22 o superior.

```bash
npm install
copy .env.example .env        # en PowerShell: Copy-Item .env.example .env
# en .env: ADMIN_CORREO y ADMIN_CLAVE_INICIAL (y ANTHROPIC_API_KEY para el asistente)
npm run dev
```

Abra http://localhost:3080, ingrese con el correo y la clave inicial y defina su clave personal. En modo `memoria` los cambios se guardan en `data/demo-estado.json` (bórrelo para reiniciar la demo).

## 2. Instalación de la base de datos (SQL Server 2016 o superior)

**Opción rápida (desde la carpeta del proyecto, con las credenciales SQL_* del `.env`):**
```powershell
npm run bd:probar      # prueba conexión, versión, compatibilidad y permisos
npm run bd:instalar    # ejecuta db/01 a db/07 en orden (06 y 07 antes de la verificación 05) (requiere db_owner; no se repite si ya existe el esquema)
```

**Opción manual (SSMS o sqlcmd):**

1. Cree la base (o use una existente) con intercalación en español:
   ```sql
   CREATE DATABASE SGF_SEGUIMIENTO COLLATE Modern_Spanish_CI_AS;
   ```
2. Ejecute, **en este orden** y sobre esa base (SSMS o `sqlcmd`):

   | Script | Qué hace |
   |---|---|
   | `db/01_esquema.sql` | Esquema `sgf`: 18 tablas, 8 de ellas **temporales** (historial automático de cada cambio), índices y restricciones. |
   | `db/02_vistas.sql` | Vistas de reporte: vigencia, estado de planes, actividades, cobertura de línea base y consumo de IA. |
   | `db/03_seguridad.sql` | Roles `sgf_app` (aplicación, sin DELETE) y `sgf_lectura` (reportes, sin datos personales). Incluye plantilla del login. |
   | `db/04_datos_iniciales.sql` | Carga inicial desde la matriz de control (una sola vez). |
   | `db/06_historial_adendas.sql` | Historial de adendas concluidas (01 y 02): columnas `plazo_dias`, `plazo_solicitado_dias`, `inicio_calculado`, estado `CONCLUIDA` y carga idempotente desde `db/fuentes/historial_adendas_01_02.csv`. Se genera con `npm run historial`; no editar a mano. |
   | `db/07_perfiles_usuario.sql` | Perfiles `ADMIN` / `JEFE_PROYECTO` / `PROFESIONAL` y vínculo de cada cuenta con su consultor (una por profesional). Migra EDITOR → JEFE_PROYECTO. |
   | `db/05_verificacion.sql` | Comprobaciones (conteos, tablas temporales, vigencias, historial y días sin cobertura). |

   ```bat
   sqlcmd -S <servidor> -d SGF_SEGUIMIENTO -E -i db\01_esquema.sql
   sqlcmd -S <servidor> -d SGF_SEGUIMIENTO -E -i db\02_vistas.sql
   sqlcmd -S <servidor> -d SGF_SEGUIMIENTO -E -i db\03_seguridad.sql
   sqlcmd -S <servidor> -d SGF_SEGUIMIENTO -E -i db\04_datos_iniciales.sql
   sqlcmd -S <servidor> -d SGF_SEGUIMIENTO -E -i db\05_verificacion.sql
   ```
3. El DBA crea el login `usr_sgf_app` y lo agrega al rol `sgf_app` (plantilla al final de `03_seguridad.sql`).
4. En `.env`: `MODO_DATOS=sqlserver`, `SQL_SERVIDOR`, `SQL_BASE`, `SQL_USUARIO`, `SQL_CLAVE`. Al arrancar, la aplicación crea el primer administrador y guarda el primer pronóstico.

> Consultas útiles del historial (las fechas de `valido_desde/valido_hasta` están en UTC):
> `SELECT * FROM sgf.actividad FOR SYSTEM_TIME ALL WHERE actividad_id = 42;`
> `SELECT * FROM sgf.adenda FOR SYSTEM_TIME AS OF '2026-11-15T23:59:59';`

## 3. Qué hace la aplicación

| Módulo | Funciones |
|---|---|
| **Tablero** | Indicadores, gráfico *vigencia vs. término probable*, semáforo por profesional, alertas priorizadas, exportación CSV, recálculo manual. Fecha de corte seleccionable (consulta "a fecha"). |
| **Ficha del profesional** | Contrato y adendas (registrar / firmar / anular), plan de trabajo, actividades editables en línea (avance, estado) o en detalle (fechas, evidencia, predecesoras), cronograma plan vs. probable con líneas de corte y vigencia, ruta crítica, simulación "¿qué pasa si…?", adopción de fechas probables como reprogramación formal, línea base, actas de control de cambios, evolución del pronóstico, historial y bitácora. |
| **Contratos y adendas** | Vista consolidada con situación al corte. |
| **Línea base 2026** | Cobertura de los 62 entregables (concluido / cubierto / no cubierto) y anotaciones de la OTI. |
| **Bitácora** | Quién, cuándo, qué (antes → después), por qué y origen (UI / IA / script). |
| **Seguimiento Actividades** | Tarjetas de avance, días de atraso, actividades sin inicio y plan aprobado; tabla de profesionales; **Cargar documento**: Excel/CSV con plantilla, cronogramas (Excel o XML de MS Project) y PDF/Word (leídos por el asistente de IA) con vista previa y confirmación antes de actualizar actividades, avance, adendas y planes. |
| **Configuración** | Parámetros del pronóstico, feriados, usuarios y perfiles (alta de las cuentas de los profesionales, restablecer claves, desactivar cuentas), consumo de tokens del asistente. |
| **Asistente IA** | Consulta datos con herramientas, explica desvíos, simula, redacta correos o párrafos, y propone cambios que el usuario aplica. |

### Cálculo de la fecha probable (se ejecuta tras cada cambio)
- Actividad **concluida**: termina en su fecha real.
- **Sin iniciar** y con inicio vencido: se reprograma desde la fecha de corte, conservando su duración, y arrastra a sus sucesoras (dependencias fin→inicio con desfase).
- **Iniciada**: lo que falta se proyecta según su rendimiento (SPI = avance real / esperado, con piso `SPI_MINIMO`) o en forma lineal (`METODO_PRONOSTICO`).
- Plan: término probable = máximo de sus actividades; **holgura** = fin de vigencia (última adenda firmada) − término probable. Las adendas anunciadas o en trámite se muestran como **vigencia potencial**, sin ampliar la vigencia.
- Días calendario por defecto; cada plan puede usar días hábiles con el calendario de feriados.

> Importante: hoy ninguna actividad tiene avance registrado; el pronóstico asume que lo vencido no se ejecutó. El primer paso operativo es registrar el avance real con cada consultor.

## 4. Seguridad, gobierno de datos e IA
- Perfiles: **Administrador** (acceso total; crea usuarios y modifica perfiles; único que ve datos personales), **Jefe de Proyecto** (todo lo demás: seguimiento, adendas, reprogramaciones, parámetros, aplicar propuestas de IA) y **Profesional** (solo su ficha; modifica el estado y el avance de sus actividades). Cada profesional tiene su cuenta; las claves temporales se entregan una sola vez y se cambian en el primer ingreso.
- Claves con bcrypt, sesión en cookie `httpOnly` + `SameSite=Strict`, cabecera anti-CSRF, límite de intentos de ingreso, cabeceras de seguridad (CSP) y concurrencia optimista (409 si otro usuario cambió el registro).
- Bajas lógicas; la bitácora es de solo inserción (`DENY UPDATE`); historial por tablas temporales.
- **Ley N.° 29733**: DNI, teléfono y correo personal no se cargan en la semilla, solo los ve ADMIN y nunca se envían al modelo de IA.
- **Supervisión humana de la IA**: el asistente no escribe en la base; las propuestas se aplican con un clic de un Jefe de Proyecto o Administrador y quedan con origen `IA` y el nombre de quien aprobó. El consumo de tokens queda en `sgf.ia_mensaje` / `sgf.v_uso_ia` (insumo para dimensionar los créditos de IA).

## 5. Despliegue para compartir con colaboradores
- Servidor Windows/Linux de la OTI con Node.js 22+, ejecutado como servicio (p. ej. NSSM en Windows o `systemd`/PM2 en Linux).
- Publicar detrás de IIS (ARR) o Nginx con **HTTPS** y `COOKIE_SEGURA=true`, `NODE_ENV=production`, `SESION_SECRETO` aleatorio.
- Despliegue en Google Cloud (Cloud Run + Cloud SQL para SQL Server): ver [docs/DESPLIEGUE_GOOGLE_CLOUD.md](docs/DESPLIEGUE_GOOGLE_CLOUD.md).
- Detrás de un proxy inverso o de Cloud Run, defina `TRUST_PROXY` (nº de saltos de proxy; Cloud Run = `1`). Si no, el límite de intentos de ingreso agrupa a todos los usuarios en una sola IP.
- Hay un `Dockerfile` (Node 22, escucha en el puerto 8080 y se ejecuta como usuario sin privilegios): `docker build -t sgf-seguimiento .`. La imagen no incluye `.env`; pase la configuración como variables de entorno.
- Acceso solo desde la red institucional/VPN. Salida a `api.anthropic.com` habilitada en el firewall o proxy (`NODE_USE_ENV_PROXY=1` + `HTTPS_PROXY`).

## 6. Trabajo con Claude Code
Abra la carpeta del proyecto y ejecute `claude`. El archivo **CLAUDE.md** contiene la arquitectura, las reglas invariantes y el backlog. Ejemplos de pedidos:
- "Agrega inicio de sesión con Google Workspace manteniendo los roles actuales."
- "Crea un reporte mensual en PDF por profesional con el estado del plan y las alertas."
- "Registra las actividades del plan de Alfred Sosa a partir de este cronograma (adjunto)."

Pruebas: `npm test` (motor de cálculo, flujo completo de la API y agente con cliente simulado).
Regenerar la semilla desde una matriz actualizada: `python herramientas/generar_semilla.py ruta\a\matriz.xlsx` (requiere `pip install openpyxl`).
