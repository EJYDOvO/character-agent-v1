# Run every required native Host gate against the pinned test Host.
# Isolated Homes, synthetic model/QQ transport; never production data or QQ.
# Exit 0 only when native-gates.cjs reports every gate passed on a verified Host.
param([string]$Summary,[int]$gateTimeoutSeconds=1200)
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
$node=$env:DSH_NODE_EXE;if(!$node){$node=(Get-Command node -ErrorAction Stop).Source}
if(!$Summary){$Summary=Join-Path $project 'test-data/native-gates-summary.json'}
New-Item -ItemType Directory -Force -Path (Split-Path $Summary -Parent) | Out-Null
$raw=@{host=$null;results=@()}
if(!$env:DSH_INSTALL_ROOT -and $env:DSH_CHARACTER_HOST_ROOT){$env:DSH_INSTALL_ROOT=$env:DSH_CHARACTER_HOST_ROOT}
$hostJson=& $node (Join-Path $PSScriptRoot 'verify-host.cjs') 2>&1 | Out-String
try{$raw.host=$hostJson | ConvertFrom-Json}catch{$raw.host=@{ok=$false;reason='Host verification produced no result: '+$hostJson.Trim()}}
if($raw.host.ok){
 foreach($gate in (& $node (Join-Path $PSScriptRoot 'native-gates.cjs') list | ConvertFrom-Json)){
  $started=Get-Date;$code=99;$out=''
  $log=Join-Path (Split-Path $Summary -Parent) ("native-gate-{0}.log" -f $gate.id);$err="$log.stderr"
  # Output goes to files and only the gate process itself is awaited: a
  # descendant that outlives its gate (and inherited a handle) cannot hold the
  # runner, and a hung gate fails after the timeout instead of blocking.
  try{
   $argv=@('-NoProfile','-NonInteractive','-File',('"{0}"' -f (Join-Path $PSScriptRoot $gate.script)))+@($gate.args)
   $p=Start-Process -FilePath (Get-Command pwsh -ErrorAction Stop).Source -ArgumentList $argv -NoNewWindow -PassThru -RedirectStandardOutput $log -RedirectStandardError $err
   $null=$p.Handle # keep the handle so ExitCode stays readable after exit
   if($p.WaitForExit($gateTimeoutSeconds*1000)){$code=$p.ExitCode}else{& taskkill.exe /T /F /PID $p.Id 2>&1 | Out-Null;$code=124}
   $out=((Get-Content -LiteralPath $log -Raw -ErrorAction SilentlyContinue),(Get-Content -LiteralPath $err -Raw -ErrorAction SilentlyContinue)) -join "`n"
   if($code -eq 124){$out+="`nGate timed out after $gateTimeoutSeconds s"}
   Set-Content -LiteralPath $log -Value $out;Remove-Item -LiteralPath $err -ErrorAction SilentlyContinue
  }catch{$out=$_.ToString();Set-Content -LiteralPath $log -Value $out}
  $raw.results+=@{id=$gate.id;exitCode=$code;reported=($code -eq 0 -and $out -match '"ok":\s*true');seconds=[int]((Get-Date)-$started).TotalSeconds}
  Write-Host ("{0}: exit {1}" -f $gate.id,$code)
 }
}
$rawFile="$Summary.raw.json";$raw | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $rawFile
& $node (Join-Path $PSScriptRoot 'native-gates.cjs') summarize $rawFile | Tee-Object -FilePath $Summary
exit $LASTEXITCODE
