import { Hono } from "hono";
import type { Bindings } from "../types";
import { getPendingJobForMac, updateJobStatus } from "../lib/db";
import { getProfile } from "../lib/profiles";
import { buildBootScript, idleBootScript } from "../lib/ipxe";

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

export const bootRoute = new Hono<{ Bindings: Bindings }>();

// iPXE chainloads this URL. Must stay unauthenticated: the machine has no
// credentials yet. Treat the MAC as the trust boundary (see ARCHITECTURE.md).
bootRoute.get("/:mac", async (c) => {
  const mac = c.req.param("mac").toLowerCase();
  if (!MAC_RE.test(mac)) {
    return c.text(idleBootScript("Malformed MAC address"), 200, {
      "Content-Type": "text/plain",
    });
  }

  const job = await getPendingJobForMac(c.env.DB, mac);
  if (!job) {
    return c.text(idleBootScript("No pending deployment job"), 200, {
      "Content-Type": "text/plain",
    });
  }

  const profile = getProfile(job.os_profile);
  if (!profile) {
    return c.text(idleBootScript(`Unknown OS profile: ${job.os_profile}`), 200, {
      "Content-Type": "text/plain",
    });
  }

  await updateJobStatus(c.env.DB, job.id, "booted");

  const origin = new URL(c.req.url).origin;
  return c.text(buildBootScript(profile, origin), 200, { "Content-Type": "text/plain" });
});
