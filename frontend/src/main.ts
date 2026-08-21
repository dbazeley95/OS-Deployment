import { api } from "./api";

const errorEl = document.querySelector<HTMLElement>("#error")!;
const jobsBody = document.querySelector<HTMLElement>("#jobs-body")!;
const devicesBody = document.querySelector<HTMLElement>("#devices-body")!;
const profileSelect = document.querySelector<HTMLSelectElement>("#os-profile-select")!;
const form = document.querySelector<HTMLFormElement>("#deploy-form")!;

function showError(err: unknown) {
  errorEl.textContent = err instanceof Error ? err.message : String(err);
}

async function loadProfiles() {
  const profiles = await api.listProfiles();
  profileSelect.innerHTML = profiles
    .map((p) => `<option value="${p.id}">${p.label}</option>`)
    .join("");
}

function emptyRow(colspan: number, message: string): string {
  return `<tr><td colspan="${colspan}" class="empty">${message}</td></tr>`;
}

async function loadJobs() {
  const jobs = await api.listJobs();
  jobsBody.innerHTML = jobs.length
    ? jobs
        .map(
          (j) => `<tr>
            <td>${j.id}</td>
            <td class="mac">${j.device_mac}</td>
            <td>${j.os_profile}</td>
            <td><span class="badge badge-${j.status}">${j.status}</span></td>
            <td>${j.technician ?? "—"}</td>
            <td>${j.updated_at}</td>
          </tr>`
        )
        .join("")
    : emptyRow(6, "No jobs yet.");
}

async function loadDevices() {
  const devices = await api.listDevices();
  devicesBody.innerHTML = devices.length
    ? devices
        .map(
          (d) => `<tr>
            <td class="mac">${d.mac}</td>
            <td>${d.hostname ?? "—"}</td>
            <td>${d.last_seen_at ?? "—"}</td>
          </tr>`
        )
        .join("")
    : emptyRow(3, "No devices yet.");
}

async function refresh() {
  try {
    await Promise.all([loadJobs(), loadDevices()]);
  } catch (err) {
    showError(err);
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  const data = new FormData(form);
  try {
    await api.createJob(
      String(data.get("mac")),
      String(data.get("os_profile")),
      (data.get("hostname") as string) || undefined
    );
    form.reset();
    await refresh();
  } catch (err) {
    showError(err);
  }
});

loadProfiles().catch(showError);
refresh();
setInterval(refresh, 5000);
