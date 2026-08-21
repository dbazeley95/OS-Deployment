import { Hono } from "hono";
import type { Bindings } from "../types";
import {
  createProfile,
  deleteProfile,
  getProfile,
  listProfiles,
  OsProfileInput,
  updateProfile,
} from "../lib/profiles";
import { AppInput, createApp, deleteApp, getApp, InstallKind, listApps, updateApp } from "../lib/apps";
import {
  createTaskSequence,
  deleteTaskSequence,
  getTaskSequence,
  listTaskSequences,
  TaskSequenceInput,
  TaskSequenceStep,
  updateTaskSequence,
} from "../lib/taskSequences";
import { BUILTIN_ACTIONS } from "../lib/builtinActions";

const INSTALL_KINDS: InstallKind[] = ["msi", "exe", "script"];

// R2 keys are used verbatim as object paths - reject anything that could
// escape the intended prefix or isn't a plain relative path.
function isValidR2Key(key: unknown): key is string {
  return typeof key === "string" && key.length > 0 && !key.startsWith("/") && !key.includes("..");
}

/**
 * The "cloud editor" for the deployment catalog - lets the admin UI manage
 * OS profiles, apps, and task sequences (which bundle a profile with an
 * ordered list of apps) directly (D1-backed, see worker/src/lib/profiles.ts,
 * apps.ts, taskSequences.ts) instead of requiring a code change + redeploy.
 * Mounted at /api/catalog, behind the session middleware in worker/src/index.ts.
 */
export const catalogRoute = new Hono<{ Bindings: Bindings }>();

function parseProfileInput(body: unknown): OsProfileInput | { error: string } {
  const b = body as Partial<OsProfileInput> | null;
  if (!b?.id || !b.label || !b.installWim || !b.answerFile) {
    return { error: "id, label, installWim, and answerFile are required" };
  }
  if (typeof b.imageIndex !== "number" || !Number.isInteger(b.imageIndex)) {
    return { error: "imageIndex must be an integer" };
  }
  return {
    id: b.id,
    label: b.label,
    installWim: b.installWim,
    imageIndex: b.imageIndex,
    answerFile: b.answerFile,
  };
}

catalogRoute.get("/profiles", async (c) => c.json(await listProfiles(c.env.DB)));

catalogRoute.post("/profiles", async (c) => {
  const body = await c.req.json().catch(() => null);
  const input = parseProfileInput(body);
  if ("error" in input) return c.json(input, 400);
  if (await getProfile(c.env.DB, input.id)) {
    return c.json({ error: `profile ${input.id} already exists` }, 409);
  }
  await createProfile(c.env.DB, input);
  return c.json({ ok: true }, 201);
});

catalogRoute.put("/profiles/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const input = parseProfileInput({ ...(body as object), id });
  if ("error" in input) return c.json(input, 400);
  const updated = await updateProfile(c.env.DB, id, input);
  if (!updated) return c.json({ error: "profile not found" }, 404);
  return c.json({ ok: true });
});

catalogRoute.delete("/profiles/:id", async (c) => {
  const deleted = await deleteProfile(c.env.DB, c.req.param("id"));
  if (!deleted) return c.json({ error: "profile not found" }, 404);
  return c.json({ ok: true });
});

function parseAppInput(body: unknown): AppInput | { error: string } {
  const b = body as Partial<AppInput> | null;
  if (!b?.id || !b.label || !b.r2Key) {
    return { error: "id, label, and r2Key are required" };
  }
  if (!b.installKind || !INSTALL_KINDS.includes(b.installKind)) {
    return { error: `installKind must be one of: ${INSTALL_KINDS.join(", ")}` };
  }
  return { id: b.id, label: b.label, r2Key: b.r2Key, installKind: b.installKind };
}

catalogRoute.get("/apps", async (c) => c.json(await listApps(c.env.DB)));

catalogRoute.post("/apps", async (c) => {
  const body = await c.req.json().catch(() => null);
  const input = parseAppInput(body);
  if ("error" in input) return c.json(input, 400);
  if (await getApp(c.env.DB, input.id)) {
    return c.json({ error: `app ${input.id} already exists` }, 409);
  }
  await createApp(c.env.DB, input);
  return c.json({ ok: true }, 201);
});

catalogRoute.put("/apps/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const input = parseAppInput({ ...(body as object), id });
  if ("error" in input) return c.json(input, 400);
  const updated = await updateApp(c.env.DB, id, input);
  if (!updated) return c.json({ error: "app not found" }, 404);
  return c.json({ ok: true });
});

catalogRoute.delete("/apps/:id", async (c) => {
  const deleted = await deleteApp(c.env.DB, c.req.param("id"));
  if (!deleted) return c.json({ error: "app not found" }, 404);
  return c.json({ ok: true });
});

