# Windows 11 25H2 (Pro / Education)

Windows install media is not redistributable, so this repo only ships
`autounattend.xml` templates. Pro and Education share one set of boot media
(kernel, initrd, WIM) — only the per-edition `autounattend.xml` differs, by
WIM image index. Both editions' first-logon step now runs the generalized
`../winpe/PostAction.ps1` (non-interactive domain join, then the task
sequence's app/customization steps in order), not a per-edition script —
see `../winpe/README.md`.

The **primary deployment path is now the WinPE flow** in `../winpe/`, which
downloads `install.wim` directly over HTTPS from within a full PowerShell
environment — the "network-accessible sources share" caveat below only
applies if you're using the older iPXE + native-Windows-Setup path
instead (`../proxy-dhcp/`).

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
3. Upload these into R2 under the `windows-11-25h2/` prefix (matching
   `worker/src/lib/profiles.ts`):
   - `windows-11-25h2/sources/install.wim` — your `install-trimmed.wim`,
     renamed. The WinPE flow (`../winpe/`) fetches this directly over
     HTTPS via `worker/src/lib/profiles.ts`'s `installWim` field, no share
     needed. Only the older iPXE path additionally needs
     `windows-11-25h2/boot/bootx64.efi` and `windows-11-25h2/boot/boot.sdi`
     (from `\efi\microsoft\boot\` and `\sources\` on the ISO) plus a
     network-accessible `sources` share for the rest of `\sources\`, since
     native Windows Setup — unlike our own WinPE script — doesn't fetch
     `install.wim` over plain HTTPS itself. A common approach there is
     `wimboot` or exposing the share via `net use` in a WinPE
     `startnet.cmd` — out of scope for this starter, and unnecessary if
     you're only using the WinPE path.
4. Upload `../windows-11-25h2-pro/autounattend.xml` and
   `../windows-11-25h2-edu/autounattend.xml` to their matching R2 keys.
   Both point at `https://api.osd.xcet.uk` for phone-home and fetching
   `winpe/PostAction.ps1` — update those URLs first if your Worker's
   domain differs.

## Post-imaging action

Both editions' `FirstLogonCommands` fetch and run the generalized
`../winpe/PostAction.ps1` — see that directory's `README.md` and
`PostAction.ps1` itself for the domain-join and task-sequence-step logic.
If a job's domain-join/task-sequence choice wasn't already made (e.g. this
profile is reached via the older iPXE path, which has no wizard to convey
one), it defaults to no domain-join and no steps — a plain, unconfigured
Windows install.
