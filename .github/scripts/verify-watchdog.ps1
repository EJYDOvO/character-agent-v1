param([string]$QqRoot)
$ErrorActionPreference='Stop'
$script:taskRoot=$QqRoot
$script:taskState=$QqRoot
$script:trace=[Collections.Generic.List[string]]::new()
$script:processes=@()
$scriptBlock=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $QqRoot 'maintenance/manage.ps1'),[ref]$null,[ref]$null)
$wanted=@('Format-SwitchReason','Get-TaskHostPids','Stop-TaskHostProcesses','Test-TaskExistingCharacterServed','Wait-TaskCharacterServed','Restore-TaskCharacter','Invoke-CharacterSwitch')
foreach($function in $scriptBlock.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in $wanted},$false)){
    . ([scriptblock]::Create($function.Extent.Text))
}
function Get-TaskHostProcesses { $script:processes }
function Start-Sleep { }
function Stop-Process {
    param($Id,$ErrorAction)
    $script:trace.Add('stop')
    if (!$script:stuck) { $script:processes=@() }
}
function Start-TaskHost {
    $script:trace.Add('start')
    $script:processes=@([pscustomobject]@{ProcessId=44;CreationDate=(Get-Date)})
    $script:healthy=$true
}
function Test-TaskQQReady { $true }
function Get-TaskStatus { param([switch]$Health) @{reachable=$true} }
function Invoke-SwitchNode([string[]]$SwitchArgs) {
    $script:trace.Add(($SwitchArgs[0]+' '+(($SwitchArgs | Select-Object -Skip 2) -join ' ')).Trim())
    switch ($SwitchArgs[0]) {
        'recover' {
            $script:taskSwitchOutput=ConvertTo-Json @{link=$script:link}
            return 0
        }
        'verify' {
            if ($script:healthy -and $script:link -eq $SwitchArgs[4]) { return 0 }
            return 1
        }
        'revert' {
            if ($script:processes.Count) { throw 'fixture detected a running Host during revert' }
            $script:link='previous'
            return 0
        }
        'finish' { return 0 }
        'pending' { return 3 }
        default { throw "unexpected fixture command $($SwitchArgs[0])" }
    }
}
function Test-Recovery([string]$Link,[bool]$Running,[bool]$Stuck,[string]$Expected) {
    $script:trace.Clear()
    $script:taskResult=@{}
    $script:link=$Link
    $script:stuck=$Stuck
    $script:healthy=$Running
    $script:processes=if($Running){@([pscustomobject]@{ProcessId=42;CreationDate=(Get-Date)})}else{@()}
    try { Invoke-CharacterSwitch } catch { if(!$Stuck){throw} }
    $summary=($script:trace | ForEach-Object { ($_ -split ' ')[0] }) -join ','
    if ($summary -ne $Expected) { throw "Unexpected order for $Link. Expected $Expected, got $summary" }
    $lastFinish=$script:trace | Where-Object {$_ -like 'finish*'} | Select-Object -Last 1
    $expectedOutcome=if($Stuck){'retry'}else{'fail'}
    if ($lastFinish -notlike "finish $expectedOutcome*") { throw "Unexpected outcome for $Link. Got $lastFinish" }
    "PASS $Link running=$Running stuck=$Stuck $summary"
}
Test-Recovery 'missing' $false $false 'recover,revert,start,verify,finish,pending'
Test-Recovery 'target' $true $false 'recover,stop,revert,start,verify,finish,pending'
Test-Recovery 'previous' $true $false 'recover,verify,finish,pending'
Test-Recovery 'target' $true $true 'recover,stop,finish'
