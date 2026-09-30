// MOMM 1.17 A10 — one isolation definition per route, shared by review, probe and generation.
//
// Grok imports the user's Claude Code and Cursor setup by default (global instructions, skills, MCP
// servers started with the user's credentials, hooks) and cross-session memory (grok inspect,
// 25 September 2026). These documented per-process switches turn that off for MOMM's runs only; the
// user's own Grok setup is unchanged. Until 29 September 2026 only the review adapter set them, and a
// generation run started the user's MCP servers (Grok pilot finding G4). A probe must certify exactly
// the isolation the runner will use, so every caller takes it from here. Zero dependencies.
import { createHash } from "node:crypto";
import path from "node:path";

// 1.17 A2 — Codex. 1.16.1 stopped the project's AGENTS.md, hooks, plugins, apps and multi-agent tools,
// but the user's MCP servers, global instructions, skills and execpolicy rules still reached the
// reviewer. `--ignore-user-config` ("Do not load $CODEX_HOME/config.toml; auth still uses CODEX_HOME")
// and `--ignore-rules` ("Do not load user or project execpolicy .rules files") are the documented
// switches (references/cli/help/codex-exec.txt). Ignoring the configuration also drops the model and
// reasoning effort the user shares with the Codex desktop app, so those two top-level values are read
// here and passed explicitly (owner decision D2); when the user set none, none is passed and Codex
// chooses. The file is opened read-only and never written, locked or created.
const CODEX_CONFIG_MAX_BYTES = 256 * 1024;
// The fixed part of the isolation every read-only Codex run adds (review and its probes). The model and
// effort read from the user's configuration follow it; they are not part of the command shape, because
// they are the user's choice and not a permission or an isolation switch.
export const CODEX_REVIEW_ISOLATION_ARGS = Object.freeze(["--ignore-user-config", "--ignore-rules", "-c", "project_doc_max_bytes=0",
  ...["hooks", "plugins", "apps", "multi_agent", "image_generation"].flatMap((feature) => ["--disable", feature])]);
// The one Codex review command line, shared by the review adapter and the probes so a probe certifies
// exactly what a review sends. Each image goes first with its own -i, so the variadic flag is closed by
// the next flag and the trailing "-" (prompt on stdin) is never read as an image.
export function codexReviewArgs(isolationArgs = CODEX_REVIEW_ISOLATION_ARGS, images = []) {
  return ["exec", ...images.flatMap((image) => ["-i", image]), "--sandbox", "read-only", "--color", "never", "--skip-git-repo-check", ...isolationArgs, "-"];
}
const CODEX_VALUE_RULES = Object.freeze({
  // Model ids such as gpt-6-astra, o4-mini or gpt-5.1-codex. Anything else (spaces, quotes, slashes,
  // a leading dash that would read as a flag) is refused rather than passed on.
  model: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
  model_reasoning_effort: /^[a-z]{1,16}$/,
});
const CODEX_FIELD_LABEL = Object.freeze({ model: "model", model_reasoning_effort: "reasoning effort" });

