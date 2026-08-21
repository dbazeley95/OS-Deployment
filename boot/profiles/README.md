# OS profiles

This system currently deploys Windows only (see `windows-11-25h2-pro/` and
`windows-11-25h2-edu/`, which share boot media - see
`windows-11-25h2/README.md`). Each subdirectory holds the unattended-install
answer file for one profile, matching a row in the `os_profiles` D1 table
(migration `0004_catalog.sql`, managed from the admin UI's "OS profiles"
section rather than code - see `worker/src/lib/profiles.ts`). Upload the
answer file plus its bootloader/WIM files into the R2 bucket at the paths
that entry's `kernel`/`initrd`/`answerFile` keys reference, using
`scripts/upload-image.sh`.

## Technician auth

Both deployment entry points check the same `technicians` D1 table
(`worker/src/lib/auth.ts` / `verifyTechnicianCredentials`): the WinPE path's
`POST /api/deploy/auth` (credentials in the JSON body) and the older iPXE
path's `/boot/:mac`/`/boot/:mac/install` (HTTP Basic Auth - iPXE prompts for
credentials natively on a 401 and caches them per-host for the rest of the
boot session). The admin UI itself also logs in against this same table
(`POST /api/auth/login`, session cookie). Provision technicians with
`scripts/add-technician.mjs` (there's deliberately no HTTP endpoint for
self-service account creation - that would be a hole in the same boundary
that gates OS reinstalls).

There's no admin-side scheduling anywhere in this system - every job
starts on the machine itself. The one prompt either path skips is on a
**retry**: if this same MAC already has a booted, incomplete job (a
previous attempt got partway through), the hostname/task-sequence prompts
are skipped in favor of what was already decided. The WinPE path's GUI
always asks to confirm domain-join fresh regardless, though, even on a
retry - domain credentials are never known to the cloud (see
`../winpe/README.md`), so there's nothing to silently reuse there.
Otherwise both offer the same D1-backed catalog to choose from - the
WinPE path's GUI picks a **task sequence** (an OS profile bundled with an
ordered list of apps/customizations, see `../winpe/README.md`) rather than
a bare OS profile.

Adding another Windows edition/version (or reintroducing a Linux profile
later) means adding a new subdirectory here plus a matching entry via the
admin UI's "OS profiles" section (or `POST /api/catalog/profiles`) — the
catalog and boot-script generator are already profile-agnostic.

## Note on the phone-home pattern

Answer files served from R2 are static — the Worker streams them byte for
byte via `/images/*`, it doesn't template them per-job. That means an answer
file can't embed its own job id. Instead, post-install scripts phone home by
**MAC address** to `PATCH /api/jobs/by-mac/:mac`, and the Worker resolves
that to whichever job is most recent for that MAC
(`worker/src/lib/db.ts#updateLatestJobStatusForMac`).

## Note on per-job hostname templating

The one per-job value that *does* need to reach the static answer file is
the hostname (`<ComputerName>` in the `specialize` pass). Rather than a
server-side templating route, `DeployGui.ps1` (WinPE path only) fetches
the answer file as text and does a literal string replace of the
placeholder `WIN-REIMAGED` with the technician-entered hostname before
writing it to disk - see `../winpe/README.md`. The older iPXE path has no
such substitution step, so a machine imaged that way keeps the literal
`WIN-REIMAGED` name (a valid, if generic, computer name) - that's why the
placeholder itself has to stay a valid name, not an obviously-fake token.
