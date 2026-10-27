$ErrorActionPreference='Stop'
$runtime=$env:DSH_CHARACTER_HOST_ROOT;if(!$runtime){$runtime=$env:DSH_INSTALL_ROOT}
if(!$env:DSH_INSTALL_ROOT -or !$env:DSH_CHARACTER_PROJECT){throw 'Explicit install/project roots required'}
$project=$env:DSH_CHARACTER_PROJECT
foreach($kind in @('core','tools')) {
 foreach($file in Get-ChildItem -LiteralPath (Join-Path $project "packages/character-memory-$kind") -Filter '*.mjs') {
  $target=Join-Path $project "test-data/layered-home/profiles/layered-memory/node_modules/dsh-character-memory-$kind/$($file.Name)"
  if(!(Test-Path -LiteralPath $target)){Copy-Item -LiteralPath $file.FullName -Destination $target}
  if((Get-FileHash -LiteralPath $target).Hash -ne (Get-FileHash -LiteralPath $file.FullName).Hash){throw 'Isolated Memory dependency differs from source; restage it'}
 }
}
$env:DSH_HOME=Join-Path $project 'test-data/layered-home'
$env:ELECTRON_RUN_AS_NODE='1'
$run=Get-Content -Raw (Join-Path $env:DSH_HOME 'run.json') | ConvertFrom-Json
$result=Join-Path $project "artifacts/layered-host-$($run.mode).json"
if(Test-Path -LiteralPath $result){Remove-Item -LiteralPath $result}
$exe=Join-Path $runtime 'DeepSeek Harness.exe'
$p=Start-Process -FilePath $exe -ArgumentList @('--expose-internals',('"{0}"' -f (Join-Path $runtime 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')),'--profile','layered-memory','--no-open','--port','0') -WorkingDirectory $project -WindowStyle Hidden -PassThru -RedirectStandardOutput "$project/artifacts/layered-$($run.mode).stdout.log" -RedirectStandardError "$project/artifacts/layered-$($run.mode).stderr.log"
Write-Output "Isolated layered probe PID=$($p.Id) run=$($run.runId)"
