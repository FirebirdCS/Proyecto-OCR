#Requires -Version 5.1
<#
.SYNOPSIS
  Puts the Resend API key into Secret Manager and hands it to the Cloud Run service.

.DESCRIPTION
  The key is typed in, never passed as an argument, so it stays out of the shell
  history and the process list. Cloud Run reads it at start-up as RESEND_API_KEY.

  Run this after the service exists. Re-run it whenever the key is rotated: it
  adds a new version and the service picks it up on its next start.

  Without the key the API still creates accounts and returns the invite link —
  it just cannot email it.

.EXAMPLE
  .\scripts\set-resend-key.ps1
#>
param(
  [string]$Project = 'proyecto-ocr-d3ecd',
  [string]$Region = 'us-central1',
  [string]$Service = 'ocr-api',
  [string]$ServiceAccount = 'firebase-adminsdk-fbsvc@proyecto-ocr-d3ecd.iam.gserviceaccount.com',
  [string]$SecretName = 'resend-api-key',
  # Stores the secret without touching the Cloud Run service.
  [switch]$SkipServiceUpdate,
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

Invoke-GCloud @('config', 'set', 'project', $Project)
Invoke-GCloud @('services', 'enable', 'secretmanager.googleapis.com')

Write-Host "`nPaste the Resend API key (it starts with re_). Input stays hidden." -ForegroundColor Cyan
$secure = Read-Host -AsSecureString 'Resend API key'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrWhiteSpace($key)) { throw 'No key entered.' }

# A file, because gcloud reads secret material from --data-file only. No BOM and
# no trailing newline: both would become part of the key.
$keyFile = Join-Path ([IO.Path]::GetTempPath()) "$SecretName.tmp"
[IO.File]::WriteAllText($keyFile, $key.Trim(), [Text.UTF8Encoding]::new($false))

try {
  & gcloud secrets describe $SecretName 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "`nAdding a new version to $SecretName..." -ForegroundColor Cyan
    Invoke-GCloud @('secrets', 'versions', 'add', $SecretName, '--data-file', $keyFile)
  }
  else {
    Write-Host "`nCreating the secret $SecretName..." -ForegroundColor Cyan
    Invoke-GCloud @('secrets', 'create', $SecretName, '--replication-policy', 'automatic', '--data-file', $keyFile)
  }
}
finally {
  # Overwrite before deleting, so the key does not linger in free space.
  [IO.File]::WriteAllText($keyFile, ('0' * 128), [Text.UTF8Encoding]::new($false))
  Remove-Item $keyFile -Force -ErrorAction SilentlyContinue
}

Write-Host "`nLetting the service account read the secret..." -ForegroundColor Cyan
Invoke-GCloud @(
  'secrets', 'add-iam-policy-binding', $SecretName,
  '--member', "serviceAccount:$ServiceAccount",
  '--role', 'roles/secretmanager.secretAccessor'
)

if (-not $SkipServiceUpdate) {
  # --update-secrets adds this one mapping and leaves the rest of the config alone.
  Write-Host "`nHanding it to $Service as RESEND_API_KEY..." -ForegroundColor Cyan
  Invoke-GCloud @(
    'run', 'services', 'update', $Service,
    '--region', $Region,
    '--update-secrets', "RESEND_API_KEY=${SecretName}:latest",
    '--quiet'
  )
}

Write-Host "`nDone. Invite emails will send on the next start." -ForegroundColor Green
Write-Host "If a later deploy drops RESEND_API_KEY, run this script again." -ForegroundColor DarkGray

if (-not $NoPause) {
  try { Read-Host "`nPress Enter to close" | Out-Null } catch { }
}
