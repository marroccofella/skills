// MOMM 1.16 E4 — layered guidance prompts for reviewers and the governor.
//
// Resolves `~/.momm/guidance.json` (user), `.reviewrules` + `.momm/guidance.json`
// (project, trust-gated because they arrive with a clone), `--guidance-file`
// and `--guidance` (CLI) into one appended stack per route. Layers append and
// never replace; layer 0 (the built-in persona) is a selector the caller owns,
// so this module only hashes it. A run with no guidance resolves to "" and the
// prompt assembled by assemblePrompt() is byte-identical to 1.15.
//
// Guidance text is returned to the caller (who sanitises it with the same
// scanner as the artifact) and persisted ONLY in the local 0600 sidecar; the
// report receives hashes via guidanceReportFields(). Zero dependencies.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const GUIDANCE_BUDGET = Object.freeze({ per_block: 2000, per_route: 6000 });
export const ARTIFACT_DELIMITER = "--- ARTIFACT TO REVIEW ---";
export const GUIDANCE_HEADING = "## Reviewer guidance (shapes emphasis and suggestions — never the schema, never the truthfulness of findings, never the read-only rules)";
export const TRUST_KINDS = Object.freeze(["guidance", "reviewrules"]);
const REVIEWRULES_CLIP = 4000; // 1.15 clipping kept through the grace release
const CONTROL = /[\x00-\x08\x0B-\x1F]/; // anything < 0x20 except \n (0x0A) and \t (0x09)
const RUN_ID = /^rev_[A-Za-z0-9_]+$/;
const TOP_KEYS = ["governor", "reviewers"];
const SOURCE_ORDER = ["user", "project", "cli:file", "cli:arg"];

export function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
const hashOrNull = (text) => (text ? sha256(text) : null);
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const fileHash = (file) => (fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null);
export const projectGuidanceFiles = (dir) => ({ guidance: path.join(dir, ".momm", "guidance.json"), reviewrules: path.join(dir, ".reviewrules") });
export const userGuidancePath = (home) => path.join(home ?? os.homedir(), ".momm", "guidance.json");
export const trustStorePath = (home) => path.join(home ?? os.homedir(), ".momm", "trust.json");
export const trustCommand = (sha) => `node momm/scripts/multi-review.mjs guidance --trust ${sha}`;

function assertBlock(text, label, source, cap = GUIDANCE_BUDGET.per_block) {
  if (typeof text !== "string") throw new Error(`guidance block ${label} in ${source} must be a string`);
  const bad = CONTROL.exec(text);
  if (bad) throw new Error(`guidance block ${label} in ${source} contains a control character (0x${bad[0].charCodeAt(0).toString(16).padStart(2, "0")} at offset ${bad.index})`);
  if (text.length > cap) throw new Error(`guidance block ${label} in ${source} is ${text.length} characters; the cap is ${cap}`);
  return text;
}

// Validates a parsed guidance object and returns a copy holding only known keys.
export function validateGuidance(value, source) {
  if (!isPlainObject(value)) throw new Error(`guidance in ${source} must be a JSON object with optional "governor" and "reviewers" keys`);
  const unknown = Object.keys(value).filter((k) => !TOP_KEYS.includes(k));
  if (unknown.length) throw new Error(`guidance in ${source} has unknown top-level key(s): ${unknown.join(", ")} (allowed: ${TOP_KEYS.join(", ")})`);
  const out = {};
  if (value.governor !== undefined) out.governor = assertBlock(value.governor, "governor", source);
  if (value.reviewers !== undefined) {
    if (!isPlainObject(value.reviewers)) throw new Error(`guidance "reviewers" in ${source} must be an object of route (or "*") to text`);
    out.reviewers = {};
    for (const [route, text] of Object.entries(value.reviewers)) out.reviewers[route] = assertBlock(text, `reviewers.${route}`, source);
  }
  return out;
}

export function readGuidanceFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (e) { throw new Error(`Invalid JSON in ${filePath}: ${e.message}`); }
  return validateGuidance(parsed, filePath);
}

