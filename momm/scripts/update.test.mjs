#!/usr/bin/env node
// Real temporary Git repositories; only the trust service is stubbed for
// successful transaction tests. Production unsigned rejection is also tested.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { update, parse, git, run, treeHash, readLock, recordInstall, stateDir, dailyCheck, updateCheckDisabled, hash, verifySignature, signingEnv, provenance, newer, captureExec, lastSuccessfulReviews, checkAll, checkAllTable } from "./update.mjs";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
await import('./update-safety.test.mjs');
await import('./update-receipt.test.mjs');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "momm-update-tests-"));
const remote = path.join(fixture, "remote"), installed = path.join(fixture, "installed");
const results = {};
let failures = 0;
// Record every failure rather than aborting at the first, so one run shows the whole picture; the exit code still fails.
async function test(name, fn) { try { await fn(); results[name] = true; } catch (e) { failures++; results[name] = `FAILED: ${e.message.split("\n")[0].slice(0, 300)}`; } }
function write(root, file, text) { const p = path.join(root, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
function commit(root, message) { git(root, "add", "."); git(root, "-c", "user.name=MOMM test", "-c", "user.email=momm-test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", message); return git(root, "rev-parse", "HEAD"); }
const log = () => {};
try {
  fs.mkdirSync(remote);
  await test("aliased_cli_entry_runs_instead_of_silent_success", () => {
    const alias = path.join(fixture, "scripts-alias");
    fs.symlinkSync(path.join(source, "momm/scripts"), alias, process.platform === "win32" ? "junction" : "dir");
    try {
      const canonical = run(process.execPath, [path.join(source, "momm/scripts/update.mjs"), "--help"], fixture);
      const aliased = run(process.execPath, [path.join(alias, "update.mjs"), "--help"], fixture);
      assert(canonical.trim().length > 0);
      assert.equal(aliased, canonical, "The same real entrypoint must execute through a directory alias");
    } finally { fs.unlinkSync(alias); }
  });
  git(remote, "init");
  for (const file of ["momm/scripts/install.mjs", "momm/scripts/update.mjs", "momm/scripts/bootstrap.mjs", "install.mjs"]) write(remote, file, fs.readFileSync(path.join(source, file)));
  write(remote, "momm/SKILL.md", "Original protocol\n");
  write(remote, "sibling/SKILL.md", "A separately installed sibling\n");
  write(remote, "momm/scripts/multi-review.mjs", "console.log('fixture dispatcher one');\n");
  write(remote, "versions.json", JSON.stringify({ momm: "1.0.0" }));
  write(remote, ".gitignore", "user-cache/\n");
  const first = commit(remote, "fixture one");
  git(fixture, "clone", remote, installed);
  const custom = path.join(fixture, "harness");
  run(process.execPath, ["momm/scripts/install.mjs", "--custom-dir", custom], installed);
  await test("explicit_install_records_exact_custom_harness", () => {
    assert.deepEqual(readLock(installed).custom_dirs, [custom]);
    assert.deepEqual(readLock(installed).targets, []);
    assert.equal(fs.realpathSync(path.join(custom, "momm")), fs.realpathSync(path.join(installed, "momm")));
  });
  const secondHarness = path.join(fixture, "second-harness");
  run(process.execPath, ["install.mjs", "--skills", "momm,sibling", "--custom-dir", secondHarness], installed);
  write(remote, 'intermediate.txt', 'first intervening change\n'); commit(remote, 'intermediate one');
  write(remote, 'intermediate.txt', 'second intervening change\n'); commit(remote, 'intermediate two');
  write(remote, "momm/SKILL.md", "Explicit new protocol\n");
  write(remote, "momm/scripts/multi-review.mjs", "console.log('fixture dispatcher two');\n");
  write(remote, "versions.json", JSON.stringify({ momm: "1.1.0" }));
  write(remote, ".gitignore", "# New release has different ignore rules\n");
  const second = commit(remote, "fixture two");
  git(remote, "-c", "user.name=MOMM test", "-c", "user.email=momm-test@example.invalid", "tag", "-a", "momm-1.1.0", "-m", "unsigned fixture");
  const release = { version: "1.1.0", tag: "momm-1.1.0", sha256: treeHash(remote, "HEAD"), hash_covers: "git-tree-blobs-excluding-versions/1", changes: ["Explicit protocol change"] };
  const manifest = async () => ({ momm: "1.1.0", momm_releases: [release] });
  let verified = 0;
  const deps = { remote, manifest, log, verifySignature: (root, ref, channel) => { assert.equal(ref, "momm-1.1.0"); assert.equal(channel, "stable"); verified++; } };
  const command = args => update(["--repo", installed, ...args], deps);
  const lockPath = path.join(stateDir(installed), "momm.lock");
  await test("manifest_check_does_not_fetch_or_mutate_receipt", async () => {
    const before = fs.readFileSync(lockPath, "utf8"), refs = git(installed, "show-ref");
    await command([]);
    assert.equal(fs.readFileSync(lockPath, "utf8"), before); assert.equal(git(installed, "show-ref"), refs); assert.equal(verified, 0);
  });
  await test("signed_preview_uses_discoverable_nonbare_staging_without_checkout", async () => {
    let inspected = false;
    await update(["--repo", installed, "--dry-run"], { ...deps, verifySignature: (root, ref, channel) => {
      assert.equal(git(root, "rev-parse", "--is-bare-repository"), "false", "gitsign requires discoverable non-bare staging");
      assert(fs.statSync(path.join(root, ".git")).isDirectory());
      assert.deepEqual(fs.readdirSync(root), [".git"], "candidate files must not be checked out before verification");
      deps.verifySignature(root, ref, channel);
      inspected = true;
    } });
    assert(inspected, "preview must reach its signature verifier");
  });
  await test("dry_run_shows_policy_without_installed_ref_or_lock_changes", async () => {
    const before = fs.readFileSync(lockPath, "utf8"), refs = git(installed, "show-ref"), logs = [];
    await update(["--repo", installed, "--dry-run"], { ...deps, log: s => logs.push(s) });
    assert(logs.some(s => s.includes("Explicit new protocol"))); assert(logs.some(s => s.includes("Network:")));
    assert.equal(fs.readFileSync(lockPath, "utf8"), before); assert.equal(git(installed, "show-ref"), refs); assert.equal(git(installed, "rev-parse", "HEAD"), first);
  });
  await test("unsigned_tag_fails_production_verifier", async () => {
    await assert.rejects(update(["--repo", installed, "--apply", "--yes", "--accept-protocol"], { ...deps, verifySignature }), error => ['signature_unverified', 'gitsign_missing'].includes(error.code));
    assert.equal(git(installed, "rev-parse", "HEAD"), first);
  });
  await test("yes_does_not_accept_changed_protocol", async () => {
    await assert.rejects(command(["--apply", "--yes"]), /--accept-protocol/); assert.equal(git(installed, "rev-parse", "HEAD"), first);
  });
  await test("wrong_package_hash_refused_before_checkout", async () => {
    await assert.rejects(update(["--repo", installed, "--apply", "--yes", "--accept-protocol"], { ...deps, manifest: async () => ({ momm: "1.1.0", momm_releases: [{ ...release, sha256: "0".repeat(64) }] }) }), /SHA-256/);
    assert.equal(git(installed, "rev-parse", "HEAD"), first);
  });
  await test("local_changes_not_overwritten", async () => {
    write(installed, "keep.txt", "user-owned");
    await assert.rejects(command(["--apply", "--yes", "--accept-protocol"]), /local changes/);
    assert.equal(fs.readFileSync(path.join(installed, "keep.txt"), "utf8"), "user-owned"); fs.unlinkSync(path.join(installed, "keep.txt"));
  });
  // Reported from the field on 20 September 2026: the verified updater stopped on local changes, which is
  // right, and left the person with nothing to do next, which is not. The refusal must name the files,
  // say whether MOMM's own signed files were edited, and give safe choices. It still changes nothing.
  await test("local_changes_refusal_names_the_files_and_offers_safe_ways_forward", async () => {
    write(installed, "momm/scripts/local-note.test.mjs", "// mine\n");
    const tracked = path.join(installed, "momm/SKILL.md"), before = fs.readFileSync(tracked);
    fs.appendFileSync(tracked, "\nmy local edit\n");
    const head = git(installed, "rev-parse", "HEAD"), branches = git(installed, "branch", "--list");
    let error; try { await command(["--apply", "--yes", "--accept-protocol"]); } catch (e) { error = e; }
    try {
      assert(error, "the update must be refused"); assert.equal(error.code, "local_changes");
      assert.match(error.message, /local changes/);
      assert.match(error.message, /momm\/SKILL\.md/); assert.match(error.message, /momm\/scripts\/local-note\.test\.mjs/);
      assert.match(error.message, /untracked/); assert.match(error.message, /modified/);
      assert.match(error.message, /not the signed release/i, "an edited MOMM file means what runs today is not the verified release");
      assert.match(error.message, /switch -c/, "keeping the changes on a branch is offered, as commands the OWNER runs");
      assert.match(error.message, /never stash, overwrite, reset or discard/i);
      assert.deepEqual(error.changes.map(c => c.path).sort(), ["momm/SKILL.md", "momm/scripts/local-note.test.mjs"]);
      // Nothing was touched: same commit, same branches, both local changes still there.
      assert.equal(git(installed, "rev-parse", "HEAD"), head); assert.equal(git(installed, "branch", "--list"), branches);
      assert.equal(fs.readFileSync(path.join(installed, "momm/scripts/local-note.test.mjs"), "utf8"), "// mine\n");
      assert(fs.readFileSync(tracked, "utf8").endsWith("my local edit\n"));
    } finally { fs.writeFileSync(tracked, before); fs.unlinkSync(path.join(installed, "momm/scripts/local-note.test.mjs")); }
  });
  await test("local_changes_refusal_is_bounded_and_inert_for_hostile_file_names", async () => {
    for (let i = 0; i < 40; i++) write(installed, `junk/file-${i}.txt`, "x");
    write(installed, "junk/$(touch PWNED) `x` & echo.txt", "x");
    let error; try { await command(["--apply", "--yes", "--accept-protocol"]); } catch (e) { error = e; }
    try {
      assert.equal(error?.code, "local_changes"); assert(error.message.length < 6000, "bounded message");
      assert.match(error.message, /and \d+ more/); assert.equal(fs.existsSync(path.join(installed, "PWNED")), false);
      assert(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(error.message));
    } finally { fs.rmSync(path.join(installed, "junk"), { recursive: true, force: true }); }
  });
  await test("pinned_channel_requires_explicit_version", async () => {
    await command(["--channel", "pinned"]);
    await assert.rejects(command(["--dry-run"]), /Pinned channel/);
    await command(["--channel", "stable"]);
  });
  await test('main_channel_never_ignores_explicit_version', async () => {
    await assert.rejects(command(['--channel', 'main', '--version', '1.1.0', '--dry-run']), /cannot be combined/);
    await command(['--channel', 'main']);
    await assert.rejects(command(['--version', '1.1.0', '--dry-run']), /cannot be combined/);
    await command(['--channel', 'stable']);
  });
  await test('existing_update_claim_is_preserved_even_when_incomplete', async () => {
    const claim = path.join(stateDir(installed), 'update.active');
    fs.writeFileSync(claim, '');
    try { await assert.rejects(command(['--channel', 'pinned']), /Existing update claim/); assert.equal(fs.readFileSync(claim, 'utf8'), ''); }
    finally { fs.unlinkSync(claim); }
  });
  await test("ignore_rule_change_cannot_strand_existing_private_files", async () => {
    write(installed, "user-cache/private.txt", "user-owned ignored bytes");
    await assert.rejects(command(["--apply", "--yes", "--accept-protocol"]), /Ignore rules change/);
    assert.equal(git(installed, "rev-parse", "HEAD"), first);
    assert.equal(fs.readFileSync(path.join(installed, "user-cache/private.txt"), "utf8"), "user-owned ignored bytes");
    assert.equal(fs.existsSync(path.join(stateDir(installed), "transaction.json")), false);
    fs.unlinkSync(path.join(installed, "user-cache/private.txt")); fs.rmdirSync(path.join(installed, "user-cache"));
  });
  await test("pre_checkout_failure_preserves_attached_branch", async () => {
    const branch = git(installed, "symbolic-ref", "--short", "HEAD");
    const refLock = path.resolve(installed, git(installed, "rev-parse", "--git-path", "refs/momm/verified.lock"));
    fs.mkdirSync(path.dirname(refLock), { recursive: true });
    fs.writeFileSync(refLock, "fixture-owned ref lock");
    try {
      await assert.rejects(command(["--apply", "--yes", "--accept-protocol"]), /Previous installation restored/);
    } finally { fs.unlinkSync(refLock); }
    assert.equal(git(installed, "rev-parse", "HEAD"), first);
    assert.equal(git(installed, "symbolic-ref", "--short", "HEAD"), branch);
  });
  await test("relink_failure_restores_previous_installation", async () => {
    let attempts = 0;
    await assert.rejects(update(["--repo", installed, "--apply", "--yes", "--accept-protocol"], { ...deps, reinstall: () => { if (++attempts === 1) throw new Error("fixture relink failure"); } }), /Previous installation restored/);
    assert.equal(git(installed, "rev-parse", "HEAD"), first); assert.equal(attempts, 2);
    assert.equal(fs.existsSync(path.join(stateDir(installed), "transaction.json")), false);
  });
  await test("post_relink_wrong_commit_is_not_success", async () => {
    await assert.rejects(update(["--repo", installed, "--apply", "--yes", "--accept-protocol"], { ...deps, reinstall: () => { git(installed, "checkout", "--detach", first); } }), /Checkout changed during harness replay/);
    assert.equal(readLock(installed).current.commit, first);
  });
  await test("apply_relinks_exact_saved_target_and_retains_hashed_previous", async () => {
    await command(["--apply", "--yes", "--accept-protocol"]);
    const lock = readLock(installed);
    assert.equal(git(installed, "rev-parse", "HEAD"), second); assert.equal(lock.current.verified, true);
    assert.equal(lock.previous.current.commit, first); assert.equal(lock.previous.current.tree_sha256, treeHash(installed, first));
    assert.equal(lock.current.dispatcher_sha256, hash(fs.readFileSync(path.join(installed, "momm/scripts/multi-review.mjs"))));
    assert.equal(git(installed, 'rev-parse', 'refs/momm/verified'), second, 'promotion must create the verified ref');
    git(installed, 'fsck', '--connectivity-only');
  });
  await test('adding_harness_preserves_matching_verified_release_provenance', () => {
    const thirdHarness = path.join(fixture, 'third-harness');
    run(process.execPath, ['momm/scripts/install.mjs', '--custom-dir', thirdHarness], installed);
    assert.equal(provenance(installed).release_verified, true);
  });
  await test("mixed_harness_scopes_do_not_expand_on_update", () => {
    assert.equal(fs.existsSync(path.join(custom, "sibling")), false);
    assert.equal(fs.realpathSync(path.join(secondHarness, "sibling")), fs.realpathSync(path.join(installed, "sibling")));
  });
  await test("changed_loaded_helper_invalidates_release_provenance", () => {
    assert.equal(provenance(installed).release_verified, true);
    const helper = path.join(installed, "momm/scripts/update.mjs"), original = fs.readFileSync(helper);
    fs.appendFileSync(helper, "\n// local change\n");
    assert.equal(provenance(installed).release_verified, false); fs.writeFileSync(helper, original);
  });
  await test("post_rollback_wrong_commit_retains_recovery_journal", async () => {
    await assert.rejects(update(["--repo", installed, "--rollback", "--yes"], { log, reinstall: () => { git(installed, "checkout", "--detach", second); } }), /Checkout changed during harness replay/);
    assert.equal(fs.existsSync(path.join(stateDir(installed), "transaction.json")), true);
  });
  await test("offline_rollback_uses_retained_runner_and_original_links", () => {
    // The recovery runner reads no manifest and needs no signature service.
    const alias = path.join(fixture,"recovery-alias");
    fs.symlinkSync(stateDir(installed),alias,process.platform==='win32'?'junction':'dir');
    try { assert.match(run(process.execPath, [path.join(alias, "update.mjs"), "--rollback", "--yes"], installed), /Rollback verified/); }
    finally { fs.unlinkSync(alias); }
    assert.equal(git(installed, "rev-parse", "HEAD"), first); assert.equal(readLock(installed).previous, null);
    assert.equal(fs.existsSync(path.join(stateDir(installed),"transaction.json")),false);
    assert.equal(fs.realpathSync(path.join(custom, "momm")), fs.realpathSync(path.join(installed, "momm")));
  });
  await test("daily_check_once_and_optouts_make_zero_requests", async () => {
    let requests = 0; const fetcher = async () => { requests++; return { ok: true, text: async () => JSON.stringify({ momm: "1.1.0" }) }; };
    const opts = { root: installed, fetcher, now: 100000000, env: {} };
    assert.equal(await dailyCheck("1.0.0", opts), "1.1.0");
    assert.equal(await dailyCheck("1.0.0", opts), null);
    for (const env of [{ DO_NOT_TRACK: "1" }, { NO_UPDATE_CHECK: "1" }, { MOMM_NO_UPDATE_CHECK: "true" }]) {
      assert.equal(await dailyCheck("1.0.0", { ...opts, now: 200000000, env }), null);
    }
    assert.equal(requests, 1); assert.equal(updateCheckDisabled({ NO_UPDATE_CHECK: "0", DO_NOT_TRACK: "1" }), true);
  });
  await test("argument_conflicts_and_auto_update_rejected", () => {
    for (const args of [["--auto-update"], ["--apply", "--dry-run"], ["--rollback", "--version", "1.0.0"], ["--channel", "unsafe"], ["--yes"]]) assert.throws(() => parse(args));
  });
  await test("interrupted_daily_claim_recovers_without_stealing_live_claim", async () => {
    const claim = path.join(stateDir(installed), "version-check.active");
    let requests = 0;
    const opts = { root: installed, env: {}, now: 400000000, fetcher: async () => { requests++; return { ok: true, text: async () => JSON.stringify({ momm: "1.1.0" }) }; } };
    fs.writeFileSync(claim, ""); fs.utimesSync(claim, new Date(0), new Date(0));
    assert.equal(await dailyCheck("1.0.0", opts), "1.1.0"); assert.equal(requests, 1);
    fs.writeFileSync(claim, JSON.stringify({ pid: process.pid }));
    assert.equal(await dailyCheck("1.0.0", { ...opts, now: 500000000 }), null); assert.equal(requests, 1);
    assert.equal(JSON.parse(fs.readFileSync(claim)).pid, process.pid); fs.unlinkSync(claim);
  });
  await test("trust_environment_cannot_override_roots_or_git_repository", () => {
    const env = signingEnv({ Path: "fixture", GIT_CONFIG: "attacker-config", git_config_parameters: "attacker", GIT_DIR: "other-repo", GIT_CONFIG_COUNT: "1", GITSIGN_FULCIOROOT: "attacker.pem", SIGSTORE_ROOT_FILE: "attacker" });
    assert.equal(env.GIT_CONFIG, process.platform === "win32" ? "NUL" : "/dev/null");
    for (const k of ["git_config_parameters", "GIT_DIR", "GIT_CONFIG_COUNT", "GITSIGN_FULCIOROOT", "SIGSTORE_ROOT_FILE"]) assert.equal(env[k], undefined);
    assert.equal(env.Path, "fixture");
  });
  await test("archive_install_links_but_reports_updater_unavailable", () => {
    const archive = path.join(fixture, "archive"), destination = path.join(fixture, "archive-harness");
    for (const file of ["momm/SKILL.md", "momm/scripts/install.mjs", "momm/scripts/update.mjs", "momm/scripts/bootstrap.mjs"]) write(archive, file, fs.readFileSync(path.join(installed, file)));
    const output = JSON.parse(run(process.execPath, ["momm/scripts/install.mjs", "--custom-dir", destination], archive));
    assert.equal(output.installation.updater_available, false);
    assert(['ready_to_verify', 'prerequisites_missing'].includes(output.update_readiness.status));
    assert.equal(output.update_readiness.signature_verified, false);
    assert.equal(fs.realpathSync(path.join(destination, "momm")), fs.realpathSync(path.join(archive, "momm")));
  });
  // ---- --check-all (fakes only: no CLI launched, no network) ----
  const checkFixture = path.join(fixture, "check-all");
  const voltaBin = path.join(checkFixture, ".volta", "bin"), plainBin = path.join(checkFixture, "bin"), project = path.join(checkFixture, "project");
  fs.mkdirSync(voltaBin, { recursive: true }); fs.mkdirSync(plainBin); fs.mkdirSync(path.join(project, ".ensemble_reviews"), { recursive: true });
  for (const [dir, name] of [[voltaBin, "codex"], [plainBin, "claude"], [plainBin, "copilot"]]) for (const file of [name, `${name}.cmd`]) { fs.writeFileSync(path.join(dir, file), "@echo fixture\n"); fs.chmodSync(path.join(dir, file), 0o755); }
  fs.writeFileSync(path.join(project, ".ensemble_reviews", "review-log.jsonl"), [
    JSON.stringify({ timestamp: "2026-09-10T10:00:00.000Z", run_id: "rev_a", reviewer_status: { claude: "success", codex: "timeout" } }),
    JSON.stringify({ event: "split", timestamp: "2026-09-13T00:00:00.000Z", reviewer_status: { claude: "success" } }),
    "not json at all",
    JSON.stringify({ timestamp: "2026-09-12T22:45:30.000Z", run_id: "rev_b", reviewer_status: { claude: "success", codex: "error", grok: "success" } }),
    JSON.stringify({ timestamp: "2026-09-11T09:00:00.000Z", run_id: "rev_c", reviewer_status: { claude: "invalid_output", grok: "success" } }),
  ].join("\n") + "\n");
  const versions = { codex: "codex-cli 0.154.0", claude: "2.1.270 (Claude Code)", copilot: "1.0.83", grok: "grok 1.0.30 (04b7ffed98c6)", agy: "1.2.2" };
  const fakeExec = (log = []) => async (command, args) => {
    const name = path.basename(command).replace(/\.exe$/i, ""); log.push([name, ...args]);
    if (name === "gemini") return { code: -1, stdout: "", stderr: "spawnSync gemini ENOENT", error: { code: "ENOENT" } };
    if (args[0] === "--version") return { code: 0, stdout: `${versions[name]}\n`, stderr: "" };
    if (name === "grok" && args.join(" ") === "update --check --stable --json") return { code: 0, stdout: JSON.stringify({ currentVersion: "1.0.30", latestVersion: "1.0.31", updateAvailable: true }), stderr: "" };
    return { code: 1, stdout: "", stderr: `unexpected fake call ${name} ${args.join(" ")}` };
  };
  const npmLatest = { "@openai%2fcodex": "0.155.0", "@anthropic-ai%2fclaude-code": "2.1.270", "@google%2fgemini-cli": "0.60.0", "@github%2fcopilot": "1.0.84" };
  const fakeFetcher = (urls = []) => async url => { urls.push(url); const m = /^https:\/\/registry\.npmjs\.org\/([^/]+)\/latest$/.exec(url); return m && npmLatest[m[1]] ? { ok: true, status: 200, text: async () => JSON.stringify({ name: decodeURIComponent(m[1]), version: npmLatest[m[1]] }) } : { ok: false, status: 404, text: async () => "" }; };
  const checkDeps = extra => ({ ...deps, env: { PATH: [voltaBin, plainBin].join(path.delimiter), LOCALAPPDATA: path.join(checkFixture, "localappdata") }, home: path.join(checkFixture, "home"), cwd: project, ...extra });
  await test("unknown_installed_skill_version_is_not_reported_current", async () => {
    for (const version of [null, "unknown", "broken-version"]) {
      const report = await checkAll(installed, { channel: "stable", current: { version } }, checkDeps({ manifest: async () => ({ momm: "1.16.0" }), exec: fakeExec(), fetcher: fakeFetcher() }));
      assert.equal(report.skill.update_available, null);
      assert.match(checkAllTable(report).split("\n")[0], /not compared$/);
    }
  });
  await test("check_all_json_reports_scopes_versions_ownership_and_last_reviews_with_fakes_only", async () => {
    const calls = [], urls = [], logs = [];
    const report = await update(["--repo", installed, "--check-all", "--json"], checkDeps({ exec: fakeExec(calls), fetcher: fakeFetcher(urls), log: s => logs.push(s) }));
    assert.equal(logs.length, 1, "--json prints exactly one JSON document and no network notice");
    assert.deepEqual(JSON.parse(logs[0]).clis.map(c => c.cli), [...report.clis.map(c => c.cli)]);
    assert.equal(report.schema, "momm-check-all/1");
    assert.equal(report.skill.installed, readLock(installed).current.version); assert.equal(report.skill.published, "1.1.0"); assert.equal(report.skill.update_available, true);
    assert.deepEqual(report.installations.custom_dirs, readLock(installed).custom_dirs); assert.equal(report.installations.custom_dirs.length, 3);
    assert.deepEqual(report.installations.targets, []); assert.equal(report.installations.scopes.filter(s => s.target === "custom").length, 3);
    const by = Object.fromEntries(report.clis.map(c => [c.cli, c]));
    assert.deepEqual(Object.keys(by).sort(), ["antigravity", "claude", "codex", "copilot", "gemini", "grok"]);
    assert.equal(by.codex.installed, "0.154.0"); assert.equal(by.codex.latest, "0.155.0"); assert.equal(by.codex.update_available, true);
    assert.equal(by.codex.package_manager_owned, true); assert.equal(by.codex.manager, "volta"); assert.match(by.codex.update_command, /volta/);
    assert.equal(by.claude.installed, "2.1.270"); assert.equal(by.claude.latest, "2.1.270"); assert.equal(by.claude.update_available, false); assert.equal(by.claude.package_manager_owned, false); assert.equal(by.claude.update_command, "claude update");
    assert.equal(by.gemini.installed, "not installed"); assert.equal(by.gemini.latest, "0.60.0"); assert.equal(by.gemini.update_available, null); assert.equal(by.gemini.path, null);
    assert.equal(by.grok.installed, "1.0.30"); assert.equal(by.grok.latest, "1.0.31"); assert.equal(by.grok.update_available, true); assert.equal(by.grok.latest_source, "grok update --check --stable --json");
    assert.equal(by.antigravity.installed, "1.2.2"); assert.equal(by.antigravity.latest, "unknown"); assert.equal(by.antigravity.binary, "agy");
    assert.deepEqual(by.claude.last_successful_review, { timestamp: "2026-09-12T22:45:30.000Z", run_id: "rev_b" });
    assert.deepEqual(by.grok.last_successful_review, { timestamp: "2026-09-12T22:45:30.000Z", run_id: "rev_b" });
    assert.equal(by.codex.last_successful_review, null); assert.equal(report.reviews.runs, 3);
    assert.deepEqual(urls.sort(), Object.keys(npmLatest).sort().map(p => `https://registry.npmjs.org/${p}/latest`), "only the four npm latest documents are fetched");
    assert(calls.every(c => c[1] === "--version" || c.join(" ") === "grok update --check --stable --json"), "only version and check-only commands run");
    assert.equal(report.pending_recovery, false);
  });
  await test("check_all_table_names_not_installed_routes_custom_dirs_and_managers", async () => {
    const logs = [];
    await update(["--repo", installed, "--check-all"], checkDeps({ exec: fakeExec(), fetcher: fakeFetcher(), log: s => logs.push(s) }));
    const text = logs.join("\n");
    assert.match(logs[0], /^Network:/); assert(text.includes("not installed")); assert(text.includes("volta (package manager)"));
    for (const d of readLock(installed).custom_dirs) assert(text.includes(d), `custom dir listed: ${d}`);
    assert(text.includes("2026-09-12T22:45:30.000Z")); assert(text.includes("never")); assert(text.includes("0.154.0 *"));
    assert(!/registry\.npmjs\.org.*Network/.test(text));
  });
  await test("check_all_tolerates_missing_review_log_and_unreachable_registry", async () => {
    const report = await update(["--repo", installed, "--check-all", "--json"], checkDeps({ exec: fakeExec(), fetcher: async () => ({ ok: false, status: 503, text: async () => "" }), cwd: checkFixture, log() {} }));
    assert.equal(report.reviews.present, false); assert.equal(report.reviews.runs, 0);
    const codex = report.clis.find(c => c.cli === "codex");
    assert.equal(codex.latest, "unknown"); assert.match(codex.error, /HTTP 503/); assert.equal(codex.installed, "0.154.0"); assert.equal(codex.update_available, null);
  });
  await test("check_all_is_read_only_and_json_needs_it", () => {
    for (const args of [["--json"], ["--check-all", "--apply"], ["--check-all", "--dry-run"], ["--check-all", "--channel", "main"], ["--check-all", "--version", "1.1.0"]]) assert.throws(() => parse(args), /check-all|--json/);
    assert.throws(() => parse(["--check-all", "--yes"]));
    assert.deepEqual(parse(["--check-all", "--json"]), { check_all: true, json: true });
  });
  // ---- 1.16 release-gate findings against --check-all (fakes only) ----
  const only = (cli, reply) => async (command, args) => path.basename(command).replace(/\.exe$/i, "") === cli && args[0] === "--version" ? reply : fakeExec()(command, args);
  await test("check_all_accepts_repo_and_names_it_in_the_exclusive_mode_error", () => {
    assert.deepEqual(parse(["--check-all", "--json", "--repo", installed]), { check_all: true, json: true, repo: installed });
    assert.throws(() => parse(["--check-all", "--apply"]), /--json and --repo/);
  });
  const historyDir = path.join(checkFixture, "history");
  const history = lines => { fs.mkdirSync(path.join(historyDir, ".ensemble_reviews"), { recursive: true }); fs.writeFileSync(path.join(historyDir, ".ensemble_reviews", "review-log.jsonl"), lines.join("\n") + "\n"); return lastSuccessfulReviews(historyDir); };
  const good = { timestamp: "2026-09-02T00:00:00.000Z", run_id: "rev_ok", reviewer_status: { grok: "success" } };
  await test("null_and_non_object_history_records_are_skipped_not_fatal", () => {
    const r = history(["null", "42", "\"text\"", "[1,2]", JSON.stringify({ timestamp: "2026-09-01T00:00:00.000Z", reviewer_status: null }), JSON.stringify({ timestamp: "2026-09-01T00:00:00.000Z", reviewer_status: ["grok"] }), JSON.stringify(good)]);
    assert.equal(r.runs, 1); assert.deepEqual(r.routes.grok, { timestamp: good.timestamp, run_id: "rev_ok" });
  });
  await test("unparseable_timestamp_never_locks_a_route", () => {
    const r = history([JSON.stringify({ ...good, timestamp: "not a date", run_id: "rev_bad" }), JSON.stringify(good), JSON.stringify({ ...good, timestamp: "garbage", run_id: "rev_bad2" })]);
    assert.deepEqual(r.routes.grok, { timestamp: good.timestamp, run_id: "rev_ok" }); assert.equal(r.runs, 1);
  });
  await test("shell_metacharacter_paths_are_quoted_for_the_windows_shell", () => {
    const dir = path.join(checkFixture, "meta&chars(1)"); fs.mkdirSync(dir, { recursive: true });
    const win = process.platform === "win32", probe = path.join(dir, win ? "probe.cmd" : "probe");
    fs.writeFileSync(probe, win ? "@echo probe 9.9.9\r\n" : "#!/bin/sh\necho probe 9.9.9\n"); fs.chmodSync(probe, 0o755);
    const r = captureExec(probe, ["--version"]);
    assert.equal(r.code, 0, `a launcher under a metacharacter path must run: ${r.stderr}`); assert.match(r.stdout, /probe 9\.9\.9/);
  });
  await test("windows_bare_command_is_never_resolved_from_the_current_directory", () => {
    // Gate-3 [63]: cmd.exe searches the working directory before PATH, so a launcher
    // planted in a reviewed project ran during the read-only --check-all.
    if (process.platform !== "win32") return;
    const dir = path.join(checkFixture, "planted-cwd"); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "mommgate3planted.cmd"), "@echo PLANTED 9.9.9\r\n");
    // A child with the protective variable removed models a plain user shell; the
    // host running this suite may already export it and hide the defect.
    const child = path.join(checkFixture, "planted-child.mjs"), env = { ...process.env };
    for (const key of Object.keys(env)) if (key.toLowerCase() === "nodefaultcurrentdirectoryinexepath") delete env[key];
    fs.writeFileSync(child, `import { captureExec } from ${JSON.stringify(new URL("./update.mjs", import.meta.url).href)};\nprocess.stdout.write(JSON.stringify(captureExec("mommgate3planted", ["--version"])));\n`);
    const p = spawnSync(process.execPath, [child], { cwd: dir, env, encoding: "utf8", windowsHide: true, timeout: 30_000 });
    assert.equal(p.status, 0, p.stderr); const r = JSON.parse(p.stdout);
    assert.doesNotMatch(r.stdout, /PLANTED/, "a same-named launcher in the working directory must not run"); assert.notEqual(r.code, 0);
  });
  await test("windows_git_is_never_resolved_from_the_working_directory", () => {
    // Gate-4 [1] class: a direct spawn of a bare name tries the working directory BEFORE
    // PATH unless the CALLING process carries NoDefaultCurrentDirectoryInExePath. The child
    // runs without it, like a plain user shell; the planted git.exe is a copy of node.exe.
    if (process.platform !== "win32") return;
    const dir = path.join(checkFixture, "planted-git"); fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(process.execPath, path.join(dir, "git.exe"));
    const child = path.join(checkFixture, "planted-git-child.mjs"), env = { ...process.env };
    for (const key of Object.keys(env)) if (key.toLowerCase() === "nodefaultcurrentdirectoryinexepath") delete env[key];
    // Gate-5 [61]: importing update.mjs sets the variable again (the inline launch guard), and that
    // alone keeps the working directory out of the search, so the resolver went untested. The child
    // removes it after the import and reports that it is gone: run() must pass on resolveTool alone.
    fs.writeFileSync(child, `import { run } from ${JSON.stringify(new URL("./update.mjs", import.meta.url).href)};\ndelete process.env.NoDefaultCurrentDirectoryInExePath;\nprocess.stdout.write(JSON.stringify({ guard: process.env.NoDefaultCurrentDirectoryInExePath ?? null, out: run("git", ["--version"], process.cwd()) }));\n`);
    const p = spawnSync(process.execPath, [child], { cwd: dir, env, encoding: "utf8", windowsHide: true, timeout: 30_000 });
    assert.equal(p.status, 0, p.stderr); const r = JSON.parse(p.stdout);
    assert.equal(r.guard, null, "the child must run without the launch guard, or the resolver is not what is being tested");
    assert.match(r.out, /^git version /, `the planted executable answered: ${r.out.trim()}`);
  });
  await test("windows_run_resolves_a_tool_on_the_path_given_to_the_child", () => {
    // Gate-5 [58]: run() resolved against the parent's PATH while spawnSync searched options.env,
    // so a tool present only on the child's PATH was refused as missing before it was started.
    if (process.platform !== "win32") return;
    const tools = path.join(checkFixture, "child-path-tools"), work = path.join(checkFixture, "child-path-work"); fs.mkdirSync(tools, { recursive: true }); fs.mkdirSync(work, { recursive: true });
    fs.copyFileSync(process.execPath, path.join(tools, "mommgate5probe.exe")); // harmless stand-in executable
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
    env.PATH = tools;
    assert.match(run("mommgate5probe", ["--version"], work, { env }), /^v\d+\./);
    assert.throws(() => run("mommgate5probe", ["--version"], work), e => e.code === "ENOENT", "absent from the parent PATH: still refused without the child environment");
    // The working-directory rule holds for the child's PATH as well.
    fs.copyFileSync(process.execPath, path.join(work, "mommgate5planted.exe"));
    assert.throws(() => run("mommgate5planted", ["--version"], work, { env: { ...env, PATH: work } }), e => e.code === "ENOENT");
  });
  await test("windows_installers_never_run_a_harness_launcher_planted_in_the_working_directory", () => {
    // Both installers probe `gemini --version` through cmd.exe, which looks in the working
    // directory first. Dry run with one explicit target: nothing is linked or recorded.
    if (process.platform !== "win32") return;
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.toLowerCase() === "nodefaultcurrentdirectoryinexepath") delete env[key];
    for (const [label, installer] of [["root", new URL("../../install.mjs", import.meta.url)], ["momm", new URL("./install.mjs", import.meta.url)]]) {
      const dir = path.join(checkFixture, `planted-installer-${label}`); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "gemini.cmd"), '@echo 9.9.9\r\n@echo ran> "%~dp0planted-marker.txt"\r\n');
      const p = spawnSync(process.execPath, [fileURLToPath(installer), "--target", "gemini", "--dry-run"], { cwd: dir, env, encoding: "utf8", windowsHide: true, timeout: 60_000 });
      assert.notEqual(p.status, null, `${label}: installer did not finish: ${p.error?.message}`);
      assert.equal(fs.existsSync(path.join(dir, "planted-marker.txt")), false, `${label} installer ran the gemini.cmd planted in its working directory`);
    }
  });
  await test("installer_keeps_its_link_report_when_the_readiness_probe_throws", () => {
    // Gate-4 [5]: readiness() reads process.cwd(), which throws ENOENT (uv_cwd) on POSIX when
    // the working directory was deleted under the process. The preload models exactly that.
    // Dry run into a disposable custom directory: nothing is linked or recorded.
    const dir = path.join(checkFixture, "readiness-throws"), parent = path.join(dir, "skills"); fs.mkdirSync(parent, { recursive: true });
    const pre = path.join(dir, "deleted-cwd.mjs"), runner = path.join(dir, "runner.mjs");
    fs.writeFileSync(pre, "globalThis.__deleteCwd = () => { process.cwd = () => { throw Object.assign(new Error('ENOENT: no such file or directory, uv_cwd'), { code: 'ENOENT', syscall: 'uv_cwd' }); }; };\n");
    for (const installer of [new URL("../../install.mjs", import.meta.url), new URL("./install.mjs", import.meta.url)]) {
      fs.writeFileSync(runner, `import ${JSON.stringify(pathToFileURL(pre).href)};\nprocess.argv.splice(2, 0, "--custom-dir", ${JSON.stringify(parent)}, "--dry-run");\nglobalThis.__deleteCwd();\nawait import(${JSON.stringify(installer.href)});\n`);
      const p = spawnSync(process.execPath, [runner], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
      assert.match(p.stdout, /"results"/, `${installer.pathname}: the link report was lost: ${p.stderr.slice(0, 200)}`);
      const out = JSON.parse(p.stdout);
      assert.equal(out.results[0].target, "custom"); assert.equal(out.update_readiness.status, "unavailable"); assert.match(out.update_readiness.error, /uv_cwd/);
    }
    assert.deepEqual(fs.readdirSync(parent), [], "dry run links nothing");
  });
  await test("windows_absolute_exe_path_with_percent_sequence_is_not_expanded_by_the_shell", () => {
    // Gate-3 [61]: %VAR% inside quotes is still expanded by cmd.exe, so an absolute
    // .exe (the only absolute form cliBinary returns on Windows) is started directly.
    if (process.platform !== "win32") return;
    const dir = path.join(checkFixture, "pct %OS% dir"); fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, "probe.exe"); fs.copyFileSync(process.execPath, probe); // harmless stand-in executable
    const r = captureExec(probe, ["--version"]);
    assert.equal(r.code, 0, `literal percent path must launch: ${r.stderr}`); assert.match(r.stdout, /^v\d+\./);
  });
  await test("prerelease_installed_version_is_kept_and_compares_below_its_stable", async () => {
    assert.equal(newer("1.2.3", "1.2.3-beta.1"), true); assert.equal(newer("1.2.3-beta.1", "1.2.3"), false); assert.equal(newer("1.2.3-beta.1", "1.2.3-beta.1"), false);
    assert.equal(newer("1.2.3-beta.2", "1.2.3-beta.1"), true); assert.equal(newer("1.2.3-beta.11", "1.2.3-beta.2"), true); assert.equal(newer("1.2.3-rc.1", "1.2.3-beta.11"), true);
    assert.equal(newer("1.2.3-beta.1.x", "1.2.3-beta.1"), true); assert.equal(newer("1.2.4-alpha", "1.2.3"), true); assert.equal(newer("1.1.0", "1.0.0"), true); assert.equal(newer("1.0.0", "1.1.0"), false);
    const report = await update(["--repo", installed, "--check-all", "--json"], checkDeps({ exec: only("claude", { code: 0, stdout: "2.1.270-beta.1 (Claude Code)\n", stderr: "" }), fetcher: fakeFetcher(), log() {} }));
    const claude = report.clis.find(c => c.cli === "claude");
    assert.equal(claude.installed, "2.1.270-beta.1"); assert.equal(claude.latest, "2.1.270"); assert.equal(claude.update_available, true);
  });
  await test("review_log_falls_back_from_cwd_to_repo_root_and_names_the_file_used", async () => {
    const rootLog = path.join(installed, ".ensemble_reviews", "review-log.jsonl");
    fs.mkdirSync(path.dirname(rootLog)); fs.writeFileSync(rootLog, JSON.stringify({ timestamp: "2026-09-05T00:00:00.000Z", run_id: "rev_root", reviewer_status: { codex: "success" } }) + "\n");
    try {
      const logs = [], fromRoot = await update(["--repo", installed, "--check-all", "--json"], checkDeps({ exec: fakeExec(), fetcher: fakeFetcher(), cwd: checkFixture, log: s => logs.push(s) }));
      const same = (a, b) => { try { return fs.realpathSync.native(a) === fs.realpathSync.native(b); } catch { return a === b; } };
      assert.equal(fromRoot.reviews.present, true, JSON.stringify(fromRoot.reviews));
      assert(same(fromRoot.reviews.file, rootLog), `file read=${fromRoot.reviews.file} expected=${rootLog} searched=${JSON.stringify(fromRoot.reviews.searched)}`);
      assert.equal(fromRoot.reviews.runs, 1, JSON.stringify(fromRoot.reviews));
      assert.deepEqual(fromRoot.clis.find(c => c.cli === "codex").last_successful_review, { timestamp: "2026-09-05T00:00:00.000Z", run_id: "rev_root" });
      const table = []; await update(["--repo", installed, "--check-all"], checkDeps({ exec: fakeExec(), fetcher: fakeFetcher(), cwd: checkFixture, log: s => table.push(s) }));
      const rootReal = (() => { try { return fs.realpathSync.native(rootLog); } catch { return rootLog; } })();
      assert(table.join("\n").includes(rootLog) || table.join("\n").includes(rootReal), `the table names the file actually read: expected ${rootLog} or ${rootReal}`);
      const fromCwd = await update(["--repo", installed, "--check-all", "--json"], checkDeps({ exec: fakeExec(), fetcher: fakeFetcher(), log() {} }));
      assert(same(fromCwd.reviews.file, path.join(project, ".ensemble_reviews", "review-log.jsonl")), `cwd wins when both exist: read=${fromCwd.reviews.file} searched=${JSON.stringify(fromCwd.reviews.searched)}`);
      assert.equal(fromCwd.reviews.runs, 3, JSON.stringify(fromCwd.reviews));
    } finally { fs.rmSync(path.join(installed, ".ensemble_reviews"), { recursive: true, force: true }); }
  });
  await test("failed_version_probe_sets_row_error", async () => {
    const timedOut = await update(["--repo", installed, "--check-all", "--json"], checkDeps({ exec: only("copilot", { code: -1, stdout: "", stderr: "", error: { code: "ETIMEDOUT", message: "spawnSync copilot ETIMEDOUT" } }), fetcher: fakeFetcher(), log() {} }));
    const copilot = timedOut.clis.find(c => c.cli === "copilot");
    assert.equal(copilot.installed, "unknown"); assert.match(copilot.error || "", /ETIMEDOUT/); assert.equal(copilot.update_available, null);
    const crashed = await update(["--repo", installed, "--check-all", "--json"], checkDeps({ exec: only("codex", { code: 3, stdout: "", stderr: "codex: config parse failure\n", error: null }), fetcher: fakeFetcher(), log() {} }));
    const codex = crashed.clis.find(c => c.cli === "codex");
    assert.equal(codex.installed, "unknown"); assert.match(codex.error || "", /exited 3/); assert.match(codex.error || "", /config parse failure/);
    const unreachable = await update(["--repo", installed, "--check-all", "--json"], checkDeps({ exec: only("codex", { code: 3, stdout: "", stderr: "boom", error: null }), fetcher: async () => ({ ok: false, status: 503, text: async () => "" }), log() {} }));
    assert.match(unreachable.clis.find(c => c.cli === "codex").error, /exited 3.*HTTP 503/s, "probe and registry failures are both kept");
  });
  await test("pending_recovery_uses_the_same_regular_file_check_as_rollback", async () => {
    const journal = path.join(stateDir(installed), "transaction.json");
    fs.mkdirSync(journal);
    try { await assert.rejects(update(["--repo", installed, "--check-all", "--json"], checkDeps({ exec: fakeExec(), fetcher: fakeFetcher(), log() {} })), /Unsafe local state file/); }
    finally { fs.rmdirSync(journal); }
  });
  if (failures) process.exitCode = 1;
  process.stdout.write(JSON.stringify({ passed: failures === 0, tests: results, note: "Positive transaction fixtures inject signature verification; the production unsigned rejection is tested separately. Live trusted-tag verification is a release gate." }, null, 2) + "\n");
} finally {
  if (path.dirname(fixture) === os.tmpdir() && path.basename(fixture).startsWith("momm-update-tests-")) fs.rmSync(fixture, { recursive: true, force: true });
}
