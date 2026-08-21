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
  const answerArg = profile.answerFileArg(answerFileUrl);

  return `#!ipxe
echo Deploying profile: ${profile.label}
kernel ${kernelUrl} ${answerArg} ${profile.extraArgs ?? ""}
initrd ${initrdUrl}
boot
`;
}

export function idleBootScript(reason: string): string {
  return `#!ipxe
echo ${reason}
echo No pending deployment job for this machine - booting local disk.
sanboot --no-describe --drive 0x80 || exit
`;
}
