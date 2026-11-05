# Despliegue en servidor institucional (Windows Server + IIS)

La aplicación es **Node.js 22+** (no usa .NET). Se publica así: un **servicio de Windows** ejecuta Node en un puerto local
(solo accesible desde el propio servidor) e **IIS** actúa de proxy inverso con HTTPS delante.

```
Navegador ──HTTPS──▶ IIS (sitio + web.config) ──▶ 127.0.0.1:3080 (servicio Node.js) ──▶ SQL Server
```

El administrador del servidor ya dejó preparado: la carpeta del sitio (`C:\inetpub\wwwroot\serforia`) y el servicio de Windows
**«SERFOR - Backend Node.js»** (Node.js en el puerto **3080**, inicio automático). Esta guía **reutiliza** ambos en lugar de crear otros.

## 0. Requisitos en el servidor (los instala el administrador)

| Requisito | Detalle |
|---|---|
| Node.js | 22 LTS o superior, 64 bits, para todos los usuarios (`node -v` desde una consola nueva). |
| IIS + módulos | **URL Rewrite** y **Application Request Routing (ARR)**, con el proxy activado (*Server Proxy Settings → Enable proxy*). |
| NSSM | Con él se ejecuta Node como servicio (https://nssm.cc). Si el servicio ya existe, probablemente ya está instalado. |
| Certificado | El del dominio institucional, enlazado (*binding* https 443) al sitio. |
| SQL Server | Una base vacía, un usuario de aplicación y conectividad al puerto 1433 desde este servidor. |
| Salida a internet | `api.anthropic.com:443`, solo si se usará el asistente de IA y la lectura de PDF/Word. |

## 1. Revisar lo que ya dejó el administrador

En PowerShell como administrador (solo lectura; no cambia nada):

```powershell
node -v                                        # debe ser v22 o superior
Get-Command nssm                               # debe existir (si no, pedir su instalación)
sc.exe qc "SERFOR - Backend Node.js"           # inicio, cuenta y ejecutable del servicio
nssm get "SERFOR - Backend Node.js" Application
nssm get "SERFOR - Backend Node.js" AppParameters
nssm get "SERFOR - Backend Node.js" AppDirectory
nssm get "SERFOR - Backend Node.js" AppEnvironmentExtra
Get-ChildItem C:\inetpub\wwwroot\serforia -Force   # ¿está vacía? ¿ya tiene un web.config?
Get-Website | Select-Object name, physicalPath, state ; Get-WebBinding   # sitio y enlaces (puertos 80/443, host)
Get-Module -ListAvailable WebAdministration, IISAdministration | Select-Object Name   # módulos de IIS
```

Con eso se sabe dónde espera el servicio el código (`AppDirectory`) y si el sitio ya tiene `web.config` y HTTPS. **Si el sitio ya
tiene un `web.config` que reenvía a `127.0.0.1:3080`, consérvelo** y solo compárelo con el de esta guía.

## 2. Dónde va el código

| Opción | Cuándo | Cómo |
|---|---|---|
| **A (recomendada)** | Se puede cambiar el `AppDirectory` del servicio. | Código en `C:\apps\seguimiento-actividades`; en la carpeta del sitio solo el `web.config`. Así nada del código ni el `.env` queda dentro de `inetpub`. |
| **B** | El servicio ya apunta a `C:\inetpub\wwwroot\serforia` y se prefiere no moverlo. | Código directamente en esa carpeta, junto con `deploy\iis\web.config` copiado a su raíz. Ese archivo reenvía **todas** las rutas a Node y oculta `server`, `db`, `data`, `.env`, etc., de modo que IIS no sirve nada del código. |

```powershell
# Opción A (ejemplo)
git clone https://github.com/usuarioiaoti01-dot/seguimiento-bps-gestiona-forestal.git C:\apps\seguimiento-actividades
Copy-Item C:\apps\seguimiento-actividades\deploy\iis\web.config C:\inetpub\wwwroot\serforia\web.config
```

Sin `git`: descargue el ZIP del repositorio y descomprímalo en la carpeta elegida. Para actualizar después: `git pull` y reiniciar el servicio.

## 3. Base de datos

Con un usuario `db_owner` y sobre la base vacía, en este orden: `db\01_esquema.sql`, `02_vistas.sql`, `03_seguridad.sql`
(crea los roles; al final hay una plantilla para el login de la aplicación), `04_datos_iniciales.sql`, `06_historial_adendas.sql`,
`07_perfiles_usuario.sql` y por último `05_verificacion.sql`. Con la conexión ya configurada, `npm run bd:instalar` hace lo mismo.
**Pruebe los scripts primero en una copia**: 06 y 07 aún no se ejecutaron en un SQL Server real.

## 4. Configuración (`.env` en la carpeta del código)

Copie `.env.example` a `.env` y complete (el archivo nunca se sube a GitHub):

```ini
PUERTO=3080                    # el mismo del servicio y del web.config
MODO_DATOS=sqlserver
SQL_SERVIDOR=...               SQL_PUERTO=1433
SQL_BASE=SGF_SEGUIMIENTO       SQL_USUARIO=usr_sgf_app      SQL_CLAVE=...
SQL_CIFRAR=true                SQL_CONFIAR_CERTIFICADO=true # false si el certificado de SQL Server es de una CA reconocida
SESION_SECRETO=<cadena aleatoria de 48+ caracteres>
COOKIE_SEGURA=true             # solo con HTTPS
TRUST_PROXY=1                  # un proxy (IIS) delante: el límite de intentos usa la IP real
ADMIN_CORREO=mmontoya@serfor.gob.pe
ADMIN_CLAVE_INICIAL=<clave temporal; se pide cambiarla al ingresar>
ANTHROPIC_API_KEY=...          # opcional: asistente de IA y lectura de PDF/Word
# Carpetas de datos FUERA del código (entran en el respaldo y sobreviven a las actualizaciones):
PLANES_PDF_DIR=D:\datos\seguimiento\planes-pdf
DOCUMENTOS_DIR=D:\datos\seguimiento\documentos
```

Para generar `SESION_SECRETO`: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
Restrinja el acceso al `.env` (solo administradores y la cuenta del servicio). `NODE_ENV=production` lo fija el servicio.

## 5. Servicio de Windows

En PowerShell **como administrador**. Primero en simulación (muestra la configuración actual del servicio y lo que cambiaría):

```powershell
cd <carpeta del código>
.\deploy\iis\instalar-servicio.ps1 -Ruta <carpeta del código> -WhatIf
```

El servicio de esta instalación ya existe, así que el script **no lo toca** si no se le indica `-Reconfigurar`. Cuando lo revisado
sea correcto (con el servicio detenido):

```powershell
Stop-Service "SERFOR - Backend Node.js"
.\deploy\iis\instalar-servicio.ps1 -Ruta <carpeta del código> -Reconfigurar
```

El script comprueba Node 22+, instala las dependencias (`npm ci --omit=dev`), da permisos mínimos a la cuenta del servicio
(lectura del código y escritura solo en `data`, `logs` y las carpetas de datos del `.env`), deja el servicio con inicio automático,
reinicio si falla y registro en `logs\servicio.log`, lo inicia y verifica que responda. Si el servicio no existiera, lo crea.

## 6. Sitio de IIS

1. El sitio apunta a `C:\inetpub\wwwroot\serforia` (o la carpeta que corresponda) con su *binding* https y el certificado.
2. El *application pool* del sitio en **No Managed Code** (no se usa .NET).
3. En ARR (*Server Proxy Settings*): proxy activado y, si se cargan PDF grandes o se usa la lectura con IA, **Time-out** de 120 s o más.
4. `web.config` según el paso 2 (si cambió el puerto, ajústelo en la regla `AplicacionNode`).

## 7. Verificación

- `https://<dominio>/` muestra la pantalla de ingreso, con candado, y `http://` redirige a `https://`.
- Un archivo interno no se descarga: `https://<dominio>/.env`, `/server/server.js` y `/db/01_esquema.sql` deben dar 404.
- Ingresar con `ADMIN_CORREO` y la clave inicial: pide cambiarla. Luego crear las cuentas (Configuración → Usuarios → *Crear cuentas de profesionales*).
- `Get-Content <código>\logs\servicio.log -Tail 20` sin errores y `Get-Service "SERFOR - Backend Node.js"` en *Running*.

## 8. Operación

| Tarea | Cómo |
|---|---|
| Actualizar | `cd <código>; git pull; npm ci --omit=dev; Restart-Service "SERFOR - Backend Node.js"` |
| Respaldo | La base de datos y las carpetas `PLANES_PDF_DIR` y `DOCUMENTOS_DIR`. El `.env` guárdelo aparte y protegido. |
| Ver errores | `logs\servicio.log` (rota a los 10 MB). |
| Detener / iniciar | `Stop-Service` / `Start-Service "SERFOR - Backend Node.js"` |
