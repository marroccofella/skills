#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { recordInstall } from "./update.mjs";
import { readiness } from "./bootstrap.mjs";
import { installationCompletion } from "./installations.mjs";
// Windows launch guard (see launch-guard.mjs): a bare command launched without a shell is looked up in
// THIS process's current directory before PATH unless this process carries the variable. Kept inline so
// a script copied on its own still runs.
if (process.platform === "win32" && !process.env.NoDefaultCurrentDirectoryInExePath) process.env.NoDefaultCurrentDirectoryInExePath = "1";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, "..");
const skillName = path.basename(skillRoot);

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
  return spawnSync(invocation.command, invocation.args, {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    ...(win32 ? { env: { ...process.env, NoDefaultCurrentDirectoryInExePath: "1" } } : {}),
    ...options,
  });
}

function parseArgs(argv) {
  const options = { targets: [], customDirs: [], dryRun: false, pretty: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };
    if (arg === "--target") options.targets = next().split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
    else if (arg === "--custom-dir") options.customDirs.push(path.resolve(next()));
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function commandExists(command) {
  const probe = runCommand(command, ["--version"], { timeout: 5_000 });
  return !probe.error && probe.status === 0;
}

function sameTarget(linkPath, sourcePath) {
  try {
    const realpath = process.platform === 'win32' ? fs.realpathSync.native : fs.realpathSync;
    return canon(realpath(linkPath)) === canon(realpath(sourcePath));
  } catch {
    return false;
  }
}
const canon = p => process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p);

function linkSkill(parentDir, options) {
  const destination = path.join(parentDir, skillName);
  if (canon(destination) === canon(skillRoot)) return { destination, status: "canonical" };
  let present = false; try { present = !!fs.lstatSync(destination); } catch {}
  if (present) {
    return sameTarget(destination, skillRoot)
      ? { destination, status: "already_linked" }
      : { destination, status: "conflict", detail: "existing path was not changed" };
  }
  if (options.dryRun) return { destination, status: "would_link" };
  try {
    fs.mkdirSync(parentDir, { recursive: true });
    fs.symlinkSync(skillRoot, destination, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    // A later target must not discard earlier results or their receipt scopes.
    // Do not roll back paths that may already belong to the user.
    return { destination, status: "error", detail: `Could not create the requested link (${error.code || "filesystem error"}). Inspect this destination and retry the explicit installation; successful links are preserved.` };
  }
  return { destination, status: "linked" };
}

function linkGemini(options) {
  if (!commandExists("gemini")) return { status: "skipped", detail: "gemini command not installed" };
  if (options.dryRun) return { status: "would_run_native_link", source: skillRoot };
  const result = runCommand("gemini", ["skills", "link", skillRoot, "--scope", "user", "--consent"], { timeout: 30_000 });
  return result.status === 0
    ? { status: "linked", detail: (result.stdout || "").trim() }
    : { status: "error", detail: (result.stderr || result.stdout || result.error?.message || "native link failed").trim().slice(0, 1000) };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: node scripts/install.mjs [--target auto|all|codex|gemini|claude|antigravity] [--custom-dir <skill-parent>] [--dry-run] [--pretty]\n");
    return;
  }
  let targets = options.targets;
  if (!targets.length && !options.customDirs.length) throw new Error("--target is required. Choose codex, claude, gemini or antigravity; use --dry-run to preview. No harness is selected automatically.");
  if (targets.includes("auto")) {
    targets = ["codex"];
    if (commandExists("gemini")) targets.push("gemini");
    if (commandExists("claude")) targets.push("claude");
    if (commandExists(antigravityCommand())) targets.push("antigravity");
  }
  if (targets.includes("all")) targets = ["codex", "gemini", "claude", "antigravity"];
  targets = [...new Set(targets)];

  const results = [];
  for (const target of targets) {
    if (target === "codex") results.push({ target, ...linkSkill(path.join(os.homedir(), ".agents", "skills"), options) });
    else if (target === "gemini") results.push({ target, ...linkGemini(options) });
    else if (target === "claude") {
      results.push(commandExists("claude")
        ? { target, ...linkSkill(path.join(os.homedir(), ".claude", "skills"), options) }
        : { target, status: "skipped", detail: "claude command not installed; discovery path not modified" });
    } else if (target === "antigravity") {
      if (!commandExists(antigravityCommand())) {
        results.push({ target, status: "skipped", detail: "agy command not installed; discovery paths not modified" });
      } else {
        // Current Antigravity docs use ~/.gemini/config/skills. The official
        // Gemini-to-Antigravity migration guide also documents the legacy
        // CLI-specific global path, so link both during the transition.
        results.push({ target, scope: "global", ...linkSkill(path.join(os.homedir(), ".gemini", "config", "skills"), options) });
        results.push({ target, scope: "migration_compatible", ...linkSkill(path.join(os.homedir(), ".gemini", "antigravity-cli", "skills"), options) });
      }
    } else results.push({ target, status: "unsupported", detail: "use --custom-dir with the harness's documented skill parent" });
  }
  for (const customDir of options.customDirs) results.push({ target: "custom", ...linkSkill(customDir, options) });
  const output = { source: skillRoot, results, note: "Existing paths are never overwritten. No credentials are copied." };
  // Informational only: a probe that throws (process.cwd() fails with ENOENT when the working
  // directory was deleted under the process) must not discard the link rows gathered above.
  try { output.update_readiness = readiness(); }
  catch (error) { output.update_readiness = { status: "unavailable", error: String(error?.message || error).slice(0, 300), installed: false }; }
  try { output.installation = recordInstall(path.resolve(skillRoot, ".."), "momm/scripts/install.mjs", results, { dryRun: options.dryRun }); }
  catch (error) {
    output.installation = { updater_available: false, error: error.message,
      reason: "Link results below remain valid, but the installation receipt/recovery setup did not finish. Resolve the reported filesystem error and rerun this same explicit install; do not assume updates or rollback are ready." };
    process.stderr.write("Installation receipt failed; inspect stdout for links already created. Nothing was rolled back.\n");
    process.exitCode = 1;
  }
  try {
    output.inventory = installationCompletion({ runningSkillRoot: skillRoot, customDirs: options.customDirs });
    if (typeof output.inventory?.upgrade?.complete !== 'boolean') throw new Error('invalid inventory shape');
  } catch {
    output.inventory = {upgrade:{complete:false,reason:'Installation inventory could not be verified; inspect the discovery paths before claiming completion.'},error:'inventory_unavailable'};
  }
  if (!output.inventory.upgrade.complete) {
    // A dry run changes nothing, so it keeps exit 0 and callers that preview an install are not
    // broken by a predicted state. The message says so, rather than leaving the text and the exit
    // code contradicting each other. An inventory module that omits its reason is named as such.
    const reason = output.inventory.upgrade.reason ?? 'the inventory gave no reason';
    const preview = options.dryRun ? ' This is a dry run: nothing was changed and the exit code stays 0.' : '';
    process.stderr.write(`Installation is not complete across active harnesses: ${reason}. Requested link and receipt results are retained below; conflicting copies were left untouched.${preview}\n`);
    if (!options.dryRun) process.exitCode = 1;
  }
  process.stdout.write(`${JSON.stringify(output, null, options.pretty ? 2 : 0)}\n`);
  if (results.some((result) => ["error", "conflict", "unsupported"].includes(result.status))) process.exitCode = 1;
}

try { main(); }
catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
  process.exitCode = 1;
}
