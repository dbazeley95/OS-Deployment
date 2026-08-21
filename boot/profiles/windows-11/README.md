# Windows 11 profile

Windows install media is not redistributable, so this repo only ships the
`autounattend.xml` template. To use this profile:

1. Mount your own licensed Windows 11 ISO.
2. Trim `install.wim` down to the single edition you actually deploy before
   uploading anything — stock media ships every edition (Home, Pro, Education,
   ...) in one multi-GB WIM, which burns through R2's 10GB free storage tier
   fast for no benefit:
   ```
   dism /Get-WimInfo /WimFile:install.wim                     # find the index for your edition
   dism /Export-Image /SourceImageFile:install.wim /SourceIndex:<N> \
        /DestinationImageFile:install-trimmed.wim /Compress:max
   ```
   This typically cuts a ~5GB multi-edition `install.wim` down to ~3-4GB.
3. Upload these into R2 under the `windows-11/` prefix (matching
   `worker/src/lib/profiles.ts`):
   - `windows-11/boot/bootx64.efi` (from `\efi\microsoft\boot\` on the ISO)
   - `windows-11/boot/boot.sdi` (from `\sources\` on the ISO)
   - the rest of `\sources\`, using your trimmed `install-trimmed.wim` in
     place of `install.wim` — Windows Setup will pull these over the network
     once `bootx64.efi` boots; you'll need a network-accessible `sources`
     share (SMB or an HTTP proxy inside the WinPE environment) since stock
     Windows Setup does not fetch `install.wim` over plain HTTPS the way
     `boot.wim`/`boot.sdi` are fetched here. A common approach is `wimboot` or
     exposing the share via `net use` in a WinPE startnet.cmd — out of scope
     for this starter.
4. Fill in `REPLACE_WORKER_ORIGIN` in `autounattend.xml` and upload it to
   `windows-11/autounattend.xml`.

Windows netboot is the least "just works out of the box" part of this
architecture, since it needs a WinPE-side network share rather than a plain
HTTPS fetch for the multi-GB `install.wim` — budget time for that step.
