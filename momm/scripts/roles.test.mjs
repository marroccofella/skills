// MOMM 1.17 B1 + C1: role briefs as versioned files, and the loophole checklist in the adversary brief.
// Run: node momm/scripts/roles.test.mjs. Zero provider calls: the one dispatcher run below reviews with
// the governor as its only route (self-excluded), with update checks off.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(scripts, "../..");
const source = fs.readFileSync(path.join(scripts, "multi-review.mjs"), "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const passed = [], failures = [];
async function test(name, fn) { try { await fn(); passed.push(name); } catch (error) { failures.push({ test: name, error: String(error?.message ?? error).slice(0, 1500) }); } }

let roles = null, guidance = null;
try { roles = await import("./roles.mjs"); } catch (error) { failures.push({ test: "roles.mjs loads", error: error.message }); }
guidance = await import("./guidance.mjs");
const need = () => assert.ok(roles, "momm/scripts/roles.mjs is missing");

// sha256 of each 1.16.1 persona string, taken from the PERSONAS constant before it moved to momm/roles.
const PERSONA_TEXT_SHA256 = {
  innovator: "90ae15236fa600260cfa6cc8b119b23d14956254bc626a31b67111816e7f574e",
  socratic: "69ef159065ba10bb78679424ee89d24d269a0a46d52037cf1cadcd9ac4af8ea5",
  futureproof: "bc0a971d9ae3e678863d4a085d9ce8fd8104e12f17c38385cc0c3d76076272ef",
  surgeon: "9378deeac7dd19748ff32af9c79f9a0609e25a570e3da56a68711cddb0390139",
  architect: "f1c9e552ddffcbb06dc6ae622b6e93100af012980081560008696bbf9fad0613",
  adversary: "c99ab771bc91dee7dbf15f4c41ac45e3d2a9bb6e2b9404ec7d60b6da9dad2d67",
  verifier: "64e4789f752fc3dea0d8a95c023774b47a5beed9e3ce73cdb06763c5514e3e19",
  fresheyes: "bd68c127adcdce2766b8488f71083b716d7c4dd53f672efb1ebe6cc3e58ac065",
};
// sha256 of buildContract("codex", { personas: { codex: <role> } }) in 1.16.1: the whole contract text.
const CONTRACT_SHA256 = {
  innovator: "f25f9d163a54c62aeed7ab3724a7a91dc903c4ca13849cb137c0647bb8c83136",
  socratic: "85946f6a204c461ff654a97009d5fa5572fb781b1a1c90674da8b1d2153b95fa",
  futureproof: "9c84d15d7b01c8d2312d82bd4b7245bed195d42188709610595cb58fbef5ac64",
  surgeon: "41a9ee71547ad2345140fe2d70048d3dceb09004a9903cfa7918fa99f2cf7935",
  architect: "0205000d00a86608a7080d048b6848eb9a6ca4bba871e002160cb7c51597be70",
  adversary: "c61d7867239742a5fcb5cfc0d02d477f13ccd35baf3297a5401122e4beef4987",
  verifier: "ec1c65ab87cbc385d1237e60b4db15b292b08757e72448dcea40adbcffd87f36",
  fresheyes: "a324117a55c242fd9baae1d9ac3cbac3868d455cd6d2cfa36a9ed553aca04165",
  none: "1d66995019712fac69e8e223d9525cc40b3c7898300b96037bb42484f40f3caa",
};
const ROLE_LIST = Object.keys(PERSONA_TEXT_SHA256);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "momm-roles-test-"));
const fixtureDir = (files) => {
  const dir = fs.mkdtempSync(path.join(temporary, "roles-"));
  fs.mkdirSync(path.join(dir, "checklists"));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
};
const brief = (role, { version = "1", reviewBy = "2027-03-29", extra = "", body = "Persona text." } = {}) =>
  `---\nrole: ${role}\nversion: ${version}\nreview_by: ${reviewBy}\n${extra}---\n${body}\n`;

// The production contract builder, not a copy: the prompt head plus the persona/contract functions.
function contractBuilder() {
  const head = source.slice(source.indexOf("const REVIEW_PROMPT = `"), source.indexOf("const REVIEW_JSON_SCHEMA"));
  const body = source.slice(source.indexOf("const DEFAULT_PERSONAS = {"), source.indexOf("function inertPathLabel("));
  assert.ok(head.length > 100 && body.includes("function buildContract("), "contract source not found");
  return vm.runInNewContext(`${head}\n${body}\n({ buildContract, personaFor })`, { ...(roles ?? {}) });
}

