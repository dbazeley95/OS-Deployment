import {
  api,
  ApiError,
  type AppEntry,
  type BuiltinAction,
  type DeploymentJob,
  type OsProfile,
  type TaskSequence,
  type TaskSequenceStep,
} from "./api";

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

const tabsNav = document.querySelector<HTMLElement>("#tabs")!;
const tabButtons = Array.from(tabsNav.querySelectorAll<HTMLButtonElement>(".tab-btn"));
const tabPanels = Array.from(document.querySelectorAll<HTMLElement>(".tab-panel"));

const statInProgress = document.querySelector<HTMLElement>("#stat-in-progress")!;
const statComplete = document.querySelector<HTMLElement>("#stat-complete")!;
const statFailed = document.querySelector<HTMLElement>("#stat-failed")!;

const jobsBody = document.querySelector<HTMLElement>("#jobs-body")!;
const devicesBody = document.querySelector<HTMLElement>("#devices-body")!;
const tsNoAppsHint = document.querySelector<HTMLElement>("#ts-no-apps-hint")!;

const profilesBody = document.querySelector<HTMLElement>("#profiles-body")!;
const profileForm = document.querySelector<HTMLFormElement>("#profile-form")!;
const profileIdInput = document.querySelector<HTMLInputElement>("#profile-id")!;
const profileSubmitBtn = document.querySelector<HTMLButtonElement>("#profile-submit")!;
const profileCancelBtn = document.querySelector<HTMLButtonElement>("#profile-cancel")!;
const profileInstallWimInput = document.querySelector<HTMLInputElement>("#profile-install-wim")!;
const profileWimFileInput = document.querySelector<HTMLInputElement>("#profile-wim-file")!;
const profileWimUploadBtn = document.querySelector<HTMLButtonElement>("#profile-wim-upload-btn")!;
const profileWimProgress = document.querySelector<HTMLElement>("#profile-wim-progress")!;
const profileWimProgressBar = document.querySelector<HTMLProgressElement>("#profile-wim-progress-bar")!;
const profileWimProgressText = document.querySelector<HTMLElement>("#profile-wim-progress-text")!;

const appsBody = document.querySelector<HTMLElement>("#apps-body")!;
const appForm = document.querySelector<HTMLFormElement>("#app-form")!;
const appIdInput = document.querySelector<HTMLInputElement>("#app-id")!;
const appSubmitBtn = document.querySelector<HTMLButtonElement>("#app-submit")!;
const appCancelBtn = document.querySelector<HTMLButtonElement>("#app-cancel")!;

const taskSequencesBody = document.querySelector<HTMLElement>("#task-sequences-body")!;
const tsNewBtn = document.querySelector<HTMLButtonElement>("#ts-new-btn")!;
const tsWizard = document.querySelector<HTMLDialogElement>("#ts-wizard")!;
const tsWizardTitle = document.querySelector<HTMLElement>("#ts-wizard-title")!;
const tsWizardStepLabel = document.querySelector<HTMLElement>("#ts-wizard-step-label")!;
const tsWizardSteps = Array.from(tsWizard.querySelectorAll<HTMLElement>(".wizard-step"));
const taskSequenceForm = document.querySelector<HTMLFormElement>("#task-sequence-form")!;
const tsIdInput = document.querySelector<HTMLInputElement>("#ts-id")!;
const tsLabelInput = document.querySelector<HTMLInputElement>("#ts-label")!;
const tsProfileSelect = document.querySelector<HTMLSelectElement>("#ts-profile-select")!;
const tsStepSelect = document.querySelector<HTMLSelectElement>("#ts-step-select")!;
const tsAddStepBtn = document.querySelector<HTMLButtonElement>("#ts-add-step")!;
const tsStepsList = document.querySelector<HTMLOListElement>("#ts-steps-list")!;
const tsReview = document.querySelector<HTMLElement>("#ts-review")!;
const tsBackBtn = document.querySelector<HTMLButtonElement>("#ts-back-btn")!;
const tsNextBtn = document.querySelector<HTMLButtonElement>("#ts-next-btn")!;
const tsSubmitBtn = document.querySelector<HTMLButtonElement>("#ts-submit")!;
const tsCancelBtn = document.querySelector<HTMLButtonElement>("#ts-cancel")!;

