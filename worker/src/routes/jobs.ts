import { Hono } from "hono";
import type { Bindings, JobStatus } from "../types";
import { createJob, listJobs, updateJobStatus, updateLatestJobStatusForMac } from "../lib/db";
import { getProfile, listProfiles } from "../lib/profiles";

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const VALID_STATUSES: JobStatus[] = ["pending", "booted", "installing", "complete", "failed"];

export const jobsRoute = new Hono<{ Bindings: Bindings }>();

jobsRoute.get("/", async (c) => {
  const jobs = await listJobs(c.env.DB);
  return c.json(jobs);
});

jobsRoute.post("/", async (c) => {
  const body = await c.req.json<{ mac?: string; os_profile?: string; hostname?: string }>().catch(() => null);
  if (!body?.mac || !MAC_RE.test(body.mac)) {
    return c.json({ error: "mac is required and must look like aa:bb:cc:dd:ee:ff" }, 400);
  }
  if (!body.os_profile || !(await getProfile(c.env.DB, body.os_profile))) {
    const profiles = await listProfiles(c.env.DB);
    return c.json({ error: `os_profile must be one of: ${profiles.map((p) => p.id).join(", ")}` }, 400);
  }
  const id = await createJob(c.env.DB, body.mac.toLowerCase(), body.os_profile, { hostname: body.hostname });
  return c.json({ id }, 201);
});

// Phone-home endpoint for post-install scripts, which know their MAC but not
// their numeric job id (answer files are static templates - see boot/profiles/README.md).
// Registered before /:id so "by-mac" is never swallowed as a job id param.
jobsRoute.patch("/by-mac/:mac", async (c) => {
  const mac = c.req.param("mac").toLowerCase();
  if (!MAC_RE.test(mac)) {
    return c.json({ error: "invalid mac" }, 400);
  }
  const body = await c.req.json<{ status?: string; log?: string }>().catch(() => null);
  if (!body?.status || !VALID_STATUSES.includes(body.status as JobStatus)) {
    return c.json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, 400);
  }
  const found = await updateLatestJobStatusForMac(c.env.DB, mac, body.status as JobStatus, body.log);
  if (!found) {
    return c.json({ error: "no job found for this mac" }, 404);
  }
  return c.json({ ok: true });
});

// Called by an admin to mark a job's status directly by its numeric id.
jobsRoute.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) {
    return c.json({ error: "invalid job id" }, 400);
  }
  const body = await c.req.json<{ status?: string; log?: string }>().catch(() => null);
  if (!body?.status || !VALID_STATUSES.includes(body.status as JobStatus)) {
    return c.json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, 400);
  }
  await updateJobStatus(c.env.DB, id, body.status as JobStatus, body.log);
  return c.json({ ok: true });
});
