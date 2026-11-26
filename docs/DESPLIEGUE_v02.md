# Despliegue de la versión 02 (rama `seguimiento-bps-gestiona-forestal-v.02`)

Qué trae la versión 02: varios proyectos con sus características (`db/12`, `db/13`), Orden de Servicio y TDR, registro del plan
desde un documento, almacén documental único (`db/14`) y equipo por proyecto con permisos de escritura (`db/15`).
Detalle funcional en `PLAN_DE_MEJORAS.md` (Etapa 1) y `HANDOFF.md`. Esta guía complementa `docs/DESPLIEGUE_IIS.md`.

**Orden obligatorio:** primero la base (parte A), después el código (parte B). La versión 02 lee las tablas nuevas al arrancar;
sin ellas el servicio no inicia. Al revés no hay problema: el código anterior funciona con las tablas nuevas.

| Parte | Quién | Estado |
|---|---|---|
| A. Scripts de base de datos `db/12` a `db/15` | DBA | **Hecha y verificada el 24/11/2026** (38 de 38 comprobaciones correctas) |
| A'. Scripts `db/16`, `db/17` y `db/18` (Etapas 2 y 3: modalidad, Orden de Servicio con notificación, partes diarios) | DBA | **Pendiente**: obligatorios si se despliega el código con las Etapas 2 y 3 |
| B. Código en el servidor de aplicaciones | OTI | Pendiente |
| C. Después del despliegue | Administrador de la aplicación | Pendiente |

---

## A. Base de datos (DBA)

### A.0 Preparación
1. Copia de respaldo completa de la base de la aplicación antes de empezar.
2. Ejecutar con una cuenta que pueda crear y alterar tablas (`db_owner` o `db_ddladmin`); el usuario de la aplicación no tiene ese permiso.
3. Ejecutar en SSMS, conectado a la base de la aplicación. Los scripts traen sus propios `GO` y se pueden repetir sin riesgo:
   lo que ya existe se salta. No borran datos.

### A.1 Scripts, en este orden

| Script | Qué hace | Verificación |
|---|---|---|
| `db/12_proyectos.sql` | Tabla temporal `sgf.proyecto`; proyecto inicial **GF2026**; `sgf.consultor.proyecto_id` y asigna los consultores existentes a GF2026. Si ya se había ejecutado una versión anterior (con `cui` y `unidad_ejecutora`), esas columnas quedan y no estorban. | `SELECT codigo, nombre FROM sgf.proyecto;` (1 fila) · `SELECT COUNT(*) FROM sgf.consultor WHERE proyecto_id IS NULL;` (0) |
| `db/13_proyecto_caracteristicas.sql` | Banderas `con_profesionales`, `con_adendas`, `con_linea_base`, `con_orden_servicio`, `con_tdr`; `sgf.contrato.tipo_documento`; `sgf.plan_trabajo.documento_origen`. | `SELECT codigo, con_profesionales, con_adendas, con_linea_base, con_orden_servicio, con_tdr FROM sgf.proyecto;` (GF2026: 1, 1, 1, 0, 0) |
| `db/14_documento.sql` | Tabla temporal `sgf.documento` (metadatos de cada archivo: SHA-256, versión, confidencial) y 3 índices. | Al final muestra un conteo por tipo (vacío la primera vez). |
| `db/15_equipo_proyecto.sql` | Tabla temporal `sgf.proyecto_miembro` y dos índices únicos filtrados. **Migración (solo si la tabla está vacía):** cada JEFE_PROYECTO activo queda en el equipo de todos los proyectos existentes, con registro en la bitácora (origen SCRIPT). | Al final lista los equipos. |

### A.1' Scripts de la Etapa 2 (después de `db/15`)

