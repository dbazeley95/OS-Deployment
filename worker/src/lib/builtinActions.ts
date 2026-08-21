/**
 * Fixed, code-defined task-sequence actions that need no R2-hosted
 * installer - unlike the `apps` catalog (worker/src/lib/apps.ts), these
 * aren't technician-authored, so there's no CRUD or D1 table for them.
 * boot/winpe/PostAction.ps1 has a matching switch on `id` for each one.
 */
export interface BuiltinAction {
  id: string;
  label: string;
}

export const BUILTIN_ACTIONS: BuiltinAction[] = [
  { id: "windows-update", label: "Install Windows Updates" },
  { id: "disable-winre", label: "Disable Windows Recovery Environment (WinRE)" },
];

export function getBuiltinAction(id: string): BuiltinAction | null {
  return BUILTIN_ACTIONS.find((a) => a.id === id) ?? null;
}
