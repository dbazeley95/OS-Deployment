import { Hono } from "hono";
import type { Bindings, JobStatus } from "../types";
import { listJobs, updateJobStatus, updateLatestJobStatusForMac } from "../lib/db";

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const VALID_STATUSES: JobStatus[] = ["pending", "booted", "installing", "complete", "failed"];

// A log of in-progress/complete deployments - there's no admin-side job
// creation here on purpose. Every deployment starts on-device, via the
// WinPE wizard (DeployGui.ps1) authenticating against /api/deploy/*; this
// route only ever reads or corrects records that flow already created.
export const jobsRoute = new Hono<{ Bindings: Bindings }>();

jobsRoute.get("/", async (c) => {
  const jobs = await listJobs(c.env.DB);
  return c.json(jobs);
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

// Manual correction of an existing job's status/log by its numeric id -
// not a way to create or schedule a new deployment.
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
