# Driver injection

MDT's classic "Total Control" driver store used `%Make%\%Model%` (or
`%OSVersion%\%Make%\%Model%`) folders that Lite Touch would browse at
deploy time to find the right driver pack for the machine being imaged.
`DeployGui.ps1` does the same thing, against a plain Windows file share
rather than R2 - driver packs are large (typically 200MB-1GB per model)
and this is deliberately **not** stored in R2, to avoid that storage/
egress cost. The share is read using the same domain-join credentials
DeployGui.ps1 already collects in the wizard - no separate prompt, and
(same as the file-share `install.wim` source) it means "Join a domain"
has to be enabled for driver injection to run at all.

Only **Dell** is actually wired up today. HP and Lenovo publish their
own driver-pack catalogs too, and the folder convention below already
has room for them, but the packs themselves are a different, more
involved format to handle automatically (see their sections below) -
"coming soon", not yet built.

## Folder convention

```
<DriversShareRoot>\<Operating System id>\<Manufacturer>\<Model>.cab
```

- **`DriversShareRoot`** - set from the admin UI's **Drivers** tab
  (stored as a D1 setting, not a script constant - see
  `worker/src/lib/settings.ts`), e.g. `\\fileserver\share\Drivers`.
  Leave it blank (the default) to skip driver injection entirely -
  useful before a share exists yet, or if you don't need this at all.
  `DeployGui.ps1` picks up the current value on every deploy, with no
  code change or WinPE image rebuild needed to update it.
- **`Operating System id`** - the exact `id` of the "Operating System"
  entry in the admin UI's catalog (e.g. `windows-11-25h2-pro`) - the
  same value already used for R2 keys, task sequences, etc.
- **`Manufacturer`** - `Dell` for Dell hardware (see below); `HP` and
  `Lenovo` are reserved for when those are built.
- **`Model.cab`** - the driver pack itself, named after exactly what
  `(Get-CimInstance Win32_ComputerSystem).Model` reports **on that
  specific machine** - see "Finding the exact Model string" below.

Example: `\\fileserver\share\Drivers\windows-11-25h2-pro\Dell\Latitude 5540.cab`

If nothing exists at the expected path for a given machine, DeployGui.ps1
logs that and carries on without injecting anything - a missing driver
pack is never treated as a deployment failure. Drivers are injected
**offline**, straight after the WIM is applied and before the boot files
are written - the same point MDT injects them, so boot-critical drivers
(storage controllers, NICs) are already present the first time the new
OS actually starts.

## Finding the exact Model string

Windows/WMI's `Model` string doesn't always match the marketing name on
the box (e.g. a "Latitude 5540" might report `Latitude 5540` exactly, but
some lines report a chassis/board code instead). Don't guess it - on a
reference machine of that exact model, boot into WinPE (or Windows) and
run:

```powershell
(Get-CimInstance Win32_ComputerSystem).Manufacturer
(Get-CimInstance Win32_ComputerSystem).Model
```

Name the `.cab` file after exactly what `Model` prints, in the
`Dell`/`HP`/`Lenovo` subfolder matching `Manufacturer`.

## Dell (supported today)

Dell publishes a public driver-pack catalog for exactly this use case:

- **Dell Driver Pack Catalog**: `https://downloads.dell.com/catalog/DriverPackCatalog.cab`
  - An XML index (inside the CAB) listing every supported model's driver
    pack, keyed by **SystemID** (a 4-character hex code) rather than the
    model name - cross-reference a specific model via Dell's support
    site (`support.dell.com` → your model → Drivers) if you'd rather not
    parse the catalog by hand.
  - Driver packs themselves are plain `.cab` files - no extraction tool
    beyond what's already built into Windows (`expand.exe`), which is
    exactly what `DeployGui.ps1` uses.
- Simplest path if you just need a handful of models: open
  `support.dell.com`, search the model (or service tag of a reference
  unit), go to **Drivers & Downloads**, and download the **driver pack**
  (not individual drivers) for the Windows version you're deploying.
  Rename it to `<Model>.cab` (matching the WMI string above) and drop it
  in `<DriversShareRoot>\<OS id>\Dell\`.

## HP (coming soon)

HP has the most officially-supported tooling of the three: the **HP
Client Management Script Library** (HP CMSL), an HP-maintained
PowerShell module (`Install-Module HPCMSL` from the PowerShell Gallery).
`Get-HPDeviceDetails` resolves a platform ID for a given model, and
`Get-SoftpaqList`/the driver-pack cmdlets pull the matching pack straight
from HP's CDN for a given platform + OS version - no manual catalog
parsing needed.

What's not built yet: HP driver packs ship as self-extracting `.exe`
SoftPaqs rather than plain `.cab` files, so `DeployGui.ps1`'s injection
step (which currently only knows how to `expand.exe` a `.cab`) needs an
extra silent-extraction step (`<softpaq>.exe /s /e /f <folder>`) before
`dism /Add-Driver` can use the result. Until that's added, an `HP`
subfolder under a given OS id is simply ignored.

## Lenovo (coming soon)

Lenovo publishes a public XML catalog: `download.lenovo.com/cdrt/td/catalog.xml`
(the same one their own "Lenovo Update Retriever" tool uses), keyed by
**MTM** (Machine Type Model - the first 4 characters of what
`Win32_ComputerSystem.Model` reports on Lenovo hardware, e.g. `20XW` for
a given ThinkPad). There's no equivalent to HP's official CMSL module for
Lenovo - community MDT/ConfigMgr tooling scrapes this catalog directly.

What's not built yet: same issue as HP - Lenovo packs are self-extracting
`.exe` files (sometimes a full "System Update" package rather than a
clean driver-only pack), needing the same kind of silent-extraction step
before `dism /Add-Driver` can use them. A `Lenovo` subfolder is ignored
until that's added.
