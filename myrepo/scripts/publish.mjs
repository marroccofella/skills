#!/usr/bin/env node
// myrepo — publish a project to GitHub with a live, in-browser Pages site,
// conforming to the 42.uk theme and spec. Zero dependencies: Node 18+ (uses
// the built-in global fetch), git, and the authenticated `gh` CLI.
//
//   node publish.mjs --name my-app --desc "One-line description"
//   node publish.mjs --name my-app --dry-run        # preview, touch nothing
//
// Publishing to a PUBLIC repo is outward-facing. The SKILL.md protocol
// requires the governor to CONFIRM with the user first (repo name, visibility,
// what will be pushed). --dry-run previews safely.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MYREPO_VERSION = "1.2.0";
const TAGLINE = "RELAX. IT'S ALREADY OVER.";
const VERSIONS_URL = "https://raw.githubusercontent.com/marroccofella/skills/main/versions.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VERSION_RE = /^\d+(\.\d+){0,3}$/;
function isNewerVersion(a, b) {
  if (!VERSION_RE.test(a) || !VERSION_RE.test(b)) return false;
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x > y; }
  return false;
}
// Cached-daily, fail-silent. Format-validated before caching or printing so a
// compromised versions.json cannot inject anything. Disable with NO_UPDATE_CHECK.
async function checkForUpdate(current) {
  const off = (process.env.NO_UPDATE_CHECK ?? "").toLowerCase();
  if (off !== "" && off !== "0" && off !== "false") return null;
  const cacheFile = path.join(os.tmpdir(), ".myrepo-update-check");
  const isSymlink = () => { try { return fs.lstatSync(cacheFile).isSymbolicLink(); } catch { return false; } };
  try { const lst = fs.lstatSync(cacheFile); if (!lst.isSymbolicLink() && Date.now() - lst.mtimeMs < 864e5) { const c = fs.readFileSync(cacheFile, "utf8").trim(); return VERSION_RE.test(c) && isNewerVersion(c, current) ? c : null; } } catch {}
  try {
    const res = await fetch(VERSIONS_URL, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const latest = String((await res.json())?.myrepo ?? "");
    if (!VERSION_RE.test(latest)) return null;
    if (!isSymlink()) { try { fs.writeFileSync(cacheFile, latest, { mode: 0o600 }); } catch {} }
    return isNewerVersion(latest, current) ? latest : null;
  } catch { return null; }
}
// Owner-only audit trail of everything published: which myrepo version pushed
// what, when, where, and what the scan found. Lives outside any repo.
function recordPublish(entry) {
  try {
    const dir = path.join(os.homedir(), ".myrepo");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch {}
    const logPath = path.join(dir, "publishes.jsonl");
    const fresh = !fs.existsSync(logPath);
    fs.appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), myrepo_version: MYREPO_VERSION, ...entry }) + "\n");
    if (fresh) { try { fs.chmodSync(logPath, 0o600); } catch {} }
    return logPath;
  } catch { return null; }
}

function parseArgs(argv) {
  const o = { dir: ".", private: false, dryRun: false, pages: true, forceDocs: false, allowPaths: false, title: null, name: null, desc: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`Missing value for ${a}`); return argv[++i]; };
    if (a === "--dir") o.dir = next();
    else if (a === "--name") o.name = next();
    else if (a === "--desc") o.desc = next();
    else if (a === "--title") o.title = next();
    else if (a === "--private") o.private = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--no-pages") o.pages = false;
    else if (a === "--force-docs") o.forceDocs = true;
    else if (a === "--allow-paths") o.allowPaths = true;
    else if (a === "--version") { process.stdout.write(`myrepo ${MYREPO_VERSION}\n`); process.exit(0); }
    else if (a === "--help" || a === "-h") { process.stdout.write(usage()); process.exit(0); }
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!o.name) throw new Error("--name <repo> is required (e.g. --name my-app)");
  if (!/^[A-Za-z0-9._-]+$/.test(o.name)) throw new Error(`--name must be a valid repo name, got "${o.name}"`);
  if (o.private) o.pages = false; // Pages on a private repo needs a paid plan; keep it simple and safe.
  return o;
}