| Script | Qué hace | Verificación |
|---|---|---|
| `db/16_modalidad_proyecto.sql` | `sgf.proyecto.modalidad` (ORDEN_SERVICIO, CONTRATO_ADENDAS, GESTION_INTERNA) deducida de las características; GF2026 queda CONTRATO_ADENDAS con `es_atipico = 1` y su motivo. Amplía `estado` a VARCHAR(20) con REGISTRADO, EN_EJECUCION, SUSPENDIDO, CONCLUIDO, CERRADO y ANULADO; ACTIVO pasa a EN_EJECUCION. Agrega unidad usuaria, objetivo, fecha de cierre y lecciones aprendidas. | Al final lista código, modalidad, atípico y estado (GF2026: CONTRATO_ADENDAS, 1, EN_EJECUCION). |
| `db/17_orden_servicio_entregables.sql` | `sgf.contrato`: notificación (fecha y medio), plazo, fin, monto, estado de la contratación (las existentes quedan EN_EJECUCION), OS anterior, culminación y fecha de registro. `sgf.adenda.tipo_periodo` (las existentes quedan ADENDA). Tabla temporal `sgf.entregable_servicio`. `sgf.actividad.entregable_servicio_id`. Parámetros `UMBRAL_ENTREGABLE_DIAS` (7) y `UMBRAL_BORRADOR_DIAS` (5). | Al final cuenta contrataciones por estado (11 EN_EJECUCION), periodos por tipo (todos ADENDA) y muestra los dos parámetros. |

| `db/18_parte_diario.sql` | Tablas `sgf.parte_diario` y `sgf.parte_diario_item` (no temporales: **solo inserción**; el script NIEGA a `sgf_app` modificarlas o borrarlas, como la bitácora). `sgf.entregable_servicio.fecha_subsanacion`. Parámetros `PLAZO_REVISION_DIAS` (7), `PLAZO_SUBSANACION_DIAS` (5), `PARTE_DIAS_ATRAS` (3) y `UMBRAL_SIN_PARTE_DIAS` (3). | Al final muestra los DENY de `sgf_app` sobre las dos tablas y los cuatro parámetros. |

Notas: `db/16` y `db/17` alteran tablas temporales (agregan columnas y restricciones; `db/16` amplía una columna): SQL Server 2016+
lo admite con el versionado activo. Se pueden repetir sin riesgo.

### A.2 Comprobación final
```sql
-- Tablas temporales nuevas: proyecto, documento, proyecto_miembro (además de las anteriores)
SELECT t.name AS tabla, h.name AS historial
FROM sys.tables t JOIN sys.tables h ON h.object_id = t.history_table_id
WHERE SCHEMA_NAME(t.schema_id) = 'sgf' AND t.temporal_type = 2 ORDER BY t.name;

-- Ejecutado con el usuario de la aplicación: todo debe dar 1
SELECT HAS_PERMS_BY_NAME('sgf.entregable_servicio', 'OBJECT', 'INSERT') AS entregable_insert,  -- tras db/17
       HAS_PERMS_BY_NAME('sgf.documento', 'OBJECT', 'INSERT')        AS documento_insert,
       HAS_PERMS_BY_NAME('sgf.documento', 'OBJECT', 'UPDATE')        AS documento_update,
       HAS_PERMS_BY_NAME('sgf.proyecto_miembro', 'OBJECT', 'INSERT') AS miembro_insert,
       HAS_PERMS_BY_NAME('sgf.proyecto_miembro', 'OBJECT', 'UPDATE') AS miembro_update;
```
No se otorgan permisos nuevos: el rol `sgf_app` tiene `SELECT, INSERT, UPDATE ON SCHEMA::sgf` (`db/03_seguridad.sql`), que
alcanza a las tablas nuevas. `05_verificacion.sql` no cambió (cada script nuevo trae su verificación al final).

### A.3 Resultado de la verificación del 24/11/2026
Las tres tablas existen y son temporales; índices y restricciones completos; todas las columnas que usa la aplicación v.02 están
presentes; GF2026 creado con 11 consultores (ninguno sin proyecto) y 11 contratos tipo CONTRATO; 2 Jefes de Proyecto en el equipo
de GF2026 (bitácora de la migración presente); permisos del usuario de la aplicación correctos (no es `db_owner`); el código v.02
lee la base y calcula GF2026 (11 profesionales) sin errores.

