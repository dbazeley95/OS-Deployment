import { Hono } from "hono";
import type { Bindings } from "../types";
import { listDevices, upsertDevice } from "../lib/db";

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

export const devicesRoute = new Hono<{ Bindings: Bindings }>();

devicesRoute.get("/", async (c) => {
  const devices = await listDevices(c.env.DB);
  return c.json(devices);
});

devicesRoute.post("/", async (c) => {
  const body = await c.req.json<{ mac?: string; hostname?: string; serialNumber?: string }>().catch(() => null);
  if (!body?.mac || !MAC_RE.test(body.mac)) {
    return c.json({ error: "mac is required and must look like aa:bb:cc:dd:ee:ff" }, 400);
  }
  await upsertDevice(c.env.DB, body.mac.toLowerCase(), body.hostname, body.serialNumber);
  return c.json({ ok: true }, 201);
});
