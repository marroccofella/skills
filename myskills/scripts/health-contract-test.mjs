#!/usr/bin/env node
// Offline/local contract for the canonical myskills health report. It proves
// that aliases are grouped, skipped work stays not_checked, dependency state
// cannot be summarized as ready, and published versions align with code.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, "..", "..");
const runner = path.join(scriptDir, "run-all.mjs");
const versions = JSON.parse(fs.readFileSync(path.join(skillRoot, "versions.json"), "utf8"));
const canonical = ["momm", "myrepo", "yorkshire-pudding", "myautoness", "promptus-clone-voice"];
const expectedAliases = {
  momm: [],
  myrepo: [],
  "yorkshire-pudding": ["yorky"],
  myautoness: ["autopilot"],
  "promptus-clone-voice": ["myvoice"],
};

function health(extra = []) {
  const result = spawnSync(process.execPath, [runner, ...extra], { encoding: "utf8", timeout: 120_000 });
  if (result.error || result.status !== 0) throw new Error(`health runner failed: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
  try { return JSON.parse(result.stdout); }
  catch { throw new Error("health runner returned unreadable JSON"); }
}

function versionOf(script, expectedName) {
  const result = spawnSync(process.execPath, [path.join(skillRoot, ...script), "--version"], { encoding: "utf8", timeout: 30_000 });
  if (result.error || result.status !== 0) return null;
  return (result.stdout.match(new RegExp(`${expectedName} ([\\d.]+)`)) || [])[1] || null;
}

function aliasesMatch(report) {
  return canonical.every((name) => {
    const row = report.skills.find((item) => item.skill === name);
    return row && JSON.stringify(row.aliases || []) === JSON.stringify(expectedAliases[name]);
  });
}

function dependencyAggregate(report) {
  return report.skills.some((skill) => skill.status === "unavailable"
    || Object.values(skill.dependencies || {}).some((state) => ["missing", "login_required"].includes(state))) ? "attention" : "ready";
}

const full = health();
const quick = health(["--quick"]);
const myrepo = full.skills.find((item) => item.skill === "myrepo");
const quickMyrepo = quick.skills.find((item) => item.skill === "myrepo");
const quickPromptus = quick.skills.find((item) => item.skill === "promptus-clone-voice");
const ghConsistent = myrepo?.dependencies?.gh_cli === "missing"
  ? myrepo.dependencies.gh_auth === "not_checked"
  : myrepo?.dependencies?.gh_cli === "ready" && ["ready", "login_required"].includes(myrepo.dependencies.gh_auth);
const broken = full.skills.some((item) => ["missing", "failing", "error"].includes(item.status));

const tests = {
  "full report contains exactly five canonical families": full.skills.length === canonical.length
    && JSON.stringify(full.skills.map((item) => item.skill)) === JSON.stringify(canonical),
  "aliases are grouped on canonical rows": aliasesMatch(full) && aliasesMatch(quick),
  "GitHub CLI and auth states are internally consistent": ghConsistent,
  "full dependency aggregate matches row evidence": full.dependency_readiness === dependencyAggregate(full),
  "full code aggregate matches functional failures": full.code_health === (broken ? "failing" : "passing"),
  "quick mode is explicitly partial": quick.code_health === "partial"
    && quick.dependency_readiness === "not_checked"
    && quick.not_checked > 0
    && quick.checked < quick.total
    && /not checked/i.test(quick.verdict),
  "quick mode never invents GitHub readiness": quickMyrepo?.dependencies?.gh_cli === "not_checked"
    && quickMyrepo?.dependencies?.gh_auth === "not_checked",
  "quick mode never invents Promptus readiness": quickPromptus?.status === "not_checked",
  "code versions align with the published manifest": full.myskills_version === versions.myskills
    && versionOf(["momm", "scripts", "multi-review.mjs"], "momm") === versions.momm
    && versionOf(["myrepo", "scripts", "publish.mjs"], "myrepo") === versions.myrepo,
  "canonical and callable-alias versions align": versions["yorkshire-pudding"] === versions.yorky
    && versions["promptus-clone-voice"] === versions.myvoice,
};

const passed = Object.values(tests).every(Boolean);
process.stdout.write(`${JSON.stringify({ passed, mode: "canonical-health-contract", tests }, null, 2)}\n`);
if (!passed) process.exitCode = 1;
