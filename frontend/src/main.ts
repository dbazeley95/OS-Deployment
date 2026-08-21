import { api, ApiError, type AppEntry, type OsProfile, type TaskSequence } from "./api";

const versionBadge = document.querySelector<HTMLElement>("#version-badge")!;
const appVersion = import.meta.env.VITE_APP_VERSION;
const commitSha = import.meta.env.VITE_COMMIT_SHA;
versionBadge.textContent = appVersion || "dev";
versionBadge.title = commitSha ? `Build ${commitSha}` : "Local dev build";

const errorEl = document.querySelector<HTMLElement>("#error")!;
const loginCard = document.querySelector<HTMLElement>("#login-card")!;
const appEl = document.querySelector<HTMLElement>("#app")!;
const logoutBtn = document.querySelector<HTMLButtonElement>("#logout-btn")!;
const loginForm = document.querySelector<HTMLFormElement>("#login-form")!;

const jobsBody = document.querySelector<HTMLElement>("#jobs-body")!;
const devicesBody = document.querySelector<HTMLElement>("#devices-body")!;

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

const taskSequencesBody = document.querySelector<HTMLElement>("#task-sequences-body")!;
const taskSequenceForm = document.querySelector<HTMLFormElement>("#task-sequence-form")!;
const tsIdInput = document.querySelector<HTMLInputElement>("#ts-id")!;
const tsProfileSelect = document.querySelector<HTMLSelectElement>("#ts-profile-select")!;
const tsStepSelect = document.querySelector<HTMLSelectElement>("#ts-step-select")!;
const tsAddStepBtn = document.querySelector<HTMLButtonElement>("#ts-add-step")!;
const tsStepsList = document.querySelector<HTMLOListElement>("#ts-steps-list")!;
const tsSubmitBtn = document.querySelector<HTMLButtonElement>("#ts-submit")!;
const tsCancelBtn = document.querySelector<HTMLButtonElement>("#ts-cancel")!;

let editingProfileId: string | null = null;
let editingAppId: string | null = null;
let editingTaskSequenceId: string | null = null;
let currentSteps: string[] = [];
let stepAppLabels: Record<string, string> = {};

function showError(err: unknown) {
  errorEl.textContent = err instanceof Error ? err.message : String(err);
}

function emptyRow(colspan: number, message: string): string {
  return `<tr><td colspan="${colspan}" class="empty">${message}</td></tr>`;
}

