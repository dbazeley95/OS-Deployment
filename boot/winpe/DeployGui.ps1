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

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

# Set this to your Worker's URL if it ever differs from the deployed one.
$WorkerBase = "https://api.osd.xcet.uk"

# Shared look - EnableVisualStyles above only re-themes buttons/checkboxes/
# comboboxes; font and colors still need to be set per form/control.
$UiFont = New-Object System.Drawing.Font("Segoe UI", 9)
$UiFontBold = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$AccentColor = [System.Drawing.Color]::FromArgb(37, 99, 235)
$MutedColor = [System.Drawing.Color]::FromArgb(107, 114, 128)
$CardColor = [System.Drawing.Color]::FromArgb(247, 248, 250)
$WarningColor = [System.Drawing.Color]::FromArgb(185, 28, 28)

function New-AccentButton {
    param([string]$Text, [System.Drawing.Point]$Location, [int]$Width = 120)
    $btn = New-Object System.Windows.Forms.Button
    $btn.Text = $Text
    $btn.Location = $Location
    $btn.Size = New-Object System.Drawing.Size($Width, 32)
    $btn.FlatStyle = "Flat"
    $btn.FlatAppearance.BorderSize = 0
    $btn.BackColor = $AccentColor
    $btn.ForeColor = [System.Drawing.Color]::White
    $btn.Cursor = [System.Windows.Forms.Cursors]::Hand
    return $btn
}

# Adds an accent-colored header banner (title + optional subtitle) to the
# top of a form - the same treatment Show-LoginForm established, reused
# across every screen for a consistent look. Returns the header's height
# so callers know where their own content can start.
function Add-HeaderBanner {
    param($Form, [string]$Title, [string]$Subtitle = $null, [int]$Width, [int]$Height = 60)

    $header = New-Object System.Windows.Forms.Panel
    $header.Size = New-Object System.Drawing.Size($Width, $Height)
    $header.Location = New-Object System.Drawing.Point(0, 0)
    $header.BackColor = $AccentColor
    $Form.Controls.Add($header)

    $titleY = if ($Subtitle) { 10 } else { [int](($Height - 32) / 2) }

    $labelTitle = New-Object System.Windows.Forms.Label
    $labelTitle.Text = $Title
    $labelTitle.Font = $UiFontBold
    $labelTitle.ForeColor = [System.Drawing.Color]::White
    $labelTitle.Location = New-Object System.Drawing.Point(24, $titleY)
    $labelTitle.AutoSize = $true
    $header.Controls.Add($labelTitle)

    if ($Subtitle) {
        $labelSubtitle = New-Object System.Windows.Forms.Label
        $labelSubtitle.Text = $Subtitle
        $labelSubtitle.ForeColor = [System.Drawing.Color]::White
        $labelSubtitle.Location = New-Object System.Drawing.Point(24, 40)
        $labelSubtitle.AutoSize = $true
        $header.Controls.Add($labelSubtitle)
    }

    return $Height
}

function Get-MacAddress {
    # Get-NetAdapter (the NetAdapter module) isn't reliably populated this
    # early in WinPE - fall back to the classic Win32_NetworkAdapterConfiguration
    # WMI class, which is available wherever WinPE-WMI is (every image built
    # per this repo's README).
    $config = Get-CimInstance -ClassName Win32_NetworkAdapterConfiguration -Filter "IPEnabled = TRUE" |
        Where-Object { $_.MACAddress } | Select-Object -First 1
    if (-not $config) {
        $config = Get-CimInstance -ClassName Win32_NetworkAdapterConfiguration -Filter "MACAddress IS NOT NULL" |
            Select-Object -First 1
    }
    if ($config -and $config.MACAddress) {
        return $config.MACAddress.ToLower().Replace("-", ":")
    }
    return $null
}

function Get-SerialNumber {
    (Get-CimInstance -ClassName Win32_BIOS).SerialNumber
}

function Get-BatteryStatus {
    # $null on a desktop (no Win32_Battery instance) - callers use that to
    # skip showing anything rather than a misleading "0%".
    $battery = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $battery) { return $null }
    return @{
        Percent = $battery.EstimatedChargeRemaining
        Charging = $battery.BatteryStatus -in 6, 7, 8, 9
    }
}

