import type { OsProfile } from "./profiles";

/**
 * Builds the per-machine iPXE script. `origin` is this Worker's own URL,
 * since kernel/initrd/answer-file are all streamed back through /images/*
 * rather than exposing the R2 bucket directly.
 */
export function buildBootScript(profile: OsProfile, origin: string): string {
  const kernelUrl = `${origin}/images/${profile.kernel}`;
  const initrdUrl = `${origin}/images/${profile.initrd}`;
  const answerFileUrl = `${origin}/images/${profile.answerFile}`;

  return `#!ipxe
echo Deploying profile: ${profile.label}
kernel ${kernelUrl} answerfile=${answerFileUrl}
initrd ${initrdUrl}
boot
`;
}

/**
 * Interactive boot menu for a MAC with no existing job: the technician
 * (already Basic-Auth'd to get here) picks a profile, which chains to
 * /boot/:mac/install?profile=<id> - the same Worker host, so iPXE's
 * cached HTTP credentials carry over without a second prompt.
 */
export function buildMenuScript(profiles: OsProfile[], mac: string, origin: string): string {
  const items = profiles.map((p) => `item ${p.id} ${p.label}`).join("\n");
  const defaultId = profiles[0]?.id ?? "";
  return `#!ipxe
menu Select an OS to install on ${mac}
${items}
choose --timeout 60000 --default ${defaultId} target || goto cancel
chain ${origin}/boot/${mac}/install?profile=\${target}
:cancel
echo Cancelled - booting local disk.
sanboot --no-describe --drive 0x80 || exit
`;
}

export function idleBootScript(reason: string): string {
  return `#!ipxe
echo ${reason}
echo No pending deployment job for this machine - booting local disk.
sanboot --no-describe --drive 0x80 || exit
`;
}