function isValidStep(s: unknown): s is TaskSequenceStep {
  return (
    typeof s === "object" &&
    s !== null &&
    ((s as TaskSequenceStep).kind === "app" || (s as TaskSequenceStep).kind === "builtin") &&
    typeof (s as TaskSequenceStep).id === "string"
  );
}

function parseTaskSequenceInput(body: unknown): TaskSequenceInput | { error: string } {
  const b = body as Partial<TaskSequenceInput> | null;
  if (!b?.id || !b.label || !b.osProfileId) {
    return { error: "id, label, and osProfileId are required" };
  }
  if (b.steps !== undefined && (!Array.isArray(b.steps) || !b.steps.every(isValidStep))) {
    return { error: "steps must be an array of {kind: 'app'|'builtin', id: string}" };
  }
  return { id: b.id, label: b.label, osProfileId: b.osProfileId, steps: b.steps ?? [] };
}

catalogRoute.get("/builtin-actions", (c) => c.json(BUILTIN_ACTIONS));

catalogRoute.get("/task-sequences", async (c) => c.json(await listTaskSequences(c.env.DB)));

catalogRoute.post("/task-sequences", async (c) => {
  const body = await c.req.json().catch(() => null);
  const input = parseTaskSequenceInput(body);
  if ("error" in input) return c.json(input, 400);
  if (!(await getProfile(c.env.DB, input.osProfileId))) {
    return c.json({ error: `osProfileId ${input.osProfileId} does not exist` }, 400);
  }
  if (await getTaskSequence(c.env.DB, input.id)) {
    return c.json({ error: `task sequence ${input.id} already exists` }, 409);
  }
  await createTaskSequence(c.env.DB, input);
  return c.json({ ok: true }, 201);
});

catalogRoute.put("/task-sequences/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const input = parseTaskSequenceInput({ ...(body as object), id });
  if ("error" in input) return c.json(input, 400);
  if (!(await getProfile(c.env.DB, input.osProfileId))) {
    return c.json({ error: `osProfileId ${input.osProfileId} does not exist` }, 400);
  }
  const updated = await updateTaskSequence(c.env.DB, id, input);
  if (!updated) return c.json({ error: "task sequence not found" }, 404);
  return c.json({ ok: true });
});

catalogRoute.delete("/task-sequences/:id", async (c) => {
  const deleted = await deleteTaskSequence(c.env.DB, c.req.param("id"));
  if (!deleted) return c.json({ error: "task sequence not found" }, 404);
  return c.json({ ok: true });
});

/**
 * Direct WIM upload for the OS Profiles form - wraps R2's native multipart
 * API (env.IMAGES) so a technician can pick a multi-GB install.wim in the
 * browser instead of typing an R2 key that was uploaded some other way.
 * Each request after the first re-attaches to the in-progress upload via
 * resumeMultipartUpload(key, uploadId), since R2Bucket has no "get upload by
 * id alone" lookup.
 */
catalogRoute.post("/uploads", async (c) => {
  const body = await c.req.json<{ key?: string }>().catch(() => null);
  if (!isValidR2Key(body?.key)) return c.json({ error: "key is required" }, 400);
  const upload = await c.env.IMAGES.createMultipartUpload(body!.key);
  return c.json({ key: upload.key, uploadId: upload.uploadId });
});

catalogRoute.put("/uploads/:uploadId/parts/:partNumber", async (c) => {
  const key = c.req.query("key");
  if (!isValidR2Key(key)) return c.json({ error: "key query param is required" }, 400);
  const partNumber = Number(c.req.param("partNumber"));
  if (!Number.isInteger(partNumber) || partNumber < 1) {
    return c.json({ error: "partNumber must be a positive integer" }, 400);
  }
  const upload = c.env.IMAGES.resumeMultipartUpload(key, c.req.param("uploadId"));
  const part = await upload.uploadPart(partNumber, c.req.raw.body!);
  return c.json({ partNumber: part.partNumber, etag: part.etag });
});

catalogRoute.post("/uploads/:uploadId/complete", async (c) => {
  const body = await c.req.json<{ key?: string; parts?: { partNumber: number; etag: string }[] }>().catch(() => null);
  if (!isValidR2Key(body?.key) || !Array.isArray(body?.parts)) {
    return c.json({ error: "key and parts are required" }, 400);
  }
  const upload = c.env.IMAGES.resumeMultipartUpload(body!.key, c.req.param("uploadId"));
  await upload.complete(body!.parts);
  return c.json({ ok: true });
});

catalogRoute.post("/uploads/:uploadId/abort", async (c) => {
  const body = await c.req.json<{ key?: string }>().catch(() => null);
  if (!isValidR2Key(body?.key)) return c.json({ error: "key is required" }, 400);
  const upload = c.env.IMAGES.resumeMultipartUpload(body!.key, c.req.param("uploadId"));
  await upload.abort();
  return c.json({ ok: true });
});
