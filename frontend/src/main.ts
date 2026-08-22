import {
  api,
  ApiError,
  type AnswerFile,
  type AnswerFileOptions,
  type AppEntry,
  type BuiltinAction,
  type DeploymentJob,
  type OsProfile,
  type TaskSequence,
  type TaskSequenceStep,
} from "./api";
import { findWindowsWimInIso } from "./iso";
import { generateAnswerFile } from "./answerFile";

const versionBadge = document.querySelector<HTMLButtonElement>("#version-badge")!;
const releaseNotesDialog = document.querySelector<HTMLDialogElement>("#release-notes-dialog")!;
const releaseNotesVersion = document.querySelector<HTMLElement>("#release-notes-version")!;
const releaseNotesList = document.querySelector<HTMLUListElement>("#release-notes-list")!;
const releaseNotesCloseBtn = document.querySelector<HTMLButtonElement>("#release-notes-close")!;

const appVersion = import.meta.env.VITE_APP_VERSION;
const commitSha = import.meta.env.VITE_COMMIT_SHA;
versionBadge.textContent = appVersion || "dev";
versionBadge.title = "Click for release notes";

// Baked in at build time (see .github/workflows/deploy-pages.yml) as the
// subjects of the most recent commits to main - since every PR ships as one
// descriptively-titled squash commit, those subjects double as a changelog.
const releaseNotes: string[] = (() => {
  try {
    return JSON.parse(import.meta.env.VITE_RELEASE_NOTES ?? "[]");
  } catch {
    return [];
  }
})();

versionBadge.addEventListener("click", () => {
  releaseNotesVersion.textContent = appVersion
    ? `Build ${appVersion}${commitSha ? ` (${commitSha.slice(0, 7)})` : ""}`
    : "Local dev build";
  releaseNotesList.innerHTML = releaseNotes.length
    ? releaseNotes.map((note) => `<li>${note}</li>`).join("")
    : '<li class="empty">No release notes available.</li>';
  releaseNotesDialog.showModal();
});
releaseNotesCloseBtn.addEventListener("click", () => releaseNotesDialog.close());

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
const profileIsoFileInput = document.querySelector<HTMLInputElement>("#profile-iso-file")!;
const profileIsoUploadBtn = document.querySelector<HTMLButtonElement>("#profile-iso-upload-btn")!;
const profileWimProgress = document.querySelector<HTMLElement>("#profile-wim-progress")!;
const profileWimProgressBar = document.querySelector<HTMLProgressElement>("#profile-wim-progress-bar")!;
const profileWimProgressText = document.querySelector<HTMLElement>("#profile-wim-progress-text")!;
const profileAnswerFileSelect = document.querySelector<HTMLSelectElement>("#profile-answer-file")!;

const answerFilesBody = document.querySelector<HTMLElement>("#answer-files-body")!;
const afNewBtn = document.querySelector<HTMLButtonElement>("#af-new-btn")!;
const afWizard = document.querySelector<HTMLDialogElement>("#af-wizard")!;
const afWizardTitle = document.querySelector<HTMLElement>("#af-wizard-title")!;
const afWizardStepLabel = document.querySelector<HTMLElement>("#af-wizard-step-label")!;
const afWizardSteps = Array.from(afWizard.querySelectorAll<HTMLElement>(".wizard-step"));
const answerFileForm = document.querySelector<HTMLFormElement>("#answer-file-form")!;
const afIdInput = document.querySelector<HTMLInputElement>("#af-id")!;
const afLabelInput = document.querySelector<HTMLInputElement>("#af-label")!;
const afUiLanguageInput = document.querySelector<HTMLInputElement>("#af-uilanguage")!;
const afTimeZoneInput = document.querySelector<HTMLInputElement>("#af-timezone")!;
const afOwnerInput = document.querySelector<HTMLInputElement>("#af-owner")!;
const afOrgInput = document.querySelector<HTMLInputElement>("#af-org")!;
const afProductKeyInput = document.querySelector<HTMLInputElement>("#af-productkey")!;
const afSkipOobeInput = document.querySelector<HTMLInputElement>("#af-skipoobe")!;
const afReview = document.querySelector<HTMLElement>("#af-review")!;
const afBackBtn = document.querySelector<HTMLButtonElement>("#af-back-btn")!;
const afNextBtn = document.querySelector<HTMLButtonElement>("#af-next-btn")!;
const afSubmitBtn = document.querySelector<HTMLButtonElement>("#af-submit")!;
const afCancelBtn = document.querySelector<HTMLButtonElement>("#af-cancel")!;

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
let editingAnswerFileId: string | null = null;
let currentSteps: TaskSequenceStep[] = [];
let stepLabels: Record<string, string> = {};
let wizardStep = 1;
const WIZARD_STEP_COUNT = 3;
let afWizardStep = 1;
const AF_WIZARD_STEP_COUNT = 3;
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

