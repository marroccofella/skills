#!/usr/bin/env node
// MOMM 1.17 E1 to E3: guided image generation rounds, tested with a FAKE exec only. No provider CLI is
// launched, nothing is generated, and no model is ever asked to critique: the tests play the governor.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as gen from "./generation-rounds.mjs";
import { loadBaseline, effective, sha256 } from "./capabilities.mjs";
import { fixturePng, JPEG } from "./media-fixtures.mjs";
import { requirePrivateEvidence } from "./evidence-permissions.mjs";
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: this suite decides where its fixtures' evidence lives

const here = path.dirname(fileURLToPath(import.meta.url));
const passed = [], failures = [];
const filter = process.argv.find((a) => a.startsWith("--filter="))?.slice("--filter=".length);
async function test(name, fn) {
  if (filter && !name.includes(filter)) return;
  const started = Date.now();
  let outcome = "FAIL";
  process.stderr.write(`START ${name}\n`);
  try { await fn(); passed.push(name); outcome = "PASS"; }
  catch (e) { failures.push({ name, error: e.message, stack: String(e.stack ?? "").split("\n").slice(1, 4).map((l) => l.trim()) }); }
  finally { process.stderr.write(`END ${name} (${Date.now() - started}ms) ${outcome}\n`); }
}
const baseline = loadBaseline();
const stamp = { machine_id: "m-test", cli_version: "1.0.0", login_identity_sha256: null, at: "2026-09-13T00:00:00.000Z", expires_at: null };
const matrix = (entries = []) => effective({ baseline, machine: "m-test", overlay: { path: null, entries: entries.map((e) => ({ ...stamp, ...e })), invalidated: [], stale: [] } });
// Antigravity cannot take a picture in: its image-input cell is blocked, so it gets notes only.
const NO_AGY_INPUT = [{ route: "antigravity", direction: "input", modality: "image", blocker: "probe_failed" }];
const { privateTestFixture } = await import("./private-test-fixture.mjs");
process.umask(0o077);
const tmp = privateTestFixture("momm-generation-rounds-tests-");
const fresh = (name) => fs.mkdtempSync(path.join(tmp, `${name}-`));
// The user's words, deliberately awkward: CRLF, trailing spaces, non-ASCII, a line that looks like a
// section marker, and no trailing newline. Every maker must receive exactly these bytes, every round.
const WORDS = "Graffiti reading \"entrepreneuria\" on Leeds Town Hall, Yorkshire.  \r\n--- keep this line ---\r\nDawn light, café-style lettering ✓ ";
const CHECKLIST = { items: [
  { text: "Recognisably Leeds Town Hall: central clock tower above the colonnade", kind: "must" },
  { text: "Graffiti painted on the building itself", kind: "must" },
  { text: "No other words in the picture", kind: "must_not" },
  { text: "The word 'entrepreneuria', spelled exactly", kind: "text_in_image" },
  { text: "Realistic photo", kind: "style" },
  { text: "Landscape", kind: "shape" },
] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniqueJpeg = (label) => { const text = Buffer.from(label); const len = text.length + 2; return Buffer.concat([JPEG.subarray(0, 2), Buffer.from([0xff, 0xfe, len >> 8, len & 255]), text, JPEG.subarray(2)]); };
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); return file; };

// The fake exec: reads the prompt the way each CLI would receive it (codex stdin, agy prompt.txt, grok
// --prompt-file), records it, and writes a synthetic picture where the route's harvest glob looks.
function fakeMakers({ home, calls, refuse = {}, delay = 40 }) {
  const stats = { active: 0, maxActive: 0 };
  let n = 0;
  const exec = async (command, args, options) => {
    stats.active++; stats.maxActive = Math.max(stats.maxActive, stats.active);
    try {
      await sleep(delay);
      let route, prompt;
      if (command === "codex") { route = "codex"; prompt = options.input; }
      else if (command === "agy") { route = "antigravity"; prompt = fs.readFileSync(path.join(options.cwd, "prompt.txt"), "utf8"); }
      else if (command === "grok") { route = "grok"; prompt = fs.readFileSync(args[args.indexOf("--prompt-file") + 1], "utf8"); }
      else throw new Error(`unexpected command ${command}`);
      calls.push({ route, command, args, options, prompt });
      if (refuse[route]) return { code: 0, stdout: refuse[route], stderr: "" };
      const k = ++n;
      if (route === "codex") { write(path.join(home, ".codex", "generated_images", `s${k}`, `ig_${k}.png`), fixturePng(`codex-${k}`)); return { code: 0, stdout: "saved", stderr: "" }; }
      if (route === "antigravity") { write(path.join(home, ".gemini", "antigravity-cli", "brain", `s${k}`, `pic_${k}.jpg`), uniqueJpeg(`agy-${k}`)); return { code: 0, stdout: JSON.stringify({ response: "done" }), stderr: "" }; }
      write(path.join(home, ".grok", "sessions", "enc", `s${k}`, "images", `img_${k}.jpg`), uniqueJpeg(`grok-${k}`));
      return { code: 0, stdout: JSON.stringify({ text: "done" }), stderr: "" };
    } finally { stats.active--; }
  };
  return { exec, stats };
}
// The governor's part, played by the test: a critique with a unique, traceable evidence token per picture
// and item, so a leak of one maker's notes into another's prompt is visible.
function critiqueFor(round, labels, ids, overrides = {}) {
  const pictures = {};
  for (const label of labels) {
    const items = {};
    ids.forEach((id, k) => { const result = ["met", "partly", "missed", "cant_tell"][k % 4]; items[id] = result === "cant_tell" ? { result } : { result, evidence: `EVID-r${round}-${label}-${id}: what is visible` }; });
    pictures[label] = { items, letter_vs_spirit: `SPIRIT-r${round}-${label}: meets the words, misses the point` };
  }
  return { round, pictures, recommendation: `The governor prefers ${labels[0]} against the checklist.`, suggested_rounds: [`SUGGEST-r${round}-1: put the clock tower in the middle (all)`, `SUGGEST-r${round}-2: combine the best`], ...overrides };
}
const env = {};
async function setup({ entries = [], refuse = {}, delay } = {}) {
  const cwd = fresh("cwd"), home = fresh("home"), calls = [], m = matrix(entries);
  const fake = fakeMakers({ home, calls, refuse, delay });
  const started = gen.start({ cwd, prompt: WORDS, effective: m });
  return { cwd, home, calls, m, fake, id: started.gen_id, started };
}
const base = (s) => ({ cwd: s.cwd, gen: s.id });
const runOpts = (s, extra = {}) => ({ ...base(s), effective: s.m, exec: s.fake.exec, home: s.home, env, ...extra });
async function toRoundOne(s) {
  gen.writeChecklist({ ...base(s), checklist: CHECKLIST });
  gen.confirmChecklist(base(s));
  gen.question({ ...base(s), round: 1, effective: s.m });
  return gen.runRound(runOpts(s, { round: 1, consent: true }));
}
function judge(s, round, overrides) {
  const blind = gen.blind({ ...base(s), round });
  const state = stateOf(s);
  const file = path.join(s.cwd, `critique-${round}.json`);
  fs.writeFileSync(file, JSON.stringify(critiqueFor(round, blind.labels, state.checklist.items.map((i) => i.id), overrides)));
  const recorded = gen.recordCritique({ ...base(s), round, file });
  const revealed = gen.reveal({ ...base(s), round });
  return { blind, recorded, revealed };
}
// Tests read the state file directly; the module checks the folder is private on every command.
const stateOf = (s) => JSON.parse(fs.readFileSync(path.join(s.cwd, ".ensemble_reviews", "generation", s.id, "state.json"), "utf8"));
const labelOf = (revealed, maker) => Object.entries(revealed.pictures).filter(([, p]) => p.maker === maker).map(([l]) => l);
const refused = (code) => (e) => { assert.equal(e.code, code, `${e.code}: ${e.message}`); return true; };

