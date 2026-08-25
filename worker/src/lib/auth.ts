import { createMiddleware } from "hono/factory";
import type { Bindings, Variables } from "../types";

/**
 * Admin (full CRUD everywhere, including managing other users),
 * technician (create/edit catalog items, no delete, no user management
 * beyond their own password), beginner (read-only everywhere, own
 * password only). See worker/src/index.ts's requireRole middleware.
 */
export type Role = "admin" | "technician" | "beginner";

export const ROLE_RANK: Record<Role, number> = { beginner: 0, technician: 1, admin: 2 };

/** Random hex salt for a new/reset password - nothing generated one before, since accounts were only ever created by hand. */
export function generateSalt(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Domain-separated so this can't be confused with any other HMAC use of the same pepper. */
export async function hashTechnicianPassword(pepper: string, salt: string, password: string): Promise<string> {
  return hmacSha256Hex(pepper, `technician-password:${salt}:${password}`);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies a username/password pair against the technicians table. Used by
 * the JSON deploy API (worker/src/routes/deploy.ts), which takes credentials
 * from a request body. The username match is case-insensitive (COLLATE
 * NOCASE) - technicians shouldn't have to remember exact capitalization to
 * sign in. Returns the *stored* username on success (not necessarily the
 * same casing the caller typed), so callers record/display the canonical
 * form consistently regardless of how a given technician happened to type
 * it that day - not a boolean, since "was this valid" and "what's their
 * canonical username" are both needed by every caller.
 */
export async function verifyTechnicianCredentials(
  db: Bindings["DB"],
  pepper: string,
  username: string,
  password: string
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT username, password_hash, salt FROM technicians WHERE username = ?1 COLLATE NOCASE`)
    .bind(username)
    .first<{ username: string; password_hash: string; salt: string }>();
  if (!row) return null;
  const computed = await hashTechnicianPassword(pepper, row.salt, password);
  return timingSafeEqual(computed, row.password_hash) ? row.username : null;
}

/**
 * Looked up fresh from D1 on every request (never embedded in the signed
 * session token below) so a role change or account deletion takes effect on
 * the user's very next request instead of waiting for their session to
 * expire. Returns null if the account no longer exists.
 */
export async function getTechnicianRole(db: Bindings["DB"], username: string): Promise<Role | null> {
  const row = await db
    .prepare(`SELECT role FROM technicians WHERE username = ?1 COLLATE NOCASE`)
    .bind(username)
    .first<{ role: Role }>();
  return row?.role ?? null;
}

/**
 * Applied per-route in routes/catalog.ts on top of the requireSession
 * middleware in index.ts. Built with Hono's createMiddleware() rather than a
 * hand-written (c, next) => ... function - that's what keeps the route's
 * own path-param typing (e.g. c.req.param("id") being `string` not `string |
 * undefined`) intact for the handler that follows it in the chain.
 */
export function requireRole(min: Role) {
  return createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
    if (ROLE_RANK[c.get("role")] < ROLE_RANK[min]) {
      return c.json({ error: "insufficient permissions" }, 403);
    }
    await next();
  });
}

function base64UrlEncode(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return atob(padded + pad);
}

/**
 * Signed, stateless admin-UI session tokens - `<base64url payload>.<hmac hex>`,
 * verified against the same PASSWORD_PEPPER secret used for technician
 * passwords (domain-separated via the "session:" prefix). Used by
 * worker/src/routes/auth.ts (login/logout) and the session-check middleware
 * in worker/src/index.ts that gates /api/devices, /api/jobs, /api/catalog -
 * NOT /api/deploy/* (WinPE's own credential model) or /images/*.
 */
export async function signSessionToken(pepper: string, username: string, ttlSeconds: number): Promise<string> {
  const payload = base64UrlEncode(JSON.stringify({ u: username, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = await hmacSha256Hex(pepper, `session:${payload}`);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(pepper: string, token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expectedSig = await hmacSha256Hex(pepper, `session:${payload}`);
  if (!timingSafeEqual(sig, expectedSig)) return null;
  let parsed: { u?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(base64UrlDecode(payload));
  } catch {
    return null;
  }
  if (typeof parsed.u !== "string" || typeof parsed.exp !== "number") return null;
  if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
  return parsed.u;
}
