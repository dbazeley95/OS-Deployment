import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import { getCookie } from "hono/cookie";
import type { Bindings, Variables } from "./types";
import { devicesRoute } from "./routes/devices";
import { jobsRoute } from "./routes/jobs";
import { imagesRoute } from "./routes/images";
import { deployRoute } from "./routes/deploy";
import { authRoute } from "./routes/auth";
import { catalogRoute } from "./routes/catalog";
import { getTechnicianRole, verifySessionToken } from "./lib/auth";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("/api/*", (c, next) => cors({ origin: c.env.ALLOWED_ORIGIN, credentials: true })(c, next));

// Gates the admin UI's own API behind a technician login (see routes/auth.ts).
// Does NOT cover /api/deploy/* (WinPE's own credential-in-body model), or
// /images/* (WinPE fetches these directly, no browser session). Role is
// looked up fresh from D1 on every request (not embedded in the session
// token) so a role change or account deletion takes effect immediately.
async function requireSession(c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) {
  const username = await verifySessionToken(c.env.PASSWORD_PEPPER, getCookie(c, "session"));
  if (!username) return c.json({ error: "login required" }, 401);
  const role = await getTechnicianRole(c.env.DB, username);
  if (!role) return c.json({ error: "login required" }, 401); // account deleted since the token was issued
  c.set("username", username);
  c.set("role", role);
  await next();
}
app.use("/api/devices/*", requireSession);
app.use("/api/jobs/*", requireSession);
app.use("/api/catalog/*", requireSession);

app.get("/", (c) => c.text("W.I.P.E API: see /api/devices, /api/jobs"));

app.route("/images", imagesRoute);
app.route("/api/auth", authRoute);
app.route("/api/devices", devicesRoute);
app.route("/api/jobs", jobsRoute);
app.route("/api/catalog", catalogRoute);
app.route("/api/deploy", deployRoute);

export default app;