// --- Trust store: ~/.momm/trust.json, absolute project path -> file hashes ----
function readTrust(home) {
  const file = trustStorePath(home);
  if (!fs.existsSync(file)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isPlainObject(value)) throw new Error("not a JSON object");
    return value;
  } catch (e) { throw new Error(`Trust store ${file} is unreadable (${e.message}); repair or delete it`); }
}

function writePrivate(file, text, dirMode) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: dirMode });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, file);
}

// Records the CURRENT hashes of the project's guidance files. `expect` (from
// `guidance --trust <sha256>`) must match one of them, so a user cannot trust
// a hash they were shown for a file that has since changed.
export function trustProject(projectDir, { home, expect } = {}) {
  const dir = path.resolve(projectDir);
  const files = projectGuidanceFiles(dir);
  const entry = { guidance_sha256: fileHash(files.guidance), reviewrules_sha256: fileHash(files.reviewrules), trusted_at: new Date().toISOString() };
  if (expect !== undefined && entry.guidance_sha256 !== expect && entry.reviewrules_sha256 !== expect) {
    throw new Error(`No guidance file in ${dir} currently has sha256 ${expect}; nothing trusted`);
  }
  const store = readTrust(home);
  store[dir] = entry;
  writePrivate(trustStorePath(home), `${JSON.stringify(store, null, 2)}\n`, 0o700);
  return entry;
}

export function isTrusted(projectDir, kind, sha, { home } = {}) {
  if (!TRUST_KINDS.includes(kind)) throw new Error(`Unknown trust kind: ${kind} (expected ${TRUST_KINDS.join(" or ")})`);
  if (typeof sha !== "string" || !sha) return false;
  const entry = readTrust(home)[path.resolve(projectDir)];
  return isPlainObject(entry) && entry[`${kind}_sha256`] === sha;
}

// --- Resolution -----------------------------------------------------------------
function stack(layers, scope) {
  let text = "";
  const meta = [];
  for (const layer of layers) {
    const next = text ? `${text}\n\n${layer.text}` : layer.text;
    if (next.length > GUIDANCE_BUDGET.per_route) {
      throw new Error(`guidance for ${scope} exceeds ${GUIDANCE_BUDGET.per_route} characters at layer ${layer.name} (${next.length} joined); trim that layer or an earlier one`);
    }
    text = next;
    meta.push({ name: layer.name, sha256: sha256(layer.text), chars: layer.text.length });
  }
  return { layers: meta, text, sha256: hashOrNull(text) };
}