try {
  await test("B1: every 1.16.1 persona loads from momm/roles with byte-identical text", () => {
    need();
    assert.deepEqual([...roles.ROLE_NAMES].sort(), [...ROLE_LIST].sort());
    for (const name of ROLE_LIST) {
      const role = roles.loadRole(name);
      assert.equal(role.name, name);
      assert.equal(sha256(role.body), PERSONA_TEXT_SHA256[name], `${name} body changed`);
    }
  });

  await test("B1: each brief records role, version and review date; sha256 covers the file bytes", () => {
    need();
    for (const name of ROLE_LIST) {
      const file = path.join(repo, "momm", "roles", `${name}.md`);
      const role = roles.loadRole(name);
      assert.equal(role.version, 1);
      assert.equal(role.review_by, "2027-03-29");
      assert.equal(role.sha256, sha256(fs.readFileSync(file)), `${name} sha256 is not of the file bytes`);
      assert.deepEqual(roles.roleBrief(role).version, 1);
      assert.equal(roles.roleBrief(role).sha256, role.sha256);
    }
  });

  await test("B1: an unknown or path-like role is refused", () => {
    need();
    for (const name of ["wizard", "../surgeon", "surgeon.md", "", "none", "constructor", "__proto__"]) {
      assert.throws(() => roles.loadRole(name), /unknown role/i, JSON.stringify(name));
    }
  });

  await test("B1: a missing brief file is refused", () => {
    need();
    const dir = fixtureDir({});
    assert.throws(() => roles.loadRole("surgeon", { dir }), /role brief .*surgeon.*(missing|cannot be read)/i);
  });

  await test("B1: missing or invalid front matter and empty bodies are refused", () => {
    need();
    const cases = {
      "no front matter": "Persona text only.\n",
      "unterminated front matter": "---\nrole: surgeon\nversion: 1\nreview_by: 2027-03-29\nPersona text.\n",
      "missing version": "---\nrole: surgeon\nreview_by: 2027-03-29\n---\nPersona text.\n",
      "version zero": brief("surgeon", { version: "0" }),
      "version not an integer": brief("surgeon", { version: "1.5" }),
      "missing review date": "---\nrole: surgeon\nversion: 1\n---\nPersona text.\n",
      "impossible review date": brief("surgeon", { reviewBy: "2027-02-30" }),
      "review date not ISO": brief("surgeon", { reviewBy: "29/03/2027" }),
      "role names another file": brief("architect"),
      "unknown key": brief("surgeon", { extra: "model: gpt\n" }),
      "duplicate key": brief("surgeon", { extra: "version: 2\n" }),
      "unknown include": brief("surgeon", { extra: "includes: checklists/unknown\n" }),
      "empty body": brief("surgeon", { body: "   " }),
    };
    for (const [label, text] of Object.entries(cases)) {
      const dir = fixtureDir({ "surgeon.md": text });
      assert.throws(() => roles.loadRole("surgeon", { dir }), /role brief/i, label);
    }
    // Positive control: the same fixture shape loads when it is well formed.
    const ok = roles.loadRole("surgeon", { dir: fixtureDir({ "surgeon.md": brief("surgeon") }) });
    assert.equal(ok.body, "Persona text.");
  });

  await test("B1: a brief past its review date still loads and yields a visible notice, not a refusal", () => {
    need();
    const dir = fixtureDir({ "surgeon.md": brief("surgeon", { reviewBy: "2026-01-31" }), "architect.md": brief("architect", { reviewBy: "2027-03-29" }) });
    const stale = roles.loadRole("surgeon", { dir }), fresh = roles.loadRole("architect", { dir });
    const notices = roles.staleBriefNotices([stale, fresh], new Date("2026-09-29T12:00:00Z"));
    assert.equal(notices.length, 1);
    assert.match(notices[0], /surgeon/);
    assert.match(notices[0], /2026-01-31/);
    assert.match(notices[0], /still (applies|in use)/i);
    // The review date itself is still in date; the day after is not.
    assert.deepEqual(roles.staleBriefNotices([fresh], new Date("2027-03-29T23:00:00Z")), []);
    assert.equal(roles.staleBriefNotices([fresh], new Date("2027-03-30T00:00:01Z")).length, 1);
    // The shipped briefs are in date today.
    assert.deepEqual(roles.staleBriefNotices(Object.values(roles.loadAllRoles()), new Date("2026-09-29T12:00:00Z")), []);
  });

  await test("C1: the loophole checklist names four themes, five techniques and the quote rule", () => {
    need();
    const checklist = roles.loadRole("adversary").checklists.find((c) => c.name === "loophole");
    assert.ok(checklist, "adversary does not include the loophole checklist");
    assert.equal(checklist.version, 1);
    assert.equal(checklist.review_by, "2027-03-29");
    assert.equal(checklist.sha256, sha256(fs.readFileSync(path.join(repo, "momm", "roles", "checklists", "loophole.md"))));
    const lines = checklist.body.split("\n");
    for (const theme of ["Letter against spirit", "Categorical arbitrage", "Temporal latency", "Compositional blind spots"]) {
      assert.equal(lines.filter((line) => line.startsWith(`- ${theme}:`)).length, 1, `${theme}: one line`);
    }
    for (const technique of ["boundary values", "intent anchoring", "invariants", "payoff auditing", "sunset and review triggers"]) {
      assert.ok(checklist.body.toLowerCase().includes(technique), technique);
    }
    assert.match(checklist.body, /quote the artifact/);
    assert.match(checklist.body, /concrete sequence of steps/);
  });

  await test("C1: only the adversary prompt carries the checklist, and its role_brief records the checklist hash", () => {
    need();
    const { buildContract } = contractBuilder();
    const checklist = roles.loadRole("adversary").checklists[0];
    for (const name of [...ROLE_LIST, "none"]) {
      const contract = buildContract("codex", { personas: { codex: name } });
      assert.equal(contract.includes(checklist.body), name === "adversary", `${name}: checklist ${name === "adversary" ? "missing" : "present"}`);
    }
    // Defaults: antigravity is the adversary; no other default route gets the checklist.
    for (const agent of ["codex", "claude", "gemini", "antigravity", "copilot", "grok"]) {
      assert.equal(buildContract(agent, {}).includes(checklist.body), agent === "antigravity", agent);
    }
    const adversaryBrief = roles.roleBrief(roles.loadRole("adversary"));
    assert.deepEqual(adversaryBrief.checklist, { name: "loophole", version: 1, sha256: checklist.sha256 });
    for (const name of ROLE_LIST.filter((n) => n !== "adversary")) assert.equal(roles.roleBrief(roles.loadRole(name)).checklist, undefined, name);
    // Checklists are not roles: a reviewer cannot be assigned one directly.
    assert.throws(() => roles.loadRole("loophole"), /unknown role/i);
  });

  await test("B1: prompts are byte-identical to 1.16.1 except the adversary checklist", () => {
    need();
    const { buildContract } = contractBuilder();
    for (const name of [...ROLE_LIST, "none"]) {
      const contract = buildContract("codex", { personas: { codex: name } });
      if (name !== "adversary") { assert.equal(sha256(contract), CONTRACT_SHA256[name], `${name} prompt changed`); continue; }
      const checklist = roles.loadRole("adversary").checklists[0];
      assert.ok(contract.endsWith(`\n\n${checklist.body}`), "the checklist is appended after the adversary brief");
      assert.equal(sha256(contract.slice(0, -(checklist.body.length + 2))), CONTRACT_SHA256.adversary, "adversary brief text changed");
    }
  });

  await test("B1: report rows carry role and role_brief; the governor row carries neither", () => {
    need();
    const a = source.indexOf("results.map((result) => ({", source.indexOf("source_snapshot: sourceSnapshot"));
    const b = source.indexOf("    })),", a);
    assert.ok(a > 0 && b > a);
    const surgeon = roles.loadRole("surgeon"), adversary = roles.loadRole("adversary");
    const options = { governor: "claude", personas: { antigravity: "adversary" }, roleBriefs: { codex: roles.roleBrief(surgeon), antigravity: roles.roleBrief(adversary) } };
    const { personaFor } = contractBuilder();
    const rows = vm.runInNewContext(source.slice(a, b + 7), {
      results: [{ agent: "codex", status: "success" }, { agent: "antigravity", status: "timeout" }, { agent: "claude", status: "self_excluded" }],
      options, personaFor, LOGIN_HINTS: {}, clipped: (s, n) => String(s).slice(0, n),
    });
    assert.equal(rows[0].role, "surgeon");
    assert.equal(rows[0].persona, "surgeon", "persona is kept for older readers");
    assert.deepEqual(JSON.parse(JSON.stringify(rows[0].role_brief)), { version: 1, sha256: surgeon.sha256 });
    assert.equal(rows[1].role, "adversary");
    assert.equal(rows[1].role_brief.checklist.sha256, adversary.checklists[0].sha256);
    assert.equal(rows[2].role, null);
    assert.equal(rows[2].role_brief, null);
  });

  await test("B1: the guidance persona layer is hashed from the brief file bytes", () => {
    need();
    const home = fs.mkdtempSync(path.join(temporary, "home-")), cwd = fs.mkdtempSync(path.join(temporary, "project-"));
    const surgeon = roles.loadRole("surgeon"), adversary = roles.loadRole("adversary");
    const resolved = guidance.resolveGuidance({ cwd, home, routes: ["codex", "antigravity", "grok"], personas: { codex: roles.roleGuidanceLayer(surgeon), antigravity: roles.roleGuidanceLayer(adversary), grok: null } });
    assert.deepEqual(resolved.routes.codex.layers[0], { name: "persona", sha256: surgeon.sha256, chars: surgeon.text.length });
    assert.equal(resolved.routes.antigravity.layers[0].sha256, adversary.sha256);
    assert.equal(resolved.routes.antigravity.layers[0].checklist_sha256, adversary.checklists[0].sha256);
    assert.ok(!resolved.routes.grok.layers.some((layer) => layer.name === "persona"));
    const fields = guidance.guidanceReportFields(resolved).guidance.routes;
    assert.deepEqual(fields.codex.layers[0], { name: "persona", sha256: surgeon.sha256 });
    assert.deepEqual(fields.antigravity.layers[0], { name: "persona", sha256: adversary.sha256, checklist_sha256: adversary.checklists[0].sha256 });
    // A plain string persona (older callers) is still hashed as text.
    const legacy = guidance.resolveGuidance({ cwd, home, routes: ["codex"], personas: { codex: "PLAIN" } });
    assert.deepEqual(legacy.routes.codex.layers[0], { name: "persona", sha256: sha256("PLAIN"), chars: 5 });
  });

  await test("B1: --personas keeps its syntax and refuses an unknown role", () => {
    const run = (...args) => spawnSync(process.execPath, [path.join(scripts, "multi-review.mjs"), ...args], { encoding: "utf8", windowsHide: true, timeout: 30000, env: { ...process.env, NO_UPDATE_CHECK: "1" } });
    const good = run("--personas", "copilot=socratic,grok=none,codex=adversary", "--help");
    assert.equal(good.status, 0, good.stderr);
    const bad = run("--personas", "codex=wizard", "--help");
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Unknown persona: wizard \(available: .*surgeon.*, none\)/);
    const checklistAsRole = run("--personas", "codex=loophole", "--help");
    assert.equal(checklistAsRole.status, 1);
  });

  await test("B1: a stale brief is shown in the report notices and on stderr during a real (provider-free) run", () => {
    need();
    // A copy of the skill with one brief past its review date; the governor is the only route, so no
    // provider is ever launched.
    const copy = fs.mkdtempSync(path.join(temporary, "skill-"));
    fs.cpSync(path.join(repo, "momm"), path.join(copy, "momm"), { recursive: true, filter: (from) => !from.includes(`${path.sep}.ensemble_reviews`) });
    const staleFile = path.join(copy, "momm", "roles", "futureproof.md");
    fs.writeFileSync(staleFile, fs.readFileSync(staleFile, "utf8").replace("review_by: 2027-03-29", "review_by: 2026-01-31"));
    const project = fs.mkdtempSync(path.join(temporary, "project-"));
    fs.writeFileSync(path.join(project, "input.txt"), "const value = 1;\n");
    const run = (...extra) => spawnSync(process.execPath, [path.join(copy, "momm", "scripts", "multi-review.mjs"), "--governor", "codex", "--reviewers", "codex", "--input", "input.txt", "--no-ui", ...extra],
      { cwd: project, encoding: "utf8", windowsHide: true, timeout: 60000, env: { ...process.env, NO_UPDATE_CHECK: "1", GOVERNING_AGENT: "" } });
    const streamed = run("--stream");
    const report = JSON.parse(streamed.stdout);
    assert.ok(Array.isArray(report.notices) && report.notices.some((n) => /futureproof/.test(n) && /2026-01-31/.test(n)), JSON.stringify(report.notices));
    const events = streamed.stderr.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.ok(events.some((e) => e.event === "role.notice" && /futureproof/.test(e.notice)), "stream event missing");
    const plain = run();
    assert.match(plain.stderr, /momm roles: .*futureproof/);
    assert.equal(report.reviewers.find((r) => r.agent === "codex").role, null, "the governor has no role");
  });

  await test("B1 with B4: a changed role brief makes a review stale; the recorded hash is compared with the installed file", async () => {
    need();
    const { reviewStaleness } = await import("./governor.mjs");
    const surgeon = roles.loadRole("surgeon"), adversary = roles.loadRole("adversary");
    const report = (codexBrief, extra = {}) => ({ governor: "claude", guidance: { routes: {} },
      reviewers: [{ agent: "codex", status: "success", role: "surgeon", role_brief: codexBrief }, { agent: "antigravity", status: "success", role: "adversary", role_brief: roles.roleBrief(adversary) }, { agent: "grok", status: "success", persona: "innovator" }],
      ...extra });
    const fresh = reviewStaleness(report(roles.roleBrief(surgeon)), repo, { installRoot: repo });
    for (const name of ["reviewers.codex.role_brief", "reviewers.antigravity.role_brief", "reviewers.antigravity.role_brief.checklist"]) assert.ok(fresh.matched.includes(name), `${name}: ${JSON.stringify(fresh)}`);
    assert.ok(!fresh.changed.some((n) => n.includes("role_brief")), JSON.stringify(fresh.changed));
    assert.ok(![...fresh.matched, ...fresh.changed, ...fresh.unknown].some((n) => n.startsWith("reviewers.grok.role_brief")), "a report sealed before roles has no brief to compare");
    const edited = reviewStaleness(report({ version: 1, sha256: "0".repeat(64) }), repo, { installRoot: repo });
    assert.ok(edited.changed.includes("reviewers.codex.role_brief") && edited.stale, JSON.stringify(edited));
    const unrecorded = reviewStaleness(report(null), repo, { installRoot: repo });
    assert.ok(unrecorded.unknown.includes("reviewers.codex.role_brief"), "a role without its brief hash is unknown, never a match");
    const covered = reviewStaleness(report(roles.roleBrief(surgeon), { covers: [{ agent: "claude", cover: true, covering_for: "codex", role: "architect", status: "success", role_brief: { version: 1, sha256: "1".repeat(64) } }] }), repo, { installRoot: repo });
    assert.ok(covered.changed.includes("covers.claude.codex.role_brief"), JSON.stringify(covered));
  });

  await test("B1: packaging carries momm/roles (installer links the skill directory; update preview and privacy scan include it)", () => {
    const install = fs.readFileSync(path.join(repo, "install.mjs"), "utf8");
    assert.match(install, /linkAll\(/, "the installer links whole skill directories");
    assert.match(fs.readFileSync(path.join(scripts, "update.mjs"), "utf8"), /"momm\/roles"/, "the update preview must show role brief changes");
    assert.match(fs.readFileSync(path.join(repo, "scripts", "momm-release-privacy.test.mjs"), "utf8"), /publicTextFiles\('momm\/roles'\)/, "the release privacy scan must cover the role briefs");
    for (const name of [...ROLE_LIST, "checklists/loophole"]) {
      const file = path.join(repo, "momm", "roles", `${name}.md`);
      assert.ok(fs.statSync(file).isFile(), file);
      assert.ok(!fs.readFileSync(file).includes(13), `${name}: LF line endings`);
    }
  });
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log(JSON.stringify({ passed, failures }, null, 2));
if (failures.length) process.exitCode = 1;
