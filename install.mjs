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

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
// Deprecated aliases are not freshly installed by the bulk installer.
const SKIP = new Set(["multi-llm-review"]);

// A skill is any top-level directory containing a SKILL.md. Names are
// restricted to a safe charset: a directory named with shell metacharacters
// must never reach the cmd.exe-wrapped gemini link on Windows.
function discoverSkills() {
  return fs.readdirSync(repoRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^[A-Za-z0-9._-]+$/.test(e.name) && !SKIP.has(e.name))
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
function runCommand(command, args, options = {}) {
  const invocation = process.platform === "win32"
    ? { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command, ...args] }
    : { command, args };
  return spawnSync(invocation.command, invocation.args, { shell: false, windowsHide: true, encoding: "utf8", ...options });
}
function commandExists(command) {
  const probe = runCommand(command, ["--version"], { timeout: 5_000 });
  return !probe.error && probe.status === 0;
}
function sameTarget(linkPath, sourcePath) {
  try { return canon(fs.realpathSync(linkPath)) === canon(fs.realpathSync(sourcePath)); }
  catch { return false; }
}

function parseArgs(argv) {
  const o = { targets: ["auto"], customDirs: [], dryRun: false, pretty: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`Missing value for ${a}`); return argv[++i]; };
    if (a === "--target") o.targets = next().split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (a === "--custom-dir") o.customDirs.push(path.resolve(next()));
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--pretty") o.pretty = true;
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
  fs.mkdirSync(parentDir, { recursive: true });
  fs.symlinkSync(source, destination, process.platform === "win32" ? "junction" : "dir");
  return { skill, destination, status: "linked" };
}
function linkAll(parentDir, skills, options) {
  return skills.map((skill) => linkOne(parentDir, skill, options));
}
function linkGemini(skills, options) {
  if (!commandExists("gemini")) return [{ status: "skipped", detail: "gemini command not installed" }];
  return skills.map((skill) => {
    const source = path.join(repoRoot, skill);
    if (options.dryRun) return { skill, status: "would_run_native_link", source };
    const r = runCommand("gemini", ["skills", "link", source, "--scope", "user", "--consent"], { timeout: 30_000 });
    return r.status === 0 ? { skill, status: "linked" } : { skill, status: "error", detail: (r.stderr || r.stdout || "native link failed").trim().slice(0, 400) };
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: node install.mjs [--target auto|all|codex|gemini|claude|antigravity] [--custom-dir <skill-parent>] [--dry-run] [--pretty]\n\nLinks every skill (dir with a SKILL.md) in this repo into the chosen harness skill directories.\n");
    return;
  }
  const skills = discoverSkills();
  if (!skills.length) { process.stderr.write("No skills found (no top-level directory contains a SKILL.md).\n"); process.exitCode = 1; return; }

  let targets = options.targets;
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
    if (target === "codex") results.push({ target, links: linkAll(path.join(os.homedir(), ".agents", "skills"), skills, options) });
    else if (target === "gemini") results.push({ target, links: linkGemini(skills, options) });
    else if (target === "claude") {
      results.push(commandExists("claude")
        ? { target, links: linkAll(path.join(os.homedir(), ".claude", "skills"), skills, options) }
        : { target, status: "skipped", detail: "claude command not installed; discovery path not modified" });
    } else if (target === "antigravity") {
      if (!commandExists(antigravityCommand())) results.push({ target, status: "skipped", detail: "agy command not installed" });
      else {
        results.push({ target, scope: "global", links: linkAll(path.join(os.homedir(), ".gemini", "config", "skills"), skills, options) });
        results.push({ target, scope: "migration_compatible", links: linkAll(path.join(os.homedir(), ".gemini", "antigravity-cli", "skills"), skills, options) });
      }
    } else results.push({ target, status: "unsupported", detail: "use --custom-dir with the harness's documented skill parent" });
  }
  for (const dir of options.customDirs) results.push({ target: "custom", links: linkAll(dir, skills, options) });

  const output = { source: repoRoot, skills, results, note: "Existing paths are never overwritten. No credentials are copied." };
  process.stdout.write(`${JSON.stringify(output, null, options.pretty ? 2 : 0)}\n`);
  const flat = results.flatMap((r) => r.links || []);
  // Non-zero exit on any failure OR an unsupported target, so a typo'd
  // --target does not look like success to automation.
  if (flat.some((l) => l.status === "error" || l.status === "conflict") || results.some((r) => r.status === "unsupported")) process.exitCode = 1;
}

try { main(); }
catch (e) { process.stderr.write(`${JSON.stringify({ error: e.message })}\n`); process.exitCode = 1; }
