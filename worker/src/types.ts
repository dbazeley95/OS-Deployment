export type Bindings = {
  DB: D1Database;
  IMAGES: R2Bucket;
  ALLOWED_ORIGIN: string;
  PASSWORD_PEPPER: string;
};

export type JobStatus = "pending" | "booted" | "installing" | "complete" | "failed";

export type PostAction = "domain-join" | "install-app" | "autopilot";

export interface Device {
  id: number;
  mac: string;
  hostname: string | null;
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
  post_action: PostAction | null;
  app_id: string | null;
  domain: string | null;
  created_at: string;
  updated_at: string;
}
