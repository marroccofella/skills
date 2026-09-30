#!/usr/bin/env node
// MOMM 1.17 E1 to E3 — guided image generation, one round at a time.
//
// A small state machine kept in the private evidence folder,
// .ensemble_reviews/generation/<gen_id>/state.json (schema momm-generation/1):
//
//   start              the user's words, stored byte for byte (sha256), and which makers can draw;
//                      if none can, step 0: "nothing can make a picture", each blocker with what clears it.
//   checklist          the governor's intent checklist, written beside the words, never over them.
//   confirm-checklist  the user's yes to the checklist (a check on meaning, not on spending).
//   question           the costed question for one round: it names the makers and the picture count.
//   round --consent    one round, every maker in parallel, through modality.mjs `run` (the only way a
//                      provider is reached). Round 1 sends the user's words unchanged. A notes round
//                      sends the words unchanged, then a labelled section with the checklist and the
//                      governor's notes on THAT maker's own previous picture (attached by hash when the
//                      maker can take images in). A combine round needs --share-all, its own yes.
//   blind              copies the round's pictures to blind/round-<n>/A.<ext>, B, ... in a random order
//                      and keeps the map in labels/round-<n>.json; prints only the blind paths.
//   critique           validates the governor's blind critique and records its sha256 and time BEFORE
//                      any reveal; refused for a round whose labels are out.
//   reveal             the map, only after the critique hash is recorded.
//   gallery            a private local HTML page of every round, picture, provenance and critique.
//
// The governor is a human-facing agent and writes every critique itself; this module never asks a
// model to judge anything and never publishes anything. It is not a review: it produces no findings,
// no quorum and no dispositions. Every refusal by a maker is recorded with the provider's reason, and
// the user's words are never rephrased or retried to get past it. No round starts without --consent,
// and each consent covers exactly one round (a round number runs once, in order).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { plan, run, hashFile, BINARY } from "./modality.mjs";
import { preparePrivateEvidence, requirePrivateEvidence } from "./evidence-permissions.mjs";
import { evidenceLocation, evidenceFile, recordEvidenceProject, EVIDENCE_FOLDER } from "./evidence-location.mjs";
import { loadBaseline, effective as effectiveMatrix, levelAction, sha256 } from "./capabilities.mjs";
// Windows launch guard (see launch-guard.mjs): a bare command launched without a shell is looked up in
// THIS process's current directory before PATH unless this process carries the variable. Kept inline so
// a script copied on its own still runs.
if (process.platform === "win32" && !process.env.NoDefaultCurrentDirectoryInExePath) process.env.NoDefaultCurrentDirectoryInExePath = "1";

