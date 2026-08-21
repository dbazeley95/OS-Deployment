# Single generalized first-logon script, referenced identically from every
# profile's autounattend.xml FirstLogonCommands (see
# boot/profiles/windows-11-25h2-*/autounattend.xml). Deploy.ps1 (WinPE side)
# already wrote C:\Windows\Setup\Scripts\post-action.json describing what
# the technician chose - this script always phones home, then branches on
# that choice. The technician already decided *whether* to domain-join
# during WinPE, so unlike the old always-run domain-join.ps1, this doesn't
# ask again - it goes straight to the details.

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

switch ($config.action) {
    "domain-join" {
        Add-Type -AssemblyName Microsoft.VisualBasic
        $domain = [Microsoft.VisualBasic.Interaction]::InputBox(
            "Domain name (e.g. corp.example.com)", "Domain Join", ""
        )
        if ([string]::IsNullOrWhiteSpace($domain)) {
            Write-Host "No domain entered - skipping domain join."
            break
        }
        $cred = Get-Credential -Message "Enter credentials authorized to join $domain"
        try {
            Add-Computer -DomainName $domain -Credential $cred -Force -Restart
        } catch {
            [Microsoft.VisualBasic.Interaction]::MsgBox(
                "Domain join failed: $($_.Exception.Message)", "OKOnly,SystemModal", "Domain Join"
            )
        }
    }
    "install-app" {
        if (-not $config.appUrl) {
            Write-Host "install-app chosen but no appUrl was provided - skipping."
            break
        }
        $ext = [System.IO.Path]::GetExtension($config.appUrl).TrimStart(".").ToLower()
        $dest = Join-Path $env:TEMP ("app." + $ext)
        Invoke-WebRequest -Uri $config.appUrl -OutFile $dest
        switch ($ext) {
            "msi" { Start-Process msiexec.exe -ArgumentList "/i `"$dest`" /quiet /norestart" -Wait }
            "exe" { Start-Process $dest -ArgumentList "/quiet /norestart" -Wait }
            "ps1" { powershell.exe -NoProfile -ExecutionPolicy Bypass -File $dest }
            default { Write-Host "Unknown app type '$ext' - not run automatically." }
        }
    }
    "autopilot" {
        Write-Host "Autopilot path - leaving OOBE/enrollment to Intune, nothing further to do here."
    }
    default {
        Write-Host "Unknown post-action '$($config.action)' - nothing done."
    }
}