function usage() {
  return `myrepo — publish a project to GitHub with a live Pages site (42.uk themed)

  --name <repo>       Repository name (required)
  --desc <text>       One-line repository description
  --title <text>      Human title for scaffolded docs (default: derived from name)
  --dir <path>        Project directory to publish (default: current)
  --private           Create a private repo (no Pages; default is public)
  --no-pages          Do not enable GitHub Pages
  --dry-run           Preview every step, create/push nothing
  --force-docs        Overwrite existing README/LICENSE with the themed template
  --allow-paths       Skip the local-path privacy scan (NOT recommended)
  --version | --help
`;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim(), error: r.error };
}
function log(step, msg) { process.stderr.write(`  ${step} ${msg}\n`); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// Refuse to publish local machine paths or obvious secret-bearing files into a
// public repo. Returns { paths: [...], secrets: [...], scanError }.
const SECRET_FILES = /(^|[\\/])(\.env(\.|$)|\.npmrc$|\.netrc$|id_rsa|id_ed25519|.*\.pem$|.*\.key$|.*\.pfx$|.*\.p12$|.*\.keystore$)/i;
// Built from parts so this source does not itself look like a secret
// assignment (which would trip a secret-redacting reviewer). Detects an
// inline credential like FOO_TOKEN = "abc123..." in ordinary files.
const CRED_WORDS = ["api[_-]?key", "secret", "passwd", "password", "private[_-]?key", "token", "bearer"];
// Allow surrounding name chars so prefixed names match too (DB_PASSWORD,
// AWS_SECRET_ACCESS_KEY, FOO_TOKEN). Best-effort net, not a security boundary.
const CRED_ASSIGN = new RegExp("[A-Za-z0-9_]*(?:" + CRED_WORDS.join("|") + ")[A-Za-z0-9_]*\\s*[:=]\\s*[\"']?\\S{8,}", "i");
const PRIVATE_KEY_BLOCK = /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/;
const hasCred = (text) => CRED_ASSIGN.test(text) || PRIVATE_KEY_BLOCK.test(text);
const TEXT_EXT = /\.(html?|css|js|mjs|cjs|ts|jsx|tsx|json|md|txt|xml|ya?ml|svg|vue|py|rb|go|rs|java|c|h|sh|toml|ini|cfg|env|conf)$/i;
const PATH_PATTERNS = [
  /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'<>]+/i,          // C:\Users\name
  /(^|[\s"'(=/])\/(?:Users|home)\/[^/\s"'<>]+/,        // /Users/name, /home/name
  /\/mnt\/[a-z]\/Users\/[^/\s"'<>]+/i,                 // WSL /mnt/c/Users/name
];
function scanForLeaks(dir) {
  const paths = [], secrets = [];
  let scanError = null;
  const walk = (p) => {
    let entries;
    try { entries = fs.readdirSync(p, { withFileTypes: true }); }
    catch (e) { scanError = e.message; return; }
    for (const e of entries) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const fp = path.join(p, e.name);
      if (SECRET_FILES.test(fp)) secrets.push(path.relative(dir, fp));
      if (e.isDirectory()) walk(fp);
      else if (TEXT_EXT.test(e.name) || !path.extname(e.name)) {
        let t; try { t = fs.readFileSync(fp, "utf8"); } catch { continue; }
        for (const pat of PATH_PATTERNS) { const m = t.match(pat); if (m) { paths.push(`${path.relative(dir, fp)}: ${m[0].slice(0, 60)}`); break; } }
        // Inline credential in an ordinary file (not just secret-named files).
        if (hasCred(t)) secrets.push(`${path.relative(dir, fp)} (inline credential)`);
      }
    }
  };
  walk(dir);
  return { paths, secrets, scanError };
}
function scanText(label, text) {
  for (const pat of PATH_PATTERNS) { const m = text.match(pat); if (m) return `${label}: ${m[0].slice(0, 60)}`; }
  return null;
}

function humanTitle(name) { return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()); }

function scaffolds(o, login, hasIndex) {
  const title = o.title || humanTitle(o.name);
  const pagesUrl = `https://${login}.github.io/${o.name}/`;
  const live = o.pages ? `\n**Live — runs in your browser:** [${pagesUrl}](${pagesUrl})\n` : "";
  const readme = `# ◆ ${title}

${o.desc || "A project from the 42.uk Library."}
${live}
## Run it

${hasIndex ? `Open [\`index.html\`](index.html)${o.pages ? ` or just visit the [live page](${pagesUrl})` : ""} — it is self-contained and runs in any modern browser.` : "See the source in this repository."}

## About

Part of the [42.uk](https://42.uk) universe. No accounts, no trackers, no third-party services unless stated. MIT licensed.

*${TAGLINE}*
`;
  const year = new Date().getFullYear();
  const license = `MIT License

Copyright (c) ${year} ${login}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
  const landing = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(o.desc || title)}">
<style>
:root{--bg:#080a0a;--accent:#00ff99}
body{background:#080a0a;color:#e6ffe6;font:15px/1.6 ui-monospace,Consolas,monospace;max-width:680px;margin:0 auto;padding:60px 20px}
h1{font-size:24px}h1 span{color:var(--accent)}a{color:#8ef0c6}p{color:#9be29b}.dim{color:#5c6f60;font-size:12px}
</style></head><body>
<h1><span>◆</span> ${esc(title)}</h1>
<p>${esc(o.desc || "A project from the 42.uk Library.")}</p>
<p class="dim">Part of the <a href="https://42.uk">42.uk</a> universe. ${TAGLINE}</p>
</body></html>`;
  // .gitignore keeps node_modules, secrets, and OS cruft out of a public repo.
  const gitignore = `node_modules/\n.env\n.env.*\n*.pem\n*.key\n*.pfx\n*.p12\n.npmrc\n.netrc\nid_rsa\nid_ed25519\n.DS_Store\nThumbs.db\n*.log\n`;
  return { readme, license, landing, gitignore };
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); }
  catch (e) { process.stderr.write(`${e.message}\n\n${usage()}`); process.exit(1); }

  const dir = path.resolve(o.dir);
  if (!fs.existsSync(dir)) { process.stderr.write(`Project dir not found: ${dir}\n`); process.exit(1); }

  const auth = run("gh", ["api", "user", "-q", ".login"]);
  if (auth.code !== 0 || !auth.out) { process.stderr.write("gh is not authenticated. Run: gh auth login\n"); process.exit(1); }
  const login = auth.out;
  log("◆", `myrepo ${MYREPO_VERSION} — publishing "${o.name}" as ${login}/${o.name}${o.private ? " (private)" : " (public)"}`);

  const hasIndex = fs.existsSync(path.join(dir, "index.html"));
  const { readme, license, landing, gitignore } = scaffolds(o, login, hasIndex);

  // Privacy + secrets scan — over on-disk files AND the generated docs.
  // The secret-file check ALWAYS runs; --allow-paths only waives the
  // local-path refusal (for a project that legitimately references such
  // strings), never the secret protection.
  {
    const { paths, secrets, scanError } = scanForLeaks(dir);
    const genLeak = scanText("(generated README)", readme) || scanText("(generated landing)", landing);
    if (genLeak) paths.push(genLeak);
    if (scanError) log("⚠", `privacy scan could not read part of the tree (${scanError}); review manually`);
    if (secrets.length) {
      process.stderr.write(`\n  ✗ Refusing to publish — secret-bearing files present (never waivable):\n`);
      for (const s of secrets.slice(0, 8)) process.stderr.write(`      ${s}\n`);
      process.stderr.write(`  Remove or .gitignore them before publishing.\n`);
      process.exit(2);
    }
    if (paths.length && !o.allowPaths) {
      process.stderr.write(`\n  ✗ Refusing to publish — local paths found (would leak your machine):\n`);
      for (const h of paths.slice(0, 8)) process.stderr.write(`      ${h}\n`);
      process.stderr.write(`  Fix these, or re-run with --allow-paths if intentional.\n`);
      process.exit(2);
    }
    if (paths.length) log("⚠", `${paths.length} local path(s) present but --allow-paths given; publishing anyway`);
    else log("✓", "privacy + secrets scan clean (working tree)");

    // A pre-existing .git can carry leaks in PAST commits that a working-tree
    // scan misses — and push publishes all history. Scan it too (fresh
    // git-init publishes have no history, so this is skipped there).
    if (fs.existsSync(path.join(dir, ".git"))) {
      const hist = run("git", ["-C", dir, "log", "--all", "-p", "--no-color"], { maxBuffer: 128 * 1024 * 1024 });
      if (hist.code === 0) {
        const histLeak = scanText("(git history)", hist.out);
        const histCred = hasCred(hist.out);
        if ((histLeak && !o.allowPaths) || histCred) {
          process.stderr.write(`\n  ✗ Refusing to publish — git HISTORY contains a leak (${histCred ? "an inline credential" : histLeak}).\n  Past commits are published even if the file is gone now. Rewrite history (git filter-repo) or publish a fresh copy without the .git folder.\n`);
          process.exit(2);
        }
        log("✓", "git history scan clean");
      } else if (/does not have any commits|bad default revision|unknown revision/i.test(hist.err)) {
        // A repo with zero commits has no history to leak — safe, not a failure.
        log("·", "git history is empty — nothing to scan");
      } else {
        // Fail closed and NOT waivable: an unscannable history could hide
        // secrets, which --allow-paths (a local-path waiver) must never permit.
        process.stderr.write(`\n  ✗ Could not scan git history (${(hist.err || "too large").slice(0, 80)}). Refusing — unverified history may contain secrets.\n  Publish a fresh copy without the .git folder so there is no history to vet.\n`);
        process.exit(2);
      }
    }
  }

  if (!hasIndex && o.pages) log("⚠", "no index.html — a themed landing page will be scaffolded so Pages has something to serve");

  // Existing repo: verify visibility matches intent BEFORE touching it.
  const view = run("gh", ["repo", "view", `${login}/${o.name}`, "--json", "visibility,defaultBranchRef"]);
  const exists = view.code === 0;
  let defaultBranch = "main";
  if (exists) {
    let meta = {}; try { meta = JSON.parse(view.out); } catch {}
    defaultBranch = meta.defaultBranchRef?.name || "main";
    const isPrivate = String(meta.visibility).toLowerCase() === "private";
    if (isPrivate !== o.private) {
      process.stderr.write(`\n  ✗ ${login}/${o.name} already exists and is ${isPrivate ? "PRIVATE" : "PUBLIC"}, but you asked for ${o.private ? "private" : "public"}.\n  Refusing to push into a repo whose visibility differs from your intent — resolve this first.\n`);
      process.exit(3);
    }
  }

  const plan = [];
  const willWrite = (f, content) => {
    const fp = path.join(dir, f);
    // Never write through a symlink — a crafted project could point a scaffold
    // target outside the repo. Refuse rather than follow it.
    let lst = null; try { lst = fs.lstatSync(fp); } catch {}
    if (lst?.isSymbolicLink()) { process.stderr.write(`\n  ✗ ${f} is a symlink — refusing to write through it.\n`); process.exit(1); }
    const present = lst !== null;
    const keep = present && !o.forceDocs && f !== ".nojekyll";
    plan.push(keep ? `keep existing ${f}` : `${present ? "overwrite" : "write"} ${f}`);
    if (!keep && !o.dryRun) fs.writeFileSync(fp, content);
  };
  // .gitignore is never clobbered: an existing one is preserved and only the
  // missing safety entries (node_modules, secrets, cruft) are appended.
  const mergeGitignore = () => {
    const fp = path.join(dir, ".gitignore");
    if (!fs.existsSync(fp)) { plan.push("write .gitignore"); if (!o.dryRun) fs.writeFileSync(fp, gitignore); return; }
    const existing = fs.readFileSync(fp, "utf8");
    const have = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
    const add = gitignore.split("\n").map((l) => l.trim()).filter((l) => l && !have.has(l));
    if (!add.length) { plan.push("keep existing .gitignore (already covers safety entries)"); return; }
    plan.push(`append ${add.length} safety entr${add.length === 1 ? "y" : "ies"} to existing .gitignore`);
    if (!o.dryRun) fs.writeFileSync(fp, existing.replace(/\s*$/, "") + "\n\n# added by myrepo\n" + add.join("\n") + "\n");
  };
  willWrite("README.md", readme);
  willWrite("LICENSE", license);
  mergeGitignore();
  if (o.pages) willWrite(".nojekyll", "");
  if (!hasIndex && o.pages) willWrite("index.html", landing);
  for (const p of plan) log("·", p);

  if (o.dryRun) {
    process.stdout.write(`${JSON.stringify({ dry_run: true, repo: `${login}/${o.name}`, exists, visibility: o.private ? "private" : "public", pages_url: o.pages ? `https://${login}.github.io/${o.name}/` : null, planned: plan }, null, 2)}\n`);
    log("◆", "dry run — nothing was created or pushed");
    return;
  }

  const git = (args) => run("git", args, { cwd: dir });
  if (!fs.existsSync(path.join(dir, ".git"))) {
    // Refuse if the dir is already inside another repo — otherwise git add/-A
    // would operate on that parent tree, publishing far more than intended.
    if (git(["rev-parse", "--is-inside-work-tree"]).out === "true") {
      process.stderr.write(`\n  ✗ ${dir} is inside an existing git repository. Publish from the project root, or move it out first.\n`);
      process.exit(1);
    }
    const init = git(["init", "-q", "-b", "main"]);
    if (init.code !== 0) { process.stderr.write(`git init failed: ${init.err}\n`); process.exit(1); }
    if (!git(["config", "user.name"]).out) git(["config", "user.name", login]);
    if (!git(["config", "user.email"]).out) git(["config", "user.email", `${login}@users.noreply.github.com`]);
  }
  git(["add", "-A"]);
  // Locale-independent "is there anything staged?" — avoids parsing git's
  // localized "nothing to commit" text.
  const hasStaged = git(["diff", "--cached", "--quiet"]).code !== 0;
  if (hasStaged) {
    const commit = git(["commit", "-q", "-m", `Publish ${o.title || humanTitle(o.name)} via myrepo\n\nCo-authored-by: Claude Fable 5 <noreply@anthropic.com>`]);
    if (commit.code !== 0) { process.stderr.write(`commit failed: ${commit.err || commit.out}\n`); process.exit(1); }
    log("✓", "committed");
  } else {
    log("·", "nothing new to commit — publishing current HEAD");
  }

  if (exists) {
    const remoteUrl = `https://github.com/${login}/${o.name}.git`;
    if (git(["remote", "get-url", "origin"]).code === 0) git(["remote", "set-url", "origin", remoteUrl]);
    else git(["remote", "add", "origin", remoteUrl]);
    // Confirm origin resolves to exactly the intended repo before pushing —
    // never push to a stale/wrong origin if the rewrite silently failed.
    const actual = git(["remote", "get-url", "origin"]).out;
    if (actual.replace(/\.git$/, "") !== remoteUrl.replace(/\.git$/, "")) {
      process.stderr.write(`\n  ✗ origin is "${actual}", expected "${remoteUrl}" — refusing to push to the wrong repository.\n`);
      process.exit(1);
    }
    const push = git(["push", "-u", "origin", `HEAD:${defaultBranch}`]);
    if (push.code !== 0) { process.stderr.write(`push failed: ${push.err}\n`); process.exit(1); }
  } else {
    const create = run("gh", ["repo", "create", `${login}/${o.name}`, o.private ? "--private" : "--public", "--source", dir, "--push", ...(o.desc ? ["--description", o.desc] : [])]);
    if (create.code !== 0) { process.stderr.write(`repo create failed: ${create.err}\n`); process.exit(1); }
  }
  log("✓", `pushed to ${login}/${o.name}`);

  let pagesUrl = null, pagesLive = false;
  if (o.pages) {
    // Configure Pages for the branch we actually pushed to (an existing repo
    // may default to master), not a hardcoded 'main'.
    const body = JSON.stringify({ source: { branch: exists ? defaultBranch : "main", path: "/" } });
    const enable = run("gh", ["api", "-X", "POST", `repos/${login}/${o.name}/pages`, "--input", "-"], { input: body });
    if (enable.code !== 0 && !/already exists|409/i.test(enable.err)) log("⚠", `Pages enable returned: ${enable.err.slice(0, 120)}`);
    pagesUrl = `https://${login}.github.io/${o.name}/`;
    log("·", `Pages enabled — verifying ${pagesUrl} serves…`);
    for (let i = 0; i < 15; i++) {
      try {
        const res = await fetch(`${pagesUrl}?v=${i}`, { redirect: "follow" });
        if (res.status === 200) { pagesLive = true; break; }
      } catch {}
      if (i < 14) await sleep(20000);
    }
    log(pagesLive ? "✓" : "⚠", pagesLive ? `live and serving: ${pagesUrl}` : `Pages enabled but not yet 200 (build can lag a few minutes): ${pagesUrl}`);
  }

  const repoUrl = `https://github.com/${login}/${o.name}`;
  const manifestPath = recordPublish({ repo: repoUrl, visibility: o.private ? "private" : "public", pages_url: pagesUrl, pages_live: pagesLive, has_app: hasIndex });
  process.stdout.write(`${JSON.stringify({ repo: repoUrl, visibility: o.private ? "private" : "public", pages_url: pagesUrl, pages_live: pagesLive, has_app: hasIndex, myrepo_version: MYREPO_VERSION, publish_log: manifestPath }, null, 2)}\n`);
  process.stderr.write(`\n  ◆ Published: ${repoUrl}${pagesUrl ? `\n  ▶ Live in browser: ${pagesUrl}${pagesLive ? "" : " (building…)"}` : ""}\n`);
  // Version confession + update awareness.
  const newer = await checkForUpdate(MYREPO_VERSION);
  process.stderr.write(`  myrepo ${MYREPO_VERSION}${newer ? `  ↑ update available: ${newer} — git pull in the skills repo` : ""}${manifestPath ? `  ·  logged to ${manifestPath.replaceAll("\\", "/")}` : ""}\n\n`);
}

main().catch((e) => { process.stderr.write(`myrepo failed: ${e.message}\n`); process.exit(1); });
