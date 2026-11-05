<#
.SYNOPSIS
  Informe de SOLO LECTURA del servidor antes de publicar: no instala, no cambia ni inicia nada.
.DESCRIPTION
  Ejecutar como administrador en el servidor (funciona en Windows PowerShell 5.1). No lee el .env ni muestra claves:
  los valores de las variables de entorno del servicio se ocultan. Para guardar el informe:
      .\revisar-servidor.ps1 | Out-File informe-servidor.txt
.EXAMPLE
  .\revisar-servidor.ps1 -SqlServidor NOMBRE-O-IP-DEL-SQL
#>
[CmdletBinding()]
param(
  [string]$Sitio = 'C:\inetpub\wwwroot\serforia',
  [string]$Servicio = 'SERFOR - Backend Node.js',
  [int]$Puerto = 3080,
  [string]$SqlServidor = '',
  [int]$SqlPuerto = 1433
)
$ErrorActionPreference = 'Continue'
function Seccion($t) { Write-Output ''; Write-Output ('=== ' + $t) }
function Intentar($bloque) { try { & $bloque } catch { Write-Output ('  (no disponible: ' + $_.Exception.Message + ')') } }

Write-Output ('Informe de revisión · ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') + ' · equipo ' + $env:COMPUTERNAME)

Seccion 'Sistema'
Intentar { $so = Get-CimInstance Win32_OperatingSystem; Write-Output ('  ' + $so.Caption + ' · versión ' + $so.Version) }
Write-Output ('  PowerShell ' + $PSVersionTable.PSVersion)
Intentar { Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null } | ForEach-Object { Write-Output ('  Unidad {0}: libres {1} GB' -f $_.Name, [math]::Round($_.Free / 1GB, 1)) } }

Seccion 'Node.js (se requiere 22 o superior)'
Intentar { $v = (& node -v) 2>&1; Write-Output ('  node ' + $v); Write-Output ('  ruta: ' + (Get-Command node).Source) }
Intentar { Write-Output ('  npm ' + ((& npm -v) 2>&1)) }
Intentar { Write-Output ('  git ' + ((& git --version) 2>&1)) }

Seccion 'NSSM'
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssm) { Write-Output ('  encontrado: ' + $nssm.Source) } else { Write-Output '  NO está en el PATH (puede estar instalado en otra carpeta: indique su ruta)' }

Seccion ('Servicio "' + $Servicio + '"')
$svc = Get-Service -Name $Servicio -ErrorAction SilentlyContinue
if (-not $svc) { Write-Output '  NO existe un servicio con ese nombre' }
else {
  Write-Output ('  estado: ' + $svc.Status + ' · inicio: ' + $svc.StartType)
  $nssmExe = if ($nssm) { $nssm.Source } else { $null }
  Intentar {
    $w = Get-CimInstance Win32_Service -Filter ("Name='" + $Servicio.Replace("'", "''") + "'")
    Write-Output ('  cuenta: ' + $w.StartName); Write-Output ('  ejecutable: ' + $w.PathName)
    if (-not $nssmExe -and $w.PathName -match '^"?([^"]*nssm[^"]*\.exe)') { $nssmExe = $Matches[1]; Write-Output ('  (NSSM tomado de la ruta del servicio: ' + $nssmExe + ')') }
  }
  if ($nssmExe) {
    $anterior = [Console]::OutputEncoding
    try {
      [Console]::OutputEncoding = [System.Text.Encoding]::Unicode # NSSM responde en UTF-16
      foreach ($p in 'Application', 'AppParameters', 'AppDirectory') { Write-Output ('  {0,-14} {1}' -f $p, ((& $nssmExe get $Servicio $p 2>&1) -join ' ').Trim([char]0)) }
      $env = (& $nssmExe get $Servicio AppEnvironmentExtra 2>&1) -join ' '
      Write-Output ('  AppEnvironmentExtra (valores ocultos): ' + ($env -replace '=[^\s]*', '=***'))
    } catch { Write-Output ('  (no se pudo consultar NSSM: ' + $_.Exception.Message + ')') } finally { [Console]::OutputEncoding = $anterior }
  }
}

