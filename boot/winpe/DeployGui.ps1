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

function Get-SerialNumber {
    (Get-CimInstance -ClassName Win32_BIOS).SerialNumber
}

function Invoke-DeployApi {
    param([string]$Path, [hashtable]$Body)
    Invoke-RestMethod -Method Post -Uri "$WorkerBase$Path" -ContentType "application/json" -Body ($Body | ConvertTo-Json)
}

function Show-ErrorBox {
    param([string]$Message)
    [System.Windows.Forms.MessageBox]::Show($Message, "W.I.P.E", "OK", "Error") | Out-Null
}

# --- Step 1: technician login -------------------------------------------

function Show-LoginForm {
    param([string]$Mac)

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "W.I.P.E - Sign in"
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

# --- Step 2: hostname / domain-join / task sequence selection ------------
# Hostname and task sequence are skipped (shown read-only) if this MAC
# already has an in-progress job (status "ready" - e.g. a retry after this
# same machine got partway through a previous boot). Domain-join is always
# confirmed fresh here regardless - the join credentials are never known
# to the cloud, so there's nothing to reuse there anyway. There's no admin
# job-scheduling step anywhere in this system - every job starts here.

function Show-SelectionForm {
    param($AuthResponse)

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "W.I.P.E - Options"
    $form.Size = New-Object System.Drawing.Size(460, 420)
    $form.StartPosition = "CenterScreen"
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false

    $isPreStaged = $AuthResponse.status -eq "ready"
    $y = 15

    $labelHostname = New-Object System.Windows.Forms.Label
    $labelHostname.Text = "Hostname"
    $labelHostname.Location = New-Object System.Drawing.Point(20, $y)
    $labelHostname.AutoSize = $true
    $form.Controls.Add($labelHostname)

    $textHostname = New-Object System.Windows.Forms.TextBox
    $textHostname.Location = New-Object System.Drawing.Point(150, ($y - 3))
    $textHostname.Width = 260
    if ($isPreStaged -and $AuthResponse.hostname) {
        $textHostname.Text = $AuthResponse.hostname
        $textHostname.Enabled = $false
    }
    $form.Controls.Add($textHostname)
    $y += 35

    $labelTs = New-Object System.Windows.Forms.Label
    $labelTs.Text = "Task sequence"
    $labelTs.Location = New-Object System.Drawing.Point(20, $y)
    $labelTs.AutoSize = $true
    $form.Controls.Add($labelTs)

    $comboTs = $null
    if ($isPreStaged) {
        $labelTsValue = New-Object System.Windows.Forms.Label
        $labelTsValue.Text = $AuthResponse.taskSequenceId
        $labelTsValue.Location = New-Object System.Drawing.Point(150, $y)
        $labelTsValue.AutoSize = $true
        $form.Controls.Add($labelTsValue)
    } else {
        $comboTs = New-Object System.Windows.Forms.ComboBox
        $comboTs.Location = New-Object System.Drawing.Point(150, ($y - 3))
        $comboTs.Width = 260
        $comboTs.DropDownStyle = "DropDownList"
        foreach ($s in $AuthResponse.taskSequences) {
            [void]$comboTs.Items.Add("$($s.label) - $($s.osProfileLabel)")
        }
        if ($comboTs.Items.Count -gt 0) { $comboTs.SelectedIndex = 0 }
        $form.Controls.Add($comboTs)
    }
    $y += 35

    $checkDomain = New-Object System.Windows.Forms.CheckBox
    $checkDomain.Text = "Join a domain"
    $checkDomain.Location = New-Object System.Drawing.Point(20, $y)
    $checkDomain.AutoSize = $true
    $checkDomain.Checked = [bool]$AuthResponse.domainJoin
    $form.Controls.Add($checkDomain)
    $y += 30

    $labelDomain = New-Object System.Windows.Forms.Label
    $labelDomain.Text = "Domain name"
    $labelDomain.Location = New-Object System.Drawing.Point(35, $y)
    $labelDomain.AutoSize = $true
    $form.Controls.Add($labelDomain)

    $textDomain = New-Object System.Windows.Forms.TextBox
    $textDomain.Location = New-Object System.Drawing.Point(150, ($y - 3))
    $textDomain.Width = 260
    if ($AuthResponse.domain) { $textDomain.Text = $AuthResponse.domain }
    $textDomain.Enabled = $checkDomain.Checked
    $form.Controls.Add($textDomain)
    $y += 32

    $labelDomainUser = New-Object System.Windows.Forms.Label
    $labelDomainUser.Text = "Domain username"
    $labelDomainUser.Location = New-Object System.Drawing.Point(35, $y)
    $labelDomainUser.AutoSize = $true
    $form.Controls.Add($labelDomainUser)

    $textDomainUser = New-Object System.Windows.Forms.TextBox
    $textDomainUser.Location = New-Object System.Drawing.Point(150, ($y - 3))
    $textDomainUser.Width = 260
    $textDomainUser.Enabled = $checkDomain.Checked
    $form.Controls.Add($textDomainUser)
    $y += 32

    $labelDomainPass = New-Object System.Windows.Forms.Label
    $labelDomainPass.Text = "Domain password"
    $labelDomainPass.Location = New-Object System.Drawing.Point(35, $y)
    $labelDomainPass.AutoSize = $true
    $form.Controls.Add($labelDomainPass)

    $textDomainPass = New-Object System.Windows.Forms.TextBox
    $textDomainPass.Location = New-Object System.Drawing.Point(150, ($y - 3))
    $textDomainPass.Width = 260
    $textDomainPass.UseSystemPasswordChar = $true
    $textDomainPass.Enabled = $checkDomain.Checked
    $form.Controls.Add($textDomainPass)
    $y += 40

    $checkDomain.Add_CheckedChanged({
        $textDomain.Enabled = $checkDomain.Checked
        $textDomainUser.Enabled = $checkDomain.Checked
        $textDomainPass.Enabled = $checkDomain.Checked
    })

    $btnOk = New-Object System.Windows.Forms.Button
    $btnOk.Text = "Continue"
    $btnOk.Location = New-Object System.Drawing.Point(320, $y)
    $btnOk.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.AcceptButton = $btnOk
    $form.Controls.Add($btnOk)
    $form.Size = New-Object System.Drawing.Size(460, ($y + 90))

    if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        return $null
    }

    if ([string]::IsNullOrWhiteSpace($textHostname.Text)) {
        Show-ErrorBox "Enter a hostname for this device."
        return $null
    }
    $taskSequenceId = if ($comboTs) {
        if ($comboTs.SelectedIndex -lt 0) { Show-ErrorBox "Pick a task sequence."; return $null }
        $AuthResponse.taskSequences[$comboTs.SelectedIndex].id
    } else {
        $AuthResponse.taskSequenceId
    }
    $domain = $null
    $domainUsername = $null
    $domainPassword = $null
    if ($checkDomain.Checked) {
        if ([string]::IsNullOrWhiteSpace($textDomain.Text) -or [string]::IsNullOrWhiteSpace($textDomainUser.Text) -or [string]::IsNullOrWhiteSpace($textDomainPass.Text)) {
            Show-ErrorBox "Enter the domain name, username, and password to join."
            return $null
        }
        $domain = $textDomain.Text.Trim()
        $domainUsername = $textDomainUser.Text.Trim()
        $domainPassword = $textDomainPass.Text
    }

    return @{
        Hostname = $textHostname.Text.Trim()
        TaskSequenceId = $taskSequenceId
        DomainJoin = [bool]$checkDomain.Checked
        Domain = $domain
        DomainUsername = $domainUsername
        DomainPassword = $domainPassword
    }
}

