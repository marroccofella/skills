#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { renderPublic, canonical, stats } from "./render-momm-site.mjs";
import { createHash } from "node:crypto";
import vm from "node:vm";
await import("./ledger-ui.test.mjs");
await import("./momm-site-visuals.test.mjs");
await import("./momm-site-videos.test.mjs");
await import("./momm-site-search.test.mjs");
await import("./momm-site-discovery.test.mjs");
await import("./momm-site-regression.test.mjs");
await import("./momm-site-technical.test.mjs");
await import("./momm-site-home.test.mjs");
await import("./momm-site-flow.test.mjs");
await import("./momm-site-community.test.mjs");
await import("./momm-release-observer.test.mjs");
await import("./momm-improvement-regressions.test.mjs");
await import("./preview-module.test.mjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
renderPublic({ root, check: true });
const expectedVersion = JSON.parse(fs.readFileSync(path.join(root, 'versions.json'))).momm;
const hub = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
assert.equal([...hub.matchAll(/data-momm-version/g)].length, 1, 'hub needs one generated version marker');
assert(hub.includes(`<span data-momm-version>${expectedVersion}</span>`), 'hub must show the exact manifest version');
const sitemap = fs.readFileSync(path.join(root, 'docs/sitemap.xml'), 'utf8');
assert(!sitemap.includes('<lastmod>2026-09-04</lastmod>'), 'do not reuse the historical evidence date as current page modification time');
for (const page of ['start.html', 'updates.html', 'reference.html', 'technical.html', 'watch/overview.html', 'watch/setup.html', 'watch/trailer.html', `releases/${expectedVersion}.html`, 'releases/upgrade.html'])
  assert(sitemap.includes(`https://marroccofella.github.io/skills/momm/${page}`), `sitemap omits ${page}`);
const files = ["index.html", "start.html", "updates.html", "evidence.html", "technical.html", "reference.html", "data/index.html"];
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
    const relativePath = relative.split('?')[0];
    const dest = relativePath ? path.resolve(path.dirname(file), decodeURIComponent(relativePath)) : file;
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
const sparseData=structuredClone(data),firstReport=Object.keys(sparseData.reports)[0];
sparseData.reports[firstReport].report={input_bytes:10};
const sparseElements=new Map(),sparseDocument={getElementById(id){if(!sparseElements.has(id))sparseElements.set(id,{textContent:id==='data'?JSON.stringify(sparseData):'',innerHTML:'',addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},insertAdjacentHTML(_where,text){this.innerHTML+=text;}});return sparseElements.get(id);}};
vm.runInNewContext(bootstrap+`\nrenderDetail(allRuns.find(e=>e.run.run_id===${JSON.stringify(firstReport)}));`,{document:sparseDocument,CSS:{escape:s=>s}},{timeout:2000});
assert.match(sparseElements.get('detail').innerHTML,/unavailable|partial/i);
assert(!sparseElements.get('detail').innerHTML.includes('no reviewer raised a defect'));
const preferences=ledger.slice(ledger.indexOf('  // Browser preferences are optional;'),ledger.indexOf('  const HARNESS ='));
assert(preferences.includes('function loadStoredPreference'));
vm.runInNewContext(preferences+`\nsaveStoredPreference('theme','dark');if(loadStoredPreference('theme')!=='dark')throw Error('memory preference fallback failed');`,{Map,localStorage:{getItem(){throw Error('SecurityError');},setItem(){throw Error('SecurityError');}}},{timeout:1000});
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
const releases=JSON.parse(fs.readFileSync(path.join(root,'momm/references/release-history.json')));
for(const name of ['index','upgrade',...releases.map(r=>r.version)]){
  const file=path.join(root,'docs/momm/releases',name+'.html'),html=fs.readFileSync(file,'utf8');
  assert.match(html,/<main id="main">/);assert(!/<script(?![^>]*(?:src=|type="application\/ld\+json"))/.test(html),'release notes must not introduce executable inline scripts');
  for(const [,href] of html.matchAll(/(?:href|src)="([^"]+)"/g)){
    if(href.startsWith('#')||href.startsWith('https://'))continue;
    assert(!/^[a-z]+:/i.test(href),'unsafe release URL');
    const dest=path.resolve(path.dirname(file),decodeURIComponent(href.split('#')[0]));
    assert(dest.startsWith(path.join(root,'docs')+path.sep));assert(fs.existsSync(dest),'missing release link: '+href);localLinks++;
  }
}
const manifest=JSON.parse(fs.readFileSync(path.join(root,'versions.json')));
assert(releases.some(r=>r.version===manifest.momm),'current version missing from archive');
for(const entry of releases)assert(manifest.momm_releases.some(r=>r.version===entry.version),'missing changelog entry '+entry.version);
assert.equal(s.log_successes, s.stored_successes + s.summary_only_successes);
assert.equal(s.dispositions, Object.values(s.decisions).reduce((a, b) => a + b, 0));
assert.deepEqual(canonical({ z: [{ b: 2, a: 1 }], a: 0 }), { a: 0, z: [{ a: 1, b: 2 }] });
assert.equal(fs.readFileSync(path.join(root, "docs/momm/site.js"), "utf8").includes("innerHTML"), false);
process.stdout.write(JSON.stringify({ passed: true, pages: files.length, local_links: localLinks, public_report_hashes: Object.keys(data.reports).length, reconciliation: s.decisions }, null, 2) + "\n");