async function loadJobs() {
  const [jobs, sequences] = await Promise.all([api.listJobs(), api.listCatalogTaskSequences()]);
  const labelFor = (id: string | null) => sequences.find((s) => s.id === id)?.label ?? id ?? "—";
  jobsBody.innerHTML = jobs.length
    ? jobs
        .map(
          (j) => `<tr>
            <td>${j.id}</td>
            <td class="mac">${j.device_mac}</td>
            <td>${labelFor(j.task_sequence_id)}</td>
            <td><span class="badge badge-${j.status}">${j.status}</span></td>
            <td>${j.domain_join ? `Yes${j.domain ? ` [${j.domain}]` : ""}` : "No"}</td>
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
            <td class="mono">${d.serial_number ?? "—"}</td>
            <td>${d.last_seen_at ?? "—"}</td>
          </tr>`
        )
        .join("")
    : emptyRow(4, "No devices yet.");
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

async function loadTsProfileOptions() {
  const profiles = await api.listCatalogProfiles();
  tsProfileSelect.innerHTML = profiles.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
}

async function loadTsStepOptions() {
  const apps = await api.listCatalogApps();
  stepAppLabels = Object.fromEntries(apps.map((a) => [a.id, a.label]));
  tsStepSelect.innerHTML = apps.map((a) => `<option value="${a.id}">${a.label}</option>`).join("");
}

function renderStepsList() {
  tsStepsList.innerHTML = currentSteps.length
    ? currentSteps
        .map(
          (appId, i) => `<li>
            <span>${stepAppLabels[appId] ?? appId}</span>
            <button type="button" data-step-up="${i}" ${i === 0 ? "disabled" : ""}>&uarr;</button>
            <button type="button" data-step-down="${i}" ${i === currentSteps.length - 1 ? "disabled" : ""}>&darr;</button>
            <button type="button" class="danger" data-step-remove="${i}">Remove</button>
          </li>`
        )
        .join("")
    : `<li class="empty">No steps yet.</li>`;
}

async function loadTaskSequencesTable() {
  const [sequences, profiles, apps] = await Promise.all([
    api.listCatalogTaskSequences(),
    api.listCatalogProfiles(),
    api.listCatalogApps(),
  ]);
  const profileLabel = (id: string) => profiles.find((p) => p.id === id)?.label ?? id;
  const stepLabels = (ids: string[]) => ids.map((id) => apps.find((a) => a.id === id)?.label ?? id).join(", ") || "—";
  taskSequencesBody.innerHTML = sequences.length
    ? sequences
        .map(
          (s) => `<tr>
            <td class="mono">${s.id}</td>
            <td>${s.label}</td>
            <td>${profileLabel(s.osProfileId)}</td>
            <td>${stepLabels(s.stepIds)}</td>
            <td class="row-actions">
              <button type="button" data-edit-ts="${s.id}">Edit</button>
              <button type="button" class="danger" data-delete-ts="${s.id}">Delete</button>
            </td>
          </tr>`
        )
        .join("")
    : emptyRow(5, "No task sequences yet.");
}

async function refresh() {
  try {
    await Promise.all([
      loadJobs(),
      loadDevices(),
      loadProfilesTable(),
      loadAppsTable(),
      loadTsProfileOptions(),
      loadTsStepOptions(),
      loadTaskSequencesTable(),
    ]);
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

function resetTaskSequenceForm() {
  editingTaskSequenceId = null;
  taskSequenceForm.reset();
  tsIdInput.disabled = false;
  currentSteps = [];
  renderStepsList();
  tsSubmitBtn.textContent = "Add task sequence";
  tsCancelBtn.hidden = true;
}

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

tsAddStepBtn.addEventListener("click", () => {
  if (!tsStepSelect.value) return;
  currentSteps.push(tsStepSelect.value);
  renderStepsList();
});

tsStepsList.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const up = target.dataset.stepUp;
  const down = target.dataset.stepDown;
  const remove = target.dataset.stepRemove;
  if (up !== undefined) {
    const i = Number(up);
    [currentSteps[i - 1], currentSteps[i]] = [currentSteps[i], currentSteps[i - 1]];
  } else if (down !== undefined) {
    const i = Number(down);
    [currentSteps[i], currentSteps[i + 1]] = [currentSteps[i + 1], currentSteps[i]];
  } else if (remove !== undefined) {
    currentSteps.splice(Number(remove), 1);
  } else {
    return;
  }
  renderStepsList();
});

taskSequenceForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  const data = new FormData(taskSequenceForm);
  const sequence: TaskSequence = {
    id: String(data.get("id")),
    label: String(data.get("label")),
    osProfileId: String(data.get("osProfileId")),
    stepIds: [...currentSteps],
  };
  try {
    if (editingTaskSequenceId) {
      await api.updateCatalogTaskSequence(editingTaskSequenceId, sequence);
    } else {
      await api.createCatalogTaskSequence(sequence);
    }
    resetTaskSequenceForm();
    await refresh();
  } catch (err) {
    showError(err);
  }
});

tsCancelBtn.addEventListener("click", resetTaskSequenceForm);

taskSequencesBody.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;
  const editId = target.dataset.editTs;
  const deleteId = target.dataset.deleteTs;
  if (editId) {
    const sequences = await api.listCatalogTaskSequences();
    const sequence = sequences.find((s) => s.id === editId);
    if (!sequence) return;
    await loadTsStepOptions(); // ensure stepAppLabels is populated before rendering
    editingTaskSequenceId = sequence.id;
    tsIdInput.value = sequence.id;
    tsIdInput.disabled = true;
    (taskSequenceForm.elements.namedItem("label") as HTMLInputElement).value = sequence.label;
    tsProfileSelect.value = sequence.osProfileId;
    currentSteps = [...sequence.stepIds];
    renderStepsList();
    tsSubmitBtn.textContent = "Save task sequence";
    tsCancelBtn.hidden = false;
  } else if (deleteId) {
    if (!confirm(`Delete task sequence "${deleteId}"?`)) return;
    try {
      await api.deleteCatalogTaskSequence(deleteId);
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
  renderStepsList();
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
