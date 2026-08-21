# OS profiles

This system currently deploys Windows only (see `windows-11-25h2-pro/` and
`windows-11-25h2-edu/`, which share boot media - see
`windows-11-25h2/README.md`). Each subdirectory holds the unattended-install
answer file for one profile, matching an entry in
`worker/src/lib/profiles.ts`. Upload the answer file plus its bootloader/WIM
files into the R2 bucket at the paths that entry's `kernel`/`initrd`/`answerFile`
keys reference, using `scripts/upload-image.sh`.

## Technician auth and the boot menu

`/boot/:mac` and `/boot/:mac/install` both require HTTP Basic Auth against
the `technicians` D1 table (`worker/src/lib/auth.ts`) - iPXE prompts for
credentials natively on a 401 and caches them per-host for the rest of the
boot session, so a technician is only prompted once. Provision technicians
with `scripts/add-technician.mjs` (there's deliberately no HTTP endpoint for
this - self-service account creation would be a hole in the same boundary
that gates OS reinstalls).

If an admin has already queued a job for a MAC via the admin UI, `/boot/:mac`
serves that job's install script directly. Otherwise it serves an iPXE menu
listing every profile in `OS_PROFILES`, and the technician's choice creates
the job.

Adding another Windows edition/version (or reintroducing a Linux profile
later) means adding a new subdirectory here plus a matching entry in
`OS_PROFILES` — the catalog and boot-script generator are already
profile-agnostic.

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