// ---- step 0 and start ------------------------------------------------------------------------------------
await test("start: records the user's words byte for byte and lists the routable makers", async () => {
  const s = await setup();
  assert.match(s.id, /^gen_\d{14}_[0-9a-f]{8}$/);
  assert.deepEqual(s.started.makers, ["codex", "antigravity", "grok"]);
  const state = gen.readState(base(s));
  assert.deepEqual(state, stateOf(s));
  assert.equal(state.schema, gen.GENERATION_SCHEMA);
  assert.equal(state.user_words.text, WORDS);
  assert.equal(state.user_words.sha256, sha256(Buffer.from(WORDS, "utf8")));
  assert.equal(state.status, "awaiting_checklist");
  const dir = path.join(s.cwd, ".ensemble_reviews", "generation", s.id);
  assert.ok(fs.existsSync(path.join(dir, "state.json")));
  requirePrivateEvidence(dir);
  // A prompt file is read as bytes and kept exactly; a file that is not UTF-8 is refused, not repaired.
  const pf = path.join(s.cwd, "words.txt"); fs.writeFileSync(pf, Buffer.from(WORDS, "utf8"));
  const fromFile = gen.start({ cwd: s.cwd, promptFile: pf, effective: s.m });
  assert.equal(gen.readState({ cwd: s.cwd, gen: fromFile.gen_id }).user_words.sha256, sha256(fs.readFileSync(pf)));
  const bad = path.join(s.cwd, "latin1.txt"); fs.writeFileSync(bad, Buffer.from([0x63, 0x61, 0x66, 0xe9]));
  assert.throws(() => gen.start({ cwd: s.cwd, promptFile: bad, effective: s.m }), refused("MOMM_PROMPT_NOT_UTF8"));
  assert.throws(() => gen.start({ cwd: s.cwd, prompt: "   ", effective: s.m }), refused("MOMM_PROMPT_REQUIRED"));
});

await test("step 0: nothing can make a picture, each blocker named with what clears it, and nothing else happens", async () => {
  const cwd = fresh("cwd");
  const m = matrix([
    { route: "codex", direction: "output", modality: "image_gen", blocker: "reprobe" },
    { route: "antigravity", direction: "output", modality: "image_gen", blocker: "allowlist" },
    { route: "grok", direction: "output", modality: "image_gen", blocker: "probe_failed" },
  ]);
  const out = gen.start({ cwd, prompt: WORDS, effective: m });
  assert.equal(out.step, 0);
  assert.equal(out.status, "nothing_can_make_a_picture");
  assert.match(out.message, /nothing can make a picture/i);
  assert.deepEqual(out.blockers.map((b) => b.route), ["codex", "antigravity", "grok"]);
  for (const b of out.blockers) assert.ok(b.blocker && typeof b.clearing_action === "string" && b.clearing_action.length > 10, `${b.route} names its clearing action`);
  assert.match(out.blockers.find((b) => b.route === "antigravity").clearing_action, /permissions\.allow/);
  assert.equal(out.gen_id, undefined, "no generation is started");
  assert.ok(!fs.existsSync(path.join(cwd, ".ensemble_reviews", "generation")), "nothing is written for a stopped request");
});

// ---- intent checklist -----------------------------------------------------------------------------------
await test("checklist: kinds validated, the user's words untouched, and the user's confirmation required before round 1", async () => {
  const s = await setup();
  assert.throws(() => gen.writeChecklist({ ...base(s), checklist: { items: [{ text: "x", kind: "vibe" }] } }), refused("MOMM_BAD_CHECKLIST"));
  assert.throws(() => gen.writeChecklist({ ...base(s), checklist: { items: [] } }), refused("MOMM_BAD_CHECKLIST"));
  assert.throws(() => gen.writeChecklist({ ...base(s), checklist: { items: [{ text: "  ", kind: "must" }] } }), refused("MOMM_BAD_CHECKLIST"));
  const out = gen.writeChecklist({ ...base(s), checklist: CHECKLIST });
  assert.equal(out.status, "awaiting_user_checklist_confirmation");
  assert.deepEqual(out.items.map((i) => i.id), ["c1", "c2", "c3", "c4", "c5", "c6"]);
  let state = stateOf(s);
  assert.equal(state.user_words.text, WORDS, "the checklist sits beside the words and never replaces them");
  assert.equal(state.checklist.sha256, sha256(JSON.stringify(state.checklist.items)));
  // Before the user confirms: no question, no round.
  assert.throws(() => gen.question({ ...base(s), round: 1, effective: s.m }), refused("MOMM_CHECKLIST_UNCONFIRMED"));
  await assert.rejects(gen.runRound(runOpts(s, { round: 1, consent: true })), refused("MOMM_CHECKLIST_UNCONFIRMED"));
  assert.equal(s.calls.length, 0);
  gen.confirmChecklist(base(s));
  state = stateOf(s);
  assert.equal(state.status, "checklist_confirmed");
  assert.ok(state.checklist.confirmed_at);
  // A correction before round 1 needs a fresh confirmation.
  gen.writeChecklist({ ...base(s), checklist: { items: [...CHECKLIST.items, { text: "Square", kind: "shape" }] } });
  assert.equal(stateOf(s).checklist.confirmed_at, null);
  assert.throws(() => gen.question({ ...base(s), round: 1, effective: s.m }), refused("MOMM_CHECKLIST_UNCONFIRMED"));
});

