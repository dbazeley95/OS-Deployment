# Architecture

> Scope: this system currently deploys Windows only. The design is
> OS-agnostic (see `boot/profiles/README.md` for adding another profile), but
> Windows is the one shipped end to end.

> **Deployment path**: a signed WinPE image running a Windows Forms GUI
> (`boot/winpe/DeployGui.ps1`), replacing MDT's Lite Touch wizard - no
> custom unsigned binary in the boot chain, so it works cleanly under
> UEFI Secure Boot. UEFI only, by design - no legacy BIOS/MBR support.
>
> The deployment catalog (OS profiles, apps, and **task sequences** - an OS
> profile bundled with an ordered list of apps/customizations) lives in D1
> and is managed from the admin UI (`/api/catalog/*`) instead of a code
> change + redeploy — a "cloud Deployment Workbench" in place of MDT's
> local one. The admin UI itself now requires a technician login
> (`/api/auth/*`), reusing the same `technicians` table as boot-time auth.
> Domain-join credentials are the one thing that deliberately never reach
> the cloud at all - see the WinPE flow below.

## Why hybrid, not pure-cloud

Cloudflare and GitHub can host every part of this system that speaks HTTPS: the
admin UI, the deployment API, OS images, and unattended-install answer files.
What they *cannot* do is get a bare-metal machine bootable in the first place
— that's inherently local. This system bridges that gap with:

- **WinPE**: a stock, Microsoft-signed WinPE image runs a Windows Forms
  GUI (`boot/winpe/DeployGui.ps1`) that talks to the Worker's JSON API
  directly. Delivered via WDS (network boot) or a bootable USB stick —
  no DHCP/PXE-specific infrastructure required. The GUI script itself is
  fetched fresh from R2 on every boot rather than baked into the image,
  so it (and the catalog it offers) can change without an image rebuild.

Everything past that first local hop is cloud-hosted.

## Components

| Layer | Where | What |
|---|---|---|
| Admin UI | Cloudflare Pages | Log in as a technician; a read-only log of in-progress/complete deployments and devices, plus the OS profile/app/task-sequence catalog editor - no job scheduling, every deployment starts on-device |
| Auth API | Cloudflare Workers | `/api/auth/*` — technician login/logout, issues the admin UI's session cookie |
| Catalog API | Cloudflare Workers | `/api/catalog/*` — CRUD for OS profiles, apps, and task sequences (D1-backed), behind the session login - the "cloud Deployment Workbench" |
| Deploy API | Cloudflare Workers | `/api/deploy/*` — JSON API the WinPE `DeployGui.ps1` script calls for technician auth, hostname/domain-join/task-sequence selection, and image/answer-file URLs (never domain-join credentials - those stay device-local) |
| State | Cloudflare D1 | Device inventory, deployment jobs (task sequence used, domain-join name), status/history, technicians, OS profile/app/task-sequence catalog |
| Images & answer files | Cloudflare R2 | Windows WIM images, unattend.xml answer files, `DeployGui.ps1`/`PostAction.ps1`, app installers - streamed to WinPE over HTTPS |
| CI/CD | GitHub Actions | Deploy the Worker (`wrangler deploy`) and Pages site on push to main; sync `boot/winpe/*.ps1` to R2 on push |
| Getting bootable | On-prem | WinPE via WDS/USB |

## Flow

### WinPE path

