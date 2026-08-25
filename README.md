# W.I.P.E

**W**indows **I**nstallation **P**rovisioning **E**ngine — a web-based OS
reinstall system: GitHub hosts the code and CI/CD, Cloudflare hosts the
admin UI, API, and OS images, and a small on-prem piece bridges the gap
that cloud services can't cross (getting a bare-metal machine bootable).

Windows only, by design — see `worker/src/lib/profiles.ts` and
`boot/profiles/` if you ever need to add another OS profile.

**Primary path: a signed WinPE image running a Windows Forms GUI**
(`boot/winpe/DeployGui.ps1`), delivered via WDS or a bootable USB stick —
no custom unsigned binary in the boot chain, so it works cleanly under
UEFI Secure Boot, and it's what replaces MDT's Lite Touch wizard with an
equivalent flow: sign in, enter a hostname, decide domain-join or not (and
if so, the domain plus admin credentials, right there in the wizard), then
pick a **task sequence** - a cloud-editable bundle of one OS profile, one
answer file, and an ordered list of apps/customizations. The GUI script is
fetched fresh from R2 on every boot rather than baked into the image, and
the whole catalog (operating systems, answer files, apps, task sequences)
is managed from the admin UI (a "cloud Deployment Workbench") instead of a
code change + redeploy.
UEFI only, by design - no legacy BIOS/MBR boot support.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design and a sequence
diagram of a deployment end to end.

## Layout

- `worker/` — Cloudflare Worker: `/api/auth/*` (technician login for the
  admin UI), `/api/catalog/*` (OS profile/app/task-sequence catalog CRUD,
  the cloud editor), REST API (devices/jobs), `/api/deploy/*` (JSON API the
  WinPE `DeployGui.ps1` GUI calls), and `/images/*`, which streams
  WIMs/answer files/scripts out of R2.
- `frontend/` — Cloudflare Pages: admin UI, gated behind a technician
  login — the OS profile/app/task-sequence catalog editor, plus a
  read-only log of devices and jobs (status, domain-join, which technician
  triggered it). No job scheduling - every deployment starts on-device.
- `boot/winpe/` — the deployment path: build instructions for the
  signed WinPE image, `DeployGui.ps1` (the Forms GUI, fetched fresh from
  R2 on every boot - not baked into the image), `PostAction.ps1` (runs at
  first logon).
- `boot/profiles/` — the Windows unattend answer files.
- `boot/drivers/` — no code here, just a guide (`README.md`) for the
  optional MDT-style driver-injection file share `DeployGui.ps1` can pull
  from - deliberately not R2, since driver packs are large.
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
essentials to R2. `install.wim` itself can instead be uploaded straight from
the admin UI's "Operating Systems" form (chunked multipart upload straight
to R2 - no CLI needed), which also fills in its R2 key automatically:

```bash
scripts/upload-image.sh ./install-trimmed.wim windows-11-25h2/sources/install.wim
scripts/upload-image.sh ./boot/profiles/windows-11-25h2-pro/autounattend.xml windows-11-25h2-pro/autounattend.xml
scripts/upload-image.sh ./boot/profiles/windows-11-25h2-edu/autounattend.xml windows-11-25h2-edu/autounattend.xml
```

(`boot/winpe/DeployGui.ps1` and `PostAction.ps1` don't need a manual
upload — pushing to `main` syncs them to R2 automatically, see
`.github/workflows/sync-winpe-scripts.yml`.)

The two profiles above are seeded by migration `0004_catalog.sql`. For a
new edition or app, upload the installer/script with
`scripts/upload-image.sh` and add a matching entry from the admin UI's
"Operating Systems"/"Apps" sections — no code change or redeploy needed.
Then bundle one into a task sequence from the "Task sequences" section
(an OS profile plus an answer file plus an ordered list of apps) - that's
what the WinPE wizard actually offers technicians. Migration
`0006_task_sequences.sql`/`0007_job_task_sequence.sql`/
`0012_answer_file_on_task_sequence.sql` add this on top of the catalog
tables.

### 3b. Provision technicians

`/api/deploy/*` (credentials in the request body) and `/api/auth/login`
(the admin UI itself) both check against the same `technicians` D1
table — there's no self-service signup on purpose. Compute a salted,
peppered hash and print the SQL to insert it:

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
has to happen on your own machine/network rather than in the cloud.

## Using it

Log in to the admin UI with a technician account (see 3b above) to manage
the OS profile/app/task-sequence catalog and watch the job log. There's no
scheduling step here on purpose - every deployment starts on the machine
itself.

Boot the target machine from the WinPE image (network boot via WDS, or the
USB stick). A GUI window (`DeployGui.ps1`, fetched fresh from R2 - always
reflects the current catalog) prompts for technician credentials, a
hostname, whether to join a domain (and if so, the domain name plus admin
credentials, never sent to the cloud), and a task sequence to install. It
applies the image with a live progress log; at first logon, the
generalized `PostAction.ps1` joins the domain non-interactively (no
prompt - the wizard already collected everything) and runs the task
sequence's steps in order.

The one prompt that's skipped is on a **retry**: if the same machine
already got partway through a deployment, the hostname/task-sequence
questions are skipped in favor of what was already chosen - domain-join is
always re-confirmed regardless, since credentials are never persisted.

Watch the job flip from `pending` -> `booted` -> `complete` in the admin
UI's log, along with which technician triggered it, the task sequence
used, and whether it joined a domain.

## Security

Read the "Security notes" section in `ARCHITECTURE.md` before pointing
this at real hardware — notably: the admin UI now requires a technician
login on its own, but consider Cloudflare Access as an additional layer.
