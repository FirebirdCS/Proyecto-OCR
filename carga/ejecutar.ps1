#Requires -Version 5.1
<#
.SYNOPSIS
  Ejecuta la prueba de carga de JMeter contra la API publicada y exporta el informe.

.DESCRIPTION
  1. Genera facturas nuevas (lotes de generate_samples.py) para que cada escaneo
     use una factura distinta y ninguno choque con el control de duplicados.
  2. Ejecuta plan-carga.jmx sin interfaz: N usuarios concurrentes, cada uno
     consulta campañas, escanea una factura y vuelve a consultar.
  3. Exporta el informe HTML y los resultados crudos a carga/resultados/<fecha>/
     e imprime el promedio y el percentil 95 de cada operación.

  Carga moderada a propósito: cada escaneo es una llamada a Cloud Vision y cuenta
  para el límite diario de USR1 (20 en 24 horas, incluidos los de Cypress).

  Necesita e2e/cypress.env.json (USR1_EMAIL, USR1_PASSWORD, CAMPAIGN, PRODUCT),
  Python y Edge para generar las facturas, y JMeter con Java.

.EXAMPLE
  .\carga\ejecutar.ps1

.EXAMPLE
  .\carga\ejecutar.ps1 -Usuarios 10 -EscaneosPorUsuario 1
#>
param(
  [ValidateRange(1, 10)][int]$Usuarios = 5,
  [ValidateRange(1, 3)][int]$EscaneosPorUsuario = 2,
  # Segundos en los que arrancan todos los usuarios.
  [int]$Rampa = 5,
  [string]$Api = 'https://ocr-api-3bi5lk4hta-uc.a.run.app',
  [string]$JMeterHome = $env:JMETER_HOME
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$umbralMs = 15000

# ---- JMeter ----
if (-not $JMeterHome) {
  $JMeterHome = Get-ChildItem "$HOME\tools" -Directory -Filter 'apache-jmeter-*' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName
}
# Se llama al .jar directamente: jmeter.bat parte los argumentos en el «=» de cada -Jclave=valor.
$jmeter = if ($JMeterHome) { Join-Path $JMeterHome 'bin\ApacheJMeter.jar' }
if (-not $jmeter -or -not (Test-Path $jmeter)) {
  throw 'No se encontró JMeter. Descomprímelo en ~\tools o define JMETER_HOME.'
}
# Una terminal abierta antes de instalar Java aún no lo tiene en el PATH.
if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
  $java = Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $java) { throw 'No se encontró Java. Instálalo con: winget install EclipseAdoptium.Temurin.21.JRE' }
  $env:JAVA_HOME = $java.FullName
  $env:Path = "$($java.FullName)\bin;$env:Path"
}

# ---- Configuración que ya existe en el proyecto ----
$credenciales = Join-Path $root 'e2e\cypress.env.json'
if (-not (Test-Path $credenciales)) { throw "Falta $credenciales (ver e2e/cypress.env.example.json)." }
$envJson = Get-Content $credenciales -Raw | ConvertFrom-Json
$firebaseKey = (Select-String -Path (Join-Path $root 'client\.env') -Pattern '^VITE_FIREBASE_API_KEY=(.+)$').Matches[0].Groups[1].Value
if (-not $firebaseKey) { throw 'Falta VITE_FIREBASE_API_KEY en client/.env.' }

# ---- Facturas distintas ----
$total = $Usuarios * $EscaneosPorUsuario
$validas = 'valido-cantidad-x.png', 'valido-cantidad-abajo.png', 'valido-unidades-fecha-corta.png',
  'valido-error-de-lectura.png', 'valido-foto-celular.png', 'valido-factura.pdf'
$lotes = [math]::Ceiling($total / $validas.Count)

$fecha = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$salida = Join-Path $PSScriptRoot "resultados\$fecha"
$facturas = Join-Path $PSScriptRoot "facturas\$fecha"
New-Item -ItemType Directory -Force $salida, $facturas | Out-Null

