param([string]$Destination = "$PSScriptRoot\..\backups", [int]$RetentionDays = 30)
$ErrorActionPreference = "Stop"
if (-not $env:MONGODB_URI) { throw "Defina MONGODB_URI antes de executar o backup." }
$resolvedDestination = [System.IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $resolvedDestination | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$archive = Join-Path $resolvedDestination "finanflow-$stamp.archive.gz"
mongodump --uri=$env:MONGODB_URI --archive=$archive --gzip
if ($LASTEXITCODE -ne 0) { throw "mongodump falhou." }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash
Set-Content -LiteralPath "$archive.sha256" -Value "$hash  $(Split-Path $archive -Leaf)"
Get-ChildItem -LiteralPath $resolvedDestination -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } | Remove-Item -Force
Write-Host "Backup criado e verificado: $archive"