let editingProfileId: string | null = null;
let editingAppId: string | null = null;
let editingTaskSequenceId: string | null = null;
let currentSteps: TaskSequenceStep[] = [];
let stepLabels: Record<string, string> = {};
let wizardStep = 1;
const WIZARD_STEP_COUNT = 3;
const expandedDeviceMacs = new Set<string>();

function stepKey(step: TaskSequenceStep): string {
  return `${step.kind}:${step.id}`;
}

function showError(err: unknown) {
  errorEl.textContent = err instanceof Error ? err.message : String(err);
}

function selectTab(tab: string) {
  for (const btn of tabButtons) {
    btn.setAttribute("aria-selected", String(btn.dataset.tab === tab));
  }
  for (const panel of tabPanels) {
    panel.hidden = panel.dataset.tabPanel !== tab;
  }
}

tabsNav.addEventListener("click", (e) => {
  const tab = (e.target as HTMLElement).closest<HTMLButtonElement>(".tab-btn")?.dataset.tab;
  if (tab) selectTab(tab);
});

selectTab("dashboard");

function emptyRow(colspan: number, message: string): string {
  return `<tr><td colspan="${colspan}" class="empty">${message}</td></tr>`;
}

function jobRow(j: DeploymentJob, labelFor: (id: string | null) => string, includeMac = true): string {
  return `<tr>
    <td>${j.id}</td>
    ${includeMac ? `<td class="mac">${j.device_mac}</td>` : ""}
    <td>${labelFor(j.task_sequence_id)}</td>
    <td><span class="badge badge-${j.status}">${j.status}</span></td>
    <td>${j.domain_join ? `Yes${j.domain ? ` [${j.domain}]` : ""}` : "No"}</td>
    <td>${j.technician ?? "—"}</td>
    <td>${j.updated_at}</td>
  </tr>`;
}

async function loadJobs() {
  const [jobs, sequences] = await Promise.all([api.listJobs(), api.listCatalogTaskSequences()]);
  const labelFor = (id: string | null) => sequences.find((s) => s.id === id)?.label ?? id ?? "—";

  const inProgress = jobs.filter((j) => j.status === "pending" || j.status === "booted" || j.status === "installing");
  statInProgress.textContent = String(inProgress.length);
  statComplete.textContent = String(jobs.filter((j) => j.status === "complete").length);
  statFailed.textContent = String(jobs.filter((j) => j.status === "failed").length);

  jobsBody.innerHTML = jobs.length ? jobs.map((j) => jobRow(j, labelFor)).join("") : emptyRow(7, "No jobs yet.");
}

async function loadDevices() {
  const [devices, jobs, sequences] = await Promise.all([
    api.listDevices(),
    api.listJobs(),
    api.listCatalogTaskSequences(),
  ]);
  const labelFor = (id: string | null) => sequences.find((s) => s.id === id)?.label ?? id ?? "—";

  devicesBody.innerHTML = devices.length
    ? devices
        .map((d) => {
          const history = jobs.filter((j) => j.device_mac === d.mac);
          const expanded = expandedDeviceMacs.has(d.mac);
          const row = `<tr>
            <td class="mac">${d.mac}</td>
            <td>${d.hostname ?? "—"}</td>
            <td class="mono">${d.serial_number ?? "—"}</td>
            <td>${d.last_seen_at ?? "—"}</td>
            <td><button type="button" data-toggle-history="${d.mac}">${expanded ? "Hide" : "View"} history (${history.length})</button></td>
          </tr>`;
          if (!expanded) return row;
          const historyTable = history.length
            ? `<table>
                <thead><tr><th>ID</th><th>Task sequence</th><th>Status</th><th>Domain join</th><th>Technician</th><th>Updated</th></tr></thead>
                <tbody>${history.map((j) => jobRow(j, labelFor, false)).join("")}</tbody>
              </table>`
            : `<p class="empty">No jobs recorded for this device yet.</p>`;
          return `${row}<tr class="history-row"><td colspan="5">${historyTable}</td></tr>`;
        })
        .join("")
    : emptyRow(5, "No devices yet.");
}

