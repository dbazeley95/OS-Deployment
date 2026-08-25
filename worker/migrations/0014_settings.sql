-- Generic key-value store for global admin-UI settings that don't belong
-- to any one catalog entity - starting with the drivers file-share root
-- (see boot/drivers/README.md), previously a hardcoded constant at the
-- top of DeployGui.ps1 that needed a code push to change.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
