if (!$env:DSH_INSTALL_ROOT -or !$env:DSH_CHARACTER_PROJECT) { throw 'Set DSH_INSTALL_ROOT and DSH_CHARACTER_PROJECT explicitly before running integration scripts.' }
$ErrorActionPreference='Stop'
$root=$env:DSH_INSTALL_ROOT;$project=$env:DSH_CHARACTER_PROJECT;$runtime=$env:DSH_CHARACTER_HOST_ROOT;if(!$runtime){$runtime=$root}
$exe=Join-Path $runtime 'DeepSeek Harness.exe'
$lock=[IO.File]::Open("$root\data\maintenance\maintenance.lock",[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try {
 $record=Get-Content "$root\data\maintenance\character-deploy\candidate.json" -Raw | ConvertFrom-Json
 foreach($file in @('package.json','cordis.patch.yml','pnpm-lock.yaml','pnpm-workspace.yaml')){
  if((Get-FileHash -LiteralPath (Join-Path $record.previousProfile $file)).Hash.ToLowerInvariant() -ne $record.baseline.$file){throw 'Previous profile integrity mismatch'}
 }
 if((Get-FileHash -LiteralPath "$root\data\maintenance\character-deploy\prefs-before.json").Hash.ToLowerInvariant() -ne $record.baseline.prefs){throw 'Previous QQ preferences integrity mismatch'}
 $processes=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $exe})
 if($processes.Count){$status=(& node "$root\maintenance\ops.cjs" status | ConvertFrom-Json);if($LASTEXITCODE -ne 0 -or !$status.idle){throw 'Host not confirmed idle; rollback refused'}}
 foreach($p in $processes){Stop-Process -Id $p.ProcessId -ErrorAction SilentlyContinue}
 Start-Sleep -Milliseconds 700
 if(@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $exe}).Count){throw 'Host still running'}
 & node "$project\scripts\rollback.cjs"
 if($LASTEXITCODE -ne 0){throw 'Rollback failed'}
 $env:DSH_HOME="$root\data";$env:TEMP="$root\tmp";$env:TMP="$root\tmp";Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
 $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
 Start-Process -FilePath $exe -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput "$root\tmp\desktop-rollback-$stamp.stdout.log" -RedirectStandardError "$root\tmp\desktop-rollback-$stamp.stderr.log"
 Write-Output 'Previous profile restored and started. Verify health and QQ ready; this message does not confirm online status.'
} finally {$lock.Dispose()}
