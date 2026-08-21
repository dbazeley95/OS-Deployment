# Runs at first logon (see autounattend.xml FirstLogonCommands) in the
# technician's interactive session, so GUI prompts are visible and usable.
# Shared between editions - lives at windows-11-25h2/domain-join.ps1, not
# per-profile, since the question is the same regardless of edition.

Add-Type -AssemblyName Microsoft.VisualBasic

$answer = [Microsoft.VisualBasic.Interaction]::InputBox(
    "Join this machine to the domain now? (y/n)", "Domain Join", "y"
)

if ($answer -match '^(y|yes)$') {
    $domain = [Microsoft.VisualBasic.Interaction]::InputBox(
        "Domain name (e.g. corp.example.com)", "Domain Join", ""
    )
    if ([string]::IsNullOrWhiteSpace($domain)) {
        Write-Host "No domain entered - skipping domain join."
        exit 0
    }
    $cred = Get-Credential -Message "Enter credentials authorized to join $domain"
    try {
        Add-Computer -DomainName $domain -Credential $cred -Force -Restart
    } catch {
        [Microsoft.VisualBasic.Interaction]::MsgBox(
            "Domain join failed: $($_.Exception.Message)", "OKOnly,SystemModal", "Domain Join"
        )
    }
} else {
    Write-Host "Domain join skipped."
}
