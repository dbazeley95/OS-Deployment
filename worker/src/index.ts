import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Bindings } from "./types";
import { bootRoute } from "./routes/boot";
import { devicesRoute } from "./routes/devices";
import { jobsRoute } from "./routes/jobs";
import { imagesRoute } from "./routes/images";
import { deployRoute } from "./routes/deploy";

const app = new Hono<{ Bindings: Bindings }>();

app.use("/api/*", (c, next) => cors({ origin: c.env.ALLOWED_ORIGIN })(c, next));

app.get("/", (c) => c.text("os-deployment-worker: see /api/devices, /api/jobs, /boot/:mac"));

app.route("/boot", bootRoute);
app.route("/images", imagesRoute);
app.route("/api/devices", devicesRoute);
app.route("/api/jobs", jobsRoute);
app.route("/api/deploy", deployRoute);

export default app;
