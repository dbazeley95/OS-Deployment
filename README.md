# OS Deployment

A web-based OS reinstall system: GitHub hosts the code and CI/CD, Cloudflare
hosts the admin UI, API, and OS images, and a small on-prem piece bridges
the gap that cloud services can't cross (getting a bare-metal machine
bootable).

Currently deploys **Windows only** — the design is OS-agnostic (adding a
profile is one entry in `worker/src/lib/profiles.ts` plus an answer file
under `boot/profiles/`), but Windows is the one wired up end to end.

**Primary path: a signed WinPE image + PowerShell script** (`boot/winpe/`),
delivered via WDS or a bootable USB stick — no custom unsigned binary in
the boot chain, so it works cleanly under UEFI Secure Boot, and it's what
replaces MDT. An older iPXE-based path (`boot/proxy-dhcp/`,
`boot/profiles/`) is also documented as an alternative, but it depends on
a custom-built `ipxe.efi` that Secure Boot will reject unless disabled.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design and a sequence
diagram of a deployment end to end.

## Layout

- `worker/` — Cloudflare Worker: REST API (devices/jobs), `/api/deploy/*`
  (JSON API the WinPE `Deploy.ps1` script calls), `/boot/:mac` (the older
  iPXE-facing route, generates a per-machine iPXE script from D1 job
  state), and `/images/*`, which streams WIMs/answer files/scripts out of
  R2.
- `frontend/` — Cloudflare Pages: minimal admin UI to register devices, pick
  an OS profile, queue a reinstall, and watch job status (including the
  post-imaging action and which technician triggered it).
- `boot/winpe/` — the primary deployment path: build instructions for the
  signed WinPE image, `Deploy.ps1` (runs inside WinPE), `PostAction.ps1`
  (runs at first logon).
- `boot/proxy-dhcp/`, `boot/profiles/` — the older iPXE-based path and the
  Windows unattend answer files (shared by both paths).
- `scripts/upload-image.sh` — pushes a local boot file/WIM/script into the
  R2 images bucket.

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
scripts/upload-image.sh ./boot/winpe/PostAction.ps1 winpe/PostAction.ps1
scripts/upload-image.sh ./boot/profiles/windows-11-25h2-pro/autounattend.xml windows-11-25h2-pro/autounattend.xml
scripts/upload-image.sh ./boot/profiles/windows-11-25h2-edu/autounattend.xml windows-11-25h2-edu/autounattend.xml
```

Only needed if you're also using the older iPXE path (`boot/proxy-dhcp/`):

```bash
scripts/upload-image.sh ./boot/bootx64.efi windows-11-25h2/boot/bootx64.efi
scripts/upload-image.sh ./boot/boot.sdi windows-11-25h2/boot/boot.sdi
```

For the optional `install-app` post-imaging action, upload each
installer/script and add a matching entry to `worker/src/lib/apps.ts`.

### 3b. Provision technicians

Both `/boot/:mac` (Basic Auth) and `/api/deploy/*` (credentials in the
request body) check against the same `technicians` D1 table — there's no
self-service signup on purpose. Compute a salted, peppered hash
and print the SQL to insert it:

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

Boot the machine from the WinPE image (network boot via WDS, or the USB
stick). `Deploy.ps1` prompts for technician credentials, then either an OS
profile and post-imaging action (domain join / install an app / leave at
OOBE for Autopilot) if nothing's pre-staged, or picks up a job already
queued from the admin UI. It applies the image, and at first logon the
generalized `PostAction.ps1` runs whichever action was chosen.

Pre-staging (optional): open the admin UI, enter a target machine's MAC
address, pick a profile, click "Queue reinstall" ahead of time — the
technician still authenticates at boot, but skips the prompts for whatever
was already decided.

Either way, watch the job flip from `pending` -> `booted` -> `complete` in
the UI, along with which technician triggered it and which post-action ran.

## Security

Read the "Security notes" section in `ARCHITECTURE.md` before pointing this
at real hardware — notably: put Cloudflare Access in front of the admin UI
and API, and keep PXE traffic on a segmented VLAN.
