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
  if (fs.existsSync(path.join(dir, "transaction.json"))) return { updater_available:false, receipt_deferred:true, reason:"The active or interrupted update owns the receipt. Link results are separate; finish or recover that transaction before a new explicit installation can be recorded." };
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
  // Synchronous installers share the updater's exclusive claim. Their link
  // results remain visible if this receipt phase is refused or interrupted.
  const claim = path.join(dir, 'update.active'), token = randomUUID();
  let fd;
  try { fd = fs.openSync(claim, 'wx', 0o600); }
  catch { throw new Error('Another update claim is active; installation receipt was not changed. Finish or recover the update, then repeat this explicit install.'); }
  try {
  fs.writeFileSync(fd, JSON.stringify({pid:process.pid, token, started:new Date().toISOString()}));
  if (fs.existsSync(path.join(dir, 'transaction.json'))) throw new Error('An update transaction appeared; installation receipt was not changed.');
  const previous = readLock(root, false);
  const scopes = [...(previous?.installations || [])];
  for (const operation of installations) {
    const same = scopes.find(s => s.target === operation.target && s.custom_dir === operation.custom_dir);
    if (same) { same.skills = [...new Set([...same.skills, ...operation.skills])]; if (operation.installer === "install.mjs") same.installer = operation.installer; }
    else scopes.push(operation);
  }
  // A later install adds explicitly successful harnesses, not newly detected ones.
  const observed = current(root);
  const retainVerified = previous?.current?.verified
    && ['version', 'commit', 'dispatcher_sha256', 'updater_sha256', 'protocol_sha256'].every(k => previous.current[k] === observed[k])
    && !git(root, 'status', '--porcelain', '--untracked-files=no');
  const lock = { ...previous, schema: "momm-lock/1", repo_root: root,
    channel: previous?.channel || "stable", installer: previous?.installer === "install.mjs" ? previous.installer : installer,
    skills: [...new Set([...(previous?.skills || []), ...skills])],
    installations: scopes,
    targets: [...new Set([...(previous?.targets || []), ...targets])],
    custom_dirs: [...new Set([...(previous?.custom_dirs || []), ...custom_dirs])],
    current: { ...(retainVerified ? previous.current : {}), ...observed }, installed_at: new Date().toISOString() };
  writeJSON(path.join(dir, "momm.lock"), lock);
  atomic(path.join(dir, "update.mjs"), fs.readFileSync(ENTRY));
  return { lock: path.join(dir, "momm.lock"), recovery: path.join(dir, "update.mjs"), targets: lock.targets };
  } finally {
    fs.closeSync(fd);
    try { if (regular(claim, true) && readJSON(claim).token === token) fs.unlinkSync(claim); }
    catch (error) { process.stderr.write(`MOMM install claim needs inspection: ${safeText(error.message)}\n`); }
  }
}
export function updateCheckDisabled(env = process.env) {
  return ["NO_UPDATE_CHECK", "MOMM_NO_UPDATE_CHECK", "DO_NOT_TRACK"].some(k => {
    const v = String(env[k] || "").toLowerCase(); return v !== "" && v !== "0" && v !== "false";
  });
}
// Release versions stay strict x.y.z (VERSION); installed CLIs may report a
// prerelease, which ranks below its own stable and otherwise compares identifier
// by identifier (semver 11.4). Anything else is not comparable: never "newer".
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
export function newer(a, b) {
  const ma = SEMVER.exec(String(a ?? "")), mb = SEMVER.exec(String(b ?? ""));
  if (!ma || !mb) return false;
  for (let i = 1; i <= 3; i++) if (ma[i] !== mb[i]) return Number(ma[i]) > Number(mb[i]);
  if (!ma[4] || !mb[4]) return Boolean(mb[4]) && !ma[4];
  const pa = ma[4].split("."), pb = mb[4].split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return false;
    if (pb[i] === undefined) return true;
    if (pa[i] === pb[i]) continue;
    const na = /^\d+$/.test(pa[i]), nb = /^\d+$/.test(pb[i]);
    if (na && nb) return Number(pa[i]) > Number(pb[i]);
    if (na !== nb) return nb; // numeric identifiers rank below alphanumeric ones
    return pa[i] > pb[i];
  }
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
    if (["--dry-run", "--apply", "--rollback", "--yes", "--accept-protocol", "--help", "--check-all", "--json"].includes(a)) o[a.slice(2).replaceAll("-", "_")] = true;
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
  if (o.json && !o.check_all) throw new Error("--json is only available with --check-all");
  if (o.check_all && (o.dry_run || o.apply || o.rollback || o.version || o.channel || o.yes || o.accept_protocol)) throw new Error("--check-all is a read-only report; combine it only with --json and --repo");
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
// ---- --check-all: one read-only report over skill, reviewer CLIs and review history ----
// Self-contained copies (this file must not import from the checkout): the
// reviewer list, npm package names and fixed update commands match
// update-clock.mjs / setup-ui.mjs; the package-manager path fragments are the
// ones setup-ui.mjs detectInstallation refuses to update through npm.
export const REVIEWER_CLIS = Object.freeze(["codex", "claude", "gemini", "copilot", "grok", "antigravity"]);
export const NPM_PACKAGES = Object.freeze({ codex: "@openai/codex", claude: "@anthropic-ai/claude-code", gemini: "@google/gemini-cli", copilot: "@github/copilot" });
export const UPDATE_COMMANDS = Object.freeze({ codex: "npm install -g @openai/codex@latest", claude: "claude update", gemini: "npm install -g @google/gemini-cli@latest", copilot: "copilot update", grok: "grok update", antigravity: "agy update" });
export const MANAGED_PATH = /\/(\.volta|scoop|chocolatey|\.asdf|\.local\/share\/mise)\//i;
const MANAGER_NAMES = { ".volta": "volta", scoop: "scoop", chocolatey: "chocolatey", ".asdf": "asdf", ".local/share/mise": "mise" };
const NOT_INSTALLED = /is not recognized as an internal or external command|command not found|no such file or directory|enoent/i;
// Keeps a prerelease suffix (1.2.3-beta.1) so an installed prerelease is never mistaken for its stable.
const semver = text => String(text ?? "").match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?/)?.[0] || null;
export function cliBinary(cli, { env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  if (cli === "antigravity") {
    const local = platform === "win32" && env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "agy", "bin", "agy.exe") : path.join(home, ".local", "bin", "agy");
    return fs.existsSync(local) ? local : "agy";
  }
  if (cli === "grok") { const local = path.join(home, ".grok", "bin", platform === "win32" ? "grok.exe" : "grok"); return fs.existsSync(local) ? local : "grok"; }
  return cli;
}
// PATH walk mirroring setup-ui.mjs detectInstallation, reduced to what
// --check-all reports: where the launcher is and whether a package manager owns it.
export function locateBinary(command, { env = process.env, platform = process.platform } = {}) {
  const candidates = [];
  if (path.isAbsolute(command)) candidates.push(command);
  else {
    const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] || "";
    for (const directory of pathValue.split(platform === "win32" ? ";" : ":").filter(Boolean)) {
      for (const extension of platform === "win32" ? [".exe", ".cmd", ".bat"] : [""]) candidates.push(path.join(directory.replace(/^"|"$/g, ""), command + extension));
    }
  }
  for (const candidate of candidates) {
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      if (platform !== "win32") { try { fs.accessSync(candidate, fs.constants.X_OK); } catch { continue; } }
      let resolved = candidate; try { resolved = fs.realpathSync(candidate); } catch {}
      const hit = [candidate, resolved].map(p => MANAGED_PATH.exec(p.replaceAll("\\", "/"))).find(Boolean);
      return { path: candidate, package_manager_owned: Boolean(hit), manager: hit ? MANAGER_NAMES[hit[1].toLowerCase()] || hit[1] : null };
    } catch {}
  }
  return { path: null, package_manager_owned: false, manager: null };
}
// Only constant arguments reach this (--version, update --check --stable --json).
// The Windows shell is needed for npm's .cmd shims, so the executable path is
// quoted whenever cmd.exe would otherwise read part of it as syntax: not only
// whitespace but & | < > ^ ( ) and the other delimiters (<profile>\A&B\grok.exe).
// A path cannot contain a double quote on Windows; %VAR% expansion inside quotes
// is a cmd.exe limitation this cannot neutralise.
const WIN_SHELL_META = /[\s&|<>^()%!"'`,;=@[\]{}~$]/;
export function captureExec(command, args, { timeout = 20_000, cwd } = {}) {
  const win = process.platform === "win32";
  const p = spawnSync(win && WIN_SHELL_META.test(command) ? `"${command}"` : command, args, { cwd, encoding: "utf8", shell: win, windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 });
  return { code: p.error ? -1 : p.status, stdout: p.stdout || "", stderr: p.stderr || "", error: p.error || null };
}
const notInstalled = r => !r || r.error?.code === "ENOENT" || r.code === 127 || (r.code !== 0 && NOT_INSTALLED.test(`${r.stderr}\n${r.stdout}`));
// Reads the first review log found among `dirs` (a string or list; the report
// says which file was used). Records that are not objects, carry no object
// reviewer_status, or have an unparseable timestamp are skipped, never fatal.
export function lastSuccessfulReviews(dirs) {
  const searched = [].concat(dirs).map(d => path.join(d, ".ensemble_reviews", "review-log.jsonl")), latest = Object.create(null);
  let file = searched[0], text, runs = 0;
  for (const candidate of searched) { try { text = fs.readFileSync(candidate, "utf8"); file = candidate; break; } catch {} }
  if (text === undefined) return { file, searched, runs, routes: latest, present: false };
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let entry; try { entry = JSON.parse(raw); } catch { continue; }
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || entry.event || !entry.timestamp) continue;
    if (!entry.reviewer_status || typeof entry.reviewer_status !== "object" || Array.isArray(entry.reviewer_status)) continue;
    const at = Date.parse(entry.timestamp);
    if (!Number.isFinite(at)) continue;
    runs++;
    for (const [route, status] of Object.entries(entry.reviewer_status)) {
      if (status !== "success") continue;
      if (!latest[route] || at > Date.parse(latest[route].timestamp)) latest[route] = { timestamp: entry.timestamp, run_id: entry.run_id || null };
    }
  }
  return { file, searched, runs, routes: latest, present: true };
}
export async function checkAll(root, lock, dependencies = {}) {
  const exec = dependencies.exec || captureExec, fetcher = dependencies.fetcher || fetch, env = dependencies.env || process.env;
  const platform = dependencies.platform || process.platform, home = dependencies.home || os.homedir(), cwd = dependencies.cwd || process.cwd();
  const report = { schema: "momm-check-all/1", checked_at: new Date().toISOString(), repo_root: root,
    skill: { installed: lock.current?.version || null, published: null, channel: lock.channel, update_available: null, release_verified: Boolean(lock.current?.verified), error: null },
    installations: { targets: [...(lock.targets || [])], custom_dirs: [...(lock.custom_dirs || [])], scopes: (lock.installations || []).map(s => ({ target: s.target, custom_dir: s.custom_dir || null, skills: s.skills || ["momm"] })) },
    reviews: lastSuccessfulReviews([...new Set([cwd, root].map(d => path.resolve(d)))]), clis: [] };
  try {
    const m = await (dependencies.manifest || manifest)(fetcher);
    report.skill.published = m.momm;
    report.skill.update_available = SEMVER.test(m.momm || "") && SEMVER.test(report.skill.installed || "") ? newer(m.momm, report.skill.installed) : null;
  }
  catch (e) { report.skill.error = safeText(e.message).slice(0, 200); }
  const npmLatest = async cli => {
    const url = `https://registry.npmjs.org/${NPM_PACKAGES[cli].replace("/", "%2f")}/latest`;
    const res = await fetcher(url, { signal: AbortSignal.timeout(5000), redirect: "error", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    if (Buffer.byteLength(body) > 1024 * 1024) throw new Error("registry response exceeds 1 MiB");
    const v = semver(JSON.parse(body).version); if (!v) throw new Error("no version in registry reply"); return v;
  };
  for (const cli of REVIEWER_CLIS) {
    const binary = cliBinary(cli, { env, platform, home }), location = locateBinary(binary, { env, platform });
    const row = { cli, binary, installed: null, latest: null, latest_source: NPM_PACKAGES[cli] ? "npm registry" : cli === "grok" ? "grok update --check --stable --json" : "unknown (no check-only command)", update_available: null,
      path: location.path, package_manager_owned: location.package_manager_owned, manager: location.manager,
      update_command: location.package_manager_owned ? `update through ${location.manager}` : UPDATE_COMMANDS[cli], last_successful_review: report.reviews.routes[cli] || null, error: null };
    const fail = message => { const m = safeText(message).replace(/\s+/g, " ").trim().slice(0, 200); row.error = row.error ? `${row.error}; ${m}` : m; };
    const v = await exec(binary, ["--version"], { timeout: 20_000 });
    if (notInstalled(v)) row.installed = "not installed";
    else {
      row.installed = (v.code === 0 && (semver(v.stdout) || semver(v.stderr))) || "unknown";
      // "unknown" is never silent: a timeout, spawn failure or non-zero exit is reported beside it.
      if (row.installed === "unknown") fail(v.code === 0 ? "--version printed no version" : v.error ? `--version failed: ${v.error.message || v.error.code || "spawn error"}` : `--version exited ${v.code}: ${v.stderr || v.stdout}`);
    }
    try {
      if (NPM_PACKAGES[cli]) row.latest = await npmLatest(cli);
      else if (cli === "grok" && row.installed !== "not installed") {
        const p = await exec(binary, ["update", "--check", "--stable", "--json"], { timeout: 20_000 });
        if (p.code !== 0) throw new Error(`grok update --check exited ${p.code}`);
        const j = JSON.parse(p.stdout);
        row.latest = semver(j.latestVersion) || "unknown"; if (typeof j.updateAvailable === "boolean") row.update_available = j.updateAvailable;
      } else row.latest = "unknown";
    } catch (e) { row.latest = "unknown"; fail(e.message); }
    if (row.update_available === null && SEMVER.test(row.installed || "") && SEMVER.test(row.latest || "")) row.update_available = newer(row.latest, row.installed);
    report.clis.push(row);
  }
  return report;
}
export function checkAllTable(report) {
  const pad = (s, n) => String(s ?? "").padEnd(n);
  const s = report.skill, lines = [];
  lines.push(`MOMM skill      installed ${s.installed || "unknown"}   published ${s.published || (s.error ? `unavailable (${s.error})` : "unknown")}   channel ${s.channel}   ${s.update_available === true ? "update available" : s.update_available === false ? "current" : "not compared"}`);
  lines.push(`Install scopes  harness targets: ${report.installations.targets.join(", ") || "none"}   custom dirs: ${report.installations.custom_dirs.join(", ") || "none"}`);
  lines.push(`Review log      ${report.reviews.present ? `${report.reviews.file} (${report.reviews.runs} run${report.reviews.runs === 1 ? "" : "s"})` : `${report.reviews.file} (not found)`}`);
  lines.push("");
  const widths = [12, 15, 12, 40, 20, 26];
  lines.push([pad("CLI", widths[0]), pad("Installed", widths[1]), pad("Latest", widths[2]), pad("Latest source", widths[3]), pad("Owner", widths[4]), pad("Last successful review", widths[5]), "Update command"].join(" "));
  for (const r of report.clis) {
    const owner = r.path ? (r.package_manager_owned ? `${r.manager} (package manager)` : "self / npm") : "-";
    const flag = r.update_available === true ? " *" : "";
    lines.push([pad(r.cli, widths[0]), pad(`${r.installed}${flag}`, widths[1]), pad(r.latest, widths[2]), pad(r.latest_source + (r.error ? ` (${r.error})` : ""), widths[3]), pad(owner, widths[4]), pad(r.last_successful_review?.timestamp || "never", widths[5]), r.installed === "not installed" ? "-" : r.update_command].join(" "));
  }
  lines.push("", "* update available. Nothing was installed; every update needs its explicit command.");
  return lines.join("\n");
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
  // Reading a dead PID and then unlinking is not atomic: two claimants can
  // delete one another's newly acquired lock. Never automatically steal a claim.
  if (regular(file, true)) throw new Error(`Existing update claim: ${file}. Preserved even if its PID appears dead. Independently confirm no updater is running before manually removing only this claim; preserve transaction.json and momm.lock, then retry recovery.`);
  try { fd = fs.openSync(file, "wx", 0o600); } catch { throw new Error(`Another update may be active. Inspect ${file}; do not remove it while its process is running.`); }
  const token = randomUUID();
  try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, started: new Date().toISOString() })); }
  catch (error) { fs.closeSync(fd); throw error; } // Preserve incomplete claims for explicit recovery.
  return Promise.resolve().then(action).finally(() => {
    fs.closeSync(fd);
    try { if (regular(file, true) && readJSON(file).token === token) fs.unlinkSync(file); }
    catch (error) { process.stderr.write(`MOMM update claim cleanup needs inspection: ${safeText(error.message)}\n`); }
  });
}
export async function update(argv, dependencies = {}) {
  const o = parse(argv), log = dependencies.log || (s => process.stdout.write(`${safeText(s)}\n`));
  if (o.help) { log("MOMM update: [--dry-run | --apply | --rollback] [--version x.y.z] [--channel stable|pinned|main] [--accept-protocol] [--yes]\n             --check-all [--json]   Report skill version, every reviewer CLI's installed/latest version, install scopes and last successful review per route (read-only; contacts the release manifest and npm registry).\nDefault: manifest + changelog only. No automatic updates. Recovery: node <git-dir>/momm/update.mjs --rollback --yes"); return; }
  const siblingLock = path.join(path.dirname(ENTRY), "momm.lock");
  const start = o.repo || (fs.existsSync(siblingLock) ? readJSON(siblingLock).repo_root : path.resolve(path.dirname(ENTRY), "../.."));
  const root = repoRoot(start), dir = stateDir(root), lock = readLock(root);
  const lockFile = path.join(dir, "momm.lock"), journalFile = path.join(dir, "transaction.json");
  const installer = dependencies.reinstall || reinstall;
  if (o.check_all) {
    if (!o.json) log(`Network: GET ${MANIFEST_URL} and the npm registry "latest" documents for codex/claude/gemini/copilot; grok update --check runs locally. Release information only; nothing is installed or changed.`);
    const report = await checkAll(root, lock, dependencies);
    report.pending_recovery = regular(journalFile, true); // the same check rollback applies to the journal
    log(o.json ? JSON.stringify(report, null, 2) : checkAllTable(report) + (report.pending_recovery ? "\nAn interrupted update needs recovery: run the retained update.mjs --rollback --yes." : ""));
    return report;
  }
  if (o.rollback) return exclusive(dir, async () => {
    const lock = readLock(root);
    const journal = regular(journalFile, true) ? readJSON(journalFile) : null;
    const savedPrevious = journal?.before || lock.previous;
    // Explicit installations added since an update still belong to the user.
    // Roll back code, not that recorded scope; replay must verify every scope.
    const previous = savedPrevious ? { ...savedPrevious, installations:lock.installations,
      targets:lock.targets, custom_dirs:lock.custom_dirs, skills:lock.skills, installer:lock.installer } : null;
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
    await exclusive(dir, async () => {
      if (fs.existsSync(journalFile)) throw new Error('An interrupted update needs recovery before changing channels.');
      writeJSON(lockFile, { ...readLock(root), channel: o.channel });
    });
    log(`Channel saved: ${o.channel}. Installed code and protocol unchanged.`); return;
  }
  const channel = o.channel || lock.channel;
  if (channel === 'main' && o.version) throw new Error('The main channel cannot be combined with an explicit release version. Choose stable or pinned.');
  log(`Network: GET ${MANIFEST_URL} (release information only).`);
  const m = await (dependencies.manifest || manifest)();
  const version = o.version || m.momm;
  log(`Installed ${lock.current.version}; published ${m.momm}; channel ${channel}.`);
  for (const r of (m.momm_releases || []).filter(r => VERSION.test(r.version) && newer(r.version, lock.current.version) && !newer(r.version, version))) {
    log(`${r.version}: ${(r.changes || []).map(safeText).join("\n  ")}`);
  }
  if (!o.apply && !o.dry_run) { log("No code fetched or installed. Next: update --dry-run, then explicitly update --apply. Agents must stop and ask; never self-apply."); return; }
  if (channel === "pinned" && !o.version) throw new Error("Pinned channel: specify --version x.y.z. No code fetched.");
  if (channel === 'stable' && !o.version && newer(lock.current.version, version)) throw new Error('Published manifest names an older version. Downgrades require an explicit --version x.y.z; no code fetched.');
  const release = (m.momm_releases || []).find(r => r.version === version);
  if (channel !== "main" && (!release || release.tag !== `momm-${version}` || !SHA.test(release.sha256 || "") || release.hash_covers !== "git-tree-blobs-excluding-versions/1")) throw new Error("This release has no verifiable signed-package metadata. Legacy unsigned releases cannot be installed by the updater.");
  const ref = channel === "main" ? "refs/heads/main" : `refs/tags/${release.tag}`;
  log(`Network: fetch ${REMOTE}, ${ref}, into temporary staging only. Signature check contacts Sigstore trust/log services. No provider credentials or project source are sent.`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "momm-update-"));
  try {
    // gitsign discovers a normal .git directory; a bare staging repo is not
    // supported by its repository opener. Fetch objects only: do not check out
    // or execute candidate files before signature and package verification.
    git(temp, "init");
    const candidateRef = channel === "main" ? "refs/momm/candidate" : `refs/tags/${release.tag}`;
    git(temp, "fetch", "--no-tags", dependencies.remote || REMOTE, `${ref}:${candidateRef}`);
    const commit = git(temp, "rev-parse", `${candidateRef}^{commit}`);
    let signedTag = release?.tag;
    if (channel === "main") {
      signedTag = `momm-main-${commit}`;
      log(`Network: fetch ${REMOTE}, refs/tags/${signedTag}. An unsigned development head is not installable.`);
      git(temp, "fetch", "--no-tags", dependencies.remote || REMOTE, `refs/tags/${signedTag}:refs/tags/${signedTag}`);
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
      if (fs.existsSync(journalFile)) throw new Error('An interrupted update appeared during preview; recover before applying.');
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
        if (git(root, 'rev-parse', 'refs/momm/verified') !== commit) throw new Error('Verified release reference was not promoted');
        git(root, 'fsck', '--connectivity-only', commit);
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
          if (git(root, 'rev-parse', 'HEAD') !== before.current.commit) checkout(root, before.current.commit);
          installer(root, before); assertInstalled(root, before.current); writeJSON(lockFile, before); fs.unlinkSync(journalFile);
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
function isEntrypoint() {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(ENTRY); }
  catch { return false; } // An import may have an unrelated/non-file argv[1].
}
if (isEntrypoint()) {
  update(process.argv.slice(2)).catch(e => { process.stderr.write(`MOMM update stopped: ${safeText(e.message)}\n`); process.exitCode = 1; });
}
