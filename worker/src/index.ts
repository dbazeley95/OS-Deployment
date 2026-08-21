import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import { getCookie } from "hono/cookie";
import type { Bindings } from "./types";
import { bootRoute } from "./routes/boot";
import { devicesRoute } from "./routes/devices";
import { jobsRoute } from "./routes/jobs";
import { imagesRoute } from "./routes/images";
import { deployRoute } from "./routes/deploy";
import { authRoute } from "./routes/auth";
import { catalogRoute } from "./routes/catalog";
import { verifySessionToken } from "./lib/auth";

const app = new Hono<{ Bindings: Bindings }>();

app.use("/api/*", (c, next) => cors({ origin: c.env.ALLOWED_ORIGIN, credentials: true })(c, next));

// Gates the admin UI's own API behind a technician login (see routes/auth.ts).
// Does NOT cover /api/deploy/* (WinPE's own credential-in-body model), or
// /boot/*, /images/* (iPXE/WinPE fetch these directly, no browser session).
async function requireSession(c: Context<{ Bindings: Bindings }>, next: Next) {
  const username = await verifySessionToken(c.env.PASSWORD_PEPPER, getCookie(c, "session"));
  if (!username) return c.json({ error: "login required" }, 401);
  await next();
}
app.use("/api/devices/*", requireSession);
app.use("/api/jobs/*", requireSession);
app.use("/api/catalog/*", requireSession);

app.get("/", (c) => c.text("os-deployment-worker: see /api/devices, /api/jobs, /boot/:mac"));

app.route("/boot", bootRoute);
app.route("/images", imagesRoute);
app.route("/api/auth", authRoute);
app.route("/api/devices", devicesRoute);
app.route("/api/jobs", jobsRoute);
app.route("/api/catalog", catalogRoute);
app.route("/api/deploy", deployRoute);

export default app;
