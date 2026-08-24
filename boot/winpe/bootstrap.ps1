# Fetch-and-verify wrapper for DeployGui.ps1 - startnet.cmd's one-liner
# (see README.md) fetches and runs THIS file instead of DeployGui.ps1
# directly, so the actual fetch + SHA256-verify logic lives in a real,
# readable, version-controlled script instead of a hand-escaped one-liner
# embedded in startnet.cmd.
#
# The SHA256 companion this checks against is same-origin (computed and
# uploaded to R2 alongside DeployGui.ps1 by
# .github/workflows/sync-winpe-scripts.yml) - it guards against a
# corrupted or truncated download (a real WinPE network-boot failure
# mode), not deliberate tampering: anyone who could alter DeployGui.ps1
# in R2 could alter the hash file sitting next to it too. See README.md
# for the stronger Authenticode-signing alternative if that's ever needed.
#
# This file is intentionally not itself hash-verified before running -
# checking a script's own integrity from within itself is circular (a
# tampered copy would just skip the check), and it's small enough that a
# genuinely corrupted download would very likely fail to parse at all.

$scriptUrl = "https://api.osd.xcet.uk/images/winpe/DeployGui.ps1"
$dest = "X:\DeployGui.ps1"

Invoke-WebRequest -Uri $scriptUrl -OutFile $dest
$expected = (Invoke-WebRequest -Uri "$scriptUrl.sha256" -UseBasicParsing).Content.Trim()
$actual = (Get-FileHash -Path $dest -Algorithm SHA256).Hash

if ($actual -ine $expected) {
    Write-Host "DeployGui.ps1 failed its SHA256 check - expected $expected, got $actual."
    Write-Host "The download may be corrupted or incomplete. Re-run this script to retry."
    pause
    exit 1
}

& $dest