There's no admin-side scheduling anywhere in this system - every
deployment starts on the machine itself. A technician boots it cold (WDS
or USB) and enters everything on the spot via a real Windows Forms GUI
(`DeployGui.ps1`, fetched fresh from R2 on every boot - not baked into the
image), which authenticates against the `technicians` D1 table over a
plain JSON API (no browser to prompt for HTTP Basic Auth). Its
task-sequence dropdown is whatever's currently in the D1-backed catalog
(managed via the admin UI's own login-gated `/api/catalog/*`, not code) -
the admin UI's job is that catalog editor plus a read-only log of jobs,
nothing more.

The one case the wizard skips a prompt is a **retry**: if this same
machine already got partway through a deployment (booted but not yet
complete), the hostname/task-sequence prompts are skipped in favor of
what was already decided. Domain-join is never skipped this way, even on
a retry - it's always confirmed fresh, because the join
**username/password are never sent to the Worker at all**.
`DeployGui.ps1` collects them locally and writes them straight into the
target disk's `post-action.json`; only the domain *name* travels to D1,
for audit.

```mermaid
sequenceDiagram
    participant Tech as Technician
    participant Target as Target machine (WinPE)
    participant Worker as Cloudflare Worker (API)
    participant D1
    participant R2

    Note over Target: Boots from WDS or USB; startnet.cmd fetches DeployGui.ps1 fresh from R2
    Target->>Tech: DeployGui.ps1 shows a login window
    Tech->>Target: enters credentials
    Target->>Worker: POST /api/deploy/auth {mac, username, password}
    Worker->>D1: verify technician; look up in-progress job for mac

    alt no in-progress job for this mac
        Worker-->>Target: status=choose, task sequence catalog (D1-backed)
        Target->>Tech: shows hostname + domain-join + task-sequence form
    else retry - this mac already has a booted, incomplete job
        Worker-->>Target: status=ready, hostname, taskSequenceId
        Target->>Tech: shows domain-join form only (hostname/task sequence read-only)
    end
    Tech->>Target: enters domain name + admin credentials, if joining (kept device-local)
    Target->>Worker: POST /api/deploy/select {mac, hostname, taskSequenceId, domainJoin, domain}
    Worker->>D1: create/update job (status=booted, technician, task_sequence_id, domain_join, domain)

    Worker-->>Target: installWim/imageIndex/answerFileUrl/postActionScriptUrl + resolved step URLs
    Target->>R2: download install.wim, answer file, PostAction.ps1 (via Worker, unauthenticated)
    Target->>Target: GUI shows progress: partition/format disk, DISM /Apply-Image, substitute hostname into answer file, write post-action.json (incl. local-only domain credentials + steps), bcdboot, reboot
    Target->>Target: FirstLogonCommands seeds a RunOnce entry for PostAction.ps1 (not run directly - FirstLogonCommands no longer reliably runs entries in Order on current Windows)
    Target->>Target: RunOnce fires PostAction.ps1 once the desktop is reached - shows a status GUI, joins the domain non-interactively, scrubs the credential from disk, then runs each task-sequence step in order
    Target->>Worker: PATCH /api/jobs/by-mac/:mac {status=installing}, then {status=complete|failed} once finished (phone-home)
    Worker->>D1: update job status
```

## Repo layout

```
worker/            Cloudflare Worker: REST API, /api/auth/*, /api/catalog/*, /api/deploy/* (WinPE) (Hono + D1 + R2)
frontend/          Cloudflare Pages: admin UI (login, devices, jobs, deploy, OS profile/app catalog editor)
boot/winpe/        WinPE build docs, DeployGui.ps1, PostAction.ps1
boot/profiles/     Per-OS unattended-install answer files
.github/           CI + deploy workflows, WinPE script -> R2 sync
```

## Security notes (read before pointing this at real hardware)

- `/api/deploy/*` (JSON body credentials, `worker/src/lib/auth.ts` /
  `verifyTechnicianCredentials`) checks the `technicians` D1 table, so any
  technician with valid credentials can trigger a reinstall on **any** MAC
  that boots the WinPE image — not just pre-registered ones. That's the
  point (self-service, no admin bottleneck, no scheduling step to bypass)
  - the real safety boundary is who holds valid technician credentials
  and which machines can reach your deployment infrastructure at all.
- `/api/devices`, `/api/jobs`, and `/api/catalog/*` (the admin UI's own
  REST API) require a technician login (`/api/auth/login`, an
  `HttpOnly`/`Secure`/`SameSite=Strict` session cookie signed with the
  same `PASSWORD_PEPPER` used for technician passwords). `/api/deploy/*`
  keeps its own separate credential-in-body model for WinPE, and
  `/images/*` is unaffected — it isn't a browser session. Consider
  Cloudflare Access (Zero Trust) as an additional layer if you want
  network-level restriction on top of this.
- `/images/*` (WIMs, answer files, `PostAction.ps1`, app installers) is
  intentionally left unauthenticated even after the auth changes above —
  everything served from there is static, pre-uploaded, non-secret content.
  Domain-join credentials never pass through this route (or through the
  Worker/D1 at all) - `DeployGui.ps1` writes them directly from the WinPE
  GUI into a file on the target disk, and `PostAction.ps1` scrubs them
  from that file immediately after attempting the join. That file
  (`C:\Windows\Setup\Scripts\post-action.json`) does briefly hold a
  plaintext credential between imaging and first logon - the same
  practical tradeoff MDT's own unattend-based domain join has always had -
  so treat that window (and anyone with access to the target disk during
  it) accordingly.
- Technician passwords are salted per-account and HMAC'd with a Worker
  secret pepper (`PASSWORD_PEPPER`) — never stored or compared in plaintext.
  There's no self-service account creation on purpose; provision technicians
  with `scripts/add-technician.mjs`.
- Windows ISOs are not redistributable — this scaffold only stores
  `autounattend.xml` templates; you supply your own licensed Windows media
  in R2 (see `boot/profiles/windows-11-25h2/README.md` for trimming it to
  size).
