import { Hono } from "hono";
import type { Bindings } from "../types";
import { getPendingJobForMac, resolveOrCreateJob, updateJobStatus } from "../lib/db";
import { getProfile, listProfiles } from "../lib/profiles";
import { buildBootScript, buildMenuScript, idleBootScript } from "../lib/ipxe";
import { requireTechnician } from "../lib/auth";

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const IPXE_HEADERS = { "Content-Type": "text/plain" };

export const bootRoute = new Hono<{ Bindings: Bindings }>();

// iPXE chainloads this URL. Requires HTTP Basic Auth against the
// technicians table - iPXE prompts for credentials natively on a 401 and
// caches them per-host for the rest of the boot session (see auth.ts).
bootRoute.get("/:mac", async (c) => {
  const mac = c.req.param("mac").toLowerCase();
  if (!MAC_RE.test(mac)) {
    return c.text(idleBootScript("Malformed MAC address"), 200, IPXE_HEADERS);
  }

  const auth = await requireTechnician(c.env.DB, c.env.PASSWORD_PEPPER, c.req.header("Authorization") ?? null);
  if (auth instanceof Response) return auth;
  const technician = auth;

  const job = await getPendingJobForMac(c.env.DB, mac);
  if (!job) {
    const origin = new URL(c.req.url).origin;
    return c.text(buildMenuScript(listProfiles(), mac, origin), 200, IPXE_HEADERS);
  }

  const profile = getProfile(job.os_profile);
  if (!profile) {
    return c.text(idleBootScript(`Unknown OS profile: ${job.os_profile}`), 200, IPXE_HEADERS);
  }

  await updateJobStatus(c.env.DB, job.id, "booted", `confirmed by ${technician}`, technician);

  const origin = new URL(c.req.url).origin;
  return c.text(buildBootScript(profile, origin), 200, IPXE_HEADERS);
});

// Reached from the boot menu once a technician picks a profile for a MAC
// with no pre-staged job. Same auth as /:mac.
bootRoute.get("/:mac/install", async (c) => {
  const mac = c.req.param("mac").toLowerCase();
  if (!MAC_RE.test(mac)) {
    return c.text(idleBootScript("Malformed MAC address"), 200, IPXE_HEADERS);
  }

  const auth = await requireTechnician(c.env.DB, c.env.PASSWORD_PEPPER, c.req.header("Authorization") ?? null);
  if (auth instanceof Response) return auth;
  const technician = auth;

  const profileId = c.req.query("profile") ?? "";
  const profile = getProfile(profileId);
  if (!profile) {
    return c.text(idleBootScript(`Unknown OS profile: ${profileId}`), 200, IPXE_HEADERS);
  }

  await resolveOrCreateJob(c.env.DB, mac, profile.id, { technician, log: `selected by ${technician}` });

  const origin = new URL(c.req.url).origin;
  return c.text(buildBootScript(profile, origin), 200, IPXE_HEADERS);
});
