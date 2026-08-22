// Set via `VITE_API_BASE` at build time (Cloudflare Pages env var), or defaults
// to same-origin `/api` if the Worker is proxied behind the Pages project.
// Trailing slash stripped so `${API_BASE}${path}` can't produce a double
// slash regardless of whether the env var was set with one.
const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

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
  status: string;
  technician: string | null;
  task_sequence_id: string | null;
  domain_join: number;
  domain: string | null;
  updated_at: string;
}

export interface OsProfile {
  id: string;
  label: string;
  installWim: string;
  imageIndex: number;
  answerFile: string;
}

export type InstallKind = "msi" | "exe" | "script";

export interface AppEntry {
  id: string;
  label: string;
  r2Key: string;
  installKind: InstallKind;
}

export type TaskSequenceStepKind = "app" | "builtin";

export interface TaskSequenceStep {
  kind: TaskSequenceStepKind;
  id: string;
}

export interface TaskSequence {
  id: string;
  label: string;
  osProfileId: string;
  steps: TaskSequenceStep[];
}

export interface BuiltinAction {
  id: string;
  label: string;
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
  // Only set Content-Type when actually sending a body - a GET with no body
  // needs no headers at all, so it stays a CORS "simple request" and skips
  // the preflight OPTIONS round-trip entirely.
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (init?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers,
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

  // Devices / jobs (read-only - deployments are always started on-device via DeployGui.ps1)
  listDevices: () => request<Device[]>("/api/devices"),
  listJobs: () => request<DeploymentJob[]>("/api/jobs"),

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

  // Direct WIM upload - wraps R2 multipart upload so a technician can pick a
  // multi-GB install.wim in the browser instead of typing an R2 key by hand.
  createUpload: (key: string) =>
    request<{ key: string; uploadId: string }>("/api/catalog/uploads", {
      method: "POST",
      body: JSON.stringify({ key }),
    }),
  uploadPart: async (
    uploadId: string,
    key: string,
    partNumber: number,
    chunk: Blob,
    signal?: AbortSignal
  ): Promise<{ partNumber: number; etag: string }> => {
    const res = await fetch(
      `${API_BASE}/api/catalog/uploads/${encodeURIComponent(uploadId)}/parts/${partNumber}?key=${encodeURIComponent(key)}`,
      { method: "PUT", credentials: "include", body: chunk, signal }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError((body as { error?: string }).error ?? `Request failed: ${res.status}`, res.status);
    }
    return res.json();
  },
  completeUpload: (uploadId: string, key: string, parts: { partNumber: number; etag: string }[]) =>
    request<{ ok: true }>(`/api/catalog/uploads/${encodeURIComponent(uploadId)}/complete`, {
      method: "POST",
      body: JSON.stringify({ key, parts }),
    }),
  abortUpload: (uploadId: string, key: string) =>
    request<{ ok: true }>(`/api/catalog/uploads/${encodeURIComponent(uploadId)}/abort`, {
      method: "POST",
      body: JSON.stringify({ key }),
    }),
  createAnswerFile: (key: string, content: string) =>
    request<{ ok: true; key: string }>("/api/catalog/answer-files", {
      method: "POST",
      body: JSON.stringify({ key, content }),
    }),

  listCatalogApps: () => request<AppEntry[]>("/api/catalog/apps"),
  createCatalogApp: (app: AppEntry) =>
    request<{ ok: true }>("/api/catalog/apps", { method: "POST", body: JSON.stringify(app) }),
  updateCatalogApp: (id: string, app: AppEntry) =>
    request<{ ok: true }>(`/api/catalog/apps/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(app) }),
  deleteCatalogApp: (id: string) =>
    request<{ ok: true }>(`/api/catalog/apps/${encodeURIComponent(id)}`, { method: "DELETE" }),

  listCatalogBuiltinActions: () => request<BuiltinAction[]>("/api/catalog/builtin-actions"),

  listCatalogTaskSequences: () => request<TaskSequence[]>("/api/catalog/task-sequences"),
  createCatalogTaskSequence: (sequence: TaskSequence) =>
    request<{ ok: true }>("/api/catalog/task-sequences", { method: "POST", body: JSON.stringify(sequence) }),
  updateCatalogTaskSequence: (id: string, sequence: TaskSequence) =>
    request<{ ok: true }>(`/api/catalog/task-sequences/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(sequence),
    }),
  deleteCatalogTaskSequence: (id: string) =>
    request<{ ok: true }>(`/api/catalog/task-sequences/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
