// Set via `VITE_API_BASE` at build time (Cloudflare Pages env var), or defaults
// to same-origin `/api` if the Worker is proxied behind the Pages project.
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

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
  status: string;
  updated_at: string;
}

export interface OsProfile {
  id: string;
  label: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listDevices: () => request<Device[]>("/api/devices"),
  listJobs: () => request<DeploymentJob[]>("/api/jobs"),
  listProfiles: () => request<OsProfile[]>("/api/jobs/profiles"),
  createJob: (mac: string, os_profile: string, hostname?: string) =>
    request<{ id: number }>("/api/jobs", {
      method: "POST",
      body: JSON.stringify({ mac, os_profile, hostname }),
    }),
};
