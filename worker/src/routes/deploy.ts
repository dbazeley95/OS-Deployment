import { Hono } from "hono";
import type { Bindings, PostAction } from "../types";
import { getPendingJobForMac, resolveOrCreateJob } from "../lib/db";
import { getProfile, listProfiles } from "../lib/profiles";
import { getApp, listApps } from "../lib/apps";
import { verifyTechnicianCredentials } from "../lib/auth";

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const VALID_POST_ACTIONS: PostAction[] = ["domain-join", "install-app", "autopilot"];

/**
 * JSON API for the WinPE deploy GUI (boot/winpe/DeployGui.ps1) - the
 * PowerShell equivalent of the iPXE Basic-Auth-driven /boot/:mac flow in
 * boot.ts, since a WinPE script doesn't get HTTP Basic Auth prompting for
 * free the way iPXE does.
 */
export const deployRoute = new Hono<{ Bindings: Bindings }>();

function imageUrl(origin: string, key: string): string {
  return `${origin}/images/${key}`;
}

async function deploymentPayload(
  db: Bindings["DB"],
  origin: string,
  profileId: string,
  postAction: PostAction,
  appId?: string | null
) {
  const profile = await getProfile(db, profileId);
  if (!profile) return null;
  const app = appId ? await getApp(db, appId) : undefined;
  return {
    status: "ready" as const,
    profile: profile.id,
    postAction,
    appId: app?.id,
    installWim: imageUrl(origin, profile.installWim),
    imageIndex: profile.imageIndex,
    answerFileUrl: imageUrl(origin, profile.answerFile),
    postActionScriptUrl: imageUrl(origin, "winpe/PostAction.ps1"),
    appUrl: app ? imageUrl(origin, app.r2Key) : undefined,
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
  const origin = new URL(c.req.url).origin;
  const job = await getPendingJobForMac(c.env.DB, mac);

  if (job?.post_action) {
    const payload = await deploymentPayload(c.env.DB, origin, job.os_profile, job.post_action, job.app_id);
    if (payload) return c.json(payload);
  }
  if (job) {
    return c.json({ status: "choose-action", profile: job.os_profile, apps: await listApps(c.env.DB) });
  }
  const profiles = await listProfiles(c.env.DB);
  return c.json({
    status: "choose",
    profiles: profiles.map((p) => ({ id: p.id, label: p.label })),
    apps: await listApps(c.env.DB),
  });
});

deployRoute.post("/select", async (c) => {
  const body = await c
    .req.json<{
      mac?: string;
      username?: string;
      password?: string;
      profile?: string;
      postAction?: string;
      appId?: string;
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

  if (!body.profile || !(await getProfile(c.env.DB, body.profile))) {
    const profiles = await listProfiles(c.env.DB);
    return c.json({ error: `profile must be one of: ${profiles.map((p) => p.id).join(", ")}` }, 400);
  }
  if (!body.postAction || !VALID_POST_ACTIONS.includes(body.postAction as PostAction)) {
    return c.json({ error: `postAction must be one of: ${VALID_POST_ACTIONS.join(", ")}` }, 400);
  }
  if (body.postAction === "install-app" && (!body.appId || !(await getApp(c.env.DB, body.appId)))) {
    const apps = await listApps(c.env.DB);
    return c.json({ error: `appId must be one of: ${apps.map((a) => a.id).join(", ")}` }, 400);
  }

  const mac = body.mac.toLowerCase();
  const postAction = body.postAction as PostAction;
  await resolveOrCreateJob(c.env.DB, mac, body.profile, {
    technician: body.username,
    log: `selected via WinPE by ${body.username}`,
    postAction,
    appId: body.appId,
  });

  const origin = new URL(c.req.url).origin;
  const payload = await deploymentPayload(c.env.DB, origin, body.profile, postAction, body.appId);
  return c.json(payload);
});
