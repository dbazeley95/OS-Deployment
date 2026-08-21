# Windows 11 profile

Windows install media is not redistributable, so this repo only ships the
`autounattend.xml` template. To use this profile:

1. Mount your own licensed Windows 11 ISO.
2. Upload these into R2 under the `windows-11/` prefix (matching
   `worker/src/lib/profiles.ts`):
   - `windows-11/boot/bootx64.efi` (from `\efi\microsoft\boot\` on the ISO)
   - `windows-11/boot/boot.sdi` (from `\sources\` on the ISO)
   - the rest of `\sources\` (at minimum `boot.wim` and `install.wim`) —
     Windows Setup will pull these over the network once `bootx64.efi` boots;
     you'll need a network-accessible `sources` share (SMB or an HTTP proxy
     inside the WinPE environment) since stock Windows Setup does not fetch
     `install.wim` over plain HTTPS the way `boot.wim`/`boot.sdi` are fetched
     here. A common approach is `wimboot` or exposing the share via
     `net use` in a WinPE startnet.cmd — out of scope for this starter.
3. Fill in `REPLACE_WORKER_ORIGIN` in `autounattend.xml` and upload it to
   `windows-11/autounattend.xml`.

Windows netboot is the least "just works out of the box" part of this
architecture — Ubuntu/Debian netboot over HTTP is far more turnkey. If your
deployment is mostly Linux with occasional Windows reimages, consider
keeping Windows on a separate, more traditional imaging tool (MDT/WDS) and
using this system only for Linux.