# Adds a small "Battery: NN% (charging/on battery)" label to the top-right of
# a form, refreshed every 30s - only if a battery is actually present, so
# desktops show nothing. Call after a form's other controls are added.
function Add-BatteryLabel {
    param($Form, [int]$Right, [int]$Y = 15)

    $initial = Get-BatteryStatus
    if (-not $initial) { return }

    $label = New-Object System.Windows.Forms.Label
    $label.AutoSize = $true
    $label.ForeColor = $MutedColor
    $label.Text = "Battery: $($initial.Percent)% $(if ($initial.Charging) { '(charging)' } else { '(on battery)' })"
    $label.Location = New-Object System.Drawing.Point(($Right - 160), $Y)
    $Form.Controls.Add($label)

    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 30000
    $timer.Add_Tick({
        # Deliberately swallows any error (WMI hiccup, disposed control, etc.)
        # rather than letting it propagate: this Tick can fire re-entrantly
        # from inside Application.DoEvents() calls elsewhere in the script
        # (e.g. Show-DeployForm's download loop), and an uncaught exception
        # here would otherwise bubble out of that DoEvents() call and get
        # caught by whatever unrelated try/catch happens to be running at
        # the time - showing up as a misleading, unrelated failure.
        try {
            $status = Get-BatteryStatus
            if ($status) {
                $label.Text = "Battery: $($status.Percent)% $(if ($status.Charging) { '(charging)' } else { '(on battery)' })"
            }
        } catch {}
    })
    $timer.Start()
    $Form.Add_FormClosed({ $timer.Stop() }) | Out-Null
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
    $form.Size = New-Object System.Drawing.Size(400, 330)
    $form.StartPosition = "CenterScreen"
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false
    $form.Font = $UiFont
    $form.BackColor = [System.Drawing.Color]::White

    Add-HeaderBanner -Form $form -Title "W.I.P.E" -Width 400 -Height 70 | Out-Null

    $labelUser = New-Object System.Windows.Forms.Label
    $labelUser.Text = "Username"
    $labelUser.ForeColor = $MutedColor
    $labelUser.Location = New-Object System.Drawing.Point(24, 92)
    $labelUser.AutoSize = $true
    $form.Controls.Add($labelUser)

    $textUser = New-Object System.Windows.Forms.TextBox
    $textUser.Location = New-Object System.Drawing.Point(24, 112)
    $textUser.Width = 340
    $form.Controls.Add($textUser)

    $labelPass = New-Object System.Windows.Forms.Label
    $labelPass.Text = "Password"
    $labelPass.ForeColor = $MutedColor
    $labelPass.Location = New-Object System.Drawing.Point(24, 152)
    $labelPass.AutoSize = $true
    $form.Controls.Add($labelPass)

    $textPass = New-Object System.Windows.Forms.TextBox
    $textPass.Location = New-Object System.Drawing.Point(24, 172)
    $textPass.Width = 340
    $textPass.UseSystemPasswordChar = $true
    $form.Controls.Add($textPass)

    $btnOk = New-AccentButton -Text "Connect" -Location (New-Object System.Drawing.Point(244, 215)) -Width 120
    $btnOk.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.AcceptButton = $btnOk
    $form.Controls.Add($btnOk)

    $labelMac = New-Object System.Windows.Forms.Label
    $labelMac.Text = if ($Mac) { "Device MAC: $Mac" } else { "Device MAC: not detected" }
    $labelMac.ForeColor = $MutedColor
    $labelMac.Font = New-Object System.Drawing.Font("Segoe UI", 8)
    $labelMac.Location = New-Object System.Drawing.Point(24, 262)
    $labelMac.AutoSize = $true
    $form.Controls.Add($labelMac)

    Add-BatteryLabel -Form $form -Right 380 -Y 78

    $result = $form.ShowDialog()
    if ($result -ne [System.Windows.Forms.DialogResult]::OK -or -not $textUser.Text) {
        return $null
    }
    return @{ Username = $textUser.Text; Password = $textPass.Text }
}

# --- Step 2: hostname / domain-join / task sequence selection ------------
# Hostname and task sequence are pre-filled (and, on first visit, disabled
# behind a "Resume previous deployment" choice) if this MAC already has an
# in-progress job (status "ready" - e.g. a retry after this same machine
# got partway through a previous boot) - picking "Edit selection" instead
# enables both for a quick correction (e.g. a typo'd hostname) without
# starting from a blank form. Domain-join is always confirmed fresh here
# regardless - the join credentials are never known to the cloud, so
# there's nothing to reuse there anyway. There's no admin job-scheduling
# step anywhere in this system - every job starts here.
#
# -Existing re-populates the form from a previous call's return value
# (used when the technician hits "Back" on Show-ConfirmForm) - when
# provided, the resume/edit choice is skipped entirely since we're
# already editing.

