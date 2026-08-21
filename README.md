# OS Deployment

A web-based OS reinstall system: GitHub hosts the code and CI/CD, Cloudflare
hosts the admin UI, API, and OS images, and a small on-prem piece bridges
the gap that cloud services can't cross (getting a bare-metal machine
bootable).

Currently deploys **Windows only** — the design is OS-agnostic (adding a
profile is one entry in `worker/src/lib/profiles.ts` plus an answer file
under `boot/profiles/`), but Windows is the one wired up end to end.

**Primary path: a signed WinPE image running a Windows Forms GUI**
(`boot/winpe/DeployGui.ps1`), delivered via WDS or a bootable USB stick —
no custom unsigned binary in the boot chain, so it works cleanly under
UEFI Secure Boot, and it's what replaces MDT's Lite Touch wizard with an
equivalent flow: sign in, enter a hostname, decide domain-join or not (and
if so, the domain plus admin credentials, right there in the wizard), then
pick a **task sequence** - a cloud-editable bundle of one OS profile plus
an ordered list of apps/customizations. The GUI script is fetched fresh
from R2 on every boot rather than baked into the image, and the whole
catalog (OS profiles, apps, task sequences) is managed from the admin UI
(a "cloud Deployment Workbench") instead of a code change + redeploy. An
older iPXE-based path (`boot/proxy-dhcp/`, `boot/profiles/`) is also
documented as an alternative, but it depends on a custom-built `ipxe.efi`
that Secure Boot will reject unless disabled.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design and a sequence
diagram of a deployment end to end.

## Layout

- `worker/` — Cloudflare Worker: `/api/auth/*` (technician login for the
  admin UI), `/api/catalog/*` (OS profile/app/task-sequence catalog CRUD,
  the cloud editor), REST API (devices/jobs), `/api/deploy/*` (JSON API the
  WinPE `DeployGui.ps1` GUI calls), `/boot/:mac` (the older iPXE-facing
  route, generates a per-machine iPXE script from D1 job state), and
  `/images/*`, which streams WIMs/answer files/scripts out of R2.
- `frontend/` — Cloudflare Pages: admin UI, gated behind a technician
  login — register devices, pick a task sequence, queue a reinstall,
  watch job status (including domain-join and which technician triggered
  it), and manage the OS profile/app/task-sequence catalog.
- `boot/winpe/` — the primary deployment path: build instructions for the
  signed WinPE image, `DeployGui.ps1` (the Forms GUI, fetched fresh from
  R2 on every boot - not baked into the image), `PostAction.ps1` (runs at
  first logon).
- `boot/proxy-dhcp/`, `boot/profiles/` — the older iPXE-based path and the
  Windows unattend answer files (shared by both paths).
- `scripts/upload-image.sh` — pushes a local boot file/WIM/script into the
  R2 images bucket. (`boot/winpe/*.ps1` is the exception — synced to R2
  automatically on push, see `.github/workflows/sync-winpe-scripts.yml`.)

## Setup

### 1. Cloudflare resources

```bash
cd worker
npm install
npx wrangler d1 create os-deployment       # paste the returned database_id into wrangler.toml
npx wrangler r2 bucket create os-deployment-images
npm run db:migrate:remote
```

### 2. Local dev

```bash
# Worker (http://localhost:8787)
cd worker && npm install && npm run dev

# Frontend (http://localhost:5173)
cd frontend && npm install
VITE_API_BASE=http://localhost:8787 npm run dev
```

### 3. Upload the Windows image

See `boot/profiles/windows-11-25h2/README.md` for the full walkthrough
(trimming `install.wim` to the Pro + Education indices), then push the
essentials to R2:

```bash
scripts/upload-image.sh ./install-trimmed.wim windows-11-25h2/sources/install.wim
scripts/upload-image.sh ./boot/profiles/windows-11-25h2-pro/autounattend.xml windows-11-25h2-pro/autounattend.xml
scripts/upload-image.sh ./boot/profiles/windows-11-25h2-edu/autounattend.xml windows-11-25h2-edu/autounattend.xml
```

(`boot/winpe/DeployGui.ps1` and `PostAction.ps1` don't need a manual
upload — pushing to `main` syncs them to R2 automatically, see
`.github/workflows/sync-winpe-scripts.yml`.)

Only needed if you're also using the older iPXE path (`boot/proxy-dhcp/`):