// ---- consent and the costed question ---------------------------------------------------------------------
await test("round: refused without consent, without a question, or when the question was about different makers; nothing is sent", async () => {
  const s = await setup();
  gen.writeChecklist({ ...base(s), checklist: CHECKLIST });
  gen.confirmChecklist(base(s));
  await assert.rejects(gen.runRound(runOpts(s, { round: 1 })), refused("MOMM_CONSENT_REQUIRED"));
  await assert.rejects(gen.runRound(runOpts(s, { round: 1, consent: "yes" })), refused("MOMM_CONSENT_REQUIRED"));
  await assert.rejects(gen.runRound(runOpts(s, { round: 1, consent: true })), refused("MOMM_QUESTION_REQUIRED"));
  gen.question({ ...base(s), round: 1, effective: s.m, makers: ["codex", "grok"] });
  await assert.rejects(gen.runRound(runOpts(s, { round: 1, consent: true, makers: ["codex", "antigravity", "grok"] })), refused("MOMM_QUESTION_MISMATCH"), "the user was asked about two makers, not three");
  await assert.rejects(gen.runRound(runOpts(s, { round: 1, consent: true, makers: ["codex"] })), refused("MOMM_QUESTION_MISMATCH"));
  await assert.rejects(gen.runRound(runOpts(s, { round: 2, consent: true })), refused("MOMM_ROUND_ORDER"));
  await assert.rejects(gen.runRound(runOpts(s, { round: 1, consent: true, makers: ["codex", "grok"], userNote: "more" })), refused("MOMM_BAD_ROUND"));
  assert.equal(s.calls.length, 0);
});

await test("question: round 1 names every maker and the picture count, and asks for a yes", async () => {
  const s = await setup();
  gen.writeChecklist({ ...base(s), checklist: CHECKLIST });
  gen.confirmChecklist(base(s));
  const q = gen.question({ ...base(s), round: 1, effective: s.m });
  assert.equal(q.pictures, 3);
  assert.deepEqual(q.makers, ["codex", "antigravity", "grok"]);
  assert.match(q.text, /Codex, Antigravity and Grok/);
  assert.match(q.text, /three pictures, one from each/);
  assert.match(q.text, /allowance/);
  assert.match(q.text, /Shall I go ahead\?$/);
  const two = gen.question({ ...base(s), round: 1, effective: s.m, makers: ["codex", "antigravity"] });
  assert.equal(two.text, "I can send your request to Codex and Antigravity now. That makes two pictures, one from each, and uses your allowance on both. Shall I go ahead?");
  assert.throws(() => gen.question({ ...base(s), round: 1, effective: s.m, makers: ["claude"] }), refused("MOMM_MAKER_BLOCKED"));
  const blocked = matrix([{ route: "grok", direction: "output", modality: "image_gen", blocker: "reprobe" }]);
  assert.throws(() => gen.question({ ...base(s), round: 1, effective: blocked, makers: ["grok"] }), refused("MOMM_MAKER_BLOCKED"));
  assert.deepEqual(gen.question({ ...base(s), round: 1, effective: blocked }).makers, ["codex", "antigravity"], "only what is routable at the time");
});

// ---- flow A: round 1 -> blind -> critique -> reveal -> notes round -> combine round -------------------------
// The private-folder checks cost most of a second each on Windows, so the round tests share two flows
// (A and B) instead of starting a fresh generation per test. Each test states what it proves.
// In flow A, Antigravity cannot take a picture in (its image-input cell is blocked).
let A, B;
await test("round 1: every maker receives the user's words unchanged, in parallel, one run each, with provenance", async () => {
  A = await setup({ entries: NO_AGY_INPUT });
  const s = A;
  const out = await toRoundOne(s);
  assert.equal(s.calls.length, 3, "one call per maker; nothing automatic after it");
  assert.ok(s.fake.stats.maxActive >= 2, `makers ran in parallel (max concurrent ${s.fake.stats.maxActive})`);
  for (const c of s.calls) {
    assert.ok(c.prompt.startsWith(WORDS), `${c.route} got the words byte for byte`);
    assert.ok(!c.prompt.includes(gen.NOTES_HEADING) && !c.prompt.includes(gen.USER_NOTE_HEADING), "no notes in round 1");
    assert.equal(c.prompt.slice(WORDS.length, WORDS.length + 2), "\n\n", "the runner's own constant text follows, separated");
  }
  assert.deepEqual(out.entries.map((e) => [e.maker, e.status]), [["codex", "complete"], ["antigravity", "complete"], ["grok", "complete"]]);
  const state = stateOf(s);
  const round = state.rounds["1"];
  assert.equal(round.kind, "first");
  assert.equal(round.consent.generation.given, true);
  assert.equal(round.consent.share_pictures, null);
  assert.equal(round.question_sha256, state.questions["1"].text_sha256);
  for (const e of round.entries) {
    assert.match(e.run_id, /^media_\d{14}_[0-9a-f]{8}$/);
    assert.equal(e.pictures.length, 1);
    const p = e.pictures[0];
    assert.equal(p.sha256, sha256(fs.readFileSync(path.join(s.cwd, p.path))));
    assert.deepEqual(p.provenance.prompt_parts, { user_words_sha256: state.user_words.sha256, checklist_sha256: null, notes_sha256: null, user_note_sha256: null, suggestion_sha256: null });
    assert.deepEqual(p.provenance.reference_images, []);
    assert.equal(p.provenance.route, e.maker); assert.equal(p.provenance.round, 1);
    const report = JSON.parse(fs.readFileSync(path.join(s.cwd, ".ensemble_reviews", "media", e.run_id, "report.json"), "utf8"));
    assert.equal(report.prompt_sha256, sha256(WORDS), "the media report binds the same words");
  }
  assert.equal(state.status, "round_generated");
  await assert.rejects(gen.runRound(runOpts(s, { round: 1, consent: true })), refused("MOMM_ROUND_ORDER"), "a round runs once per consent");
  assert.throws(() => gen.question({ ...base(s), round: 2, effective: s.m }), refused("MOMM_NOT_REVEALED"), "no round 2 before round 1 is judged and revealed");
  assert.equal(s.calls.length, 3);
});

