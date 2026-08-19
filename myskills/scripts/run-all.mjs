#!/usr/bin/env node
// myskills — one entry point that runs ALL skills together from any harness.
// Zero dependencies (Node 18+). Finds every installed skill, exercises each
// one for real, and reports a single verdict.
//
//   node run-all.mjs              # doctor: verify every skill end to end
//   node run-all.mjs --pretty     # same, human-readable JSON
//   node run-all.mjs --flow       # print the review -> voice -> publish flow
//   node run-all.mjs --quick      # skip slow live-dependency probes
//
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MYSKILLS_VERSION = "1.0.0";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
// This skill lives beside its siblings, whether that is the canonical repo or
// an installed skills directory — so the parent of myskills/ is the skill root.
const SKILL_ROOT = path.resolve(scriptDir, "..", "..");

function parseArgs(argv) {
  const o = { pretty: false, flow: false, quick: false, help: false };
  for (const a of argv) {
    if (a === "--pretty") o.pretty = true;
    else if (a === "--flow") o.flow = true;
    else if (a === "--quick") o.quick = true;
    else if (a === "--version") { process.stdout.write(`myskills ${MYSKILLS_VERSION}\n`); process.exit(0); }
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return o;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 60_000, ...opts });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim(), failed: !!r.error };
}
const skillPath = (skill, ...rest) => path.join(SKILL_ROOT, skill, ...rest);
const has = (skill, ...rest) => fs.existsSync(skillPath(skill, ...rest));

// Each skill declares how it proves itself. A skill is "working" only when its
// own check passes — never merely because its directory exists.
const CHECKS = [
  {
    name: "momm", role: "multi-model peer review", aliases: [],
    check() {
      if (!has("momm", "scripts", "multi-review.mjs")) return { status: "missing", detail: "momm/scripts/multi-review.mjs not found" };
      const v = run(process.execPath, [skillPath("momm", "scripts", "multi-review.mjs"), "--version"]);
      const st = run(process.execPath, [skillPath("momm", "scripts", "multi-review.mjs"), "--self-test"]);
      let tests = null, passed = false;
      // Exit status AND payload must both agree — never trust output text alone.
      try { const j = JSON.parse(st.out); passed = st.code === 0 && j.passed === true; tests = Object.keys(j.tests || {}).length; } catch {}
      return { status: passed ? "ok" : "failing", version: v.code === 0 ? ((v.out.match(/momm ([\d.]+)/) || [])[1] ?? null) : null, detail: passed ? `${tests} self-tests pass` : `self-test did not pass (exit ${st.code})` };
    },
  },
  {
    name: "myrepo", role: "publish to GitHub with a live page", aliases: [],
    check({ quick }) {
      if (!has("myrepo", "scripts", "publish.mjs")) return { status: "missing", detail: "myrepo/scripts/publish.mjs not found" };
      const v = run(process.execPath, [skillPath("myrepo", "scripts", "publish.mjs"), "--version"]);
      const version = v.code === 0 ? ((v.out.match(/myrepo ([\d.]+)/) || [])[1] ?? null) : null;
      if (quick) return { status: version ? "ok" : "failing", version, detail: "version probe only (--quick)" };
      // Prove the publisher's gates actually run, without creating anything.
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "myskills-"));
      try {
        fs.writeFileSync(path.join(tmp, "index.html"), "<title>probe</title>");
        const dry = run(process.execPath, [skillPath("myrepo", "scripts", "publish.mjs"), "--name", "probe", "--dir", tmp, "--dry-run"]);
        const gated = dry.code === 0 && /scan clean/.test(dry.err) && /dry run/.test(dry.err);
        const gh = run("gh", ["auth", "status"]);
        return { status: gated ? "ok" : "failing", version, detail: gated ? `dry-run gates pass; gh auth ${gh.code === 0 ? "ready" : "NOT logged in"}` : "dry-run gates did not pass" };
      } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
    },
  },
  {
    name: "yorkshire-pudding", role: "Yorkshire dialect translation", aliases: ["yorky"],
    check() {
      if (!has("yorkshire-pudding", "scripts", "yorkshirify.mjs")) return { status: "missing", detail: "yorkshirify.mjs not found" };
      const st = run(process.execPath, [skillPath("yorkshire-pudding", "scripts", "yorkshirify.mjs"), "--self-test"]);
      const live = run(process.execPath, [skillPath("yorkshire-pudding", "scripts", "yorkshirify.mjs"), "--level", "proper"], { input: "Something to eat\n" });
      // Exit codes are the authority; the text pattern is anchored ("all N
      // self-tests passed") so a "0 passed" or "failed" line cannot match.
      const selfTestOk = st.code === 0 && /all \d+ self-tests passed/i.test(st.out);
      const translated = live.code === 0 && /summat/i.test(live.out);
      const passed = selfTestOk && translated;
      return { status: passed ? "ok" : "failing", detail: passed ? `self-tests pass; live: "${live.out.split("\n")[0].slice(0, 40)}"` : `self-test ${selfTestOk ? "ok" : "failed"}, live translation ${translated ? "ok" : "failed"}` };
    },
  },
  {
    name: "promptus-clone-voice", role: "consented local voice cloning", aliases: ["myvoice"],
    check({ quick }) {
      if (!has("promptus-clone-voice", "scripts", "manage_promptus_services.py")) return { status: "missing", detail: "promptus scripts not found" };
      if (quick) return { status: "ok", detail: "present (--quick: live services not probed)" };
      const py = process.platform === "win32" && process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "PromptusAI", "cosy", "venv", "Scripts", "python.exe") : "python";
      if (!fs.existsSync(py) && process.platform === "win32") return { status: "unavailable", detail: "Promptus not installed on this machine (skill present, engine absent)" };
      const s = run(py, [skillPath("promptus-clone-voice", "scripts", "manage_promptus_services.py"), "--status"]);
      // EVERY required service must be ready — not merely one "ready" somewhere
      // in the payload. Name the ones that are not.
      let services = {};
      try { services = JSON.parse(s.out)?.pmanager ?? {}; } catch {}
      const required = ["comfyui", "cosy", "cworker"];
      const notReady = required.filter((k) => services[k] !== "ready");
      const ready = s.code === 0 && notReady.length === 0;
      return { status: ready ? "ok" : "unavailable", detail: ready ? `Promptus services ready (${required.join(", ")})` : `Promptus not ready: ${notReady.length ? notReady.map((k) => `${k}=${services[k] ?? "unknown"}`).join(", ") : `status probe exit ${s.code}`}` };
    },
  },
];

