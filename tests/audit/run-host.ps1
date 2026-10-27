$ErrorActionPreference='Stop'
$runtime=$env:DSH_CHARACTER_HOST_ROOT;if(!$runtime){$runtime=$env:DSH_INSTALL_ROOT}
if(!$env:DSH_INSTALL_ROOT){throw 'Set DSH_INSTALL_ROOT explicitly'}
$project=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$node=Join-Path $env:DSH_INSTALL_ROOT 'resources/runtime/primary-runtime/dependencies/node/bin/node.exe'
$saved=@{};foreach($key in @('DSH_HOME','ELECTRON_RUN_AS_NODE','TEMP','TMP')){$saved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
$p=$null
try {
 & $node (Join-Path $project 'scripts/stage-interaction.cjs')
 if($LASTEXITCODE -ne 0){throw 'Staging failed'}
 $run=Get-Content (Join-Path $project 'test-data/interaction-run.json') -Raw | ConvertFrom-Json
 $patch=Join-Path $run.home 'profiles/interaction/cordis.patch.yml'
 $text=[IO.File]::ReadAllText($patch).Replace('/tests/interaction-host.mjs','/tests/audit/interaction-host-audit.mjs')
 [IO.File]::WriteAllText($patch,$text)
 $env:DSH_HOME=$run.home;$env:ELECTRON_RUN_AS_NODE='1';$env:TEMP=Join-Path $run.home 'tmp';$env:TMP=$env:TEMP
 New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
 $exe=Join-Path $runtime 'DeepSeek Harness.exe'
 $cli=Join-Path $runtime 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'
 $p=Start-Process -FilePath $exe -ArgumentList @('--expose-internals',('"{0}"' -f $cli),'--profile','interaction','--no-open','--port','0') -WorkingDirectory $run.home -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run.home 'stdout.log') -RedirectStandardError (Join-Path $run.home 'stderr.log')
 $deadline=(Get-Date).AddSeconds(35)
 while(!(Test-Path $run.result) -and (Get-Date) -lt $deadline -and !$p.HasExited){Start-Sleep -Milliseconds 200;$p.Refresh()}
 if(!(Test-Path $run.result)){throw 'Audit probe did not complete'}
 $report=Get-Content $run.result -Raw | ConvertFrom-Json
 if($report.runId -ne $run.runId){throw 'Stale result'}
 $report | ConvertTo-Json -Depth 8
 if(!$report.ok){throw 'Native release gate failed; see report'}
} finally {
 try {if($p){$p.Refresh();if(!$p.HasExited){Stop-Process -Id $p.Id};if(!$p.WaitForExit(5000)){throw 'Audit process did not exit'}}}
 finally {foreach($key in $saved.Keys){[Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}}
}
