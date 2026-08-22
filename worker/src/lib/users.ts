import type { Bindings } from "../types";
import { generateSalt, hashTechnicianPassword, type Role } from "./auth";

/**
 * Admin-UI account management, backed by the `technicians` table (see
 * migrations/0002_technicians.sql, 0011_user_roles.sql) and managed via the
 * Users tab (worker/src/routes/catalog.ts). Never selects password_hash/salt
 * into a response - those stay internal to auth.ts's verify/reset paths.
 */
export interface AppUser {
  username: string;
  role: Role;
  createdAt: string;
}

interface UserRow {
  username: string;
  role: Role;
  created_at: string;
}

function rowToUser(row: UserRow): AppUser {
  return { username: row.username, role: row.role, createdAt: row.created_at };
}

export async function listUsers(db: Bindings["DB"]): Promise<AppUser[]> {
  const { results } = await db
    .prepare(`SELECT username, role, created_at FROM technicians ORDER BY username`)
    .all<UserRow>();
  return (results ?? []).map(rowToUser);
}

export async function getUser(db: Bindings["DB"], username: string): Promise<AppUser | null> {
  const row = await db
    .prepare(`SELECT username, role, created_at FROM technicians WHERE username = ?1`)
    .bind(username)
    .first<UserRow>();
  return row ? rowToUser(row) : null;
}

export async function countAdmins(db: Bindings["DB"]): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) as n FROM technicians WHERE role = 'admin'`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function createUser(
  db: Bindings["DB"],
  pepper: string,
  input: { username: string; password: string; role: Role }
): Promise<void> {
  const salt = generateSalt();
  const passwordHash = await hashTechnicianPassword(pepper, salt, input.password);
  await db
    .prepare(`INSERT INTO technicians (username, password_hash, salt, role) VALUES (?1, ?2, ?3, ?4)`)
    .bind(input.username, passwordHash, salt, input.role)
    .run();
}

export async function setUserRole(db: Bindings["DB"], username: string, role: Role): Promise<boolean> {
  const { meta } = await db
    .prepare(`UPDATE technicians SET role = ?2 WHERE username = ?1`)
    .bind(username, role)
    .run();
  return meta.changes > 0;
}

export async function resetUserPassword(
  db: Bindings["DB"],
  pepper: string,
  username: string,
  newPassword: string
): Promise<boolean> {
  const salt = generateSalt();
  const passwordHash = await hashTechnicianPassword(pepper, salt, newPassword);
  const { meta } = await db
    .prepare(`UPDATE technicians SET password_hash = ?2, salt = ?3 WHERE username = ?1`)
    .bind(username, passwordHash, salt)
    .run();
  return meta.changes > 0;
}

export async function deleteUser(db: Bindings["DB"], username: string): Promise<boolean> {
  const { meta } = await db.prepare(`DELETE FROM technicians WHERE username = ?1`).bind(username).run();
  return meta.changes > 0;
}
