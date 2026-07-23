# Publishes the fellow-agents npm package from the current checkout.
#
# Usage (from a fresh clone on a machine with npm publish rights):
#   git clone https://github.com/rajan-chari/fellow-agents.git
#   cd fellow-agents
#   git checkout v<version>          # optional: publish a specific released tag
#   ./scripts/publish.ps1
#
# What it does:
#   - Verifies git/node/npm are present.
#   - Ensures you are logged in to the npm registry (prompts npm login if not).
#   - Skips if the target version is already the npm latest.
#   - Runs npm ci and npm test.
#   - Publishes with npm publish. The package.json prepublishOnly hook runs
#     "npm run build" (tsc) automatically, so dist/ is rebuilt before packing;
#     only dist/, templates/, and skills/ are published (see package.json files).
#   - Verifies the npm latest matches the published version.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$registry = 'https://registry.npmjs.org/'

# Runs a native command and throws if it exits non-zero. PowerShell does not
# treat non-zero exit codes from external programs as terminating errors, even
# with $ErrorActionPreference = 'Stop', so guard each critical step explicitly.
function Invoke-Native {
  param([Parameter(Mandatory)][scriptblock]$Command)
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $Command"
  }
}

# Resolve repo root (parent of this scripts/ directory) and run from there.
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

Write-Host 'Checking prerequisites...'
Invoke-Native { git --version }
Invoke-Native { node --version }
Invoke-Native { npm --version }

$version = (node -p "require('./package.json').version")
if ($LASTEXITCODE -ne 0) { throw 'Failed to read version from package.json' }
$version = $version.Trim()
Write-Host "Package version in this checkout: $version"

Write-Host "Checking npm identity on $registry..."
npm whoami --registry $registry
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Not logged in to npmjs. Starting npm login...'
  Invoke-Native { npm login --registry $registry }
  Invoke-Native { npm whoami --registry $registry }
}

Write-Host 'Checking current npm latest (informational)...'
$latest = (npm view fellow-agents version --registry $registry)
if ($LASTEXITCODE -ne 0) { throw 'Failed to query current npm latest version' }
$latest = $latest.Trim()
Write-Host "npm latest is $latest"

# Skip if this exact version already exists on npm. Comparing only against the
# `latest` dist-tag is not enough: publishing a specific released tag that
# exists but is not latest would otherwise fail with "cannot publish over
# existing version". `npm view <pkg>@<version> version` prints the version if it
# exists, and exits non-zero (E404) if it does not, so a non-zero exit here is
# the expected "not published yet" case, not an error to fail on.
Write-Host "Checking whether fellow-agents@$version already exists on npm..."
$existing = (npm view "fellow-agents@$version" version --registry $registry 2>$null)
if ($LASTEXITCODE -eq 0 -and $existing -and $existing.Trim() -eq $version) {
  Write-Host "fellow-agents@$version is already published. Nothing to do."
  exit 0
}
Write-Host "fellow-agents@$version not found on npm; proceeding to publish."

Write-Host 'Installing dependencies (npm ci)...'
Invoke-Native { npm ci --no-audit --no-fund }

Write-Host 'Running tests (npm test, which also builds)...'
Invoke-Native { npm test }

Write-Host "Publishing fellow-agents@$version (prepublishOnly rebuilds dist/)..."
Invoke-Native { npm publish --access public --registry $registry }

Write-Host 'Verifying publish...'
$after = (npm view "fellow-agents@$version" version --registry $registry)
if ($LASTEXITCODE -ne 0) { throw "Failed to verify fellow-agents@$version after publish" }
$after = $after.Trim()
if ($after -ne $version) {
  throw "Publish verification failed: fellow-agents@$version not found on npm after publish (got '$after')"
}

Write-Host "Published fellow-agents@$version successfully."
