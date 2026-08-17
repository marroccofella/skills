#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

function runCommand(command, args, options = {}) {
  const invocation = process.platform === "win32"
    ? { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command, ...args] }
    : { command, args };
  return spawnSync(invocation.command, invocation.args, {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    ...options,
  });
}

function parseArgs(argv) {
  const options = { targets: ["auto"], customDirs: [], dryRun: false, pretty: false };
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
    return path.resolve(fs.realpathSync(linkPath)).toLowerCase() === path.resolve(fs.realpathSync(sourcePath)).toLowerCase();
  } catch {
    return false;
  }
}

function linkSkill(parentDir, options) {
  const destination = path.join(parentDir, skillName);
  if (path.resolve(destination).toLowerCase() === path.resolve(skillRoot).toLowerCase()) return { destination, status: "canonical" };
  if (fs.existsSync(destination)) {
    return sameTarget(destination, skillRoot)
      ? { destination, status: "already_linked" }
      : { destination, status: "conflict", detail: "existing path was not changed" };
  }
  if (options.dryRun) return { destination, status: "would_link" };
  fs.mkdirSync(parentDir, { recursive: true });
  fs.symlinkSync(skillRoot, destination, process.platform === "win32" ? "junction" : "dir");
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
  process.stdout.write(`${JSON.stringify(output, null, options.pretty ? 2 : 0)}\n`);
  if (results.some((result) => result.status === "error" || result.status === "conflict")) process.exitCode = 1;
}

try { main(); }
catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
  process.exitCode = 1;
}
