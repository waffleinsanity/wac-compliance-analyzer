#Requires -Version 5.1
<#
.SYNOPSIS
  Ensure WACMAKR API (:8000) and UI (:5173) are healthy; restart if not.
.DESCRIPTION
  Idempotent local stack healer. Safe to run from Run and Debug (F5).
  Starts API + UI, waits until both respond, then opens the browser.
  Single-instance: concurrent copies exit immediately.
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
$UiUrls = @(
  'http://127.0.0.1:5173',
  'http://localhost:5173'
)
$BrowserUrl = 'http://localhost:5173/login'
$Python = Join-Path $Root 'backend\.venv\Scripts\python.exe'
$FrontendDir = Join-Path $Root 'frontend'
$BackendDir = Join-Path $Root 'backend'
$FrontendModules = Join-Path $FrontendDir 'node_modules'
$LockPath = Join-Path $env:TEMP 'wacmakr-ensure-stack.lock'
$LogDir = Join-Path $Root 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

# Single-instance lock (watch mode holds the lock for the whole session)
$lockStream = $null
try {
  $lockStream = [System.IO.File]::Open($LockPath, 'OpenOrCreate', 'ReadWrite', 'None')
} catch {
  Write-Host '[ensure-stack] Another ensure-stack is already running - exiting'
  exit 0
}

function Release-Lock {
  if ($null -ne $lockStream) {
    try { $lockStream.Close() } catch {}
    try { Remove-Item -Force $LockPath -ErrorAction SilentlyContinue } catch {}
  }
}

function Test-UrlOk([string]$Url) {
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Test-ApiOk { return (Test-UrlOk $ApiUrl) }

function Test-UiOk {
  foreach ($u in $UiUrls) {
    if (Test-UrlOk $u) { return $true }
  }
  return $false
}

function Stop-PortListeners([int[]]$Ports) {
  foreach ($port in $Ports) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object {
        try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
      }
  }
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -match 'uvicorn(\.exe)? .*app\.main:app' -or
      $_.CommandLine -match 'vite(\.js)?.*(--port[= ]5173|port 5173)'
    } |
    ForEach-Object {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  Start-Sleep -Seconds 2
}

function Assert-Prereqs {
  if (-not (Test-Path $Python)) {
    Write-Host '[ensure-stack] Missing backend venv. Running setup-local.bat...'
    $setup = Join-Path $Root 'setup-local.bat'
    if (Test-Path $setup) { & cmd /c "`"$setup`"" }
  }
  if (-not (Test-Path $Python)) {
    Write-Host '[ensure-stack] ERROR: backend\.venv\Scripts\python.exe still missing'
    return $false
  }
  if (-not (Test-Path $FrontendModules)) {
    Write-Host '[ensure-stack] Missing frontend\node_modules. Running npm install...'
    Push-Location $FrontendDir
    try { & npm.cmd install } finally { Pop-Location }
  }
  if (-not (Test-Path $FrontendModules)) {
    Write-Host '[ensure-stack] ERROR: frontend\node_modules still missing'
    return $false
  }
  return $true
}

function Start-Stack {
  Write-Host "[ensure-stack] Starting API + UI from $Root"
  $apiLog = Join-Path $LogDir 'api.out.log'
  $uiLog = Join-Path $LogDir 'ui.out.log'

  $apiArgs = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    ("Set-Location '{0}'; `$env:PYTHONPATH='{0}'; `$env:PYTHONUNBUFFERED='1'; & '{1}' -m uvicorn app.main:app --host 127.0.0.1 --port 8000 *>> '{2}'" -f $BackendDir, $Python, $apiLog)
  )
  Start-Process -FilePath 'powershell.exe' -ArgumentList $apiArgs -WorkingDirectory $BackendDir -WindowStyle Hidden

  $uiArgs = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    ("Set-Location '{0}'; & npm.cmd run dev -- --host 0.0.0.0 --port 5173 *>> '{1}'" -f $FrontendDir, $uiLog)
  )
  Start-Process -FilePath 'powershell.exe' -ArgumentList $uiArgs -WorkingDirectory $FrontendDir -WindowStyle Hidden
}

function Wait-Healthy([int]$Seconds = 90) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $api = Test-ApiOk
    $ui = Test-UiOk
    if ($api -and $ui) { return $true }
    Write-Host "[ensure-stack] Waiting... API=$api UI=$ui"
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Open-AppBrowser {
  Write-Host "[ensure-stack] Opening $BrowserUrl"
  try {
    Start-Process $BrowserUrl
  } catch {
    try { Start-Process 'http://127.0.0.1:5173/login' } catch {}
  }
}

function Ensure-Once {
  if (-not (Assert-Prereqs)) { return $false }

  $api = Test-ApiOk
  $ui = Test-UiOk
  if ($api -and $ui) {
    Write-Host '[ensure-stack] Healthy (API + UI)'
    if ($OpenBrowser) { Open-AppBrowser }
    return $true
  }

  Write-Host "[ensure-stack] Unhealthy (API=$api UI=$ui) - resetting ports and restarting"
  Stop-PortListeners @(8000, 5173)
  Start-Stack
  $ok = Wait-Healthy 90
  if ($ok) {
    Write-Host '[ensure-stack] Recovered - API http://127.0.0.1:8000  UI http://localhost:5173'
    if ($OpenBrowser) { Open-AppBrowser }
    return $true
  }
  Write-Host '[ensure-stack] FAILED to recover'
  Write-Host "  See logs: $LogDir\api.out.log and $LogDir\ui.out.log"
  return $false
}

try {
  if ($Watch) {
    Write-Host "[ensure-stack] Watch mode every ${IntervalSeconds}s"
    while ($true) {
      [void](Ensure-Once)
      Start-Sleep -Seconds $IntervalSeconds
    }
  } else {
    $ok = Ensure-Once
    if (-not $ok) { exit 1 }
    exit 0
  }
} finally {
  Release-Lock
}