```bash
scripts/upload-image.sh ./boot/bootx64.efi windows-11-25h2/boot/bootx64.efi
scripts/upload-image.sh ./boot/boot.sdi windows-11-25h2/boot/boot.sdi
```

The two profiles above are seeded by migration `0004_catalog.sql`. For a
new edition or app, upload the installer/script with
`scripts/upload-image.sh` and add a matching entry from the admin UI's "OS
profiles"/"Apps" sections — no code change or redeploy needed. Then bundle
them into a task sequence from the "Task sequences" section (an OS profile
plus an ordered list of apps) - that's what the WinPE wizard actually
offers technicians. Migration `0006_task_sequences.sql`/
`0007_job_task_sequence.sql` add this on top of the catalog tables.

### 3b. Provision technicians

`/boot/:mac` (Basic Auth), `/api/deploy/*` (credentials in the request
body), and now `/api/auth/login` (the admin UI itself) all check against
the same `technicians` D1 table — there's no self-service signup on
purpose. Compute a salted, peppered hash and print the SQL to insert it:

```bash
PASSWORD_PEPPER=<same value as the WORKER_PASSWORD_PEPPER GitHub secret> \
  node scripts/add-technician.mjs <username> <password>
# then run the SQL it prints, e.g.:
npx wrangler d1 execute os-deployment --remote --command "<printed SQL>"
```

### 4. Deploy

Push to `main` and GitHub Actions deploys the Worker and Pages site (see
`.github/workflows/`). Set repo secrets `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, and `WORKER_PASSWORD_PEPPER` (any long random
string — CI sets it as the Worker's `PASSWORD_PEPPER` secret on every
deploy), and repo variable `WORKER_API_BASE` (your deployed Worker's URL)
for the Pages build to point at the right API.

### 5. Custom domains

Live at **osd.xcet.uk** (admin UI) and **api.osd.xcet.uk** (Worker API), on a
zone already hosted on Cloudflare:

- **Worker**: handled entirely by `worker/wrangler.toml`'s `[[routes]]` entry
  (`custom_domain = true`) — Cloudflare provisions the DNS record and TLS
  cert automatically on the next `wrangler deploy`, no dashboard step needed.
- **Pages**: has no equivalent config-file option. One-time manual step:
  Cloudflare dashboard → Workers & Pages → `os-deployment` project → **Custom
  domains** → add `osd.xcet.uk`.
- Once the Worker's custom domain is live, set the `WORKER_API_BASE` repo
  variable to `https://api.osd.xcet.uk` and re-run the Pages deploy so the
  admin UI is built pointing at it.

### 6. Build and deliver the WinPE image

See `boot/winpe/README.md` — build the signed WinPE image once, deliver it
via WDS (network boot) or a bootable USB stick. This is the one piece that
has to happen on your own machine/network rather than in the cloud. (Using
the older iPXE path instead? See `boot/proxy-dhcp/README.md` — note its
custom `ipxe.efi` won't run with Secure Boot enabled.)

## Using it

Log in to the admin UI with a technician account (see 3b above) to
register devices, pre-stage a reinstall, watch job status, and manage the
OS profile/app/task-sequence catalog.

Boot the target machine from the WinPE image (network boot via WDS, or the
USB stick). A GUI window (`DeployGui.ps1`, fetched fresh from R2 - always
reflects the current catalog) prompts for technician credentials, a
hostname, whether to join a domain (and if so, the domain name plus admin
credentials), and a task sequence to install - or picks up whatever was
already queued from the admin UI (domain-join is always confirmed fresh
regardless, since credentials are never known to the cloud). It applies
the image with a live progress log; at first logon, the generalized
`PostAction.ps1` joins the domain non-interactively (no prompt - the
wizard already collected everything) and runs the task sequence's steps
in order.

Pre-staging (optional): in the admin UI, enter a target machine's MAC
address, pick a task sequence, click "Queue reinstall" ahead of time — the
technician still authenticates at boot and still confirms domain-join, but
skips the hostname/task-sequence prompts.

Either way, watch the job flip from `pending` -> `booted` -> `complete` in
the UI, along with which technician triggered it, the task sequence used,
and whether it joined a domain.

## Security

Read the "Security notes" section in `ARCHITECTURE.md` before pointing
this at real hardware — notably: the admin UI now requires a technician
login on its own, but consider Cloudflare Access as an additional layer,
and keep PXE traffic on a segmented VLAN.