function Show-SelectionForm {
    param($AuthResponse, $Existing = $null)

    $isPreStaged = $AuthResponse.status -eq "ready"
    $showResumeChoice = $isPreStaged -and -not $Existing

    # Precompute what to pre-fill, regardless of where the value came from.
    $prefillHostname = if ($Existing) { $Existing.Hostname } elseif ($isPreStaged) { $AuthResponse.hostname }
    $prefillTaskSequenceId = if ($Existing) { $Existing.TaskSequenceId } elseif ($isPreStaged) { $AuthResponse.taskSequenceId }
    $prefillDomainJoin = if ($Existing) { [bool]$Existing.DomainJoin } else { [bool]$AuthResponse.domainJoin }
    $prefillDomain = if ($Existing) { $Existing.Domain } else { $AuthResponse.domain }
    $prefillDomainUser = if ($Existing) { $Existing.DomainUsername }
    $prefillDomainPass = if ($Existing) { $Existing.DomainPassword }

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "W.I.P.E - Options"
    $form.Size = New-Object System.Drawing.Size(460, $(if ($showResumeChoice) { 610 } else { 540 }))
    $form.StartPosition = "CenterScreen"
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false
    $form.Font = $UiFont
    $form.BackColor = [System.Drawing.Color]::White

    Add-HeaderBanner -Form $form -Title "Deployment options" -Width 460 -Height 60 | Out-Null
    Add-BatteryLabel -Form $form -Right 440 -Y 68

    $y = 80
    $fieldsEnabled = $true

    $radioResume = $null
    $radioEdit = $null
    if ($showResumeChoice) {
        $radioResume = New-Object System.Windows.Forms.RadioButton
        $radioResume.Text = "Resume previous deployment"
        $radioResume.Location = New-Object System.Drawing.Point(24, $y)
        $radioResume.AutoSize = $true
        $radioResume.Checked = $true
        $form.Controls.Add($radioResume)
        $y += 26

        $radioEdit = New-Object System.Windows.Forms.RadioButton
        $radioEdit.Text = "Edit selection (fix a typo, pick a different task sequence)"
        $radioEdit.Location = New-Object System.Drawing.Point(24, $y)
        $radioEdit.AutoSize = $true
        $form.Controls.Add($radioEdit)
        $y += 40

        $fieldsEnabled = $false
    }

    $labelHostname = New-Object System.Windows.Forms.Label
    $labelHostname.Text = "Hostname"
    $labelHostname.ForeColor = $MutedColor
    $labelHostname.Location = New-Object System.Drawing.Point(24, $y)
    $labelHostname.AutoSize = $true
    $form.Controls.Add($labelHostname)
    $y += 20

    $textHostname = New-Object System.Windows.Forms.TextBox
    $textHostname.Location = New-Object System.Drawing.Point(24, $y)
    $textHostname.Width = 412
    if ($prefillHostname) { $textHostname.Text = $prefillHostname }
    $textHostname.Enabled = $fieldsEnabled
    $form.Controls.Add($textHostname)
    $y += 39

    $labelTs = New-Object System.Windows.Forms.Label
    $labelTs.Text = "Task sequence"
    $labelTs.ForeColor = $MutedColor
    $labelTs.Location = New-Object System.Drawing.Point(24, $y)
    $labelTs.AutoSize = $true
    $form.Controls.Add($labelTs)
    $y += 20

    $comboTs = New-Object System.Windows.Forms.ComboBox
    $comboTs.Location = New-Object System.Drawing.Point(24, $y)
    $comboTs.Width = 412
    $comboTs.DropDownStyle = "DropDownList"
    foreach ($s in $AuthResponse.taskSequences) {
        [void]$comboTs.Items.Add("$($s.label) - $($s.osProfileLabel)")
    }
    $preselectIndex = -1
    if ($prefillTaskSequenceId) {
        for ($i = 0; $i -lt $AuthResponse.taskSequences.Count; $i++) {
            if ($AuthResponse.taskSequences[$i].id -eq $prefillTaskSequenceId) { $preselectIndex = $i; break }
        }
    }
    $comboTs.SelectedIndex = if ($preselectIndex -ge 0) { $preselectIndex } elseif ($comboTs.Items.Count -gt 0) { 0 } else { -1 }
    $comboTs.Enabled = $fieldsEnabled
    $form.Controls.Add($comboTs)
    $y += 39

    if ($showResumeChoice) {
        $onChoiceChanged = {
            $editing = $radioEdit.Checked
            $textHostname.Enabled = $editing
            $comboTs.Enabled = $editing
        }
        $radioResume.Add_CheckedChanged($onChoiceChanged)
        $radioEdit.Add_CheckedChanged($onChoiceChanged)
    }

    $checkDomain = New-Object System.Windows.Forms.CheckBox
    $checkDomain.Text = "Join a domain"
    $checkDomain.Location = New-Object System.Drawing.Point(24, $y)
    $checkDomain.AutoSize = $true
    $checkDomain.Checked = $prefillDomainJoin
    $form.Controls.Add($checkDomain)
    $y += 32

    $labelDomain = New-Object System.Windows.Forms.Label
    $labelDomain.Text = "Domain name"
    $labelDomain.ForeColor = $MutedColor
    $labelDomain.Location = New-Object System.Drawing.Point(24, $y)
    $labelDomain.AutoSize = $true
    $form.Controls.Add($labelDomain)
    $y += 20

    $textDomain = New-Object System.Windows.Forms.TextBox
    $textDomain.Location = New-Object System.Drawing.Point(24, $y)
    $textDomain.Width = 412
    if ($prefillDomain) { $textDomain.Text = $prefillDomain }
    $textDomain.Enabled = $checkDomain.Checked
    $form.Controls.Add($textDomain)
    $y += 39

    $labelDomainUser = New-Object System.Windows.Forms.Label
    $labelDomainUser.Text = "Domain username"
    $labelDomainUser.ForeColor = $MutedColor
    $labelDomainUser.Location = New-Object System.Drawing.Point(24, $y)
    $labelDomainUser.AutoSize = $true
    $form.Controls.Add($labelDomainUser)
    $y += 20

    $textDomainUser = New-Object System.Windows.Forms.TextBox
    $textDomainUser.Location = New-Object System.Drawing.Point(24, $y)
    $textDomainUser.Width = 412
    if ($prefillDomainUser) { $textDomainUser.Text = $prefillDomainUser }
    $textDomainUser.Enabled = $checkDomain.Checked
    $form.Controls.Add($textDomainUser)
    $y += 39

    $labelDomainPass = New-Object System.Windows.Forms.Label
    $labelDomainPass.Text = "Domain password"
    $labelDomainPass.ForeColor = $MutedColor
    $labelDomainPass.Location = New-Object System.Drawing.Point(24, $y)
    $labelDomainPass.AutoSize = $true
    $form.Controls.Add($labelDomainPass)
    $y += 20

    $textDomainPass = New-Object System.Windows.Forms.TextBox
    $textDomainPass.Location = New-Object System.Drawing.Point(24, $y)
    $textDomainPass.Width = 412
    $textDomainPass.UseSystemPasswordChar = $true
    if ($prefillDomainPass) { $textDomainPass.Text = $prefillDomainPass }
    $textDomainPass.Enabled = $checkDomain.Checked
    $form.Controls.Add($textDomainPass)
    $y += 46

    $checkDomain.Add_CheckedChanged({
        $textDomain.Enabled = $checkDomain.Checked
        $textDomainUser.Enabled = $checkDomain.Checked
        $textDomainPass.Enabled = $checkDomain.Checked
    })

    $btnOk = New-AccentButton -Text "Continue" -Location (New-Object System.Drawing.Point(316, $y)) -Width 120
    $btnOk.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.AcceptButton = $btnOk
    $form.Controls.Add($btnOk)

    if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        return $null
    }

    if ([string]::IsNullOrWhiteSpace($textHostname.Text)) {
        Show-ErrorBox "Enter a hostname for this device."
        return $null
    }
    if ($comboTs.SelectedIndex -lt 0) {
        Show-ErrorBox "Pick a task sequence."
        return $null
    }
    $taskSequenceId = $AuthResponse.taskSequences[$comboTs.SelectedIndex].id

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

