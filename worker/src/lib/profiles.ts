/**
 * Static catalog of OS profiles this deployment system knows how to install.
 * Paths are keys inside the R2 "IMAGES" bucket; upload them with scripts/upload-image.sh.
 * Kept in code (not D1) since profiles change rarely and ship with the repo.
 */
export interface OsProfile {
  id: string;
  label: string;
  kernel: string;
  initrd: string;
  /** Extra iPXE kernel args appended after the answer-file arg. */
  extraArgs?: string;
  /** R2 key for the unattended-install answer file (unattend.xml). */
  answerFile: string;
  /** How the installer expects the answer file to be passed. */
  answerFileArg: (answerFileUrl: string) => string;
}

// Pro and Education share one boot media (kernel/initrd/WIM) - only the
// answer file differs, selecting a different WIM image index. See
// boot/profiles/windows-11-25h2/README.md.
export const OS_PROFILES: Record<string, OsProfile> = {
  "windows-11-25h2-pro": {
    id: "windows-11-25h2-pro",
    label: "Windows 11 25H2 Pro",
    kernel: "windows-11-25h2/boot/bootx64.efi",
    initrd: "windows-11-25h2/boot/boot.sdi",
    answerFile: "windows-11-25h2-pro/autounattend.xml",
    answerFileArg: (url) => `answerfile=${url}`,
  },
  "windows-11-25h2-edu": {
    id: "windows-11-25h2-edu",
    label: "Windows 11 25H2 Education",
    kernel: "windows-11-25h2/boot/bootx64.efi",
    initrd: "windows-11-25h2/boot/boot.sdi",
    answerFile: "windows-11-25h2-edu/autounattend.xml",
    answerFileArg: (url) => `answerfile=${url}`,
  },
};

export function listProfiles(): OsProfile[] {
  return Object.values(OS_PROFILES);
}

export function getProfile(id: string): OsProfile | undefined {
  return OS_PROFILES[id];
}
