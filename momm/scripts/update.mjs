#!/usr/bin/env node
// The recovery copy is deliberately self-contained: builtins only, never imports
// from the checkout it replaces. Keep the receipt outside versioned files.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

export const REMOTE = "https://github.com/marroccofella/skills.git";
export const MANIFEST_URL = "https://raw.githubusercontent.com/marroccofella/skills/main/versions.json";
export const SIGNER = "https://github.com/marroccofella/skills/.github/workflows/momm-release.yml@refs/heads/main";
export const ISSUER = "https://token.actions.githubusercontent.com";
const ENTRY = fileURLToPath(import.meta.url);
const VERSION = /^\d+\.\d+\.\d+$/;
const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40,64}$/;
const TARGETS = new Set(["codex", "claude", "gemini", "antigravity"]);
const okLink = r => ["linked", "already_linked", "canonical"].includes(r.status);
export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export const safeText = value => String(value).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
export function run(command, args, cwd, options = {}) {
  const p = spawnSync(command, args, { cwd, encoding: "utf8", shell: false,
    windowsHide: true, timeout: 60_000, maxBuffer: 32 * 1024 * 1024, ...options });
  if (p.error || p.status !== 0) throw new Error(`${command} failed: ${safeText(p.error?.message || p.stderr || p.stdout).slice(0, 3000)}`);
  return p.stdout;
}
export const git = (root, ...args) => run("git", args, root).trim();
export function repoRoot(start) { return git(start, "rev-parse", "--show-toplevel"); }
export function stateDir(root) {
  return path.resolve(root, git(root, "rev-parse", "--git-path", "momm"));
}
function regular(file, optional = false) {
  try {
    const s = fs.lstatSync(file);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink > 1) throw new Error(`Unsafe local state file: ${file}`);
    return true;
  } catch (e) { if (optional && e.code === "ENOENT") return false; throw e; }
}
function directory(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink()) throw new Error("Unsafe update state directory");
}
export function atomic(file, data) {
  regular(file, true);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, "wx", 0o600);
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function readJSON(file) { regular(file); return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJSON(file, value) { atomic(file, `${JSON.stringify(value, null, 2)}\n`); }
export function readLock(root, required = true) {
  const file = path.join(stateDir(root), "momm.lock");
  if (!regular(file, true)) {
    if (!required) return null;
    throw new Error("No momm.lock installation receipt. Run node momm/scripts/install.mjs --target <your-harness> first; MOMM will not guess your harness.");
  }
  const lock = readJSON(file);
  if (lock.schema !== "momm-lock/1" || !["stable", "pinned", "main"].includes(lock.channel) ||
      !["install.mjs", "momm/scripts/install.mjs"].includes(lock.installer) ||
      !Array.isArray(lock.targets) || lock.targets.some(t => !TARGETS.has(t)) ||
      !Array.isArray(lock.custom_dirs) || lock.custom_dirs.some(d => typeof d !== "string" || !path.isAbsolute(d)) ||
      (!lock.targets.length && !lock.custom_dirs.length)) throw new Error("Invalid momm.lock; restore the receipt or repeat explicit installation.");
  return lock;
}
function current(root) {
  const version = JSON.parse(fs.readFileSync(path.join(root, "versions.json"), "utf8")).momm;
  return { version, commit: git(root, "rev-parse", "HEAD"), dispatcher_sha256: hash(fs.readFileSync(path.join(root, "momm/scripts/multi-review.mjs"))), updater_sha256: hash(fs.readFileSync(path.join(root, "momm/scripts/update.mjs"))), protocol_sha256: hash(fs.readFileSync(path.join(root, "momm/SKILL.md"))) };
}
export function recordInstall(root, installer, results, { dryRun = false, skills = ["momm"] } = {}) {
  if (dryRun) return null;
  try { root = repoRoot(root); }
  catch { return { updater_available: false, reason: "Installation linked successfully, but this is not an accessible Git clone. Explicit updates require a Git clone; no harness receipt was guessed." }; }
  const dir = stateDir(root);
  // During replay only the parent transaction is allowed to commit the receipt.
  if (fs.existsSync(path.join(dir, "transaction.json"))) return null;
  const targets = [], custom_dirs = [], installations = [];
  for (const row of results) {
    const links = row.links || [row];
    if (!links.some(r => (!r.skill || r.skill === "momm") && okLink(r))) continue;
    const rowSkills = [...new Set(links.filter(okLink).map(r => r.skill || "momm"))];
    if (TARGETS.has(row.target)) {
      targets.push(row.target);
      installations.push({ target: row.target, installer, skills: rowSkills });
    }
    if (row.target === "custom") {
      const dest = links.find(r => (!r.skill || r.skill === "momm") && okLink(r))?.destination;
      if (dest) { custom_dirs.push(path.dirname(dest)); installations.push({ target: "custom", custom_dir: path.dirname(dest), installer, skills: rowSkills }); }
    }
  }
  if (!targets.length && !custom_dirs.length) return null;
  directory(dir);
  const previous = readLock(root, false);
  const scopes = [...(previous?.installations || [])];
  for (const operation of installations) {
    const same = scopes.find(s => s.target === operation.target && s.custom_dir === operation.custom_dir);
    if (same) { same.skills = [...new Set([...same.skills, ...operation.skills])]; if (operation.installer === "install.mjs") same.installer = operation.installer; }
    else scopes.push(operation);
  }
  // A later install adds explicitly successful harnesses, not newly detected ones.
  const lock = { ...previous, schema: "momm-lock/1", repo_root: root,
    channel: previous?.channel || "stable", installer: previous?.installer === "install.mjs" ? previous.installer : installer,
    skills: [...new Set([...(previous?.skills || []), ...skills])],
    installations: scopes,
    targets: [...new Set([...(previous?.targets || []), ...targets])],
    custom_dirs: [...new Set([...(previous?.custom_dirs || []), ...custom_dirs])],
    current: current(root), installed_at: new Date().toISOString() };
  writeJSON(path.join(dir, "momm.lock"), lock);
  atomic(path.join(dir, "update.mjs"), fs.readFileSync(ENTRY));
  return { lock: path.join(dir, "momm.lock"), recovery: path.join(dir, "update.mjs"), targets: lock.targets };
}
export function updateCheckDisabled(env = process.env) {
  return ["NO_UPDATE_CHECK", "MOMM_NO_UPDATE_CHECK", "DO_NOT_TRACK"].some(k => {
    const v = String(env[k] || "").toLowerCase(); return v !== "" && v !== "0" && v !== "false";
  });
}
export function newer(a, b) {
  if (!VERSION.test(a) || !VERSION.test(b)) return false;
  const aa = a.split(".").map(Number), bb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i];
  return false;
}
export async function manifest(fetcher = fetch) {
  const res = await fetcher(MANIFEST_URL, { signal: AbortSignal.timeout(5000), redirect: "error" });
  if (!res.ok) throw new Error(`Release manifest unavailable (HTTP ${res.status}); nothing installed.`);
  const body = await res.text();
  if (Buffer.byteLength(body) > 1024 * 1024) throw new Error("Release manifest exceeds 1 MiB");
  const m = JSON.parse(body);
  if (!VERSION.test(m.momm)) throw new Error("Invalid manifest version");
  return m;
}
export async function dailyCheck(installed, { stream = false, root, env = process.env, fetcher = fetch, now = Date.now() } = {}) {
  if (stream || updateCheckDisabled(env)) return null;
  let claim, fd;
  try {
    const cacheDir = root ? stateDir(root) : path.join(os.homedir(), ".cache", "momm");
    directory(cacheDir);
    if (root && readLock(root, false)?.channel === "pinned") return null;
    claim = path.join(cacheDir, "version-check.active");
    if (regular(claim, true)) {
      let owner;
      try { owner = readJSON(claim); } catch {}
      if (Number.isInteger(owner?.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); }
        catch (e) { if (e.code === "ESRCH") fs.unlinkSync(claim); }
      } else if (Date.now() - fs.statSync(claim).mtimeMs > 60_000) {
        // Recover the legacy empty claim, or a crash between creation and
        // writing its owner. Never steal a recently created or live claim.
        fs.unlinkSync(claim);
      }
    }
    try { fd = fs.openSync(claim, "wx", 0o600); }
    catch { return null; }
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }));
    const cache = path.join(cacheDir, "version-check.json");
    if (regular(cache, true)) {
      const c = readJSON(cache);
      // Cache stores notice delivery too: no repeated line on each invocation.
      if (now - c.checked_at < 864e5 && c.installed === installed) return null;
    }
    // Claim the day's check before the request, so concurrent runs do not chatter.
    writeJSON(cache, { checked_at: now, installed });
    const m = await manifest(fetcher);
    return newer(m.momm, installed) ? m.momm : null;
  } catch { return null; }
  finally { if (fd !== undefined) { fs.closeSync(fd); try { fs.unlinkSync(claim); } catch {} } }
}
export function provenance(root) {
  let bytes = {};
  try { bytes = { dispatcher_sha256: hash(fs.readFileSync(path.join(root, "momm/scripts/multi-review.mjs"))), updater_sha256: hash(fs.readFileSync(path.join(root, "momm/scripts/update.mjs"))), protocol_sha256: hash(fs.readFileSync(path.join(root, "momm/SKILL.md"))), executable_hash_covers: "installed_file_bytes" }; } catch {}
  try {
    const c = current(root), lock = readLock(root, false);
    return { dispatcher_sha256: c.dispatcher_sha256, protocol_sha256: c.protocol_sha256,
      updater_sha256: c.updater_sha256,
      executable_hash_covers: "installed_file_bytes", release_commit: c.commit,
      release_verified: Boolean(lock?.current?.verified && lock.current.commit === c.commit && lock.current.dispatcher_sha256 === c.dispatcher_sha256 && lock.current.updater_sha256 === c.updater_sha256 && lock.current.protocol_sha256 === c.protocol_sha256 && !git(root, "status", "--porcelain", "--untracked-files=no")) };
  } catch { return { ...bytes, release_verified: false }; }
}
export function parse(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["--dry-run", "--apply", "--rollback", "--yes", "--accept-protocol", "--help"].includes(a)) o[a.slice(2).replaceAll("-", "_")] = true;
    else if (["--version", "--channel", "--repo"].includes(a)) {
      const value = argv[++i]; if (!value || value.startsWith("--")) throw new Error(`Missing value for ${a}`);
      o[a.slice(2)] = value;
    } else throw new Error(`Unknown update option: ${a}. No auto-update option exists.`);
  }
  if (o.version && !VERSION.test(o.version)) throw new Error("Use an exact x.y.z release version");
  if (o.channel && !["stable", "pinned", "main"].includes(o.channel)) throw new Error("Channel must be stable, pinned or main");
  if ([o.dry_run, o.apply, o.rollback].filter(Boolean).length > 1) throw new Error("Choose only one of --dry-run, --apply or --rollback");
  if (o.rollback && (o.channel || o.version)) throw new Error("Rollback uses the locally retained receipt, not a channel or version");
  if (o.yes && !o.apply && !o.rollback) throw new Error("--yes requires --apply or --rollback");
  return o;
}
// Digest of every tracked blob, including mode and path, except the manifest
// containing this digest. Git blobs avoid CRLF/checkout-filter differences.
export function treeHash(root, ref) {
  const listing = run("git", ["ls-tree", "-rz", "--full-tree", ref], root);
  const h = createHash("sha256");
  for (const line of listing.split("\0").filter(Boolean)) {
    const m = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
    if (!m) throw new Error("Invalid git tree listing");
    const [, mode, type, oid, name] = m;
    if (name === "versions.json") continue;
    if (type !== "blob" || mode === "120000") throw new Error("Release packages must not contain symlinks or submodules");
    const bytes = run("git", ["cat-file", "blob", oid], root, { encoding: null });
    h.update(`${mode} ${name}\0${bytes.length}\0`); h.update(bytes); h.update("\0");
  }
  return h.digest("hex");
}
export function signingEnv(input = process.env) {
    const env = { ...input };
    for (const k of Object.keys(env)) if (/^(GIT_|GITSIGN_|SIGSTORE_|COSIGN_|TUF_)/.test(k.toUpperCase())) delete env[k];
    // gitsign reads `git config --get-regexp .*` itself. Override that input,
    // including local/template config, so custom trust roots cannot enter here.
    const nullFile = process.platform === "win32" ? "NUL" : "/dev/null";
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: nullFile, GIT_CONFIG: nullFile });
    return env;
}
export function verifySignature(root, ref, channel) {
  try {
    run("gitsign", ["verify-tag", "--certificate-identity", SIGNER,
      "--certificate-oidc-issuer", ISSUER, "--certificate-github-workflow-repository", "marroccofella/skills",
      "--certificate-github-workflow-ref", "refs/heads/main", ref], root, { timeout: 120_000, env: signingEnv() });
  } catch (e) { throw new Error(`Trusted release signature not verified. Install gitsign from https://github.com/sigstore/gitsign and retry; never bypass this gate. ${e.message}`); }
}
function clean(root) {
  if (git(root, "status", "--porcelain", "--untracked-files=all")) throw new Error("Checkout has local changes or untracked files. Commit or move them yourself; MOMM will not stash, overwrite or discard them.");
}
function policyDiff(root, from, to) {
  // Dispatcher contains default rules and personas. Show its whole diff rather
  // than claiming a heuristic extraction detects every policy change.
  return run("git", ["diff", "--no-ext-diff", "--no-textconv", from, to, "--", "momm/SKILL.md", "momm/scripts/multi-review.mjs", ":(glob)**/.reviewrules", ":(glob)**/*persona*"], root);
}
function checkout(root, commit) {
  if (!COMMIT.test(commit)) throw new Error("Invalid recovery commit");
  git(root, "-c", "core.hooksPath=", "checkout", "--no-overwrite-ignore", "--detach", commit);
}
function assertInstalled(root, expected) {
  if (git(root, "rev-parse", "HEAD") !== expected.commit || current(root).version !== expected.version) throw new Error("Checkout changed during harness replay; refusing to claim installation success.");
  clean(root);
}
function reinstall(root, lock) {
  if (!Array.isArray(lock.installations) || !lock.installations.length) throw new Error("Receipt lacks per-harness installation scopes; rerun the original explicit installer.");
  for (const scope of lock.installations) {
    if (!["install.mjs", "momm/scripts/install.mjs"].includes(scope.installer) || !Array.isArray(scope.skills) || scope.skills.some(s => !/^[A-Za-z0-9._-]+$/.test(s)) || !(TARGETS.has(scope.target) || (scope.target === "custom" && path.isAbsolute(scope.custom_dir || "")))) throw new Error("Invalid per-harness installation scope");
    const args = [path.join(root, scope.installer)];
    if (scope.installer === "install.mjs") args.push("--skills", scope.skills.join(","));
    if (scope.target === "custom") args.push("--custom-dir", scope.custom_dir); else args.push("--target", scope.target);
    const output = JSON.parse(run(process.execPath, args, root, { timeout: 180_000 }));
    const rows = output.results.flatMap(r => r.links ? r.links.map(l => ({ ...l, target: r.target })) : [r]);
    for (const skill of scope.skills) if (!rows.some(r => r.target === scope.target && (r.skill || "momm") === skill && okLink(r) && (scope.target !== "custom" || path.resolve(r.destination || "") === path.join(scope.custom_dir, skill)))) throw new Error(`Harness replay did not verify ${skill} for ${scope.target}`);
  }
}
async function consent(o, message) {
  if (o.yes) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("No interactive terminal. Review --dry-run, then explicitly use --apply --yes (and --accept-protocol when required).");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { if ((await rl.question(`${message} Type yes: `)).trim() !== "yes") throw new Error("Cancelled; checkout unchanged."); }
  finally { rl.close(); }
}
function exclusive(dir, action) {
  directory(dir);
  const file = path.join(dir, "update.active");
  let fd;
  if (regular(file, true)) {
    const active = readJSON(file);
    if (Number.isInteger(active.pid) && active.pid > 0) {
      try { process.kill(active.pid, 0); }
      catch (e) { if (e.code === "ESRCH") fs.unlinkSync(file); }
    }
  }
  try { fd = fs.openSync(file, "wx", 0o600); } catch { throw new Error(`Another update may be active. Inspect ${file}; do not remove it while its process is running.`); }
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
  return Promise.resolve().then(action).finally(() => { fs.closeSync(fd); fs.unlinkSync(file); });
}
export async function update(argv, dependencies = {}) {
  const o = parse(argv), log = dependencies.log || (s => process.stdout.write(`${safeText(s)}\n`));
  if (o.help) { log("MOMM update: [--dry-run | --apply | --rollback] [--version x.y.z] [--channel stable|pinned|main] [--accept-protocol] [--yes]\nDefault: manifest + changelog only. No automatic updates. Recovery: node <git-dir>/momm/update.mjs --rollback --yes"); return; }
  const siblingLock = path.join(path.dirname(ENTRY), "momm.lock");
  const start = o.repo || (fs.existsSync(siblingLock) ? readJSON(siblingLock).repo_root : path.resolve(path.dirname(ENTRY), "../.."));
  const root = repoRoot(start), dir = stateDir(root), lock = readLock(root);
  const lockFile = path.join(dir, "momm.lock"), journalFile = path.join(dir, "transaction.json");
  const installer = dependencies.reinstall || reinstall;
  if (o.rollback) return exclusive(dir, async () => {
    const journal = regular(journalFile, true) ? readJSON(journalFile) : null;
    const previous = journal?.before || lock.previous;
    if (!previous?.current?.commit || !SHA.test(previous.current.tree_sha256 || "")) throw new Error("No retained, hashed previous installation exists. Nothing changed.");
    clean(root);
    const actualHead = git(root, "rev-parse", "HEAD");
    if (![lock.current.commit, previous.current.commit, journal?.candidate, journal?.from?.commit].filter(Boolean).includes(actualHead)) throw new Error("An unrelated checkout is active. Restore the interrupted update checkout yourself before recovery; MOMM will not replace it.");
    if (treeHash(root, previous.current.commit) !== previous.current.tree_sha256) throw new Error("Retained rollback object failed integrity verification");
    log(`Offline rollback to ${previous.current.version}, commit ${previous.current.commit}; original harnesses: ${previous.targets.join(", ") || "custom"}. No release download.`);
    await consent(o, "Restore this installation?");
    if (!journal) writeJSON(journalFile, { schema: "momm-transaction/1", before: previous, from: lock.current, stage: "rollback" });
    checkout(root, previous.current.commit);
    installer(root, previous);
    assertInstalled(root, previous.current);
    writeJSON(lockFile, { ...previous, current: { ...previous.current, ...current(root) }, previous: null, recovered_at: new Date().toISOString() });
    fs.unlinkSync(journalFile);
    log("Rollback verified. Recovery command remains available outside the checkout.");
  });
  if (fs.existsSync(journalFile)) throw new Error("An interrupted update needs recovery. Run the retained update.mjs --rollback --yes before another update.");
  if (o.channel && !o.apply && !o.dry_run && !o.version) {
    await exclusive(dir, async () => writeJSON(lockFile, { ...lock, channel: o.channel }));
    log(`Channel saved: ${o.channel}. Installed code and protocol unchanged.`); return;
  }
  const channel = o.channel || lock.channel;
  log(`Network: GET ${MANIFEST_URL} (release information only).`);
  const m = await (dependencies.manifest || manifest)();
  const version = o.version || m.momm;
  log(`Installed ${lock.current.version}; published ${m.momm}; channel ${channel}.`);
  for (const r of (m.momm_releases || []).filter(r => VERSION.test(r.version) && newer(r.version, lock.current.version) && !newer(r.version, version))) {
    log(`${r.version}: ${(r.changes || []).map(safeText).join("\n  ")}`);
  }
  if (!o.apply && !o.dry_run) { log("No code fetched or installed. Next: update --dry-run, then explicitly update --apply. Agents must stop and ask; never self-apply."); return; }
  if (channel === "pinned" && !o.version) throw new Error("Pinned channel: specify --version x.y.z. No code fetched.");
  const release = (m.momm_releases || []).find(r => r.version === version);
  if (channel !== "main" && (!release || release.tag !== `momm-${version}` || !SHA.test(release.sha256 || "") || release.hash_covers !== "git-tree-blobs-excluding-versions/1")) throw new Error("This release has no verifiable signed-package metadata. Legacy unsigned releases cannot be installed by the updater.");
  const ref = channel === "main" ? "refs/heads/main" : `refs/tags/${release.tag}`;
  log(`Network: fetch ${REMOTE}, ${ref}, into temporary staging only. Signature check contacts Sigstore trust/log services. No provider credentials or project source are sent.`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "momm-update-"));
  try {
    git(temp, "init", "--bare");
    const candidateRef = channel === "main" ? "refs/momm/candidate" : `refs/tags/${release.tag}`;
    git(temp, "fetch", "--no-tags", "--depth=1", dependencies.remote || REMOTE, `${ref}:${candidateRef}`);
    const commit = git(temp, "rev-parse", `${candidateRef}^{commit}`);
    let signedTag = release?.tag;
    if (channel === "main") {
      signedTag = `momm-main-${commit}`;
      log(`Network: fetch ${REMOTE}, refs/tags/${signedTag}. An unsigned development head is not installable.`);
      git(temp, "fetch", "--no-tags", "--depth=1", dependencies.remote || REMOTE, `refs/tags/${signedTag}:refs/tags/${signedTag}`);
      if (git(temp, "rev-parse", `${signedTag}^{commit}`) !== commit) throw new Error("Signed development checkpoint does not match main");
    }
    (dependencies.verifySignature || verifySignature)(temp, signedTag, channel);
    const candidateManifest = JSON.parse(git(temp, "show", `${commit}:versions.json`));
    const digest = treeHash(temp, commit);
    if (channel !== "main" && (candidateManifest.momm !== version || digest !== release.sha256)) throw new Error("Signed tag version or package SHA-256 does not match the manifest; checkout unchanged.");
    // Import the installed objects only into staging, so even --dry-run leaves
    // the real checkout, refs, installation links and receipt unchanged.
    git(temp, "fetch", "--no-tags", root, `${git(root, "rev-parse", "HEAD")}:refs/momm/installed`);
    log("Files that would change across this shared skills clone (including sibling skills):\n" + run("git", ["diff", "--no-ext-diff", "--no-textconv", "--name-status", "refs/momm/installed", commit], temp));
    const diff = policyDiff(temp, "refs/momm/installed", commit);
    log(`Protocol / default-rules / persona diff (full dispatcher diff for conservative coverage):\n${diff || "No policy changes."}`);
    log(`Would replay saved installation scopes: ${JSON.stringify(lock.installations)}. Existing project .reviewrules files are not rewritten.`);
    if (o.dry_run) { log("Preview complete. No installed files, refs, links or receipt changed."); return; }
    if (diff && !o.accept_protocol) throw new Error("Policy changed: inspect the diff and explicitly pass --accept-protocol. --yes never bypasses this gate.");
    await consent(o, `Install ${channel === "main" ? commit : version} and relink the saved harnesses?`);
    await exclusive(dir, async () => {
      clean(root);
      const ignoreRulesChanged = run("git", ["diff", "--name-only", "-z", "refs/momm/installed", commit], temp).split("\0").some(name => name === ".gitignore" || name.endsWith("/.gitignore"));
      if (ignoreRulesChanged && run("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], root)) throw new Error("Ignore rules change while local ignored files exist. Move those files outside this skills clone yourself and retry. Nothing checked out; private files and recovery remain intact.");
      if (git(root, "rev-parse", "HEAD") !== git(temp, "rev-parse", "refs/momm/installed")) throw new Error("Checkout changed during preview; repeat the update.");
      if (JSON.stringify(readLock(root)) !== JSON.stringify(lock)) throw new Error("Installation receipt changed during preview; repeat the update.");
      const before = { ...lock, previous: null, current: { ...lock.current, ...current(root), tree_sha256: treeHash(root, "HEAD") } };
      // Retain a stable local reference; Git GC must not discard rollback data.
      git(root, "update-ref", "refs/momm/rollback", before.current.commit);
      atomic(path.join(dir, "update.mjs"), fs.readFileSync(ENTRY));
      writeJSON(journalFile, { schema: "momm-transaction/1", before, candidate: commit, stage: "prepared" });
      try {
        git(root, "fetch", "--no-tags", temp, `${commit}:refs/momm/verified`);
        checkout(root, commit);
        installer(root, lock);
        assertInstalled(root, { commit, version: candidateManifest.momm });
        const next = { ...lock, channel, previous: before,
          current: { ...current(root), tree_sha256: digest, verified: true, signer: SIGNER }, updated_at: new Date().toISOString() };
        writeJSON(lockFile, next);
        fs.unlinkSync(journalFile);
        log(`Installed and verified ${next.current.version}. Rollback: node "${path.join(dir, "update.mjs")}" --rollback --yes`);
      } catch (e) {
        // Never overwrite concurrent edits on the way back, either.
        try {
          clean(root);
          if (![commit, before.current.commit].includes(git(root, "rev-parse", "HEAD"))) throw new Error("Concurrent unrelated checkout detected; recovery will not overwrite it.");
          checkout(root, before.current.commit); installer(root, before); assertInstalled(root, before.current); writeJSON(lockFile, before); fs.unlinkSync(journalFile);
        }
        catch (recovery) { throw new Error(`${e.message}\nAutomatic recovery incomplete: ${recovery.message}\nRetained recovery: node "${path.join(dir, "update.mjs")}" --rollback --yes`); }
        throw new Error(`${e.message}\nPrevious installation restored; update not applied.`);
      }
    });
  } finally {
    // temp is a directory created by this invocation; never accept user paths.
    if (path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith("momm-update-")) fs.rmSync(temp, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === ENTRY) {
  update(process.argv.slice(2)).catch(e => { process.stderr.write(`MOMM update stopped: ${safeText(e.message)}\n`); process.exitCode = 1; });
}