---

## B. Código (servidor de aplicaciones)

En PowerShell como administrador:

1. Bajar la rama e instalar las dependencias:
   ```powershell
   cd C:\apps\seguimiento-actividades
   git fetch
   git checkout seguimiento-bps-gestiona-forestal-v.02
   npm ci --omit=dev
   ```
2. Agregar al `.env` del servidor (las carpetas se crean solas al primer uso; no se versionan):
   ```
   CONTRATOS_PDF_DIR=C:\datos\seguimiento\contratos-pdf
   PLANES_ORIGEN_DIR=C:\datos\seguimiento\planes-origen
   DOCUMENTOS_RAIZ=C:\datos\seguimiento\almacen
   ```
3. Reiniciar el servicio y comprobar que arrancó:
   ```powershell
   Restart-Service SerforiaNodeBackend
   Get-Service SerforiaNodeBackend
   ```
   Si no arranca, revisar el registro de WinSW (carpeta del servicio): un error «Invalid object name 'sgf.proyecto_miembro'»
   o «sgf.documento» significa que falta un script de la parte A.
4. Registrar en el almacén los PDF que ya existen en las carpetas anteriores (no los mueve). Primero simular y revisar:
   ```powershell
   npm run documentos:migrar
   ```
   Luego aplicar:
   ```powershell
   npm run documentos:migrar -- --aplicar
   ```
   Es idempotente: si se repite, solo indexa lo nuevo.
5. En el navegador, Ctrl+F5 en la aplicación.

---

## C. Después del despliegue (Administrador de la aplicación)

1. **Administrar proyectos → Equipo** de GF2026: designar al **responsable** (la migración dejó a los Jefes de Proyecto como
   miembros, sin responsable) y retirar a quien no corresponda.
2. Crear las cuentas JEFE_PROYECTO del Equipo de Desarrollo que falten (Configuración) e integrarlas a sus proyectos.
   Un Jefe de Proyecto **ve todos los proyectos pero solo modifica los de su equipo**; uno sin equipo solo consulta.
3. Comprobar con una cuenta de Jefe de Proyecto que en un proyecto ajeno aparece «Solo lectura» y no hay botones para modificar.
4. Comprobar que el PDF de un plan o de una adenda se sigue viendo, y que uno nuevo queda en `C:\datos\seguimiento\almacen`.
5. Incluir `C:\datos\seguimiento\almacen` en el respaldo del servidor (junto con las demás carpetas de `C:\datos\seguimiento`).

---

## D. Correo diario de alertas (Google Workspace)

Desde el commit que lo agrega, la aplicación usa la dependencia `nodemailer`: al actualizar el código hay que correr
`npm ci --omit=dev` antes de reiniciar. El correo queda **desactivado** hasta completar estos pasos.

1. **Cuenta remitente.** Una cuenta de Google Workspace de la OTI (p. ej. `alertas.oti@serfor.gob.pe`), no una personal.
2. **Autenticación**, una de las dos:
   - **Contraseña de aplicación** (lo más simple): en la cuenta remitente, activar la verificación en dos pasos y crear una
     contraseña de aplicación (Cuenta de Google → Seguridad → Contraseñas de aplicación). El administrador de Workspace debe
     permitirlas. Va en `CORREO_CLAVE` con `CORREO_MODO=clave`.
   - **Cuenta de servicio con delegación de dominio** (si el dominio no permite contraseñas de aplicación): crear la cuenta de
     servicio en Google Cloud, descargar su JSON y, en la Consola de administración de Workspace (Seguridad → Acceso y control
     de datos → Controles de API → Delegación de todo el dominio), autorizar su *client ID* con el alcance
     `https://mail.google.com/`. Guardar el JSON fuera del repositorio (p. ej. `C:\datos\seguimiento\secretos\correo.json`,
     solo lectura para la cuenta del servicio) y poner su ruta en `CORREO_CUENTA_SERVICIO_JSON` con `CORREO_MODO=cuenta_servicio`.
