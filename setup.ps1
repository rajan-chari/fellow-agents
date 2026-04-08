<#
.SYNOPSIS
    Set up the fellow-agents multi-agent system.
.DESCRIPTION
    Checks prerequisites, installs dependencies, creates workspaces,
    starts services, and opens the browser.
#>
param(
    [int]$PtyWinPort = 3700,
    [int]$EmcomPort = 8800,
    [switch]$SkipBrowser,
    [string]$Repo = "rajan-chari/fellow-agents"
)

# Require PowerShell 7+
if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Error "PowerShell 7+ required. Install: winget install Microsoft.PowerShell`nThen run: pwsh ./setup.ps1"
    exit 1
}

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$BinDir = Join-Path $Root "bin" "win-x64"
$WorkspacesDir = Join-Path $Root "workspaces"
$PtyWinDir = Join-Path $Root "pty-win"

Write-Host ""
Write-Host "  fellow-agents setup" -ForegroundColor Cyan
Write-Host "  ===================" -ForegroundColor DarkGray
Write-Host ""

# --- Prerequisites ---
Write-Host "[1/6] Checking prerequisites..." -ForegroundColor Yellow

# Node.js
$node = Get-Command "node" -ErrorAction SilentlyContinue
if (-not $node) { Write-Error "Node.js is required. Install from https://nodejs.org/"; exit 1 }
$nodeVer = (node --version) -replace 'v',''
$nodeMajor = [int]($nodeVer.Split('.')[0])
if ($nodeMajor -lt 18) { Write-Error "Node.js 18+ required (found $nodeVer). Update from https://nodejs.org/"; exit 1 }
Write-Host "  Node.js $nodeVer" -ForegroundColor Green

# Claude Code
$claude = Get-Command "claude" -ErrorAction SilentlyContinue
if (-not $claude) { Write-Host "  Claude Code not found (optional — install from https://claude.ai/code)" -ForegroundColor Yellow }
else { Write-Host "  Claude Code found" -ForegroundColor Green }

# Python (for emcom-server)
$python = Get-Command "python" -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command "python3" -ErrorAction SilentlyContinue }
if (-not $python) { Write-Error "Python 3.10+ is required for emcom-server. Install from https://python.org/"; exit 1 }
$pyVer = python --version 2>&1
Write-Host "  $pyVer" -ForegroundColor Green

# --- Download binaries if missing ---
function Download-Release {
    if ((Test-Path (Join-Path $BinDir "emcom.exe")) -and (Test-Path $PtyWinDir)) {
        Write-Host "  Binaries already present — skipping download" -ForegroundColor DarkGray
        return
    }
    Write-Host "  Downloading binaries from GitHub Releases..." -ForegroundColor Yellow
    try {
        $release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest" -TimeoutSec 10
        $tag = $release.tag_name
        Write-Host "  Release: $tag" -ForegroundColor Green
        foreach ($asset in $release.assets) {
            $name = $asset.name
            $url = $asset.browser_download_url
            if ($name -match "win-x64") {
                $dest = Join-Path $Root $name
                Write-Host "  Downloading $name..." -ForegroundColor DarkGray
                Invoke-WebRequest -Uri $url -OutFile $dest -TimeoutSec 120
                Expand-Archive -Path $dest -DestinationPath $Root -Force
                Remove-Item $dest
            } elseif ($name -match "pty-win") {
                $dest = Join-Path $Root $name
                Write-Host "  Downloading $name..." -ForegroundColor DarkGray
                Invoke-WebRequest -Uri $url -OutFile $dest -TimeoutSec 120
                Expand-Archive -Path $dest -DestinationPath $Root -Force
                Remove-Item $dest
            }
        }
    } catch {
        Write-Warning "  Could not download from GitHub Releases: $_"
        Write-Warning "  Place binaries manually in $BinDir and pty-win/"
    }
}
Download-Release

if (-not (Test-Path (Join-Path $BinDir "emcom.exe"))) { Write-Error "emcom.exe not found in $BinDir. Download from GitHub Releases or place manually."; exit 1 }
Write-Host "  Binaries ready" -ForegroundColor Green

