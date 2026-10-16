if (!$env:DSH_INSTALL_ROOT -or !$env:DSH_CHARACTER_PROJECT) { throw 'Set DSH_INSTALL_ROOT and DSH_CHARACTER_PROJECT explicitly before running integration scripts.' }
$ErrorActionPreference = 'Stop'
$installRoot = $env:DSH_INSTALL_ROOT
$running = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$installRoot\*" })
if ($running.Count) { throw 'Installation has live processes; offline checkpoint refused.' }
$checkpoint = Join-Path $installRoot ('data\maintenance\character-checkpoints\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $checkpoint | Out-Null
$manifest = @()
foreach ($relative in @('data\profiles\desktop','data\sessions','data\storages','data\qqbot','data\character','data\.credentials.yaml','data\.env','maintenance','plugin-packages','resources\app-update.yml','version')) {
    $source = Join-Path $installRoot $relative
    if (!(Test-Path -LiteralPath $source)) { continue }
    $files = if ((Get-Item -LiteralPath $source).PSIsContainer) { @(Get-ChildItem -LiteralPath $source -Recurse -File | Where-Object { $_.FullName -notmatch '\\node_modules\\' }) } else { @(Get-Item -LiteralPath $source) }
    foreach ($file in $files) {
        $rel = $file.FullName.Substring($installRoot.Length + 1)
        $target = Join-Path $checkpoint $rel
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        $before = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        Copy-Item -LiteralPath $file.FullName -Destination $target
        $after = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
        if ($before -ne $after -or $before -ne (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash) { throw 'Checkpoint integrity mismatch.' }
        $manifest += [ordered]@{ path=$rel; sha256=$after; bytes=$file.Length }
    }
}
if (@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like "$installRoot\*" }).Count) { throw 'Host started during checkpoint; do not use snapshot.' }
[ordered]@{createdAt=(Get-Date).ToString('o');verified=$true;excludes='node_modules; reproducible using lockfile and retained cache';officialAsarSha256=(Get-FileHash -LiteralPath "$installRoot\resources\app.asar").Hash;files=$manifest} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $checkpoint 'manifest.json') -Encoding utf8
Write-Output "Verified offline checkpoint: $checkpoint; files=$($manifest.Count)"
