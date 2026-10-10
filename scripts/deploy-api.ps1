#Requires -Version 5.1
<#
.SYNOPSIS
  Deploys the API to Cloud Run.

.DESCRIPTION
  Wraps the gcloud calls so none of them has to be pasted by hand. Run it once
  before the site exists, then again with -ClientAppUrl after GitHub Pages is
  live, so the API accepts that origin and builds its invite links from it.

  Environment variables travel in a file rather than on the command line:
  gcloud splits --set-env-vars on commas, which CLIENT_ORIGIN contains.

.EXAMPLE
  .\scripts\deploy-api.ps1

.EXAMPLE
  .\scripts\deploy-api.ps1 -ClientOrigins http://localhost:5173,https://ganevel.corvelsa.com `
    -ClientAppUrl https://ganevel.corvelsa.com -SkipSetup
#>
param(
  [string]$Project = 'proyecto-ocr-d3ecd',
  [string]$Region = 'us-central1',
  [string]$Service = 'ocr-api',
  [string]$ServiceAccount = 'firebase-adminsdk-fbsvc@proyecto-ocr-d3ecd.iam.gserviceaccount.com',
  [string]$StorageBucket = 'proyecto-ocr-d3ecd.firebasestorage.app',
  # Which calendar day a sale belongs to on the admin dashboard.
  [string]$TimeZone = 'America/Mexico_City',
  [string]$AppName = 'Plataforma OCR',
  # Sender for invite emails. The key itself goes in via set-resend-key.ps1.
  [string]$ResendFrom = 'CORVELSA <info@corvelsa.com>',
  [string[]]$ClientOrigins = @('http://localhost:5173'),
  # The site's full address including any sub-path; empty falls back to the first origin.
  [string]$ClientAppUrl = '',
  [string]$BootstrapAdminEmails = '',
  [int]$ScanDailyLimit = 20,
  [int]$ReceiptMaxUnits = 50,
  # Skips enabling APIs and the IAM binding — both only need doing once.
  [switch]$SkipSetup,
  # Closes without waiting. Pass it when the output is being captured.
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

function Invoke-GCloud {
  param([string[]]$Arguments)
  Write-Host "> gcloud $($Arguments -join ' ')" -ForegroundColor DarkGray
  & gcloud @Arguments
  if ($LASTEXITCODE -ne 0) { throw "gcloud exited with code $LASTEXITCODE" }
}

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  throw 'gcloud is not installed. Get it from https://cloud.google.com/sdk/docs/install, then run: gcloud auth login'
}

# --source uploads the working directory, so the build must start at the repo root.
Set-Location (Split-Path $PSScriptRoot -Parent)

Invoke-GCloud @('config', 'set', 'project', $Project)

if (-not $SkipSetup) {
  Write-Host "`nEnabling the APIs this deploy needs..." -ForegroundColor Cyan
  Invoke-GCloud @('services', 'enable', 'run.googleapis.com', 'cloudbuild.googleapis.com', 'artifactregistry.googleapis.com')

  # The image carries no private key, so receipt links are signed through the
  # IAM API instead — which the account may only do to itself, and only with this.
  Write-Host "`nLetting the service account sign Storage URLs..." -ForegroundColor Cyan
  Invoke-GCloud @(
    'iam', 'service-accounts', 'add-iam-policy-binding', $ServiceAccount,
    '--member', "serviceAccount:$ServiceAccount",
    '--role', 'roles/iam.serviceAccountTokenCreator'
  )
}

$settings = [ordered]@{
  NODE_ENV                = 'production'
  APP_NAME                = $AppName
  CLIENT_ORIGIN           = ($ClientOrigins -join ',')
  FIREBASE_STORAGE_BUCKET = $StorageBucket
  STATS_TIME_ZONE         = $TimeZone
  SCAN_DAILY_LIMIT        = "$ScanDailyLimit"
  RECEIPT_MAX_UNITS       = "$ReceiptMaxUnits"
  RESEND_FROM             = $ResendFrom
}
if ($ClientAppUrl) { $settings.CLIENT_APP_URL = $ClientAppUrl }
if ($BootstrapAdminEmails) { $settings.BOOTSTRAP_ADMIN_EMAILS = $BootstrapAdminEmails }

# GOOGLE_APPLICATION_CREDENTIALS and VISION_KEY_FILE are deliberately absent:
# on Cloud Run the credentials come from the service account, and either of
# those would send the server looking for a file the image does not carry.
$envFile = Join-Path ([IO.Path]::GetTempPath()) "$Service-env.yaml"
$settings.GetEnumerator() | ForEach-Object { "$($_.Key): `"$($_.Value)`"" } | Set-Content -Path $envFile -Encoding utf8

Write-Host "`nConfiguration:" -ForegroundColor Cyan
$settings.GetEnumerator() | ForEach-Object { Write-Host ("  {0,-24} {1}" -f $_.Key, $_.Value) }

try {
  Write-Host "`nDeploying $Service to $Region. The first build takes a few minutes..." -ForegroundColor Cyan
  Invoke-GCloud @(
    'run', 'deploy', $Service,
    '--source', '.',
    '--region', $Region,
    '--service-account', $ServiceAccount,
    '--allow-unauthenticated',
    '--memory', '1Gi',
    '--timeout', '120',
    '--max-instances', '3',
    '--env-vars-file', $envFile,
    '--quiet'
  )
}
finally {
  Remove-Item $envFile -Force -ErrorAction SilentlyContinue
}

$url = (& gcloud run services describe $Service --region $Region --format 'value(status.url)').Trim()
Write-Host "`nService URL: $url" -ForegroundColor Green

# Written down too, because a window that closes on its own takes the URL with it.
$urlFile = Join-Path $PSScriptRoot '.last-deploy-url.txt'
Set-Content -Path $urlFile -Value $url -Encoding utf8
Write-Host "Saved to $urlFile" -ForegroundColor DarkGray

try {
  $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 60
  Write-Host "Health check: $($health.status)" -ForegroundColor Green
}
catch {
  Write-Warning "Health check failed: $($_.Exception.Message)"
}

Write-Host "`nNext:" -ForegroundColor Cyan
Write-Host "  1. GitHub > Settings > Secrets and variables > Actions > Variables:"
Write-Host "     VITE_API_BASE_URL = $url"
Write-Host "  2. Firebase console > Authentication > Settings > Authorized domains: add your Pages domain."
Write-Host "  3. Once the site is live, re-run this script with -ClientOrigins and -ClientAppUrl."
Write-Host "  4. For invite emails: .\scripts\set-resend-key.ps1 (re-run it if a deploy drops the key)."
Write-Host "`nThe URL again, any time:" -ForegroundColor DarkGray
Write-Host "  gcloud run services describe $Service --region $Region --format `"value(status.url)`"" -ForegroundColor DarkGray

if (-not $NoPause) {
  # Read-Host throws in a non-interactive host; there is nothing to wait for there.
  try { Read-Host "`nPress Enter to close" | Out-Null } catch { }
}
