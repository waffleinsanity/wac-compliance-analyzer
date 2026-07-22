#Requires -Version 5.1
<#
.SYNOPSIS
  Ensure WACMAKR API (:8000) and UI (:5173) are healthy; restart if not.
.DESCRIPTION
  Idempotent local stack healer. Safe to run repeatedly or on a timer.
#>
param(
  [switch]$Watch,
  [int]$IntervalSeconds = 20,
  [switch]$OpenBrowser
)

$ErrorActionPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root 'Launch.bat'))) {
  $Root = 'C:\Users\Daniel\Projects\wac-compliance-analyzer'
}
$ApiUrl = 'http://127.0.0.1:8000/api/health'
$UiUrl = 'http://localhost:5173'

function Test-UrlOk([string]$Url) {
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Stop-PortListeners([int[]]$Ports) {
  foreach ($port in $Ports) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep -Seconds 1
}

function Start-Stack {
  Write-Host "[ensure-stack] Starting API + UI from $Root"
  Start-Process cmd -ArgumentList '/c', 'call start-backend.bat' -WorkingDirectory $Root -WindowStyle Minimized
  Start-Process cmd -ArgumentList '/c', 'call start-frontend.bat' -WorkingDirectory $Root -WindowStyle Minimized
}

function Wait-Healthy([int]$Seconds = 60) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $api = Test-UrlOk $ApiUrl
    $ui = Test-UrlOk $UiUrl
    if ($api -and $ui) { return $true }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Ensure-Once {
  $api = Test-UrlOk $ApiUrl
  $ui = Test-UrlOk $UiUrl
  if ($api -and $ui) {
    Write-Host "[ensure-stack] Healthy (API + UI)"
    if ($OpenBrowser) { Start-Process $UiUrl }
    return $true
  }

  Write-Host "[ensure-stack] Unhealthy (API=$api UI=$ui) — resetting ports and restarting"
  Stop-PortListeners @(8000, 5173)
  Start-Stack
  $ok = Wait-Healthy 75
  if ($ok) {
    Write-Host "[ensure-stack] Recovered"
    if ($OpenBrowser) { Start-Process $UiUrl }
    return $true
  }
  Write-Host "[ensure-stack] FAILED to recover"
  return $false
}

if ($Watch) {
  Write-Host "[ensure-stack] Watch mode every ${IntervalSeconds}s"
  while ($true) {
    [void](Ensure-Once)
    Start-Sleep -Seconds $IntervalSeconds
  }
} else {
  $ok = Ensure-Once
  if (-not $ok) { exit 1 }
}
