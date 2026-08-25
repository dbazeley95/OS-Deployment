# Single generalized first-logon script, referenced identically from every
# profile's autounattend.xml (see boot/profiles/windows-11-25h2-*/autounattend.xml).
# DeployGui.ps1 (WinPE side) already wrote C:\Windows\Setup\Scripts\post-action.json
# describing everything the technician decided in the wizard - hostname was
# already applied to the answer file, and domain-join credentials were
# already collected there too.
#
# Launched via a HKLM\...\RunOnce registry entry (seeded by the answer
# file's FirstLogonCommands, not run directly from there) - RunOnce fires
# right as the first interactive desktop session starts, rather than
# blocking the desktop from appearing at all like a FirstLogonCommands
# entry would. That's what makes a visible GUI possible here, and also
# sidesteps a real correctness risk: Microsoft's own docs now say
# FirstLogonCommands entries "are all started at the same time, and no
# longer wait for the previous command to finish" on current Windows,
# despite the <Order> element suggesting otherwise.
#
# The RunOnce value name is prefixed with "!" (see
# HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce) - Windows only
# deletes a RunOnce value AFTER its command exits, instead of before, so if
# this script's own domain-join reboot (Add-Computer -Restart) kills the
# process partway through, Windows re-launches this same script at the
# very next logon instead of silently dropping the rest of the work. This
# script is written to resume cleanly in that case: it checks whether the
# machine is already domain-joined before attempting it again, and tracks
# which task-sequence steps already completed in post-action.json so they
# aren't re-run.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

$WorkerBase = "https://api.osd.xcet.uk"
$configPath = "C:\Windows\Setup\Scripts\post-action.json"

# Shared look - same tokens as DeployGui.ps1, kept in sync deliberately so
# this looks like the same product, not a different tool bolted on.
$UiFont = New-Object System.Drawing.Font("Segoe UI", 9)
$UiFontBold = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$AccentColor = [System.Drawing.Color]::FromArgb(20, 33, 70)
$WarningColor = [System.Drawing.Color]::FromArgb(196, 35, 42)
$OkColor = [System.Drawing.Color]::FromArgb(22, 130, 60)
$MutedColor = [System.Drawing.Color]::FromArgb(107, 114, 128)

$script:LogoImage = $null
function Get-LogoImage {
    if ($null -ne $script:LogoImage) { return $script:LogoImage }
    try {
        $bytes = (Invoke-WebRequest -Uri "$WorkerBase/images/winpe/logo.png" -UseBasicParsing).Content
        $stream = New-Object System.IO.MemoryStream(, $bytes)
        $script:LogoImage = [System.Drawing.Image]::FromStream($stream)
    } catch {
        $script:LogoImage = $false
    }
    return $script:LogoImage
}

function Add-HeaderBanner {
    param($Form, [string]$Title, [string]$Subtitle = $null, [int]$Width, [int]$Height = 60)

    $header = New-Object System.Windows.Forms.Panel
    $header.Size = New-Object System.Drawing.Size($Width, $Height)
    $header.Location = New-Object System.Drawing.Point(0, 0)
    $header.BackColor = $AccentColor
    $Form.Controls.Add($header)

    $textX = 24
    $logo = Get-LogoImage
    if ($logo) {
        $logoHeight = $Height - 16
        $logoWidth = [int]($logoHeight * $logo.Width / $logo.Height)
        $pictureBox = New-Object System.Windows.Forms.PictureBox
        $pictureBox.Image = $logo
        $pictureBox.SizeMode = "Zoom"
        $pictureBox.Location = New-Object System.Drawing.Point(16, 8)
        $pictureBox.Size = New-Object System.Drawing.Size($logoWidth, $logoHeight)
        $pictureBox.BackColor = [System.Drawing.Color]::Transparent
        $header.Controls.Add($pictureBox)
        $textX = 16 + $logoWidth + 12
    }

    $titleY = if ($Subtitle) { 10 } else { [int](($Height - 32) / 2) }

    $labelTitle = New-Object System.Windows.Forms.Label
    $labelTitle.Text = $Title
    $labelTitle.Font = $UiFontBold
    $labelTitle.ForeColor = [System.Drawing.Color]::White
    $labelTitle.Location = New-Object System.Drawing.Point($textX, $titleY)
    $labelTitle.AutoSize = $true
    $header.Controls.Add($labelTitle)

    if ($Subtitle) {
        $labelSubtitle = New-Object System.Windows.Forms.Label
        $labelSubtitle.Text = $Subtitle
        $labelSubtitle.ForeColor = [System.Drawing.Color]::White
        $labelSubtitle.Location = New-Object System.Drawing.Point($textX, 40)
        $labelSubtitle.AutoSize = $true
        $header.Controls.Add($labelSubtitle)
    }

    return $Height
}

