import type { Bindings } from "../types";

/**
 * Catalog of OS profiles this deployment system knows how to install,
 * backed by the `os_profiles` D1 table (see migrations/0004_catalog.sql)
 * and managed via the admin UI's catalog editor
 * (worker/src/routes/catalog.ts) rather than a code change + redeploy.
 */
export interface OsProfile {
  id: string;
  label: string;
  /** R2 key for this profile's WIM, applied via `DISM /Apply-Image` in the WinPE deploy flow. */
  installWim: string;
  /** WIM image index within installWim for this edition. */
  imageIndex: number;
}

interface OsProfileRow {
  id: string;
  label: string;
  install_wim_key: string;
  image_index: number;
}

function rowToProfile(row: OsProfileRow): OsProfile {
  return {
    id: row.id,
    label: row.label,
    installWim: row.install_wim_key,
    imageIndex: row.image_index,
  };
}

export interface OsProfileInput {
  id: string;
  label: string;
  installWim: string;
  imageIndex: number;
}

export async function listProfiles(db: Bindings["DB"]): Promise<OsProfile[]> {
  const { results } = await db.prepare(`SELECT * FROM os_profiles ORDER BY label`).all<OsProfileRow>();
  return (results ?? []).map(rowToProfile);
}

export async function getProfile(db: Bindings["DB"], id: string): Promise<OsProfile | null> {
  const row = await db.prepare(`SELECT * FROM os_profiles WHERE id = ?1`).bind(id).first<OsProfileRow>();
  return row ? rowToProfile(row) : null;
}

export async function createProfile(db: Bindings["DB"], input: OsProfileInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO os_profiles (id, label, install_wim_key, image_index)
       VALUES (?1, ?2, ?3, ?4)`
    )
    .bind(input.id, input.label, input.installWim, input.imageIndex)
    .run();
}

export async function updateProfile(db: Bindings["DB"], id: string, input: OsProfileInput): Promise<boolean> {
  const { meta } = await db
    .prepare(
      `UPDATE os_profiles SET label = ?2, install_wim_key = ?3, image_index = ?4,
         updated_at = datetime('now')
       WHERE id = ?1`
    )
    .bind(id, input.label, input.installWim, input.imageIndex)
    .run();
  return meta.changes > 0;
}

export async function deleteProfile(db: Bindings["DB"], id: string): Promise<boolean> {
  const { meta } = await db.prepare(`DELETE FROM os_profiles WHERE id = ?1`).bind(id).run();
  return meta.changes > 0;
}