await test("blind: random labels, blind copies only, no route in the output; the map stays in labels/", async () => {
  const s = A;
  const order = [2, 0, 0];
  const b = gen.blind({ ...base(s), round: 1, random: (n) => order.shift() % n });
  assert.deepEqual(b.labels, ["A", "B", "C"]);
  const printed = JSON.stringify(b);
  for (const maker of ["codex", "antigravity", "grok", "media_"]) assert.ok(!printed.includes(maker), `blind output never names ${maker}`);
  const dir = path.join(s.cwd, ".ensemble_reviews", "generation", s.id);
  assert.deepEqual(b.pictures.map((p) => path.basename(p)), ["A.jpg", "B.png", "C.jpg"], "grok, codex, antigravity in the injected order; names carry only the label");
  for (const p of b.pictures) { assert.ok(p.startsWith(`.ensemble_reviews/generation/${s.id}/blind/round-1/`)); assert.ok(fs.existsSync(path.join(s.cwd, p))); }
  const labels = JSON.parse(fs.readFileSync(path.join(dir, "labels", "round-1.json"), "utf8"));
  assert.deepEqual(Object.keys(labels.labels), ["A", "B", "C"]);
  assert.equal(labels.labels.A.maker, "grok", "the injected order put grok first");
  const state = stateOf(s);
  assert.equal(state.rounds["1"].reveal, null);
  assert.ok(!JSON.stringify(state.rounds["1"].blind).includes("grok"), "state records the labels, not the map");
  assert.throws(() => gen.blind({ ...base(s), round: 1 }), refused("MOMM_ALREADY_BLINDED"));
  assert.throws(() => gen.reveal({ ...base(s), round: 1 }), refused("MOMM_CRITIQUE_REQUIRED"), "no reveal before a critique is recorded");
});

await test("critique: every picture, every checklist item, visible evidence for met/partly/missed, letter against spirit, suggestions; saved before reveal", async () => {
  const s = A;
  const labels = stateOf(s).rounds["1"].blind.labels;
  const ids = stateOf(s).checklist.items.map((i) => i.id);
  const file = path.join(s.cwd, "c.json");
  const attempt = (critique) => { fs.writeFileSync(file, JSON.stringify(critique)); return gen.recordCritique({ ...base(s), round: 1, file }); };
  const good = () => critiqueFor(1, labels, ids);
  const bad = [
    ["a missing picture", (c) => { delete c.pictures[labels[0]]; }],
    ["an unknown picture", (c) => { c.pictures.Z = c.pictures[labels[0]]; }],
    ["a missing checklist item", (c) => { delete c.pictures[labels[1]].items[ids[0]]; }],
    ["an unknown checklist item", (c) => { c.pictures[labels[1]].items.c99 = { result: "met", evidence: "x" }; }],
    ["a result outside the vocabulary", (c) => { c.pictures[labels[1]].items[ids[0]] = { result: "looks right", evidence: "x" }; }],
    ["met with no evidence", (c) => { c.pictures[labels[2]].items[ids[0]] = { result: "met" }; }],
    ["partly with blank evidence", (c) => { c.pictures[labels[2]].items[ids[1]] = { result: "partly", evidence: "   " }; }],
    ["missed with no evidence", (c) => { c.pictures[labels[2]].items[ids[2]] = { result: "missed", evidence: "" }; }],
    ["no letter-against-spirit note", (c) => { delete c.pictures[labels[0]].letter_vs_spirit; }],
    ["no suggested rounds array", (c) => { delete c.suggested_rounds; }],
    ["an empty suggestion", (c) => { c.suggested_rounds = ["fine", " "]; }],
    ["a long suggestion", (c) => { c.suggested_rounds = ["x".repeat(500)]; }],
    ["the wrong round", (c) => { c.round = 2; }],
  ];
  for (const [why, mutate] of bad) { const c = good(); mutate(c); assert.throws(() => attempt(c), refused("MOMM_BAD_CRITIQUE"), why); }
  assert.equal(stateOf(s).rounds["1"].critique, null, "a refused critique records nothing");
  const bytes = JSON.stringify(good(), null, 1);
  fs.writeFileSync(file, bytes);
  const at = new Date("2026-09-29T10:00:00.000Z");
  const rec = gen.recordCritique({ ...base(s), round: 1, file, now: () => at });
  assert.equal(rec.critique_sha256, sha256(Buffer.from(bytes)));
  let state = stateOf(s);
  assert.equal(state.rounds["1"].critique.sha256, sha256(Buffer.from(bytes)));
  assert.equal(state.rounds["1"].critique.at, at.toISOString());
  assert.equal(state.rounds["1"].reveal, null, "the hash and time are saved before any reveal");
  assert.throws(() => attempt(good()), refused("MOMM_CRITIQUE_RECORDED"), "one critique per round");
  // Reveal: the map comes out only now, stamped after the critique.
  const revealed = gen.reveal({ ...base(s), round: 1, now: () => new Date("2026-09-29T10:00:01.000Z") });
  A.r1 = revealed;
  state = stateOf(s);
  assert.equal(state.rounds["1"].reveal.critique_sha256, rec.critique_sha256);
  assert.ok(state.rounds["1"].reveal.at > state.rounds["1"].critique.at);
  assert.deepEqual(Object.keys(revealed.pictures).sort(), [...labels].sort());
  assert.deepEqual(Object.values(revealed.pictures).map((p) => p.maker).sort(), ["antigravity", "codex", "grok"]);
  const first = Object.values(state.rounds["1"].reveal.pictures)[0];
  assert.deepEqual(Object.keys(first.critique).sort(), ["cant_tell", "letter_vs_spirit", "met", "missed", "partly"]);
  assert.equal(revealed.recommendation.by, "governor");
  assert.throws(() => gen.recordCritique({ ...base(s), round: 1, file }), refused("MOMM_ALREADY_REVEALED"));
});

