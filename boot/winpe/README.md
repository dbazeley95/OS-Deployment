# WinPE deployment image (replaces MDT)

This is the primary recommended deployment path for Windows machines with
Secure Boot enabled — it replaces MDT's Lite Touch wizard with a real
Windows Forms GUI (`DeployGui.ps1`, not VBScript/HTA), and never puts an
unsigned binary in the boot chain, so it doesn't hit the Secure Boot
problems the iPXE-based paths (`../proxy-dhcp/`) ran into.

Build the image **once**. It can then be delivered either via WDS (network
boot) or a bootable USB stick — same image, no difference to what runs
inside it. The GUI script itself is **not** baked into the image — the
image downloads it fresh from the Worker/R2 on every boot (see "What's
still R2-hosted" below), so GUI or deployment-logic changes go live on the
next boot with no image rebuild. What *is* baked in is the .NET runtime
WinPE needs to run a Forms GUI at all — that only changes if you're
updating the ADK/WinPE version itself.

## What the GUI asks for

`DeployGui.ps1` mirrors MDT Lite Touch's flow: sign in, enter a
**hostname**, decide **join a domain or not** (and if so, the domain name
plus admin credentials, right there in the wizard - no first-logon
prompt), then pick a **task sequence** - a cloud-editable bundle of one OS
profile plus an ordered list of apps/customizations to install
(`worker/src/lib/taskSequences.ts`, managed from the admin UI's "Task
sequences" section). This is the "modern Deployment Workbench" piece:
adding a Windows edition, an app, or a new bundle of both is a form
submission, not a code change + redeploy.

The admin UI has no scheduling step - every job starts here, on the
machine. The one prompt this wizard skips is on a **retry**: if this same
MAC already has a booted, incomplete job, the hostname/task-sequence
prompts are skipped (shown read-only, pre-filled) in favor of what was
already decided - but the domain-join section is **always** shown fresh,
retry or not. That's deliberate: domain admin credentials are never sent
to the Worker at all.
`DeployGui.ps1` collects them locally and writes them straight into
`post-action.json` on the target disk; only the domain *name* (not the
username/password) is recorded on the job, for audit. `PostAction.ps1`
then joins non-interactively at first logon using those local credentials,
and scrubs them from the file immediately after attempting the join.

The hostname gets recorded on the device (`devices.hostname` in D1) and
substituted into the answer file's `<ComputerName>` placeholder before
it's written to disk - see `boot/profiles/*/autounattend.xml`.

## Build the image (Windows machine with the free Windows ADK + WinPE add-on)

```powershell
# From an elevated "Deployment and Imaging Tools Environment" prompt:
copype amd64 C:\WinPE_amd64

# Mount the boot image once, to both add the optional components a Forms
# GUI needs and point startnet.cmd at the fetch-fresh bootstrap:
Dism /Mount-Image /ImageFile:C:\WinPE_amd64\media\sources\boot.wim /index:1 /MountDir:C:\WinPE_amd64\mount

# Add-Package in this order - each depends on the ones before it. Paths are
# under the ADK's WinPE OCs folder, e.g.
# "C:\Program Files (x86)\Windows Kits\10\Assessment and Deployment Kit\Windows Preinstallation Environment\amd64\WinPE_OCs\".
$ocs = "C:\Program Files (x86)\Windows Kits\10\Assessment and Deployment Kit\Windows Preinstallation Environment\amd64\WinPE_OCs"
foreach ($pkg in "WinPE-WMI", "WinPE-NetFx", "WinPE-Scripting", "WinPE-PowerShell", "WinPE-StorageWMI", "WinPE-DismCmdlets") {
    Dism /Image:C:\WinPE_amd64\mount /Add-Package /PackagePath:"$ocs\$pkg.cab"
    Dism /Image:C:\WinPE_amd64\mount /Add-Package /PackagePath:"$ocs\en-us\$pkg`_en-us.cab"
}

# startnet.cmd already calls wpeinit by default, which brings up networking
# before this line runs - just append the fetch-fresh bootstrap after it:
Add-Content C:\WinPE_amd64\mount\Windows\System32\startnet.cmd `
    "powershell -NoProfile -Command ""iwr https://api.osd.xcet.uk/images/winpe/DeployGui.ps1 -OutFile X:\DeployGui.ps1; & X:\DeployGui.ps1"""

Dism /Unmount-Image /MountDir:C:\WinPE_amd64\mount /Commit
```

`WinPE-NetFx` is what pulls in the .NET Framework `DeployGui.ps1` needs for
`System.Windows.Forms` — without it, the GUI script will fail to load with
an assembly-not-found error.

`DeployGui.ps1` needs internet access from within WinPE (to reach
`api.osd.xcet.uk`) — WinPE's default network drivers cover most common
NICs; if a target machine's NIC isn't recognized, inject its driver into
the mounted image before unmounting (`Dism /Add-Driver`).

If the GUI errors or is closed, WinPE drops back to a command prompt (from
`startnet.cmd` completing) — re-run it manually with the same
`iwr ...; & X:\DeployGui.ps1` command to retry, which also picks up any
script update pushed since the machine booted.

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
GUI runs. Good for sites or one-off machines where standing up network
boot isn't worth it.

## What's still R2-hosted

Same bucket, same upload script as everything else in this repo:

- `windows-11-25h2/sources/install.wim` — the actual Windows image, see
  `../profiles/windows-11-25h2/README.md` for trimming it to size and
  finding the right `imageIndex` per edition.
- `windows-11-25h2-{pro,edu}/autounattend.xml` — generalized to work
  regardless of domain-join choice or task sequence (see that directory's
  own notes).
- `winpe/DeployGui.ps1` — **this is the script that actually runs at boot
  time**, fetched fresh every time (not baked into the image). Editing it
  and pushing to `main` is enough — `.github/workflows/sync-winpe-scripts.yml`
  uploads everything under `boot/winpe/*.ps1` to R2 automatically on every
  push that touches this directory. No manual `scripts/upload-image.sh`
  step needed for this one file.
- `winpe/PostAction.ps1` — same auto-sync as above.
- Any app/script installers usable as task sequence steps — upload with
  `scripts/upload-image.sh` and add an entry via the admin UI's "Apps"
  section (or `POST /api/catalog/apps`), then reference it from a task
  sequence's step list, see the root `README.md`.

## The catalog is now cloud-editable

OS profiles, apps, and task sequences used to be static entries in
`worker/src/lib/profiles.ts`/`apps.ts` (task sequences didn't exist as a
concept at all). They're now rows in D1, managed from the admin UI's "OS
profiles", "Apps", and "Task sequences" sections (backed by
`/api/catalog/*`, behind the same technician login as the rest of the
admin UI) — adding a Windows edition, an app, or a new bundle of both is a
form submission, not a code change + redeploy. `DeployGui.ps1` always
shows whatever's currently in that catalog, since it calls the same
`/api/deploy/auth` endpoint the catalog editor's data flows through.
