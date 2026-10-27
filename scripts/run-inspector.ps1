$ErrorActionPreference='Stop'
$runtime=$env:DSH_CHARACTER_HOST_ROOT;if(!$runtime){$runtime=$env:DSH_INSTALL_ROOT}
if(!$env:DSH_INSTALL_ROOT){throw 'Set DSH_INSTALL_ROOT explicitly'}
$project=Split-Path $PSScriptRoot -Parent
$node=Join-Path $env:DSH_INSTALL_ROOT 'resources/runtime/primary-runtime/dependencies/node/bin/node.exe'
$saved=@{}
foreach($key in @('DSH_HOME','ELECTRON_RUN_AS_NODE','TEMP','TMP')){$saved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
$p=$null
try {
& $node (Join-Path $PSScriptRoot 'stage-inspector.cjs') @args
if($LASTEXITCODE -ne 0){throw 'Staging failed'}
$run=Get-Content -LiteralPath (Join-Path $project 'test-data/inspector-run.json') -Raw | ConvertFrom-Json
$env:DSH_HOME=$run.home
$env:ELECTRON_RUN_AS_NODE='1'
$env:TEMP=Join-Path $run.home 'tmp';$env:TMP=$env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
$exe=Join-Path $runtime 'DeepSeek Harness.exe'
$cli=Join-Path $runtime 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'
$resolver=([Uri](Join-Path $project 'tests/inspector-sdk-resolver.mjs')).AbsoluteUri
$phases=1;if($args -contains '--workers'){$phases=2}
for($phase=0;$phase -lt $phases;$phase++){
if($phase -gt 0){Move-Item -LiteralPath $run.result -Destination (Join-Path $run.home 'phase0.json')}
$p=Start-Process -FilePath $exe -ArgumentList @('--expose-internals','--import',$resolver,('"{0}"' -f $cli),'--profile','inspector','--no-open','--port','0') -WorkingDirectory $run.home -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run.home 'stdout.log') -RedirectStandardError (Join-Path $run.home 'stderr.log')
 $timeout=55;if($args -contains '--real-model-ab'){$timeout=360}
 $deadline=(Get-Date).AddSeconds($timeout)
 while(!(Test-Path -LiteralPath $run.result) -and (Get-Date) -lt $deadline -and !$p.HasExited){Start-Sleep -Milliseconds 250;$p.Refresh()}
 if(!(Test-Path -LiteralPath $run.result)){throw 'Isolated probe timed out or failed to load; inspect private stderr.log'}
 $report=Get-Content -LiteralPath $run.result -Raw | ConvertFrom-Json
 if($report.runId -ne $run.runId){throw 'Stale probe result'}
 $report | ConvertTo-Json -Depth 10
 if(!$report.ok){throw 'Isolated Inspector/Worker assertions failed'}
 if($phases -gt 1 -and $report.restart -ne [bool]$phase){throw 'Worker restart phase mismatch'}
 if($args -contains '--preview'){
  $previewDeadline=(Get-Date).AddSeconds(600)
  while(!(Test-Path -LiteralPath (Join-Path $run.home 'preview.done')) -and (Get-Date) -lt $previewDeadline -and !$p.HasExited){Start-Sleep -Milliseconds 250;$p.Refresh()}
 }
 $p.Refresh();if(!$p.HasExited){Stop-Process -Id $p.Id};if(!$p.WaitForExit(5000)){throw 'Isolated Host did not stop'};$p=$null
}
} finally {
 try {
  if($p){$p.Refresh();if(!$p.HasExited){Stop-Process -Id $p.Id};if(!$p.WaitForExit(5000)){throw 'Isolated test process did not exit'}}
 } finally {
  foreach($key in $saved.Keys){[Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}
 }
}