await test("round 2: each maker gets the words unchanged, then only its own notes; its own picture attached only when it can take images in", async () => {
  const s = A, r1 = A.r1;
  const before = stateOf(s);
  const q = gen.question({ ...base(s), round: 2, effective: s.m });
  assert.match(q.text, /only my notes on its own picture/);
  assert.match(q.text, /three more pictures/);
  assert.match(q.text, /Codex, Antigravity and Grok/);
  assert.match(q.text, /Antigravity cannot take a picture in/);
  const out = await gen.runRound(runOpts(s, { round: 2, consent: true }));
  const calls = s.calls.slice(3);
  assert.equal(calls.length, 3);
  const state = stateOf(s);
  for (const c of calls) {
    assert.ok(c.prompt.startsWith(`${WORDS}\n\n--- ${gen.NOTES_HEADING}`), `${c.route}: the words byte for byte, then the labelled notes section`);
    const own = labelOf(r1, c.route), others = Object.keys(r1.pictures).filter((l) => !own.includes(l));
    assert.equal(own.length, 1);
    for (const l of own) { assert.ok(c.prompt.includes(`EVID-r1-${l}-c1`), `${c.route} sees its own notes`); assert.ok(c.prompt.includes(`SPIRIT-r1-${l}`)); }
    for (const l of others) assert.ok(!c.prompt.includes(`-r1-${l}-`) && !c.prompt.includes(`SPIRIT-r1-${l}`), `${c.route} never sees notes on picture ${l}`);
    for (const item of CHECKLIST.items) assert.ok(c.prompt.includes(item.text), "the checklist travels with the notes");
    assert.ok(!c.prompt.includes("SUGGEST-r1"), "no suggestion unless the user picked one");
  }
  const byRoute = Object.fromEntries(calls.map((c) => [c.route, c]));
  // Codex can take images in: its own round-1 picture is attached through -i, verified by hash.
  const codexPic = before.rounds["1"].entries.find((e) => e.maker === "codex").pictures[0];
  const iArgs = byRoute.codex.args.flatMap((a, k) => (a === "-i" ? [byRoute.codex.args[k + 1]] : []));
  assert.equal(iArgs.length, 1);
  assert.equal(sha256(fs.readFileSync(iArgs[0])), codexPic.sha256, "codex is shown its own picture, byte for byte");
  // Grok takes its own picture by reference inside its work directory.
  const grokPic = before.rounds["1"].entries.find((e) => e.maker === "grok").pictures[0];
  const grokRef = byRoute.grok.prompt.split("\n").find((l) => /[\\/]in[\\/]01-/.test(l));
  assert.ok(grokRef, "grok's prompt references its staged picture");
  assert.equal(sha256(fs.readFileSync(grokRef.trim())), grokPic.sha256);
  // Antigravity cannot: notes only, and no picture reference at all.
  assert.ok(!/[\\/]in[\\/]01-/.test(byRoute.antigravity.prompt));
  assert.ok(byRoute.antigravity.prompt.includes("notes only"), "the maker is told it receives notes only");
  const entries = Object.fromEntries(state.rounds["2"].entries.map((e) => [e.maker, e]));
  assert.equal(entries.antigravity.image_input, false); assert.equal(entries.antigravity.notes_only, true);
  assert.equal(entries.codex.image_input, true);
  assert.deepEqual(entries.codex.pictures[0].provenance.reference_images.map((r) => r.sha256), [codexPic.sha256]);
  assert.deepEqual(entries.antigravity.pictures[0].provenance.reference_images, []);
  for (const e of Object.values(entries)) {
    const parts = e.pictures[0].provenance.prompt_parts;
    assert.equal(parts.user_words_sha256, state.user_words.sha256);
    assert.equal(parts.checklist_sha256, state.checklist.sha256);
    assert.equal(parts.notes_sha256, sha256(e.notes_text));
    assert.equal(parts.user_note_sha256, null);
  }
  assert.equal(out.round, 2);
  assert.equal(state.rounds["2"].kind, "notes");
});

await test("combine: needs --share-all as its own consent; every picture goes only to makers that can take images in", async () => {
  const s = A;
  judge(s, 2);
  assert.equal(s.calls.length, 6);
  const q = gen.question({ ...base(s), round: 3, effective: s.m, combine: true });
  assert.match(q.text, /every picture is shared with every provider taking part/);
  assert.match(q.text, /Shall I do that\?/);
  assert.match(q.text, /Antigravity cannot take pictures in and gets my notes only/);
  await assert.rejects(gen.runRound(runOpts(s, { round: 3, consent: true, combine: true })), refused("MOMM_SHARE_CONSENT_REQUIRED"));
  await assert.rejects(gen.runRound(runOpts(s, { round: 3, consent: true, shareAll: true })), refused("MOMM_BAD_ROUND"), "--share-all belongs to a combine round only");
  await assert.rejects(gen.runRound(runOpts(s, { round: 3, consent: true })), refused("MOMM_QUESTION_MISMATCH"), "the user was asked about a combine round");
  assert.equal(s.calls.length, 6, "no picture shared without its own yes");
  await gen.runRound(runOpts(s, { round: 3, consent: true, combine: true, shareAll: true }));
  const calls = s.calls.slice(6), byRoute = Object.fromEntries(calls.map((c) => [c.route, c]));
  assert.equal(calls.length, 3);
  const state = stateOf(s);
  const all = ["1", "2"].flatMap((r) => state.rounds[r].entries.flatMap((e) => e.pictures.map((p) => p.sha256)));
  assert.equal(all.length, 6);
  const iArgs = byRoute.codex.args.flatMap((a, k) => (a === "-i" ? [byRoute.codex.args[k + 1]] : []));
  assert.deepEqual(iArgs.map((f) => sha256(fs.readFileSync(f))).sort(), [...all].sort(), "codex sees every picture so far");
  const grokRefs = byRoute.grok.prompt.split("\n").filter((l) => /[\\/]in[\\/]0\d-/.test(l));
  assert.deepEqual(grokRefs.map((f) => sha256(fs.readFileSync(f.trim()))).sort(), [...all].sort(), "grok sees every picture so far");
  assert.ok(!/[\\/]in[\\/]0\d-/.test(byRoute.antigravity.prompt), "antigravity gets no picture");
  for (const c of calls) {
    assert.ok(c.prompt.startsWith(`${WORDS}\n\n--- ${gen.COMBINE_HEADING}`));
    for (const r of [1, 2]) for (const l of Object.keys(state.rounds[String(r)].reveal.pictures)) assert.ok(c.prompt.includes(`SPIRIT-r${r}-${l}`), `${c.route} sees the notes on round ${r} picture ${l}`);
  }
  const round = state.rounds["3"];
  assert.equal(round.kind, "combine");
  assert.equal(round.consent.share_pictures.given, true);
  assert.ok(round.consent.share_pictures.at);
  const entries = Object.fromEntries(round.entries.map((e) => [e.maker, e]));
  assert.equal(entries.antigravity.notes_only, true);
  assert.deepEqual(entries.antigravity.pictures[0].provenance.reference_images, []);
  assert.equal(entries.codex.pictures[0].provenance.reference_images.length, 6);
});

