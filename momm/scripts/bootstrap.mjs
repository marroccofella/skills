#!/usr/bin/env node
// Standalone trust bootstrap: builtins only. Never import or run candidate code.
// A first-time user must inspect/trust THIS tool separately before executing it.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const REMOTE = "https://github.com/marroccofella/skills.git";
export const SIGNER = "https://github.com/marroccofella/skills/.github/workflows/momm-release.yml@refs/heads/main";
export const ISSUER = "https://token.actions.githubusercontent.com";
export const GUIDE = "https://marroccofella.github.io/skills/momm/releases/bootstrap.html";
export const VERIFIER_FLAGS = ['--certificate-identity', '--certificate-oidc-issuer', '--certificate-github-workflow-repository', '--certificate-github-workflow-ref', '--certificate-github-workflow-sha'];
const bounded = s => String(s || "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ").slice(0, 1200);
const fail = (code, message) => Object.assign(new Error(message), { code });
export function trustedEnv(input = process.env) {
  const env = { ...input };
  for (const k of Object.keys(env)) if (/^(GIT_|GITSIGN_|SIGSTORE_|COSIGN_|TUF_)/i.test(k)) delete env[k];
  const nullFile = process.platform === "win32" ? "NUL" : "/dev/null";
  return { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: nullFile, GIT_CONFIG: nullFile, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', NoDefaultCurrentDirectoryInExePath: '1' };
}
const toolPaths=new Map();
function trustedTool(command,cwd) {
  if(!['git','gitsign'].includes(command))return command;
  // An inspected path that cannot be resolved (mistyped --existing) must not be
  // reported as a missing tool. Its lexical spelling still excludes candidates.
  const resolveRoot=dir=>{try{return fs.realpathSync(dir);}catch{return path.resolve(dir);}};
  const value=process.env[Object.keys(process.env).find(k=>k.toUpperCase()==='PATH')]||'',root=cwd===null?null:resolveRoot(cwd||process.cwd()),key=command+'\0'+value+'\0'+root;
  if(toolPaths.has(key))return toolPaths.get(key);
  for(const dir of value.split(path.delimiter)) {
    if(!path.isAbsolute(dir))continue;
    try {
      const candidate=fs.realpathSync(path.join(dir,command+(process.platform==='win32'?'.exe':''))),relative=root===null?null:path.relative(root,candidate);
      if(relative!==null&&(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))))continue;
      if(!fs.statSync(candidate).isFile())continue;fs.accessSync(candidate,fs.constants.X_OK);toolPaths.set(key,candidate);return candidate;
    }catch{}
  }
  throw fail('ENOENT',`Trusted ${command} executable not found on absolute PATH entries outside the inspected directory`);
}
export function execute(command, args, cwd, options = {}) {
  const {inspected=cwd,...spawnOptions}=options;
  const p = spawnSync(trustedTool(command,inspected), args, { cwd, env: trustedEnv(), encoding: "utf8", shell: false,
    windowsHide: true, timeout: 60000, maxBuffer: 32 * 1024 * 1024, ...spawnOptions });
  if (p.error || p.status !== 0) throw fail(p.error?.code || "command_failed", bounded(p.error?.message || p.stderr || p.stdout));
  return p.stdout;
}
export function readiness({ run = execute, platform = process.platform, cwd = process.cwd(), inspected = null } = {}) {
  const tools = [];
  for (const [name, args] of [["git", ["--version"]], ["gitsign", ["verify-tag", "--help"]]]) {
    try {
      const output = run(name, args, cwd, { timeout: 5000, inspected });
      if (name === "gitsign" && !VERIFIER_FLAGS.every(flag => output.includes(flag))) throw fail("unsupported_verifier", "Required verify-tag identity checks unavailable");
      tools.push({ name, status: "available" });
    } catch (error) {
      const missing = error.code === "ENOENT";
      tools.push({ name, status: missing ? "missing" : "unusable",
        next_step: name === "gitsign" ? (platform === "darwin" ? "With your approval: brew install gitsign" : "With your approval, install gitsign using https://github.com/sigstore/gitsign#installation") : "Install Git using https://git-scm.com/downloads",
        code: missing ? `${name}_missing` : `${name}_unusable` });
    }
  }
  return { status: tools.every(t => t.status === "available") ? "ready_to_verify" : "prerequisites_missing", tools,
    signature_verified: false, network_used: false, installed: false,
    note: "Tool availability is not release verification. GitHub bad_cert/Unverified is not a gitsign verdict; never bypass signature or hash checks." };
}
export function inspectExisting(root, run = execute) {
  if (!root) return { route: "new_install", next_step: "Choose a new permanent destination and an explicit harness; no existing installation is changed." };
  const existing = path.resolve(root);
  let stage = 'repository_root';
  try {
    const top = run("git", ["rev-parse", "--show-toplevel"], existing).trim();
    const canonical=process.platform==='win32'?fs.realpathSync.native:fs.realpathSync;
    if (path.relative(canonical(top),canonical(existing)) !== '') throw Error("not repository root");
    stage='receipt';
    const admin = run("git", ["rev-parse", "--git-path", "momm"], existing).trim();
    const lockPath = path.resolve(existing, admin, "momm.lock");
    let receipt = "missing";
    if (fs.existsSync(lockPath)) {
      const stat = fs.lstatSync(lockPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw Error("unsafe receipt");
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      receipt = lock.schema === "momm-lock/1" && Array.isArray(lock.installations) && lock.installations.length ? "present_not_validated" : "invalid";
    }
    const updater = fs.existsSync(path.join(existing, "momm/scripts/update.mjs"));
    stage='version_metadata';
    const versionFile = path.join(existing, "versions.json");
    const vstat = fs.lstatSync(versionFile);
    if (!vstat.isFile() || vstat.isSymbolicLink() || vstat.size > 1024 * 1024) throw Error("unsafe version metadata");
    const version = JSON.parse(fs.readFileSync(versionFile, "utf8")).momm;
    if (!/^\d+\.\d+\.\d+$/.test(version || "")) throw Error("unknown version");
    stage='working_tree';
    const changes = run("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "status", "--porcelain", "--untracked-files=all"], existing).trim().length > 0;
    return { route: receipt === "invalid" ? "receipt_repair" : receipt === "missing" || !updater ? "legacy_bootstrap" : version === "1.15.0" ? "staging_bootstrap" : "updater_preview",
      version, receipt, updater_present: updater, local_changes: changes,
      next_step: "Preserve this clone and its discovery links. Inspect saved scopes and verify the selected release before any update; do not invent a receipt or overwrite links.", guide: GUIDE };
  } catch { return { route: "inspection_required", reason_code: stage, next_step: `Inspect ${stage.replaceAll('_',' ')} in the supplied skills clone. No installation path or receipt was guessed; raw local diagnostics were not relayed.`, guide: GUIDE }; }
}
export function packageHash(repo, ref, run = execute) {
  const h = createHash("sha256");
  for (const row of run("git", ["ls-tree", "-rz", "--full-tree", ref], repo).split("\0").filter(Boolean)) {
    const m = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(row);
    if (!m) throw fail("package_invalid", "Invalid Git tree listing");
    const [, mode, type, oid, name] = m;
    if (name === "versions.json") continue;
    if (type !== "blob" || mode === "120000") throw fail("package_invalid", "Symlinks and submodules are not supported release entries");
    const bytes = run("git", ["cat-file", "blob", oid], repo, { encoding: null });
    h.update(`${mode} ${name}\0${bytes.length}\0`); h.update(bytes); h.update("\0");
  }
  return h.digest("hex");
}
export async function publishedRelease(version) {
  const response = await fetch(`https://api.github.com/repos/marroccofella/skills/releases/tags/momm-${version}`, {
    redirect: "error", signal: AbortSignal.timeout(10000), headers: { "Accept": "application/vnd.github+json" } });
  if (!response.ok) throw fail("release_unavailable", "Public GitHub release unavailable; no candidate was fetched");
  const body = await response.text();
  if (Buffer.byteLength(body) > 1024 * 1024) throw fail("release_invalid", "Release metadata exceeds limit");
  return JSON.parse(body);
}
// Only newly prepared normal repositories are accepted here. Untracked Git
// configuration is not authenticated by a tag and must not execute helpers.
export function assertPreparedRepository(root, run = execute) {
  try {
    if(fs.readdirSync(root).some(name=>/^(git|gitsign)(\.(exe|com|cmd|bat))?$/i.test(name)))throw Error('repository-local tool shadow');
    const admin=path.join(root,'.git'),dir=fs.lstatSync(admin),config=path.join(admin,'config'),stat=fs.lstatSync(config);
    if(!dir.isDirectory()||dir.isSymbolicLink()||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>65536)throw Error('nonstandard administration');
    for(const name of ['commondir','config.worktree','info/grafts','objects/info/alternates'])if(fs.existsSync(path.join(admin,name)))throw Error('indirect object/config state');
    const allowed={repositoryformatversion:/^0$/,bare:/^false$/,filemode:/^(true|false)$/,logallrefupdates:/^(true|false)$/,symlinks:/^(true|false)$/,ignorecase:/^(true|false)$/,precomposeunicode:/^(true|false)$/};
    let section='';
    for(const raw of fs.readFileSync(config,'utf8').split(/\r?\n/)) {
      const line=raw.trim();if(!line||line.startsWith('#')||line.startsWith(';'))continue;
      if(/^\[core\]$/i.test(line)){section='core';continue;}
      const m=/^([a-z]+)\s*=\s*(\S+)$/i.exec(line);
      if(section!=='core'||!m||!allowed[m[1].toLowerCase()]?.test(m[2].toLowerCase()))throw Error('unapproved local config');
    }
    if(run('git',['for-each-ref','--format=%(refname)','refs/replace/'],root).trim())throw Error('replacement refs');
    run('git',['fsck','--full','--no-dangling'],root); // Verify object bytes, not just their filenames or reachability.
  } catch(error) {
    if(['ENOENT','EACCES','EPERM','ETIMEDOUT'].includes(error.code))throw Object.assign(fail('repository_check_unavailable','Repository verification could not run. Check tools, permissions and the timeout; do not assume tampering or overwrite this clone.'),{cause_code:error.code});
    throw Object.assign(fail('unsafe_repository','Prepared Git administration or object integrity could not be verified. Preserve this clone for inspection; no local configuration was executed or overwritten.'),{cause_code:error.code||'nonstandard_administration'});
  }
}
export function verifyObjects(destination, version, run = execute) {
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw fail('invalid_version', 'An exact release version is required');
  assertPreparedRepository(destination,run);
  const tag = `momm-${version}`;
  const object = run('git', ['rev-parse', `refs/tags/${tag}`], destination).trim();
  if (!/^[a-f0-9]{40}$/.test(object) || run('git', ['cat-file', '-t', object], destination).trim() !== 'tag') throw fail('signature_unverified', 'An annotated signed release tag is required');
  const commit = run('git', ['rev-parse', `${object}^{commit}`], destination).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw fail('package_invalid', 'Invalid target commit');
  try {
    run('gitsign', ['verify-tag', '--certificate-identity', SIGNER, '--certificate-oidc-issuer', ISSUER,
      '--certificate-github-workflow-repository', 'marroccofella/skills', '--certificate-github-workflow-ref', 'refs/heads/main',
      '--certificate-github-workflow-sha', commit, tag], destination);
  } catch (error) { throw fail('signature_unverified', 'Expected release-workflow signature could not be verified. Network or trust failure is NOT permission to proceed. ' + bounded(error.message)); }
  // gitsign requires a tag name. Bind it back to the immutable fetched object.
  if (run('git', ['rev-parse', `refs/tags/${tag}`], destination).trim() !== object) throw fail('signature_unverified', 'Tag reference changed during verification');
  const manifest = JSON.parse(run('git', ['show', `${commit}:versions.json`], destination));
  const release = manifest.momm_releases?.find(r => r.version === version);
  if (manifest.momm !== version || release?.tag !== tag || release?.hash_covers !== 'git-tree-blobs-excluding-versions/1' || !/^[a-f0-9]{64}$/.test(release?.sha256 || '')) throw fail('package_invalid', 'Signed release metadata is missing or mismatched');
  const hash = packageHash(destination, commit, run);
  if (hash !== release.sha256) throw fail('hash_mismatch', 'Signed release package hash mismatch; no candidate execution occurred');
  return { tag, object, commit, hash };
}
export function verifyCheckout(root, commit, run = execute) {
  assertPreparedRepository(root,run);
  if(run('git',['status','--porcelain','--untracked-files=all','--ignored'],root).trim())throw fail('checkout_changed','Tracked, untracked or ignored working files differ from the prepared release');
  const canonical = fs.realpathSync(root);
  if (run('git', ['rev-parse', 'HEAD'], root).trim() !== commit) throw fail('checkout_changed', 'HEAD differs from the verified release');
  for (const row of run('git', ['ls-tree', '-rz', '--full-tree', commit], root).split('\0').filter(Boolean)) {
    const m = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(row);
    if (!m || m[2] !== 'blob' || m[1] === '120000') throw fail('checkout_changed', 'Unsupported release entry');
    const file = path.resolve(canonical, m[4]);
    try {
      const relative=path.relative(canonical,fs.realpathSync(file)),stat=fs.lstatSync(file);
      if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!stat.isFile()||stat.isSymbolicLink())throw Error('unsafe entry');
    } catch {throw fail('checkout_changed','A tracked release file is missing, inaccessible or escapes the prepared clone');}
    const expected = run('git', ['cat-file', 'blob', m[3]], root, { encoding: null });
    if (fs.statSync(file).size !== expected.length || !fs.readFileSync(file).equals(expected)) throw fail('checkout_changed', 'Working files differ from signed Git objects');
  }
}
export async function prepare(options, { run = execute, check = readiness, releaseRecord = publishedRelease } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(options.version || "") || !options.destination) throw fail("arguments_required", "--prepare requires --version x.y.z and --destination <new permanent directory>");
  const ready = check({ run });
  if (ready.status !== "ready_to_verify") throw fail("prerequisites_missing", JSON.stringify(ready));
  const destination = path.resolve(options.destination);
  if (fs.existsSync(destination) || path.dirname(destination) === destination) throw fail("destination_conflict", "Destination must not exist; existing clones and links are never replaced");
  const published = await releaseRecord(options.version);
  if (published.tag_name !== `momm-${options.version}` || published.draft !== false || published.prerelease !== false) throw fail("release_not_stable", "Only a published, non-draft, non-prerelease release is eligible");
  // No recursive creation: the user chooses an existing permanent parent.
  fs.mkdirSync(destination, { mode: 0o700 });
  try {
    run("git", ["-c", "init.templateDir=", "init", "."], destination);
    const tag = `momm-${options.version}`;
    run("git", ["-c", "credential.helper=", "fetch", "--no-tags", REMOTE, `refs/tags/${tag}:refs/tags/${tag}`], destination);
    const { object, commit, hash } = verifyObjects(destination, options.version, run);
    // Only verified objects are materialized. Hooks/config templates are disabled.
    run("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.autocrlf=false", "-c", "core.eol=lf", "checkout", "--detach", commit], destination);
    if (run("git", ["rev-parse", "HEAD"], destination).trim() !== commit || run("git", ["status", "--porcelain", "--untracked-files=all"], destination).trim()) throw fail("checkout_changed", "Prepared checkout changed; do not execute candidate code");
    verifyCheckout(destination, commit, run);
    return { status: "verified_prepared", version: options.version, destination, tag, tag_object: object, commit,
      package_sha256: hash, signature_verified: true, hash_verified: true, network_used: true, installed: false, receipt_created: false,
      next_step: "Inspect the verified SKILL.md and installer preview for your explicit harness. Preserve the old clone/links; obtain protocol and link-change approval before installation.", guide: GUIDE };
  } catch (error) {
    error.diagnostic_directory = destination;
    error.message += ` Diagnostic directory retained at ${destination}; no existing installation was changed.`;
    throw error;
  }
}
export function errorReport(error) { return { status: error.code || 'bootstrap_failed', error: bounded(error.message), ...(error.cause_code ? { cause_code: error.cause_code } : {}), ...(error.diagnostic_directory ? { diagnostic_directory: error.diagnostic_directory } : {}), installed: false }; }
export function parse(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (["--check", "--prepare", "--help"].includes(a)) o[a.slice(2)] = true;
    else if (["--version", "--destination", "--existing"].includes(a)) {
      const v = args[++i]; if (!v || v.startsWith("--")) throw fail("invalid_arguments", `Missing ${a} value`); o[a.slice(2)] = v;
    } else throw fail("invalid_arguments", `Unknown option ${bounded(a)}; no apply, force or auto-install option exists`);
  }
  if (o.check && o.prepare || !o.prepare && (o.version || o.destination)) throw fail("invalid_arguments", "Choose --check, or --prepare with version and destination");
  return o;
}
function entry() { try { return process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } }
if (entry()) {
  try {
    const o = parse(process.argv.slice(2));
    if (o.help) console.log("MOMM bootstrap: --check [--existing <old-clone>] | --prepare --version x.y.z --destination <new-directory> [--existing <old-clone>]\nCheck is offline. Prepare contacts github.com and Sigstore trust/transparency services. No model calls, installer execution, link replacement or automatic verifier installation. Inspect/trust this standalone tool separately before first use.");
    else {
      const installation = inspectExisting(o.existing);
      if (o.prepare) console.error("Network: GitHub signed tag objects and Sigstore trust/transparency services. Preparing a NEW directory only; not installing.");
      const result = o.prepare ? await prepare(o) : readiness({inspected:o.existing?path.resolve(o.existing):null});
      console.log(JSON.stringify({ ...result, installation, bootstrap_trust: "This tool must be independently reviewed/trusted; it does not authenticate itself" }, null, 2));
      if (result.status === "prerequisites_missing") process.exitCode = 2;
    }
  } catch (error) { console.error(JSON.stringify(errorReport(error))); process.exitCode = 1; }
}