# --- Step 3: confirm + deploy, with a live progress log -------------------

function Show-DeployForm {
    param($Deployment)

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "W.I.P.E - Deploying"
    $form.Size = New-Object System.Drawing.Size(560, 380)
    $form.StartPosition = "CenterScreen"
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false

    $labelSummary = New-Object System.Windows.Forms.Label
    $labelSummary.Text = "$($Deployment.hostname) - $($Deployment.taskSequence)$(if ($Deployment.domainJoin) { " [join $($Deployment.domain)]" })"
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
            # The answer file's <ComputerName> ships as the placeholder
            # "WIN-REIMAGED" (see boot/profiles/*/autounattend.xml) - swap it
            # for the technician-entered hostname before writing to disk.
            $computerName = if ($Deployment.hostname) { $Deployment.hostname } else { "WIN-" + ($mac -replace ":", "").Substring(6).ToUpper() }
            $answerFileContent = (Invoke-WebRequest -Uri $Deployment.answerFileUrl -UseBasicParsing).Content
            $answerFileContent = $answerFileContent -replace "WIN-REIMAGED", $computerName
            Set-Content -Path "W:\Windows\Panther\unattend.xml" -Value $answerFileContent -Encoding UTF8

            New-Item -ItemType Directory -Force -Path "W:\Windows\Setup\Scripts" | Out-Null
            Invoke-WebRequest -Uri $Deployment.postActionScriptUrl -OutFile "W:\Windows\Setup\Scripts\PostAction.ps1"
            # domainUsername/domainPassword were collected locally by
            # Show-SelectionForm and merged onto $Deployment client-side -
            # they were never sent to the Worker. PostAction.ps1 reads them
            # from this file at first logon, then scrubs them immediately
            # after a successful join.
            @{
                domainJoin = $Deployment.domainJoin
                domain = $Deployment.domain
                domainUsername = $Deployment.domainUsername
                domainPassword = $Deployment.domainPassword
                steps = $Deployment.steps
            } | ConvertTo-Json -Depth 5 | Set-Content -Path "W:\Windows\Setup\Scripts\post-action.json"
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
$serialNumber = Get-SerialNumber

while ($true) {
    $creds = Show-LoginForm -Mac $mac
    if (-not $creds) { exit }

    try {
        $auth = Invoke-DeployApi -Path "/api/deploy/auth" -Body @{ mac = $mac; username = $creds.Username; password = $creds.Password }
    } catch {
        Show-ErrorBox "Sign-in failed: $($_.Exception.Message)"
        continue
    }

    if ($auth.status -ne "ready" -and $auth.status -ne "choose") {
        Show-ErrorBox "Unexpected response from the deployment API: $($auth | ConvertTo-Json)"
        continue
    }

    # Domain-join credentials are never known to the cloud (see deploy.ts),
    # so this form is always shown, even when this MAC already has an
    # in-progress job - it just pre-fills/disables whatever was already
    # decided on a previous boot.
    $selection = Show-SelectionForm -AuthResponse $auth
    if (-not $selection) { continue }

    try {
        $deployment = Invoke-DeployApi -Path "/api/deploy/select" -Body @{
            mac = $mac; username = $creds.Username; password = $creds.Password
            hostname = $selection.Hostname; serialNumber = $serialNumber; taskSequenceId = $selection.TaskSequenceId
            domainJoin = $selection.DomainJoin; domain = $selection.Domain
        }
    } catch {
        Show-ErrorBox "Couldn't save selection: $($_.Exception.Message)"
        continue
    }

    # Merge the locally-collected domain credentials back onto the
    # deployment object - they were deliberately never part of the
    # /select request body above.
    $deployment | Add-Member -NotePropertyName domainUsername -NotePropertyValue $selection.DomainUsername -Force
    $deployment | Add-Member -NotePropertyName domainPassword -NotePropertyValue $selection.DomainPassword -Force

    Show-DeployForm -Deployment $deployment
    break
}
