import type { Bindings } from "../types";

/**
 * Catalog of generated answer files (unattend.xml), backed by the
 * `answer_files` D1 table (see migrations/0010_answer_files.sql). The actual
 * XML content lives in R2 at r2Key - this table just tracks which ones exist
 * and the wizard options that produced them, so editing one re-opens the
 * wizard pre-filled instead of starting over. Content generation itself
 * happens client-side (frontend/src/answerFile.ts); this is metadata only.
 */
export interface AnswerFileOptions {
  uiLanguage: string;
  timeZone: string;
  registeredOwner: string;
  registeredOrganization: string;
  productKey: string;
  skipOobe: boolean;
}

export interface AnswerFile {
  id: string;
  label: string;
  r2Key: string;
  options: AnswerFileOptions;
}

export type AnswerFileInput = AnswerFile;

interface AnswerFileRow {
  id: string;
  label: string;
  r2_key: string;
  options_json: string;
}

function rowToAnswerFile(row: AnswerFileRow): AnswerFile {
  return { id: row.id, label: row.label, r2Key: row.r2_key, options: JSON.parse(row.options_json) };
}

export async function listAnswerFiles(db: Bindings["DB"]): Promise<AnswerFile[]> {
  const { results } = await db.prepare(`SELECT * FROM answer_files ORDER BY label`).all<AnswerFileRow>();
  return (results ?? []).map(rowToAnswerFile);
}

export async function getAnswerFile(db: Bindings["DB"], id: string): Promise<AnswerFile | null> {
  const row = await db.prepare(`SELECT * FROM answer_files WHERE id = ?1`).bind(id).first<AnswerFileRow>();
  return row ? rowToAnswerFile(row) : null;
}

export async function createAnswerFile(db: Bindings["DB"], input: AnswerFileInput): Promise<void> {
  await db
    .prepare(`INSERT INTO answer_files (id, label, r2_key, options_json) VALUES (?1, ?2, ?3, ?4)`)
    .bind(input.id, input.label, input.r2Key, JSON.stringify(input.options))
    .run();
}

export async function updateAnswerFile(db: Bindings["DB"], id: string, input: AnswerFileInput): Promise<boolean> {
  const { meta } = await db
    .prepare(
      `UPDATE answer_files SET label = ?2, r2_key = ?3, options_json = ?4, updated_at = datetime('now') WHERE id = ?1`
    )
    .bind(id, input.label, input.r2Key, JSON.stringify(input.options))
    .run();
  return meta.changes > 0;
}

export async function deleteAnswerFile(db: Bindings["DB"], id: string): Promise<boolean> {
  const { meta } = await db.prepare(`DELETE FROM answer_files WHERE id = ?1`).bind(id).run();
  return meta.changes > 0;
}
