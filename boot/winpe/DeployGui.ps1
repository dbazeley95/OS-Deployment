# Windows Forms GUI for the WinPE deployment image - replaces both MDT's
# Lite Touch wizard and this repo's earlier console-prompt script
# (Deploy.ps1, retired). Talks to the same os-deployment Worker API
# (/api/deploy/*) as before; only the front end changed.
#
# Not baked into the WinPE image - startnet.cmd downloads this file fresh
# from the Worker on every boot (see README.md in this directory), so
# GUI/logic changes here go live on the next boot with no image rebuild.
#
# Requires the WinPE-NetFx/WinPE-PowerShell/WinPE-Scripting/WinPE-WMI
# optional components (see README.md) for System.Windows.Forms to be
# available inside WinPE.
#
# This is a starting point, not a complete unattended tool - it assumes a
# single target disk (disk 0) and wipes it entirely. Adjust the diskpart
# script below for dual-disk machines, existing data-preservation needs,
# etc. before relying on it against real hardware.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Set this to your Worker's URL if it ever differs from the deployed one.
$WorkerBase = "https://api.osd.xcet.uk"

function Get-MacAddress {
    (Get-NetAdapter | Where-Object Status -eq "Up" | Select-Object -First 1 -ExpandProperty MacAddress).ToLower().Replace("-", ":")
}

function Invoke-DeployApi {
    param([string]$Path, [hashtable]$Body)
    Invoke-RestMethod -Method Post -Uri "$WorkerBase$Path" -ContentType "application/json" -Body ($Body | ConvertTo-Json)
}

function Show-ErrorBox {
    param([string]$Message)
    [System.Windows.Forms.MessageBox]::Show($Message, "OS Deployment", "OK", "Error") | Out-Null
}

# --- Step 1: technician login -------------------------------------------

function Show-LoginForm {
    param([string]$Mac)

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "OS Deployment - Sign in"
    $form.Size = New-Object System.Drawing.Size(380, 220)
    $form.StartPosition = "CenterScreen"
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false

    $labelMac = New-Object System.Windows.Forms.Label
    $labelMac.Text = "Device MAC: $Mac"
    $labelMac.Location = New-Object System.Drawing.Point(20, 15)
    $labelMac.AutoSize = $true
    $form.Controls.Add($labelMac)

    $labelUser = New-Object System.Windows.Forms.Label
    $labelUser.Text = "Username"
    $labelUser.Location = New-Object System.Drawing.Point(20, 50)
    $labelUser.AutoSize = $true
    $form.Controls.Add($labelUser)

    $textUser = New-Object System.Windows.Forms.TextBox
    $textUser.Location = New-Object System.Drawing.Point(130, 47)
    $textUser.Width = 210
    $form.Controls.Add($textUser)

    $labelPass = New-Object System.Windows.Forms.Label
    $labelPass.Text = "Password"
    $labelPass.Location = New-Object System.Drawing.Point(20, 85)
    $labelPass.AutoSize = $true
    $form.Controls.Add($labelPass)

    $textPass = New-Object System.Windows.Forms.TextBox
    $textPass.Location = New-Object System.Drawing.Point(130, 82)
    $textPass.Width = 210
    $textPass.UseSystemPasswordChar = $true
    $form.Controls.Add($textPass)

    $btnOk = New-Object System.Windows.Forms.Button
    $btnOk.Text = "Connect"
    $btnOk.Location = New-Object System.Drawing.Point(130, 125)
    $btnOk.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.AcceptButton = $btnOk
    $form.Controls.Add($btnOk)

    $result = $form.ShowDialog()
    if ($result -ne [System.Windows.Forms.DialogResult]::OK -or -not $textUser.Text) {
        return $null
    }
    return @{ Username = $textUser.Text; Password = $textPass.Text }
}

# --- Step 2: profile / post-action / app selection -----------------------
# Shown only for whatever the /auth response didn't already pre-stage.

