#!/usr/bin/env node
// E7 registry tests: baseline validity and evidence rules, the dispatcher projection, overlay
// binding / expiry / invalidation, effective-cell rules, routing helpers. No CLI is launched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as cap from "./capabilities.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const mommRoot = path.resolve(here, "..");
const passed = [], failures = [];
async function test(name, fn) {
  try { await fn(); passed.push(name); }
  catch (e) { failures.push({ name, error: e.message, stack: String(e.stack ?? "").split("\n").slice(1, 4).map((l) => l.trim()) }); }
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const ROUTES = ["codex", "claude", "antigravity", "gemini", "copilot", "grok"];
const baseline = cap.loadBaseline();
const stamp = { machine_id: "m-test", cli_version: "1.0.0", login_identity_sha256: null, at: "2026-09-13T00:00:00.000Z", expires_at: null };
const matrixWith = (entries = [], { invalidated = [], stale = [] } = {}) => cap.effective({ baseline, machine: "m-test", overlay: { path: null, entries: entries.map((e) => ({ ...stamp, ...e })), invalidated, stale } });
const cellsOf = (doc) => Object.entries(doc.routes).flatMap(([route, entry]) => cap.DIRECTIONS.flatMap((direction) => Object.entries(entry[direction]).map(([modality, cell]) => ({ route, direction, modality, cell }))));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "momm-capabilities-tests-"));

// Reads the dispatcher's MODALITY_SUPPORT initializer without importing it (a string-aware
// balanced-brace scan). A literal is evaluated in a throwaway context; a derived initializer is
// returned as source text.
function modalitySupportFrom(source) {
  const m = source.match(/const MODALITY_SUPPORT\s*=\s*/);
  if (!m) return { missing: true };
  const start = m.index + m[0].length;
  if (source[start] !== "{") { const end = source.indexOf(";", start); return { derived: source.slice(start, end < 0 ? undefined : end).trim() }; }
  let depth = 0, quote = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    // JSON round-trip: objects from another vm context carry a foreign prototype that deepEqual rejects.
    else if (ch === "}" && --depth === 0) return { literal: JSON.parse(JSON.stringify(vm.runInNewContext(`(${source.slice(start, i + 1)})`))) };
  }
  return { missing: true };
}
// Parity verdict: a literal must deep-equal the projection; a derived initializer is accepted only
// when it is exactly `projection(loadBaseline())` (the dispatcher's own self-test then compares the
// evaluated table). Route coverage always comes from the projection, never a hard-coded list.
function dispatcherParity(source, expected) {
  const support = modalitySupportFrom(source);
  if (support.missing) return { ok: false, reason: "MODALITY_SUPPORT not found", routes: [] };
  if (support.derived) {
    const ok = /^projection\(\s*loadBaseline\(\s*\)\s*\)$/.test(support.derived);
    return { ok, reason: ok ? null : `derived initializer is not projection(loadBaseline()): ${support.derived}`, routes: Object.keys(expected) };
  }
  try { assert.deepEqual(support.literal, expected); return { ok: true, reason: null, routes: Object.keys(support.literal) }; }
  catch (e) { return { ok: false, reason: e.message, routes: Object.keys(support.literal) }; }
}
const dispatcherSource = () => fs.readFileSync(path.join(here, "multi-review.mjs"), "utf8");

await test("baseline is valid: schema, vocabularies, evidence shape, cited help lines exist", () => {
  assert.deepEqual(cap.validateBaseline(baseline), []);
  assert.equal(baseline.schema, cap.BASELINE_SCHEMA);
  assert.deepEqual(Object.keys(baseline.routes).sort(), [...ROUTES].sort());
  for (const { route, direction, modality, cell } of cellsOf(baseline)) {
    assert.ok(cap.LEVELS.includes(cell.level), `${route}.${direction}.${modality} level`);
    const expected = direction === "input" ? cap.INPUT_MODALITIES : cap.OUTPUT_MODALITIES;
    assert.ok(expected.includes(modality));
  }
});

await test("every dispatcher route has a baseline entry", () => {
  const parity = dispatcherParity(dispatcherSource(), cap.projection(baseline));
  assert.ok(parity.routes.length, "dispatcher routes could not be read");
  for (const route of new Set([...parity.routes, ...ROUTES])) assert.ok(baseline.routes[route], `${route} missing from capabilities.json`);
});

