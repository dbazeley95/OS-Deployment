# Operating systems

This system currently deploys Windows only (see `windows-11-25h2-pro/` and
`windows-11-25h2-edu/`, which share boot media - see
`windows-11-25h2/README.md`). Each subdirectory holds an unattended-install
answer file that a task sequence can pick, matching a row in the
`answer_files` D1 table (migration `0010_answer_files.sql`) referenced by a
row in the `task_sequences` D1 table (migration
`0012_answer_file_on_task_sequence.sql`) - both managed from the admin UI's
"Task Sequences" and "Answer Files" sections rather than code (see
`worker/src/lib/taskSequences.ts`/`answerFiles.ts`). The OS profile itself
(`os_profiles` D1 table, migration `0004_catalog.sql`, "Operating Systems"
section, `worker/src/lib/profiles.ts`) only carries the WIM and image index
now - upload it into the R2 bucket at the path its `installWim` key
references, using `scripts/upload-image.sh`.

## Technician auth

The WinPE path's `POST /api/deploy/auth` (credentials in the JSON body)
checks the `technicians` D1 table (`worker/src/lib/auth.ts` /
`verifyTechnicianCredentials`). The admin UI itself also logs in against
this same table (`POST /api/auth/login`, session cookie). Provision
technicians with `scripts/add-technician.mjs` (there's deliberately no
HTTP endpoint for self-service account creation - that would be a hole in
the same boundary that gates OS reinstalls).

There's no admin-side scheduling anywhere in this system - every job
starts on the machine itself. On a **retry** (this same MAC already has a
booted, incomplete job from a previous attempt), the wizard offers a
"Resume previous deployment" / "Edit selection" choice instead of forcing
either a blank form or a locked-in one - see `../winpe/README.md`. The
wizard always asks to confirm domain-join fresh regardless, even on a
retry - domain credentials are never known to the cloud (see
`../winpe/README.md`), so there's nothing to silently reuse there. The GUI
picks a **task sequence** (an OS profile plus an answer file, bundled with
an ordered list of apps/customizations, see `../winpe/README.md`) from
whatever's currently in the D1-backed catalog.

Adding another Windows edition/version means adding a new subdirectory
here plus a matching entry via the admin UI's "Operating Systems" section
(or `POST /api/catalog/profiles`) — the catalog is already profile-agnostic.

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
server-side templating route, `DeployGui.ps1` fetches the answer file as
text and does a literal string replace of the placeholder `WIN-REIMAGED`
with the technician-entered hostname before writing it to disk - see
`../winpe/README.md`.