devicesBody.addEventListener("click", (e) => {
  const mac = (e.target as HTMLElement).dataset.toggleHistory;
  if (!mac) return;
  if (expandedDeviceMacs.has(mac)) {
    expandedDeviceMacs.delete(mac);
  } else {
    expandedDeviceMacs.add(mac);
  }
  loadDevices().catch(showError);
});

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
  const [apps, builtins] = await Promise.all([api.listCatalogApps(), api.listCatalogBuiltinActions()]);
  stepLabels = {
    ...Object.fromEntries(apps.map((a) => [`app:${a.id}`, a.label])),
    ...Object.fromEntries(builtins.map((b) => [`builtin:${b.id}`, b.label])),
  };
  const appOptions = apps.map((a) => `<option value="app:${a.id}">${a.label}</option>`).join("");
  const builtinOptions = builtins.map((b) => `<option value="builtin:${b.id}">${b.label}</option>`).join("");
  tsStepSelect.innerHTML = `
    <optgroup label="Apps">${appOptions || "<option disabled>No apps yet</option>"}</optgroup>
    <optgroup label="Built-in actions">${builtinOptions}</optgroup>
  `;
  tsNoAppsHint.hidden = apps.length > 0;
}

function renderStepsList() {
  tsStepsList.innerHTML = currentSteps.length
    ? currentSteps
        .map(
          (step, i) => `<li>
            <span>${stepLabels[stepKey(step)] ?? step.id}</span>
            <button type="button" data-step-up="${i}" ${i === 0 ? "disabled" : ""}>&uarr;</button>
            <button type="button" data-step-down="${i}" ${i === currentSteps.length - 1 ? "disabled" : ""}>&darr;</button>
            <button type="button" class="danger" data-step-remove="${i}">Remove</button>
          </li>`
        )
        .join("")
    : `<li class="empty">No steps yet.</li>`;
}

