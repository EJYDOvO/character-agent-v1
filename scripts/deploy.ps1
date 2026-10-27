if (!$env:DSH_INSTALL_ROOT -or !$env:DSH_CHARACTER_PROJECT) { throw 'Set DSH_INSTALL_ROOT and DSH_CHARACTER_PROJECT explicitly before running integration scripts.' }
$ErrorActionPreference='Stop'
$root=$env:DSH_INSTALL_ROOT
$project=$env:DSH_CHARACTER_PROJECT
$runtime=$env:DSH_CHARACTER_HOST_ROOT;if(!$runtime){$runtime=$root}
$exe=Join-Path $runtime 'DeepSeek Harness.exe'
$lock=[IO.File]::Open("$root\data\maintenance\maintenance.lock",[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
$stopped=$false;$switched=$false;$started=$false;$hadHost=$false
try {
    & node "$project\scripts\deploy-guard.cjs" --preflight
    if($LASTEXITCODE -ne 0){throw 'Preflight failed; running Host was not stopped.'}
    $processes=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $exe})
    $hadHost=$processes.Count -gt 0
    if(@($processes | Where-Object {$_.CommandLine -notmatch '--profile character-test'}).Count){
        $status=(& node "$root\maintenance\ops.cjs" status | ConvertFrom-Json)
        if($LASTEXITCODE -ne 0 -or !$status.idle){throw 'Production host is not confirmed idle; switch refused.'}
    }
    foreach($p in $processes){Stop-Process -Id $p.ProcessId -ErrorAction SilentlyContinue}
    Start-Sleep -Milliseconds 700
    if(@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $exe}).Count){throw 'Host still running; switch refused.'}
    $stopped=$true
    & ([scriptblock]::Create((Get-Content -LiteralPath "$project\scripts\offline-checkpoint.ps1" -Raw)))
    & node "$project\scripts\audit-state.cjs" | Out-Null
    if($LASTEXITCODE -ne 0){throw 'State audit failed'}
    & node "$project\scripts\deploy-guard.cjs"
    if($LASTEXITCODE -ne 0){throw 'Deployment gate failed'}
    & node "$project\scripts\switch-profile.cjs"
    if($LASTEXITCODE -ne 0){throw 'Profile switch failed'}
    $switched=$true
    $env:DSH_HOME="$root\data"
    $env:TEMP="$root\tmp"
    $env:TMP="$root\tmp"
    Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdout="$root\tmp\desktop-character-$stamp.stdout.log"
    $stderr="$root\tmp\desktop-character-$stamp.stderr.log"
    $p=Start-Process -FilePath $exe -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $started=$true
    [ordered]@{startedAt=(Get-Date).ToString('o');pid=$p.Id;stdout=$stdout;stderr=$stderr;status='awaiting-health'} | ConvertTo-Json | Set-Content "$root\data\maintenance\character-deploy\runtime.json" -Encoding utf8
    Write-Output "Character deployment started; PID=$($p.Id). Health and QQ ready still require verification."
} catch {
    $failure=$_
    if($stopped -and !$started -and $hadHost){
        if($switched){& node "$project\scripts\rollback.cjs";if($LASTEXITCODE -ne 0){throw 'Deployment and compatibility rollback failed; Host remains stopped for manual recovery.'}}
        $env:DSH_HOME="$root\data";$env:TEMP="$root\tmp";$env:TMP="$root\tmp";Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
        Start-Process -FilePath $exe -WorkingDirectory $root -WindowStyle Hidden | Out-Null
        Write-Warning 'Deployment failed; the previous Profile was restarted. Health still requires verification.'
    }
    throw $failure
} finally {$lock.Dispose()}
