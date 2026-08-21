import type { Bindings } from "../types";

/**
 * Catalog of apps/scripts the "install-app" post-imaging action can
 * silently run after Windows finishes installing, backed by the `apps` D1
 * table (see migrations/0004_catalog.sql) and managed via the admin UI's
 * catalog editor (worker/src/routes/catalog.ts). Upload the installer/script
 * itself to R2 with scripts/upload-image.sh, then add an entry pointing at
 * its key.
 */
export type InstallKind = "msi" | "exe" | "script";

export interface AppEntry {
  id: string;
  label: string;
  /** R2 key for the installer/script file. */
  r2Key: string;
  installKind: InstallKind;
}

interface AppRow {
  id: string;
  label: string;
  r2_key: string;
  install_kind: InstallKind;
}

function rowToApp(row: AppRow): AppEntry {
  return { id: row.id, label: row.label, r2Key: row.r2_key, installKind: row.install_kind };
}

export interface AppInput {
  id: string;
  label: string;
  r2Key: string;
  installKind: InstallKind;
}

export async function listApps(db: Bindings["DB"]): Promise<AppEntry[]> {
  const { results } = await db.prepare(`SELECT * FROM apps ORDER BY label`).all<AppRow>();
  return (results ?? []).map(rowToApp);
}

export async function getApp(db: Bindings["DB"], id: string): Promise<AppEntry | null> {
  const row = await db.prepare(`SELECT * FROM apps WHERE id = ?1`).bind(id).first<AppRow>();
  return row ? rowToApp(row) : null;
}

export async function createApp(db: Bindings["DB"], input: AppInput): Promise<void> {
  await db
    .prepare(`INSERT INTO apps (id, label, r2_key, install_kind) VALUES (?1, ?2, ?3, ?4)`)
    .bind(input.id, input.label, input.r2Key, input.installKind)
    .run();
}

export async function updateApp(db: Bindings["DB"], id: string, input: AppInput): Promise<boolean> {
  const { meta } = await db
    .prepare(
      `UPDATE apps SET label = ?2, r2_key = ?3, install_kind = ?4, updated_at = datetime('now') WHERE id = ?1`
    )
    .bind(id, input.label, input.r2Key, input.installKind)
    .run();
  return meta.changes > 0;
}

export async function deleteApp(db: Bindings["DB"], id: string): Promise<boolean> {
  const { meta } = await db.prepare(`DELETE FROM apps WHERE id = ?1`).bind(id).run();
  return meta.changes > 0;
}
