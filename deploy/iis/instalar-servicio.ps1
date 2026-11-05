<#
.SYNOPSIS
  Deja la aplicación corriendo como servicio de Windows (NSSM): crea el servicio o configura el que el administrador ya preparó.
.DESCRIPTION
  Ejecutar como administrador, en el servidor, con la aplicación ya copiada y su .env ya creado.
  - Si el servicio NO existe, lo crea.
  - Si YA existe (p. ej. el que dejó el administrador), no lo modifica salvo que se indique -Reconfigurar; antes de cambiar
    nada muestra su configuración actual para que quede constancia.
  - Con -WhatIf muestra lo que haría sin cambiar nada.
.EXAMPLE
  .\instalar-servicio.ps1 -Ruta C:\inetpub\wwwroot\serforia -WhatIf
  .\instalar-servicio.ps1 -Ruta C:\inetpub\wwwroot\serforia -Reconfigurar
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$Ruta = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [int]$Puerto = 3080,
  [string]$Servicio = 'SERFOR - Backend Node.js',
  [string]$Cuenta = 'NT AUTHORITY\LocalService',
  [string]$Nssm = 'nssm',
  [switch]$Reconfigurar
)
$ErrorActionPreference = 'Stop'
function Paso($t) { Write-Host "`n== $t" -ForegroundColor Cyan }

Paso 'Comprobando requisitos'
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw 'Node.js no está instalado (o no está en el PATH del sistema). Se requiere la versión 22 LTS o superior.' }
$version = [version](& node -v).TrimStart('v')
if ($version.Major -lt 22) { throw "Se requiere Node.js 22 o superior; hay $version." }
if (-not (Test-Path (Join-Path $Ruta 'server\server.js'))) { throw "No se encontró server\server.js en $Ruta" }
if (-not (Test-Path (Join-Path $Ruta '.env'))) { throw "Falta el archivo .env en $Ruta (copie .env.example y complételo; vea docs\DESPLIEGUE_IIS.md)." }
if (-not (Get-Command $Nssm -ErrorAction SilentlyContinue)) { throw "No se encontró NSSM ('$Nssm'). Instálelo (https://nssm.cc) o indique su ruta con -Nssm." }

$existente = Get-Service -Name $Servicio -ErrorAction SilentlyContinue
if ($existente) {
  Write-Host "El servicio '$Servicio' ya existe (estado: $($existente.Status)). Configuración actual:" -ForegroundColor Yellow
  foreach ($p in 'Application', 'AppParameters', 'AppDirectory', 'AppEnvironmentExtra', 'ObjectName', 'Start') { Write-Host ("  {0,-20} {1}" -f $p, ((& $Nssm get $Servicio $p) -join ' ')) }
  if (-not $Reconfigurar) { throw "No se modifica el servicio existente. Revise lo anterior y, si corresponde, vuelva a ejecutar con -Reconfigurar." }
  if ($existente.Status -ne 'Stopped') { throw "Detenga primero el servicio ('Stop-Service ''$Servicio''') para reconfigurarlo." }
} else {
  $ocupado = Get-NetTCPConnection -LocalPort $Puerto -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($ocupado) { throw "El puerto $Puerto ya está en uso (proceso: $((Get-Process -Id $ocupado.OwningProcess -ErrorAction SilentlyContinue).ProcessName)). Use otro con -Puerto y el mismo en el web.config." }
}
Write-Host "Node $version · puerto $Puerto · servicio '$Servicio' ($(if ($existente) { 'existente' } else { 'nuevo' })) · cuenta $Cuenta"

Paso 'Instalando dependencias de producción'
if ($PSCmdlet.ShouldProcess($Ruta, 'npm ci --omit=dev')) {
  Push-Location $Ruta
  try { & npm ci --omit=dev; if ($LASTEXITCODE -ne 0) { throw 'npm ci falló' } } finally { Pop-Location }
}

Paso 'Carpetas y permisos de la cuenta del servicio'
$logs = Join-Path $Ruta 'logs'
$escribibles = @($logs, (Join-Path $Ruta 'data'))
# Carpetas de datos que el .env pueda sacar de la aplicación (PDF de planes y documentos cargados)
foreach ($linea in Get-Content (Join-Path $Ruta '.env')) {
  if ($linea -match '^\s*(PLANES_PDF_DIR|DOCUMENTOS_DIR)\s*=\s*(.+?)\s*(#.*)?$') { $escribibles += $Matches[2].Trim('"') }
}
if ($PSCmdlet.ShouldProcess($Ruta, "Lectura para $Cuenta; escritura en: $($escribibles -join ', ')")) {
  foreach ($c in $escribibles) { New-Item -ItemType Directory -Force -Path $c | Out-Null }
  & icacls $Ruta /grant "${Cuenta}:(OI)(CI)RX" | Out-Null
  foreach ($c in $escribibles) { & icacls $c /grant "${Cuenta}:(OI)(CI)M" | Out-Null }
}

Paso "$(if ($existente) { 'Configurando' } else { 'Creando' }) el servicio"
if ($PSCmdlet.ShouldProcess($Servicio, 'nssm: aplicación, carpeta, entorno, registro y reinicio automático')) {
  if (-not $existente) { & $Nssm install $Servicio $nodeCmd.Source 'server\server.js' | Out-Null }
  else { & $Nssm set $Servicio Application $nodeCmd.Source | Out-Null; & $Nssm set $Servicio AppParameters 'server\server.js' | Out-Null }
  & $Nssm set $Servicio AppDirectory $Ruta | Out-Null
  & $Nssm set $Servicio Description 'Seguimiento Actividades Gestiona Forestal 2026 (Node.js, detrás de IIS)' | Out-Null
  & $Nssm set $Servicio AppEnvironmentExtra "NODE_ENV=production" "PUERTO=$Puerto" | Out-Null
  & $Nssm set $Servicio Start SERVICE_AUTO_START | Out-Null
  & $Nssm set $Servicio ObjectName $Cuenta | Out-Null
  & $Nssm set $Servicio AppStdout (Join-Path $logs 'servicio.log') | Out-Null
  & $Nssm set $Servicio AppStderr (Join-Path $logs 'servicio.log') | Out-Null
  & $Nssm set $Servicio AppRotateFiles 1 | Out-Null
  & $Nssm set $Servicio AppRotateBytes 10485760 | Out-Null
  & $Nssm set $Servicio AppExit Default Restart | Out-Null
  & $Nssm set $Servicio AppRestartDelay 5000 | Out-Null
}

Paso 'Iniciando y comprobando'
if ($PSCmdlet.ShouldProcess($Servicio, 'Start-Service y comprobación')) {
  Start-Service -Name $Servicio
  $ok = $false
  foreach ($i in 1..20) {
    Start-Sleep -Seconds 1
    try { Invoke-WebRequest -Uri "http://127.0.0.1:$Puerto/api/auth/yo" -UseBasicParsing -ErrorAction Stop | Out-Null; $ok = $true; break }
    catch { if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) { $ok = $true; break } }
  }
  if (-not $ok) { throw "El servicio se inició pero no responde en el puerto $Puerto. Revise $logs\servicio.log" }
  Write-Host "Servicio '$Servicio' en marcha y respondiendo en http://127.0.0.1:$Puerto" -ForegroundColor Green
}
