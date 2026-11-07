# Run every required native Host gate against the pinned test Host.
# Isolated Homes, synthetic model/QQ transport; never production data or QQ.
# Exit 0 only when native-gates.cjs reports every gate passed on a verified Host.
param([string]$Summary)
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
  try{$out=& pwsh -NoProfile -NonInteractive -File (Join-Path $PSScriptRoot $gate.script) @($gate.args) 2>&1 | Out-String;$code=$LASTEXITCODE}catch{$out=$_.ToString()}
  $log=Join-Path (Split-Path $Summary -Parent) ("native-gate-{0}.log" -f $gate.id);Set-Content -LiteralPath $log -Value $out
  $raw.results+=@{id=$gate.id;exitCode=$code;reported=($code -eq 0 -and $out -match '"ok":\s*true');seconds=[int]((Get-Date)-$started).TotalSeconds}
  Write-Host ("{0}: exit {1}" -f $gate.id,$code)
 }
}
$rawFile="$Summary.raw.json";$raw | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $rawFile
& $node (Join-Path $PSScriptRoot 'native-gates.cjs') summarize $rawFile | Tee-Object -FilePath $Summary
exit $LASTEXITCODE
