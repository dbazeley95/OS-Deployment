import type { Bindings } from "../types";

/**
 * Catalog of OS profiles this deployment system knows how to install,
 * backed by the `os_profiles` D1 table (see migrations/0004_catalog.sql,
 * 0013_fileshare_wim_source.sql) and managed via the admin UI's catalog
 * editor (worker/src/routes/catalog.ts) rather than a code change + redeploy.
 */
export type OsProfileSourceType = "r2" | "fileshare";

export interface OsProfile {
  id: string;
  label: string;
  sourceType: OsProfileSourceType;
  /** R2 key for this profile's WIM (sourceType "r2"), applied via `DISM /Apply-Image`. */
  installWim: string | null;
  /**
   * UNC path to install.wim on a Windows file share (sourceType "fileshare") -
   * an alternative to R2 for when several machines are building at once, so
   * the WinPE deploy flow pulls over the LAN instead of repeatedly through
   * the Worker/R2 over the internet. Read using the same credentials
   * DeployGui.ps1 already collects for domain-join - no separate prompt.
   */
  fileSharePath: string | null;
  /** WIM image index within installWim/fileSharePath for this edition. */
  imageIndex: number;
}

interface OsProfileRow {
  id: string;
  label: string;
  source_type: OsProfileSourceType;
  // NOT NULL in D1 (a full rebuild to relax it is blocked by D1's foreign-key
  // enforcement - see migrations/0013_fileshare_wim_source.sql) - a
  // fileshare-sourced row stores '' here instead. Normalized to/from null at
  // this boundary so the rest of the app only ever sees the clean
  // `string | null` contract on OsProfile.installWim.
  install_wim_key: string;
  file_share_path: string | null;
  image_index: number;
}

function rowToProfile(row: OsProfileRow): OsProfile {
  return {
    id: row.id,
    label: row.label,
    sourceType: row.source_type,
    installWim: row.install_wim_key || null,
    fileSharePath: row.file_share_path,
    imageIndex: row.image_index,
  };
}

export interface OsProfileInput {
  id: string;
  label: string;
  sourceType: OsProfileSourceType;
  installWim: string | null;
  fileSharePath: string | null;
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
      `INSERT INTO os_profiles (id, label, source_type, install_wim_key, file_share_path, image_index)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    )
    .bind(input.id, input.label, input.sourceType, input.installWim ?? "", input.fileSharePath, input.imageIndex)
    .run();
}

export async function updateProfile(db: Bindings["DB"], id: string, input: OsProfileInput): Promise<boolean> {
  const { meta } = await db
    .prepare(
      `UPDATE os_profiles SET label = ?2, source_type = ?3, install_wim_key = ?4, file_share_path = ?5,
         image_index = ?6, updated_at = datetime('now')
       WHERE id = ?1`
    )
    .bind(id, input.label, input.sourceType, input.installWim ?? "", input.fileSharePath, input.imageIndex)
    .run();
  return meta.changes > 0;
}

export async function deleteProfile(db: Bindings["DB"], id: string): Promise<boolean> {
  const { meta } = await db.prepare(`DELETE FROM os_profiles WHERE id = ?1`).bind(id).run();
  return meta.changes > 0;
}
