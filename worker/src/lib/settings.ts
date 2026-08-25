import type { Bindings } from "../types";

/**
 * Generic key-value store for global admin-UI settings that don't belong to
 * any one catalog entity (see migrations/0014_settings.sql) - starting with
 * the drivers file-share root (boot/drivers/README.md), previously a
 * hardcoded constant in DeployGui.ps1 that needed a code push to change.
 */
export const DRIVERS_SHARE_ROOT_KEY = "driversShareRoot";
// "disabled" | "fileshare" | "manufacturer" - see DriversSourceType in
// worker/src/routes/catalog.ts. Unset (null) is treated as "disabled",
// matching the old behavior where a blank $DriversShareRoot skipped
// injection entirely.
export const DRIVERS_SOURCE_TYPE_KEY = "driversSourceType";

export async function getSetting(db: Bindings["DB"], key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = ?1`).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: Bindings["DB"], key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = datetime('now')`
    )
    .bind(key, value)
    .run();
}
