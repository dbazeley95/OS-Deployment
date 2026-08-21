-- Replaces the post_action/app_id post-imaging model with task sequences
-- (see 0006_task_sequences.sql) plus an orthogonal domain-join toggle,
-- matching the WinPE wizard's Lite-Touch-style flow. No real production
-- jobs depend on the old columns yet, so this is a clean cutover rather
-- than keeping two parallel schemas.
ALTER TABLE deployment_jobs ADD COLUMN task_sequence_id TEXT;
ALTER TABLE deployment_jobs ADD COLUMN domain_join INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deployment_jobs DROP COLUMN post_action;
ALTER TABLE deployment_jobs DROP COLUMN app_id;
