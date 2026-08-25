import type { Role } from "./lib/auth";

export type Bindings = {
  DB: D1Database;
  IMAGES: R2Bucket;
  ALLOWED_ORIGIN: string;
  PASSWORD_PEPPER: string;
};

/** Set by requireSession (worker/src/lib/auth.ts) on every authenticated request. */
export type Variables = { username: string; role: Role };

export type JobStatus = "pending" | "booted" | "installing" | "complete" | "failed";

export interface Device {
  id: number;
  mac: string;
  hostname: string | null;
  serial_number: string | null;
  last_seen_at: string | null;
  created_at: string;
}

export interface DeploymentJob {
  id: number;
  device_mac: string;
  os_profile: string;
  status: JobStatus;
  log: string | null;
  technician: string | null;
  task_sequence_id: string | null;
  domain_join: number;
  domain: string | null;
  created_at: string;
  updated_at: string;
}
