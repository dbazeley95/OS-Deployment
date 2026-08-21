# Windows 11 25H2 (Pro / Education)

Windows install media is not redistributable, so this repo only ships
`autounattend.xml` templates and the shared `domain-join.ps1`. Pro and
Education share one set of boot media (kernel, initrd, WIM) — only the
per-edition `autounattend.xml` differs, by WIM image index. To use these
profiles:

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
   - `windows-11-25h2/boot/bootx64.efi` (from `\efi\microsoft\boot\` on the ISO)
   - `windows-11-25h2/boot/boot.sdi` (from `\sources\` on the ISO)
   - the rest of `\sources\`, using your `install-trimmed.wim` in place of
     `install.wim` — Windows Setup pulls these over the network once
     `bootx64.efi` boots; you'll need a network-accessible `sources` share
     (SMB, or an HTTP proxy inside the WinPE environment) since stock
     Windows Setup does not fetch `install.wim` over plain HTTPS the way
     `boot.wim`/`boot.sdi` are fetched here. A common approach is `wimboot`
     or exposing the share via `net use` in a WinPE `startnet.cmd` — out of
     scope for this starter.
   - `windows-11-25h2/domain-join.ps1` (the script in this directory,
     uploaded as-is)
4. Upload `../windows-11-25h2-pro/autounattend.xml` and
   `../windows-11-25h2-edu/autounattend.xml` to their matching R2 keys.
   Both already point at `https://api.osd.xcet.uk` for phone-home and the
   domain-join script — update those URLs first if your Worker's domain
   differs.

## Domain join

`domain-join.ps1` runs at first logon (technician's interactive session, so
GUI prompts are visible) and asks whether to join the domain; if yes, it
prompts for the domain name and credentials and runs `Add-Computer` live
against on-prem AD. It assumes AD is reachable from the machine at that
point — if that's not always true in your environment, switch to an offline
domain join (`djoin /provision` ahead of time, `djoin /requestodj` during
setup) instead.

Windows netboot is the least "just works out of the box" part of this
architecture, since it needs a WinPE-side network share rather than a plain
HTTPS fetch for the multi-GB `install.wim` — budget time for that step.