export function resolveGuidance({ cwd = process.cwd(), home, routes, personas = {}, cli = {}, reviewrulesGrace = true } = {}) {
  const dir = path.resolve(cwd);
  const routeList = routes ?? Object.keys(personas);
  const notices = [];
  const sources = { user: readGuidanceFile(userGuidancePath(home)), project: null, "cli:file": null, "cli:arg": null };
  const files = projectGuidanceFiles(dir);

  let rules = null;
  if (fs.existsSync(files.reviewrules)) {
    const raw = fs.readFileSync(files.reviewrules);
    const sha = sha256(raw);
    const trusted = isTrusted(dir, "reviewrules", sha, { home });
    if (trusted || reviewrulesGrace) {
      rules = assertBlock(raw.toString("utf8").replace(/\r\n/g, "\n").trim().slice(0, REVIEWRULES_CLIP), ".reviewrules", files.reviewrules, REVIEWRULES_CLIP);
      if (!trusted) notices.push(`.reviewrules applied without trust (1.16 grace; sha256 ${sha}). MOMM 1.17 will skip it until trusted — run: ${trustCommand(sha)}`);
    } else {
      notices.push(`.reviewrules skipped: not trusted (sha256 ${sha}). To apply it run: ${trustCommand(sha)}`);
    }
  }

  const project = readGuidanceFile(files.guidance);
  if (project) {
    const sha = fileHash(files.guidance);
    if (isTrusted(dir, "guidance", sha, { home })) sources.project = project;
    else notices.push(`.momm/guidance.json skipped: not trusted (sha256 ${sha}). To apply it run: ${trustCommand(sha)}`);
  }

  if (cli.guidanceFile !== undefined) {
    sources["cli:file"] = readGuidanceFile(cli.guidanceFile);
    if (!sources["cli:file"]) throw new Error(`--guidance-file ${cli.guidanceFile} not found`);
  }
  const arg = {};
  if (cli.guidance !== undefined) arg.reviewers = cli.guidance;
  if (cli.governor !== undefined) arg.governor = cli.governor;
  if (Object.keys(arg).length) sources["cli:arg"] = validateGuidance(arg, "--guidance arguments");

  const add = (out, name, text) => { if (typeof text === "string" && text.trim()) out.push({ name, text }); };
  const resolvedRoutes = {};
  for (const route of routeList) {
    const layers = [];
    for (const prefix of SOURCE_ORDER) {
      if (prefix === "project") add(layers, "project:.reviewrules", rules);
      const reviewers = sources[prefix]?.reviewers;
      if (!reviewers) continue;
      if (Object.hasOwn(reviewers, "*")) add(layers, `${prefix}:*`, reviewers["*"]);
      if (route !== "*" && Object.hasOwn(reviewers, route)) add(layers, `${prefix}:${route}`, reviewers[route]);
    }
    const resolved = stack(layers, `route ${route}`);
    const persona = personas[route];
    if (typeof persona === "string" && persona) resolved.layers.unshift({ name: "persona", sha256: sha256(persona), chars: persona.length });
    resolvedRoutes[route] = resolved;
  }

  const governorLayers = [];
  for (const prefix of SOURCE_ORDER) add(governorLayers, `${prefix}:governor`, sources[prefix]?.governor);
  const governor = governorLayers.length ? stack(governorLayers, "the governor") : null;

  return { routes: resolvedRoutes, governor, notices, budget: { ...GUIDANCE_BUDGET } };
}

// --- Persistence and reporting ------------------------------------------------
// The sidecar is the ONLY place resolved guidance text is written.
export function writeGuidanceSidecar(cwd, runId, resolved) {
  if (typeof runId !== "string" || !RUN_ID.test(runId)) throw new Error(`Refusing guidance sidecar for run id ${JSON.stringify(runId)}: expected /^rev_[A-Za-z0-9_]+$/`);
  const file = path.join(path.resolve(cwd), ".ensemble_reviews", "guidance", `${runId}.json`);
  const body = { run_id: runId, written_at: new Date().toISOString(), budget: resolved.budget, notices: resolved.notices, routes: resolved.routes, governor: resolved.governor };
  writePrivate(file, `${JSON.stringify(body, null, 2)}\n`);
  return file;
}

// Hashes only — safe for the report object and for public export.
export function guidanceReportFields(resolved) {
  const routes = {};
  for (const [route, r] of Object.entries(resolved.routes)) {
    routes[route] = { sha256: r.sha256, layers: r.layers.map((l) => ({ name: l.name, sha256: l.sha256 })) };
  }
  return { guidance: { routes, governor_sha256: resolved.governor?.sha256 ?? null } };
}

// --- Prompt assembly ------------------------------------------------------------
// The dispatcher and the dashboard preview both call assemblePrompt, so layer
// order and delimiter placement cannot drift between them. With empty guidance
// the output equals 1.15's `${contract}\n\n--- ARTIFACT TO REVIEW ---\n${artifact}`.
export function assemblePrompt(contractText, routeGuidanceText, artifactText) {
  const guidance = routeGuidanceText ? `\n\n${GUIDANCE_HEADING}\n${routeGuidanceText}` : "";
  return `${contractText}${guidance}\n\n${ARTIFACT_DELIMITER}\n${artifactText}`;
}

export function formatEffectivePrompt(contractText, routeGuidanceText, artifactBytes) {
  if (!Number.isInteger(artifactBytes) || artifactBytes < 0) throw new Error(`artifactBytes must be a non-negative integer, got ${artifactBytes}`);
  return assemblePrompt(contractText, routeGuidanceText, `<artifact omitted: ${artifactBytes} bytes>`);
}
