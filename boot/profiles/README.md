# OS profiles

Each subdirectory here holds the unattended-install answer file for one OS
profile, matching an entry in `worker/src/lib/profiles.ts`. Upload the answer
file plus its kernel/initrd (or bootloader/WIM, for Windows) into the R2
bucket at the paths that file's `kernel`/`initrd`/`answerFile` keys reference,
using `scripts/upload-image.sh`.

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
