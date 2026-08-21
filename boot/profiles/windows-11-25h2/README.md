# Windows 11 25H2 (Pro / Education)

Windows install media is not redistributable, so this repo only ships
`autounattend.xml` templates. Pro and Education share one WIM — only the
per-edition `autounattend.xml` differs, by WIM image index. Both editions'
first-logon step runs the generalized `../winpe/PostAction.ps1`
(non-interactive domain join, then the task sequence's app/customization
steps in order), not a per-edition script — see `../winpe/README.md`.

The deployment path is the WinPE flow in `../winpe/`, which downloads
`install.wim` directly over HTTPS from within a full PowerShell
environment.

To use these profiles:

1. Mount your own licensed Windows 11 25H2 ISO.
2. Trim `install.wim` down to just the Pro and Education indices before
   uploading anything — stock media ships every edition (Home, Pro,
   Education, ...) in one multi-GB WIM, which burns through R2's 10GB free
   storage tier fast for no benefit:
   ```
   dism /Get-WimInfo /WimFile:install.wim
   ```
   Note the index numbers for Pro and Education (they vary by ISO — do not
   assume 1/2). Export just those two into a smaller combined WIM:
   ```
   dism /Export-Image /SourceImageFile:install.wim /SourceIndex:<PRO_INDEX> ^
        /DestinationImageFile:install-trimmed.wim /Compress:max
   dism /Export-Image /SourceImageFile:install.wim /SourceIndex:<EDU_INDEX> ^
        /DestinationImageFile:install-trimmed.wim /Compress:max
   ```
   Then update the `<Value>` under `/IMAGE/INDEX` in each profile's
   `autounattend.xml` to match the **new** indices inside
   `install-trimmed.wim` (exporting into the same destination file appends,
   so index 1 = first export, 2 = second — verify with `dism /Get-WimInfo
   /WimFile:install-trimmed.wim` rather than assuming).
3. Upload `install-trimmed.wim` into R2 as
   `windows-11-25h2/sources/install.wim` (matching
   `worker/src/lib/profiles.ts`'s `installWim` field) — the WinPE flow
   (`../winpe/`) fetches this directly over HTTPS, no network share needed.
4. Upload `../windows-11-25h2-pro/autounattend.xml` and
   `../windows-11-25h2-edu/autounattend.xml` to their matching R2 keys.
   Both point at `https://api.osd.xcet.uk` for phone-home and fetching
   `winpe/PostAction.ps1` — update those URLs first if your Worker's
   domain differs.

## Post-imaging action

Both editions' `FirstLogonCommands` fetch and run the generalized
`../winpe/PostAction.ps1` — see that directory's `README.md` and
`PostAction.ps1` itself for the domain-join and task-sequence-step logic.
