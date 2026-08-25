-- Optional per-app override for the silent-install command line passed to
-- msiexec/the installer exe (see boot/winpe/PostAction.ps1). There's no
-- universal silent-install switch across arbitrary EXE installers (NSIS
-- uses /S, InstallShield /s /v"/qn", Inno Setup /VERYSILENT, etc.), so the
-- previously-hardcoded "/quiet /norestart" only ever worked for MSI-style
-- installers - this lets a technician supply the right one per app.
ALTER TABLE apps ADD COLUMN install_args TEXT;
