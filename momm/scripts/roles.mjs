// MOMM 1.17 B1 + C1: role briefs are versioned files under momm/roles, separate from the routes that
// perform them. A role is the stance a reviewer takes (surgeon, architect, adversary, ...); a route is
// the CLI that performs it. Each brief carries a small front matter (role, version, review_by) and the
// brief text; the report records every reviewer's role with the brief's version and the sha256 of the
// file bytes. A checklist (C1: the loophole lens) is versioned the same way and included by reference.
// Nothing here is reviewer output: these files ship with MOMM and are the dispatcher's own text.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const ROLES_DIR = fileURLToPath(new URL("../roles/", import.meta.url));
// The closed list of roles. A name outside it is refused before any file is read, so --personas can
// never name a path. Adding a role is a code change and a new file, reviewed together.
export const ROLE_NAMES = Object.freeze(["innovator", "socratic", "futureproof", "surgeon", "architect", "adversary", "verifier", "fresheyes"]);
export const CHECKLIST_NAMES = Object.freeze(["loophole"]);
const ROLE_KEYS = new Set(["role", "version", "review_by", "includes"]);
const CHECKLIST_KEYS = new Set(["checklist", "version", "review_by"]);
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const refuse = (message) => { throw Object.assign(new Error(`role brief ${message}`), { code: "MOMM_ROLE_BRIEF" }); };

function validDate(text) {
  const m = ISO_DATE.exec(text);
  if (!m) return false;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.getUTCFullYear() === Number(m[1]) && date.getUTCMonth() === Number(m[2]) - 1 && date.getUTCDate() === Number(m[3]);
}

// Front matter: a first line "---", then "key: value" lines, then a closing "---". The body is every
// byte after the closing line, less one final newline, so a brief's text is exactly what the file holds.
// CRLF files are read as LF (the hash still covers the bytes on disk).
function parseBrief(bytes, label, allowedKeys) {
  const text = bytes.toString("utf8").replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n")) refuse(`${label}: missing front matter (the file must start with a line "---")`);
  const end = text.indexOf("\n---\n", 3);
  if (end < 0) refuse(`${label}: front matter is not closed by a line "---"`);
  const fields = Object.create(null);
  for (const line of text.slice(4, end).split("\n")) {
    const m = /^([a-z_]+):[ \t]*(.*?)[ \t]*$/.exec(line);
    if (!m) refuse(`${label}: malformed front matter line ${JSON.stringify(line.slice(0, 80))}`);
    if (!allowedKeys.has(m[1])) refuse(`${label}: unknown front matter key "${m[1]}"`);
    if (m[1] in fields) refuse(`${label}: duplicate front matter key "${m[1]}"`);
    fields[m[1]] = m[2];
  }
  if (!/^[1-9]\d{0,5}$/.test(fields.version ?? "")) refuse(`${label}: version must be a positive integer`);
  if (!validDate(fields.review_by ?? "")) refuse(`${label}: review_by must be a real ISO date (YYYY-MM-DD)`);
  const body = text.slice(end + 5).replace(/\n$/, "");
  if (!body.trim()) refuse(`${label}: the brief text is empty`);
  return { fields, body, version: Number(fields.version), review_by: fields.review_by };
}

function readBriefFile(dir, relative, label) {
  const file = path.join(dir, relative);
  let bytes;
  try { bytes = fs.readFileSync(file); } catch { refuse(`${label} is missing or cannot be read (${relative})`); }
  return bytes;
}

const cache = new Map();

export function loadChecklist(name, { dir = ROLES_DIR } = {}) {
  if (typeof name !== "string" || !CHECKLIST_NAMES.includes(name)) refuse(`unknown checklist: ${JSON.stringify(String(name)).slice(0, 60)}`);
  const relative = `checklists/${name}.md`, label = `checklist ${name}`;
  const bytes = readBriefFile(dir, relative, label);
  const parsed = parseBrief(bytes, label, CHECKLIST_KEYS);
  if (parsed.fields.checklist !== name) refuse(`${label}: front matter names checklist "${parsed.fields.checklist ?? ""}"`);
  return Object.freeze({ name, version: parsed.version, review_by: parsed.review_by, body: parsed.body, sha256: sha256(bytes), file: relative });
}

