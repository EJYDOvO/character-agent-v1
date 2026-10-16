if (!$env:DSH_INSTALL_ROOT -or !$env:DSH_CHARACTER_PROJECT) { throw 'Set DSH_INSTALL_ROOT and DSH_CHARACTER_PROJECT explicitly before running integration scripts.' }
$ErrorActionPreference='Stop'
$project=$env:DSH_CHARACTER_PROJECT
$exe=Join-Path $env:DSH_INSTALL_ROOT "DeepSeek Harness.exe"
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $exe -and $_.CommandLine -match '--profile character-test' } | ForEach-Object { Stop-Process -Id $_.ProcessId }
$env:DSH_HOME="$project\test-data\home"
$env:ELECTRON_RUN_AS_NODE='1'
$p=Start-Process -FilePath $exe -ArgumentList @('--expose-internals',(Join-Path $env:DSH_INSTALL_ROOT "resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js"),'--profile','character-test','--patch',"$project\test-data\probe.patch.yml",'--no-open','--port','0') -WorkingDirectory $project -WindowStyle Hidden -PassThru -RedirectStandardOutput "$project\artifacts\probe.stdout.log" -RedirectStandardError "$project\artifacts\probe.stderr.log"
Write-Output "Isolated probe PID=$($p.Id)"
