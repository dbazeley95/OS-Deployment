-- The WinPE deploy GUI now prompts for a hostname (stored on `devices`,
-- already had a column for it) and, for the domain-join post-action, which
-- domain to join - captured at boot-selection time instead of typed again
-- at first logon. This column records that choice per job so PostAction.ps1
-- can skip re-asking, and so the admin UI can show what was requested.
ALTER TABLE deployment_jobs ADD COLUMN domain TEXT;
