# dsh-whale-tank v1 dogfooding gate (ticket 11 / decision Q2):
# Init a host sample plugin with this plugin (knowledge-pack mode), then walk the
# full lifecycle in the sandbox: init -> status=clean -> plug -> two-step smoke
# -> unplug -> diff=0 -> clean. Failure means v1 does not ship.
param(
    [string]$CliJs = "",
    [string]$WorkRoot = ""
)

$ErrorActionPreference = 'Stop'
if (-not $CliJs) {
    $CliJs = (Resolve-Path (Join-Path $PSScriptRoot '..\lib\cli.js')).Path
}
if (-not $WorkRoot) {
    $WorkRoot = Join-Path $env:TEMP 'whale-tank-dogfooding'
}
$sample = Join-Path $WorkRoot ("dsh-dogfood-sample-" + [guid]::NewGuid().ToString('N').Substring(0, 8))

Write-Host "[dogfooding] init (knowledge-pack mode, host)"
& node $CliJs init --project $sample --name dsh-dogfood-sample --type host --yes --knowledge-pack
if ($LASTEXITCODE -ne 0) { throw "dogfooding: init failed (exit $LASTEXITCODE)" }

Write-Host "[dogfooding] status = clean"
$status = & node $CliJs status --project $sample
Write-Host $status
if ($LASTEXITCODE -ne 0) { throw "dogfooding: status not clean (exit $LASTEXITCODE)" }

Write-Host "[dogfooding] pnpm install (build toolchain for the sample)"
Push-Location $sample
pnpm install
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "dogfooding: pnpm install failed" }
Pop-Location

Write-Host "[dogfooding] plug (snapshot -> add -> build -> two-step smoke)"
$plug = & node $CliJs plug --project $sample
Write-Host $plug
if ($LASTEXITCODE -ne 0) { throw "dogfooding: plug failed (exit $LASTEXITCODE)" }

Write-Host "[dogfooding] unplug (remove -> diff=0 -> clean)"
$unplug = & node $CliJs unplug --project $sample
Write-Host $unplug
if ($LASTEXITCODE -ne 0) { throw "dogfooding: unplug not clean (exit $LASTEXITCODE)" }

$final = & node $CliJs status --project $sample
Write-Host $final
if ($LASTEXITCODE -ne 0) { throw "dogfooding: final status not clean (exit $LASTEXITCODE)" }

Write-Host "[dogfooding] PASS: init -> clean -> plug -> smoke -> unplug -> diff=0 -> clean"
Write-Host "Artifacts kept at: $sample"
