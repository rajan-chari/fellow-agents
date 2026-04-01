<#
.SYNOPSIS
    Start the fellow-agents multi-agent environment.
.DESCRIPTION
    Starts emcom-server, installs pty-win dependencies, starts pty-win,
    registers workspace agents, and opens the browser.
#>

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

# --- Paths ---
$BinDir       = Join-Path $Root "bin"
$PtyWinDir    = Join-Path $Root "pty-win"
$WorkspacesDir = Join-Path $Root "workspaces"
$EmcomServer  = Join-Path $BinDir "emcom-server.exe"
$Emcom        = Join-Path $BinDir "emcom.exe"
$PtyWinPort   = 3700

# --- Preflight checks ---
if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is required. Install from https://nodejs.org/"
    exit 1
}
if (-not (Get-Command "claude" -ErrorAction SilentlyContinue)) {
    Write-Error "Claude Code is required. Install from https://claude.ai/code"
    exit 1
}
if (-not (Test-Path $EmcomServer)) {
    Write-Error "emcom-server.exe not found at $EmcomServer. Place emcom binaries in bin/."
    exit 1
}

# --- Start emcom-server ---
Write-Host "[fellow-agents] Starting emcom-server..." -ForegroundColor Cyan
$emcomProc = Start-Process -FilePath $EmcomServer -PassThru -WindowStyle Hidden
Write-Host "[fellow-agents] emcom-server started (PID $($emcomProc.Id))" -ForegroundColor Green

# Wait for emcom-server to be ready
$ready = $false
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $null = Invoke-RestMethod -Uri "http://127.0.0.1:8800/api/health" -TimeoutSec 2
        $ready = $true
        break
    } catch {}
}
if (-not $ready) {
    Write-Warning "emcom-server may not be ready yet — continuing anyway"
}

# --- Register workspace agents ---
Write-Host "[fellow-agents] Registering agents..." -ForegroundColor Cyan
foreach ($ws in Get-ChildItem $WorkspacesDir -Directory) {
    $idFile = Join-Path $ws.FullName "identity.json"
    if (Test-Path $idFile) {
        try {
            & $Emcom --identity $idFile register 2>$null
            Write-Host "  Registered: $($ws.Name)" -ForegroundColor Green
        } catch {
            Write-Host "  Already registered: $($ws.Name)" -ForegroundColor DarkGray
        }
    }
}

# --- Install pty-win dependencies ---
if (-not (Test-Path (Join-Path $PtyWinDir "node_modules"))) {
    Write-Host "[fellow-agents] Installing pty-win dependencies..." -ForegroundColor Cyan
    Push-Location $PtyWinDir
    npm install --production 2>&1 | Out-Null
    Pop-Location
    Write-Host "[fellow-agents] Dependencies installed" -ForegroundColor Green
}

# --- Start pty-win ---
Write-Host "[fellow-agents] Starting pty-win on port $PtyWinPort..." -ForegroundColor Cyan
$ptyProc = Start-Process -FilePath "node" -ArgumentList @(
    "dist/index.js",
    "--port", $PtyWinPort,
    "--root", $WorkspacesDir,
    "--emcom", "http://127.0.0.1:8800"
) -WorkingDirectory $PtyWinDir -PassThru -WindowStyle Hidden
Write-Host "[fellow-agents] pty-win started (PID $($ptyProc.Id))" -ForegroundColor Green

# --- Open browser ---
Start-Sleep -Seconds 2
$url = "http://127.0.0.1:$PtyWinPort"
Write-Host "[fellow-agents] Opening $url" -ForegroundColor Cyan
Start-Process $url

Write-Host ""
Write-Host "=== fellow-agents is running ===" -ForegroundColor Green
Write-Host "  pty-win:      $url"
Write-Host "  emcom-server: http://127.0.0.1:8800"
Write-Host "  Workspaces:   $WorkspacesDir"
Write-Host ""
Write-Host "Press Ctrl+C to stop all services." -ForegroundColor Yellow

# --- Wait and cleanup ---
try {
    while ($true) { Start-Sleep -Seconds 1 }
} finally {
    Write-Host "`n[fellow-agents] Shutting down..." -ForegroundColor Cyan
    if (-not $ptyProc.HasExited) { Stop-Process -Id $ptyProc.Id -Force -ErrorAction SilentlyContinue }
    if (-not $emcomProc.HasExited) { Stop-Process -Id $emcomProc.Id -Force -ErrorAction SilentlyContinue }
    Write-Host "[fellow-agents] Stopped." -ForegroundColor Green
}
