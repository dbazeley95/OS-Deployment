# OS Deployment

A web-based OS reinstall system: GitHub hosts the code and CI/CD, Cloudflare
hosts the admin UI, API, and OS images, and a small on-prem proxyDHCP service
bridges the gap that cloud services can't cross (PXE network boot).

Currently deploys **Windows only** — the design is OS-agnostic (adding a
profile is one entry in `worker/src/lib/profiles.ts` plus an answer file
under `boot/profiles/`), but Windows is the one wired up end to end.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design and a sequence
diagram of a deployment end to end.

## Layout

- `worker/` — Cloudflare Worker: REST API (devices/jobs) + `/boot/:mac`, which
  generates a per-machine iPXE script from D1 job state, and `/images/*`,
  which streams kernels/initrds/answer files out of R2.
- `frontend/` — Cloudflare Pages: minimal admin UI to register devices, pick
  an OS profile, queue a reinstall, and watch job status.
- `boot/` — iPXE/proxyDHCP setup notes and the Windows unattend answer file.
- `scripts/upload-image.sh` — pushes a local boot file/WIM into the R2
  images bucket.

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
(trimming `install.wim` to the Pro + Education indices, which files come
from where on the ISO), then push them to R2:

```bash
scripts/upload-image.sh ./boot/bootx64.efi windows-11-25h2/boot/bootx64.efi
scripts/upload-image.sh ./boot/boot.sdi windows-11-25h2/boot/boot.sdi
scripts/upload-image.sh ./install-trimmed.wim windows-11-25h2/sources/install.wim
scripts/upload-image.sh ./boot/profiles/windows-11-25h2/domain-join.ps1 windows-11-25h2/domain-join.ps1
scripts/upload-image.sh ./boot/profiles/windows-11-25h2-pro/autounattend.xml windows-11-25h2-pro/autounattend.xml
scripts/upload-image.sh ./boot/profiles/windows-11-25h2-edu/autounattend.xml windows-11-25h2-edu/autounattend.xml
```

### 3b. Provision technicians

`/boot/:mac` requires HTTP Basic Auth against a `technicians` D1 table —
there's no self-service signup on purpose. Compute a salted, peppered hash
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

### 6. On-prem PXE proxy

See `boot/proxy-dhcp/README.md` — this is the one piece that has to run on
your local network rather than in the cloud.

## Using it

Two ways to trigger a deployment:

- **Self-service (typical)**: PXE-boot the machine (or reboot it with network
  boot as the first boot option). It chains through your local proxyDHCP ->
  iPXE -> `https://<worker>/boot/<mac>`, which prompts the technician for
  their username/password (iPXE's native credential prompt on a 401,
  cached for the rest of the session), then shows a menu of OS profiles.
  Picking one creates the job, installs unattended, and — for Windows — asks
  at first logon whether to join the domain.
- **Pre-staged (optional)**: open the admin UI, enter a target machine's MAC
  address, pick a profile, click "Queue reinstall" ahead of time. The
  technician still has to authenticate at the PXE prompt, but the menu is
  skipped since a job is already waiting.

Either way, watch the job flip from `pending` -> `booted` -> `complete` in
the UI, along with which technician triggered it.

## Security

Read the "Security notes" section in `ARCHITECTURE.md` before pointing this
at real hardware — notably: put Cloudflare Access in front of the admin UI
and API, and keep PXE traffic on a segmented VLAN.
