import { api, ApiError, type AppEntry, type OsProfile } from "./api";

const errorEl = document.querySelector<HTMLElement>("#error")!;
const loginCard = document.querySelector<HTMLElement>("#login-card")!;
const appEl = document.querySelector<HTMLElement>("#app")!;
const logoutBtn = document.querySelector<HTMLButtonElement>("#logout-btn")!;
const loginForm = document.querySelector<HTMLFormElement>("#login-form")!;

const jobsBody = document.querySelector<HTMLElement>("#jobs-body")!;
const devicesBody = document.querySelector<HTMLElement>("#devices-body")!;
const profileSelect = document.querySelector<HTMLSelectElement>("#os-profile-select")!;
const deployForm = document.querySelector<HTMLFormElement>("#deploy-form")!;

const profilesBody = document.querySelector<HTMLElement>("#profiles-body")!;
const profileForm = document.querySelector<HTMLFormElement>("#profile-form")!;
const profileIdInput = document.querySelector<HTMLInputElement>("#profile-id")!;
const profileSubmitBtn = document.querySelector<HTMLButtonElement>("#profile-submit")!;
const profileCancelBtn = document.querySelector<HTMLButtonElement>("#profile-cancel")!;

const appsBody = document.querySelector<HTMLElement>("#apps-body")!;
const appForm = document.querySelector<HTMLFormElement>("#app-form")!;
const appIdInput = document.querySelector<HTMLInputElement>("#app-id")!;
const appSubmitBtn = document.querySelector<HTMLButtonElement>("#app-submit")!;
const appCancelBtn = document.querySelector<HTMLButtonElement>("#app-cancel")!;

let editingProfileId: string | null = null;
let editingAppId: string | null = null;

function showError(err: unknown) {
  errorEl.textContent = err instanceof Error ? err.message : String(err);
}

function emptyRow(colspan: number, message: string): string {
  return `<tr><td colspan="${colspan}" class="empty">${message}</td></tr>`;
}

