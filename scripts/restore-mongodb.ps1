param([Parameter(Mandatory=$true)][string]$Archive, [switch]$Drop)
$ErrorActionPreference = "Stop"
if (-not $env:MONGODB_URI) { throw "Defina MONGODB_URI antes de restaurar." }
$resolvedArchive = (Resolve-Path -LiteralPath $Archive).Path
if (-not $resolvedArchive.EndsWith(".archive.gz")) { throw "Selecione um arquivo .archive.gz criado pela rotina de backup." }
$arguments = @("--uri=$env:MONGODB_URI", "--archive=$resolvedArchive", "--gzip")
if ($Drop) { $arguments += "--drop" }
mongorestore @arguments
if ($LASTEXITCODE -ne 0) { throw "mongorestore falhou." }
Write-Host "Restauração concluída: $resolvedArchive"