function Show-SelectionForm {
    param($AuthResponse)

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "OS Deployment - Options"
    $form.Size = New-Object System.Drawing.Size(420, 320)
    $form.StartPosition = "CenterScreen"
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false

    $y = 15
    $comboProfile = $null
    if ($AuthResponse.status -eq "choose") {
        $labelProfile = New-Object System.Windows.Forms.Label
        $labelProfile.Text = "OS profile"
        $labelProfile.Location = New-Object System.Drawing.Point(20, $y)
        $labelProfile.AutoSize = $true
        $form.Controls.Add($labelProfile)

        $comboProfile = New-Object System.Windows.Forms.ComboBox
        $comboProfile.Location = New-Object System.Drawing.Point(150, ($y - 3))
        $comboProfile.Width = 220
        $comboProfile.DropDownStyle = "DropDownList"
        foreach ($p in $AuthResponse.profiles) {
            [void]$comboProfile.Items.Add($p.label)
        }
        if ($comboProfile.Items.Count -gt 0) { $comboProfile.SelectedIndex = 0 }
        $form.Controls.Add($comboProfile)
        $y += 40
    } else {
        $labelProfile = New-Object System.Windows.Forms.Label
        $labelProfile.Text = "Profile already assigned: $($AuthResponse.profile)"
        $labelProfile.Location = New-Object System.Drawing.Point(20, $y)
        $labelProfile.AutoSize = $true
        $form.Controls.Add($labelProfile)
        $y += 30
    }

    $labelAction = New-Object System.Windows.Forms.Label
    $labelAction.Text = "After Windows installs:"
    $labelAction.Location = New-Object System.Drawing.Point(20, $y)
    $labelAction.AutoSize = $true
    $form.Controls.Add($labelAction)
    $y += 25

    $radioDomain = New-Object System.Windows.Forms.RadioButton
    $radioDomain.Text = "Domain join"
    $radioDomain.Location = New-Object System.Drawing.Point(35, $y)
    $radioDomain.AutoSize = $true
    $radioDomain.Checked = $true
    $form.Controls.Add($radioDomain)
    $y += 28

    $radioApp = New-Object System.Windows.Forms.RadioButton
    $radioApp.Text = "Install an app"
    $radioApp.Location = New-Object System.Drawing.Point(35, $y)
    $radioApp.AutoSize = $true
    $form.Controls.Add($radioApp)

    $comboApp = New-Object System.Windows.Forms.ComboBox
    $comboApp.Location = New-Object System.Drawing.Point(180, ($y - 3))
    $comboApp.Width = 190
    $comboApp.DropDownStyle = "DropDownList"
    $comboApp.Enabled = $false
    foreach ($a in $AuthResponse.apps) {
        [void]$comboApp.Items.Add($a.label)
    }
    $form.Controls.Add($comboApp)
    $y += 28

    $radioAutopilot = New-Object System.Windows.Forms.RadioButton
    $radioAutopilot.Text = "Leave at OOBE for Autopilot"
    $radioAutopilot.Location = New-Object System.Drawing.Point(35, $y)
    $radioAutopilot.AutoSize = $true
    $form.Controls.Add($radioAutopilot)
    $y += 40

    $radioApp.Add_CheckedChanged({ $comboApp.Enabled = $radioApp.Checked })

    $btnOk = New-Object System.Windows.Forms.Button
    $btnOk.Text = "Continue"
    $btnOk.Location = New-Object System.Drawing.Point(280, $y)
    $btnOk.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.AcceptButton = $btnOk
    $form.Controls.Add($btnOk)
    $form.Size = New-Object System.Drawing.Size(420, ($y + 90))

    if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        return $null
    }

    $postAction = if ($radioApp.Checked) { "install-app" } elseif ($radioAutopilot.Checked) { "autopilot" } else { "domain-join" }
    $appId = $null
    if ($postAction -eq "install-app") {
        if ($comboApp.SelectedIndex -lt 0) {
            Show-ErrorBox "Pick an app to install."
            return $null
        }
        $appId = $AuthResponse.apps[$comboApp.SelectedIndex].id
    }
    $profileId = if ($comboProfile) {
        if ($comboProfile.SelectedIndex -lt 0) { Show-ErrorBox "Pick an OS profile."; return $null }
        $AuthResponse.profiles[$comboProfile.SelectedIndex].id
    } else {
        $AuthResponse.profile
    }

    return @{ Profile = $profileId; PostAction = $postAction; AppId = $appId }
}

# --- Step 3: confirm + deploy, with a live progress log -------------------

