#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { renderPublic, canonical, stats } from "./render-momm-site.mjs";
import { createHash } from "node:crypto";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
renderPublic({ root, check: true });
const files = ["index.html", "start.html", "updates.html", "evidence.html", "reference.html"];
let localLinks = 0;
for (const name of files) {
  const file = path.join(root, "docs/momm", name), html = fs.readFileSync(file, "utf8");
  assert.match(html, /<html lang="en">/); assert.match(html, /<main id="main">/);
  assert.match(html, /aria-current="page"/); assert.match(html, /viewport/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, `${name}: duplicate element ID`);
  for (const [, value] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    assert(!/^file:/i.test(value), `${name}: local filesystem URL`);
    if (/^(https?:|mailto:|data:)/.test(value)) continue;
    const [relative, fragment] = value.split("#");
    const dest = relative ? path.resolve(path.dirname(file), decodeURIComponent(relative)) : file;
    assert(dest.startsWith(path.join(root, "docs") + path.sep), `${name}: link escapes docs`);
    assert(fs.existsSync(dest), `${name}: missing ${value}`);
    if (fragment) assert(fs.readFileSync(dest, "utf8").includes(`id="${fragment}"`), `${name}: missing fragment ${value}`);
    localLinks++;
  }
  for (const [, id] of html.matchAll(/data-copy="([^"]+)"/g)) assert(ids.includes(id), `${name}: copy target missing`);
}
const data = JSON.parse(fs.readFileSync(path.join(root, "docs/evidence/momm-evidence.json")));
const ledger = fs.readFileSync(path.join(root, "docs/evidence/index.html"), "utf8");
assert.deepEqual(JSON.parse(ledger.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/)[1]), data);
// Execute the actual ledger bootstrap/render functions with minimal DOM sinks.
// This catches a flat-export/projects schema mismatch that JSON equality misses.
const bootstrap = [...ledger.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes("const RAW_EXPORT"));
assert(bootstrap, "Public ledger schema adapter missing");
const elements = new Map();
const document = { getElementById(id) {
  if (!elements.has(id)) elements.set(id, { textContent: id === "data" ? JSON.stringify(data) : "", innerHTML: "", addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, insertAdjacentHTML(_at, text) { this.innerHTML += text; } });
  return elements.get(id);
} };
const runtime = vm.runInNewContext(bootstrap + "\nrenderDetail(allRuns.find(e => e.report)); ({total:allRuns.length,logged:allRuns.filter(e=>!e.orphan).length,reports:fullReports,decisions:totalDisp});", { document, CSS: { escape: s => s } }, { timeout: 2000 });
assert.equal(runtime.logged, data.runs.length); assert.equal(runtime.reports, Object.keys(data.reports).length); assert.equal(runtime.decisions, data.dispositions.length);
assert(elements.get("runs").innerHTML.includes("data-id="));
assert(elements.get("detail").innerHTML.includes("Sanitized public report"));
const speechStart = ledger.indexOf("  function speakSequence(items)");
const speechEnd = ledger.indexOf("  function registerSpeech(", speechStart);
assert(speechStart >= 0 && speechEnd > speechStart);
function speechAttempt(voice) {
  const spoken = [];
  const context = {
    synth: { cancel() {}, speak(u) { spoken.push(u); } },
    speechSequenceId: 0, pendingUtterances: 0, state: {},
    pauseButton: {}, stopButton: {}, readAllButton: {},
    rateSelect: { value: "1" }, deviceVoices: voice ? [voice] : [],
    setSpeechStatus() {}, stopSpeech() {}, selectedVoice() { return voice; },
    cleanForSpeech: x => x, model: () => ({ label: "Codex" }),
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
  };
  vm.runInNewContext(ledger.slice(speechStart, speechEnd) + '\nspeakSequence([{agent:"codex",label:"review",text:"Fixture only; never played."}]);', context, { timeout: 1000 });
  return spoken;
}
assert.equal(speechAttempt(undefined).length, 0, "No local voice must not fall back to browser default");
assert.equal(speechAttempt({ name: "Remote", localService: false }).length, 0, "Remote voice must be refused");
const localVoice = { name: "Local fixture", voiceURI: "fixture-local", lang: "en-GB", localService: true };
const accepted = speechAttempt(localVoice);
assert.equal(accepted.length, 1); assert.equal(accepted[0].voice, localVoice);
for (const r of Object.values(data.reports)) assert.equal(r.public_report_sha256, createHash("sha256").update(JSON.stringify(canonical(r.report))).digest("hex"));
const s = stats(data);
assert.equal(s.log_successes, s.stored_successes + s.summary_only_successes);
assert.equal(s.dispositions, Object.values(s.decisions).reduce((a, b) => a + b, 0));
assert.deepEqual(canonical({ z: [{ b: 2, a: 1 }], a: 0 }), { a: 0, z: [{ a: 1, b: 2 }] });
assert.equal(fs.readFileSync(path.join(root, "docs/momm/site.js"), "utf8").includes("innerHTML"), false);
process.stdout.write(JSON.stringify({ passed: true, pages: files.length, local_links: localLinks, public_report_hashes: Object.keys(data.reports).length, reconciliation: s.decisions }, null, 2) + "\n");