3. **Red:** abrir la salida del servidor de aplicaciones a `smtp.gmail.com`, puerto **465** (TCP).
4. **.env** del servidor (ver `.env.example`): `CORREO_REMITENTE`, `CORREO_MODO` y su credencial, `ALERTAS_HORA` (por
   defecto 07:30), `ALERTAS_SOLO_HABILES`, `ALERTAS_COPIA_ADMIN`, `URL_APLICACION`. Dejar `ALERTAS_CORREO=false` al inicio.
5. Reiniciar el servicio y, como Administrador, en **Configuración → Correo diario de alertas**: «Probar conexión», luego
   «Enviarme una prueba» y revisar la «Vista previa».
6. Si todo está bien, poner `ALERTAS_CORREO=true` y reiniciar. Cada envío queda en la Bitácora (entidad `correo_alertas`).
7. **Reporte mensual para Gerencia** (opcional, misma cuenta): en el `.env`, `REPORTE_MENSUAL_PARA` (destinatarios
   separados por coma), `REPORTE_MENSUAL_DIA_HABIL` (por defecto 1), `REPORTE_MENSUAL_HORA` (por defecto 08:00) y
   `REPORTE_MENSUAL_MONTOS=false` salvo decisión expresa de la Dirección. Reiniciar, ir a **Configuración → Reporte mensual
   para Gerencia por correo**, «Ver PDF» y «Enviarme una prueba»; luego `REPORTE_MENSUAL_CORREO=true` y reiniciar. Se envía una
   vez por mes (el del mes anterior); si el servidor estuvo apagado ese día, en la siguiente revisión. Cada envío queda en la
   Bitácora (entidad `correo_reporte`).

---

## E. Ingreso con Google Workspace

Opcional y desactivado por defecto; la clave local sigue funcionando para todas las cuentas.

1. **Cliente OAuth** (lo crea el administrador de Google Workspace / Google Cloud de SERFOR):
   - Pantalla de consentimiento OAuth de tipo **Interno** (solo cuentas de la organización).
   - Credencial «ID de cliente de OAuth» de tipo **Aplicación web**, con la URI de redirección autorizada
     `https://serforia.serfor.gob.pe/api/auth/google/retorno` (la de `URL_APLICACION` + `/api/auth/google/retorno`).
   - Alcances: `openid`, `email` y `profile` (no se pide acceso a Gmail ni a Drive).
