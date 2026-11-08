$ErrorActionPreference='Stop'
# Isolated Schedule v1 -> v2 drill: one synthetic DSH_HOME, rc.3 then rc.1 twice, then rc.3 observes v2.
# DSH_MIGRATION_FROM_ROOT: previous Host (writes v1). DSH_CHARACTER_HOST_ROOT: target Host.
if(!$env:DSH_MIGRATION_FROM_ROOT -or !$env:DSH_CHARACTER_HOST_ROOT){throw 'Set DSH_MIGRATION_FROM_ROOT and DSH_CHARACTER_HOST_ROOT explicitly'}
$project=Split-Path $PSScriptRoot -Parent
$node=$env:DSH_NODE_EXE;if(!$node){$node=(Get-Command node -ErrorAction Stop).Source}
# Isolated Home outside any git work tree (scripts/test-home.cjs).
$runId=[guid]::NewGuid().ToString();$home2=(& $node (Join-Path $PSScriptRoot 'test-home.cjs') new migration).Trim();if($LASTEXITCODE -ne 0 -or !$home2){throw 'Isolated test Home not created'};$dir=Join-Path $home2 'profiles/migration'
New-Item -ItemType Directory -Force -Path $dir,(Join-Path $home2 'tmp') | Out-Null
[IO.File]::WriteAllText((Join-Path $dir 'package.json'),(@{name='schedule-migration';private=$true;dsh=@{profile=@{bundles=@('@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app')}}}|ConvertTo-Json -Depth 5))
$probe=([Uri](Join-Path $project 'tests/schedule-migration-host.mjs')).AbsoluteUri;$result=Join-Path $home2 'result.json'
$saved=@{};foreach($key in @('DSH_HOME','DSH_AGENTS_HOME','ELECTRON_RUN_AS_NODE','TEMP','TMP','DSH_CHARACTER_HOST_ROOT')){$saved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
$target=$env:DSH_CHARACTER_HOST_ROOT;$p=$null;$reports=@()
try{
 $env:DSH_HOME=$home2;$env:DSH_AGENTS_HOME=Join-Path $home2 'agents';$env:ELECTRON_RUN_AS_NODE='1';$env:TEMP=Join-Path $home2 'tmp';$env:TMP=$env:TEMP
 $phases=@(@{phase=0;runtime=$env:DSH_MIGRATION_FROM_ROOT},@{phase=1;runtime=$target},@{phase=2;runtime=$target},@{phase=3;runtime=$env:DSH_MIGRATION_FROM_ROOT})
 foreach($step in $phases){
  $phase=$step.phase;$runtime=$step.runtime;$env:DSH_CHARACTER_HOST_ROOT=$runtime
  if(Test-Path -LiteralPath $result){Remove-Item -LiteralPath $result}
  $patch=@(@{id='session-title-llm';disabled=$true},@{id='llm-pi-ai';disabled=$true},@{insert=@(@{id='migration-probe';name=$probe;config=@{home=$home2;runId=$runId;phase=$phase;result=$result}})})
  [IO.File]::WriteAllText((Join-Path $dir 'cordis.patch.yml'),(ConvertTo-Json -InputObject $patch -Depth 8))
  $exe=Join-Path $runtime 'DeepSeek Harness.exe';$cli=Join-Path $runtime 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'
  $resolver=([Uri](Join-Path $project 'tests/inspector-sdk-resolver.mjs')).AbsoluteUri
  $p=Start-Process -FilePath $exe -ArgumentList @('--expose-internals','--import',$resolver,('"{0}"' -f $cli),'--profile','migration','--no-open','--port','0') -WorkingDirectory $home2 -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $home2 "phase-$phase.stdout.log") -RedirectStandardError (Join-Path $home2 "phase-$phase.stderr.log")
  $deadline=(Get-Date).AddSeconds(75)
  while(!(Test-Path -LiteralPath $result) -and (Get-Date) -lt $deadline -and !$p.HasExited){Start-Sleep -Milliseconds 250;$p.Refresh()}
  if(Test-Path -LiteralPath $result){$report=Get-Content -LiteralPath $result -Raw|ConvertFrom-Json}else{$report=[pscustomobject]@{phase=$phase;ok=$false;runId=$runId;error='No report (Host exited or timed out)';exited=$p.HasExited}}
  $reports+=$report;$report|ConvertTo-Json -Depth 8
  $p.Refresh();if(!$p.HasExited){Stop-Process -Id $p.Id};if(!$p.WaitForExit(5000)){throw 'Test Host did not stop'};$p=$null
  if($phase -lt 3 -and (!$report.ok -or $report.runId -ne $runId -or $report.phase -ne $phase)){throw "Migration drill failed in phase $phase"}
  # Rollback gate on the stopped Host: snapshot after the previous Host, then judge each later state.
  $gate=Join-Path $project 'scripts/rollback-gate.mjs';$manifest=Join-Path $home2 'rollback-manifest.json';$node=$env:DSH_NODE_EXE;if(!$node){$node=(Get-Command node -ErrorAction Stop).Source}
  if($phase -eq 0){
   & $node $gate record --home $home2 --out $manifest|Out-Null;if($LASTEXITCODE -ne 0){throw 'Rollback gate record failed'}
   $out=& $node $gate check --home $home2 --manifest $manifest;$code=$LASTEXITCODE;Write-Output "ROLLBACK_GATE phase=0 exit=$code";$out
   if($code -ne 0){throw 'Unchanged snapshot must allow Host rollback'}
  }elseif($phase -le 2){
   $out=& $node $gate check --home $home2 --manifest $manifest;$code=$LASTEXITCODE;Write-Output "ROLLBACK_GATE phase=$phase exit=$code";$out
   if($code -ne 3 -or !(($out -join "`n") -match 'schedule version 1 -> 2')){throw 'Rollback gate must refuse Host rollback after the v2 write'}
  }
  $global:LASTEXITCODE=0
 }
 Write-Output ("MIGRATION_HOME=$home2")
}finally{
 try{if($p){$p.Refresh();if(!$p.HasExited){Stop-Process -Id $p.Id};$p.WaitForExit(5000)|Out-Null}}
 finally{foreach($key in $saved.Keys){[Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}}
}