# --- Step 3: confirm before the destructive wipe -------------------------
# One last look at what's about to happen, with a way back to Selection to
# fix anything, before /api/deploy/select is ever called or disk 0 is
# touched.

function Show-ConfirmForm {
    param($AuthResponse, $Selection)

    $chosenSequence = $AuthResponse.taskSequences | Where-Object { $_.id -eq $Selection.TaskSequenceId } | Select-Object -First 1
    $taskSequenceSummary = if ($chosenSequence) { "$($chosenSequence.label) ($($chosenSequence.osProfileLabel))" } else { $Selection.TaskSequenceId }
    $domainSummary = if ($Selection.DomainJoin) { "Yes - $($Selection.Domain)" } else { "No" }

    $rows = @(
        @{ Label = "Hostname"; Value = $Selection.Hostname }
        @{ Label = "Task sequence"; Value = $taskSequenceSummary }
        @{ Label = "Join a domain"; Value = $domainSummary }
    )

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "W.I.P.E - Confirm"
    $form.StartPosition = "CenterScreen"
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false
    $form.Font = $UiFont
    $form.BackColor = [System.Drawing.Color]::White

    Add-HeaderBanner -Form $form -Title "Confirm deployment" -Width 460 -Height 60 | Out-Null
    Add-BatteryLabel -Form $form -Right 440 -Y 68

    $panel = New-Object System.Windows.Forms.Panel
    $panel.Location = New-Object System.Drawing.Point(24, 84)
    $panel.Size = New-Object System.Drawing.Size(412, ($rows.Count * 40))
    $panel.BackColor = $CardColor
    $form.Controls.Add($panel)

    $rowY = 10
    foreach ($row in $rows) {
        $labelKey = New-Object System.Windows.Forms.Label
        $labelKey.Text = $row.Label
        $labelKey.ForeColor = $MutedColor
        $labelKey.Location = New-Object System.Drawing.Point(16, $rowY)
        $labelKey.AutoSize = $true
        $panel.Controls.Add($labelKey)

        $labelVal = New-Object System.Windows.Forms.Label
        $labelVal.Text = $row.Value
        $labelVal.Location = New-Object System.Drawing.Point(170, $rowY)
        $labelVal.AutoSize = $true
        $panel.Controls.Add($labelVal)

        $rowY += 34
    }

    $panelBottom = 84 + $panel.Height

    $warning = New-Object System.Windows.Forms.Label
    $warning.Text = "This wipes disk 0 completely and cannot be undone."
    $warning.ForeColor = $WarningColor
    $warning.Location = New-Object System.Drawing.Point(24, ($panelBottom + 16))
    $warning.AutoSize = $true
    $form.Controls.Add($warning)

    $btnConfirm = New-AccentButton -Text "Confirm && Deploy" -Location (New-Object System.Drawing.Point(216, ($panelBottom + 50))) -Width 220
    $btnConfirm.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.AcceptButton = $btnConfirm
    $form.Controls.Add($btnConfirm)

    $btnBack = New-Object System.Windows.Forms.Button
    $btnBack.Text = "Back"
    $btnBack.Location = New-Object System.Drawing.Point(24, ($panelBottom + 50))
    $btnBack.Size = New-Object System.Drawing.Size(100, 32)
    $btnBack.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Controls.Add($btnBack)

    $form.Size = New-Object System.Drawing.Size(460, ($panelBottom + 130))
    $result = $form.ShowDialog()
    return $result -eq [System.Windows.Forms.DialogResult]::OK
}