function Show-DeployForm {
    param($Deployment)

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "OS Deployment - Deploying"
    $form.Size = New-Object System.Drawing.Size(560, 380)
    $form.StartPosition = "CenterScreen"
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false

    $labelSummary = New-Object System.Windows.Forms.Label
    $labelSummary.Text = "$($Deployment.profile) / $($Deployment.postAction)$(if ($Deployment.appId) { " ($($Deployment.appId))" })"
    $labelSummary.Location = New-Object System.Drawing.Point(20, 15)
    $labelSummary.AutoSize = $true
    $form.Controls.Add($labelSummary)

    $logBox = New-Object System.Windows.Forms.TextBox
    $logBox.Location = New-Object System.Drawing.Point(20, 45)
    $logBox.Size = New-Object System.Drawing.Size(505, 220)
    $logBox.Multiline = $true
    $logBox.ScrollBars = "Vertical"
    $logBox.ReadOnly = $true
    $form.Controls.Add($logBox)

    $progressBar = New-Object System.Windows.Forms.ProgressBar
    $progressBar.Location = New-Object System.Drawing.Point(20, 275)
    $progressBar.Size = New-Object System.Drawing.Size(505, 20)
    $progressBar.Style = "Continuous"
    $form.Controls.Add($progressBar)

    $btnDeploy = New-Object System.Windows.Forms.Button
    $btnDeploy.Text = "Deploy"
    $btnDeploy.Location = New-Object System.Drawing.Point(430, 305)
    $form.Controls.Add($btnDeploy)

    function Write-Log([string]$Line) {
        $logBox.AppendText("$Line`r`n")
        $form.Refresh()
    }

    $btnDeploy.Add_Click({
        $btnDeploy.Enabled = $false
        try {
            $progressBar.Value = 5
            Write-Log "Partitioning disk 0 (UEFI/GPT)..."
            $diskpartScript = @"
select disk 0
clean
convert gpt
create partition efi size=100
format quick fs=fat32 label="System"
assign letter=S
create partition msr size=16
create partition primary
format quick fs=ntfs label="Windows"
assign letter=W
"@
            $diskpartScript | Out-File -FilePath "$env:TEMP\diskpart.txt" -Encoding ascii
            diskpart /s "$env:TEMP\diskpart.txt" | Out-Null
            $progressBar.Value = 20

            Write-Log "Downloading install.wim..."
            Invoke-WebRequest -Uri $Deployment.installWim -OutFile "W:\install.wim"
            $progressBar.Value = 55

            Write-Log "Applying image (index $($Deployment.imageIndex))..."
            dism /Apply-Image /ImageFile:"W:\install.wim" /Index:$($Deployment.imageIndex) /ApplyDir:"W:\" | Out-Null
            Remove-Item "W:\install.wim"
            $progressBar.Value = 85

            Write-Log "Writing answer file and post-action config..."
            New-Item -ItemType Directory -Force -Path "W:\Windows\Panther" | Out-Null
            Invoke-WebRequest -Uri $Deployment.answerFileUrl -OutFile "W:\Windows\Panther\unattend.xml"

            New-Item -ItemType Directory -Force -Path "W:\Windows\Setup\Scripts" | Out-Null
            Invoke-WebRequest -Uri $Deployment.postActionScriptUrl -OutFile "W:\Windows\Setup\Scripts\PostAction.ps1"
            @{ action = $Deployment.postAction; appUrl = $Deployment.appUrl } | ConvertTo-Json |
                Set-Content -Path "W:\Windows\Setup\Scripts\post-action.json"
            $progressBar.Value = 92

            Write-Log "Writing boot files..."
            bcdboot W:\Windows /s S: /f UEFI | Out-Null
            $progressBar.Value = 100

            Write-Log "Done. Rebooting in 5 seconds..."
            $form.Refresh()
            Start-Sleep -Seconds 5
            $form.Close()
            wpeutil reboot
        } catch {
            Write-Log "ERROR: $($_.Exception.Message)"
            Show-ErrorBox "Deployment failed: $($_.Exception.Message)`r`n`r`nCheck the log, fix the issue, and click Deploy to retry."
            $btnDeploy.Enabled = $true
        }
    })

    $form.ShowDialog() | Out-Null
}

# --- Main flow -------------------------------------------------------------

$mac = Get-MacAddress

while ($true) {
    $creds = Show-LoginForm -Mac $mac
    if (-not $creds) { exit }

    try {
        $auth = Invoke-DeployApi -Path "/api/deploy/auth" -Body @{ mac = $mac; username = $creds.Username; password = $creds.Password }
    } catch {
        Show-ErrorBox "Sign-in failed: $($_.Exception.Message)"
        continue
    }

    $deployment = $null
    switch ($auth.status) {
        "ready" { $deployment = $auth }
        { $_ -in "choose-action", "choose" } {
            $selection = Show-SelectionForm -AuthResponse $auth
            if (-not $selection) { continue }
            try {
                $deployment = Invoke-DeployApi -Path "/api/deploy/select" -Body @{
                    mac = $mac; username = $creds.Username; password = $creds.Password
                    profile = $selection.Profile; postAction = $selection.PostAction; appId = $selection.AppId
                }
            } catch {
                Show-ErrorBox "Couldn't save selection: $($_.Exception.Message)"
                continue
            }
        }
        default {
            Show-ErrorBox "Unexpected response from the deployment API: $($auth | ConvertTo-Json)"
            continue
        }
    }

    if ($deployment) {
        Show-DeployForm -Deployment $deployment
    }
    break
}
