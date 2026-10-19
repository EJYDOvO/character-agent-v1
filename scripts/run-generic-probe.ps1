param([ValidateSet('memory','qq')][string]$Kind='memory')
$ErrorActionPreference='Stop'
if(!$env:DSH_INSTALL_ROOT -or !$env:DSH_CHARACTER_PROJECT){throw 'Explicit install/project roots required'}
$project=$env:DSH_CHARACTER_PROJECT
$exe=Join-Path $env:DSH_INSTALL_ROOT 'DeepSeek Harness.exe'
if($Kind -eq 'qq' -and @(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $exe}).Count){throw 'QQ test requires all other DSH hosts stopped (single-active gate)'}
$env:DSH_HOME=Join-Path $project 'test-data/generic-home'
$env:ELECTRON_RUN_AS_NODE='1'
$result=Join-Path $project "artifacts/generic-$Kind-host.json"
if(Test-Path -LiteralPath $result){Remove-Item -LiteralPath $result}
$p=Start-Process -FilePath $exe -ArgumentList @('--expose-internals',(Join-Path $env:DSH_INSTALL_ROOT 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'),'--profile',"generic-$Kind",'--no-open','--port','0') -WorkingDirectory $project -WindowStyle Hidden -PassThru -RedirectStandardOutput "$project/artifacts/generic-$Kind.stdout.log" -RedirectStandardError "$project/artifacts/generic-$Kind.stderr.log"
Write-Output "Generic $Kind probe PID=$($p.Id)"
