# WinPE deployment image (replaces MDT)

This is the primary recommended deployment path for Windows machines with
Secure Boot enabled — it replaces MDT's Lite Touch wizard with a small
PowerShell script, and never puts an unsigned binary in the boot chain, so
it doesn't hit the Secure Boot problems the iPXE-based paths
(`../proxy-dhcp/`) ran into.

Build the image **once**. It can then be delivered either via WDS (network
boot) or a bootable USB stick — same image, no difference to what runs
inside it.

## Build the image (Windows machine with the free Windows ADK + WinPE add-on)

```powershell
# From an elevated "Deployment and Imaging Tools Environment" prompt:
copype amd64 C:\WinPE_amd64

# Mount the boot image to inject our script:
Dism /Mount-Image /ImageFile:C:\WinPE_amd64\media\sources\boot.wim /index:1 /MountDir:C:\WinPE_amd64\mount

# Copy in the deploy script:
Copy-Item Deploy.ps1 C:\WinPE_amd64\mount\Windows\System32\Deploy.ps1

# Point startnet.cmd at it (runs after wpeinit brings up networking):
Add-Content C:\WinPE_amd64\mount\Windows\System32\startnet.cmd `
    "powershell -NoProfile -ExecutionPolicy Bypass -File X:\Windows\System32\Deploy.ps1"

Dism /Unmount-Image /MountDir:C:\WinPE_amd64\mount /Commit
```

`Deploy.ps1` needs internet access from within WinPE (to reach
`api.osd.xcet.uk`) — WinPE's default network drivers cover most common
NICs; if a target machine's NIC isn't recognized, inject its driver into
the mounted image before unmounting (`Dism /Add-Driver`).

If `Deploy.ps1` errors or exits, WinPE drops back to a command prompt (from
`startnet.cmd` completing) — re-run it manually with the same
`powershell -File ...` command to retry.

## Deliver it — pick one (or both)

### Via WDS

Add `C:\WinPE_amd64\media\sources\boot.wim` as a normal **Boot Image**
through the WDS console's standard "Add Boot Image" wizard — this is a
real WIM-based boot image, so the wizard that was the wrong tool for the
earlier raw-`ipxe.efi` attempt is exactly right here. Set it as the default
boot image for network boot, or leave multiple boot images available and
let the F12 menu choose. No NBP/`BootProgram`/`N12BootProgram` changes are
needed for this — if those were changed during earlier troubleshooting,
revert them to WDS's defaults.

### Via bootable USB

```powershell
MakeWinPEMedia /UFD C:\WinPE_amd64 F:
```

(where `F:` is the USB drive letter). No WDS, no DHCP/PXE configuration,
no network-boot infrastructure at all — plug it in, boot from it, same
`Deploy.ps1` runs. Good for sites or one-off machines where standing up
network boot isn't worth it.

## What's still R2-hosted

Same bucket, same upload script as everything else in this repo:

- `windows-11-25h2/sources/install.wim` — the actual Windows image, see
  `../profiles/windows-11-25h2/README.md` for trimming it to size and
  finding the right `imageIndex` per edition.
- `windows-11-25h2-{pro,edu}/autounattend.xml` — now generalized to work
  for all three post-imaging actions (see that directory's own notes).
- `winpe/PostAction.ps1` — upload the copy in this directory:
  ```bash
  scripts/upload-image.sh ./boot/winpe/PostAction.ps1 winpe/PostAction.ps1
  ```
- Any app/script installers for the `install-app` post-action — upload and
  add an entry to `worker/src/lib/apps.ts`.

`Deploy.ps1` itself lives *inside* the built WinPE image (copied in above),
not in R2 — it's what fetches everything else once the machine is running.
