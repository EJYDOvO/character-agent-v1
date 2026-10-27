$ErrorActionPreference='Stop'
$runtime=$env:DSH_CHARACTER_HOST_ROOT;if(!$runtime){$runtime=$env:DSH_INSTALL_ROOT}
if(!$env:DSH_INSTALL_ROOT){throw 'Set DSH_INSTALL_ROOT explicitly'}
$project=Split-Path $PSScriptRoot -Parent
$node=Join-Path $env:DSH_INSTALL_ROOT 'resources/runtime/primary-runtime/dependencies/node/bin/node.exe'
$saved=@{};foreach($key in @('DSH_HOME','ELECTRON_RUN_AS_NODE','TEMP','TMP')){$saved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
$p=$null
try{
 & $node (Join-Path $PSScriptRoot 'stage-lifecycle.cjs');if($LASTEXITCODE -ne 0){throw 'Lifecycle staging failed'}
 $run=Get-Content (Join-Path $project 'test-data/lifecycle-run.json') -Raw|ConvertFrom-Json
 $env:DSH_HOME=$run.home;$env:ELECTRON_RUN_AS_NODE='1';$env:TEMP=Join-Path $run.home 'tmp';$env:TMP=$env:TEMP
 for($phase=0;$phase -lt 2;$phase++){
  if($phase -eq 1){Start-Sleep -Seconds 13} # one-shot task deadlines expire while Host is stopped
  if(Test-Path -LiteralPath $run.result){Move-Item -LiteralPath $run.result -Destination (Join-Path $run.home 'phase0.json')}
  $resolver=([Uri](Join-Path $project 'tests/lifecycle-sdk-resolver.mjs')).AbsoluteUri
  $p=Start-Process -FilePath (Join-Path $runtime 'DeepSeek Harness.exe') -ArgumentList @('--expose-internals','--import',$resolver,('"{0}"' -f (Join-Path $runtime 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')),'--profile','lifecycle','--no-open','--port','0') -WorkingDirectory $run.home -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run.home "phase-$phase.stdout.log") -RedirectStandardError (Join-Path $run.home "phase-$phase.stderr.log")
  $deadline=(Get-Date).AddSeconds(95)
  while(!(Test-Path -LiteralPath $run.result) -and (Get-Date) -lt $deadline -and !$p.HasExited){Start-Sleep -Milliseconds 250;$p.Refresh();$diagnostic=Get-Content -LiteralPath (Join-Path $run.home "phase-$phase.stderr.log") -Raw -ErrorAction SilentlyContinue;if($diagnostic -match 'dsh: warning: \d+ entr'){throw 'Isolated Host contains inactive entries; inspect private logs'}}
  if(!(Test-Path -LiteralPath $run.result)){throw 'Lifecycle Host failed to report; inspect isolated logs'}
  $r=Get-Content -LiteralPath $run.result -Raw|ConvertFrom-Json;$r|ConvertTo-Json -Depth 10
  if(!$r.ok -or $r.runId -ne $run.runId -or $r.restart -ne [bool]$phase){throw 'Lifecycle assertions failed or stale result'}
  $p.Refresh();if(!$p.HasExited){Stop-Process -Id $p.Id};$p.WaitForExit(5000)|Out-Null;$p=$null
 }
}finally{try{if($p){$p.Refresh();if(!$p.HasExited){Stop-Process -Id $p.Id};$p.WaitForExit(5000)|Out-Null}}finally{foreach($key in $saved.Keys){[Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}}}
