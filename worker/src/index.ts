import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings, Variables } from "./types";
import { devicesRoute } from "./routes/devices";
import { jobsRoute } from "./routes/jobs";
import { imagesRoute } from "./routes/images";
import { deployRoute } from "./routes/deploy";
import { authRoute } from "./routes/auth";
import { catalogRoute } from "./routes/catalog";
import { requireSession } from "./lib/auth";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("/api/*", (c, next) => cors({ origin: c.env.ALLOWED_ORIGIN, credentials: true })(c, next));

// Gates the admin UI's own API behind a technician login (see routes/auth.ts
// and lib/auth.ts's requireSession). Does NOT cover /api/deploy/* (WinPE's
// own credential-in-body model), /images/* (WinPE fetches these directly, no
// browser session), or /api/jobs/by-mac/* (the phone-home endpoint post-
// install scripts call - also no browser session, so routes/jobs.ts applies
// requireSession per-route there instead of blanket, to exclude just that one).
app.use("/api/devices/*", requireSession);
app.use("/api/catalog/*", requireSession);

app.get("/", (c) => c.text("W.I.P.E API: see /api/devices, /api/jobs"));

app.route("/images", imagesRoute);
app.route("/api/auth", authRoute);
app.route("/api/devices", devicesRoute);
app.route("/api/jobs", jobsRoute);
app.route("/api/catalog", catalogRoute);
app.route("/api/deploy", deployRoute);

export default app;
