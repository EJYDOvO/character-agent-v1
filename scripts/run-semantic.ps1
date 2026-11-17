$ErrorActionPreference='Stop'
# Native Host gate for optional semantic recall (D1). Isolated Home, synthetic memories, deterministic
# model adapter, real embedding worker. Requires a provisioned runtime and model:
#   $env:DSH_SEMANTIC_RUNTIME_DIR, $env:DSH_SEMANTIC_MODEL_DIR
$runtime=$env:DSH_CHARACTER_HOST_ROOT;if(!$runtime){$runtime=$env:DSH_INSTALL_ROOT}
if(!$env:DSH_INSTALL_ROOT){throw 'Set DSH_INSTALL_ROOT explicitly'}
$project=Split-Path $PSScriptRoot -Parent
$node=$env:DSH_NODE_EXE;if(!$node){$node=(Get-Command node -ErrorAction Stop).Source}
$saved=@{};foreach($key in @('DSH_HOME','ELECTRON_RUN_AS_NODE','TEMP','TMP')){$saved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
$p=$null
try{
 & $node (Join-Path $PSScriptRoot 'stage-semantic.cjs') @args;if($LASTEXITCODE -ne 0){throw 'Semantic staging failed'}
 $run=Get-Content -LiteralPath (Join-Path $project 'test-data/semantic-run.json') -Raw|ConvertFrom-Json
 $env:DSH_HOME=$run.home;$env:ELECTRON_RUN_AS_NODE='1';$env:TEMP=Join-Path $run.home 'tmp';$env:TMP=$env:TEMP
 $exe=Join-Path $runtime 'DeepSeek Harness.exe'
 $cli=Join-Path $runtime 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'
 $resolver=([Uri](Join-Path $project 'tests/inspector-sdk-resolver.mjs')).AbsoluteUri
 $p=Start-Process -FilePath $exe -ArgumentList @('--expose-internals','--import',$resolver,('"{0}"' -f $cli),'--profile','semantic','--no-open','--port','0') -WorkingDirectory $run.home -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run.home 'stdout.log') -RedirectStandardError (Join-Path $run.home 'stderr.log')
 $deadline=(Get-Date).AddSeconds(420)
 while(!(Test-Path -LiteralPath $run.result) -and (Get-Date) -lt $deadline -and !$p.HasExited){Start-Sleep -Milliseconds 250;$p.Refresh()}
 if(!(Test-Path -LiteralPath $run.result)){throw 'Semantic probe timed out or failed to load; inspect the isolated stderr.log'}
 $report=Get-Content -LiteralPath $run.result -Raw|ConvertFrom-Json
 if($report.runId -ne $run.runId){throw 'Stale probe result'}
 $report|ConvertTo-Json -Depth 12
 if(!$report.ok){throw 'Semantic recall Host assertions failed'}
}finally{
 try{if($p){$p.Refresh();if(!$p.HasExited){& taskkill.exe /T /F /PID $p.Id 2>&1|Out-Null};$p.WaitForExit(5000)|Out-Null}}
 finally{foreach($key in $saved.Keys){[Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}}
}