function Get-MacAddress {
    (Get-NetAdapter | Where-Object Status -eq "Up" | Select-Object -First 1 -ExpandProperty MacAddress).ToLower().Replace("-", ":")
}

# Every call is independently best-effort (own try/catch) - a Worker/network
# hiccup on any one status update must never stop the actual domain-join/
# app-install work still to do.
function Send-JobStatus {
    param([string]$Status, [string]$Log = $null)
    try {
        $body = @{ status = $Status }
        if ($Log) { $body.log = $Log }
        Invoke-RestMethod -Method Patch -Uri "$WorkerBase/api/jobs/by-mac/$(Get-MacAddress)" `
            -ContentType "application/json" -Body ($body | ConvertTo-Json)
    } catch {
        Write-Host "Phone-home ($Status) failed: $($_.Exception.Message)"
    }
}

if (-not (Test-Path $configPath)) {
    Write-Host "No post-action config found - nothing further to do."
    Send-JobStatus -Status "complete" -Log "No post-action config found on this machine."
    exit 0
}
$config = Get-Content $configPath | ConvertFrom-Json
if (-not ($config.PSObject.Properties.Name -contains "nextStepIndex")) {
    $config | Add-Member -NotePropertyName nextStepIndex -NotePropertyValue 0 -Force
}

Send-JobStatus -Status "installing" -Log "Running post-imaging setup on $env:COMPUTERNAME"

# --- Build the GUI -------------------------------------------------------

$form = New-Object System.Windows.Forms.Form
$form.Text = "Finishing setup"
$form.Size = New-Object System.Drawing.Size(560, 480)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Font = $UiFont
$form.TopMost = $true

$headerHeight = Add-HeaderBanner -Form $form -Title "Finishing setup" `
    -Subtitle "$env:COMPUTERNAME$(if ($config.domainJoin) { " - joining $($config.domain)" })" -Width 560

$list = New-Object System.Windows.Forms.ListView
$list.View = "Details"
$list.FullRowSelect = $true
$list.GridLines = $false
$list.HeaderStyle = "None"
$list.Location = New-Object System.Drawing.Point(16, ($headerHeight + 16))
$list.Size = New-Object System.Drawing.Size(528, 320)
$list.Anchor = "Top, Bottom, Left, Right"
[void]$list.Columns.Add("Step", 380)
[void]$list.Columns.Add("Status", 130)
$form.Controls.Add($list)

$labelOverall = New-Object System.Windows.Forms.Label
$labelOverall.Text = "Working..."
$labelOverall.ForeColor = $MutedColor
$labelOverall.Location = New-Object System.Drawing.Point(16, ($headerHeight + 344))
$labelOverall.Size = New-Object System.Drawing.Size(528, 24)
$labelOverall.Anchor = "Bottom, Left, Right"
$form.Controls.Add($labelOverall)

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = "Close"
$btnClose.Location = New-Object System.Drawing.Point(432, ($headerHeight + 372))
$btnClose.Size = New-Object System.Drawing.Size(112, 32)
$btnClose.Anchor = "Bottom, Right"
$btnClose.Enabled = $false
$btnClose.Add_Click({ $form.Close() })
$form.Controls.Add($btnClose)

function New-WorkItemRow([string]$Label) {
    $item = New-Object System.Windows.Forms.ListViewItem($Label)
    [void]$item.SubItems.Add("Pending")
    [void]$list.Items.Add($item)
    return $item
}

function Set-RowStatus($Row, [string]$Text, [System.Drawing.Color]$Color) {
    $Row.SubItems[1].Text = $Text
    $Row.SubItems[1].ForeColor = $Color
    $form.Refresh()
    [System.Windows.Forms.Application]::DoEvents()
}

# --- Build the work list (domain-join, then each task-sequence step) ----

$workItems = @()
if ($config.domainJoin) {
    $workItems += [pscustomobject]@{ Kind = "domain"; Label = "Join domain '$($config.domain)'" }
}
for ($i = 0; $i -lt $config.steps.Count; $i++) {
    $workItems += [pscustomobject]@{ Kind = "step"; Label = $config.steps[$i].label; Step = $config.steps[$i]; StepIndex = $i }
}
$rows = $workItems | ForEach-Object { New-WorkItemRow -Label $_.Label }

$form.Show()
[System.Windows.Forms.Application]::DoEvents()

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
            throw "Unknown built-in action '$ActionId'."
        }
    }
}

function Save-PostActionConfig {
    $config | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath
}

$anyFailed = $false

