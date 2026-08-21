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

If an admin has already queued a job for a MAC via the admin UI, both paths
serve that job directly (skipping whichever prompts are already decided).
Otherwise both offer the same D1-backed catalog to choose from - the WinPE
path's GUI also offers a post-imaging action (domain join / install an
app / leave at OOBE for Autopilot) and the app catalog, see
`../winpe/README.md`.

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

If you need answer files templated per-job (e.g. to inject a hostname chosen
in the admin UI), the natural extension is to add a route like
`GET /rendered/:profile/:mac` that reads the R2 template, does token
substitution using that MAC's job row, and returns the result — then point
`answerFileArg` in `profiles.ts` at that route instead of `/images/...`.
That's intentionally left out of this starter to keep the initial scaffold
small.
