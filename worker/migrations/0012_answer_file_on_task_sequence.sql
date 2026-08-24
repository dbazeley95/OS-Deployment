-- Answer files now belong to the task sequence, not the OS profile - an OS
-- profile is just the Windows edition/WIM/image index now (see the
-- "Operating Systems" rebrand in the admin UI); different task sequences
-- built on the same profile can each pick their own answer file instead of
-- being locked to whatever the profile happened to have.
ALTER TABLE task_sequences ADD COLUMN answer_file_key TEXT NOT NULL DEFAULT '';

-- Backfill: carry over whatever answer file each task sequence's current OS
-- profile had, so existing task sequences keep working without a technician
-- having to re-pick one.
UPDATE task_sequences
SET answer_file_key = COALESCE(
  (SELECT answer_file_key FROM os_profiles WHERE os_profiles.id = task_sequences.os_profile_id),
  ''
);

ALTER TABLE os_profiles DROP COLUMN answer_file_key;
