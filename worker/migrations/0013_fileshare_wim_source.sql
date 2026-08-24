-- Adds an alternative "network file share" source for an OS profile's WIM,
-- alongside the existing R2-hosted source - useful when several machines are
-- building at once, so the WinPE deploy flow can pull install.wim over the
-- LAN (a Windows Server share, authenticated with the same credentials
-- DeployGui.ps1 already collects for domain-join) instead of repeatedly
-- through the Worker/R2 over the internet. install_wim_key becomes nullable
-- (only required when source_type = 'r2') via a full table rebuild, since
-- SQLite can't drop a NOT NULL constraint on an existing column in place.

CREATE TABLE os_profiles_new (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'r2',
  install_wim_key TEXT,
  file_share_path TEXT,
  image_index INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO os_profiles_new (id, label, source_type, install_wim_key, file_share_path, image_index, created_at, updated_at)
SELECT id, label, 'r2', install_wim_key, NULL, image_index, created_at, updated_at
FROM os_profiles;

DROP TABLE os_profiles;
ALTER TABLE os_profiles_new RENAME TO os_profiles;
