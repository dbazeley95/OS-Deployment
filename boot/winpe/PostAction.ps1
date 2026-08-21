# Single generalized first-logon script, referenced identically from every
# profile's autounattend.xml FirstLogonCommands (see
# boot/profiles/windows-11-25h2-*/autounattend.xml). DeployGui.ps1 (WinPE
# side) already wrote C:\Windows\Setup\Scripts\post-action.json describing
# everything the technician decided in the wizard - hostname was already
# applied to the answer file, and domain-join credentials were already
# collected there too, so this script joins non-interactively (no prompt)
# and then runs the task sequence's steps in order - each either an app
# install or a fixed built-in action (Windows Update, disabling WinRE, etc).

$WorkerBase = "https://api.osd.xcet.uk"
$configPath = "C:\Windows\Setup\Scripts\post-action.json"

# --- Phone home ---
$mac = (Get-NetAdapter | Where-Object Status -eq "Up" | Select-Object -First 1 -ExpandProperty MacAddress).ToLower().Replace("-", ":")
try {
    Invoke-RestMethod -Method Patch -Uri "$WorkerBase/api/jobs/by-mac/$mac" `
        -ContentType "application/json" -Body '{"status":"complete"}'
} catch {
    Write-Host "Phone-home failed: $($_.Exception.Message)"
}

if (-not (Test-Path $configPath)) {
    Write-Host "No post-action config found - nothing further to do."
    exit 0
}
$config = Get-Content $configPath | ConvertFrom-Json

if ($config.domainJoin -and $config.domainUsername -and $config.domainPassword) {
    $domain = $config.domain
    $username = $config.domainUsername
    $securePassword = ConvertTo-SecureString $config.domainPassword -AsPlainText -Force
    $cred = New-Object System.Management.Automation.PSCredential($username, $securePassword)

    # Scrub the credential from disk before attempting the join - whether
    # it succeeds or fails, there's no retry path here, so there's no
    # reason for the plaintext password to linger any longer than this.
    $config.domainUsername = $null
    $config.domainPassword = $null
    $config | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath

    try {
        Add-Computer -DomainName $domain -Credential $cred -Force -Restart
    } catch {
        Add-Type -AssemblyName Microsoft.VisualBasic
        [Microsoft.VisualBasic.Interaction]::MsgBox(
            "Domain join failed: $($_.Exception.Message)", "OKOnly,SystemModal", "Domain Join"
        )
    }
}

# Built-in actions need no download - they're fixed code, not a
# technician-uploaded file (see worker/src/lib/builtinActions.ts, the
# source of truth for these ids).
function Invoke-BuiltinAction([string]$ActionId) {
    switch ($ActionId) {
        "windows-update" {
            $session = New-Object -ComObject Microsoft.Update.Session
            $searcher = $session.CreateUpdateSearcher()
            $result = $searcher.Search("IsInstalled=0 and Type='Software'")
            if ($result.Updates.Count -eq 0) {
                Write-Host "No updates found."
                return
            }
            $toInstall = New-Object -ComObject Microsoft.Update.UpdateColl
            foreach ($update in $result.Updates) {
                if (-not $update.EulaAccepted) { $update.AcceptEula() | Out-Null }
                $toInstall.Add($update) | Out-Null
            }
            $downloader = $session.CreateUpdateDownloader()
            $downloader.Updates = $toInstall
            $downloader.Download() | Out-Null
            $installer = $session.CreateUpdateInstaller()
            $installer.Updates = $toInstall
            $installResult = $installer.Install()
            Write-Host "Windows Update install result code: $($installResult.ResultCode)"
        }
        "disable-winre" {
            reagentc /disable
        }
        default {
            Write-Host "Unknown built-in action '$ActionId' - not run automatically."
        }
    }
}

foreach ($step in $config.steps) {
    if ($step.kind -eq "builtin") {
        Write-Host "Running built-in action: $($step.label)..."
        Invoke-BuiltinAction -ActionId $step.actionId
        continue
    }

    if (-not $step.appUrl) { continue }
    Write-Host "Installing $($step.label)..."
    $ext = switch ($step.installKind) { "msi" { "msi" } "script" { "ps1" } default { "exe" } }
    $dest = Join-Path $env:TEMP ("step-" + [guid]::NewGuid().ToString("N") + "." + $ext)
    Invoke-WebRequest -Uri $step.appUrl -OutFile $dest
    switch ($step.installKind) {
        "msi" { Start-Process msiexec.exe -ArgumentList "/i `"$dest`" /quiet /norestart" -Wait }
        "exe" { Start-Process $dest -ArgumentList "/quiet /norestart" -Wait }
        "script" { powershell.exe -NoProfile -ExecutionPolicy Bypass -File $dest }
        default { Write-Host "Unknown install kind '$($step.installKind)' for $($step.label) - not run automatically." }
    }
}
