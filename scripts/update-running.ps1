param([switch]$SkipBuild, [switch]$DesktopInstall, [string]$LogPath)
$ErrorActionPreference = 'Stop'
function Get-KnotHash([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return [System.BitConverter]::ToString($sha.ComputeHash($stream)) }
    finally { $stream.Dispose(); $sha.Dispose() }
}
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
$transcribing = $false
if ($DesktopInstall -and $LogPath) {
    Start-Transcript -LiteralPath $LogPath -Force | Out-Null
    $transcribing = $true
}
try {
    if (-not $SkipBuild) {
        & pnpm tauri build
        if ($LASTEXITCODE -ne 0) { throw 'Knot build failed; installed app was not changed.' }
    }
    # A process launched by packaged Codex can see redirected LocalAppData.
    # Perform both replacement and launch under the interactive desktop token.
    if (-not $DesktopInstall) {
        $taskName = 'Knot-DesktopUpdate-' + [guid]::NewGuid().ToString('N')
        $logDirectory = Join-Path $projectRoot 'test-results'
        New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
        $desktopLog = Join-Path $logDirectory ($taskName + '.log')
        $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
        $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -SkipBuild -DesktopInstall -LogPath "{1}"' -f $PSCommandPath, $desktopLog)
        Register-ScheduledTask -TaskName $taskName -Principal $principal -Action $action -ErrorAction Stop | Out-Null
        try {
            Start-ScheduledTask -TaskName $taskName
            $deadline = (Get-Date).AddMinutes(3)
            do {
                Start-Sleep -Milliseconds 500
                $info = Get-ScheduledTaskInfo -TaskName $taskName
                $task = Get-ScheduledTask -TaskName $taskName
            } while (($task.State -in 'Running','Queued' -or $info.LastTaskResult -eq 267009 -or $info.LastRunTime.Year -lt 2000) -and (Get-Date) -lt $deadline)
            if ($info.LastTaskResult -ne 0 -or $task.State -ne 'Ready' -or $info.LastRunTime.Year -lt 2000) {
                if (Test-Path -LiteralPath $desktopLog) {
                    Get-Content -LiteralPath $desktopLog -Tail 30 | Write-Output
                }
                throw "Desktop update failed or timed out (task result $($info.LastTaskResult)). Details: $desktopLog"
            }
            Write-Output 'Desktop installation verified and Knot relaunched.'
        } finally {
            Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        }
        return
    }
    $source = Join-Path $projectRoot 'src-tauri/target/release/knot.exe'
    $installed = Join-Path $env:LOCALAPPDATA 'Knot/knot.exe'
    if (-not (Test-Path -LiteralPath $source)) { throw 'Release executable is missing.' }
    if (-not (Test-Path -LiteralPath $installed)) { throw 'Install Knot before using this update command.' }
    $running = @(Get-Process -Name knot -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $installed })
    foreach ($app in $running) {
        # Normal close invokes Knot's pending-save flush. Never force termination.
        if (-not $app.CloseMainWindow()) { throw 'Could not request a normal close of Knot.' }
        if (-not $app.WaitForExit(30000)) { throw 'Knot stayed open. Resolve pending operations or save errors and retry.' }
    }
    Copy-Item -LiteralPath $installed -Destination "$installed.previous" -Force
    Copy-Item -LiteralPath $source -Destination $installed -Force
    if ((Get-KnotHash $source) -ne (Get-KnotHash $installed)) {
        throw 'Installed executable did not match the new build.'
    }
    # A new icon filename avoids Windows reusing the previous identity's cache.
    $iconSource = Join-Path $projectRoot 'src-tauri/icons/icon.ico'
    $installedIcon = Join-Path (Split-Path -Parent $installed) 'knot-linked-k.ico'
    if (Test-Path -LiteralPath $iconSource) {
        Copy-Item -LiteralPath $iconSource -Destination $installedIcon -Force
        $shortcutShell = New-Object -ComObject WScript.Shell
        $shortcutRoots = @(
            [Environment]::GetFolderPath('Desktop'),
            (Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs'),
            (Join-Path $env:APPDATA 'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar')
        )
        foreach ($shortcutRoot in $shortcutRoots) {
            if (-not (Test-Path -LiteralPath $shortcutRoot)) { continue }
            Get-ChildItem -LiteralPath $shortcutRoot -Filter '*Knot*.lnk' -Recurse | ForEach-Object {
                $shortcut = $shortcutShell.CreateShortcut($_.FullName)
                if ($shortcut.TargetPath -eq $installed) {
                    $shortcut.IconLocation = "$installedIcon,0"
                    $shortcut.Save()
                }
            }
        }
        $refreshIcons = Join-Path $env:WINDIR 'System32/ie4uinit.exe'
        if (Test-Path -LiteralPath $refreshIcons) { & $refreshIcons -show }
    }
    # Bypass shortcut/ShellExecute handshakes, which can remain blocked even
    # after Knot opens. Create the interactive app process directly, without
    # waiting for it to exit, then independently verify the running build.
    $launchInfo = New-Object System.Diagnostics.ProcessStartInfo
    $launchInfo.FileName = $installed
    $launchInfo.WorkingDirectory = Split-Path -Parent $installed
    $launchInfo.UseShellExecute = $false
    [System.Diagnostics.Process]::Start($launchInfo) | Out-Null
    Start-Sleep -Seconds 3
    if (-not (Get-Process -Name knot -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $installed })) { throw 'Desktop Knot did not relaunch.' }
    Write-Output 'Installed Knot matches the release build and has been launched.'
} catch {
    if ($transcribing) { Write-Output ('Desktop update error: ' + $_.Exception.Message) }
    throw
} finally {
    if ($transcribing) { Stop-Transcript | Out-Null }
    Pop-Location
}
