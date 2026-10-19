# Installs the agent on the bridge PC as a scheduled task that starts at boot,
# runs whether or not anyone is logged in, and restarts if it dies.
# Run in an elevated PowerShell from the agent directory:
#   powershell -ExecutionPolicy Bypass -File .\deploy\install-windows.ps1

$ErrorActionPreference = 'Stop'
$TaskName = 'SOF Alert Agent'
$AgentDir = Split-Path -Parent $PSScriptRoot
$Config = Join-Path $AgentDir 'config.json'
$LogFile = Join-Path $AgentDir 'agent.log'

if (-not (Test-Path $Config)) {
    throw "Missing $Config - copy config.bridge.example.json to config.json and fill it in."
}

$Node = (Get-Command node -ErrorAction Stop).Source
$Entry = Join-Path $AgentDir 'src\index.js'

# cmd wrapper so stdout/stderr land in agent.log
$Action = New-ScheduledTaskAction -Execute 'cmd.exe' `
    -Argument "/c `"`"$Node`" `"$Entry`" `"$Config`" >> `"$LogFile`" 2>&1`"" `
    -WorkingDirectory $AgentDir
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$Principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger `
    -Settings $Settings -Principal $Principal | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Installed and started '$TaskName'. Log: $LogFile"
Write-Host "Uninstall: Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
