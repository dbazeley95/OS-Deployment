# Architecture

> Scope: this system currently deploys Windows only. The design is
> OS-agnostic (see `boot/profiles/README.md` for adding another profile), but
> Windows is the one shipped end to end.

## Why hybrid, not pure-cloud

Cloudflare and GitHub can host every part of this system that speaks HTTPS: the
admin UI, the deployment API, OS images, and unattended-install answer files.
What they *cannot* do is answer a DHCP/PXE broadcast — that's link-local
traffic that never leaves the target machine's LAN segment. So a small piece
has to live on-prem: a **proxyDHCP** service (e.g. `dnsmasq`) that tells a
netbooting machine where to fetch its boot loader (iPXE), which then chains to
Cloudflare over HTTPS for everything else.

Everything past that first PXE handshake is cloud-hosted.

## Components

| Layer | Where | What |
|---|---|---|
| Admin UI | Cloudflare Pages | Register devices, pick an OS profile, kick off a reinstall, watch job status |
| API + boot script generator | Cloudflare Workers | REST API for devices/jobs, and `/boot/:mac` which returns a per-machine iPXE script |
| State | Cloudflare D1 | Device inventory, deployment jobs, status/history |
| Images & answer files | Cloudflare R2 | Windows boot files, WIM images, and the unattend.xml answer file, streamed to iPXE/WinPE over HTTPS |
| CI/CD | GitHub Actions | Deploy the Worker (`wrangler deploy`) and Pages site on push to main |
| Network boot | On-prem | `dnsmasq` proxyDHCP + iPXE chainloading to the Worker |

## Flow

Two entry points feed the same install path: an admin can pre-stage a job
via the UI, or a technician can PXE-boot a machine cold and pick a profile
from a menu. Either way, `/boot/:mac` requires HTTP Basic Auth against the
`technicians` D1 table — iPXE prompts for credentials natively on a 401 and
caches them per-host for the rest of the boot session.

```mermaid
sequenceDiagram
    participant Tech as Technician
    participant Target as Target machine (PXE)
    participant DHCP as On-prem proxyDHCP/TFTP
    participant Worker as Cloudflare Worker (API)
    participant D1
    participant R2

    Note over Target,DHCP: Tech reboots the machine, PXE boot enabled
    Target->>DHCP: DHCP discover (PXE options)
    DHCP-->>Target: hands out iPXE binary via TFTP
    Target->>Worker: iPXE chainloads https://.../boot/<mac>
    Worker-->>Target: 401 (no/invalid credentials)
    Target->>Tech: iPXE prompts for username/password
    Tech->>Target: enters credentials
    Target->>Worker: retries with Basic Auth
    Worker->>D1: verify technician; look up pending job for mac

    alt no pre-staged job
        Worker-->>Target: iPXE menu (profile choices)
        Target->>Tech: technician picks a profile
        Target->>Worker: chain /boot/<mac>/install?profile=... (cached auth)
        Worker->>D1: create job (status=booted, technician=...)
    else job already pre-staged via admin UI
        Worker->>D1: mark booted, record confirming technician
    end

    Worker-->>Target: dynamic iPXE script (kernel/initrd/answerfile URLs)
    Target->>R2: fetch kernel, initrd, answer file (via Worker, unauthenticated)
    Target->>Target: unattended install runs; first logon prompts for domain join
    Target->>Worker: PATCH /api/jobs/by-mac/:mac {status=complete} (phone-home)
    Worker->>D1: update job status
```

## Repo layout

```
worker/     Cloudflare Worker: REST API + /boot/:mac iPXE generator (Hono + D1 + R2)
frontend/   Cloudflare Pages: minimal admin UI (devices, jobs, deploy)
boot/       iPXE snippets, proxyDHCP config, per-OS unattended-install profiles
.github/    CI + deploy workflows
```

## Security notes (read before pointing this at real hardware)

- `/boot/:mac` and `/boot/:mac/install` require HTTP Basic Auth against the
  `technicians` D1 table (`worker/src/lib/auth.ts`), so any technician with
  valid credentials can trigger a reinstall on **any** MAC that PXE-boots —
  not just pre-registered ones. That's the point (self-service, no admin
  bottleneck), but it means the real safety boundary is who holds valid
  technician credentials and which machines can reach your PXE
  infrastructure at all, not the admin UI's pre-staging step.
- `/api/*` (the admin UI's REST API) still has no auth of its own — put it
  and the admin UI behind Cloudflare Access (Zero Trust) if it needs to be
  restricted.
- `/images/*` (kernels, initrds, WIMs, answer files, the domain-join script)
  is intentionally left unauthenticated even after the auth changes above —
  answer files here carry no secrets (domain join is interactive, not baked
  in), so gating downloads wasn't worth the complexity of threading a token
  through static, pre-uploaded R2 objects.
- Technician passwords are salted per-account and HMAC'd with a Worker
  secret pepper (`PASSWORD_PEPPER`) — never stored or compared in plaintext.
  There's no self-service account creation on purpose; provision technicians
  with `scripts/add-technician.mjs`.
- Windows ISOs are not redistributable — this scaffold only stores
  `autounattend.xml` templates; you supply your own licensed Windows media
  in R2 (see `boot/profiles/windows-11-25h2/README.md` for trimming it to
  size).
- Keep PXE/proxyDHCP on a segmented VLAN — a rogue proxyDHCP on a flat
  network can hijack any machine's boot process, including yours.
