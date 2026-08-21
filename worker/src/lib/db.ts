import type { Bindings, DeploymentJob, Device, JobStatus } from "../types";

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

export async function getDevice(db: Bindings["DB"], mac: string): Promise<Device | null> {
  const device = await db.prepare(`SELECT * FROM devices WHERE mac = ?1`).bind(mac).first<Device>();
  return device ?? null;
}

export async function createJob(
  db: Bindings["DB"],
  mac: string,
  osProfile: string,
  opts?: { hostname?: string; technician?: string; taskSequenceId?: string; domainJoin?: boolean; domain?: string }
): Promise<number> {
  await upsertDevice(db, mac, opts?.hostname);
  const { meta } = await db
    .prepare(
      `INSERT INTO deployment_jobs (device_mac, os_profile, technician, task_sequence_id, domain_join, domain)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    )
    .bind(
      mac,
      osProfile,
      opts?.technician ?? null,
      opts?.taskSequenceId ?? null,
      opts?.domainJoin ? 1 : 0,
      opts?.domain ?? null
    )
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
 * (e.g. a retry after this same machine got partway through a previous
 * boot), otherwise creates one - then marks it booted either way. Shared
 * by /boot/:mac/install (worker/src/routes/boot.ts) and the JSON deploy
 * API (worker/src/routes/deploy.ts) so both entry points behave
 * identically. There's no admin-side job creation - every job originates
 * on-device.
 */
export async function resolveOrCreateJob(
  db: Bindings["DB"],
  mac: string,
  profileId: string,
  opts: {
    technician: string;
    log: string;
    taskSequenceId?: string;
    domainJoin?: boolean;
    domain?: string;
    hostname?: string;
  }
): Promise<number> {
  // hostname may be entered fresh even if a job for this mac already exists
  // (upsertDevice is idempotent), so record it unconditionally.
  if (opts.hostname) await upsertDevice(db, mac, opts.hostname);

  const existing = await getPendingJobForMac(db, mac);
  const id =
    existing && existing.os_profile === profileId
      ? existing.id
      : await createJob(db, mac, profileId, {
          technician: opts.technician,
          taskSequenceId: opts.taskSequenceId,
          domainJoin: opts.domainJoin,
          domain: opts.domain,
        });
  await updateJobStatus(db, id, "booted", opts.log, opts.technician, opts.taskSequenceId, opts.domainJoin, opts.domain);
  return id;
}

export async function updateJobStatus(
  db: Bindings["DB"],
  id: number,
  status: JobStatus,
  log?: string,
  technician?: string,
  taskSequenceId?: string,
  domainJoin?: boolean,
  domain?: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE deployment_jobs SET status = ?2, log = COALESCE(?3, log),
         technician = COALESCE(?4, technician),
         task_sequence_id = COALESCE(?5, task_sequence_id),
         domain_join = COALESCE(?6, domain_join),
         domain = COALESCE(?7, domain),
         updated_at = datetime('now')
       WHERE id = ?1`
    )
    .bind(
      id,
      status,
      log ?? null,
      technician ?? null,
      taskSequenceId ?? null,
      domainJoin === undefined ? null : domainJoin ? 1 : 0,
      domain ?? null
    )
    .run();
}
