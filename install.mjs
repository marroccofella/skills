#!/usr/bin/env node
// Root installer — links EVERY skill in this repo into your harness's skill
// directory in one command. Zero dependencies (Node 18+, plus the gemini/agy
// CLIs only if you target them). Junctions on Windows, symlinks on POSIX;
// existing paths are never overwritten, no credentials are copied.
//
//   node install.mjs --target all       # codex, gemini, claude, antigravity
//   node install.mjs --dry-run          # preview every link, touch nothing
//   node install.mjs --target codex,claude
//
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { recordInstall, harnessLauncher } from "./momm/scripts/update.mjs";
import { readiness } from "./momm/scripts/bootstrap.mjs";
import { installationCompletion } from "./momm/scripts/installations.mjs";
// Windows launch guard (see momm/scripts/launch-guard.mjs): a bare command launched without a shell is
// looked up in THIS process's current directory before PATH unless this process carries the variable.
if (process.platform === "win32" && !process.env.NoDefaultCurrentDirectoryInExePath) process.env.NoDefaultCurrentDirectoryInExePath = "1";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
// A skill is any top-level directory containing a SKILL.md. Names are
// restricted to a safe charset: a directory named with shell metacharacters
// must never reach the cmd.exe-wrapped gemini link on Windows.
function discoverSkills() {
  return fs.readdirSync(repoRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^[A-Za-z0-9._-]+$/.test(e.name))
    .filter((e) => fs.existsSync(path.join(repoRoot, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();
}
// Case-insensitive only where the filesystem is (Windows); POSIX paths that
// differ only in case are genuinely different.
const canon = (p) => process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p);

function antigravityCommand() {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const installed = path.join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe");
    if (fs.existsSync(installed)) return installed;
  }
  return "agy";
}
// Harness launchers (gemini, claude, agy) are npm .cmd shims on Windows, so they need
// cmd.exe. It is named by its absolute System32 path (a bare "cmd.exe" would be looked up
// in the working directory first), and NoDefaultCurrentDirectoryInExePath stops cmd.exe
// itself from preferring a gemini.cmd planted in the directory the installer is run from.
const WINDOWS_CMD = [process.env.SystemRoot || process.env.windir || "C:\\Windows", "System32", "cmd.exe"].join("\\");
function runCommand(command, args, options = {}) {
  const win32 = process.platform === "win32";
  const invocation = win32
    ? { command: WINDOWS_CMD, args: ["/d", "/s", "/c", command, ...args] }
    : { command, args };
  return spawnSync(invocation.command, invocation.args, { shell: false, windowsHide: true, encoding: "utf8", ...(win32 ? { env: { ...process.env, NoDefaultCurrentDirectoryInExePath: "1" } } : {}), ...options });
}
// Harness command detection (1.17.3; field report, 6 October 2026). Whether a harness is there used to be
// decided by running `<command> --version` with a five-second limit, and any failure, a timeout included,
// was read as an absent command: a Gemini CLI that took between 5.5 and 7.7 seconds to start lost its
// link, and the updater then refused the whole update. Presence is now a PATH lookup (harnessLauncher in update.mjs: an absolute
// PATH entry outside this clone, real path checked), which does not depend on how fast the command starts.
// `--version` is still asked, once per run, because a command that is found and reports a failure is not
// linked, as before. A command that is found and does not answer within the limit is installed: its row and
// stderr say that it did not answer, and it is linked as an answering one is (claude and antigravity by a
// folder link; gemini by its own `gemini skills link`, which has to answer as well: a skill whose link
// command does not answer gets an error row and is not linked). A command that is not found is skipped and
// nothing is created for it, as before. The limit is the one `gemini skills link` already had; a harness
// that answers nothing is given up after two of them (its version, then one link command), inside the 180
// seconds the updater allows a replayed scope and onboarding allows its link. MOMM_HARNESS_TIMEOUT_MS
// (milliseconds) changes it for a test.
const HARNESS_TIMEOUT_MS = 30_000;
const harnessLimit = () => (/^\d{3,5}$/.test(process.env.MOMM_HARNESS_TIMEOUT_MS ?? "") ? Math.min(60_000, Number(process.env.MOMM_HARNESS_TIMEOUT_MS)) : HARNESS_TIMEOUT_MS);
// SIGKILL: a command that ignores the default signal would hold spawnSync beyond its limit.
const withinLimit = () => ({ timeout: harnessLimit(), killSignal: "SIGKILL" });
const timedOut = (result) => result.error?.code === "ETIMEDOUT";
const harnessCommands = new Map();
function harnessCommand(command) {
  if (harnessCommands.has(command)) return harnessCommands.get(command);
  const name = path.basename(command).replace(/\.exe$/i, ""), found = harnessLauncher(command);
  let result = { name, state: "absent", detail: `${name} command not found on PATH` };
  if (found) {
    const probe = runCommand(command, ["--version"], withinLimit());
    if (timedOut(probe)) result = { name, state: "unresponsive", path: found, detail: `${name} command found at ${found} but \`${name} --version\` did not answer within ${harnessLimit() / 1000} s` };
    else if (probe.error || probe.status !== 0) result = { name, state: "failed", path: found, detail: `${name} command found at ${found} but \`${name} --version\` failed (${probe.error ? probe.error.code || "it could not be started" : probe.signal ? `killed by ${probe.signal}` : `exit ${probe.status}`})` };
    else result = { name, state: "present", path: found };
    if (result.state === "unresponsive") process.stderr.write(`${result.detail}. It is on PATH, so it is treated as installed.\n`);
  }
  harnessCommands.set(command, result);
  return result;
}
const harnessInstalled = (command) => ["present", "unresponsive"].includes(harnessCommand(command).state);
const notLinked = (command) => ({ status: "skipped", detail: `${harnessCommand(command).detail}; discovery path not modified` });
function sameTarget(linkPath, sourcePath) {
  try {
    const realpath = process.platform === 'win32' ? fs.realpathSync.native : fs.realpathSync;
    return canon(realpath(linkPath)) === canon(realpath(sourcePath));
  }
  catch { return false; }
}

function parseArgs(argv) {
  const o = { targets: [], customDirs: [], dryRun: false, pretty: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`Missing value for ${a}`); return argv[++i]; };
    if (a === "--target") o.targets = next().split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (a === "--custom-dir") o.customDirs.push(path.resolve(next()));
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--pretty") o.pretty = true;
    else if (a === "--skills") o.skills = [...new Set(next().split(",").map(s => s.trim()).filter(Boolean))];
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

function linkOne(parentDir, skill, options) {
  const source = path.join(repoRoot, skill);
  const destination = path.join(parentDir, skill);
  if (canon(destination) === canon(source)) return { skill, destination, status: "canonical" };
  // lstat (not existsSync) so a DANGLING link at the destination is detected
  // as present — otherwise symlinkSync would throw EEXIST mid-install.
  let present = false; try { present = !!fs.lstatSync(destination); } catch {}
  if (present) {
    return sameTarget(destination, source) ? { skill, destination, status: "already_linked" } : { skill, destination, status: "conflict", detail: "existing path was not changed" };
  }
  if (options.dryRun) return { skill, destination, status: "would_link" };
  try {
    fs.mkdirSync(parentDir, { recursive: true });
    fs.symlinkSync(source, destination, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    // Preserve other successful skill/target rows for output and receipt replay.
    // Existing paths are not ours to roll back on another target's failure.
    return { skill, destination, status: "error", detail: `Could not create the requested link (${error.code || "filesystem error"}). Inspect this destination and retry the explicit installation; successful links are preserved.` };
  }
  return { skill, destination, status: "linked" };
}
function linkAll(parentDir, skills, options) {
  return skills.map((skill) => linkOne(parentDir, skill, options));
}
function linkGemini(skills, options) {
  if (!harnessInstalled("gemini")) return [notLinked("gemini")];
  // Once gemini has not answered a link command it is not started again in this run: every further skill
  // would wait out the same limit, and the updater would stop the installer before it could report.
  let silent = null;
  return skills.map((skill) => {
    const source = path.join(repoRoot, skill);
    if (options.dryRun) return { skill, status: "would_run_native_link", source };
    if (silent) return { skill, status: "error", detail: `not attempted: ${silent}` };
    const r = runCommand("gemini", ["skills", "link", source, "--scope", "user", "--consent"], withinLimit());
    if (timedOut(r)) return { skill, status: "error", detail: silent = `gemini command found at ${harnessCommand("gemini").path} but \`gemini skills link\` did not answer within ${harnessLimit() / 1000} s` };
    return r.status === 0 ? { skill, status: "linked" } : { skill, status: "error", detail: (r.stderr || r.stdout || "native link failed").trim().slice(0, 400) };
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: node install.mjs --target <codex|gemini|claude|antigravity|all|auto>[,…] [--custom-dir <skill-parent>] [--dry-run] [--pretty]\n\nLinks every skill (dir with a SKILL.md) in this repo into the harness skill directories you name.\n--target is required: this writes into an agent harness, so choose it explicitly. `--dry-run` previews.\n");
    return;
  }
  const available = discoverSkills();
  const skills = options.skills || available;
  if (skills.some(s => !available.includes(s))) throw new Error("Requested installed skill is absent from this release; refusing to change installation scope.");
  if (!skills.length) { process.stderr.write("No skills found (no top-level directory contains a SKILL.md).\n"); process.exitCode = 1; return; }

  let targets = options.targets;
  if (!targets.length && !options.customDirs.length) {
    // Never write into every detected harness by default: name the target.
    const detected = ["codex", harnessInstalled("gemini") && "gemini", harnessInstalled("claude") && "claude", harnessInstalled(antigravityCommand()) && "antigravity"].filter(Boolean);
    process.stderr.write(`--target is required (this links skills into an agent harness).\nDetected on this machine: ${detected.join(", ")}\n  node install.mjs --target ${detected[0] ?? "claude"}          # one harness\n  node install.mjs --target ${detected.join(",")}   # the ones you choose\n  node install.mjs --target all --dry-run          # preview every harness\n`);
    process.exitCode = 2;
    return;
  }
  if (targets.includes("auto")) {
    targets = ["codex"];
    if (harnessInstalled("gemini")) targets.push("gemini");
    if (harnessInstalled("claude")) targets.push("claude");
    if (harnessInstalled(antigravityCommand())) targets.push("antigravity");
  }
  if (targets.includes("all")) targets = ["codex", "gemini", "claude", "antigravity"];
  targets = [...new Set(targets)];

  const results = [];
  for (const target of targets) {
    if (target === "codex") results.push({ target, links: linkAll(path.join(os.homedir(), ".agents", "skills"), skills, options) });
    else if (target === "gemini") results.push({ target, command: harnessCommand("gemini"), links: linkGemini(skills, options) });
    else if (target === "claude") {
      results.push(harnessInstalled("claude")
        ? { target, command: harnessCommand("claude"), links: linkAll(path.join(os.homedir(), ".claude", "skills"), skills, options) }
        : { target, command: harnessCommand("claude"), ...notLinked("claude") });
    } else if (target === "antigravity") {
      const agy = antigravityCommand();
      if (!harnessInstalled(agy)) results.push({ target, command: harnessCommand(agy), ...notLinked(agy) });
      else {
        results.push({ target, command: harnessCommand(agy), scope: "global", links: linkAll(path.join(os.homedir(), ".gemini", "config", "skills"), skills, options) });
        results.push({ target, command: harnessCommand(agy), scope: "migration_compatible", links: linkAll(path.join(os.homedir(), ".gemini", "antigravity-cli", "skills"), skills, options) });
      }
    } else results.push({ target, status: "unsupported", detail: "use --custom-dir with the harness's documented skill parent" });
  }
  for (const dir of options.customDirs) results.push({ target: "custom", links: linkAll(dir, skills, options) });

  const output = { source: repoRoot, skills, results, note: "Existing paths are never overwritten. No credentials are copied." };
  // Informational only: a probe that throws (process.cwd() fails with ENOENT when the working
  // directory was deleted under the process) must not discard the link rows gathered above.
  if (skills.includes("momm")) { try { output.update_readiness = readiness(); } catch (error) { output.update_readiness = { status: "unavailable", error: String(error?.message || error).slice(0, 300), installed: false }; } }
  try { output.installation = recordInstall(repoRoot, "install.mjs", results, { dryRun: options.dryRun, skills }); }
  catch (error) {
    output.installation = { updater_available: false, error: error.message,
      reason: "Link results below remain valid, but the installation receipt/recovery setup did not finish. Resolve the reported filesystem error and rerun this same explicit install; do not assume updates or rollback are ready." };
    process.stderr.write("Installation receipt failed; inspect stdout for links already created. Nothing was rolled back.\n");
    process.exitCode = 1;
  }
  if (skills.includes('momm')) {
    try {
      output.inventory = installationCompletion({ runningSkillRoot: path.join(repoRoot, 'momm'), customDirs: options.customDirs });
      if (typeof output.inventory?.upgrade?.complete !== 'boolean') throw new Error('invalid inventory shape');
    } catch {
      output.inventory = {upgrade:{complete:false,reason:'Installation inventory could not be verified; inspect the discovery paths before claiming completion.'},error:'inventory_unavailable'};
    }
    if (!output.inventory.upgrade.complete) {
      process.stderr.write(`Installation is not complete across active harnesses: ${output.inventory.upgrade.reason ?? "the inventory gave no reason"}. Requested link and receipt results are retained below; conflicting copies were left untouched.${options.dryRun ? " This is a dry run: nothing was changed, and an incomplete inventory alone does not fail it." : ""}\n`);
      if (!options.dryRun) process.exitCode = 1;
    }
  }
  // Say why the exit code is non-zero. A refused link used to exit 1 in silence, while the only prose
  // in the output was the inventory's "every active path loads <version>", which reads as success
  // (independent review of 3d7a8be). The inventory describes copies that are ALREADY installed; this
  // line describes what this command did or, in a dry run, would do.
  const flatLinks = results.flatMap((r) => (r.links || []).map((l) => ({ target: r.target, ...l })));
  const refused = [...flatLinks.filter((l) => l.status === "error" || l.status === "conflict"), ...results.filter((r) => r.status === "unsupported")];
  if (refused.length) {
    const dry = options.dryRun, n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
    const name = (r) => `${r.skill ? `${r.skill} for ` : ""}${r.target ?? "link"}${r.destination ? ` at ${r.destination}` : ""}`;
    const conflicts = refused.filter((r) => r.status === "conflict"), errors = refused.filter((r) => r.status === "error"), unsupported = refused.filter((r) => r.status === "unsupported");
    const parts = [], summaries = [];
    if (conflicts.length) { const head = `${n(conflicts.length, "link", "links")} ${dry ? "would be" : conflicts.length === 1 ? "was" : "were"} refused because the path already exists`; summaries.push(head); parts.push(`${head} (${conflicts.map(name).join("; ")}); existing paths are never overwritten, so move or remove that entry yourself, then rerun`); }
    if (errors.length) { const head = `${n(errors.length, "link", "links")} failed`; summaries.push(head); parts.push(`${head} (${errors.map((r) => `${name(r)}: ${r.detail ?? "error"}`).join("; ")})`); }
    if (unsupported.length) { const head = `${n(unsupported.length, "target is", "targets are")} not supported`; summaries.push(head); parts.push(`${head} (${unsupported.map((r) => r.target).join(", ")}); choose codex, claude, gemini or antigravity, or pass --custom-dir with the harness's skill folder`); }
    output.exit_reason = summaries.join("; ");
    process.stderr.write(`${dry ? "Dry run: " : ""}exit code 1: ${parts.join("; ")}. The installation inventory in the output describes copies that are already installed, not the result of this command.\n`);
  }
  process.stdout.write(`${JSON.stringify(output, null, options.pretty ? 2 : 0)}\n`);
  const flat = flatLinks;
  // Non-zero exit on any failure OR an unsupported target, so a typo'd
  // --target does not look like success to automation.
  if (flat.some((l) => l.status === "error" || l.status === "conflict") || results.some((r) => r.status === "unsupported")) process.exitCode = 1;
}

try { main(); }
catch (e) { process.stderr.write(`${JSON.stringify({ error: e.message })}\n`); process.exitCode = 1; }
