$ErrorActionPreference='Stop'
# Isolated character manager probe: A to B, interrupted rollback to B, then A.
$runtime=$env:DSH_CHARACTER_HOST_ROOT;if(!$runtime){$runtime=$env:DSH_INSTALL_ROOT}
if(!$env:DSH_INSTALL_ROOT){throw 'Set DSH_INSTALL_ROOT explicitly'}
$project=Split-Path $PSScriptRoot -Parent
$node=$env:DSH_NODE_EXE;if(!$node){$node=(Get-Command node -ErrorAction Stop).Source}
$saved=@{}
foreach($key in @('DSH_HOME','ELECTRON_RUN_AS_NODE','TEMP','TMP')){$saved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
$p=$null
try {
& $node (Join-Path $PSScriptRoot 'stage-character-manager.cjs') @args
if($LASTEXITCODE -ne 0){throw 'Staging failed'}
$run=Get-Content -LiteralPath (Join-Path $project 'test-data/character-manager-run.json') -Raw | ConvertFrom-Json
$env:DSH_HOME=$run.home
$env:ELECTRON_RUN_AS_NODE='1'
$env:TEMP=Join-Path $run.home 'tmp';$env:TMP=$env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
$exe=Join-Path $runtime 'DeepSeek Harness.exe'
$toolkit=$env:DSH_QQTK_PROJECT;if(!$toolkit){$toolkit=Join-Path (Split-Path -Parent $project) 'harness-qq-toolkit'}
$switchHelper=Join-Path $toolkit 'maintenance/character-switch.cjs'
$cli=Join-Path $runtime 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'
$resolver=([Uri](Join-Path $project 'tests/lifecycle-sdk-resolver.mjs')).AbsoluteUri
$reports=@()
foreach($phase in 1,2,4,3){
 if($phase -gt 1){
  & $node (Join-Path $PSScriptRoot 'stage-character-manager.cjs') "--phase$phase" $run.home
  if($LASTEXITCODE -ne 0){throw 'Switch staging failed'}
  Remove-Item -LiteralPath $run.result
 }
 $startedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
 $p=Start-Process -FilePath $exe -ArgumentList @('--expose-internals','--import',$resolver,('"{0}"' -f $cli),'--profile','inspector','--no-open','--port','0') -WorkingDirectory $run.home -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run.home "stdout-$phase.log") -RedirectStandardError (Join-Path $run.home "stderr-$phase.log")
 # Phase 2 waits for A's reminder to fall due (60 s after phase 1 set it).
 $deadline=(Get-Date).AddSeconds(300)
 while(!(Test-Path -LiteralPath $run.result) -and (Get-Date) -lt $deadline -and !$p.HasExited){Start-Sleep -Milliseconds 250;$p.Refresh()}
 if(!(Test-Path -LiteralPath $run.result)){throw "Isolated probe phase $phase timed out or failed to load; inspect private stderr-$phase.log"}
 $report=Get-Content -LiteralPath $run.result -Raw | ConvertFrom-Json
 if($report.runId -ne $run.runId -or $report.phase -ne $phase){throw 'Stale probe result'}
 if($phase -eq 4 -and $report.ok){
  & $node $switchHelper verify $run.home "$startedAt" "$($p.Id)" previous | Out-Host
  if($LASTEXITCODE -ne 0){throw 'Rollback did not start a fresh native Host serving the previous character'}
  & $node $switchHelper finish $run.home fail interrupted true | Out-Host
  if($LASTEXITCODE -ne 0){throw 'Rollback result could not be recorded'}
  $rollbackResult=Get-Content -LiteralPath (Join-Path $run.home 'data/maintenance/character-switch-result.json') -Raw | ConvertFrom-Json
  if($rollbackResult.ok -ne $false -or $rollbackResult.restored -ne $true){throw 'Incorrect rollback outcome'}
 }
 $reports+=$report
 $p.Refresh();if(!$p.HasExited){& taskkill.exe /T /F /PID $p.Id 2>&1 | Out-Null};if(!$p.WaitForExit(5000)){throw 'Isolated test process did not exit'};$p=$null
 if(!$report.ok){$reports | ConvertTo-Json -Depth 10;throw "Isolated character manager assertions failed in phase $phase"}
}
$reports | ConvertTo-Json -Depth 10
} finally {
 try {
  if($p){$p.Refresh();if(!$p.HasExited){& taskkill.exe /T /F /PID $p.Id 2>&1 | Out-Null};if(!$p.WaitForExit(5000)){throw 'Isolated test process did not exit'}}
 } finally {
  foreach($key in $saved.Keys){[Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}
 }
}