2. **Red:** salida HTTPS (443) del servidor a `accounts.google.com`, `oauth2.googleapis.com` y `www.googleapis.com`.
3. **.env**: `SSO_GOOGLE=true`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_DOMINIO=serfor.gob.pe` y
   `URL_APLICACION`. Con HTTPS, `COOKIE_SEGURA=true`. Reiniciar el servicio.
4. Comprobar: en la pantalla de ingreso aparece «Ingresar con Google (@serfor.gob.pe)»; una cuenta creada por el
   Administrador entra; una que no existe vuelve con «Su cuenta de Google no está registrada» y queda en la Bitácora
   (`ACCESO_RECHAZADO`). Las cuentas se siguen creando en **Configuración → Usuarios** con el mismo correo institucional.

---

## F. Actualizar y empezar de cero (sin ningún proyecto)

Decisión del usuario del 25/11/2026: al actualizar producción la aplicación queda **sin proyectos**. Se borran proyectos,
equipos, profesionales, contratos y órdenes de servicio, adendas, entregables, planes, actividades, línea base, partes
diarios, documentos, pronósticos, conversaciones del asistente y la bitácora. **Se conservan** las cuentas del
Administrador y de los Jefes de Proyecto (con su clave), los parámetros y los feriados; las cuentas de Profesional quedan
desactivadas. Lo hace `db/mantenimiento/reinicio_sin_proyectos.sql` (probado en una base de pruebas con GF2026 y
proyectos con OS: deja todo en cero, incluido el historial temporal, y la numeración vuelve a empezar en 1). Los PDF no
se borran: la carpeta se archiva.

1. **Servidor de aplicaciones** (PowerShell como administrador, en el servidor o con `Enter-PSSession -ComputerName SERFORLIMIIS02`):
   ```powershell
   cd C:\apps\seguimiento-actividades; git log --oneline -1
   Copy-Item .env .env.respaldo-reinicio
   Stop-Service SerforiaNodeBackend
   git pull; git log --oneline -1
   npm ci --omit=dev
   ```
2. **DBA, con el servicio detenido**, en SQL Server (10.6.1.112):
   - Respaldo completo (es la única forma de recuperar lo borrado):
     `BACKUP DATABASE SGF_SEGUIMIENTO TO DISK = N'<carpeta de respaldos>\SGF_SEGUIMIENTO_antes_reinicio_20261125.bak' WITH COPY_ONLY, INIT, CHECKSUM;`
   - Abrir `db/mantenimiento/reinicio_sin_proyectos.sql` (en `C:\apps\seguimiento-actividades` o en GitHub), escribir
     `BORRAR TODOS LOS PROYECTOS` en la línea `@confirmacion` y ejecutarlo en `SGF_SEGUIMIENTO`. Corre en una sola
     transacción. Al final muestra todas las tablas en 0 (la bitácora en 1), las cuentas por perfil y los parámetros y feriados.
3. **Archivar los documentos** (servidor de aplicaciones). Ver dónde están; la línea muestra solo rutas:
   ```powershell
   Select-String -Path C:\apps\seguimiento-actividades\.env -Pattern '_DIR=|DOCUMENTOS_RAIZ='
   ```
   Si todas apuntan a `C:\datos\seguimiento\...`:
   ```powershell
   Rename-Item C:\datos\seguimiento seguimiento-archivo-20261125; New-Item -ItemType Directory C:\datos\seguimiento
   ```
   La aplicación vuelve a crear las subcarpetas cuando las necesita. Si alguna variable falta, esa carpeta está en
   `C:\apps\seguimiento-actividades\data\<carpeta>`: muévala también al archivo (no toque `data\semilla.json`).
4. **Encender y comprobar**:
   ```powershell
   Start-Service SerforiaNodeBackend; Get-Service SerforiaNodeBackend
   Invoke-WebRequest http://localhost:3080/api/auth/opciones -UseBasicParsing | Select-Object StatusCode, Content
   ```
   Debe salir `Running` y `200`.
5. **En el navegador** (Ctrl+F5): https://serforia.serfor.gob.pe con la cuenta de siempre. El Tablero general aparece
   en cero y el menú sin proyectos. El primer proyecto se registra en **Administrar proyectos → Registrar proyecto** y
   recibe el código `PRY-2026-001`; luego, en «Equipo», se asigna a los Jefes de Proyecto (sus cuentas siguen activas).

**Si hubiera que volver atrás:** el DBA restaura el respaldo del paso 2, se devuelve el nombre a la carpeta archivada
(`Rename-Item C:\datos\seguimiento-archivo-20261125 seguimiento`, después de quitar la nueva) y se reinicia el servicio.

---

## Volver atrás (si hiciera falta)
Las tablas y columnas nuevas no estorban al código anterior. Basta con volver el código a `main` y reiniciar:
```powershell
cd C:\apps\seguimiento-actividades
git checkout main
Restart-Service SerforiaNodeBackend
```
No hace falta deshacer los scripts ni restaurar la copia de respaldo. Los PDF que se hayan subido con la versión 02 quedan en
`C:\datos\seguimiento\almacen`; el código anterior no los ve, pero no se pierden.