// Top-level keys only, string values only. Everything after the first table header belongs to a table
// and is ignored; multi-line strings and arrays are skipped so their contents cannot pose as keys. A
// value that is not a plain one-line string, or a key given twice, is reported as unusable.
export function readTopLevelTomlStrings(text, keys) {
  const found = {}, unusable = new Set(), seen = new Set();
  let multiline = null, arrayDepth = 0;
  const bracketDelta = (value) => {
    let delta = 0, quote = null;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (quote) { if (quote === '"' && ch === "\\") i++; else if (ch === quote) quote = null; continue; }
      if (ch === "#") break;
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "[") delta++;
      else if (ch === "]") delta--;
    }
    return delta;
  };
  for (const raw of String(text).replace(/^﻿/, "").split(/\r?\n/)) {
    if (multiline) { if (raw.includes(multiline)) multiline = null; continue; }
    const line = raw.trim();
    if (arrayDepth > 0) { arrayDepth += bracketDelta(line); if (/"""|'''/.test(line)) return { found: {}, unusable: new Set(keys) }; continue; }
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) break;
    const match = /^([A-Za-z0-9_-]+|"[A-Za-z0-9_-]+"|'[A-Za-z0-9_-]+')\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].replace(/^["']|["']$/g, ""), value = match[2];
    const opener = /^("""|''')/.exec(value)?.[1];
    if (opener) { if (!value.slice(3).includes(opener)) multiline = opener; if (keys.includes(key)) unusable.add(key); continue; }
    if (value.startsWith("[")) { arrayDepth = Math.max(0, bracketDelta(value)); if (keys.includes(key)) unusable.add(key); continue; }
    if (!keys.includes(key)) continue;
    if (seen.has(key)) { unusable.add(key); delete found[key]; continue; }
    seen.add(key);
    const string = /^"([^"\\\u0000-\u001f\u007f]*)"\s*(?:#.*)?$/.exec(value) ?? /^'([^'\u0000-\u001f\u007f]*)'\s*(?:#.*)?$/.exec(value);
    if (string) found[key] = string[1]; else unusable.add(key);
  }
  for (const key of unusable) delete found[key];
  return { found, unusable };
}

function readCodexConfigText({ home, env, fs }) {
  const codexHome = typeof env?.CODEX_HOME === "string" && env.CODEX_HOME !== "" ? env.CODEX_HOME : null;
  if (codexHome !== null && !path.isAbsolute(codexHome)) return { text: null, notice: "CODEX_HOME is not an absolute path, so MOMM read no Codex configuration and passed no model or reasoning effort; Codex chooses." };
  if (codexHome === null && (typeof home !== "string" || !path.isAbsolute(home))) return { text: null, notice: null };
  const file = path.join(codexHome ?? path.join(home, ".codex"), "config.toml");
  let fd = null;
  try {
    fd = fs.openSync(file, "r");
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return { text: null, notice: "the Codex configuration is not a regular file, so no model or reasoning effort was passed; Codex chooses." };
    if (stat.size > CODEX_CONFIG_MAX_BYTES) return { text: null, notice: "the Codex configuration is larger than MOMM reads, so no model or reasoning effort was passed; Codex chooses." };
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) { const read = fs.readSync(fd, buffer, offset, buffer.length - offset, offset); if (!read) break; offset += read; }
    return { text: buffer.subarray(0, offset).toString("utf8"), notice: null };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return { text: null, notice: null };
    return { text: null, notice: "the Codex configuration could not be read, so no model or reasoning effort was passed; Codex chooses." };
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* read-only handle; nothing to flush */ } }
  }
}

// Returns the isolation arguments every Codex review run adds, the model and effort taken from the
// user's configuration (null when not set or refused) and notices that name neither values that were
// refused nor the configuration's path.
export function codexIsolationArgs({ home, env = {}, fs }) {
  const { text, notice } = readCodexConfigText({ home, env, fs });
  const notices = notice ? [notice] : [];
  const chosen = { model: null, model_reasoning_effort: null };
  if (text !== null) {
    const { found, unusable } = readTopLevelTomlStrings(text, Object.keys(chosen));
    for (const key of Object.keys(chosen)) {
      if (unusable.has(key)) { notices.push(`the ${CODEX_FIELD_LABEL[key]} in the Codex configuration is not a single plain string, so MOMM did not pass it; Codex chooses.`); continue; }
      if (!Object.hasOwn(found, key)) continue;
      if (CODEX_VALUE_RULES[key].test(found[key])) chosen[key] = found[key];
      else notices.push(`the ${CODEX_FIELD_LABEL[key]} in the Codex configuration has characters MOMM does not pass, so it was omitted; Codex chooses.`);
    }
  }
  const args = [...CODEX_REVIEW_ISOLATION_ARGS,
    ...(chosen.model ? ["-m", chosen.model] : []),
    ...(chosen.model_reasoning_effort ? ["-c", `model_reasoning_effort=${chosen.model_reasoning_effort}`] : [])];
  return { args, model: chosen.model, reasoning_effort: chosen.model_reasoning_effort,
    from_user_config: { model: chosen.model !== null, reasoning_effort: chosen.model_reasoning_effort !== null }, notices };
}

export function grokIsolationEnv() {
  const env = { GROK_MEMORY: "false", GROK_DISABLE_AUTOUPDATER: "1" };
  for (const vendor of ["CLAUDE", "CURSOR"]) for (const kind of ["SKILLS", "RULES", "AGENTS", "MCPS", "HOOKS"]) env[`GROK_${vendor}_${kind}_ENABLED`] = "false";
  return env;
}
// Arguments every Grok run adds for the same reason (no web access for a review or a picture).
export const GROK_ISOLATION_ARGS = Object.freeze(["--disable-web-search"]);

// Headless Grok cancels a media tool call that needs permission (29 September 2026, session log
// decision "cancelled"); acceptEdits approves edits only. Each media output allows exactly its tool.
export const GROK_MEDIA_TOOL = Object.freeze({ image_gen: "image_gen", video_gen: "image_to_video" });
export function mediaGrants(route, modality) { return route === "grok" && Object.hasOwn(GROK_MEDIA_TOOL, modality) ? ["--allow", GROK_MEDIA_TOOL[modality]] : []; }

// 1.17 A9: a probe proves one command shape, not a route. The shape is what decides whether the
// command can work (permission grants and isolation), not the prompt or paths. Evidence records the
// fingerprint of the shape that earned it; the registry routes only on a matching fingerprint.
// `legacy` is the shape MOMM 1.16.1 used, assumed for entries written before fingerprints existed.
// The shape is canonical (sorted grants and environment keys) so equal commands always match, and it
// includes the permission mode and isolation arguments as well as grants and environment (review
// rev_20260929211625_0b5ba54cb0e5), so changing any of them changes the fingerprint.
const PERMISSION = Object.freeze({ grok: "acceptEdits", codex: "workspace-write", claude: "acceptEdits", gemini: "yolo" });
function commandShape(route, direction, modality, legacy) {
  const generative = direction === "output";
  const env = legacy || !generative || route !== "grok" ? {} : grokIsolationEnv();
  return { schema: "momm-command-shape/2", route, direction, modality,
    permission: generative && Object.hasOwn(PERMISSION, route) ? PERMISSION[route] : null,
    // 1.17 A2 parity: Codex input cells send the review's isolation. The legacy (1.16.1) shape had none.
    args: generative && route === "grok" ? [...GROK_ISOLATION_ARGS] : !legacy && !generative && route === "codex" ? [...CODEX_REVIEW_ISOLATION_ARGS] : [],
    grants: legacy || !generative ? [] : [...mediaGrants(route, modality)],
    env: Object.fromEntries(Object.keys(env).sort().map((k) => [k, env[k]])) };
}
export const commandShapeFor = (route, direction, modality) => commandShape(route, direction, modality, false);
const fingerprint = (shape) => createHash("sha256").update(JSON.stringify(shape)).digest("hex");
export const commandShapeSha256 = (route, direction, modality) => fingerprint(commandShape(route, direction, modality, false));
export const legacyCommandShapeSha256 = (route, direction, modality) => fingerprint(commandShape(route, direction, modality, true));
// True when this MOMM's command for the cell differs from the one MOMM 1.16.1 sent.
export const shapeChangedSinceLegacy = (route, direction, modality) => commandShapeSha256(route, direction, modality) !== legacyCommandShapeSha256(route, direction, modality);