async function loadAnswerFileSelectOptions() {
  const answerFiles = await api.listCatalogAnswerFiles();
  profileAnswerFileSelect.innerHTML = answerFiles
    .map((a) => `<option value="${a.r2Key}">${a.label}</option>`)
    .join("");
}

function answerFileOptionsSummary(o: AnswerFileOptions): string {
  const bits = [o.uiLanguage, o.timeZone, o.productKey ? "product key set" : null, o.skipOobe ? "skips OOBE" : null];
  return bits.filter(Boolean).join(", ");
}

async function loadAnswerFilesTable() {
  const answerFiles = await api.listCatalogAnswerFiles();
  answerFilesBody.innerHTML = answerFiles.length
    ? answerFiles
        .map(
          (a) => `<tr>
            <td class="mono">${a.id}</td>
            <td>${a.label}</td>
            <td>${answerFileOptionsSummary(a.options)}</td>
            <td class="mono">${a.r2Key}</td>
            <td class="row-actions">
              <button type="button" data-edit-af="${a.id}">Edit</button>
              <button type="button" class="danger" data-delete-af="${a.id}">Delete</button>
            </td>
          </tr>`
        )
        .join("")
    : emptyRow(5, "No answer files yet.");
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
      loadAnswerFileSelectOptions(),
      loadAnswerFilesTable(),
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
  profileIsoUploadBtn.disabled = true;
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

function renderAnswerFileWizardReview() {
  afReview.innerHTML = `
    <dl>
      <dt>ID</dt><dd class="mono">${afIdInput.value}</dd>
      <dt>Label</dt><dd>${afLabelInput.value}</dd>
      <dt>UI language / locale</dt><dd>${afUiLanguageInput.value}</dd>
      <dt>Time zone</dt><dd>${afTimeZoneInput.value || "—"}</dd>
      <dt>Registered owner</dt><dd>${afOwnerInput.value || "—"}</dd>
      <dt>Registered organization</dt><dd>${afOrgInput.value || "—"}</dd>
      <dt>Product key</dt><dd>${afProductKeyInput.value || "—"}</dd>
      <dt>Skip OOBE prompts</dt><dd>${afSkipOobeInput.checked ? "Yes" : "No"}</dd>
    </dl>
  `;
}

function showAnswerFileWizardStep(step: number) {
  afWizardStep = step;
  for (const el of afWizardSteps) {
    el.hidden = Number(el.dataset.wizardStep) !== step;
  }
  afWizardStepLabel.textContent = `Step ${step} of ${AF_WIZARD_STEP_COUNT} - ${["Basics", "Options", "Review"][step - 1]}`;
  afBackBtn.hidden = step === 1;
  afNextBtn.hidden = step === AF_WIZARD_STEP_COUNT;
  afSubmitBtn.hidden = step !== AF_WIZARD_STEP_COUNT;
  if (step === AF_WIZARD_STEP_COUNT) renderAnswerFileWizardReview();
}

function openAnswerFileWizard(answerFile?: AnswerFile) {
  answerFileForm.reset();
  editingAnswerFileId = answerFile?.id ?? null;
  afIdInput.disabled = Boolean(answerFile);
  afWizardTitle.textContent = answerFile ? "Edit answer file" : "New answer file";
  afSubmitBtn.textContent = answerFile ? "Save answer file" : "Add answer file";
  if (answerFile) {
    afIdInput.value = answerFile.id;
    afLabelInput.value = answerFile.label;
    afUiLanguageInput.value = answerFile.options.uiLanguage;
    afTimeZoneInput.value = answerFile.options.timeZone;
    afOwnerInput.value = answerFile.options.registeredOwner;
    afOrgInput.value = answerFile.options.registeredOrganization;
    afProductKeyInput.value = answerFile.options.productKey;
    afSkipOobeInput.checked = answerFile.options.skipOobe;
  } else {
    afUiLanguageInput.value = "en-US";
    afSkipOobeInput.checked = true;
  }
  showAnswerFileWizardStep(1);
  afWizard.showModal();
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

profileIsoFileInput.addEventListener("change", () => {
  profileIsoUploadBtn.disabled = !profileIsoFileInput.files?.length;
});

const WIM_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
// Parts upload in parallel rather than one at a time - sequential uploads
// pay a full request round-trip's worth of latency per 8MB chunk before the
// next one even starts, so throughput never gets anywhere near the actual
// available bandwidth on a multi-GB file. HTTP/2 (which Cloudflare serves)
// multiplexes these over one connection, so this isn't fighting the
// browser's old per-origin connection cap.
const WIM_UPLOAD_CONCURRENCY = 6;
// A part that hasn't finished in this long is presumed stalled (a dropped
// connection sitting silently, not a timeout error) and gets aborted+retried
// rather than left to hang forever. Generous on purpose - an 8MB part at a
// genuinely slow-but-working ~1 Mbps still finishes in a bit over a minute.
const PART_TIMEOUT_MS = 90_000;
const PART_MAX_ATTEMPTS = 4;

interface UploadSource {
  size: number;
  slice(start: number, end: number): Blob;
}

type UploadedPart = { partNumber: number; etag: string };

interface StoredUploadProgress {
  uploadId: string;
  key: string;
  size: number;
  parts: UploadedPart[];
}

function uploadProgressStorageKey(key: string): string {
  return `wipe:upload-progress:${key}`;
}

// Resumability is a nice-to-have on top of a working upload, not a
// requirement of it - localStorage can fail (quota, private browsing), and
// none of that should ever break the upload itself, just the ability to
// resume it later.
function loadStoredUploadProgress(key: string, size: number): StoredUploadProgress | null {
  try {
    const raw = localStorage.getItem(uploadProgressStorageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredUploadProgress;
    return parsed.key === key && parsed.size === size ? parsed : null;
  } catch {
    return null;
  }
}

function saveUploadProgress(progress: StoredUploadProgress) {
  try {
    localStorage.setItem(uploadProgressStorageKey(progress.key), JSON.stringify(progress));
  } catch {
    /* resuming later just won't be possible - the upload itself is unaffected */
  }
}

function clearUploadProgress(key: string) {
  try {
    localStorage.removeItem(uploadProgressStorageKey(key));
  } catch {
    /* nothing to do - it'll just look like stale progress next time */
  }
}

async function uploadPartWithRetry(
  uploadId: string,
  key: string,
  partNumber: number,
  chunk: Blob,
  onStalled: (attempt: number) => void
): Promise<UploadedPart> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= PART_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PART_TIMEOUT_MS);
    try {
      return await api.uploadPart(uploadId, key, partNumber, chunk, controller.signal);
    } catch (err) {
      lastError = err;
      if (attempt < PART_MAX_ATTEMPTS) {
        onStalled(attempt);
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function uploadPartsConcurrently(
  uploadId: string,
  key: string,
  totalChunks: number,
  source: UploadSource,
  alreadyUploaded: UploadedPart[],
  onProgress: (parts: UploadedPart[]) => void
): Promise<UploadedPart[]> {
  const parts: (UploadedPart | undefined)[] = new Array(totalChunks);
  for (const part of alreadyUploaded) parts[part.partNumber - 1] = part;
  const snapshot = () => parts.filter((p): p is UploadedPart => Boolean(p));

  let nextIndex = 0;
  let stopped = false;
  let firstError: unknown;

  async function worker() {
    while (!stopped) {
      const i = nextIndex++;
      if (i >= totalChunks) return;
      if (parts[i]) continue; // already uploaded in an earlier attempt at this same upload
      try {
        const chunk = source.slice(i * WIM_UPLOAD_CHUNK_BYTES, (i + 1) * WIM_UPLOAD_CHUNK_BYTES);
        parts[i] = await uploadPartWithRetry(uploadId, key, i + 1, chunk, () => {
          profileWimProgressText.textContent = `Part ${i + 1} stalled, retrying... (${snapshot().length}/${totalChunks} done)`;
        });
        onProgress(snapshot());
      } catch (err) {
        stopped = true;
        firstError = err;
        return;
      }
    }
  }

  const workerCount = Math.min(WIM_UPLOAD_CONCURRENCY, totalChunks);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (firstError) throw firstError;
  return snapshot();
}

// Shared by both "upload a WIM directly" and "extract from an ISO" - the
// only difference is where the byte source's data actually lives (a plain
// File vs. a lazy slice() over install.wim's extents inside a local ISO).
async function uploadWimSource(key: string, source: UploadSource, inputsToDisable: HTMLInputElement[]) {
  errorEl.textContent = "";
  profileWimUploadBtn.disabled = true;
  profileIsoUploadBtn.disabled = true;
  for (const input of inputsToDisable) input.disabled = true;
  profileWimProgress.hidden = false;
  profileWimProgressBar.value = 0;
  profileWimProgressText.textContent = "Starting upload...";

  const totalChunks = Math.ceil(source.size / WIM_UPLOAD_CHUNK_BYTES);
  try {
    const resumable = loadStoredUploadProgress(key, source.size);
    const uploadId = resumable ? resumable.uploadId : (await api.createUpload(key)).uploadId;
    const alreadyUploaded = resumable?.parts ?? [];
    if (resumable) {
      profileWimProgressText.textContent = `Resuming upload (${alreadyUploaded.length}/${totalChunks} parts already done)...`;
    }

    const parts = await uploadPartsConcurrently(uploadId, key, totalChunks, source, alreadyUploaded, (done) => {
      saveUploadProgress({ uploadId, key, size: source.size, parts: done });
      const percent = Math.round((done.length / totalChunks) * 100);
      profileWimProgressBar.value = percent;
      profileWimProgressText.textContent = `Uploading... ${percent}% (${done.length}/${totalChunks})`;
    });
    await api.completeUpload(uploadId, key, parts);
    clearUploadProgress(key);
    profileInstallWimInput.value = key;
    profileWimProgressText.textContent = "Upload complete.";
  } catch (err) {
    // Deliberately not aborting the R2-side multipart upload here - parts
    // already uploaded stay valid, and the saved progress above lets
    // re-selecting the same file resume from where this left off instead of
    // starting a multi-GB upload over from scratch.
    profileWimProgress.hidden = true;
    showError(
      new Error(`${err instanceof Error ? err.message : String(err)} - re-select the same file to resume where it left off.`)
    );
  } finally {
    for (const input of inputsToDisable) input.disabled = false;
    profileWimUploadBtn.disabled = !profileWimFileInput.files?.length;
    profileIsoUploadBtn.disabled = !profileIsoFileInput.files?.length;
  }
}

profileWimUploadBtn.addEventListener("click", async () => {
  const file = profileWimFileInput.files?.[0];
  if (!file) return;
  const profileId = profileIdInput.value.trim();
  if (!profileId) {
    showError(new Error("Enter a profile ID above before uploading a WIM."));
    return;
  }
  const key = `${profileId}/sources/${file.name}`;
  await uploadWimSource(key, file, [profileWimFileInput]);
});

profileIsoUploadBtn.addEventListener("click", async () => {
  const file = profileIsoFileInput.files?.[0];
  if (!file) return;
  const profileId = profileIdInput.value.trim();
  if (!profileId) {
    showError(new Error("Enter a profile ID above before extracting from an ISO."));
    return;
  }

  errorEl.textContent = "";
  profileIsoUploadBtn.disabled = true;
  profileIsoFileInput.disabled = true;
  profileWimProgress.hidden = false;
  profileWimProgressBar.value = 0;
  profileWimProgressText.textContent = "Reading ISO filesystem...";
  try {
    const wim = await findWindowsWimInIso(file);
    const key = `${profileId}/sources/${wim.name}`;
    await uploadWimSource(key, wim, [profileIsoFileInput]);
  } catch (err) {
    profileWimProgress.hidden = true;
    showError(err);
    profileIsoFileInput.disabled = false;
    profileIsoUploadBtn.disabled = !profileIsoFileInput.files?.length;
  }
});

afNewBtn.addEventListener("click", async () => {
  errorEl.textContent = "";
  openAnswerFileWizard();
});

afNextBtn.addEventListener("click", () => {
  if (afWizardStep === 1 && !afIdInput.checkValidity()) {
    afIdInput.reportValidity();
    return;
  }
  if (afWizardStep === 2 && !afUiLanguageInput.checkValidity()) {
    afUiLanguageInput.reportValidity();
    return;
  }
  showAnswerFileWizardStep(afWizardStep + 1);
});

afBackBtn.addEventListener("click", () => showAnswerFileWizardStep(afWizardStep - 1));

afCancelBtn.addEventListener("click", () => afWizard.close());

answerFileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  const options: AnswerFileOptions = {
    uiLanguage: afUiLanguageInput.value,
    timeZone: afTimeZoneInput.value,
    registeredOwner: afOwnerInput.value,
    registeredOrganization: afOrgInput.value,
    productKey: afProductKeyInput.value,
    skipOobe: afSkipOobeInput.checked,
  };
  try {
    const content = generateAnswerFile(options);
    const input = { id: afIdInput.value, label: afLabelInput.value, options, content };
    if (editingAnswerFileId) {
      await api.updateCatalogAnswerFile(editingAnswerFileId, input);
    } else {
      await api.createCatalogAnswerFile(input);
    }
    afWizard.close();
    await refresh();
  } catch (err) {
    showError(err);
  }
});

answerFilesBody.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;
  const editId = target.dataset.editAf;
  const deleteId = target.dataset.deleteAf;
  if (editId) {
    const answerFiles = await api.listCatalogAnswerFiles();
    const answerFile = answerFiles.find((a) => a.id === editId);
    if (!answerFile) return;
    openAnswerFileWizard(answerFile);
  } else if (deleteId) {
    if (!confirm(`Delete answer file "${deleteId}"?`)) return;
    try {
      await api.deleteCatalogAnswerFile(deleteId);
      await refresh();
    } catch (err) {
      showError(err);
    }
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
    profileAnswerFileSelect.value = profile.answerFile;
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
