[CmdletBinding()]
param(
    [string]$HostName = 'dev.upaiva.instagram_fluxo.logs',
    [string]$ExtensionId = 'pbhboajbblogfchdgclpfolffnalkaag',
    [string]$LogDirectory,
    [string]$InstallDirectory,
    [string]$PythonPath = 'C:\Python314\python.exe',
    [int]$MaxSegmentBytes = 5242880,
    [int]$MaxTotalBytes = 268435456,
    [int]$RetentionDays = 90,
    [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$baseName = 'dev.upaiva.instagram_fluxo.logs'
$productionId = 'pbhboajbblogfchdgclpfolffnalkaag'
$workspace = [IO.Path]::GetFullPath((Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent))
$defaultLog = Join-Path $workspace 'logs\instagram-fluxo'
$isQa = $HostName -cmatch ('^' + [regex]::Escape($baseName) + '\.qa_[a-f0-9]{32}$')
if ($HostName -cne $baseName -and -not $isQa) { throw 'Invalid host name.' }
if ($ExtensionId -cnotmatch '^[a-p]{32}$') { throw 'Invalid extension ID.' }
if (-not $LogDirectory) { $LogDirectory = $defaultLog }
if (-not $InstallDirectory) { $InstallDirectory = Join-Path $workspace ('work\instagram-fluxo-native-host\' + $HostName) }

function Resolve-ContainedDirectory([string]$PathValue) {
    if (-not [IO.Path]::IsPathRooted($PathValue)) { throw 'Absolute paths are required.' }
    $absolute = [IO.Path]::GetFullPath($PathValue).TrimEnd('\', '/')
    if (-not $absolute.StartsWith($workspace.TrimEnd('\', '/') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Path must be inside this workspace.' }
    # Reject reparse points at every existing component, including workspace itself.
    $cursor = $absolute
    while ($cursor -and $cursor.Length -ge $workspace.Length) {
        if (Test-Path -LiteralPath $cursor) {
            $entry = Get-Item -LiteralPath $cursor -Force
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points are not allowed.' }
        }
        if ($cursor -ieq $workspace) { break }
        $cursor = Split-Path $cursor -Parent
    }
    return $absolute
}

function Get-Sha256([string]$PathValue) {
    $stream = [IO.File]::OpenRead($PathValue)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}

$LogDirectory = Resolve-ContainedDirectory $LogDirectory
$InstallDirectory = Resolve-ContainedDirectory $InstallDirectory
if (-not $isQa -and ($ExtensionId -cne $productionId -or $LogDirectory -ine [IO.Path]::GetFullPath($defaultLog))) { throw 'Production origin and log directory are fixed.' }
if ($MaxSegmentBytes -lt 512 -or $MaxSegmentBytes -gt 5242880 -or $MaxTotalBytes -lt (2 * $MaxSegmentBytes) -or $MaxTotalBytes -gt 268435456 -or $RetentionDays -lt 1 -or $RetentionDays -gt 90) { throw 'Invalid retention limits.' }
if (-not $isQa -and ($MaxSegmentBytes -ne 5242880 -or $MaxTotalBytes -ne 268435456 -or $RetentionDays -ne 90)) { throw 'Production retention limits are fixed.' }
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\' + $HostName
$manifestPath = Join-Path $InstallDirectory ($HostName + '.json')
$statePath = Join-Path $InstallDirectory 'registration-state.json'
$currentKey = if (Test-Path -LiteralPath $registryPath) { Get-Item -LiteralPath $registryPath } else { $null }
$currentValue = if ($currentKey) { [string]$currentKey.GetValue('', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null }

if ($Uninstall) {
    if (-not $currentKey) { Write-Output 'Native host is already unregistered; logs were preserved.'; exit 0 }
    if ($currentValue -ine $manifestPath) { throw 'Registration belongs to another installation; nothing was changed.' }
    if (-not (Test-Path -LiteralPath $statePath)) { throw 'Missing registration backup; nothing was changed.' }
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($state.hostName -cne $HostName -or $state.manifestPath -ine $manifestPath) { throw 'Registration state does not match.' }
    if ($state.hadKey) {
        if ($state.hadDefault) {
            Set-Item -LiteralPath $registryPath -Value ([string]$state.previousDefault)
        } else {
            $key = Get-Item -LiteralPath $registryPath
            $key.DeleteValue('', $false)
        }
    } else {
        $key = Get-Item -LiteralPath $registryPath
        $extraValues = @($key.GetValueNames() | Where-Object { $_ -ne '' })
        if ($key.SubKeyCount -ne 0 -or $extraValues.Count -ne 0) {
            $key.DeleteValue('', $false)
        } else {
            Remove-Item -LiteralPath $registryPath
        }
    }
    Write-Output 'Native host registration reverted; program files, backup and logs were preserved.'
    exit 0
}

if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) { throw 'Python executable was not found.' }
$PythonPath = (Resolve-Path -LiteralPath $PythonPath).ProviderPath
foreach ($safePath in @($PythonPath, $InstallDirectory, $workspace)) {
    if ($safePath -match '[%&|<>^!\r\n\"]' -or $safePath -match '[^\x20-\x7e]') { throw 'Launcher path contains unsupported command characters.' }
}
New-Item -ItemType Directory -Path $InstallDirectory -Force | Out-Null
$InstallDirectory = Resolve-ContainedDirectory $InstallDirectory
if ($currentKey -and $currentValue -ieq $manifestPath) {
    if (-not (Test-Path -LiteralPath $statePath)) { throw 'Existing registration has no ownership backup; nothing was changed.' }
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($state.hostName -cne $HostName -or $state.manifestPath -ine $manifestPath) { throw 'Existing registration state does not match.' }
} else {
    if ($currentKey -and ($currentKey.SubKeyCount -ne 0 -or @($currentKey.GetValueNames() | Where-Object { $_ -ne '' }).Count -ne 0)) { throw 'Unexpected registry data; refusing to replace this key.' }
    $hadDefault = $currentKey -and @($currentKey.GetValueNames()).Contains('')
    if ($hadDefault -and $currentKey.GetValueKind('') -ne [Microsoft.Win32.RegistryValueKind]::String) { throw 'Unexpected registry value type; nothing was changed.' }
    if (Test-Path -LiteralPath $statePath) {
        $archivePath = Join-Path $InstallDirectory ('registration-state-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffff') + '.json')
        Copy-Item -LiteralPath $statePath -Destination $archivePath
    }
    $state = [ordered]@{ hostName=$HostName; manifestPath=$manifestPath; hadKey=[bool]$currentKey; hadDefault=[bool]$hadDefault; previousDefault=$currentValue }
    $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
}

$configPath = Join-Path $InstallDirectory 'config.json'
$launcherPath = Join-Path $InstallDirectory 'launch.cmd'
# Register a copy of the reviewed files. Build edits cannot change what Chrome launches.
$hostSource = Join-Path $PSScriptRoot 'host.py'
$contractSource = Join-Path (Split-Path $PSScriptRoot -Parent) 'diagnostic-contract.json'
$hostHash = Get-Sha256 $hostSource
$contractHash = Get-Sha256 $contractSource
$snapshot = Resolve-ContainedDirectory (Join-Path $InstallDirectory ('build-' + $hostHash.Substring(0,16) + '-' + $contractHash.Substring(0,16)))
New-Item -ItemType Directory -Path $snapshot -Force | Out-Null
$hostPath = Join-Path $snapshot 'host.py'
$contractPath = Join-Path $snapshot 'diagnostic-contract.json'
foreach ($artifact in @(@{source=$hostSource;target=$hostPath;hash=$hostHash},@{source=$contractSource;target=$contractPath;hash=$contractHash})) {
    if (-not (Test-Path -LiteralPath $artifact.target)) { [IO.File]::Copy($artifact.source,$artifact.target,$false) }
    $item = Get-Item -LiteralPath $artifact.target -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or (Get-Sha256 $artifact.target) -cne $artifact.hash) { throw 'Installed host snapshot failed verification.' }
}
[ordered]@{ protocol=1; hostName=$HostName; allowedOrigin=('chrome-extension://' + $ExtensionId + '/'); logDirectory=$LogDirectory; maxSegmentBytes=$MaxSegmentBytes; maxTotalBytes=$MaxTotalBytes; retentionDays=$RetentionDays } | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
$launcher = '@echo off' + "`r`n" + '"' + $PythonPath + '" "' + $hostPath + '" --config "' + $configPath + '" --workspace "' + $workspace + '" %*' + "`r`n"
[IO.File]::WriteAllText($launcherPath, $launcher, [Text.Encoding]::ASCII)
[ordered]@{ name=$HostName; description='Instagram Fluxo write-only local diagnostics'; path=$launcherPath; type='stdio'; allowed_origins=@('chrome-extension://' + $ExtensionId + '/') } | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8
# Register last: an interrupted setup cannot point Chrome at incomplete files.
New-Item -Path $registryPath -Force | Out-Null
Set-Item -LiteralPath $registryPath -Value $manifestPath
if ((Get-Item -LiteralPath $registryPath).GetValue('') -ine $manifestPath) { throw 'Registration verification failed.' }
Write-Output ('Registered ' + $HostName + ' for one extension; logs: ' + $LogDirectory)
