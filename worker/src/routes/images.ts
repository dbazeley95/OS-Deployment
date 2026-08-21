import { Hono } from "hono";
import type { Bindings } from "../types";

export const imagesRoute = new Hono<{ Bindings: Bindings }>();

// Streams objects out of R2 so WinPE only ever needs to know this Worker's
// origin, not the R2 bucket's public URL.
imagesRoute.get("/*", async (c) => {
  const key = c.req.path.replace(/^\/images\//, "");
  const object = await c.env.IMAGES.get(key);
  if (!object) {
    return c.text("not found", 404);
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
});