function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); }
  catch (e) { process.stderr.write(`${e.message}\n`); process.exit(1); }

  if (o.help) {
    process.stdout.write(`myskills ${MYSKILLS_VERSION} — run all skills together\n\n  --pretty   human-readable JSON\n  --flow     print the review -> voice -> publish flow\n  --quick    skip slow live-dependency probes\n  --version\n`);
    return;
  }
  if (o.flow) {
    process.stdout.write([
      "◆ The skills, and how they compose:",
      "",
      "  1. momm    — review it     : git diff HEAD | momm/scripts/multi-review.mjs --governor <harness>",
      "  2. myvoice — voice it      : promptus-clone-voice (consent + listening verdict required)",
      "  3. myrepo  — publish it    : myrepo/scripts/publish.mjs --name <repo> --dry-run   (then for real)",
      "  4. yorky   — flavour it    : yorkshire-pudding/scripts/yorkshirify.mjs --level proper",
      "",
      "  A typical project: momm -> fix what reproduces -> myvoice (optional) -> myrepo -> live page.",
      "",
    ].join("\n"));
    return;
  }

  const started = Date.now();
  const skills = CHECKS.map((c) => {
    const t0 = Date.now();
    let result;
    try { result = c.check({ quick: o.quick }); }
    catch (e) { result = { status: "error", detail: String(e.message).slice(0, 120) }; }
    return { skill: c.name, aliases: c.aliases, role: c.role, ...result, ms: Date.now() - t0 };
  });

  const ok = skills.filter((s) => s.status === "ok").length;
  const broken = skills.filter((s) => s.status === "failing" || s.status === "error" || s.status === "missing");
  const unavailable = skills.filter((s) => s.status === "unavailable");
  // Never claim "all working" while a skill's engine is unavailable — say so.
  const verdict = broken.length ? `${broken.length} skill(s) need attention`
    : unavailable.length ? `${ok}/${skills.length} working · ${unavailable.length} unavailable (${unavailable.map((s) => s.skill).join(", ")})`
    : "all skills working";
  const report = {
    myskills_version: MYSKILLS_VERSION,
    skill_root: SKILL_ROOT.replaceAll("\\", "/"),
    checked: skills.length,
    working: ok,
    unavailable: unavailable.length,
    verdict,
    skills,
    duration_ms: Date.now() - started,
  };
  process.stdout.write(`${JSON.stringify(report, null, o.pretty ? 2 : 0)}\n`);

  const mark = { ok: "✓", unavailable: "◍", missing: "✗", failing: "✗", error: "✗" };
  process.stderr.write(`\n  ◆ myskills ${MYSKILLS_VERSION} — ${report.verdict}\n`);
  for (const s of skills) {
    const names = [s.skill, ...s.aliases].join(" / ");
    process.stderr.write(`  ${mark[s.status] || "?"} ${names.padEnd(34)} ${s.version ? "v" + s.version + "  " : ""}${s.detail}\n`);
  }
  process.stderr.write("\n");
  if (broken.length) process.exitCode = 1;
}

main();
