// Windows launch guard: the reference implementation and its explanation. Every MOMM script that
// starts a process carries the same one-line guard INLINE rather than importing this file, because
// several scripts are run as single copied files (installer archives, isolated test copies) where a
// sibling import would fail. scripts/launch-guard.test.mjs fails if such a script lacks the guard.
//
// For a direct (no-shell) launch of a bare command name such as git, taskkill or cmd, Windows
// looks in the CALLING process's current directory before PATH, unless the calling process has
// NoDefaultCurrentDirectoryInExePath set. MOMM runs inside the project under review, so a planted
// git.exe there was started by the dispatcher while it collected the diff (reproduced on Node
// 22.16, release gate rev_20260919023950_h6hn). Putting the variable only in a CHILD's environment
// does not help: the lookup happens in the parent. Absolute System32 paths are used where a tool
// has one; this guard covers tools that do not (git, gitsign, reviewer CLIs).
export const LAUNCH_GUARD_VARIABLE = "NoDefaultCurrentDirectoryInExePath";
export function applyLaunchGuard(env = process.env, platform = process.platform) {
  if (platform === "win32" && !env[LAUNCH_GUARD_VARIABLE]) env[LAUNCH_GUARD_VARIABLE] = "1";
  return env[LAUNCH_GUARD_VARIABLE] ?? null;
}
applyLaunchGuard();
