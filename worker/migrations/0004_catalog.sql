-- Moves the OS profile / app catalog from static code (worker/src/lib/profiles.ts,
-- worker/src/lib/apps.ts) into D1, so the admin UI can manage it directly
-- instead of requiring a code change + redeploy for every new edition or app.
CREATE TABLE os_profiles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  install_wim_key TEXT NOT NULL,
  image_index INTEGER NOT NULL,
  answer_file_key TEXT NOT NULL,
  kernel_key TEXT, -- iPXE path only, nullable
  initrd_key TEXT, -- iPXE path only, nullable
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE apps (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  install_kind TEXT NOT NULL CHECK (install_kind IN ('msi', 'exe', 'script')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed with the two profiles that shipped in code, so behavior is
-- unchanged immediately after this migration runs.
INSERT INTO os_profiles (id, label, install_wim_key, image_index, answer_file_key, kernel_key, initrd_key) VALUES
  ('windows-11-25h2-pro', 'Windows 11 25H2 Pro', 'windows-11-25h2/sources/install.wim', 1, 'windows-11-25h2-pro/autounattend.xml', 'windows-11-25h2/boot/bootx64.efi', 'windows-11-25h2/boot/boot.sdi'),
  ('windows-11-25h2-edu', 'Windows 11 25H2 Education', 'windows-11-25h2/sources/install.wim', 2, 'windows-11-25h2-edu/autounattend.xml', 'windows-11-25h2/boot/bootx64.efi', 'windows-11-25h2/boot/boot.sdi');
