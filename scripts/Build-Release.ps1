#requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\', '/')
$outputRoot = Join-Path $projectRoot 'dist'
$files = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-files.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($files -isnot [array]) { throw 'Release file list must be a JSON array.' }
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'plugin/plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.name -cne 'context-glance' -or $manifest.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid plugin identity/version.' }

function Assert-NoReparse {
    param([string]$Target)
    $current = [IO.Path]::GetFullPath($Target)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Reparse path refused: $current" }
        }
        $next = [IO.Path]::GetDirectoryName($current.TrimEnd('\', '/'))
        if (-not $next -or $next -eq $current) { break }
        $current = $next
    }
}

Assert-NoReparse -Target $projectRoot
Assert-NoReparse -Target $outputRoot
$seen = @{}
$sources = foreach ($relative in $files) {
    if ($relative -isnot [string] -or [IO.Path]::IsPathRooted($relative) -or
        $relative.Contains('\') -or ($relative.Split('/') -contains '..') -or
        $relative -match '(^|/)(\.git|\.verification|node_modules|dist)(/|$)' -or $seen.ContainsKey($relative)) {
        throw "Unsafe/duplicate release path: $relative"
    }
    $seen[$relative] = $true
    $source = [IO.Path]::GetFullPath((Join-Path $projectRoot $relative))
    if (-not $source.StartsWith(($projectRoot + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) { throw "Outside project: $relative" }
    Assert-NoReparse -Target $source
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing release file: $relative" }
    [pscustomobject]@{ Relative = $relative; Source = $source }
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$archivePath = Join-Path $outputRoot ("context-glance-v{0}.zip" -f $manifest.version)
Assert-NoReparse -Target $archivePath
# Only replace this generated archive, never delete source directories.
if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
Add-Type -AssemblyName System.IO.Compression
$stream = [IO.File]::Open($archivePath, [IO.FileMode]::CreateNew)
$zip = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
$sums = New-Object 'System.Collections.Generic.List[string]'
try {
    foreach ($file in $sources) {
        $entry = $zip.CreateEntry(('context-glance/' + $file.Relative), [IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        $sourceStream = [IO.File]::OpenRead($file.Source)
        try { $sourceStream.CopyTo($entryStream) } finally { $sourceStream.Dispose(); $entryStream.Dispose() }
        $hash = (Get-FileHash -LiteralPath $file.Source -Algorithm SHA256).Hash.ToLowerInvariant()
        $sums.Add($hash + '  ' + $file.Relative)
    }
    $sumEntry = $zip.CreateEntry('context-glance/SHA256SUMS.txt')
    $sumStream = $sumEntry.Open()
    $sumBytes = (New-Object Text.UTF8Encoding($false)).GetBytes(($sums -join "`n") + "`n")
    try { $sumStream.Write($sumBytes, 0, $sumBytes.Length) } finally { $sumStream.Dispose() }
} finally { $zip.Dispose(); $stream.Dispose() }
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumPath = $archivePath + '.sha256'
Assert-NoReparse -Target $checksumPath
[IO.File]::WriteAllText($checksumPath, ($archiveHash + '  ' + [IO.Path]::GetFileName($archivePath) + "`n"), (New-Object Text.UTF8Encoding($false)))
[pscustomobject]@{ Archive = $archivePath; Files = $sources.Count; SHA256 = $archiveHash; Checksum = $checksumPath }
