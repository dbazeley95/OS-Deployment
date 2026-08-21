import type { Bindings } from "../types";

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

function parseBasicAuth(header: string | null): { username: string; password: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = atob(header.slice("Basic ".length));
  } catch {
    return null;
  }
  const idx = decoded.indexOf(":");
  if (idx === -1) return null;
  return { username: decoded.slice(0, idx), password: decoded.slice(idx + 1) };
}

const UNAUTHORIZED_HEADERS = { "WWW-Authenticate": 'Basic realm="OS Deployment", charset="UTF-8"' };

/**
 * Verifies a username/password pair against the technicians table.
 * Shared by the iPXE-facing Basic Auth check below and the JSON
 * deploy API (worker/src/routes/deploy.ts), which takes credentials from
 * a request body instead of an Authorization header.
 */
export async function verifyTechnicianCredentials(
  db: Bindings["DB"],
  pepper: string,
  username: string,
  password: string
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT password_hash, salt FROM technicians WHERE username = ?1`)
    .bind(username)
    .first<{ password_hash: string; salt: string }>();
  if (!row) return false;
  const computed = await hashTechnicianPassword(pepper, row.salt, password);
  return timingSafeEqual(computed, row.password_hash);
}

/**
 * Verifies HTTP Basic Auth against the technicians table. iPXE natively
 * prompts for credentials on a 401 and caches them per-host for the rest of
 * the boot session, so a technician is only prompted once even across
 * /boot/:mac and /boot/:mac/install.
 *
 * Returns the technician's username on success, or a 401 Response to return
 * directly from the route on failure.
 */
export async function requireTechnician(
  db: Bindings["DB"],
  pepper: string,
  authHeader: string | null
): Promise<string | Response> {
  const creds = parseBasicAuth(authHeader);
  if (!creds) {
    return new Response("Technician credentials required", { status: 401, headers: UNAUTHORIZED_HEADERS });
  }
  const valid = await verifyTechnicianCredentials(db, pepper, creds.username, creds.password);
  if (!valid) {
    return new Response("Invalid technician credentials", { status: 401, headers: UNAUTHORIZED_HEADERS });
  }
  return creds.username;
}
