import type { Bindings } from "../types";

/**
 * Catalog of apps/scripts that can be silently installed after Windows
 * finishes, backed by the `apps` D1 table (see migrations/0004_catalog.sql)
 * and managed via the admin UI's catalog editor (worker/src/routes/catalog.ts).
 * Referenced by task sequences (worker/src/lib/taskSequences.ts) as ordered
 * steps - installKind="script" also covers arbitrary "customizations", so
 * there's no separate catalog for those. Upload the installer/script itself
 * to R2 with scripts/upload-image.sh, then add an entry pointing at its key.
 */
export type InstallKind = "msi" | "exe" | "script";

export interface AppEntry {
  id: string;
  label: string;
  /** R2 key for the installer/script file. */
  r2Key: string;
  installKind: InstallKind;
  /**
   * Verbatim command-line arguments for msiexec ("msi") or the installer exe
   * ("exe") - there's no silent-install switch that works across arbitrary
   * EXE installers, so this overrides PostAction.ps1's default per app when
   * set. Ignored for installKind="script" (the script decides its own args).
   */
  installArgs: string | null;
}

interface AppRow {
  id: string;
  label: string;
  r2_key: string;
  install_kind: InstallKind;
  install_args: string | null;
}

function rowToApp(row: AppRow): AppEntry {
  return {
    id: row.id,
    label: row.label,
    r2Key: row.r2_key,
    installKind: row.install_kind,
    installArgs: row.install_args,
  };
}

export interface AppInput {
  id: string;
  label: string;
  r2Key: string;
  installKind: InstallKind;
  installArgs: string | null;
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
    .prepare(`INSERT INTO apps (id, label, r2_key, install_kind, install_args) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(input.id, input.label, input.r2Key, input.installKind, input.installArgs)
    .run();
}

export async function updateApp(db: Bindings["DB"], id: string, input: AppInput): Promise<boolean> {
  const { meta } = await db
    .prepare(
      `UPDATE apps SET label = ?2, r2_key = ?3, install_kind = ?4, install_args = ?5, updated_at = datetime('now') WHERE id = ?1`
    )
    .bind(id, input.label, input.r2Key, input.installKind, input.installArgs)
    .run();
  return meta.changes > 0;
}

export async function deleteApp(db: Bindings["DB"], id: string): Promise<boolean> {
  const { meta } = await db.prepare(`DELETE FROM apps WHERE id = ?1`).bind(id).run();
  return meta.changes > 0;
}