// ---- flow B: a refusal, a changed critique, a changed picture, a suggestion and the user's addition --------
await test("refusal: a maker that declines is recorded with the provider's reason; the words are never rephrased or retried", async () => {
  B = await setup({ refuse: { codex: "I can't create that picture: it shows a real public building defaced." } });
  const s = B;
  const out = await toRoundOne(s);
  const codexCalls = s.calls.filter((c) => c.route === "codex");
  assert.equal(codexCalls.length, 1, "exactly one attempt");
  assert.ok(codexCalls[0].prompt.startsWith(WORDS));
  const e = out.entries.find((x) => x.maker === "codex");
  assert.equal(e.status, "failed");
  assert.equal(e.reason.failure, "no_new_output");
  assert.match(e.reason.provider_reason, /I can't create that picture/);
  assert.deepEqual(e.pictures, []);
  assert.deepEqual(out.entries.filter((x) => x.status === "complete").map((x) => x.maker), ["antigravity", "grok"]);
  assert.equal(s.calls.length, 3, "no second attempt for anyone");
  const b = gen.blind({ ...base(s), round: 1 });
  assert.equal(b.labels.length, 2, "only real pictures are judged");
});

await test("critique: refused for a round whose labels were already revealed; reveal refused if the saved critique changed", async () => {
  const s = B;
  const { labels } = stateOf(s).rounds["1"].blind;
  const ids = stateOf(s).checklist.items.map((i) => i.id);
  const file = path.join(s.cwd, "c.json");
  fs.writeFileSync(file, JSON.stringify(critiqueFor(1, labels, ids, { recommendation: "Picture <b>A</b> is closest." })));
  gen.recordCritique({ ...base(s), round: 1, file });
  const saved = path.join(s.cwd, ".ensemble_reviews", "generation", s.id, "critiques", "round-1.json");
  const original = fs.readFileSync(saved);
  fs.writeFileSync(saved, Buffer.concat([original, Buffer.from(" ")]));
  assert.throws(() => gen.reveal({ ...base(s), round: 1 }), refused("MOMM_CRITIQUE_CHANGED"));
  fs.writeFileSync(saved, original);
  gen.reveal({ ...base(s), round: 1 });
  // A critique arriving after the labels are out is refused even if the state forgot the first one.
  const stateFile = path.join(s.cwd, ".ensemble_reviews", "generation", s.id, "state.json");
  const kept = fs.readFileSync(stateFile);
  const st = JSON.parse(kept.toString("utf8")); st.rounds["1"].critique = null; fs.writeFileSync(stateFile, JSON.stringify(st));
  assert.throws(() => gen.recordCritique({ ...base(s), round: 1, file }), refused("MOMM_ALREADY_REVEALED"));
  fs.writeFileSync(stateFile, kept);
});

await test("round 2: a maker's own picture is attached only if its bytes still match the recorded hash", async () => {
  const s = B;
  const pic = stateOf(s).rounds["1"].entries.find((e) => e.maker === "grok").pictures[0];
  const file = path.join(s.cwd, pic.path), original = fs.readFileSync(file);
  fs.writeFileSync(file, uniqueJpeg("tampered"));
  gen.question({ ...base(s), round: 2, effective: s.m, makers: ["grok"] });
  await assert.rejects(gen.runRound(runOpts(s, { round: 2, consent: true })), refused("MOMM_PICTURE_CHANGED"));
  assert.equal(s.calls.length, 3, "nothing is sent when a reference picture changed");
  assert.equal(stateOf(s).rounds["2"], undefined, "and the round did not start");
  fs.writeFileSync(file, original);
});

await test("suggestion and user note: the pick is carried as the governor's notes, the user's addition in its own section, never merged", async () => {
  const s = B;
  const NOTE = "Make it  rain, please.\r\nAnd keep \"entrepreneuria\" red.";
  assert.throws(() => gen.question({ ...base(s), round: 2, effective: s.m, suggestion: 9 }), refused("MOMM_BAD_SUGGESTION"));
  assert.throws(() => gen.question({ ...base(s), round: 2, effective: s.m, makers: ["codex"] }), refused("MOMM_NO_PREVIOUS_PICTURE"), "codex refused in round 1, so it has no picture to take notes on");
  const q = gen.question({ ...base(s), round: 2, effective: s.m, makers: ["grok"], suggestion: 1, userNote: NOTE });
  assert.match(q.text, /Grok/); assert.match(q.text, /one more picture/);
  assert.match(q.text, /SUGGEST-r1-1/); assert.match(q.text, /your own words/i);
  await assert.rejects(gen.runRound(runOpts(s, { round: 2, consent: true, makers: ["grok"], suggestion: 1 })), refused("MOMM_QUESTION_MISMATCH"), "the user note is part of what was asked");
  await gen.runRound(runOpts(s, { round: 2, consent: true, makers: ["grok"], suggestion: 1, userNote: NOTE }));
  const c = s.calls.at(-1);
  assert.equal(s.calls.length, 4);
  assert.equal(c.route, "grok");
  assert.ok(c.prompt.startsWith(`${WORDS}\n\n--- ${gen.NOTES_HEADING}`));
  const reviewerStart = c.prompt.indexOf(gen.NOTES_HEADING), userStart = c.prompt.indexOf(gen.USER_NOTE_HEADING);
  assert.ok(reviewerStart > 0 && userStart > reviewerStart, "the user's section is separate and after the reviewer's");
  const reviewer = c.prompt.slice(reviewerStart, userStart), user = c.prompt.slice(userStart);
  assert.ok(reviewer.includes("SUGGEST-r1-1"), "the chosen suggestion is in the governor's notes");
  assert.ok(!reviewer.includes(NOTE) && !reviewer.includes("rain"), "the user's words are not merged into the governor's");
  assert.ok(user.includes(`\n${NOTE}\n`), "the user's addition travels byte for byte");
  assert.ok(!user.includes("SUGGEST-r1-1"));
  const e = stateOf(s).rounds["2"].entries[0];
  assert.equal(e.pictures[0].provenance.prompt_parts.user_note_sha256, sha256(NOTE));
  assert.equal(e.pictures[0].provenance.prompt_parts.suggestion_sha256, sha256("SUGGEST-r1-1: put the clock tower in the middle (all)"));
  assert.equal(e.suggestion.text, "SUGGEST-r1-1: put the clock tower in the middle (all)");
  assert.equal(e.suggestion.by, "governor");
  assert.equal(e.user_note.by, "user");
});

await test("blocked: a maker whose cell became blocked after the question is recorded with its clearing action; the rest still run", async () => {
  const s = await setup();
  gen.writeChecklist({ ...base(s), checklist: CHECKLIST });
  gen.confirmChecklist(base(s));
  gen.question({ ...base(s), round: 1, effective: s.m, makers: ["codex", "grok"] });
  const later = matrix([{ route: "grok", direction: "output", modality: "image_gen", blocker: "zdr" }]);
  const out = await gen.runRound(runOpts(s, { round: 1, consent: true, effective: later }));
  const g = out.entries.find((e) => e.maker === "grok");
  assert.equal(g.status, "blocked");
  assert.equal(g.reason.blocker, "zdr");
  assert.match(g.reason.clearing_action, /\/privacy/);
  assert.equal(s.calls.filter((c) => c.route === "grok").length, 0);
  assert.equal(s.calls.length, 1);
});

// ---- gallery -------------------------------------------------------------------------------------------------
await test("gallery: every picture with its provenance and an AI-generated label; makers withheld until reveal; local only", async () => {
  // Flow A: rounds 1 and 2 revealed, round 3 labelled but not yet judged.
  const s = A;
  gen.blind({ ...base(s), round: 3 });
  const out = gen.gallery(base(s));
  const dir = path.join(s.cwd, ".ensemble_reviews", "generation", s.id);
  assert.equal(out.path, `.ensemble_reviews/generation/${s.id}/gallery.html`);
  const html = fs.readFileSync(path.join(dir, "gallery.html"), "utf8");
  const state = stateOf(s);
  assert.match(html, /AI-generated/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /never published/i);
  assert.ok(!html.includes(s.cwd) && !html.includes(s.cwd.replace(/\\/g, "/")), "no absolute paths");
  assert.ok(!/src="[A-Za-z]:|src="\//.test(html));
  assert.ok(html.includes("entrepreneuria"), "the user's words are readable");
  const [r1, r2, r3] = html.split(/<section class="round"/).slice(1);
  for (const [section, round] of [[r1, "1"], [r2, "2"]]) {
    for (const e of state.rounds[round].entries) {
      const p = e.pictures[0];
      const rel = path.relative(dir, path.join(s.cwd, p.path)).split(path.sep).join("/");
      assert.ok(section.includes(`src="${rel}"`), `round ${round} shows ${e.maker}'s picture by relative path`);
      assert.ok(section.includes(`(${e.maker})`));
      assert.ok(section.includes(p.sha256.slice(0, 12)));
      assert.ok(section.includes(p.provenance.prompt_parts.user_words_sha256.slice(0, 12)));
    }
    assert.ok(section.includes(`EVID-r${round}-`), "the critique per picture");
    assert.ok(section.includes(`SUGGEST-r${round}-1`), "suggested rounds");
    assert.match(section, /governor's judgement against the checklist, not a measurement/);
  }
  assert.ok(r2.includes("notes only"), "a maker that could not take pictures in is marked");
  assert.ok(r2.includes("SPIRIT-r1-"), "the notes each maker received are readable");
  for (const maker of ["codex", "grok", "antigravity", "media_"]) assert.ok(!r3.includes(maker), `round 3 withholds ${maker} until the critique is recorded`);
  assert.match(r3, /withheld/);
  assert.ok(r3.includes("blind/round-3/A."), "round 3 shows the blind copies");
  // Flow B: a refusal is shown with the provider's reason; an escaped recommendation.
  const sb = B;
  const outB = gen.gallery(base(sb));
  const htmlB = fs.readFileSync(path.join(sb.cwd, outB.path), "utf8");
  const [b1] = htmlB.split(/<section class="round"/).slice(1);
  assert.match(b1, /I can&#39;t create that picture|I can't create that picture/, "a refusal is shown with its reason");
  assert.ok(b1.includes("Picture &lt;b&gt;A&lt;/b&gt; is closest.") && !htmlB.includes("<b>A"), "nothing the governor or a provider wrote is rendered as markup");
});

// ---- CLI ---------------------------------------------------------------------------------------------------
await test("CLI: round without --consent refuses before contacting anything; checklist, confirmation and help work", async () => {
  const s = await setup();
  const cli = (...args) => spawnSync(process.execPath, [path.join(here, "generation-rounds.mjs"), ...args], { cwd: s.cwd, encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_UPDATE_CHECK: "1" } });
  const help = cli("--help");
  assert.equal(help.status, 0); assert.match(help.stderr, /question/); assert.match(help.stderr, /--share-all/);
  const noConsent = cli("round", "--gen", s.id, "--round", "1");
  assert.equal(noConsent.status, 2, noConsent.stderr);
  assert.match(noConsent.stderr, /consent/i);
  const badId = cli("confirm-checklist", "--gen", "../../etc");
  assert.notEqual(badId.status, 0);
  const file = path.join(s.cwd, "checklist.json"); fs.writeFileSync(file, JSON.stringify(CHECKLIST));
  const cl = cli("checklist", "--gen", s.id, "--file", file);
  assert.equal(cl.status, 0, cl.stderr);
  assert.equal(JSON.parse(cl.stdout).status, "awaiting_user_checklist_confirmation");
  assert.ok(cl.stderr.trim().length > 0, "a short human line on stderr");
  const cf = cli("confirm-checklist", "--gen", s.id);
  assert.equal(cf.status, 0, cf.stderr);
  assert.equal(JSON.parse(cf.stdout).status, "checklist_confirmed");
  assert.equal(s.calls.length, 0);
});

// 1.17 A7: with MOMM_EVIDENCE_HOME the whole flow (state, media, blind copies, critique, gallery) lives in
// the project's folder under that home, with the same logical .ensemble_reviews/... paths, and nothing
// is written inside the project. The fake provider env carries no setting: the location follows this
// process's own setting, never the environment handed to a provider.
await test("evidence home: state, pictures, blind copies, critique and gallery live under MOMM_EVIDENCE_HOME", async () => {
  const previous = process.env.MOMM_EVIDENCE_HOME, evidenceHome = fresh("evidence-home");
  process.env.MOMM_EVIDENCE_HOME = evidenceHome;
  try {
    const s = await setup();
    const real = process.platform === "win32" ? fs.realpathSync.native(s.cwd) : fs.realpathSync(s.cwd);
    const folder = path.join(evidenceHome, sha256(Buffer.from(real, "utf8")).slice(0, 32));
    const at = (logical) => path.join(folder, ...logical.split("/").slice(1));
    assert.ok(fs.existsSync(path.join(folder, "generation", s.id, "state.json")), "state under the evidence home");
    requirePrivateEvidence(path.join(folder, "generation", s.id));
    await toRoundOne(s);
    // judge() reads the in-project state file directly; here the state is read through the module.
    const blind = gen.blind({ ...base(s), round: 1 });
    const critiqueFile = path.join(s.cwd, "critique-1.json");
    fs.writeFileSync(critiqueFile, JSON.stringify(critiqueFor(1, blind.labels, gen.readState(base(s)).checklist.items.map((i) => i.id))));
    const recorded = gen.recordCritique({ ...base(s), round: 1, file: critiqueFile });
    gen.reveal({ ...base(s), round: 1 });
    for (const p of blind.pictures) { assert.ok(p.startsWith(`.ensemble_reviews/generation/${s.id}/blind/round-1/`), p); assert.ok(fs.existsSync(at(p)), p); }
    assert.ok(recorded.path === undefined || fs.existsSync(at(recorded.path)));
    const state = JSON.parse(fs.readFileSync(path.join(folder, "generation", s.id, "state.json"), "utf8"));
    const pictures = state.rounds["1"].entries.flatMap((e) => e.pictures);
    assert.ok(pictures.length > 0, "the round made pictures");
    for (const p of pictures) { assert.ok(p.path.startsWith(".ensemble_reviews/media/"), p.path); assert.ok(fs.existsSync(at(p.path)), `picture ${p.path} under the evidence home`); }
    const out = gen.gallery(base(s));
    assert.equal(out.path, `.ensemble_reviews/generation/${s.id}/gallery.html`);
    const html = fs.readFileSync(at(out.path), "utf8");
    assert.ok(html.includes("AI-generated") && !html.includes("not shown, its bytes no longer match"), "gallery shows the pictures it can verify");
    assert.ok(!fs.existsSync(path.join(s.cwd, ".ensemble_reviews")), "nothing inside the project");
  } finally { if (previous === undefined) delete process.env.MOMM_EVIDENCE_HOME; else process.env.MOMM_EVIDENCE_HOME = previous; }
});

// Gate-3 (1.17.0 self-review, image-input-not-bound and grok suggestions 26 and 28).
await test("round 2: who is sent pictures is what the question said, even when the matrix changed after it", async () => {
  const s = await setup({ entries: NO_AGY_INPUT });
  const r1 = await toRoundOne(s);
  assert.equal(r1.entries.length, 3);
  judge(s, 1);
  const q = gen.question({ ...base(s), round: 2, effective: s.m });
  assert.deepEqual([q.image_input.antigravity, q.image_input.codex], [false, true]);
  // Afterwards Antigravity could take a picture in and Codex no longer can.
  const later = matrix([{ route: "codex", direction: "input", modality: "image", blocker: "probe_failed" }]);
  const before = s.calls.length;
  await gen.runRound(runOpts(s, { round: 2, consent: true, effective: later }));
  const entries = Object.fromEntries(stateOf(s).rounds["2"].entries.map((e) => [e.maker, e]));
  const calls = Object.fromEntries(s.calls.slice(before).map((c) => [c.route, c]));
  assert.equal(entries.antigravity.image_input, false, "notes only, as the user was told");
  assert.deepEqual(entries.antigravity.reference_images, []);
  assert.ok(calls.antigravity && !/[\\/]in[\\/]01-/.test(calls.antigravity.prompt), "no picture reaches Antigravity");
  assert.equal(entries.codex.status, "blocked", "Codex was promised its picture and cannot take it: blocked, not a different round");
  assert.ok(!calls.codex, "nothing is sent to Codex");
  assert.equal(entries.grok.status, "complete");
});
await test("combine: one previous picture is described as one, in the question and in the prompt", async () => {
  const s = await setup();
  gen.writeChecklist({ ...base(s), checklist: CHECKLIST });
  gen.confirmChecklist(base(s));
  gen.question({ ...base(s), round: 1, effective: s.m, makers: ["codex"] });
  await gen.runRound(runOpts(s, { round: 1, consent: true }));
  judge(s, 1);
  const q = gen.question({ ...base(s), round: 2, effective: s.m, combine: true, makers: ["codex"] });
  assert.match(q.text, /Codex will receive the one picture so far\./);
  assert.doesNotMatch(q.text, /all 1 pictures/);
  await gen.runRound(runOpts(s, { round: 2, consent: true, combine: true, shareAll: true }));
  assert.match(s.calls.at(-1).prompt, /The one picture so far is attached as an input image: round 1 picture A\. Make one final picture that combines the best of it\./);
  // Gate-3 coordinator note (docs s:92830fbf): no sideways scroll on a narrow phone (checked at 300 px in a
  // browser): grid columns never exceed the page, and the long generation id wraps.
  const html = fs.readFileSync(path.join(s.cwd, gen.gallery(base(s)).path), "utf8");
  assert.ok(html.includes("grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr))"), "grid columns shrink to the page");
  assert.match(html, /body\{[^}]*overflow-wrap:anywhere/, "long unbroken words wrap");
});
await test("CLI help: blind makes one lettered copy per picture, not a fixed A, B, C", () => {
  const r = spawnSync(process.execPath, [path.join(here, "generation-rounds.mjs"), "--help"], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  assert.equal(r.status, 0);
  const line = r.stderr.split("\n").find((l) => /^\s+blind /.test(l));
  assert.match(line, /one lettered copy per picture \(A, B, and so on\) in a random order/);
  assert.ok(!line.includes("A, B, C"));
});

await test("source: the rounds module never calls a model to critique and never publishes", () => {
  const src = fs.readFileSync(path.join(here, "generation-rounds.mjs"), "utf8");
  assert.ok(!/\bfetch\(|https?:\/\/(?!www\.w3\.org)/.test(src), "no network");
  // Generation reaches a provider only through modality.run (with the same exec the modality runner
  // uses); the critique is only ever read from the governor's file.
  assert.ok(!/runProcess|child_process|spawn\(|spawnSync/.test(src.replace(/\/\/.*$/gm, "")), "no process launch of its own");
  assert.ok(/await run\(/.test(src), "pictures are made through modality.run");
});

fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
const summary = { passed: passed.length, failed: failures.length, failures };
console.log(JSON.stringify(summary, null, 2));
process.exitCode = failures.length ? 1 : 0;
