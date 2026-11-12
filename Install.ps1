#requires -Version 5.1
<#
.SYNOPSIS
安装独立的 Antigravity Context Glance 插件；不会修改其他插件或宿主配置。
.EXAMPLE
.\Install.ps1
.EXAMPLE
.\Install.ps1 -CheckOnly
.EXAMPLE
.\Install.ps1 -DestinationRoot 'E:\临时测试\plugins'
#>
[CmdletBinding()]
param(
    [string]$DestinationRoot = (Join-Path $env:USERPROFILE '.gemini\config\plugins'),
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$pluginName = 'context-glance'
$sourceDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'plugin')).TrimEnd('\', '/')
$expandedRoot = [Environment]::ExpandEnvironmentVariables($DestinationRoot)
if (-not [IO.Path]::IsPathRooted($expandedRoot)) {
    throw 'DestinationRoot 必须是绝对路径。'
}
$destinationParent = [IO.Path]::GetFullPath($expandedRoot)
$destinationDirectory = [IO.Path]::GetFullPath((Join-Path $destinationParent $pluginName)).TrimEnd('\', '/')

$allowedFiles = @(
    'plugin.json',
    'README.md',
    'assets/logo.svg',
    'sidecars/context_glance/sidecar.json',
    'sidecars/context_glance/main.mjs',
    'sidecars/context_glance/metrics.mjs',
    'sidecars/context_glance/index.html',
    'sidecars/context_glance/styles.css',
    'sidecars/context_glance/dashboard.js'
)
$allowedDirectories = @('assets', 'sidecars', 'sidecars/context_glance')

function Assert-NoReparseAncestor {
    param([Parameter(Mandatory = $true)][string]$Path)

    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "拒绝符号链接、联接点或其他重解析路径：$current"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($current.TrimEnd('\', '/'))
        if (-not $parent -or $parent -eq $current) { break }
        $current = $parent
    }
}

function Test-Within {
    param([string]$Path, [string]$Root)

    return $Path.Equals($Root, [StringComparison]::OrdinalIgnoreCase) -or
        $Path.StartsWith(($Root + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)
}

function Assert-PluginTree {
    param([string]$Root, [switch]$RequireAll)

    Assert-NoReparseAncestor -Path $Root
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
        throw "插件目录不存在：$Root"
    }

    # 自己遍历每一层，在进入子目录前拒绝重解析点，避免递归越过边界。
    $queue = New-Object 'System.Collections.Generic.Queue[string]'
    $queue.Enqueue($Root)
    while ($queue.Count -gt 0) {
        $directory = $queue.Dequeue()
        foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force)) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "插件内存在重解析点，已停止：$($item.FullName)"
            }
            $relative = $item.FullName.Substring($Root.Length + 1).Replace('\', '/')
            if ($item.PSIsContainer) {
                if ($allowedDirectories -cnotcontains $relative) {
                    throw "插件含非发布目录，已停止：$relative"
                }
                $queue.Enqueue($item.FullName)
            } elseif ($allowedFiles -cnotcontains $relative) {
                throw "插件含非发布文件，已停止：$relative"
            }
        }
    }

    $manifestPath = Join-Path $Root 'plugin.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "目录缺少 plugin.json，拒绝覆盖：$Root"
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not ($manifest.PSObject.Properties.Name -contains 'name') -or $manifest.name -cne $pluginName) {
        throw "plugin.json 的 name 必须严格等于 $pluginName，已停止：$Root"
    }
    if ($RequireAll) {
        foreach ($relative in $allowedFiles) {
            if (-not (Test-Path -LiteralPath (Join-Path $Root $relative) -PathType Leaf)) {
                throw "缺少发布文件：$relative"
            }
        }
    }
}

if ([IO.Path]::GetFileName($destinationDirectory) -cne $pluginName) {
    throw '目标插件目录名必须为 context-glance。'
}
if ((Test-Within -Path $destinationDirectory -Root $sourceDirectory) -or
    (Test-Within -Path $sourceDirectory -Root $destinationDirectory)) {
    throw '安装目录不能与源插件目录相同、互相包含或重叠。'
}

Assert-PluginTree -Root $sourceDirectory -RequireAll
Assert-NoReparseAncestor -Path $destinationDirectory
$alreadyInstalled = Test-Path -LiteralPath $destinationDirectory
if ($alreadyInstalled) {
    Assert-PluginTree -Root $destinationDirectory
}

function Get-InstallationState {
    $checks = foreach ($relative in $allowedFiles) {
        $source = Join-Path $sourceDirectory $relative
        $destination = Join-Path $destinationDirectory $relative
        $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
        $destinationHash = $null
        if (Test-Path -LiteralPath $destination -PathType Leaf) {
            $destinationHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
        }
        [pscustomobject]@{
            File = $relative
            Exists = ($null -ne $destinationHash)
            Matches = ($sourceHash -eq $destinationHash)
            SourceSHA256 = $sourceHash
            InstalledSHA256 = $destinationHash
        }
    }
    $matching = @($checks | Where-Object { $_.Matches }).Count
    $status = 'NotInstalled'
    if (Test-Path -LiteralPath $destinationDirectory) {
        $status = 'Different'
        if ($matching -eq $allowedFiles.Count) { $status = 'Verified' }
    }
    [pscustomobject]@{
        Plugin = $pluginName
        Destination = $destinationDirectory
        Status = $status
        MatchedFiles = $matching
        TotalFiles = $allowedFiles.Count
        Files = @($checks)
    }
}

if ($CheckOnly) {
    Get-InstallationState
    return
}

New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
Assert-NoReparseAncestor -Path $destinationDirectory

# 首次安装先写身份标记，便于中途失败后安全重试；sidecar.json 最后写入，
# 完成后才让宿主发现可启动的 Sidecar。全程只覆盖本插件的白名单文件。
$copyOrder = @('plugin.json') + @($allowedFiles | Where-Object {
    $_ -ne 'plugin.json' -and $_ -ne 'sidecars/context_glance/sidecar.json'
}) + @('sidecars/context_glance/sidecar.json')
foreach ($relative in $copyOrder) {
    $destination = [IO.Path]::GetFullPath((Join-Path $destinationDirectory $relative))
    if (-not (Test-Within -Path $destination -Root $destinationDirectory)) {
        throw "拒绝越界安装路径：$relative"
    }
    Assert-NoReparseAncestor -Path $destination
    $parent = [IO.Path]::GetDirectoryName($destination)
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Assert-NoReparseAncestor -Path $parent
    Copy-Item -LiteralPath (Join-Path $sourceDirectory $relative) -Destination $destination -Force
}

$state = Get-InstallationState
if ($state.Status -ne 'Verified') {
    throw '安装后的 SHA256 校验失败。未删除任何目录；请检查文件后重试。'
}
Write-Host "Context Glance 安装并校验完成：$destinationDirectory"
Write-Host '在 Antigravity 会话标题的 + / 扩展菜单中打开“上下文仪表盘”。'
$state
