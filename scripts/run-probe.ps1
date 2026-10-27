if (!$env:DSH_INSTALL_ROOT -or !$env:DSH_CHARACTER_PROJECT) { throw 'Set DSH_INSTALL_ROOT and DSH_CHARACTER_PROJECT explicitly before running integration scripts.' }
$runtime=$env:DSH_CHARACTER_HOST_ROOT;if(!$runtime){$runtime=$env:DSH_INSTALL_ROOT}
$ErrorActionPreference='Stop'
$project=$env:DSH_CHARACTER_PROJECT
foreach($kind in @('identity','memory-core','memory-tools','qq-adapter')) {
 $target=Join-Path $project "test-data\home\profiles\character-test\node_modules\dsh-character-$kind"
 foreach($file in Get-ChildItem -LiteralPath (Join-Path $project "packages\character-$kind") -Filter '*.mjs') {
  $destination=Join-Path $target $file.Name
  if(!(Test-Path -LiteralPath $destination)){Copy-Item -LiteralPath $file.FullName -Destination $destination}
  if((Get-FileHash -LiteralPath $destination).Hash -ne (Get-FileHash -LiteralPath $file.FullName).Hash){throw 'Isolated dependency does not match source; reinstall stage'}
 }
}
$exe=Join-Path $runtime "DeepSeek Harness.exe"
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $exe -and $_.CommandLine -match '--profile character-test' } | ForEach-Object { Stop-Process -Id $_.ProcessId }
$env:DSH_HOME="$project\test-data\home"
$env:ELECTRON_RUN_AS_NODE='1'
$p=Start-Process -FilePath $exe -ArgumentList @('--expose-internals',('"{0}"' -f (Join-Path $runtime 'resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js')),'--profile','character-test','--patch',"$project\test-data\probe.patch.yml",'--no-open','--port','0') -WorkingDirectory $project -WindowStyle Hidden -PassThru -RedirectStandardOutput "$project\artifacts\probe.stdout.log" -RedirectStandardError "$project\artifacts\probe.stderr.log"
Write-Output "Isolated probe PID=$($p.Id)"
