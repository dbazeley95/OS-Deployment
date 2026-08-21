/**
 * Static catalog of apps/scripts the "install-app" post-imaging action can
 * silently run after Windows finishes installing. Upload the file to R2
 * with scripts/upload-image.sh, then add one entry here - same pattern as
 * OS_PROFILES in profiles.ts.
 */
export type InstallKind = "msi" | "exe" | "script";

export interface AppEntry {
  id: string;
  label: string;
  /** R2 key for the installer/script file. */
  r2Key: string;
  installKind: InstallKind;
}

// No apps ship by default - add entries here as you upload installers.
// Example:
// export const APPS: Record<string, AppEntry> = {
//   "company-vpn": {
//     id: "company-vpn",
//     label: "Company VPN Client",
//     r2Key: "apps/company-vpn.msi",
//     installKind: "msi",
//   },
// };
export const APPS: Record<string, AppEntry> = {};

export function listApps(): AppEntry[] {
  return Object.values(APPS);
}

export function getApp(id: string): AppEntry | undefined {
  return APPS[id];
}
