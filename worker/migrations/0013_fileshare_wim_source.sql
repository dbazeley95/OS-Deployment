-- Adds an alternative "network file share" source for an OS profile's WIM,
-- alongside the existing R2-hosted source - useful when several machines are
-- building at once, so the WinPE deploy flow can pull install.wim over the
-- LAN (a Windows Server share, authenticated with the same credentials
-- DeployGui.ps1 already collects for domain-join) instead of repeatedly
-- through the Worker/R2 over the internet.
--
-- install_wim_key stays NOT NULL (a full table rebuild to relax it is
-- blocked on D1 - PRAGMA foreign_keys = OFF doesn't suppress the FK check
-- task_sequences.os_profile_id holds against this table, even wrapped
-- around the DROP/rename in the same statement batch) - a fileshare-sourced
-- profile stores '' there instead of true NULL; worker/src/lib/profiles.ts
-- normalizes '' <-> null at the API boundary so the app-facing contract
-- (OsProfile.installWim: string | null) stays clean either way.
ALTER TABLE os_profiles ADD COLUMN source_type TEXT NOT NULL DEFAULT 'r2';
ALTER TABLE os_profiles ADD COLUMN file_share_path TEXT;