export const GENERATION_SCHEMA = "momm-generation/1";
export const LABELS_SCHEMA = "momm-generation-labels/1";
export const GENERATION_DIR = path.join(".ensemble_reviews", "generation");
export const CHECKLIST_KINDS = Object.freeze(["must", "must_not", "style", "text_in_image", "shape"]);
export const RESULTS = Object.freeze(["met", "partly", "missed", "cant_tell"]);
export const NOTES_HEADING = "Notes from the reviewer of your previous picture";
export const COMBINE_HEADING = "Notes from the reviewer on every picture so far";
export const USER_NOTE_HEADING = "More words from the user for this round";
export const SUGGESTION_MAX_CHARS = 280;
export const REFUSAL_CODES = Object.freeze(["MOMM_CONSENT_REQUIRED", "MOMM_SHARE_CONSENT_REQUIRED", "MOMM_QUESTION_REQUIRED", "MOMM_QUESTION_MISMATCH", "MOMM_CHECKLIST_UNCONFIRMED", "MOMM_CHECKLIST_LOCKED", "MOMM_ROUND_ORDER", "MOMM_NOT_REVEALED", "MOMM_BAD_ROUND", "MOMM_BAD_CHECKLIST", "MOMM_BAD_CRITIQUE", "MOMM_BAD_SUGGESTION", "MOMM_MAKER_BLOCKED", "MOMM_NO_MAKERS", "MOMM_NO_PREVIOUS_PICTURE", "MOMM_PICTURE_CHANGED", "MOMM_CRITIQUE_CHANGED", "MOMM_LABELS_CHANGED", "MOMM_CRITIQUE_REQUIRED", "MOMM_CRITIQUE_RECORDED", "MOMM_ALREADY_REVEALED", "MOMM_ALREADY_BLINDED", "MOMM_NOT_BLINDED", "MOMM_NO_PICTURES", "MOMM_ROUND_NOT_FINISHED", "MOMM_NO_ROUND", "MOMM_PROMPT_REQUIRED", "MOMM_PROMPT_NOT_UTF8", "MOMM_NO_GENERATION", "MOMM_USAGE"]);
const NAMES = Object.freeze({ codex: "Codex", claude: "Claude", antigravity: "Antigravity", gemini: "Gemini", copilot: "GitHub Copilot", grok: "Grok" });
const NUMBER = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const RESULT_WORDS = Object.freeze({ met: "met", partly: "partly met", missed: "missed", cant_tell: "can't tell" });
const ROUTE_ORDER = Object.keys(BINARY);
const GEN_ID = /^gen_\d{14}_[0-9a-f]{8}$/;
const fail = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const posix = (p) => p.replace(/\\/g, "/");
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clean = (s, n = 400) => String(s ?? "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").slice(0, n);
const nonEmpty = (s) => typeof s === "string" && s.trim().length > 0;
const stamp = (now) => (typeof now === "function" ? now() : now ? new Date(now) : new Date()).toISOString();
const nameOf = (route) => NAMES[route] ?? route;
const listNames = (routes) => { const n = routes.map(nameOf); return n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`; };
const count = (n) => NUMBER[n] ?? String(n);
const byRouteOrder = (routes) => [...new Set(routes)].sort((a, b) => (ROUTE_ORDER.indexOf(a) + 1 || 99) - (ROUTE_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
const labelName = (i) => (i < 26 ? String.fromCharCode(65 + i) : `${labelName(Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function writePrivate(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try { fs.writeFileSync(tmp, data, { mode: 0o600, flag: "wx" }); fs.renameSync(tmp, file); }
  catch (e) { try { fs.unlinkSync(tmp); } catch { /* never created */ } throw e; }
}
// The project's resolved evidence folder (1.17 A7): <cwd>/.ensemble_reviews unless MOMM_EVIDENCE_HOME is
// set. Recorded paths keep their logical ".ensemble_reviews/..." spelling in both modes; ofLogical and
// toLogical translate them. The setting is this process's own, never a provider's environment.
const evidenceOf = (cwd) => evidenceLocation({ cwd, env: process.env });
const ofLogical = (cwd, rel) => evidenceFile(rel, { root: cwd, dir: evidenceOf(cwd).dir });
const toLogical = (cwd, abs) => posix(path.join(EVIDENCE_FOLDER, path.relative(evidenceOf(cwd).dir, abs)));
function genDirOf(cwd, gen) {
  if (typeof gen !== "string" || !GEN_ID.test(gen)) throw fail(`Refused: ${JSON.stringify(String(gen ?? ""))} is not a generation id (gen_<14 digits>_<8 hex>)`, "MOMM_USAGE");
  return path.join(evidenceOf(cwd).dir, "generation", gen);
}
// Every command reads the state after checking that the folder is private, and writes it back with no
// provider call or await in between (a round re-checks after its providers return).
function open({ cwd = process.cwd(), gen }) {
  const dir = genDirOf(cwd, gen);
  if (!fs.existsSync(path.join(dir, "state.json"))) throw fail(`Refused: no generation ${gen} in this project`, "MOMM_NO_GENERATION");
  requirePrivateEvidence(dir);
  const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  if (state?.schema !== GENERATION_SCHEMA || state.gen_id !== gen) throw fail(`Refused: ${gen}/state.json is not a ${GENERATION_SCHEMA} state for this generation`, "MOMM_NO_GENERATION");
  return { dir, state };
}
const save = (dir, state) => writePrivate(path.join(dir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
export function readState(options) { return open(options).state; }
function toRound(round) {
  const n = Number(round);
  if (!Number.isInteger(n) || n < 1) throw fail(`Refused: --round must be a whole number from 1 (got ${JSON.stringify(round)})`, "MOMM_BAD_ROUND");
  return n;
}
function roundOf(state, round) {
  const n = toRound(round), r = state.rounds?.[String(n)];
  if (!r) throw fail(`Refused: round ${n} has not run`, "MOMM_NO_ROUND");
  return { n, r };
}
// A picture path recorded in state must name a file under this project's .ensemble_reviews/media.
function mediaFile(cwd, rel) {
  const abs = path.resolve(ofLogical(cwd, String(rel))), inside = path.relative(path.join(evidenceOf(cwd).dir, "media"), abs);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) throw fail(`Refused: ${rel} is outside this project's media folder`, "MOMM_PICTURE_CHANGED");
  return abs;
}
function verifiedPicture(cwd, picture) {
  const abs = mediaFile(cwd, picture.path);
  let digest = null; try { digest = hashFile(abs); } catch { digest = null; }
  if (digest !== picture.sha256) throw fail(`Refused: picture ${picture.path} no longer matches its recorded sha256; nothing was sent`, "MOMM_PICTURE_CHANGED");
  return abs;
}

// ---- who can draw ----------------------------------------------------------------------------------------
// A maker is a route whose text-in and image-generation cells are routable (no blocker, level at least
// documented), exactly as the modality planner decides it.
export function makersOf(matrix) {
  const step = plan(matrix, { output: ["image_gen"] }).steps[0];
  return {
    routable: byRouteOrder(step.candidates.filter((c) => c.routable).map((c) => c.route)),
    blocked: step.candidates.filter((c) => !c.routable).map((c) => ({ route: c.route, level: c.level, blocker: c.blocker, clearing_action: c.clearing_action ?? levelAction(c.level) ?? `Re-probe the route: node momm/scripts/probes.mjs ${c.route} --modalities`, reason: c.blocker ? `blocked by ${c.blocker}` : `level ${c.level} is below documented` })),
  };
}
export function takesImagesIn(matrix, route) {
  if (!matrix?.routes?.[route]) return false;
  const c = plan({ routes: { [route]: matrix.routes[route] } }, { input: ["text", "image"], output: ["image_gen"] }).steps[0].candidates[0];
  return !!c?.routable;
}

// ---- start ------------------------------------------------------------------------------------------------
export function start({ cwd = process.cwd(), prompt, promptFile, effective, home = os.homedir(), now } = {}) {
  let buffer = null;
  if (promptFile != null) buffer = fs.readFileSync(promptFile);
  else if (typeof prompt === "string") buffer = Buffer.from(prompt, "utf8");
  const text = buffer?.toString("utf8") ?? "";
  if (!text.trim()) throw fail("Refused: there are no words to send; pass --prompt <text> or --prompt-file <file> with the user's own words.", "MOMM_PROMPT_REQUIRED");
  if (!Buffer.from(text, "utf8").equals(buffer)) throw fail("Refused: the prompt file is not valid UTF-8. MOMM never repairs or rewrites the user's words; save them as UTF-8 and start again.", "MOMM_PROMPT_NOT_UTF8");
  const matrix = effective ?? effectiveMatrix({ home, baseline: loadBaseline() });
  const makers = makersOf(matrix);
  if (!makers.routable.length) {
    return {
      step: 0, status: "nothing_can_make_a_picture",
      message: makers.blocked.length ? "Nothing can make a picture right now, so MOMM stops here before asking anything else. What clears each blocker:" : "Nothing can make a picture: no route has an image-generation path.",
      blockers: makers.blocked,
    };
  }
  const evidenceAt = evidenceOf(cwd);
  preparePrivateEvidence(evidenceAt.dir); recordEvidenceProject(evidenceAt);
  const root = path.join(evidenceAt.dir, "generation");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const at = stamp(now);
  let gen_id, dir;
  for (;;) {
    gen_id = `gen_${at.replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomBytes(4).toString("hex")}`;
    dir = path.join(root, gen_id);
    try { fs.mkdirSync(dir, { mode: 0o700 }); break; } catch (e) { if (e?.code !== "EEXIST") throw e; }
  }
  requirePrivateEvidence(dir);
  const state = {
    schema: GENERATION_SCHEMA, gen_id, created_at: at, status: "awaiting_checklist", current_round: 0,
    user_words: { text, sha256: sha256(buffer), bytes: buffer.length },
    makers_at_start: makers.routable, blocked_at_start: makers.blocked,
    checklist: null, questions: {}, rounds: {},
  };
  save(dir, state);
  return { gen_id, status: state.status, makers: makers.routable, blocked: makers.blocked, user_words_sha256: state.user_words.sha256, next: "Restate the request as an intent checklist (checklist --file) and show it to the user beside their own words." };
}

// ---- intent checklist ----------------------------------------------------------------------------------------
export function writeChecklist({ cwd = process.cwd(), gen, checklist, file, now } = {}) {
  const { dir, state } = open({ cwd, gen });
  if (Object.keys(state.rounds).length) throw fail("Refused: the checklist is fixed once a round has run; its hash is in every picture's provenance.", "MOMM_CHECKLIST_LOCKED");
  let doc = checklist;
  if (file != null) { try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { throw fail(`Refused: the checklist file is not JSON (${clean(e.message, 120)})`, "MOMM_BAD_CHECKLIST"); } }
  const raw = Array.isArray(doc) ? doc : doc?.items;
  const problems = [];
  if (!Array.isArray(raw) || !raw.length) problems.push("items must be a non-empty array");
  else if (raw.length > 40) problems.push("at most 40 items");
  else raw.forEach((item, k) => {
    if (!isObj(item)) { problems.push(`item ${k + 1} is not an object`); return; }
    if (!nonEmpty(item.text) || item.text.length > 500) problems.push(`item ${k + 1} needs text (1 to 500 characters)`);
    if (!CHECKLIST_KINDS.includes(item.kind)) problems.push(`item ${k + 1} kind must be one of ${CHECKLIST_KINDS.join(", ")}`);
  });
  if (problems.length) throw fail(`Refused: the checklist is not valid: ${problems.join("; ")}`, "MOMM_BAD_CHECKLIST", { problems });
  const items = raw.map((item, k) => ({ id: `c${k + 1}`, text: item.text, kind: item.kind }));
  state.checklist = { items, sha256: sha256(JSON.stringify(items)), written_at: stamp(now), confirmed_at: null };
  state.questions = {};
  state.status = "awaiting_user_checklist_confirmation";
  save(dir, state);
  return { gen_id: gen, status: state.status, items, checklist_sha256: state.checklist.sha256, user_words: state.user_words.text, next: "Show the user their own words and this checklist; call confirm-checklist only after they say it is right." };
}
export function confirmChecklist({ cwd = process.cwd(), gen, now } = {}) {
  const { dir, state } = open({ cwd, gen });
  if (!state.checklist) throw fail("Refused: there is no checklist to confirm; write one first.", "MOMM_CHECKLIST_UNCONFIRMED");
  if (Object.keys(state.rounds).length) throw fail("Refused: the checklist is fixed once a round has run.", "MOMM_CHECKLIST_LOCKED");
  state.checklist.confirmed_at = stamp(now);
  state.status = "checklist_confirmed";
  save(dir, state);
  return { gen_id: gen, status: state.status, checklist_sha256: state.checklist.sha256, confirmed_at: state.checklist.confirmed_at, next: "Confirming the checklist is not a yes to spend anything: ask the round-1 question (question --round 1) and wait for the user's answer." };
}

// ---- the round a question is about ----------------------------------------------------------------------
function checkRoundFlags(n, { combine, shareAll, suggestion, userNote }) {
  if (n === 1 && (combine || shareAll || suggestion != null || userNote != null)) throw fail("Refused: round 1 sends the user's words and nothing else (no notes, suggestion, added words or shared pictures).", "MOMM_BAD_ROUND");
  if (shareAll && !combine) throw fail("Refused: --share-all belongs to a combine round only (--combine); it is never implied by another round.", "MOMM_BAD_ROUND");
  if (userNote != null && !nonEmpty(userNote)) throw fail("Refused: --user-note is empty", "MOMM_BAD_ROUND");
}
function checkRoundReady(state, n) {
  const done = Object.keys(state.rounds).length;
  if (n !== done + 1) throw fail(`Refused: the next round is ${done + 1}; round ${n} cannot run. Each round runs once, in order, and only after its own yes.`, "MOMM_ROUND_ORDER");
  if (!state.checklist?.confirmed_at) throw fail("Refused: the user has not confirmed the intent checklist; no round runs before that.", "MOMM_CHECKLIST_UNCONFIRMED");
  if (n > 1 && !state.rounds[String(n - 1)]?.reveal) throw fail(`Refused: round ${n - 1} has not been judged blind and revealed yet (blind, critique, reveal).`, "MOMM_NOT_REVEALED");
}
function selectionOf(state, n, { combine = false, makers, suggestion = null, userNote = null }) {
  const kind = n === 1 ? "first" : combine ? "combine" : "notes";
  let suggestionText = null;
  if (suggestion != null) {
    const list = state.rounds[String(n - 1)]?.critique?.suggested_rounds ?? [];
    const k = Number(suggestion);
    if (!Number.isInteger(k) || k < 1 || k > list.length) throw fail(`Refused: suggestion ${suggestion} is not one of the ${list.length} suggested rounds from round ${n - 1}`, "MOMM_BAD_SUGGESTION");
    suggestionText = list[k - 1];
  }
  const selection = { round: n, kind, makers: byRouteOrder(makers), suggestion: suggestion == null ? null : Number(suggestion), suggestion_sha256: suggestionText == null ? null : sha256(suggestionText), user_note_sha256: userNote == null ? null : sha256(userNote), share_all: kind === "combine" };
  return { selection, selection_sha256: sha256(JSON.stringify(selection)), suggestionText };
}
const revealedOf = (state, round) => Object.entries(state.rounds[String(round)]?.reveal?.pictures ?? {}).sort(([a], [b]) => a.length - b.length || a.localeCompare(b));
const allRevealed = (state, upTo) => Array.from({ length: upTo }, (_, i) => i + 1).flatMap((r) => revealedOf(state, r).map(([label, p]) => ({ round: r, label, ...p })));

export function question({ cwd = process.cwd(), gen, round, makers, combine = false, suggestion = null, userNote = null, effective, home = os.homedir(), now } = {}) {
  const n = toRound(round);
  checkRoundFlags(n, { combine, shareAll: combine, suggestion, userNote });
  const { dir, state } = open({ cwd, gen });
  checkRoundReady(state, n);
  const matrix = effective ?? effectiveMatrix({ home, baseline: loadBaseline() });
  const live = makersOf(matrix);
  const kind = n === 1 ? "first" : combine ? "combine" : "notes";
  const previousMakers = kind === "notes" ? new Set(revealedOf(state, n - 1).map(([, p]) => p.maker)) : null;
  let chosen;
  if (makers?.length) {
    for (const m of makers) {
      if (!live.routable.includes(m)) {
        const b = live.blocked.find((x) => x.route === m);
        throw fail(`Refused: ${nameOf(m)} cannot make a picture now: ${b ? `${b.reason}. ${b.clearing_action}` : "it has no image-generation path"}`, "MOMM_MAKER_BLOCKED", { route: m, blocker: b?.blocker ?? null, clearing_action: b?.clearing_action ?? null });
      }
      if (previousMakers && !previousMakers.has(m)) throw fail(`Refused: ${nameOf(m)} has no picture in round ${n - 1} to take notes on`, "MOMM_NO_PREVIOUS_PICTURE");
    }
    chosen = makers;
  } else chosen = previousMakers ? live.routable.filter((m) => previousMakers.has(m)) : live.routable;
  if (!chosen.length) throw fail(`Refused: no maker can take part in round ${n} (${live.blocked.map((b) => `${b.route}: ${b.reason}`).join("; ") || "none is routable"})`, "MOMM_NO_MAKERS");
  const { selection, selection_sha256, suggestionText } = selectionOf(state, n, { combine, makers: chosen, suggestion, userNote });
  const imageInput = Object.fromEntries(selection.makers.map((m) => [m, takesImagesIn(matrix, m)]));
  const text = questionText(selection, imageInput, { suggestionText, userNote, previousPictures: kind === "combine" ? allRevealed(state, n - 1).length : 0 });
  state.questions[String(n)] = { text, text_sha256: sha256(text), at: stamp(now), selection, selection_sha256, image_input: imageInput };
  save(dir, state);
  return { gen_id: gen, round: n, kind, makers: selection.makers, pictures: selection.makers.length, image_input: imageInput, share_all_required: kind === "combine", text, question_sha256: sha256(text), next: kind === "combine" ? "Ask the user this question word for word. Only on a yes: round --consent --combine --share-all with the same selection." : "Ask the user this question word for word. Only on a yes: round --consent with the same selection." };
}
function questionText(sel, imageInput, { suggestionText, userNote, previousPictures }) {
  const n = sel.makers.length, names = listNames(sel.makers);
  const allowance = n === 1 ? `uses your allowance on ${names}` : n === 2 ? "uses your allowance on both" : "uses your allowance on each of them";
  const withInput = sel.makers.filter((m) => imageInput[m]), without = sel.makers.filter((m) => !imageInput[m]);
  const extras = [];
  if (suggestionText != null) extras.push(`My notes will carry the change you picked: "${suggestionText}".`);
  if (userNote != null) extras.push("Your own words for this round go to them unchanged, in their own section, separate from my notes.");
  if (sel.kind === "first") {
    return `I can send your request to ${names} now. That makes ${n === 1 ? `one picture, from ${names}` : `${count(n)} pictures, one from each`}, and ${allowance}. Shall I go ahead?`;
  }
  const more = n === 1 ? `one more picture, from ${names}` : `${count(n)} more pictures, one from each`;
  if (sel.kind === "notes") {
    const parts = [
      "I've compared all the pictures with what you asked for. Would you like me to pass my notes to the image makers so each can try again? Each one sees only my notes on its own picture, not anyone else's.",
      `This goes to ${names}, makes ${more}, and ${allowance}.`,
    ];
    if (withInput.length) parts.push(`${listNames(withInput)} also ${withInput.length === 1 ? "gets its" : "get their"} own previous picture to edit, which shares nothing with another provider.`);
    if (without.length) parts.push(`${listNames(without)} cannot take a picture in, so ${without.length === 1 ? "it gets" : "they get"} my notes only.`);
    return [...parts, ...extras, "Shall I go ahead?"].join(" ");
  }
  const parts = [
    "One more option: each image maker could see all the pictures so far, along with my notes, and have a final go at combining the best of them. This often gets closest to what you meant, but the results can start to look alike, and every picture is shared with every provider taking part.",
    `It goes to ${names}, makes ${more}, and ${allowance}.`,
  ];
  if (withInput.length) parts.push(`${listNames(withInput)} will receive ${previousPictures === 1 ? "the one picture so far" : `all ${previousPictures} pictures so far`}.`);
  if (without.length) parts.push(`${listNames(without)} cannot take pictures in and ${without.length === 1 ? "gets" : "get"} my notes only.`);
  return [...parts, ...extras, "Shall I do that?"].join(" ");
}

// ---- what each maker receives ----------------------------------------------------------------------------
// The user's words always come first and unchanged. Anything else follows in labelled sections: the
// governor's notes (sent only after the user agreed), then any words the user added for this round.
export function makerPrompt(userWords, { reviewer = null, userNote = null } = {}) {
  const parts = [userWords];
  if (reviewer) parts.push(reviewer);
  if (userNote != null) parts.push(userNoteSection(userNote));
  return parts.join("\n\n");
}
const userNoteSection = (note) => `--- ${USER_NOTE_HEADING} (the user's own words, unchanged) ---\n${note}\n--- end of the user's words ---`;
const checklistBlock = (items) => ["The checklist the user confirmed:", ...items.map((i) => `- ${i.id} [${i.kind}] ${i.text}`)].join("\n");
function pictureNotes(title, picture, items) {
  const lines = [title];
  for (const item of items) {
    const r = picture.items[item.id];
    lines.push(`- ${item.id} [${item.kind}] ${item.text}: ${RESULT_WORDS[r.result]}${nonEmpty(r.evidence) ? ` (${r.evidence.trim()})` : ""}`);
  }
  lines.push(`Letter against spirit: ${picture.letter_vs_spirit.trim()}`);
  return lines.join("\n");
}
function reviewerSection(heading, blocks) {
  return `--- ${heading} (from MOMM's reviewer; the user agreed to send them) ---\n${blocks.filter(Boolean).join("\n\n")}\n--- end of the reviewer's notes ---`;
}
function loadCritique(dir, r) {
  const file = path.join(dir, "critiques", `round-${r.round}.json`);
  let bytes; try { bytes = fs.readFileSync(file); } catch { throw fail(`Refused: the saved critique for round ${r.round} is missing`, "MOMM_CRITIQUE_CHANGED"); }
  if (sha256(bytes) !== r.critique?.sha256) throw fail(`Refused: the saved critique for round ${r.round} no longer matches the hash recorded before its reveal`, "MOMM_CRITIQUE_CHANGED");
  return JSON.parse(bytes.toString("utf8"));
}

// ---- one round ----------------------------------------------------------------------------------------------
export async function runRound({ cwd = process.cwd(), gen, round, consent = false, shareAll = false, combine = false, makers, suggestion = null, userNote = null, effective, exec, home = os.homedir(), env = process.env, now = () => new Date(), timeout = 600_000, resolveCommand } = {}) {
  if (consent !== true) throw fail("Refused: a round sends the user's words to the image makers and spends their allowance; ask the round's question and pass --consent only after the user says yes.", "MOMM_CONSENT_REQUIRED");
  const n = toRound(round);
  checkRoundFlags(n, { combine, shareAll, suggestion, userNote });
  if (combine && shareAll !== true) throw fail("Refused: a combine round shares every picture with every provider taking part; that needs its own yes (--share-all), never implied by another round.", "MOMM_SHARE_CONSENT_REQUIRED");
  const { dir, state } = open({ cwd, gen });
  checkRoundReady(state, n);
  const q = state.questions[String(n)];
  if (!q) throw fail(`Refused: no question was asked for round ${n}; run question --round ${n}, ask the user, and only then run the round.`, "MOMM_QUESTION_REQUIRED");
  const { selection, selection_sha256, suggestionText } = selectionOf(state, n, { combine, makers: makers?.length ? makers : q.selection.makers, suggestion, userNote });
  if (selection_sha256 !== q.selection_sha256) throw fail(`Refused: this round (${selection.kind}, ${selection.makers.join(", ")}) is not the one the user was asked about (${q.selection.kind}, ${q.selection.makers.join(", ")}); ask again.`, "MOMM_QUESTION_MISMATCH");
  const matrix = effective ?? effectiveMatrix({ home, baseline: loadBaseline() });
  const items = state.checklist.items, words = state.user_words.text;
  const critiques = {};
  const critiqueOf = (r) => (critiques[r] ??= loadCritique(dir, state.rounds[String(r)]));
  const notePrompt = userNote == null ? null : userNote;
  // Build every maker's prompt and verify every reference picture BEFORE anything is sent.
  // Whether a maker is sent pictures is what the user was asked (the question's image_input), never
  // recomputed: a maker that can no longer take one in is recorded blocked by the planner below, and one
  // that now could still gets notes only.
  const jobs = selection.makers.map((maker) => {
    const imageInput = q.image_input?.[maker] === true;
    let refs = [], reviewer = null;
    if (selection.kind === "notes") {
      const own = revealedOf(state, n - 1).filter(([, p]) => p.maker === maker);
      const blocks = [checklistBlock(items), ...own.map(([label, p]) => pictureNotes(`My notes on your previous picture (round ${n - 1}, picture ${label}):`, critiqueOf(n - 1).pictures[label], items))];
      if (suggestionText != null) blocks.push(`The change the user picked from my suggestions:\n${suggestionText}`);
      blocks.push(imageInput ? `Your previous picture is attached as an input image; edit it rather than start again.` : "You receive these notes only; no picture is attached.");
      reviewer = reviewerSection(NOTES_HEADING, blocks);
      refs = imageInput ? own.map(([label, p]) => ({ round: n - 1, label, path: p.path, sha256: p.sha256 })) : [];
    } else if (selection.kind === "combine") {
      const all = allRevealed(state, n - 1);
      const blocks = [checklistBlock(items), "My notes on every picture so far:", ...all.map((p) => pictureNotes(`Round ${p.round}, picture ${p.label}:`, critiqueOf(p.round).pictures[p.label], items))];
      if (suggestionText != null) blocks.push(`The change the user picked from my suggestions:\n${suggestionText}`);
      blocks.push(imageInput
        ? `${all.length === 1 ? "The one picture so far is" : `All ${all.length} pictures are`} attached as ${all.length === 1 ? "an input image" : "input images, in this order"}: ${all.map((p) => `round ${p.round} picture ${p.label}`).join(", ")}. Make one final picture that combines the best of ${all.length === 1 ? "it" : "them"}.`
        : "You receive these notes only; the pictures are not attached. Make one final picture that combines the best of what the notes describe.");
      reviewer = reviewerSection(COMBINE_HEADING, blocks);
      refs = imageInput ? all.map((p) => ({ round: p.round, label: p.label, path: p.path, sha256: p.sha256 })) : [];
    }
    const inputs = refs.map((ref) => verifiedPicture(cwd, ref));
    const prompt = makerPrompt(words, { reviewer, userNote: notePrompt });
    const parts = {
      user_words_sha256: state.user_words.sha256,
      checklist_sha256: reviewer ? state.checklist.sha256 : null,
      notes_sha256: reviewer ? sha256(reviewer) : null,
      user_note_sha256: notePrompt == null ? null : sha256(notePrompt),
      suggestion_sha256: suggestionText == null ? null : sha256(suggestionText),
    };
    return { maker, imageInput, refs, inputs, reviewer, prompt, parts };
  });
  for (const j of jobs) if (!j.prompt.startsWith(words)) throw fail("Internal: a maker prompt does not start with the user's words", "MOMM_INTERNAL");
  // The consent is recorded, and the round marked running, before any provider is contacted.
  const startedAt = stamp(now);
  const record = {
    round: n, kind: selection.kind, status: "running", question_sha256: q.text_sha256, selection_sha256,
    consent: { generation: { given: true, at: startedAt }, share_pictures: selection.kind === "combine" ? { given: true, at: startedAt } : null },
    makers: selection.makers, started_at: startedAt, finished_at: null, entries: [], blind: null, critique: null, reveal: null,
  };
  state.rounds[String(n)] = record;
  state.status = "round_running"; state.current_round = n;
  save(dir, state); // no await since open() checked the folder

  if (!exec) exec = (await import("./probes.mjs")).defaultExec;
  const { isolateReply } = await import("./probes.mjs");
  const results = await Promise.all(jobs.map(async (job) => {
    const entry = {
      maker: job.maker, status: null, run_id: null, image_input: job.imageInput, notes_only: selection.kind !== "first" && !job.imageInput,
      prompt_sha256: sha256(job.prompt), prompt_parts: job.parts, notes_text: job.reviewer,
      suggestion: suggestionText == null ? null : { index: selection.suggestion, text: suggestionText, by: "governor" },
      user_note: notePrompt == null ? null : { text: notePrompt, sha256: sha256(notePrompt), by: "user" },
      reference_images: job.refs.map(({ round: r, label, path: p, sha256: s }) => ({ round: r, label, path: p, sha256: s })),
      reason: null, pictures: [],
    };
    const need = job.inputs.length ? { input: ["text", "image"], output: ["image_gen"] } : { output: ["image_gen"] };
    const planned = plan({ routes: { [job.maker]: matrix.routes[job.maker] ?? {} } }, need, { prompt: job.prompt });
    if (!planned.possible || planned.steps[0].chosen !== job.maker) {
      const b = planned.blocked_by.find((x) => x.route === job.maker) ?? planned.blocked_by[0] ?? {};
      entry.status = "blocked";
      entry.reason = { blocker: b.blocker ?? null, level: b.level ?? null, clearing_action: b.clearing_action ?? null, detail: clean(b.reason ?? "no image-generation path") };
      return entry;
    }
    let last = null;
    const watched = async (...args) => { last = await exec(...args); return last; };
    try {
      const result = await run(planned, { consent: true, inputs: job.inputs, exec: watched, home, cwd, env, now, effective: matrix, timeout, resolveCommand });
      const report = result.report;
      entry.run_id = result.run_id;
      if (report.status === "complete") {
        entry.status = "complete";
        entry.pictures = (report.steps[0]?.files ?? []).map((f) => ({
          path: f.path, sha256: f.sha256, bytes: f.bytes, mime: f.mime, label: null,
          provenance: { route: job.maker, round: n, run_id: result.run_id, prompt_parts: job.parts, reference_images: entry.reference_images.map((r) => ({ sha256: r.sha256, round: r.round, label: r.label })), received_prompt_sha256: report.steps[0]?.prompt_sha256 ?? null },
        }));
      } else {
        // A refusal stays a refusal: recorded with the provider's own reason, never retried or reworded.
        const reply = last ? isolateReply(job.maker, last, job.prompt) : null;
        entry.status = "failed";
        entry.reason = { failure: report.failure ?? report.status, detail: clean(report.failure_detail ?? report.error ?? ""), provider_reason: clean(reply?.reply || reply?.detail || last?.stderr || ""), stderr_excerpt: report.stderr_excerpt ?? null };
      }
    } catch (e) {
      entry.status = e?.code === "MOMM_STEP_BLOCKED" || e?.code === "MOMM_PLAN_BLOCKED" ? "blocked" : "error";
      entry.reason = { code: e?.code ?? null, blocker: e?.blocker ?? null, clearing_action: e?.clearing_action ?? null, detail: clean(e?.message ?? e) };
      if (e?.evidence?.run_id) entry.run_id = e.evidence.run_id;
    }
    return entry;
  }));
  record.entries = results;
  record.status = "generated";
  record.finished_at = stamp(now);
  state.status = "round_generated";
  requirePrivateEvidence(dir);
  save(dir, state);
  return { gen_id: gen, round: n, kind: selection.kind, entries: results.map(({ notes_text, user_note, ...rest }) => rest), pictures: results.reduce((k, e) => k + e.pictures.length, 0), next: "Label the pictures blind (blind --round n) before looking at them." };
}

// ---- blind labels --------------------------------------------------------------------------------------------
export function blind({ cwd = process.cwd(), gen, round, random = (n) => randomInt(n), now } = {}) {
  const { dir, state } = open({ cwd, gen });
  const { n, r } = roundOf(state, round);
  if (r.status !== "generated") throw fail(`Refused: round ${n} has not finished`, "MOMM_ROUND_NOT_FINISHED");
  if (r.blind) throw fail(`Refused: round ${n} is already labelled; the labels are fixed.`, "MOMM_ALREADY_BLINDED");
  const pictures = r.entries.flatMap((e) => e.pictures.map((p) => ({ maker: e.maker, run_id: e.run_id, path: p.path, sha256: p.sha256 })));
  if (!pictures.length) throw fail(`Refused: round ${n} made no pictures to judge`, "MOMM_NO_PICTURES");
  const remaining = [...pictures], map = {};
  pictures.forEach((_, i) => {
    const k = random(remaining.length);
    if (!Number.isInteger(k) || k < 0 || k >= remaining.length) throw fail("Internal: the shuffle returned an index out of range", "MOMM_INTERNAL");
    map[labelName(i)] = remaining.splice(k, 1)[0];
  });
  const labels = Object.keys(map), files = {};
  for (const label of labels) {
    const abs = verifiedPicture(cwd, map[label]);
    const target = path.join(dir, "blind", `round-${n}`, `${label}${path.extname(abs).toLowerCase()}`);
    writePrivate(target, fs.readFileSync(abs));
    files[label] = toLogical(cwd, target);
  }
  const labelsText = `${JSON.stringify({ schema: LABELS_SCHEMA, gen_id: gen, round: n, labels: map }, null, 2)}\n`;
  writePrivate(path.join(dir, "labels", `round-${n}.json`), labelsText);
  r.blind = { at: stamp(now), labels, files, labels_sha256: sha256(labelsText) };
  state.status = "round_blinded";
  save(dir, state);
  return { gen_id: gen, round: n, labels, pictures: labels.map((l) => files[l]), next: `Judge each picture against every checklist item without looking up who made it, then record the critique (critique --round ${n} --file <json>).` };
}

// ---- the governor's critique ---------------------------------------------------------------------------
export function validateCritique(c, labels, items, n) {
  const problems = [];
  if (!isObj(c)) return ["the critique must be a JSON object"];
  if (c.round !== undefined && c.round !== n) problems.push(`round is ${JSON.stringify(c.round)}, not ${n}`);
  if (!isObj(c.pictures)) problems.push("pictures must be an object keyed by picture label");
  else {
    for (const label of labels) if (!isObj(c.pictures[label])) problems.push(`picture ${label} has no critique`);
    for (const key of Object.keys(c.pictures)) if (!labels.includes(key)) problems.push(`picture ${key} is not one of ${labels.join(", ")}`);
    for (const label of labels.filter((l) => isObj(c.pictures[l]))) {
      const pic = c.pictures[label];
      if (!isObj(pic.items)) { problems.push(`picture ${label}: items must be an object keyed by checklist id`); continue; }
      for (const item of items) {
        const r = pic.items[item.id];
        if (!isObj(r)) problems.push(`picture ${label}: no result for checklist item ${item.id}`);
        else if (!RESULTS.includes(r.result)) problems.push(`picture ${label} item ${item.id}: result must be one of ${RESULTS.join(", ")}`);
        else if (r.result !== "cant_tell" && !nonEmpty(r.evidence)) problems.push(`picture ${label} item ${item.id}: ${r.result} needs evidence naming what is visible (or use cant_tell)`);
      }
      for (const key of Object.keys(pic.items)) if (!items.some((i) => i.id === key)) problems.push(`picture ${label}: ${key} is not a checklist item`);
      if (!nonEmpty(pic.letter_vs_spirit)) problems.push(`picture ${label}: letter_vs_spirit is required (where it meets the words but misses the point, or that it does not)`);
    }
  }
  if (!Array.isArray(c.suggested_rounds)) problems.push("suggested_rounds must be an array of short strings (it may be empty)");
  else c.suggested_rounds.forEach((s, k) => { if (!nonEmpty(s) || s.length > SUGGESTION_MAX_CHARS) problems.push(`suggested round ${k + 1} must be a non-empty string of at most ${SUGGESTION_MAX_CHARS} characters`); });
  if (c.recommendation !== undefined && c.recommendation !== null && typeof c.recommendation !== "string") problems.push("recommendation must be a string when present");
  return problems;
}
export function recordCritique({ cwd = process.cwd(), gen, round, file, critique, now } = {}) {
  const { dir, state } = open({ cwd, gen });
  const { n, r } = roundOf(state, round);
  if (r.reveal) throw fail(`Refused: round ${n}'s labels were already revealed; a critique written after the reveal is not blind.`, "MOMM_ALREADY_REVEALED");
  if (!r.blind) throw fail(`Refused: round ${n} has not been labelled blind yet (blind --round ${n})`, "MOMM_NOT_BLINDED");
  if (r.critique) throw fail(`Refused: round ${n} already has a recorded critique (sha256 ${r.critique.sha256.slice(0, 12)})`, "MOMM_CRITIQUE_RECORDED");
  const bytes = file != null ? fs.readFileSync(file) : Buffer.from(`${JSON.stringify(critique, null, 2)}\n`);
  let parsed;
  try { parsed = JSON.parse(bytes.toString("utf8")); } catch (e) { throw fail(`Refused: the critique is not JSON (${clean(e.message, 120)})`, "MOMM_BAD_CRITIQUE"); }
  const problems = validateCritique(parsed, r.blind.labels, state.checklist.items, n);
  if (problems.length) throw fail(`Refused: the critique is not complete: ${problems.join("; ")}`, "MOMM_BAD_CRITIQUE", { problems });
  const target = path.join(dir, "critiques", `round-${n}.json`);
  writePrivate(target, bytes);
  r.critique = { sha256: sha256(bytes), at: stamp(now), path: toLogical(cwd, target), suggested_rounds: parsed.suggested_rounds, recommendation: typeof parsed.recommendation === "string" ? parsed.recommendation : null };
  state.status = "round_critiqued";
  save(dir, state);
  return { gen_id: gen, round: n, critique_sha256: r.critique.sha256, at: r.critique.at, next: `The critique hash and time are saved; reveal the makers with reveal --round ${n}.` };
}
export function reveal({ cwd = process.cwd(), gen, round, now } = {}) {
  const { dir, state } = open({ cwd, gen });
  const { n, r } = roundOf(state, round);
  if (r.reveal) throw fail(`Refused: round ${n} is already revealed`, "MOMM_ALREADY_REVEALED");
  if (!r.critique) throw fail(`Refused: round ${n}'s labels stay hidden until the governor's critique is recorded (critique --round ${n} --file <json>)`, "MOMM_CRITIQUE_REQUIRED");
  const critique = loadCritique(dir, r);
  const labelsText = fs.readFileSync(path.join(dir, "labels", `round-${n}.json`));
  if (sha256(labelsText) !== r.blind.labels_sha256) throw fail(`Refused: labels/round-${n}.json changed after the pictures were labelled`, "MOMM_LABELS_CHANGED");
  const { labels } = JSON.parse(labelsText.toString("utf8"));
  const pictures = {};
  for (const [label, p] of Object.entries(labels)) {
    const pc = critique.pictures[label], tally = { met: 0, partly: 0, missed: 0, cant_tell: 0 };
    for (const item of state.checklist.items) tally[pc.items[item.id].result]++;
    pictures[label] = { maker: p.maker, run_id: p.run_id, path: p.path, sha256: p.sha256, critique: { ...tally, letter_vs_spirit: pc.letter_vs_spirit } };
    for (const e of r.entries) for (const pic of e.pictures) if (e.maker === p.maker && pic.sha256 === p.sha256 && pic.path === p.path) pic.label = label;
  }
  r.reveal = { at: stamp(now), critique_sha256: r.critique.sha256, pictures };
  state.status = "round_revealed";
  save(dir, state);
  return {
    gen_id: gen, round: n, critique_sha256: r.critique.sha256,
    pictures: Object.fromEntries(Object.entries(pictures).map(([l, p]) => [l, { maker: p.maker, sha256: p.sha256, critique: p.critique }])),
    recommendation: r.critique.recommendation == null ? null : { by: "governor", text: r.critique.recommendation, note: "The governor's judgement against the checklist, not a measurement." },
    suggested_rounds: r.critique.suggested_rounds,
    next: "Show the user the gallery (gallery), the recommendation and the suggested rounds; the user decides whether any further round runs.",
  };
}

// ---- private gallery ---------------------------------------------------------------------------------------
const KIND_WORDS = { first: "the user's words only", notes: "each maker saw only the governor's notes on its own picture", combine: "every picture and all notes shared with every maker taking part" };
export function gallery({ cwd = process.cwd(), gen } = {}) {
  const { dir, state } = open({ cwd, gen });
  const rel = (abs) => posix(path.relative(dir, abs)).split("/").map(encodeURIComponent).join("/");
  const short = (s) => (s ? esc(String(s).slice(0, 12)) : "none");
  const items = state.checklist?.items ?? [];
  const img = (abs, alt) => `<img loading="lazy" src="${rel(abs)}" alt="${esc(alt)}">`;
  const rounds = Object.values(state.rounds).sort((a, b) => a.round - b.round).map((r) => {
    const q = state.questions[String(r.round)];
    const head = `<h2>Round ${r.round} <span class="dim">· ${esc(KIND_WORDS[r.kind] ?? r.kind)}</span></h2>
<p class="dim">Asked: “${esc(q?.text ?? "")}” · yes recorded ${esc(r.consent?.generation?.at ?? "")}${r.consent?.share_pictures ? ` · sharing pictures between providers: separate yes recorded ${esc(r.consent.share_pictures.at)}` : ""}</p>`;
    if (!r.reveal) {
      const blindFigures = r.blind ? r.blind.labels.map((l) => `<figure>${img(ofLogical(cwd, r.blind.files[l]), `AI-generated picture ${l}`)}<figcaption><strong>Picture ${esc(l)}</strong> · AI-generated · maker withheld until the governor's critique is recorded and the labels are revealed</figcaption></figure>`).join("") : "";
      const count = r.entries.reduce((k, e) => k + e.pictures.length, 0);
      return `<section class="round" id="round-${r.round}">${head}<p><em>${count} picture${count === 1 ? "" : "s"}; makers and prompts withheld until the critique is recorded and revealed.</em></p><div class="grid">${blindFigures}</div></section>`;
    }
    const critique = loadCritique(dir, r);
    const figures = Object.entries(r.reveal.pictures).map(([label, p]) => {
      const entry = r.entries.find((e) => e.maker === p.maker && e.pictures.some((x) => x.sha256 === p.sha256)) ?? {};
      const pic = entry.pictures?.find((x) => x.sha256 === p.sha256) ?? {};
      let shown;
      try { shown = img(verifiedPicture(cwd, p), `AI-generated picture ${label} by ${nameOf(p.maker)}`); }
      catch { shown = `<p class="warn">${esc(p.path)}: not shown, its bytes no longer match the recorded sha256.</p>`; }
      const parts = pic.provenance?.prompt_parts ?? entry.prompt_parts ?? {};
      const pc = critique.pictures[label];
      const rows = items.map((i) => { const x = pc.items[i.id]; return `<tr><td>${esc(i.id)}</td><td>${esc(i.kind)}</td><td>${esc(i.text)}</td><td class="r-${esc(x.result)}">${esc(RESULT_WORDS[x.result])}</td><td>${esc(x.evidence ?? "")}</td></tr>`; }).join("");
      return `<figure class="pic">${shown}
<figcaption><strong>Picture ${esc(label)}</strong> · AI-generated by ${esc(nameOf(p.maker))} (${esc(p.maker)}) · sha256 ${short(p.sha256)} · run ${esc(p.run_id)}</figcaption>
<details><summary>What ${esc(nameOf(p.maker))} received</summary><ul class="prov">
<li>The user's words, unchanged · sha256 ${short(parts.user_words_sha256)}${parts.user_words_sha256 === state.user_words.sha256 ? " (the words above, byte for byte)" : " (does not match the words above)"}</li>
<li>Checklist · ${short(parts.checklist_sha256)}</li><li>Governor's notes · ${short(parts.notes_sha256)}</li><li>User's added words · ${short(parts.user_note_sha256)}</li><li>Chosen suggestion · ${short(parts.suggestion_sha256)}</li>
<li>Reference images: ${(entry.reference_images ?? []).length ? entry.reference_images.map((x) => `round ${esc(x.round)} picture ${esc(x.label)} (${short(x.sha256)})`).join(", ") : "none"}${entry.notes_only ? " · this maker cannot take pictures in and received notes only" : ""}</li></ul>
${entry.notes_text ? `<pre>${esc(entry.notes_text)}</pre>` : ""}${entry.user_note ? `<p>The user's added words:</p><pre>${esc(entry.user_note.text)}</pre>` : ""}</details>
<table class="critique"><tr><th>item</th><th>kind</th><th>checklist</th><th>result</th><th>what is visible</th></tr>${rows}</table>
<p><strong>Letter against spirit:</strong> ${esc(pc.letter_vs_spirit)}</p></figure>`;
    }).join("");
    const misses = r.entries.filter((e) => e.status !== "complete").map((e) => `<li>${esc(nameOf(e.maker))} (${esc(e.maker)}) made no picture: ${esc(e.status)}${e.reason?.provider_reason ? ` · the provider said: “${esc(e.reason.provider_reason)}”` : ""}${e.reason?.detail ? ` · ${esc(e.reason.detail)}` : ""}${e.reason?.clearing_action ? ` · to clear: ${esc(e.reason.clearing_action)}` : ""}</li>`).join("");
    const rec = r.critique?.recommendation ? `<p class="rec"><strong>The governor's judgement against the checklist, not a measurement:</strong> ${esc(r.critique.recommendation)}</p>` : "";
    const sugg = (r.critique?.suggested_rounds ?? []).length ? `<p>Suggested next rounds (the governor's; pick any, none, or add your own; none is pre-selected):</p><ol>${r.critique.suggested_rounds.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : "";
    return `<section class="round" id="round-${r.round}">${head}
<p class="dim">Critique sha256 ${short(r.critique.sha256)} recorded ${esc(r.critique.at)}, before the labels were revealed ${esc(r.reveal.at)}.</p>
<div class="grid">${figures}</div>${misses ? `<ul class="warn">${misses}</ul>` : ""}${rec}${sugg}</section>`;
  }).join("\n");
  const checklist = items.length ? `<ul>${items.map((i) => `<li><code>${esc(i.id)}</code> [${esc(i.kind)}] ${esc(i.text)}</li>`).join("")}</ul><p class="dim">Checklist sha256 ${short(state.checklist.sha256)} · confirmed by the user ${esc(state.checklist.confirmed_at ?? "not yet")}</p>` : "<p>No checklist yet.</p>";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src 'unsafe-inline'">
<title>MOMM generation ${esc(state.gen_id)}</title>
<style>:root{color-scheme:light dark;--bg:#fbfaf7;--fg:#1d1d1b;--dim:#6b6860;--line:#ddd8cc;--warn:#9a3b12}@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#ecebe6;--dim:#a19d93;--line:#3a3833;--warn:#f0a070}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1200px;padding:16px;overflow-wrap:anywhere}.dim{color:var(--dim)}.warn{color:var(--warn)}
pre{white-space:pre-wrap;word-break:break-word;border:1px solid var(--line);padding:8px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr));gap:16px}
figure{margin:0;border:1px solid var(--line);padding:8px}img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-top:1px solid var(--line);padding:4px;text-align:left;vertical-align:top}
.banner{border:2px solid var(--line);padding:8px 12px}</style></head><body>
<h1>Guided image generation <span class="dim">${esc(state.gen_id)}</span></h1>
<p class="banner">Every picture on this page is <strong>AI-generated</strong>. This page is private and local: MOMM wrote it under .ensemble_reviews, and it is never published. The governor's critique is its judgement against the checklist, not a measurement; the user decides.</p>
<section class="words"><h2>What you asked for</h2><pre>${esc(state.user_words.text)}</pre><p class="dim">sha256 ${short(state.user_words.sha256)} · sent unchanged, byte for byte, to every maker in every round</p>
<h3>Intent checklist</h3>${checklist}</section>
${rounds || "<p>No round has run yet.</p>"}
</body></html>
`;
  const target = path.join(dir, "gallery.html");
  writePrivate(target, html); // no await since open() checked the folder
  return { gen_id: gen, path: toLogical(cwd, target), rounds: Object.keys(state.rounds).length, next: "Open the gallery locally for the user; nothing is published." };
}

// ---- CLI ---------------------------------------------------------------------------------------------------------
function usage() {
  return [
    "Usage: node generation-rounds.mjs <command> [options]",
    "  start --prompt <text> | --prompt-file <file>        store the user's words byte for byte; list the makers (step 0 when none)",
    "  checklist --gen <id> --file <json>                  the governor's intent checklist: {items:[{text, kind: must|must_not|style|text_in_image|shape}]}",
    "  confirm-checklist --gen <id>                        only after the user said the checklist is right",
    "  question --gen <id> --round <n> [--makers a,b] [--combine] [--suggestion <k>] [--user-note <text>]",
    "                                                      the costed question for the round (names the makers and the picture count)",
    "  round --gen <id> --round <n> --consent [--makers a,b] [--combine --share-all] [--suggestion <k>] [--user-note <text>]",
    "                                                      one round, only after the user's yes; --share-all is the separate yes to share pictures",
    "  blind --gen <id> --round <n>                        one lettered copy per picture (A, B, and so on) in a random order; prints blind paths only",
    "  critique --gen <id> --round <n> --file <json>       record the governor's blind critique (hash and time saved before any reveal)",
    "  reveal --gen <id> --round <n>                       reveal who made which picture (after the critique)",
    "  gallery --gen <id>                                  write the private local gallery page",
    "",
  ].join("\n");
}
async function liveMatrix(home) {
  const { detectInstalledVersions, routesOf } = await import("./capabilities.mjs");
  const baseline = loadBaseline();
  const installedVersions = await detectInstalledVersions(routesOf(baseline));
  return effectiveMatrix({ home, baseline, installedVersions });
}
function human(verb, out) {
  switch (verb) {
    case "start": return out.step === 0 ? `Step 0: ${out.message} ${out.blockers.map((b) => `${b.route}: ${b.clearing_action}`).join(" | ")}` : `Generation ${out.gen_id} started; ${out.makers.length} maker(s) can draw: ${out.makers.join(", ")}. Next: the intent checklist.`;
    case "checklist": return `Checklist of ${out.items.length} item(s) saved; waiting for the user's confirmation.`;
    case "confirm-checklist": return "The user confirmed the checklist. That is not a yes to spend anything: ask the round-1 question.";
    case "question": return `Question for round ${out.round} (${out.pictures} picture(s)): ${out.text}`;
    case "round": return `Round ${out.round} finished: ${out.pictures} picture(s); ${out.entries.filter((e) => e.status !== "complete").map((e) => `${e.maker} ${e.status}`).join(", ") || "every maker delivered"}.`;
    case "blind": return `Round ${out.round}: ${out.labels.length} picture(s) labelled ${out.labels[0]} to ${out.labels.at(-1)} for a blind critique.`;
    case "critique": return `Critique for round ${out.round} recorded (sha256 ${out.critique_sha256.slice(0, 12)}) before any reveal.`;
    case "reveal": return `Round ${out.round} revealed: ${Object.entries(out.pictures).map(([l, p]) => `${l}=${p.maker}`).join(", ")}.`;
    case "gallery": return `Private gallery written to ${out.path}; nothing was published.`;
    default: return "";
  }
}
async function main(argv) {
  const [verb, ...rest] = argv;
  if (!verb || verb === "--help" || verb === "-h") { process.stderr.write(usage()); return verb ? 0 : 4; }
  const { values } = parseArgs({ args: rest, strict: true, options: {
    gen: { type: "string" }, round: { type: "string" }, prompt: { type: "string" }, "prompt-file": { type: "string" }, file: { type: "string" },
    consent: { type: "boolean", default: false }, "share-all": { type: "boolean", default: false }, combine: { type: "boolean", default: false },
    makers: { type: "string" }, suggestion: { type: "string" }, "user-note": { type: "string" }, home: { type: "string" },
  } });
  const home = values.home ?? os.homedir(), cwd = process.cwd();
  const makers = values.makers ? values.makers.split(",").map((m) => m.trim()).filter(Boolean) : undefined;
  const selection = { makers, combine: values.combine, suggestion: values.suggestion ?? null, userNote: values["user-note"] ?? null };
  let out;
  switch (verb) {
    case "start":
      if (values.prompt == null && values["prompt-file"] == null) throw fail("Refused: start needs the user's words: --prompt <text> or --prompt-file <file>.", "MOMM_PROMPT_REQUIRED");
      out = start({ cwd, prompt: values.prompt, promptFile: values["prompt-file"], effective: await liveMatrix(home), home }); break;
    case "checklist": out = writeChecklist({ cwd, gen: values.gen, file: values.file ?? (() => { throw fail("checklist needs --file <json>", "MOMM_USAGE"); })() }); break;
    case "confirm-checklist": out = confirmChecklist({ cwd, gen: values.gen }); break;
    case "question": out = question({ cwd, gen: values.gen, round: values.round, ...selection, effective: await liveMatrix(home), home }); break;
    case "round": {
      // Refuse before anything else happens, including the local version check.
      if (!values.consent) throw fail("Refused: a round sends the user's words to the image makers and spends their allowance; ask the round's question and pass --consent only after the user says yes.", "MOMM_CONSENT_REQUIRED");
      const n = toRound(values.round);
      checkRoundFlags(n, { combine: values.combine, shareAll: values["share-all"], suggestion: selection.suggestion, userNote: selection.userNote });
      if (values.combine && !values["share-all"]) throw fail("Refused: a combine round shares every picture with every provider taking part; that needs its own yes (--share-all).", "MOMM_SHARE_CONSENT_REQUIRED");
      const probes = await import("./probes.mjs");
      out = await runRound({ cwd, gen: values.gen, round: n, consent: true, shareAll: values["share-all"], ...selection, effective: await liveMatrix(home), home, resolveCommand: (route) => probes.resolveCommand(route) });
      break;
    }
    case "blind": out = blind({ cwd, gen: values.gen, round: values.round }); break;
    case "critique": out = recordCritique({ cwd, gen: values.gen, round: values.round, file: values.file ?? (() => { throw fail("critique needs --file <json>", "MOMM_USAGE"); })() }); break;
    case "reveal": out = reveal({ cwd, gen: values.gen, round: values.round }); break;
    case "gallery": out = gallery({ cwd, gen: values.gen }); break;
    default: process.stderr.write(usage()); return 4;
  }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  process.stderr.write(`${human(verb, out)}\n`);
  return out.step === 0 ? 3 : 0;
}
function isEntrypoint() { try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } }
if (isEntrypoint()) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write(`${clean(e?.message ?? e, 2000)}\n`);
    process.exitCode = REFUSAL_CODES.includes(e?.code) || e?.code === "MOMM_EVIDENCE_PERMISSIONS" ? 2 : 1;
  });
}