# Lotes en un rango propio (2 000 000+), distinto del de Cypress (1 000+), y nuevo en cada ejecución.
$loteBase = 2000000 + ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() % 1000000) * 10
$lista = @()
for ($i = 0; $i -lt $lotes; $i++) {
  $carpeta = Join-Path $facturas "lote-$i"
  Write-Host "Generando lote $($i + 1) de $lotes..." -ForegroundColor Cyan
  & python (Join-Path $root 'samples\generate_samples.py') --lote ($loteBase + $i) --product $envJson.PRODUCT --out $carpeta | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'generate_samples.py falló.' }
  foreach ($nombre in $validas) {
    $mime = if ($nombre.EndsWith('.pdf')) { 'application/pdf' } else { 'image/png' }
    $lista += "$((Join-Path $carpeta $nombre).Replace('\', '/')),$mime"
  }
}
$csv = Join-Path $facturas 'facturas.csv'
$lista | Select-Object -First $total | Set-Content -Path $csv -Encoding utf8

Write-Host "`n$Usuarios usuarios concurrentes x $EscaneosPorUsuario escaneos = $total escaneos reales contra $Api" -ForegroundColor Yellow

# Para la suite de QA: con qué parámetros se ejecutó esta prueba.
@{ usuarios = $Usuarios; escaneosPorUsuario = $EscaneosPorUsuario; rampa = $Rampa; api = $Api } |
  ConvertTo-Json | Set-Content -Path (Join-Path $salida 'parametros.json') -Encoding utf8

# ---- Ejecución ----
$jmeterArgs = @(
  '-jar', $jmeter,
  '-n', '-t', (Join-Path $PSScriptRoot 'plan-carga.jmx'),
  '-l', (Join-Path $salida 'resultados.jtl'),
  '-j', (Join-Path $salida 'jmeter.log'),
  '-e', '-o', (Join-Path $salida 'informe'),
  "-Jhost=$(([Uri]$Api).Host)",
  "-Jusuarios=$Usuarios", "-JescaneosPorUsuario=$EscaneosPorUsuario", "-Jrampa=$Rampa",
  "-Jcampana=$($envJson.CAMPAIGN)",
  "-Jcredenciales=$credenciales",
  "-JfirebaseApiKey=$firebaseKey",
  "-JlistaFacturas=$csv",
  # El informe muestra solo las operaciones medidas, no la preparación.
  '-Jjmeter.reportgenerator.sample_filter=^(Consultar campañas|Escanear factura)$',
  '-Jjmeter.reportgenerator.report_title=Carga moderada de la API OCR'
)
& java @jmeterArgs
if ($LASTEXITCODE -ne 0) { throw "JMeter terminó con código $LASTEXITCODE. Revisa $salida\jmeter.log" }

# ---- Resumen ----
$stats = Get-Content (Join-Path $salida 'informe\statistics.json') -Raw | ConvertFrom-Json
Write-Host "`nResultados ($($salida))" -ForegroundColor Cyan
'{0,-20} {1,8} {2,8} {3,12} {4,12} {5,12}' -f 'Operación', 'Muestras', 'Errores', 'Promedio', 'P95', 'Máximo' | Write-Host
foreach ($nombre in 'Consultar campañas', 'Escanear factura') {
  $s = $stats.$nombre
  if (-not $s) { continue }
  '{0,-20} {1,8} {2,8} {3,10:N0} ms {4,9:N0} ms {5,9:N0} ms' -f $nombre, $s.sampleCount, $s.errorCount,
    $s.meanResTime, $s.pct2ResTime, $s.maxResTime | Write-Host
}

$escaneo = $stats.'Escanear factura'
$cumple = $escaneo -and $escaneo.errorCount -eq 0 -and $escaneo.meanResTime -le $umbralMs -and $escaneo.pct2ResTime -le $umbralMs
if ($cumple) {
  Write-Host "`nCUMPLE: el escaneo completo tarda $umbralMs ms o menos en promedio y en el percentil 95." -ForegroundColor Green
} else {
  Write-Host "`nNO CUMPLE: revisa errores, promedio y P95 del escaneo en el informe." -ForegroundColor Red
}
Write-Host "Informe HTML: $(Join-Path $salida 'informe\index.html')"
