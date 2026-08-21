# Runs from a stock, Microsoft-signed WinPE image (built per README.md in
# this directory) in place of MDT's Lite Touch wizard. Talks to the
# existing os-deployment Worker exactly like the iPXE boot menu does, just
# over a plain JSON API instead of iPXE's Basic-Auth-on-401 + menu script,
# since a WinPE script doesn't get that for free.
#
# This is a starting point, not a complete unattended tool - it assumes a
# single target disk (disk 0) and wipes it entirely. Adjust the diskpart
# script below for dual-disk machines, existing data-preservation needs,
# etc. before relying on it against real hardware.
#
# Set this to your Worker's URL if it ever differs from the deployed one.
$WorkerBase = "https://api.osd.xcet.uk"

function Get-MacAddress {
    (Get-NetAdapter | Where-Object Status -eq "Up" | Select-Object -First 1 -ExpandProperty MacAddress).ToLower().Replace("-", ":")
}

function Invoke-DeployApi {
    param([string]$Path, [hashtable]$Body)
    Invoke-RestMethod -Method Post -Uri "$WorkerBase$Path" -ContentType "application/json" -Body ($Body | ConvertTo-Json)
}

$mac = Get-MacAddress
Write-Host "Device MAC: $mac"

$username = Read-Host "Technician username"
$securePassword = Read-Host "Technician password" -AsSecureString
$password = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
)

$auth = Invoke-DeployApi -Path "/api/deploy/auth" -Body @{ mac = $mac; username = $username; password = $password }

switch ($auth.status) {
    "ready" {
        $deployment = $auth
    }
    "choose-action" {
        Write-Host "Profile already assigned: $($auth.profile)"
        $postAction = Read-Host "Post-install action [domain-join / install-app / autopilot]"
        $appId = $null
        if ($postAction -eq "install-app") {
            $auth.apps | ForEach-Object { Write-Host "  $($_.id) - $($_.label)" }
            $appId = Read-Host "App id"
        }
        $deployment = Invoke-DeployApi -Path "/api/deploy/select" -Body @{
            mac = $mac; username = $username; password = $password
            profile = $auth.profile; postAction = $postAction; appId = $appId
        }
    }
    "choose" {
        Write-Host "Available profiles:"
        $auth.profiles | ForEach-Object { Write-Host "  $($_.id) - $($_.label)" }
        $profile = Read-Host "Profile id"
        $postAction = Read-Host "Post-install action [domain-join / install-app / autopilot]"
        $appId = $null
        if ($postAction -eq "install-app") {
            $auth.apps | ForEach-Object { Write-Host "  $($_.id) - $($_.label)" }
            $appId = Read-Host "App id"
        }
        $deployment = Invoke-DeployApi -Path "/api/deploy/select" -Body @{
            mac = $mac; username = $username; password = $password
            profile = $profile; postAction = $postAction; appId = $appId
        }
    }
    default {
        throw "Unexpected response from /api/deploy/auth: $($auth | ConvertTo-Json)"
    }
}

Write-Host "Deploying $($deployment.profile) / $($deployment.postAction)..."

# --- Partition and format disk 0 (UEFI/GPT layout) ---
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
diskpart /s "$env:TEMP\diskpart.txt"

# --- Apply the image ---
Write-Host "Downloading install.wim..."
Invoke-WebRequest -Uri $deployment.installWim -OutFile "W:\install.wim"
Write-Host "Applying image (index $($deployment.imageIndex))..."
dism /Apply-Image /ImageFile:"W:\install.wim" /Index:$($deployment.imageIndex) /ApplyDir:"W:\"
Remove-Item "W:\install.wim"

# --- Answer file + post-action config ---
New-Item -ItemType Directory -Force -Path "W:\Windows\Panther" | Out-Null
Invoke-WebRequest -Uri $deployment.answerFileUrl -OutFile "W:\Windows\Panther\unattend.xml"

New-Item -ItemType Directory -Force -Path "W:\Windows\Setup\Scripts" | Out-Null
Invoke-WebRequest -Uri $deployment.postActionScriptUrl -OutFile "W:\Windows\Setup\Scripts\PostAction.ps1"
@{ action = $deployment.postAction; appUrl = $deployment.appUrl } | ConvertTo-Json |
    Set-Content -Path "W:\Windows\Setup\Scripts\post-action.json"

# --- Boot files ---
bcdboot W:\Windows /s S: /f UEFI

Write-Host "Done. Rebooting..."
wpeutil reboot
