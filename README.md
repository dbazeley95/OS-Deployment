# OS Deployment

A web-based OS reinstall system: GitHub hosts the code and CI/CD, Cloudflare
hosts the admin UI, API, and OS images, and a small on-prem proxyDHCP service
bridges the gap that cloud services can't cross (PXE network boot).

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design and a sequence
diagram of a deployment end to end.

## Layout

- `worker/` — Cloudflare Worker: REST API (devices/jobs) + `/boot/:mac`, which
  generates a per-machine iPXE script from D1 job state, and `/images/*`,
  which streams kernels/initrds/answer files out of R2.
- `frontend/` — Cloudflare Pages: minimal admin UI to register devices, pick
  an OS profile, queue a reinstall, and watch job status.
- `boot/` — iPXE/proxyDHCP setup notes and per-OS unattended-install answer
  files (Ubuntu autoinstall, Debian preseed, Windows unattend).
- `scripts/upload-image.sh` — pushes a local kernel/initrd/ISO file into the
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

### 3. Upload OS images

Fetch a netboot kernel/initrd for your distro of choice (e.g. Ubuntu's
`netboot/amd64/linux` + `initrd`) and push them to R2:

```bash
scripts/upload-image.sh ./vmlinuz ubuntu-22.04/vmlinuz
scripts/upload-image.sh ./initrd ubuntu-22.04/initrd
scripts/upload-image.sh ./boot/profiles/ubuntu-22.04/autoinstall.yaml ubuntu-22.04/autoinstall.yaml
```

Windows has extra caveats — see `boot/profiles/windows-11/README.md`.

### 4. Deploy

Push to `main` and GitHub Actions deploys the Worker and Pages site (see
`.github/workflows/`). Set repo secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`, and repo variable `WORKER_API_BASE` (your deployed
Worker's URL) for the Pages build to point at the right API.

### 5. On-prem PXE proxy

See `boot/proxy-dhcp/README.md` — this is the one piece that has to run on
your local network rather than in the cloud.

## Using it

1. Open the admin UI, enter a target machine's MAC address, pick an OS
   profile, click "Queue reinstall".
2. PXE-boot that machine (or reboot it with network boot as the first boot
   option). It chains through your local proxyDHCP -> iPXE ->
   `https://<worker>/boot/<mac>` -> gets the OS-specific boot script ->
   installs unattended -> phones home to mark the job complete.
3. Watch the job flip from `pending` -> `booted` -> `complete` in the UI.

## Security

Read the "Security notes" section in `ARCHITECTURE.md` before pointing this
at real hardware — notably: put Cloudflare Access in front of the admin UI
and API, and keep PXE traffic on a segmented VLAN.
