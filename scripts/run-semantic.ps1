$ErrorActionPreference='Stop'
# Native Host gate for semantic recall (D1) in the Character combination. One Host process per phase
# (active by default, shadow with a corrupted sidecar, off, unavailable model), isolated Home, synthetic
# memories, deterministic chat model, real embedding worker. Requires a provisioned runtime and model:
#   $env:DSH_SEMANTIC_RUNTIME_DIR, $env:DSH_SEMANTIC_MODEL_DIR
$runtime=$env:DSH_CHARACTER_HOST_ROOT;if(!$runtime){$runtime=$env:DSH_INSTALL_ROOT}
if(!$env:DSH_INSTALL_ROOT){throw 'Set DSH_INSTALL_ROOT explicitly'}
$project=Split-Path $PSScriptRoot -Parent
$node=$env:DSH_NODE_EXE;if(!$node){$node=(Get-Command node -ErrorAction Stop).Source}
$saved=@{};foreach($key in @('DSH_HOME','ELECTRON_RUN_AS_NODE','TEMP','TMP')){$saved[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
$p=$null;$reports=@()
try{
 & $node (Join-Path $PSScriptRoot 'stage-semantic.cjs') @args;if($LASTEXITCODE -ne 0){throw 'Semantic staging failed'}
 $run=Get-Content -LiteralPath (Join-Path $project 'test-data/semantic-run.json') -Raw|ConvertFrom-Json
 $env:DSH_HOME=$run.home;$env:ELECTRON_RUN_AS_NODE='1';$env:TEMP=Join-Path $run.home 'tmp';$env:TMP=$env:TEMP
 $exe=Join-Path $runtime 'DeepSeek Harness.exe'
 $cli=Join-Path $runtime 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'
 $resolver=([Uri](Join-Path $project 'tests/inspector-sdk-resolver.mjs')).AbsoluteUri
 foreach($phase in $run.phases){
  Copy-Item -LiteralPath (Join-Path $run.dir "cordis.patch.$phase.yml") -Destination (Join-Path $run.dir 'cordis.patch.yml') -Force
  if($phase -eq 'shadow'){
   # A damaged sidecar: the plugin must rebuild it, never fail the Host or touch memory.sqlite.
   foreach($suffix in @('-wal','-shm')){Remove-Item -LiteralPath ($run.indexFile+$suffix) -ErrorAction SilentlyContinue}
   # SQLite header, garbage pages: a file without the header is refused, not replaced.
   $damaged=[byte[]](,0x5a*16384);[Text.Encoding]::ASCII.GetBytes("SQLite format 3`0").CopyTo($damaged,0)
   [IO.File]::WriteAllBytes($run.indexFile,$damaged)
  }
  $result=Join-Path $run.home "result-$phase.json"
  $p=Start-Process -FilePath $exe -ArgumentList @('--expose-internals','--import',$resolver,('"{0}"' -f $cli),'--profile','semantic','--no-open','--port','0') -WorkingDirectory $run.home -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run.home "stdout-$phase.log") -RedirectStandardError (Join-Path $run.home "stderr-$phase.log")
  $deadline=(Get-Date).AddSeconds(420)
  while(!(Test-Path -LiteralPath $result) -and (Get-Date) -lt $deadline -and !$p.HasExited){Start-Sleep -Milliseconds 250;$p.Refresh();$diagnostic=Get-Content -LiteralPath (Join-Path $run.home "stderr-$phase.log") -Raw -ErrorAction SilentlyContinue;if($diagnostic -match 'dsh: warning: \d+ entr'){throw "Phase $phase has inactive Profile entries; inspect the isolated stderr log"}}
  if(!(Test-Path -LiteralPath $result)){throw "Semantic probe phase $phase timed out or failed to load; inspect the isolated stderr log"}
  $report=Get-Content -LiteralPath $result -Raw|ConvertFrom-Json
  if($report.runId -ne $run.runId -or $report.phase -ne $phase){throw "Stale result for phase $phase"}
  $report|ConvertTo-Json -Depth 12
  $reports+=$report
  $p.Refresh();if(!$p.HasExited){& taskkill.exe /T /F /PID $p.Id 2>&1|Out-Null};$p.WaitForExit(5000)|Out-Null;$p=$null
  if(!$report.ok){throw "Semantic recall Host assertions failed in phase $phase"}
 }
 'SEMANTIC GATE PASSED: '+(($reports|ForEach-Object{$_.phase}) -join ', ')
}finally{
 try{if($p){$p.Refresh();if(!$p.HasExited){& taskkill.exe /T /F /PID $p.Id 2>&1|Out-Null};$p.WaitForExit(5000)|Out-Null}}
 finally{foreach($key in $saved.Keys){[Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}}
}