async function loadTaskSequencesTable() {
  const [sequences, profiles, apps, builtins] = await Promise.all([
    api.listCatalogTaskSequences(),
    api.listCatalogProfiles(),
    api.listCatalogApps(),
    api.listCatalogBuiltinActions(),
  ]);
  const profileLabel = (id: string) => profiles.find((p) => p.id === id)?.label ?? id;
  const stepLabel = (step: TaskSequenceStep) =>
    step.kind === "app"
      ? (apps.find((a) => a.id === step.id)?.label ?? step.id)
      : (builtins.find((b) => b.id === step.id)?.label ?? step.id);
  const stepsSummary = (steps: TaskSequenceStep[]) => steps.map(stepLabel).join(", ") || "—";
  taskSequencesBody.innerHTML = sequences.length
    ? sequences
        .map(
          (s) => `<tr>
            <td class="mono">${s.id}</td>
            <td>${s.label}</td>
            <td>${profileLabel(s.osProfileId)}</td>
            <td>${stepsSummary(s.steps)}</td>
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
  profileWimUploadBtn.disabled = true;
  profileWimProgress.hidden = true;
  profileWimProgressBar.value = 0;
}

function resetAppForm() {
  editingAppId = null;
  appForm.reset();
  appIdInput.disabled = false;
  appSubmitBtn.textContent = "Add app";
  appCancelBtn.hidden = true;
}

function renderWizardReview() {
  const profileLabel = tsProfileSelect.selectedOptions[0]?.textContent ?? tsProfileSelect.value;
  const stepsHtml = currentSteps.length
    ? `<ol>${currentSteps.map((s) => `<li>${stepLabels[stepKey(s)] ?? s.id}</li>`).join("")}</ol>`
    : `<p class="empty">No steps - just applies the OS image.</p>`;
  tsReview.innerHTML = `
    <dl>
      <dt>ID</dt><dd class="mono">${tsIdInput.value}</dd>
      <dt>Label</dt><dd>${tsLabelInput.value}</dd>
      <dt>OS profile</dt><dd>${profileLabel}</dd>
      <dt>Steps</dt><dd>${stepsHtml}</dd>
    </dl>
  `;
}

function showWizardStep(step: number) {
  wizardStep = step;
  for (const el of tsWizardSteps) {
    el.hidden = Number(el.dataset.wizardStep) !== step;
  }
  tsWizardStepLabel.textContent = `Step ${step} of ${WIZARD_STEP_COUNT} - ${["Basics", "Steps", "Review"][step - 1]}`;
  tsBackBtn.hidden = step === 1;
  tsNextBtn.hidden = step === WIZARD_STEP_COUNT;
  tsSubmitBtn.hidden = step !== WIZARD_STEP_COUNT;
  if (step === WIZARD_STEP_COUNT) renderWizardReview();
}

function openTaskSequenceWizard(sequence?: TaskSequence) {
  taskSequenceForm.reset();
  editingTaskSequenceId = sequence?.id ?? null;
  tsIdInput.disabled = Boolean(sequence);
  tsWizardTitle.textContent = sequence ? "Edit task sequence" : "New task sequence";
  tsSubmitBtn.textContent = sequence ? "Save task sequence" : "Add task sequence";
  if (sequence) {
    tsIdInput.value = sequence.id;
    tsLabelInput.value = sequence.label;
    tsProfileSelect.value = sequence.osProfileId;
    currentSteps = [...sequence.steps];
  } else {
    currentSteps = [];
  }
  renderStepsList();
  showWizardStep(1);
  tsWizard.showModal();
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

profileWimFileInput.addEventListener("change", () => {
  profileWimUploadBtn.disabled = !profileWimFileInput.files?.length;
});

const WIM_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

profileWimUploadBtn.addEventListener("click", async () => {
  const file = profileWimFileInput.files?.[0];
  if (!file) return;
  const profileId = profileIdInput.value.trim();
  if (!profileId) {
    showError(new Error("Enter a profile ID above before uploading a WIM."));
    return;
  }
  const key = `${profileId}/sources/${file.name}`;

  errorEl.textContent = "";
  profileWimUploadBtn.disabled = true;
  profileWimFileInput.disabled = true;
  profileWimProgress.hidden = false;
  profileWimProgressBar.value = 0;
  profileWimProgressText.textContent = "Starting upload...";

  const totalChunks = Math.ceil(file.size / WIM_UPLOAD_CHUNK_BYTES);
  let uploadId: string | undefined;
  try {
    const created = await api.createUpload(key);
    uploadId = created.uploadId;
    const parts: { partNumber: number; etag: string }[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const chunk = file.slice(i * WIM_UPLOAD_CHUNK_BYTES, (i + 1) * WIM_UPLOAD_CHUNK_BYTES);
      const part = await api.uploadPart(uploadId, key, i + 1, chunk);
      parts.push(part);
      const percent = Math.round(((i + 1) / totalChunks) * 100);
      profileWimProgressBar.value = percent;
      profileWimProgressText.textContent = `Uploading... ${percent}% (${i + 1}/${totalChunks})`;
    }
    await api.completeUpload(uploadId, key, parts);
    profileInstallWimInput.value = key;
    profileWimProgressText.textContent = "Upload complete.";
  } catch (err) {
    if (uploadId) await api.abortUpload(uploadId, key).catch(() => {});
    profileWimProgress.hidden = true;
    showError(err);
  } finally {
    profileWimFileInput.disabled = false;
    profileWimUploadBtn.disabled = !profileWimFileInput.files?.length;
  }
});

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
  const [kind, id] = tsStepSelect.value.split(/:(.*)/s) as [TaskSequenceStep["kind"], string];
  currentSteps.push({ kind, id });
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

tsNewBtn.addEventListener("click", async () => {
  errorEl.textContent = "";
  await loadTsProfileOptions();
  await loadTsStepOptions();
  openTaskSequenceWizard();
});

tsNextBtn.addEventListener("click", () => {
  if (wizardStep === 1 && !taskSequenceForm.checkValidity()) {
    taskSequenceForm.reportValidity();
    return;
  }
  showWizardStep(wizardStep + 1);
});

tsBackBtn.addEventListener("click", () => showWizardStep(wizardStep - 1));

tsCancelBtn.addEventListener("click", () => tsWizard.close());

taskSequenceForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  const sequence: TaskSequence = {
    id: tsIdInput.value,
    label: tsLabelInput.value,
    osProfileId: tsProfileSelect.value,
    steps: [...currentSteps],
  };
  try {
    if (editingTaskSequenceId) {
      await api.updateCatalogTaskSequence(editingTaskSequenceId, sequence);
    } else {
      await api.createCatalogTaskSequence(sequence);
    }
    tsWizard.close();
    await refresh();
  } catch (err) {
    showError(err);
  }
});

taskSequencesBody.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;
  const editId = target.dataset.editTs;
  const deleteId = target.dataset.deleteTs;
  if (editId) {
    const sequences = await api.listCatalogTaskSequences();
    const sequence = sequences.find((s) => s.id === editId);
    if (!sequence) return;
    await loadTsProfileOptions();
    await loadTsStepOptions(); // ensure stepLabels is populated before rendering
    openTaskSequenceWizard(sequence);
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
