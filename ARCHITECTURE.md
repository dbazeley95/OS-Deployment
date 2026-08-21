# Architecture

> Scope: this system currently deploys Windows only. The design is
> OS-agnostic (see `boot/profiles/README.md` for adding another profile), but
> Windows is the one shipped end to end.

> **Primary deployment path**: a signed WinPE image + PowerShell script
> (`boot/winpe/`), replacing MDT. An older iPXE-based path
> (`boot/proxy-dhcp/`) is also documented, but its custom-built `ipxe.efi`
> is unsigned and gets rejected by UEFI Secure Boot — that's why it's no
> longer the recommended default. Both paths share the same Worker/D1/R2
> backend and the same Windows answer files (`boot/profiles/`); they only
> differ in how a bare-metal machine reaches the point of running the OS
> installer.

## Why hybrid, not pure-cloud

Cloudflare and GitHub can host every part of this system that speaks HTTPS: the
admin UI, the deployment API, OS images, and unattended-install answer files.
What they *cannot* do is get a bare-metal machine bootable in the first place
— that's inherently local. Two ways to bridge that gap are documented:

- **WinPE (primary)**: a stock, Microsoft-signed WinPE image runs a custom
  PowerShell script (`boot/winpe/Deploy.ps1`) that talks to the Worker's
  JSON API directly. Delivered via WDS (network boot) or a bootable USB
  stick — no DHCP/PXE-specific infrastructure required either way.
- **iPXE (alternative)**: a **proxyDHCP** service (e.g. `dnsmasq`) tells a
  netbooting machine where to fetch iPXE, which chains to the Worker over
  HTTPS for everything else. Requires Secure Boot to be off, since the
  iPXE binary involved is unsigned.

Everything past that first local hop is cloud-hosted, for either path.

## Components

| Layer | Where | What |
|---|---|---|
| Admin UI | Cloudflare Pages | Register devices, pick an OS profile, kick off a reinstall, watch job status |
| Deploy API | Cloudflare Workers | `/api/deploy/*` — JSON API the WinPE `Deploy.ps1` script calls for technician auth, profile/action selection, and image/answer-file URLs |
| iPXE boot script generator | Cloudflare Workers | `/boot/:mac` — the older iPXE-facing route, returns a per-machine iPXE script |
| State | Cloudflare D1 | Device inventory, deployment jobs (including post-imaging action), status/history, technicians |
| Images & answer files | Cloudflare R2 | Windows WIM images, unattend.xml answer files, `PostAction.ps1`, app installers - streamed to WinPE/iPXE over HTTPS |
| CI/CD | GitHub Actions | Deploy the Worker (`wrangler deploy`) and Pages site on push to main |
| Getting bootable | On-prem | WinPE via WDS/USB (primary), or `dnsmasq` proxyDHCP + iPXE (alternative) |

## Flow

### WinPE path (primary)

An admin can pre-stage a job via the UI, or a technician can boot a machine
cold (WDS or USB) and pick a profile + post-imaging action on the spot.
Either way, `Deploy.ps1` authenticates against the same `technicians` D1
table as the iPXE path below, just over a plain JSON API instead of HTTP
Basic Auth (a WinPE script doesn't get that prompt for free the way iPXE
does).

```mermaid
sequenceDiagram
    participant Tech as Technician
    participant Target as Target machine (WinPE)
    participant Worker as Cloudflare Worker (API)
    participant D1
    participant R2

    Note over Target: Boots from WDS or USB into the signed WinPE image
    Target->>Tech: Deploy.ps1 prompts for username/password
    Tech->>Target: enters credentials
    Target->>Worker: POST /api/deploy/auth {mac, username, password}
    Worker->>D1: verify technician; look up pending job for mac

    alt no pre-staged job
        Worker-->>Target: profile + app catalogs
        Target->>Tech: prompts for profile + post-action (+ app, if install-app)
        Target->>Worker: POST /api/deploy/select {...}
        Worker->>D1: create job (status=booted, technician, post_action, app_id)
    else job pre-staged via admin UI (profile only)
        Worker-->>Target: status=choose-action, profile
        Target->>Tech: prompts for post-action only
        Target->>Worker: POST /api/deploy/select {profile, postAction, ...}
    else job fully pre-staged (profile + post-action)
        Worker->>D1: mark booted, record confirming technician
    end

    Worker-->>Target: installWim/imageIndex/answerFileUrl/postActionScriptUrl URLs
    Target->>R2: download install.wim, answer file, PostAction.ps1 (via Worker, unauthenticated)
    Target->>Target: partition/format disk, DISM /Apply-Image, write post-action.json, bcdboot, reboot
    Target->>Target: first logon runs PostAction.ps1 (domain join / app install / autopilot)
    Target->>Worker: PATCH /api/jobs/by-mac/:mac {status=complete} (phone-home)
    Worker->>D1: update job status
```

### iPXE path (alternative, Secure Boot must be off)

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
worker/            Cloudflare Worker: REST API, /api/deploy/* (WinPE), /boot/:mac (iPXE) (Hono + D1 + R2)
frontend/          Cloudflare Pages: minimal admin UI (devices, jobs, deploy)
boot/winpe/        Primary path: WinPE build docs, Deploy.ps1, PostAction.ps1
boot/proxy-dhcp/   Alternative path: iPXE snippets, proxyDHCP/option-66-67/HTTPS-Boot docs
boot/profiles/     Per-OS unattended-install answer files, shared by both paths
.github/           CI + deploy workflows
```

## Security notes (read before pointing this at real hardware)

- `/api/deploy/*` (JSON body credentials) and `/boot/:mac`/`/boot/:mac/install`
  (HTTP Basic Auth) both check the same `technicians` D1 table
  (`worker/src/lib/auth.ts` / `verifyTechnicianCredentials`), so any
  technician with valid credentials can trigger a reinstall on **any** MAC
  that boots the WinPE image or PXE-boots — not just pre-registered ones.
  That's the point (self-service, no admin bottleneck), but it means the
  real safety boundary is who holds valid technician credentials and which
  machines can reach your deployment infrastructure at all, not the admin
  UI's pre-staging step.
- `/api/*` (the admin UI's REST API) still has no auth of its own — put it
  and the admin UI behind Cloudflare Access (Zero Trust) if it needs to be
  restricted.
- `/images/*` (WIMs, answer files, `PostAction.ps1`, app installers) is
  intentionally left unauthenticated even after the auth changes above —
  answer files and scripts here carry no secrets (domain join is
  interactive, not baked in), so gating downloads wasn't worth the
  complexity of threading a token through static, pre-uploaded R2 objects.
- Technician passwords are salted per-account and HMAC'd with a Worker
  secret pepper (`PASSWORD_PEPPER`) — never stored or compared in plaintext.
  There's no self-service account creation on purpose; provision technicians
  with `scripts/add-technician.mjs`.
- Windows ISOs are not redistributable — this scaffold only stores
  `autounattend.xml` templates; you supply your own licensed Windows media
  in R2 (see `boot/profiles/windows-11-25h2/README.md` for trimming it to
  size).
- Keep PXE/proxyDHCP on a segmented VLAN if using the iPXE path — a rogue
  proxyDHCP on a flat network can hijack any machine's boot process,
  including yours. The WinPE path (WDS/USB) doesn't have this specific
  risk, since it isn't answering broadcast DHCP/PXE requests the same way.
