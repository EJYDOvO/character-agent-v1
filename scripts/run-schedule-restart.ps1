$ErrorActionPreference='Stop'
if(!$env:DSH_INSTALL_ROOT){throw 'Set DSH_INSTALL_ROOT explicitly'}
$project=Split-Path $PSScriptRoot -Parent
$node=Join-Path $env:DSH_INSTALL_ROOT 'resources/runtime/primary-runtime/dependencies/node/bin/node.exe'
$saved=@{};foreach($key in @('DSH_HOME','ELECTRON_RUN_AS_NODE','TEMP','TMP')){$saved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
$p=$null
try {
 & $node (Join-Path $PSScriptRoot 'stage-inspector.cjs')
 if($LASTEXITCODE -ne 0){throw 'Staging failed'}
 $run=Get-Content -LiteralPath (Join-Path $project 'test-data/inspector-run.json') -Raw | ConvertFrom-Json
 $patch=Join-Path $run.home 'profiles/inspector/cordis.patch.yml'
 [IO.File]::WriteAllText($patch,[IO.File]::ReadAllText($patch).Replace('/tests/inspector-host.mjs','/tests/schedule-restart-host.mjs'))
 $env:DSH_HOME=$run.home;$env:ELECTRON_RUN_AS_NODE='1';$env:TEMP=Join-Path $run.home 'tmp';$env:TMP=$env:TEMP
 New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
 for($phase=0;$phase -lt 2;$phase++){
  if(Test-Path -LiteralPath $run.result){Move-Item -LiteralPath $run.result -Destination (Join-Path $run.home 'phase1.json')}
  $exe=Join-Path $env:DSH_INSTALL_ROOT 'DeepSeek Harness.exe'
  $cli=Join-Path $env:DSH_INSTALL_ROOT 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'
  $resolver=([Uri](Join-Path $project 'tests/inspector-sdk-resolver.mjs')).AbsoluteUri
  $p=Start-Process -FilePath $exe -ArgumentList @('--expose-internals','--import',$resolver,$cli,'--profile','inspector','--no-open','--port','0') -WorkingDirectory $run.home -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run.home "phase-$phase.stdout.log") -RedirectStandardError (Join-Path $run.home "phase-$phase.stderr.log")
  $deadline=(Get-Date).AddSeconds(40)
  while(!(Test-Path -LiteralPath $run.result) -and (Get-Date) -lt $deadline -and !$p.HasExited){Start-Sleep -Milliseconds 250;$p.Refresh()}
  if(!(Test-Path -LiteralPath $run.result)){throw 'Native restart probe failed to report'}
  $report=Get-Content -LiteralPath $run.result -Raw | ConvertFrom-Json
  $report | ConvertTo-Json -Depth 8
  if(!$report.ok -or $report.runId -ne $run.runId -or $report.restart -ne [bool]$phase){throw 'Restart gate failed or stale result'}
  $p.Refresh();if(!$p.HasExited){Stop-Process -Id $p.Id};if(!$p.WaitForExit(5000)){throw 'Test Host did not stop'};$p=$null
 }
}finally{
 try{if($p){$p.Refresh();if(!$p.HasExited){Stop-Process -Id $p.Id};$p.WaitForExit(5000)|Out-Null}}
 finally{foreach($key in $saved.Keys){[Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}}
}
