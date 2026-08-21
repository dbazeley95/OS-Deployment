import { Hono } from "hono";
import type { Bindings } from "../types";
import { getDevice, getPendingJobForMac, resolveOrCreateJob } from "../lib/db";
import { getProfile } from "../lib/profiles";
import { getTaskSequence, listTaskSequences, resolveTaskSequence } from "../lib/taskSequences";
import { verifyTechnicianCredentials } from "../lib/auth";

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

/**
 * JSON API for the WinPE deploy GUI (boot/winpe/DeployGui.ps1) - the
 * PowerShell equivalent of the iPXE Basic-Auth-driven /boot/:mac flow in
 * boot.ts, since a WinPE script doesn't get HTTP Basic Auth prompting for
 * free the way iPXE does.
 *
 * Domain-join credentials (username/password) are never sent here - only
 * the domain *name* is. DeployGui.ps1 collects the credentials locally and
 * writes them straight into the target disk's post-action.json, so a
 * domain admin credential never touches the Worker/D1 or the wire.
 */
export const deployRoute = new Hono<{ Bindings: Bindings }>();

function imageUrl(origin: string, key: string): string {
  return `${origin}/images/${key}`;
}

async function deploymentPayload(
  db: Bindings["DB"],
  origin: string,
  mac: string,
  taskSequenceId: string,
  domainJoin: boolean,
  domain?: string | null
) {
  const sequence = await resolveTaskSequence(db, taskSequenceId);
  if (!sequence) return null;
  const profile = await getProfile(db, sequence.osProfileId);
  if (!profile) return null;
  const device = await getDevice(db, mac);
  return {
    status: "ready" as const,
    taskSequence: sequence.id,
    profile: profile.id,
    domainJoin,
    domain: domainJoin ? (domain ?? null) : undefined,
    hostname: device?.hostname ?? null,
    installWim: imageUrl(origin, profile.installWim),
    imageIndex: profile.imageIndex,
    answerFileUrl: imageUrl(origin, profile.answerFile),
    postActionScriptUrl: imageUrl(origin, "winpe/PostAction.ps1"),
    steps: sequence.steps.map((app) => ({
      label: app.label,
      installKind: app.installKind,
      appUrl: imageUrl(origin, app.r2Key),
    })),
  };
}

deployRoute.post("/auth", async (c) => {
  const body = await c.req.json<{ mac?: string; username?: string; password?: string }>().catch(() => null);
  if (!body?.mac || !MAC_RE.test(body.mac)) {
    return c.json({ error: "mac is required and must look like aa:bb:cc:dd:ee:ff" }, 400);
  }
  if (!body.username || !body.password) {
    return c.json({ error: "username and password are required" }, 400);
  }
  const valid = await verifyTechnicianCredentials(c.env.DB, c.env.PASSWORD_PEPPER, body.username, body.password);
  if (!valid) {
    return c.json({ error: "invalid technician credentials" }, 401);
  }

  const mac = body.mac.toLowerCase();
  const job = await getPendingJobForMac(c.env.DB, mac);

  if (job?.task_sequence_id) {
    const device = await getDevice(c.env.DB, mac);
    return c.json({
      status: "ready",
      taskSequenceId: job.task_sequence_id,
      hostname: device?.hostname ?? null,
      domainJoin: Boolean(job.domain_join),
      domain: job.domain,
    });
  }

  const sequences = await listTaskSequences(c.env.DB);
  const withLabels = await Promise.all(
    sequences.map(async (s) => ({
      id: s.id,
      label: s.label,
      osProfileLabel: (await getProfile(c.env.DB, s.osProfileId))?.label ?? s.osProfileId,
    }))
  );
  return c.json({ status: "choose", taskSequences: withLabels });
});

deployRoute.post("/select", async (c) => {
  const body = await c
    .req.json<{
      mac?: string;
      username?: string;
      password?: string;
      hostname?: string;
      serialNumber?: string;
      taskSequenceId?: string;
      domainJoin?: boolean;
      domain?: string;
    }>()
    .catch(() => null);
  if (!body?.mac || !MAC_RE.test(body.mac)) {
    return c.json({ error: "mac is required and must look like aa:bb:cc:dd:ee:ff" }, 400);
  }
  if (!body.username || !body.password) {
    return c.json({ error: "username and password are required" }, 400);
  }
  const valid = await verifyTechnicianCredentials(c.env.DB, c.env.PASSWORD_PEPPER, body.username, body.password);
  if (!valid) {
    return c.json({ error: "invalid technician credentials" }, 401);
  }

  if (!body.hostname?.trim()) {
    return c.json({ error: "hostname is required" }, 400);
  }
  if (!body.taskSequenceId || !(await getTaskSequence(c.env.DB, body.taskSequenceId))) {
    const sequences = await listTaskSequences(c.env.DB);
    return c.json({ error: `taskSequenceId must be one of: ${sequences.map((s) => s.id).join(", ")}` }, 400);
  }
  if (body.domainJoin && !body.domain?.trim()) {
    return c.json({ error: "domain is required when domainJoin is true" }, 400);
  }

  const mac = body.mac.toLowerCase();
  const sequence = await getTaskSequence(c.env.DB, body.taskSequenceId);
  const profile = await getProfile(c.env.DB, sequence!.osProfileId);
  if (!profile) {
    return c.json({ error: `task sequence ${body.taskSequenceId} references an unknown OS profile` }, 400);
  }

  await resolveOrCreateJob(c.env.DB, mac, profile.id, {
    technician: body.username,
    log: `selected via WinPE by ${body.username}`,
    taskSequenceId: body.taskSequenceId,
    domainJoin: Boolean(body.domainJoin),
    domain: body.domainJoin ? body.domain : undefined,
    hostname: body.hostname,
    serialNumber: body.serialNumber,
  });

  const origin = new URL(c.req.url).origin;
  const payload = await deploymentPayload(
    c.env.DB,
    origin,
    mac,
    body.taskSequenceId,
    Boolean(body.domainJoin),
    body.domain
  );
  return c.json(payload);
});