# --- Install pty-win ---
Write-Host "[2/6] Installing pty-win..." -ForegroundColor Yellow
if (Test-Path $PtyWinDir) {
    Push-Location $PtyWinDir
    if (-not (Test-Path "node_modules")) { npm install --production 2>&1 | Out-Null }
    npm link 2>&1 | Out-Null
    Pop-Location
    Write-Host "  pty-win ready" -ForegroundColor Green
} else {
    Write-Warning "  pty-win/ not found — skipping (download from GitHub Releases)"
}

# --- Start emcom-server ---
Write-Host "[3/6] Starting emcom-server..." -ForegroundColor Yellow
$EmcomServer = Join-Path $BinDir "emcom-server.exe"
$emcomProc = Start-Process -FilePath $EmcomServer -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
$ready = $false
for ($i = 0; $i -lt 10; $i++) {
    try {
        $null = Invoke-RestMethod -Uri "http://127.0.0.1:$EmcomPort/api/health" -TimeoutSec 2
        $ready = $true; break
    } catch { Start-Sleep -Milliseconds 500 }
}
if ($ready) { Write-Host "  emcom-server running on :$EmcomPort" -ForegroundColor Green }
else { Write-Warning "  emcom-server may not be ready — continuing" }

# --- Register workspaces ---
Write-Host "[4/6] Registering agents..." -ForegroundColor Yellow
$Emcom = Join-Path $BinDir "emcom.exe"
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

# --- Configure hooks ---
Write-Host "[5/6] Configuring Claude Code hooks..." -ForegroundColor Yellow
foreach ($ws in Get-ChildItem $WorkspacesDir -Directory) {
    $claudeDir = Join-Path $ws.FullName ".claude"
    if (-not (Test-Path $claudeDir)) { New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null }
    $settingsPath = Join-Path $claudeDir "settings.local.json"
    $json = @"
{
  "hooks": {
    "Stop": [{"matcher": "", "hooks": [{"type": "http", "url": "http://127.0.0.1:$PtyWinPort/api/hook/stop", "timeout": 2}]}],
    "Notification": [{"matcher": "idle_prompt|permission_prompt", "hooks": [{"type": "http", "url": "http://127.0.0.1:$PtyWinPort/api/hook/notify", "timeout": 2}]}],
    "UserPromptSubmit": [{"matcher": "", "hooks": [{"type": "http", "url": "http://127.0.0.1:$PtyWinPort/api/hook/prompt-submit", "timeout": 2}]}]
  },
  "messageIdleNotifThresholdMs": 5000
}
"@
    Set-Content $settingsPath $json -Encoding UTF8
    Write-Host "  Hooks configured: $($ws.Name)" -ForegroundColor Green
}

# --- Start pty-win ---
Write-Host "[6/6] Starting pty-win..." -ForegroundColor Yellow
$ptyWinMain = Join-Path $PtyWinDir "dist" "index.js"
if (Test-Path $ptyWinMain) {
    $ptyProc = Start-Process -FilePath "node" -ArgumentList @(
        $ptyWinMain, "--port", $PtyWinPort, "--root", $WorkspacesDir, "--emcom", "http://127.0.0.1:$EmcomPort"
    ) -PassThru -WindowStyle Hidden
    Write-Host "  pty-win running on :$PtyWinPort" -ForegroundColor Green
} else {
    Write-Warning "  pty-win dist not found — run 'npm run build' in pty-win/"
}

# --- Open browser ---
if (-not $SkipBrowser) {
    Start-Sleep -Seconds 2
    Start-Process "http://127.0.0.1:$PtyWinPort"
}

# --- Done ---
Write-Host ""
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "  pty-win:      http://127.0.0.1:$PtyWinPort" -ForegroundColor Cyan
Write-Host "  emcom-server: http://127.0.0.1:$EmcomPort" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Next: open a workspace in pty-win and start collaborating." -ForegroundColor DarkGray
Write-Host "  Press Ctrl+C to stop all services." -ForegroundColor Yellow
Write-Host ""

# --- Wait and cleanup ---
try { while ($true) { Start-Sleep -Seconds 1 } }
finally {
    Write-Host "`n  Shutting down..." -ForegroundColor Cyan
    if ($ptyProc -and -not $ptyProc.HasExited) { Stop-Process -Id $ptyProc.Id -Force -ErrorAction SilentlyContinue }
    if ($emcomProc -and -not $emcomProc.HasExited) { Stop-Process -Id $emcomProc.Id -Force -ErrorAction SilentlyContinue }
    Write-Host "  Stopped." -ForegroundColor Green
}
