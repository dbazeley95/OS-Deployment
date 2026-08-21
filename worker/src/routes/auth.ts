import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Bindings } from "../types";
import { signSessionToken, verifySessionToken, verifyTechnicianCredentials } from "../lib/auth";

export const authRoute = new Hono<{ Bindings: Bindings }>();

const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h

authRoute.post("/login", async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>().catch(() => null);
  if (!body?.username || !body.password) {
    return c.json({ error: "username and password are required" }, 400);
  }
  const valid = await verifyTechnicianCredentials(c.env.DB, c.env.PASSWORD_PEPPER, body.username, body.password);
  if (!valid) {
    return c.json({ error: "invalid credentials" }, 401);
  }
  const token = await signSessionToken(c.env.PASSWORD_PEPPER, body.username, SESSION_TTL_SECONDS);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return c.json({ username: body.username });
});

authRoute.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

authRoute.get("/me", async (c) => {
  const username = await verifySessionToken(c.env.PASSWORD_PEPPER, getCookie(c, SESSION_COOKIE));
  if (!username) return c.json({ error: "not logged in" }, 401);
  return c.json({ username });
});
