CREATE TABLE devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mac TEXT NOT NULL UNIQUE,
  hostname TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE deployment_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_mac TEXT NOT NULL,
  os_profile TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | booted | installing | complete | failed
  log TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (device_mac) REFERENCES devices(mac)
);

CREATE INDEX idx_jobs_mac_status ON deployment_jobs(device_mac, status);