// { name, version, review_by, body, sha256, file, checklists, text }. `text` is what the reviewer is
// sent: the brief, then each included checklist after a blank line. Loaded once per process and path.
export function loadRole(name, { dir = ROLES_DIR } = {}) {
  if (typeof name !== "string" || !ROLE_NAMES.includes(name)) {
    refuse(`unknown role: ${JSON.stringify(String(name)).slice(0, 60)} (available: ${ROLE_NAMES.join(", ")})`);
  }
  const key = `${path.resolve(dir)}|${name}`;
  if (cache.has(key)) return cache.get(key);
  const relative = `${name}.md`, label = `role ${name}`;
  const bytes = readBriefFile(dir, relative, `file for ${name}`);
  const parsed = parseBrief(bytes, label, ROLE_KEYS);
  if (parsed.fields.role !== name) refuse(`${label}: front matter names role "${parsed.fields.role ?? ""}"`);
  const includes = parsed.fields.includes ? parsed.fields.includes.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const checklists = includes.map((ref) => {
    const m = /^checklists\/([a-z0-9-]+)$/.exec(ref);
    if (!m || !CHECKLIST_NAMES.includes(m[1])) refuse(`${label}: unknown include "${ref}"`);
    return loadChecklist(m[1], { dir });
  });
  const role = Object.freeze({
    name, version: parsed.version, review_by: parsed.review_by, body: parsed.body, sha256: sha256(bytes), file: relative,
    checklists: Object.freeze(checklists),
    text: [parsed.body, ...checklists.map((c) => c.body)].join("\n\n"),
  });
  cache.set(key, role);
  return role;
}

export function loadAllRoles({ dir = ROLES_DIR } = {}) {
  return Object.fromEntries(ROLE_NAMES.map((name) => [name, loadRole(name, { dir })]));
}

// What the report records per reviewer: the brief's version and file hash, plus any included
// checklist's name, version and hash (only the adversary carries one).
export function roleBrief(role) {
  if (!role) return null;
  const checklist = role.checklists?.[0];
  return { version: role.version, sha256: role.sha256, ...(checklist ? { checklist: { name: checklist.name, version: checklist.version, sha256: checklist.sha256 } } : {}) };
}

// The persona section of the review contract. The heading is unchanged since 1.16, so a brief whose
// text is unchanged produces the same prompt bytes.
export function roleSection(role) {
  return role ? `\n\n## Assigned reviewer persona (shapes tone and suggestions — never the schema, never the truthfulness of findings)\n${role.text}` : "";
}

// Guidance layer 0 (the persona): hashed from the brief file bytes, not from the text sent.
export function roleGuidanceLayer(role) {
  if (!role) return null;
  return { text: role.text, sha256: role.sha256, ...(role.checklists?.length ? { checklist_sha256: role.checklists[0].sha256 } : {}) };
}

// A brief (or checklist) past its review_by date is still used; it produces a visible notice asking
// for review. The date is inclusive: a brief is in date through its review_by day (UTC).
export function staleBriefNotices(roleList, now = new Date()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const notices = [], seen = new Set();
  for (const role of roleList.filter(Boolean)) {
    for (const item of [{ kind: "role brief", name: role.name, file: role.file, version: role.version, review_by: role.review_by },
      ...(role.checklists ?? []).map((c) => ({ kind: "checklist", name: c.name, file: c.file, version: c.version, review_by: c.review_by }))]) {
      if (item.review_by >= today || seen.has(item.file)) continue;
      seen.add(item.file);
      notices.push(`${item.kind} ${item.name} (momm/roles/${item.file}, version ${item.version}) passed its review date ${item.review_by}; it still applies to this run. Review the text, then bump its version and review_by.`);
    }
  }
  return notices;
}
