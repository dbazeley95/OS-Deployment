import type { Bindings } from "../types";
import { AppEntry, getApp } from "./apps";

/**
 * A task sequence bundles one OS profile with an ordered list of apps
 * (steps) to install after imaging - the cloud-editable "what to deploy"
 * unit the WinPE wizard picks from, matching MDT's task sequence concept.
 * Backed by the `task_sequences` D1 table (migrations/0006_task_sequences.sql)
 * and managed via the admin UI's catalog editor (worker/src/routes/catalog.ts).
 */
export interface TaskSequence {
  id: string;
  label: string;
  osProfileId: string;
  /** App ids from the `apps` catalog, in install order. */
  stepIds: string[];
}

export interface ResolvedTaskSequence extends TaskSequence {
  /** Steps resolved to full app entries, in order. Missing/deleted apps are skipped. */
  steps: AppEntry[];
}

interface TaskSequenceRow {
  id: string;
  label: string;
  os_profile_id: string;
  steps_json: string;
}

function rowToTaskSequence(row: TaskSequenceRow): TaskSequence {
  let stepIds: string[] = [];
  try {
    const parsed = JSON.parse(row.steps_json);
    if (Array.isArray(parsed)) stepIds = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    stepIds = [];
  }
  return { id: row.id, label: row.label, osProfileId: row.os_profile_id, stepIds };
}

export interface TaskSequenceInput {
  id: string;
  label: string;
  osProfileId: string;
  stepIds: string[];
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
  const steps: AppEntry[] = [];
  for (const appId of sequence.stepIds) {
    const app = await getApp(db, appId);
    if (app) steps.push(app);
  }
  return { ...sequence, steps };
}

export async function createTaskSequence(db: Bindings["DB"], input: TaskSequenceInput): Promise<void> {
  await db
    .prepare(`INSERT INTO task_sequences (id, label, os_profile_id, steps_json) VALUES (?1, ?2, ?3, ?4)`)
    .bind(input.id, input.label, input.osProfileId, JSON.stringify(input.stepIds))
    .run();
}

export async function updateTaskSequence(db: Bindings["DB"], id: string, input: TaskSequenceInput): Promise<boolean> {
  const { meta } = await db
    .prepare(
      `UPDATE task_sequences SET label = ?2, os_profile_id = ?3, steps_json = ?4, updated_at = datetime('now')
       WHERE id = ?1`
    )
    .bind(id, input.label, input.osProfileId, JSON.stringify(input.stepIds))
    .run();
  return meta.changes > 0;
}

export async function deleteTaskSequence(db: Bindings["DB"], id: string): Promise<boolean> {
  const { meta } = await db.prepare(`DELETE FROM task_sequences WHERE id = ?1`).bind(id).run();
  return meta.changes > 0;
}
