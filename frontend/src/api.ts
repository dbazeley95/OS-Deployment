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
  technician: string | null;
  post_action: string | null;
  app_id: string | null;
  domain: string | null;
  updated_at: string;
}

export interface OsProfile {
  id: string;
  label: string;
  installWim: string;
  imageIndex: number;
  answerFile: string;
  kernel: string | null;
  initrd: string | null;
}

export type InstallKind = "msi" | "exe" | "script";

export interface AppEntry {
  id: string;
  label: string;
  r2Key: string;
  installKind: InstallKind;
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError((body as { error?: string }).error ?? `Request failed: ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

export { ApiError };

export const api = {
  // Auth
  me: () => request<{ username: string }>("/api/auth/me"),
  login: (username: string, password: string) =>
    request<{ username: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  // Devices / jobs
  listDevices: () => request<Device[]>("/api/devices"),
  listJobs: () => request<DeploymentJob[]>("/api/jobs"),
  createJob: (mac: string, os_profile: string, hostname?: string) =>
    request<{ id: number }>("/api/jobs", {
      method: "POST",
      body: JSON.stringify({ mac, os_profile, hostname }),
    }),

  // Catalog editor ("cloud Deployment Workbench")
  listCatalogProfiles: () => request<OsProfile[]>("/api/catalog/profiles"),
  createCatalogProfile: (profile: OsProfile) =>
    request<{ ok: true }>("/api/catalog/profiles", { method: "POST", body: JSON.stringify(profile) }),
  updateCatalogProfile: (id: string, profile: OsProfile) =>
    request<{ ok: true }>(`/api/catalog/profiles/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(profile),
    }),
  deleteCatalogProfile: (id: string) =>
    request<{ ok: true }>(`/api/catalog/profiles/${encodeURIComponent(id)}`, { method: "DELETE" }),

  listCatalogApps: () => request<AppEntry[]>("/api/catalog/apps"),
  createCatalogApp: (app: AppEntry) =>
    request<{ ok: true }>("/api/catalog/apps", { method: "POST", body: JSON.stringify(app) }),
  updateCatalogApp: (id: string, app: AppEntry) =>
    request<{ ok: true }>(`/api/catalog/apps/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(app) }),
  deleteCatalogApp: (id: string) =>
    request<{ ok: true }>(`/api/catalog/apps/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
