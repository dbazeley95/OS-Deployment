-- Task sequences bundle one OS profile with an ordered list of apps (the
-- existing `apps` catalog already covers "customizations" via
-- installKind="script", so no separate catalog is needed for those).
-- steps_json (not a join table) since a sequence's step list is always
-- read/written as a whole, never queried standalone.
CREATE TABLE task_sequences (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  os_profile_id TEXT NOT NULL REFERENCES os_profiles(id),
  steps_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
