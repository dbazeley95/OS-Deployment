import type { Bindings, DeploymentJob, Device, JobStatus, PostAction } from "../types";

export async function upsertDevice(db: Bindings["DB"], mac: string, hostname?: string) {
  await db
    .prepare(
      `INSERT INTO devices (mac, hostname, last_seen_at)
       VALUES (?1, ?2, datetime('now'))
       ON CONFLICT(mac) DO UPDATE SET
         hostname = COALESCE(?2, hostname),
         last_seen_at = datetime('now')`
    )
    .bind(mac, hostname ?? null)
    .run();
}

export async function listDevices(db: Bindings["DB"]): Promise<Device[]> {
  const { results } = await db.prepare(`SELECT * FROM devices ORDER BY created_at DESC`).all<Device>();
  return results ?? [];
}

export async function createJob(
  db: Bindings["DB"],
  mac: string,
  osProfile: string,
  opts?: { hostname?: string; technician?: string; postAction?: PostAction; appId?: string }
): Promise<number> {
  await upsertDevice(db, mac, opts?.hostname);
  const { meta } = await db
    .prepare(
      `INSERT INTO deployment_jobs (device_mac, os_profile, technician, post_action, app_id)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    )
    .bind(mac, osProfile, opts?.technician ?? null, opts?.postAction ?? null, opts?.appId ?? null)
    .run();
  return meta.last_row_id as number;
}

export async function listJobs(db: Bindings["DB"]): Promise<DeploymentJob[]> {
  const { results } = await db
    .prepare(`SELECT * FROM deployment_jobs ORDER BY created_at DESC LIMIT 200`)
    .all<DeploymentJob>();
  return results ?? [];
}

export async function getPendingJobForMac(db: Bindings["DB"], mac: string): Promise<DeploymentJob | null> {
  const job = await db
    .prepare(
      `SELECT * FROM deployment_jobs
       WHERE device_mac = ?1 AND status IN ('pending', 'booted')
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(mac)
    .first<DeploymentJob>();
  return job ?? null;
}

export async function updateLatestJobStatusForMac(
  db: Bindings["DB"],
  mac: string,
  status: JobStatus,
  log?: string
): Promise<boolean> {
  const job = await db
    .prepare(
      `SELECT id FROM deployment_jobs WHERE device_mac = ?1
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(mac)
    .first<{ id: number }>();
  if (!job) return false;
  await updateJobStatus(db, job.id, status, log);
  return true;
}

/**
 * Reuses a pending/booted job for this MAC+profile if one already exists
 * (e.g. pre-staged via the admin UI), otherwise creates one - then marks it
 * booted either way. Shared by /boot/:mac/install (worker/src/routes/boot.ts)
 * and the JSON deploy API (worker/src/routes/deploy.ts) so both entry
 * points behave identically.
 */
export async function resolveOrCreateJob(
  db: Bindings["DB"],
  mac: string,
  profileId: string,
  opts: { technician: string; log: string; postAction?: PostAction; appId?: string }
): Promise<number> {
  const existing = await getPendingJobForMac(db, mac);
  const id =
    existing && existing.os_profile === profileId
      ? existing.id
      : await createJob(db, mac, profileId, { technician: opts.technician, postAction: opts.postAction, appId: opts.appId });
  await updateJobStatus(db, id, "booted", opts.log, opts.technician, opts.postAction, opts.appId);
  return id;
}

export async function updateJobStatus(
  db: Bindings["DB"],
  id: number,
  status: JobStatus,
  log?: string,
  technician?: string,
  postAction?: PostAction,
  appId?: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE deployment_jobs SET status = ?2, log = COALESCE(?3, log),
         technician = COALESCE(?4, technician),
         post_action = COALESCE(?5, post_action),
         app_id = COALESCE(?6, app_id),
         updated_at = datetime('now')
       WHERE id = ?1`
    )
    .bind(id, status, log ?? null, technician ?? null, postAction ?? null, appId ?? null)
    .run();
}