await test("evidence rules: every non-no cell cites help or docs; verified only from a help capture with help_version; no cli_version on routes; no machine-specific blocker in the baseline", () => {
  let verified = 0;
  for (const { route, direction, modality, cell } of cellsOf(baseline)) {
    const at = `${route}.${direction}.${modality}`;
    if (cell.level !== "no") {
      const ev = cell.evidence ?? {};
      assert.ok(typeof ev.help_capture === "string" || (Array.isArray(ev.docs) && ev.docs.length), `${at} lacks evidence`);
      if (cell.level === "verified") { verified++; assert.match(ev.help_capture ?? "", /^references\/cli\/help\//, `${at} verified without help capture`); assert.match(ev.help_version ?? "", /^\d+\.\d+\.\d+/, `${at} verified without help_version`); }
    }
    if (cell.blocker) { assert.ok(!cap.MACHINE_BLOCKERS.includes(cell.blocker), `${at} carries machine-specific blocker ${cell.blocker}`); assert.equal(cell.blocker, "allowlist"); }
  }
  for (const route of ROUTES) assert.ok(!("cli_version" in baseline.routes[route]), `${route} has cli_version`);
  assert.ok(verified > 0);
  // Probe-only results stay documented in the baseline (the live probes go to the overlay).
  assert.equal(baseline.routes.codex.output.image_gen.level, "documented");
  assert.equal(baseline.routes.antigravity.output.image_gen.level, "documented");
  assert.equal(baseline.routes.grok.output.image_gen.level, "documented");
});

await test("validator: loadBaseline refuses a missing or invalid file (per-case mutations are their own tests below)", () => {
  const doc = clone(baseline);
  doc.routes.antigravity.output.image_gen.level = "verified";
  assert.ok(cap.validateBaseline(doc).some((p) => /verified without a help_capture/.test(p)));
  assert.throws(() => cap.loadBaseline(path.join(tmp, "missing.json")));
  const broken = path.join(tmp, "broken.json");
  fs.writeFileSync(broken, JSON.stringify({ schema: "x", routes: {} }));
  assert.throws(() => cap.loadBaseline(broken), /Invalid capabilities baseline/);
});

await test("projection(baseline) equals the dispatcher's MODALITY_SUPPORT (derived compatibility table)", () => {
  const expected = cap.projection(baseline);
  const parity = dispatcherParity(dispatcherSource(), expected);
  assert.ok(parity.ok, `dispatcher MODALITY_SUPPORT must equal the baseline projection (${parity.reason}):\n${JSON.stringify(expected, null, 2)}`);
});

await test("projection lists only routable input cells; a blocker drops the cell", () => {
  assert.equal(cap.projection(baseline).codex.image, "-i {file}");
  assert.deepEqual(Object.keys(cap.projection(baseline).gemini), ["text", "image", "pdf", "audio", "video"]);
  const blocked = matrixWith([{ route: "codex", direction: "input", modality: "image", blocker: "probe_failed" }]);
  assert.deepEqual(Object.keys(cap.projection(blocked).codex), ["text"]);
  assert.equal(cap.projection(matrixWith()).claude.pdf, "{file} in the prompt (Read tool)");
});

await test("machineId is a stable 16-hex hash of hostname, platform and home", () => {
  const a = cap.machineId({ hostname: "h", platform: "win32", homedir: "C:/Users/fixture" });
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(a, cap.machineId({ hostname: "h", platform: "win32", homedir: "C:/Users/fixture" }));
  assert.notEqual(a, cap.machineId({ hostname: "h2", platform: "win32", homedir: "C:/Users/fixture" }));
  assert.notEqual(a, cap.machineId({ hostname: "h", platform: "linux", homedir: "C:/Users/fixture" }));
  assert.equal(cap.overlayPath("/home/fixture", "abc"), path.join("/home/fixture", ".momm", "capabilities-abc.json"));
});

await test("overlay entry is written privately and atomically, bound to machine, version and hashed login, with expiry by class", () => {
  const home = fs.mkdtempSync(path.join(tmp, "home-"));
  const now = new Date("2026-09-13T12:00:00.000Z");
  const { path: file, entry } = cap.writeOverlayEntry(home, { route: "grok", direction: "output", modality: "video_gen", blocker: "zdr", reason: "ZDR gate", cli_version: "1.0.30", login_identity_sha256: "grok-user@example" }, { now, machine: "m1", baseline });
  assert.equal(file, cap.overlayPath(home, "m1"));
  assert.ok(fs.existsSync(file));
  assert.ok(!fs.readdirSync(path.dirname(file)).some((f) => f.endsWith(".tmp")), "no temp file left behind");
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(entry.login_identity_sha256, cap.sha256("grok-user@example"));
  assert.equal(entry.expires_at, new Date(now.getTime() + 7 * 86_400_000).toISOString());
  const read = cap.readOverlay(home, { installedVersions: { grok: "1.0.30" }, loginIdentity: { grok: "grok-user@example" }, machine: "m1", now });
  assert.equal(read.entries.length, 1);
  assert.equal(read.entries[0].blocker, "zdr");
  assert.deepEqual(read.invalidated, []);
  assert.deepEqual(read.stale, []);
  // Expiry classes.
  const quota = cap.writeOverlayEntry(home, { route: "copilot", direction: "input", modality: "text", blocker: "quota", cli_version: "1.0.83" }, { now, machine: "m1" }).entry;
  assert.equal(quota.expires_at, new Date(now.getTime() + 86_400_000).toISOString());
  const failed = cap.writeOverlayEntry(home, { route: "codex", direction: "output", modality: "image_gen", blocker: "probe_failed", cli_version: "0.154.0" }, { now, machine: "m1" }).entry;
  assert.equal(failed.expires_at, null);
  const upgrade = cap.writeOverlayEntry(home, { route: "grok", direction: "input", modality: "image", level: "verified", cli_version: "1.0.30" }, { now, machine: "m1" }).entry;
  assert.equal(upgrade.expires_at, null);
});

await test("overlay entries are invalidated by CLI upgrade, unknown version, login change or another machine", () => {
  const home = fs.mkdtempSync(path.join(tmp, "home-"));
  const now = new Date("2026-09-13T12:00:00.000Z");
  cap.writeOverlayEntry(home, { route: "gemini", direction: "input", modality: "text", blocker: "auth_tier", cli_version: "0.59.0", login_identity_sha256: "user-a" }, { now, machine: "m1" });
  const reason = (options) => cap.readOverlay(home, { machine: "m1", now, ...options }).invalidated[0]?.reason;
  assert.equal(reason({ installedVersions: { gemini: "0.60.0" } }), "cli_version_changed");
  assert.equal(reason({ installedVersions: {} }), "cli_version_unknown");
  assert.equal(reason({ installedVersions: { gemini: "0.59.0" }, loginIdentity: { gemini: "user-b" } }), "login_changed");
  assert.equal(cap.readOverlay(home, { machine: "m1", now, installedVersions: { gemini: "0.59.0" }, loginIdentity: { gemini: "user-a" } }).entries.length, 1);
  assert.equal(cap.readOverlay(home, { machine: "m2", now, installedVersions: { gemini: "0.59.0" } }).entries.length, 0, "another machine id reads another file");
  assert.equal(cap.readOverlay(home, { machine: "m1", now }).invalidated[0]?.reason, "version_unchecked", "no version map: nothing can be confirmed");
  const file = cap.overlayPath(home, "m1");
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  doc.entries[0].machine_id = "elsewhere";
  fs.writeFileSync(file, JSON.stringify(doc));
  assert.equal(reason({}), "machine_mismatch");
  fs.writeFileSync(file, "{not json");
  assert.throws(() => cap.readOverlay(home, { machine: "m1" }), /unreadable/);
});

await test("writeOverlayEntry replaces the same cell and rejects bad vocabularies, reprobe, and blockers on no cells", () => {
  const home = fs.mkdtempSync(path.join(tmp, "home-"));
  const base = { route: "grok", direction: "output", modality: "video_gen", cli_version: "1.0.30" };
  cap.writeOverlayEntry(home, { ...base, blocker: "zdr" }, { machine: "m1" });
  cap.writeOverlayEntry(home, { ...base, blocker: null }, { machine: "m1" });
  const read = cap.readOverlay(home, { machine: "m1", installedVersions: { grok: "1.0.30" } });
  assert.equal(read.entries.length, 1);
  assert.equal(read.entries[0].blocker, null);
  assert.throws(() => cap.writeOverlayEntry(home, { ...base, blocker: "reprobe" }, { machine: "m1" }), /derived/);
  assert.throws(() => cap.writeOverlayEntry(home, { ...base, blocker: "firewall" }, { machine: "m1" }), /blocker must be one of/);
  assert.throws(() => cap.writeOverlayEntry(home, { ...base, level: "maybe" }, { machine: "m1" }), /level must be one of/);
  assert.throws(() => cap.writeOverlayEntry(home, { ...base, direction: "sideways", blocker: "zdr" }, { machine: "m1" }), /direction/);
  assert.throws(() => cap.writeOverlayEntry(home, { ...base, modality: "image", blocker: "zdr" }, { machine: "m1" }), /modality must be one of/);
  assert.throws(() => cap.writeOverlayEntry(home, { ...base, cli_version: undefined, blocker: "zdr" }, { machine: "m1" }), /cli_version/);
  assert.throws(() => cap.writeOverlayEntry(home, { ...base }, { machine: "m1" }), /needs a level or a blocker/);
  assert.throws(() => cap.writeOverlayEntry(home, { route: "claude", direction: "output", modality: "image_gen", blocker: "probe_failed", cli_version: "2.1.270" }, { machine: "m1", baseline }), /no cell/);
});

await test("effective: verified upgrades apply; probe_failed keeps the baseline level (documented AND verified cells); levels never go down; null clears a baseline blocker", () => {
  const m = matrixWith([
    { route: "grok", direction: "input", modality: "image", level: "verified" },
    { route: "codex", direction: "output", modality: "image_gen", blocker: "probe_failed", reason: "generic reply" },
    { route: "codex", direction: "input", modality: "image", blocker: "probe_failed" },
    { route: "claude", direction: "input", modality: "pdf", level: "no" },
    { route: "antigravity", direction: "output", modality: "code_exec", blocker: null },
  ]);
  const grokImage = m.routes.grok.input.image;
  assert.equal(grokImage.level, "verified"); assert.equal(grokImage.source, "overlay"); assert.ok(cap.routable(grokImage));
  const codexGen = m.routes.codex.output.image_gen;
  assert.equal(codexGen.level, "documented"); assert.equal(codexGen.blocker, "probe_failed"); assert.equal(codexGen.source, "overlay"); assert.equal(codexGen.reason, "generic reply"); assert.ok(!cap.routable(codexGen));
  const codexImage = m.routes.codex.input.image;
  assert.equal(codexImage.level, "verified", "probe_failed on a baseline verified cell keeps verified"); assert.equal(codexImage.blocker, "probe_failed"); assert.ok(!cap.routable(codexImage));
  const claudePdf = m.routes.claude.input.pdf;
  assert.equal(claudePdf.level, "documented"); assert.equal(claudePdf.source, "baseline");
  const agyExec = m.routes.antigravity.output.code_exec;
  assert.equal(agyExec.blocker, null); assert.equal(agyExec.source, "overlay"); assert.ok(cap.routable(agyExec));
  assert.equal(m.overlay.applied, 4);
  assert.equal(m.routes.codex.input.text.source, "baseline");
  assert.equal(m.schema, cap.EFFECTIVE_SCHEMA);
});

await test("expired blocker entries are stale and become reprobe, never silently routable", () => {
  const home = fs.mkdtempSync(path.join(tmp, "home-"));
  const t0 = new Date("2026-09-13T12:00:00.000Z"), later = new Date(t0.getTime() + 25 * 3_600_000);
  cap.writeOverlayEntry(home, { route: "copilot", direction: "input", modality: "text", blocker: "quota", cli_version: "1.0.83" }, { now: t0, machine: "m1" });
  cap.writeOverlayEntry(home, { route: "grok", direction: "output", modality: "video_gen", blocker: "zdr", cli_version: "1.0.30" }, { now: t0, machine: "m1" });
  const versions = { copilot: "1.0.83", grok: "1.0.30" };
  const fresh = cap.readOverlay(home, { machine: "m1", now: t0, installedVersions: versions });
  assert.equal(fresh.entries.length, 2);
  const read = cap.readOverlay(home, { machine: "m1", now: later, installedVersions: versions });
  assert.equal(read.stale.length, 1); assert.equal(read.stale[0].entry.blocker, "quota"); assert.equal(read.stale[0].reason, "expired");
  assert.equal(read.entries.length, 1, "zdr (7 days) still valid after 25 h");
  const m = cap.effective({ home, baseline, machine: "m1", now: later, installedVersions: versions });
  const copilotText = m.routes.copilot.input.text;
  assert.equal(copilotText.blocker, "reprobe"); assert.equal(copilotText.level, "verified"); assert.equal(copilotText.source, "overlay"); assert.match(copilotText.reason, /quota .* expired/);
  assert.ok(!cap.routable(copilotText));
  assert.equal(m.routes.grok.output.video_gen.blocker, "zdr");
  assert.equal(m.overlay.reprobe, 1);
  assert.match(cap.clearingAction("reprobe", "copilot"), /probes\.mjs copilot --modalities/);
});

await test("invalidated entries never unblock: blockers become reprobe, verified upgrades revert to the baseline level", () => {
  const home = fs.mkdtempSync(path.join(tmp, "home-"));
  const now = new Date("2026-09-13T12:00:00.000Z");
  cap.writeOverlayEntry(home, { route: "gemini", direction: "input", modality: "text", blocker: "auth_tier", cli_version: "0.59.0", login_identity_sha256: "u" }, { now, machine: "m1" });
  cap.writeOverlayEntry(home, { route: "grok", direction: "input", modality: "image", level: "verified", cli_version: "1.0.30", login_identity_sha256: "u" }, { now, machine: "m1" });
  const m = cap.effective({ home, baseline, machine: "m1", now, installedVersions: { gemini: "0.60.0", grok: "1.0.31" }, loginIdentity: { gemini: "u", grok: "u" } });
  assert.equal(m.overlay.invalidated.length, 2);
  assert.equal(m.routes.gemini.input.text.blocker, "reprobe");
  assert.match(m.routes.gemini.input.text.reason, /auth_tier .* cli_version_changed/);
  assert.equal(m.routes.grok.input.image.level, "documented");
  assert.equal(m.routes.grok.input.image.source, "baseline");
  assert.equal(m.routes.grok.installed_version, "1.0.31");
  // A login change alone has the same effect.
  const m2 = cap.effective({ home, baseline, machine: "m1", now, installedVersions: { gemini: "0.59.0", grok: "1.0.30" }, loginIdentity: { gemini: "someone-else", grok: "u" } });
  assert.equal(m2.routes.gemini.input.text.blocker, "reprobe");
  assert.equal(m2.routes.grok.input.image.level, "verified");
});

await test("routable rules: verified|documented with null blocker only", () => {
  assert.ok(cap.routable({ level: "verified", blocker: null }));
  assert.ok(cap.routable({ level: "documented" }));
  assert.ok(!cap.routable({ level: "documented", blocker: "auth_tier" }));
  assert.ok(!cap.routable({ level: "verified", blocker: "reprobe" }));
  assert.ok(!cap.routable({ level: "model-only", blocker: null }));
  assert.ok(!cap.routable({ level: "no", blocker: null }));
  assert.ok(!cap.routable(null));
  assert.equal(cap.effectiveMatrix, cap.effective);
  assert.equal(cap.effectiveCell(matrixWith(), "codex", "input", "image").how, "-i {file}");
  assert.equal(cap.effectiveCell(matrixWith(), "codex", "input", "nope"), null);
});

await test("autoReviewers: image+PDF intersection, pool filter, blocker exclusion, empty intersection lists per-modality options", () => {
  const m = matrixWith();
  const both = cap.autoReviewers(m, ["image", "pdf"]);
  assert.equal(both.empty, false);
  assert.deepEqual(both.reviewers, ["claude", "antigravity", "gemini", "copilot", "grok"]);
  assert.ok(both.per_modality.image.includes("codex"));
  assert.ok(!both.per_modality.pdf.includes("codex"));
  assert.deepEqual(both.unroutable.pdf.map((u) => u.route), ["codex"]);
  const pooled = cap.autoReviewers(m, ["image", "pdf"], { pool: ["codex", "claude", "antigravity", "copilot", "grok"] });
  assert.deepEqual(pooled.reviewers, ["claude", "antigravity", "copilot", "grok"]);
  const blocked = matrixWith([{ route: "gemini", direction: "input", modality: "text", blocker: "auth_tier" }]);
  assert.ok(!cap.autoReviewers(blocked, ["image"]).reviewers.includes("gemini"));
  const empty = cap.autoReviewers(blocked, ["audio"]);
  assert.equal(empty.empty, true);
  assert.deepEqual(empty.reviewers, []);
  assert.deepEqual(empty.per_modality.audio, ["gemini"], "the audio cell itself is routable; text carries the blocker");
  assert.deepEqual(empty.per_modality.text, ["codex", "claude", "antigravity", "copilot", "grok"]);
  assert.deepEqual(empty.unroutable.audio.map((u) => u.route), ["codex", "claude", "antigravity", "copilot", "grok"]);
  assert.equal(empty.unroutable.audio.find((u) => u.route === "antigravity").level, "model-only");
  assert.match(empty.unroutable.audio.find((u) => u.route === "antigravity").action, /No headless path/);
  assert.deepEqual(empty.unroutable.text.map((u) => u.route), ["gemini"]);
  assert.equal(empty.unroutable.text[0].blocker, "auth_tier");
  assert.match(empty.unroutable.text[0].action, /Code Assist/);
  assert.equal(cap.autoReviewers(m, ["speech"]).empty, true);
  assert.deepEqual(cap.autoReviewers(m, []).reviewers, ROUTES);
});

await test("renderMatrix: text table with blockers, overlay marks and clearing actions; json round-trips", () => {
  const m = matrixWith([{ route: "gemini", direction: "input", modality: "text", blocker: "auth_tier", reason: "IneligibleTierError" }]);
  const text = cap.renderMatrix(m);
  assert.match(text, /^MOMM modality capabilities/);
  for (const route of ROUTES) assert.ok(text.includes(`\n${route}`), route);
  assert.match(text, /verified!auth_tier\*/);
  assert.match(text, /gemini input\.text: auth_tier \(IneligibleTierError\) -> Use a Standard or Enterprise/);
  assert.match(text, /codex input\.image \[verified\] -i \{file\} .*help references\/cli\/help\/codex-exec\.txt:37 \(v0\.154\.0\)/);
  assert.match(text, /antigravity output\.code_exec: allowlist/);
  assert.ok(!/[\x00-\x08\x0b-\x1f\x7f]/.test(text));
  const json = JSON.parse(cap.renderMatrix(m, { json: true }));
  assert.equal(json.schema, cap.EFFECTIVE_SCHEMA);
  assert.equal(json.routes.gemini.input.text.blocker, "auth_tier");
});

await test("binding templates: {file}/{dir} only", () => {
  assert.equal(cap.bindingProblem(baseline.routes.claude.input.image), null);
  assert.match(cap.bindingProblem({ how: "--flag {path}" }), /unknown placeholder \{path\}/);
  assert.deepEqual(cap.templatesOf({ how: "-i {file}", requires: ["--x"] }), ["-i {file}", "--x"]);
  for (const { route, direction, modality, cell } of cellsOf(baseline)) if (direction === "input" && cell.level !== "no") assert.equal(cap.bindingProblem(cell), null, `${route}.${modality}`);
});

await test("E7 files are LF-only with no raw control characters", () => {
  for (const file of ["references/capabilities.json", "scripts/capabilities.mjs", "scripts/capabilities.test.mjs", "scripts/modality.mjs", "scripts/modality.test.mjs"]) {
    const text = fs.readFileSync(path.join(mommRoot, file), "utf8");
    assert.ok(!text.includes("\r"), `${file} has CR`);
    assert.ok(!/[\x00-\x08\x0b-\x1f\x7f]/.test(text), `${file} has a raw control character`);
    assert.ok(text.endsWith("\n"), `${file} ends with newline`);
  }
});

await test("CLI prints the effective matrix as JSON", () => {
  const home = fs.mkdtempSync(path.join(tmp, "home-"));
  const result = spawnSync(process.execPath, [path.join(here, "capabilities.mjs"), "--json", "--home", home], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.schema, cap.EFFECTIVE_SCHEMA);
  assert.equal(json.routes.codex.input.image.level, "verified");
  const text = spawnSync(process.execPath, [path.join(here, "capabilities.mjs"), "--home", home], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /INPUT\s+text\s+image/);
});

// ---- gate review rev_20260913213315_o8c2: one failing test per finding, then the fix ----------------
await test("finding promotion-without-invocation-metadata: an overlay never raises a baseline no cell (no how/harvest/mime to route on)", () => {
  const tiny = { routes: { r: { models: {}, input: { text: { level: "documented", how: "stdin" }, image: { level: "no" } }, output: { image_gen: { level: "no" } } } } };
  const overlay = { entries: [{ route: "r", direction: "input", modality: "image", level: "verified", blocker: null }, { route: "r", direction: "output", modality: "image_gen", level: "verified", blocker: null }] };
  const m = cap.effective({ baseline: tiny, overlay, machine: "m" });
  assert.deepEqual(cap.autoReviewers(m, ["image"]).reviewers, []);
  assert.equal(m.routes.r.input.image.level, "no");
  assert.equal(m.routes.r.output.image_gen.level, "no");
  assert.ok(!cap.routable(m.routes.r.output.image_gen));
  const home = fs.mkdtempSync(path.join(tmp, "home-"));
  assert.throws(() => cap.writeOverlayEntry(home, { route: "claude", direction: "output", modality: "image_gen", level: "verified", cli_version: "2.1.270" }, { machine: "m1", baseline }), /no cell/);
});

await test("finding login-identity-missing-route-bypass: a supplied login map that lacks the route invalidates its entry even when the recorded identity is null", () => {
  const home = fs.mkdtempSync(path.join(tmp, "home-"));
  cap.writeOverlayEntry(home, { route: "gemini", direction: "input", modality: "text", level: "verified", cli_version: "0.59.0" }, { machine: "m1" });
  const versions = { gemini: "0.59.0" };
  assert.equal(cap.readOverlay(home, { machine: "m1", installedVersions: versions, loginIdentity: { copilot: "user" } }).invalidated[0]?.reason, "login_unknown");
  assert.equal(cap.readOverlay(home, { machine: "m1", installedVersions: versions, loginIdentity: {} }).invalidated[0]?.reason, "login_unknown");
  assert.equal(cap.readOverlay(home, { machine: "m1", installedVersions: versions }).entries.length, 1, "login map omitted: dimension not checked (probes bind null identities)");
  assert.equal(cap.readOverlay(home, { machine: "m1", installedVersions: versions, loginIdentity: { gemini: "u" } }).invalidated[0]?.reason, "login_changed");
});

await test("overlay writes serialize; release is waited on; abandoned locks require explicit recovery", async () => {
  const home = fs.mkdtempSync(path.join(tmp, "home-"));
  const moduleUrl = pathToFileURL(path.join(here, "capabilities.mjs")).href;
  const child = (route) => new Promise((resolve) => {
    const code = `import { writeOverlayEntry } from ${JSON.stringify(moduleUrl)}; const mods = { input: ["text","image","pdf","audio","video","speech"], output: ["text","image_gen","video_gen","speech","code_exec","web"] }; for (const direction of ["input","output"]) for (const modality of mods[direction]) writeOverlayEntry(${JSON.stringify(home)}, { route: ${JSON.stringify(route)}, direction, modality, blocker: "quota", cli_version: "1.0.0" }, { machine: "m1", lockTimeoutMs: 15000 });`;
    const p = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let err = ""; p.stderr.on("data", (d) => { err += d; });
    p.on("close", (status) => resolve({ status, err }));
  });
  const results = await Promise.all([child("codex"), child("grok")]);
  for (const r of results) assert.equal(r.status, 0, r.err);
  assert.equal(cap.readOverlay(home, { machine: "m1", installedVersions: { codex: "1.0.0", grok: "1.0.0" } }).entries.length, 24, "no entry lost to a concurrent read-modify-write");
  // Wait for actual release, never infer release from process death.
  const lock = `${cap.overlayPath(home, "m1")}.lock`;
  // The live owner must be a process whose death this test can observe while it busy-waits:
  // a direct child that exits during the synchronous wait stays a zombie on POSIX (the event
  // loop never reaps it), so kill(pid, 0) keeps reporting it alive and the wait times out
  // (CI run 34786106618, ubuntu 22). Spawn it as a grandchild that is reparented to init.
  const launcher = spawn(process.execPath, ["-e", "const c = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1200)'], { detached: true, stdio: 'ignore', windowsHide: true }); c.unref(); process.stdout.write(String(c.pid));"], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  const sleeperPid = await new Promise((resolve) => { let out = ""; launcher.stdout.on("data", (d) => { out += d; }); launcher.on("close", () => resolve(Number.parseInt(out, 10))); });
  assert.ok(Number.isInteger(sleeperPid) && sleeperPid > 0, `sleeper pid ${sleeperPid}`);
  fs.writeFileSync(lock, `${sleeperPid}\n`);
  const releaser = spawn(process.execPath, ["-e", `setTimeout(()=>require('node:fs').unlinkSync(${JSON.stringify(lock)}),400)`], {windowsHide:true,stdio:'ignore'});
  const released = new Promise(resolve=>releaser.on('close',resolve));
  const t0 = Date.now();
  cap.writeOverlayEntry(home, { route: "claude", direction: "input", modality: "text", blocker: "quota", cli_version: "2.1.270" }, { machine: "m1", lockTimeoutMs: 10_000 });
  assert.ok(Date.now() - t0 >= 300, `waited on actual release (${Date.now() - t0} ms)`);
  assert.equal(await released,0);
  assert.ok(!fs.existsSync(lock));
  fs.writeFileSync(lock, "999999\n");
  assert.throws(()=>cap.writeOverlayEntry(home, { route: "claude", direction: "input", modality: "pdf", blocker: "quota", cli_version: "2.1.270" }, { machine: "m1", lockTimeoutMs: 60 }),/explicit recovery/);
  assert.equal(fs.readFileSync(lock,'utf8'),'999999\n');
  fs.unlinkSync(lock); // Explicit recovery of this disposable fixture only.
  cap.writeOverlayEntry(home, { route: "claude", direction: "input", modality: "pdf", blocker: "quota", cli_version: "2.1.270" }, { machine: "m1" });
  fs.writeFileSync(lock, `${process.pid}\n`);
  assert.throws(() => cap.writeOverlayEntry(home, { route: "claude", direction: "input", modality: "image", blocker: "quota", cli_version: "2.1.270" }, { machine: "m1", lockTimeoutMs: 300 }), /lock/);
  fs.unlinkSync(lock);
});

await test("finding structural-validation-throws / validate-baseline-null-cell-typeerror / templatesOf-throws: malformed cells and requires are problems, never exceptions", () => {
  const cellsFor = (text) => ({ text, image: {}, pdf: {}, audio: {}, video: {}, speech: {} });
  for (const text of [null, "documented", 7, { level: "documented", how: "--file {file}", requires: {} }, { level: "documented", how: "x", evidence: { docs: ["https://ex"] }, requires: 1 }]) {
    const doc = { schema: cap.BASELINE_SCHEMA, routes: { r: { models: {}, input: cellsFor(text), output: {} } } };
    let problems;
    assert.doesNotThrow(() => { problems = cap.validateBaseline(doc, { helpRoot: null }); }, `text=${JSON.stringify(text)}`);
    assert.ok(problems.some((p) => /r\.input\.text/.test(p)), JSON.stringify(problems));
  }
  assert.equal(cap.bindingProblem({ how: "x", requires: 1 }), null);
  assert.deepEqual(cap.templatesOf({ how: "x", requires: {} }), ["x"]);
});

await test("finding unsupported-placeholder-not-detected: any {token} outside file/dir is unbindable", () => {
  for (const placeholder of ["{file1}", "{FILE}", "{input-file}", "{}", "{ file }"]) assert.notEqual(cap.bindingProblem({ how: `--input ${placeholder}` }), null, placeholder);
  assert.equal(cap.bindingProblem({ how: "--input {file} --add-dir {dir}" }), null);
});

await test("finding effective-skips-binding-by-default: without installed versions every version-bound entry is unchecked and fails closed to reprobe", () => {
  const home = fs.mkdtempSync(path.join(tmp, "home-"));
  const now = new Date("2026-09-13T12:00:00.000Z");
  cap.writeOverlayEntry(home, { route: "grok", direction: "input", modality: "image", blocker: "quota", cli_version: "0.0.0-test" }, { now, machine: "m1" });
  cap.writeOverlayEntry(home, { route: "grok", direction: "input", modality: "pdf", level: "verified", cli_version: "0.0.0-test" }, { now, machine: "m1" });
  const unchecked = cap.effective({ home, baseline, machine: "m1", now });
  assert.equal(unchecked.routes.grok.input.image.blocker, "reprobe");
  assert.match(unchecked.routes.grok.input.image.reason, /version_unchecked/);
  assert.equal(unchecked.routes.grok.input.pdf.level, "documented", "an unchecked verified upgrade is not applied");
  assert.equal(cap.effective({ home, baseline, machine: "m1", now, installedVersions: { grok: "2.0.0" } }).routes.grok.input.image.blocker, "reprobe");
  const bound = cap.effective({ home, baseline, machine: "m1", now, installedVersions: { grok: "0.0.0-test" } });
  assert.equal(bound.routes.grok.input.image.blocker, "quota");
  assert.equal(bound.routes.grok.input.pdf.level, "verified");
});

await test("finding effective-skips-binding-by-default (CLI): --versions binds; without it the CLI detects installed versions and says the login dimension was not checked", () => {
  const home = fs.mkdtempSync(path.join(tmp, "home-"));
  const machine = cap.machineId();
  cap.writeOverlayEntry(home, { route: "grok", direction: "input", modality: "image", blocker: "quota", cli_version: "0.0.0-test" }, { machine });
  const run = (...extra) => spawnSync(process.execPath, [path.join(here, "capabilities.mjs"), "--json", "--home", home, ...extra], { encoding: "utf8", timeout: 120_000, windowsHide: true });
  const bound = run("--versions", JSON.stringify({ grok: "0.0.0-test" }));
  assert.equal(bound.status, 0, bound.stderr);
  assert.equal(JSON.parse(bound.stdout).routes.grok.input.image.blocker, "quota");
  assert.match(bound.stderr, /login/i, "says the login binding was not checked");
  const detected = run();
  assert.equal(detected.status, 0, detected.stderr);
  const json = JSON.parse(detected.stdout);
  assert.equal(json.routes.grok.input.image.blocker, "reprobe", "no installed grok reports 0.0.0-test, so the entry cannot be confirmed");
  assert.match(detected.stderr, /versions?.*(detected|read)/i, detected.stderr);
});

await test("finding derived-dispatcher-parity-not-checked: a derived MODALITY_SUPPORT is only accepted when it is exactly projection(loadBaseline()) and matches", () => {
  const expected = cap.projection(baseline);
  assert.equal(dispatcherParity("const MODALITY_SUPPORT = (/* projection( */ {});", expected).ok, false);
  assert.equal(dispatcherParity("const MODALITY_SUPPORT = projection(loadBaseline());", expected).ok, true);
  assert.equal(dispatcherParity("const MODALITY_SUPPORT = projection(loadBaseline())", expected).ok, true, "no trailing semicolon");
  assert.equal(dispatcherParity("const MODALITY_SUPPORT = projection(somethingElse());", expected).ok, false);
  assert.equal(dispatcherParity("const MODALITY_SUPPORT = {};", expected).ok, false);
  assert.equal(dispatcherParity(`const MODALITY_SUPPORT = ${JSON.stringify(expected)};`, expected).ok, true);
  assert.equal(dispatcherParity("const OTHER = 1;", expected).ok, false);
  assert.deepEqual(dispatcherParity("const MODALITY_SUPPORT = projection(loadBaseline());", expected).routes, Object.keys(expected), "route coverage comes from the projection, never a hard-coded list");
});

// ---- suggestions applied with tests -----------------------------------------------------------------
await test("suggestion: expiry boundary — valid just before expires_at, stale exactly at it", () => {
  const home = fs.mkdtempSync(path.join(tmp, "home-"));
  const t0 = new Date("2026-09-13T12:00:00.000Z");
  const { entry } = cap.writeOverlayEntry(home, { route: "copilot", direction: "input", modality: "text", blocker: "quota", cli_version: "1.0.83" }, { now: t0, machine: "m1" });
  const at = Date.parse(entry.expires_at);
  const versions = { copilot: "1.0.83" };
  assert.equal(cap.readOverlay(home, { machine: "m1", installedVersions: versions, now: new Date(at - 1) }).entries.length, 1);
  assert.equal(cap.readOverlay(home, { machine: "m1", installedVersions: versions, now: new Date(at) }).stale.length, 1);
});

for (const [label, mutate, expected] of [
  ["documented with help-only evidence", (b) => { b.routes.codex.input.image.level = "documented"; delete b.routes.codex.input.image.evidence.docs; }, /documented without docs/],
  ["declared input vocabulary differs", (b) => { b.modalities.input = ["text"]; }, /modalities.input/],
  ["declared output vocabulary duplicates", (b) => { b.modalities.output.push("text"); }, /modalities.output/],
  ["verified with docs-only evidence", (b) => { b.routes.gemini.input.image.level = "verified"; }, /verified without a help_capture/],
  ["machine blocker quota", (b) => { b.routes.codex.input.image.blocker = "quota"; }, /machine-specific blocker quota/],
  ["derived blocker reprobe", (b) => { b.routes.codex.input.image.blocker = "reprobe"; }, /machine-specific blocker reprobe/],
  ["route cli_version", (b) => { b.routes.codex.cli_version = "0.154.0"; }, /cli_version does not belong/],
  ["help_capture without help_version", (b) => { delete b.routes.codex.input.image.evidence.help_version; }, /help_version/],
  ["unknown placeholder", (b) => { b.routes.claude.input.image.requires = ["--add-dir {workspace}"]; }, /unknown placeholder \{workspace\}/],
  ["bad level", (b) => { b.routes.grok.input.pdf.level = "maybe"; }, /level must be one of/],
  ["generative without harvest", (b) => { delete b.routes.grok.output.image_gen.harvest; }, /needs a harvest glob/],
  ["docs that are not URLs", (b) => { b.routes.grok.output.web.evidence = { docs: ["not a url"] }; }, /needs evidence/],
  ["empty evidence", (b) => { b.routes.gemini.input.image.evidence = {}; }, /needs evidence/],
  ["help line out of range", (b) => { b.routes.codex.input.image.evidence.help_capture = "references/cli/help/codex-exec.txt:99999"; }, /not a non-empty line/],
  ["missing cell", (b) => { delete b.routes.codex.input.pdf; }, /cell missing/],
]) {
  await test(`suggestion: validator case — ${label}`, () => {
    const doc = clone(baseline);
    mutate(doc);
    const problems = cap.validateBaseline(doc);
    assert.ok(problems.some((p) => expected.test(p)), `expected ${expected} in ${JSON.stringify(problems)}`);
  });
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(JSON.stringify({ passed, failures }, null, 2));
if (failures.length) process.exitCode = 1;