for ($i = 0; $i -lt $workItems.Count; $i++) {
    $item = $workItems[$i]
    $row = $rows[$i]

    if ($item.Kind -eq "domain") {
        if ((Get-CimInstance -ClassName Win32_ComputerSystem).PartOfDomain) {
            Set-RowStatus -Row $row -Text "Already joined" -Color $OkColor
            continue
        }
        if (-not $config.domainUsername -or -not $config.domainPassword) {
            # Credentials were already scrubbed by an earlier attempt (see
            # below) and the join still didn't take - no retry path here,
            # matching this script's original design; needs a technician.
            Set-RowStatus -Row $row -Text "Failed" -Color $WarningColor
            $anyFailed = $true
            continue
        }
        Set-RowStatus -Row $row -Text "Joining..." -Color $MutedColor
        $securePassword = ConvertTo-SecureString $config.domainPassword -AsPlainText -Force
        $cred = New-Object System.Management.Automation.PSCredential($config.domainUsername, $securePassword)

        # Scrub the credential from disk before attempting the join, not
        # after - whether it succeeds or fails, there's no reason for the
        # plaintext password to linger any longer than this.
        $config.domainUsername = $null
        $config.domainPassword = $null
        Save-PostActionConfig

        try {
            # -Restart reboots almost immediately on success - execution
            # (and this GUI) ends right here; the RunOnce entry (deferred-
            # delete "!" prefix) re-launches this same script at the next
            # logon, where the PartOfDomain check above short-circuits
            # straight past this step.
            Add-Computer -DomainName $config.domain -Credential $cred -Force -Restart
        } catch {
            Set-RowStatus -Row $row -Text "Failed" -Color $WarningColor
            $anyFailed = $true
            Add-Type -AssemblyName Microsoft.VisualBasic
            [Microsoft.VisualBasic.Interaction]::MsgBox(
                "Domain join failed: $($_.Exception.Message)", "OKOnly,SystemModal", "Domain Join"
            )
        }
        continue
    }

    # A "step" item - resume support: skip anything already completed in a
    # prior invocation of this script (tracked via nextStepIndex).
    if ($item.StepIndex -lt $config.nextStepIndex) {
        Set-RowStatus -Row $row -Text "Already done" -Color $OkColor
        continue
    }

    Set-RowStatus -Row $row -Text "Running..." -Color $MutedColor
    try {
        $step = $item.Step
        if ($step.kind -eq "builtin") {
            Invoke-BuiltinAction -ActionId $step.actionId
        } elseif ($step.appUrl) {
            $ext = switch ($step.installKind) { "msi" { "msi" } "script" { "ps1" } default { "exe" } }
            $dest = Join-Path $env:TEMP ("step-" + [guid]::NewGuid().ToString("N") + "." + $ext)
            Invoke-WebRequest -Uri $step.appUrl -OutFile $dest
            switch ($step.installKind) {
                "msi" { Start-Process msiexec.exe -ArgumentList "/i `"$dest`" /quiet /norestart" -Wait }
                "exe" { Start-Process $dest -ArgumentList "/quiet /norestart" -Wait }
                "script" { powershell.exe -NoProfile -ExecutionPolicy Bypass -File $dest }
                default { throw "Unknown install kind '$($step.installKind)'." }
            }
        }
        Set-RowStatus -Row $row -Text "Done" -Color $OkColor
    } catch {
        Set-RowStatus -Row $row -Text "Failed" -Color $WarningColor
        $anyFailed = $true
        Write-Host "Step '$($item.Label)' failed: $($_.Exception.Message)"
    }

    # Advance past this step regardless of outcome - a failed step is
    # never retried on a later resume, matching the domain-join step above.
    $config.nextStepIndex = $item.StepIndex + 1
    Save-PostActionConfig
}

if ($anyFailed) {
    $labelOverall.Text = "Finished with errors - see above."
    $labelOverall.ForeColor = $WarningColor
    Send-JobStatus -Status "failed" -Log "PostAction finished with one or more failed steps on $env:COMPUTERNAME - see the machine for details."
} else {
    $labelOverall.Text = "All done - this machine is ready."
    $labelOverall.ForeColor = $OkColor
    Send-JobStatus -Status "complete" -Log "PostAction finished successfully on $env:COMPUTERNAME"
}
$btnClose.Enabled = $true

# Auto-close only on full success, and only after giving the technician a
# moment to actually see the "all done" state - a failure always waits for
# a manual Close so it can't be missed. Kept on this same synchronous
# DoEvents-pumping pattern (no Application.Run/Timer) - a background
# thread or timer callback touching these same WinForms controls is
# exactly the class of bug this codebase already hit and fixed elsewhere.
$autoCloseAt = if (-not $anyFailed) { (Get-Date).AddSeconds(8) } else { $null }
while ($form.Visible) {
    Start-Sleep -Milliseconds 150
    [System.Windows.Forms.Application]::DoEvents()
    if ($autoCloseAt -and (Get-Date) -ge $autoCloseAt) {
        $form.Close()
    }
}