async function loadProfileOptions() {
  const profiles = await api.listCatalogProfiles();
  profileSelect.innerHTML = profiles.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
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
            <td>${
              j.post_action
                ? j.post_action +
                  (j.app_id ? ` (${j.app_id})` : "") +
                  (j.domain ? ` [${j.domain}]` : "")
                : "—"
            }</td>
            <td>${j.technician ?? "—"}</td>
            <td>${j.updated_at}</td>
          </tr>`
        )
        .join("")
    : emptyRow(7, "No jobs yet.");
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

async function loadProfilesTable() {
  const profiles = await api.listCatalogProfiles();
  profilesBody.innerHTML = profiles.length
    ? profiles
        .map(
          (p) => `<tr>
            <td class="mono">${p.id}</td>
            <td>${p.label}</td>
            <td class="mono">${p.installWim} (#${p.imageIndex})</td>
            <td class="mono">${p.imageIndex}</td>
            <td class="mono">${p.answerFile}</td>
            <td class="row-actions">
              <button type="button" data-edit-profile="${p.id}">Edit</button>
              <button type="button" class="danger" data-delete-profile="${p.id}">Delete</button>
            </td>
          </tr>`
        )
        .join("")
    : emptyRow(6, "No profiles yet.");
}

async function loadAppsTable() {
  const apps = await api.listCatalogApps();
  appsBody.innerHTML = apps.length
    ? apps
        .map(
          (a) => `<tr>
            <td class="mono">${a.id}</td>
            <td>${a.label}</td>
            <td class="mono">${a.r2Key}</td>
            <td>${a.installKind}</td>
            <td class="row-actions">
              <button type="button" data-edit-app="${a.id}">Edit</button>
              <button type="button" class="danger" data-delete-app="${a.id}">Delete</button>
            </td>
          </tr>`
        )
        .join("")
    : emptyRow(5, "No apps yet.");
}

async function refresh() {
  try {
    await Promise.all([loadJobs(), loadDevices(), loadProfilesTable(), loadAppsTable(), loadProfileOptions()]);
  } catch (err) {
    showError(err);
  }
}

function resetProfileForm() {
  editingProfileId = null;
  profileForm.reset();
  profileIdInput.disabled = false;
  profileSubmitBtn.textContent = "Add profile";
  profileCancelBtn.hidden = true;
}

function resetAppForm() {
  editingAppId = null;
  appForm.reset();
  appIdInput.disabled = false;
  appSubmitBtn.textContent = "Add app";
  appCancelBtn.hidden = true;
}

deployForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  const data = new FormData(deployForm);
  try {
    await api.createJob(String(data.get("mac")), String(data.get("os_profile")), (data.get("hostname") as string) || undefined);
    deployForm.reset();
    await refresh();
  } catch (err) {
    showError(err);
  }
});

profileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  const data = new FormData(profileForm);
  const profile: OsProfile = {
    id: String(data.get("id")),
    label: String(data.get("label")),
    installWim: String(data.get("installWim")),
    imageIndex: Number(data.get("imageIndex")),
    answerFile: String(data.get("answerFile")),
    kernel: (data.get("kernel") as string) || null,
    initrd: (data.get("initrd") as string) || null,
  };
  try {
    if (editingProfileId) {
      await api.updateCatalogProfile(editingProfileId, profile);
    } else {
      await api.createCatalogProfile(profile);
    }
    resetProfileForm();
    await refresh();
  } catch (err) {
    showError(err);
  }
});

profileCancelBtn.addEventListener("click", resetProfileForm);

profilesBody.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;
  const editId = target.dataset.editProfile;
  const deleteId = target.dataset.deleteProfile;
  if (editId) {
    const profiles = await api.listCatalogProfiles();
    const profile = profiles.find((p) => p.id === editId);
    if (!profile) return;
    editingProfileId = profile.id;
    profileIdInput.value = profile.id;
    profileIdInput.disabled = true;
    (profileForm.elements.namedItem("label") as HTMLInputElement).value = profile.label;
    (profileForm.elements.namedItem("installWim") as HTMLInputElement).value = profile.installWim;
    (profileForm.elements.namedItem("imageIndex") as HTMLInputElement).value = String(profile.imageIndex);
    (profileForm.elements.namedItem("answerFile") as HTMLInputElement).value = profile.answerFile;
    (profileForm.elements.namedItem("kernel") as HTMLInputElement).value = profile.kernel ?? "";
    (profileForm.elements.namedItem("initrd") as HTMLInputElement).value = profile.initrd ?? "";
    profileSubmitBtn.textContent = "Save profile";
    profileCancelBtn.hidden = false;
  } else if (deleteId) {
    if (!confirm(`Delete profile "${deleteId}"?`)) return;
    try {
      await api.deleteCatalogProfile(deleteId);
      await refresh();
    } catch (err) {
      showError(err);
    }
  }
});

appForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  const data = new FormData(appForm);
  const app: AppEntry = {
    id: String(data.get("id")),
    label: String(data.get("label")),
    r2Key: String(data.get("r2Key")),
    installKind: data.get("installKind") as AppEntry["installKind"],
  };
  try {
    if (editingAppId) {
      await api.updateCatalogApp(editingAppId, app);
    } else {
      await api.createCatalogApp(app);
    }
    resetAppForm();
    await refresh();
  } catch (err) {
    showError(err);
  }
});

appCancelBtn.addEventListener("click", resetAppForm);

appsBody.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;
  const editId = target.dataset.editApp;
  const deleteId = target.dataset.deleteApp;
  if (editId) {
    const apps = await api.listCatalogApps();
    const app = apps.find((a) => a.id === editId);
    if (!app) return;
    editingAppId = app.id;
    appIdInput.value = app.id;
    appIdInput.disabled = true;
    (appForm.elements.namedItem("label") as HTMLInputElement).value = app.label;
    (appForm.elements.namedItem("r2Key") as HTMLInputElement).value = app.r2Key;
    (appForm.elements.namedItem("installKind") as HTMLSelectElement).value = app.installKind;
    appSubmitBtn.textContent = "Save app";
    appCancelBtn.hidden = false;
  } else if (deleteId) {
    if (!confirm(`Delete app "${deleteId}"?`)) return;
    try {
      await api.deleteCatalogApp(deleteId);
      await refresh();
    } catch (err) {
      showError(err);
    }
  }
});

function showLoggedIn() {
  loginCard.hidden = true;
  appEl.hidden = false;
  logoutBtn.hidden = false;
}

function showLoggedOut() {
  loginCard.hidden = false;
  appEl.hidden = true;
  logoutBtn.hidden = true;
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  const data = new FormData(loginForm);
  try {
    await api.login(String(data.get("username")), String(data.get("password")));
    loginForm.reset();
    showLoggedIn();
    await refresh();
  } catch (err) {
    showError(err);
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await api.logout();
  } catch (err) {
    showError(err);
  }
  showLoggedOut();
});

let refreshTimer: ReturnType<typeof setInterval> | null = null;

async function init() {
  try {
    await api.me();
    showLoggedIn();
    await refresh();
    refreshTimer ??= setInterval(refresh, 5000);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      showLoggedOut();
    } else {
      showError(err);
    }
  }
}

init();
