param([string]$Destination = 'test-results/panning-source')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$target = [IO.Path]::GetFullPath((Join-Path $projectRoot $Destination))
$results = [IO.Path]::GetFullPath((Join-Path $projectRoot 'test-results')) + [IO.Path]::DirectorySeparatorChar
if (-not $target.StartsWith($results, [StringComparison]::OrdinalIgnoreCase)) { throw 'Use a disposable destination under test-results.' }
$python = (& python -c 'import sys;print(sys.executable)').Trim()
if ($LASTEXITCODE -ne 0) { throw 'Python is required for the read-only SQLite backup.' }
$windowlessPython = Join-Path (Split-Path -Parent $python) 'pythonw.exe'
if (Test-Path -LiteralPath $windowlessPython) { $python = $windowlessPython }
$script = Join-Path $projectRoot 'tests/native/snapshot-panning-workspace.py'
$taskName = 'Knot-PanningSnapshot-' + [guid]::NewGuid().ToString('N')
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$action = New-ScheduledTaskAction -Execute $python -Argument ('"{0}" "{1}"' -f $script, $target)
Register-ScheduledTask -TaskName $taskName -Principal $principal -Action $action | Out-Null
try {
    Start-ScheduledTask -TaskName $taskName
    $deadline = (Get-Date).AddMinutes(2)
    do {
        Start-Sleep -Milliseconds 500
        $info = Get-ScheduledTaskInfo -TaskName $taskName
        $task = Get-ScheduledTask -TaskName $taskName
    } while (($task.State -in 'Running','Queued' -or $info.LastRunTime.Year -lt 2000) -and (Get-Date) -lt $deadline)
    if ($info.LastTaskResult -ne 0 -or $task.State -ne 'Ready') { throw "Desktop snapshot failed: $($info.LastTaskResult)" }
    Write-Output "Consistent desktop snapshot saved locally to $target"
} finally {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
