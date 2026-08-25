import type { Bindings } from "../types";
import { AppEntry, getApp } from "./apps";
import { BuiltinAction, getBuiltinAction } from "./builtinActions";

/**
 * A task sequence bundles one OS profile, one answer file, and an ordered
 * list of steps to run after imaging - the cloud-editable "what to deploy"
 * unit the WinPE wizard picks from, matching MDT's task sequence concept.
 * Backed by the `task_sequences` D1 table (migrations/0006_task_sequences.sql,
 * migrations/0012_answer_file_on_task_sequence.sql) and managed via the admin
 * UI's catalog editor (worker/src/routes/catalog.ts). The answer file lives
 * here rather than on the OS profile so two task sequences built on the same
 * profile can each use a different one (e.g. per-site owner/timezone).
 *
 * A step is either an `app` (installer/script from the `apps` catalog) or
 * a `builtin` (a fixed, code-defined action like "Install Windows Updates"
 * - see builtinActions.ts) - no R2 file needed for those.
 */
export type TaskSequenceStepKind = "app" | "builtin";

export interface TaskSequenceStep {
  kind: TaskSequenceStepKind;
  id: string;
}

export interface TaskSequence {
  id: string;
  label: string;
  osProfileId: string;
  /** R2 key for the unattended-install answer file (unattend.xml) this sequence uses. */
  answerFile: string;
  steps: TaskSequenceStep[];
}

export interface ResolvedTaskSequenceStep extends TaskSequenceStep {
  label: string;
  /** Only present for kind="app". */
  r2Key?: string;
  installKind?: AppEntry["installKind"];
  installArgs?: string | null;
}

export interface ResolvedTaskSequence extends Omit<TaskSequence, "steps"> {
  /** Steps resolved to full details, in order. Missing/deleted apps or unknown builtin ids are skipped. */
  steps: ResolvedTaskSequenceStep[];
}

interface TaskSequenceRow {
  id: string;
  label: string;
  os_profile_id: string;
  answer_file_key: string;
  steps_json: string;
}

function isStep(x: unknown): x is TaskSequenceStep {
  return (
    typeof x === "object" &&
    x !== null &&
    ((x as TaskSequenceStep).kind === "app" || (x as TaskSequenceStep).kind === "builtin") &&
    typeof (x as TaskSequenceStep).id === "string"
  );
}

function rowToTaskSequence(row: TaskSequenceRow): TaskSequence {
  let steps: TaskSequenceStep[] = [];
  try {
    const parsed = JSON.parse(row.steps_json);
    if (Array.isArray(parsed)) steps = parsed.filter(isStep);
  } catch {
    steps = [];
  }
  return { id: row.id, label: row.label, osProfileId: row.os_profile_id, answerFile: row.answer_file_key, steps };
}

export interface TaskSequenceInput {
  id: string;
  label: string;
  osProfileId: string;
  answerFile: string;
  steps: TaskSequenceStep[];
}

export async function listTaskSequences(db: Bindings["DB"]): Promise<TaskSequence[]> {
  const { results } = await db.prepare(`SELECT * FROM task_sequences ORDER BY label`).all<TaskSequenceRow>();
  return (results ?? []).map(rowToTaskSequence);
}

export async function getTaskSequence(db: Bindings["DB"], id: string): Promise<TaskSequence | null> {
  const row = await db.prepare(`SELECT * FROM task_sequences WHERE id = ?1`).bind(id).first<TaskSequenceRow>();
  return row ? rowToTaskSequence(row) : null;
}

export async function resolveTaskSequence(db: Bindings["DB"], id: string): Promise<ResolvedTaskSequence | null> {
  const sequence = await getTaskSequence(db, id);
  if (!sequence) return null;
  const steps: ResolvedTaskSequenceStep[] = [];
  for (const step of sequence.steps) {
    if (step.kind === "app") {
      const app = await getApp(db, step.id);
      if (app)
        steps.push({
          kind: "app",
          id: app.id,
          label: app.label,
          r2Key: app.r2Key,
          installKind: app.installKind,
          installArgs: app.installArgs,
        });
    } else {
      const action: BuiltinAction | null = getBuiltinAction(step.id);
      if (action) steps.push({ kind: "builtin", id: action.id, label: action.label });
    }
  }
  return { ...sequence, steps };
}

export async function createTaskSequence(db: Bindings["DB"], input: TaskSequenceInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO task_sequences (id, label, os_profile_id, answer_file_key, steps_json) VALUES (?1, ?2, ?3, ?4, ?5)`
    )
    .bind(input.id, input.label, input.osProfileId, input.answerFile, JSON.stringify(input.steps))
    .run();
}

export async function updateTaskSequence(db: Bindings["DB"], id: string, input: TaskSequenceInput): Promise<boolean> {
  const { meta } = await db
    .prepare(
      `UPDATE task_sequences SET label = ?2, os_profile_id = ?3, answer_file_key = ?4, steps_json = ?5,
         updated_at = datetime('now')
       WHERE id = ?1`
    )
    .bind(id, input.label, input.osProfileId, input.answerFile, JSON.stringify(input.steps))
    .run();
  return meta.changes > 0;
}

export async function deleteTaskSequence(db: Bindings["DB"], id: string): Promise<boolean> {
  const { meta } = await db.prepare(`DELETE FROM task_sequences WHERE id = ?1`).bind(id).run();
  return meta.changes > 0;
}
