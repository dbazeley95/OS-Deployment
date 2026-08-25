# Windows 11 25H2 (Pro / Education)

Windows install media is not redistributable, so this repo only ships
`autounattend.xml` templates. Pro and Education share one WIM — only the
per-edition `autounattend.xml` differs, by WIM image index. Both editions'
first logon queues the generalized `../winpe/PostAction.ps1` (via a
RunOnce registry entry, not a direct `FirstLogonCommands` invocation - see
"Post-imaging action" below) to run once the desktop is reached: it shows
a small status GUI while it does the non-interactive domain join, then the
task sequence's app/customization steps in order. Not a per-edition
script — see `../winpe/README.md`.

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

Both editions' `FirstLogonCommands` only fetch `../winpe/PostAction.ps1`
and queue it via a `HKLM\...\RunOnce` registry entry - they don't run it
directly. This is deliberate, not just a style choice: current Windows no
longer guarantees `FirstLogonCommands` entries run in the order their
`<Order>` element implies (commands now all start "at the same time" per
Microsoft's own docs), so anything that has to happen strictly after
imaging - and that should show a GUI, which needs the desktop to actually
be there first - can't safely live in `FirstLogonCommands` itself. RunOnce
fires once, right as the first interactive desktop session starts. See
that directory's `README.md` and `PostAction.ps1` itself for the domain-
join/task-sequence-step logic, the status GUI, and how it resumes cleanly
across the domain-join reboot.