Seccion ('Puerto ' + $Puerto)
Intentar {
  $l = Get-NetTCPConnection -LocalPort $Puerto -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($l) { Write-Output ('  EN USO por el proceso: ' + (Get-Process -Id $l.OwningProcess).ProcessName) } else { Write-Output '  libre' }
}

Seccion ('Carpeta del sitio ' + $Sitio)
if (-not (Test-Path $Sitio)) { Write-Output '  NO existe' }
else {
  $n = @(Get-ChildItem $Sitio -Force -ErrorAction SilentlyContinue)
  Write-Output ('  elementos: ' + $n.Count)
  $n | Select-Object -First 25 | ForEach-Object { Write-Output ('   - ' + $_.Name + $(if ($_.PSIsContainer) { '\' } else { '' })) }
  if (Test-Path (Join-Path $Sitio 'web.config')) { Write-Output '  contiene web.config:'; Intentar { Select-String -Path (Join-Path $Sitio 'web.config') -Pattern 'url=|<rule |destination|proxy' | ForEach-Object { Write-Output ('    ' + $_.Line.Trim()) } } }
}

Seccion 'IIS: sitios, enlaces y módulos'
Intentar {
  Import-Module WebAdministration -ErrorAction Stop
  Get-Website | ForEach-Object { Write-Output ('  sitio "{0}" · {1} · {2}' -f $_.Name, $_.State, $_.PhysicalPath) }
  Get-WebBinding | ForEach-Object { Write-Output ('  enlace: {0} {1}' -f $_.protocol, $_.bindingInformation) }
  $mods = Get-WebGlobalModule | Where-Object { $_.Name -match 'Rewrite|ApplicationRequestRouting' } | Select-Object -ExpandProperty Name
  Write-Output ('  módulos URL Rewrite / ARR: ' + $(if ($mods) { $mods -join ', ' } else { 'NO se encontraron' }))
  $prox = Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name enabled -ErrorAction SilentlyContinue
  Write-Output ('  proxy de ARR activado: ' + $(if ($prox -and $prox.Value) { 'sí' } else { 'no (o ARR no instalado)' }))
}

Seccion 'Certificados (almacén del equipo, vigentes)'
Intentar { Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.NotAfter -gt (Get-Date) } | Select-Object -First 10 | ForEach-Object { Write-Output ('  {0} · vence {1:yyyy-MM-dd}' -f $_.Subject, $_.NotAfter) } }

Seccion 'Conectividad'
if ($SqlServidor) { Intentar { $t = Test-NetConnection -ComputerName $SqlServidor -Port $SqlPuerto -WarningAction SilentlyContinue; Write-Output ('  SQL Server {0}:{1} -> {2}' -f $SqlServidor, $SqlPuerto, $(if ($t.TcpTestSucceeded) { 'alcanzable' } else { 'SIN conexión' })) } }
else { Write-Output '  SQL Server: no se probó (indique -SqlServidor NOMBRE-O-IP)' }
Intentar { $t = Test-NetConnection -ComputerName api.anthropic.com -Port 443 -WarningAction SilentlyContinue; Write-Output ('  api.anthropic.com:443 (asistente de IA) -> ' + $(if ($t.TcpTestSucceeded) { 'alcanzable' } else { 'SIN conexión (el asistente y la lectura de PDF/Word no funcionarán)' })) }
Intentar { $t = Test-NetConnection -ComputerName github.com -Port 443 -WarningAction SilentlyContinue; Write-Output ('  github.com:443 (para git clone) -> ' + $(if ($t.TcpTestSucceeded) { 'alcanzable' } else { 'SIN conexión (se copiará un ZIP)' })) }

Write-Output ''
Write-Output 'Fin del informe. No se modificó nada.'
