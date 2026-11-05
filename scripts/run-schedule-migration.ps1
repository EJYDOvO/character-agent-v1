$ErrorActionPreference='Stop'
# Isolated Schedule v1 -> v2 drill: one synthetic DSH_HOME, rc.3 then rc.1 twice, then rc.3 observes v2.
# DSH_MIGRATION_FROM_ROOT: previous Host (writes v1). DSH_CHARACTER_HOST_ROOT: target Host.
if(!$env:DSH_MIGRATION_FROM_ROOT -or !$env:DSH_CHARACTER_HOST_ROOT){throw 'Set DSH_MIGRATION_FROM_ROOT and DSH_CHARACTER_HOST_ROOT explicitly'}
$project=Split-Path $PSScriptRoot -Parent
$runId=[guid]::NewGuid().ToString();$home2=Join-Path $project ("test-data/migration-$runId");$dir=Join-Path $home2 'profiles/migration'
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
 }
 Write-Output ("MIGRATION_HOME=$home2")
}finally{
 try{if($p){$p.Refresh();if(!$p.HasExited){Stop-Process -Id $p.Id};$p.WaitForExit(5000)|Out-Null}}
 finally{foreach($key in $saved.Keys){[Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}}
}