# --- Step 4: deploy, with a live progress log -----------------------------
# Confirmation already happened in Show-ConfirmForm, so this starts the
# (destructive) partition/download/apply sequence automatically as soon as
# the form is shown - no second "Deploy" click needed. On failure, a
# Retry button (hidden until then) re-runs the same steps.

function Show-DeployForm {
    param($Deployment)

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "W.I.P.E - Deploying"
    $form.Size = New-Object System.Drawing.Size(560, 420)
    $form.StartPosition = "CenterScreen"
    $form.FormBorderStyle = "FixedDialog"
    $form.MaximizeBox = $false
    $form.Font = $UiFont
    $form.BackColor = [System.Drawing.Color]::White

    $subtitle = "$($Deployment.taskSequence)$(if ($Deployment.domainJoin) { " - join $($Deployment.domain)" })"
    Add-HeaderBanner -Form $form -Title $Deployment.hostname -Subtitle $subtitle -Width 560 -Height 70 | Out-Null
    Add-BatteryLabel -Form $form -Right 540 -Y 78

    $logBox = New-Object System.Windows.Forms.TextBox
    $logBox.Location = New-Object System.Drawing.Point(20, 95)
    $logBox.Size = New-Object System.Drawing.Size(505, 220)
    $logBox.Multiline = $true
    $logBox.ScrollBars = "Vertical"
    $logBox.ReadOnly = $true
    $form.Controls.Add($logBox)

    $progressBar = New-Object System.Windows.Forms.ProgressBar
    $progressBar.Location = New-Object System.Drawing.Point(20, 325)
    $progressBar.Size = New-Object System.Drawing.Size(505, 20)
    $progressBar.Style = "Continuous"
    $form.Controls.Add($progressBar)

    $btnRetry = New-AccentButton -Text "Retry" -Location (New-Object System.Drawing.Point(400, 355)) -Width 125
    $btnRetry.Visible = $false
    $form.Controls.Add($btnRetry)

    function Write-Log([string]$Line) {
        $logBox.AppendText("$Line`r`n")
        $form.Refresh()
    }

    # Shared by both install.wim sources (R2 over HTTPS, or a network file
    # share read as a local/UNC file) - reads $SourceStream synchronously on
    # this same thread, calling DoEvents() each chunk to stay responsive, the
    # same proven-safe pattern used for dism's progress below. $ProgressMin/
    # $ProgressScale map the source's own 0-100% onto a sub-range of the
    # overall progress bar (20-55, same as before this was extracted).
    function Copy-StreamWithProgress {
        param(
            [System.IO.Stream]$SourceStream,
            [long]$TotalBytes,
            [string]$DestPath,
            [string]$LogPrefix,
            [int]$ProgressMin,
            [double]$ProgressScale
        )
        $fileStream = [System.IO.File]::Create($DestPath)
        try {
            $buffer = New-Object byte[] 65536
            $totalRead = 0
            $lastPercent = -1
            while (($read = $SourceStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $fileStream.Write($buffer, 0, $read)
                $totalRead += $read
                $percent = if ($TotalBytes -gt 0) { [int](($totalRead / $TotalBytes) * 100) } else { 0 }
                if ($percent -ne $lastPercent) {
                    $lastPercent = $percent
                    $progressBar.Value = $ProgressMin + [int]($percent * $ProgressScale)
                    $text = $logBox.Text
                    $lastBreak = $text.LastIndexOf("`r`n", [Math]::Max(0, $text.Length - 3))
                    $prefix = if ($lastBreak -ge 0) { $text.Substring(0, $lastBreak + 2) } else { "" }
                    $logBox.Text = "$prefix" + "$LogPrefix $percent%`r`n"
                    $logBox.SelectionStart = $logBox.Text.Length
                    $logBox.ScrollToCaret()
                }
                [System.Windows.Forms.Application]::DoEvents()
            }
        } finally {
            $fileStream.Close()
        }
    }

    $runDeploy = {
        $btnRetry.Visible = $false
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
            $diskpartOutput = diskpart /s "$env:TEMP\diskpart.txt" 2>&1 | Out-String
            # diskpart's own exit code, plus actually checking the W:/S:
            # volumes it's supposed to create, both used to go unchecked
            # here (output silently discarded) - a drive-letter collision
            # with another volume (a known WinPE quirk: `clean`+`convert
            # gpt` re-enumerates every disk's letters, not just this one)
            # would previously fail silently, then bcdboot below would
            # write boot files to whatever S: happened to resolve to - the
            # image applies "successfully" but the machine won't boot.
            if ($LASTEXITCODE -ne 0 -or -not (Test-Path "W:\") -or -not (Test-Path "S:\")) {
                throw "diskpart didn't produce the expected W:/S: volumes (exit code $LASTEXITCODE). Output:`r`n$diskpartOutput"
            }
            $progressBar.Value = 20

            if ($Deployment.sourceType -eq "fileshare") {
                # Alternative to R2 for when several machines are building at
                # once - pulls install.wim over the LAN from a Windows file
                # share instead of repeatedly through the Worker/R2 over the
                # internet. Authenticated with the same credentials already
                # collected for domain-join (never a separate prompt), so
                # this source requires "Join a domain" to have been enabled -
                # fail clearly up front rather than let `net use` fail
                # obscurely with no credentials at all.
                if (-not $Deployment.domainUsername -or -not $Deployment.domainPassword) {
                    throw "This task sequence's operating system is served from a network file share, which needs domain credentials to read. Go back and enable 'Join a domain', then try again."
                }
                if ($Deployment.fileSharePath -notmatch '^(\\\\[^\\]+\\[^\\]+)') {
                    throw "Operating system file share path '$($Deployment.fileSharePath)' doesn't look like a valid UNC path (\\server\share\...)."
                }
                $shareRoot = $matches[1]
                Write-Log "Connecting to $shareRoot..."
                # net use (not New-SmbMapping) for compatibility - the SmbShare
                # module isn't guaranteed present in a minimal WinPE image,
                # while net.exe is a core tool every WinPE build already has.
                # The password is briefly visible as a process argument as a
                # result - a similar, already-accepted tradeoff to how this
                # script already handles domain-join credentials elsewhere.
                # Quoted explicitly (not just a bare variable/subexpression)
                # so a password or username containing spaces is passed as
                # one argument to net.exe, not word-split apart.
                $netUseOutput = net use $shareRoot "$($Deployment.domainPassword)" "/user:$($Deployment.domainUsername)" 2>&1 | Out-String
                if ($LASTEXITCODE -ne 0) {
                    throw "Couldn't connect to file share '$shareRoot' (exit code $LASTEXITCODE). Output:`r`n$netUseOutput"
                }
                try {
                    Write-Log "Downloading install.wim from file share..."
                    $totalBytes = (Get-Item -LiteralPath $Deployment.fileSharePath).Length
                    $sourceStream = [System.IO.File]::OpenRead($Deployment.fileSharePath)
                    try {
                        Copy-StreamWithProgress -SourceStream $sourceStream -TotalBytes $totalBytes -DestPath "W:\install.wim" `
                            -LogPrefix "Downloading install.wim..." -ProgressMin 20 -ProgressScale 0.35
                    } finally {
                        $sourceStream.Close()
                    }
                } finally {
                    net use $shareRoot /delete /y 2>&1 | Out-Null
                }
            } else {
                Write-Log "Downloading install.wim..."
                # Invoke-WebRequest/WebClient's async download both block or
                # fire events off-thread with no reliable way back into this
                # function's scope from WinPE's PowerShell - so Copy-
                # StreamWithProgress reads the response stream manually
                # instead, on this same thread, which is already proven to
                # work (the diskpart/dism calls around it use the same
                # UI-thread-only approach).
                $request = [System.Net.WebRequest]::Create([Uri]$Deployment.installWim)
                $response = $request.GetResponse()
                $totalBytes = $response.ContentLength
                $responseStream = $response.GetResponseStream()
                try {
                    Copy-StreamWithProgress -SourceStream $responseStream -TotalBytes $totalBytes -DestPath "W:\install.wim" `
                        -LogPrefix "Downloading install.wim..." -ProgressMin 20 -ProgressScale 0.35
                } finally {
                    $responseStream.Close()
                    $response.Close()
                }
            }
            # The progress bar tracks overall deployment progress throughout
            # (5/20/55/85/92/100 below) - only the log line shows the
            # download's own 0-100%, so the two numbers never look mismatched.
            $progressBar.Value = 55

            Write-Log "Applying image (index $($Deployment.imageIndex))..."
            # Same reasoning as the install.wim download above: dism's own
            # progress needs to be read synchronously on this thread with
            # periodic DoEvents() calls, not via the async OutputDataReceived
            # event - that fires on a ThreadPool thread, which is exactly the
            # class of bug (WinForms controls touched off the UI thread) that
            # took three prior fix attempts to eliminate from the download
            # step. Reading char-by-char (rather than ReadLine) handles dism
            # versions that redraw its progress bar in place via `\r` as well
            # as ones that print periodic "NN.N%" lines when output is
            # redirected - either way a % is extracted with the same regex.
            $dismPsi = New-Object System.Diagnostics.ProcessStartInfo
            $dismPsi.FileName = "dism.exe"
            $dismPsi.Arguments = "/Apply-Image /ImageFile:`"W:\install.wim`" /Index:$($Deployment.imageIndex) /ApplyDir:`"W:\`""
            $dismPsi.RedirectStandardOutput = $true
            $dismPsi.RedirectStandardError = $true
            $dismPsi.UseShellExecute = $false
            $dismPsi.CreateNoWindow = $true
            $dismProcess = New-Object System.Diagnostics.Process
            $dismProcess.StartInfo = $dismPsi
            $dismStdErr = New-Object System.Text.StringBuilder
            $dismProcess.add_ErrorDataReceived({
                param($sender, $e)
                if ($e.Data) { [void]$dismStdErr.AppendLine($e.Data) }
            })
            [void]$dismProcess.Start()
            $dismProcess.BeginErrorReadLine()

            $dismOutput = New-Object System.Text.StringBuilder
            $dismLineBuffer = New-Object System.Text.StringBuilder
            $lastDismPercent = -1
            $dismBuffer = New-Object char[] 256
            while (-not $dismProcess.StandardOutput.EndOfStream) {
                $read = $dismProcess.StandardOutput.Read($dismBuffer, 0, $dismBuffer.Length)
                if ($read -le 0) { break }
                for ($i = 0; $i -lt $read; $i++) {
                    $ch = $dismBuffer[$i]
                    [void]$dismOutput.Append($ch)
                    if ($ch -eq "`r" -or $ch -eq "`n") {
                        $line = $dismLineBuffer.ToString()
                        [void]$dismLineBuffer.Clear()
                        if ($line -match '(\d{1,3}(?:\.\d+)?)\s*%') {
                            $dismPercent = [int][double]$matches[1]
                            if ($dismPercent -ne $lastDismPercent) {
                                $lastDismPercent = $dismPercent
                                $progressBar.Value = 55 + [int]($dismPercent * 0.30)
                                $text = $logBox.Text
                                $lastBreak = $text.LastIndexOf("`r`n", [Math]::Max(0, $text.Length - 3))
                                $prefix = if ($lastBreak -ge 0) { $text.Substring(0, $lastBreak + 2) } else { "" }
                                $logBox.Text = "$prefix" + "Applying image (index $($Deployment.imageIndex))... $dismPercent%`r`n"
                                $logBox.SelectionStart = $logBox.Text.Length
                                $logBox.ScrollToCaret()
                            }
                        }
                    } else {
                        [void]$dismLineBuffer.Append($ch)
                    }
                }
                [System.Windows.Forms.Application]::DoEvents()
            }
            $dismProcess.WaitForExit()
            if ($dismProcess.ExitCode -ne 0 -or -not (Test-Path "W:\Windows\System32\ntoskrnl.exe")) {
                throw "dism /Apply-Image failed (exit code $($dismProcess.ExitCode)) or produced an incomplete Windows install. Output:`r`n$($dismOutput.ToString())`r`n$($dismStdErr.ToString())"
            }
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
            $bcdbootOutput = bcdboot W:\Windows /s S: /f UEFI 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) {
                throw "bcdboot failed (exit code $LASTEXITCODE) - boot files were not written to the EFI partition. Output:`r`n$bcdbootOutput"
            }
            Write-Log $bcdbootOutput.Trim()
            $progressBar.Value = 100

            Write-Log "Done. Rebooting in 5 seconds..."
            $form.Refresh()
            Start-Sleep -Seconds 5
            $form.Close()
            wpeutil reboot
        } catch {
            # Line number + stack trace included deliberately: this exact
            # deploy failure has recurred across several prior fix attempts
            # with only a generic message to go on, which made each fix a
            # guess. If it happens again, this pinpoints exactly where.
            $errLine = $_.InvocationInfo.ScriptLineNumber
            $errText = $_.InvocationInfo.Line.Trim()
            Write-Log "ERROR (line ${errLine}): $($_.Exception.Message)"
            Write-Log "  at: $errText"
            Show-ErrorBox "Deployment failed (line ${errLine}): $($_.Exception.Message)`r`n`r`nAt: $errText`r`n`r`nCheck the log, fix the issue, and click Retry."
            $btnRetry.Visible = $true
        }
    }

    $btnRetry.Add_Click({ & $runDeploy })
    $form.Add_Shown({ & $runDeploy })

    $form.ShowDialog() | Out-Null
}

# --- Main flow -------------------------------------------------------------

$mac = Get-MacAddress
$serialNumber = Get-SerialNumber

if (-not $mac) {
    Show-ErrorBox "No network adapter with a MAC address was found, so this device can't be identified to the deployment API. Check that a NIC driver loaded during boot and a cable/Wi-Fi is connected, then re-run this script."
    exit
}

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

    # Selection <-> Confirm loop - "Back" on the confirm screen redisplays
    # Selection with everything just entered preserved, rather than forcing
    # re-login. Only leaving this loop with no selection at all (Cancel on
    # Selection itself) falls through to re-login below.
    $selection = $null
    $confirmed = $false
    while (-not $confirmed) {
        $selection = Show-SelectionForm -AuthResponse $auth -Existing $selection
        if (-not $selection) { break }
        $confirmed = Show-ConfirmForm -AuthResponse $auth -Selection $selection
    }
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
