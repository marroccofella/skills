#!/usr/bin/env node
// Real temporary Git repositories; only the trust service is stubbed for
// successful transaction tests. Production unsigned rejection is also tested.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { update, parse, git, run, treeHash, readLock, recordInstall, stateDir, dailyCheck, updateCheckDisabled, hash, verifySignature, signingEnv, provenance } from "./update.mjs";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "momm-update-tests-"));
const remote = path.join(fixture, "remote"), installed = path.join(fixture, "installed");
const results = {};
async function test(name, fn) { await fn(); results[name] = true; }
function write(root, file, text) { const p = path.join(root, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
function commit(root, message) { git(root, "add", "."); git(root, "-c", "user.name=MOMM test", "-c", "user.email=momm-test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", message); return git(root, "rev-parse", "HEAD"); }
const log = () => {};
try {
  fs.mkdirSync(remote);
  git(remote, "init");
  for (const file of ["momm/scripts/install.mjs", "momm/scripts/update.mjs", "install.mjs"]) write(remote, file, fs.readFileSync(path.join(source, file)));
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
  await test("dry_run_shows_policy_without_installed_ref_or_lock_changes", async () => {
    const before = fs.readFileSync(lockPath, "utf8"), refs = git(installed, "show-ref"), logs = [];
    await update(["--repo", installed, "--dry-run"], { ...deps, log: s => logs.push(s) });
    assert(logs.some(s => s.includes("Explicit new protocol"))); assert(logs.some(s => s.includes("Network:")));
    assert.equal(fs.readFileSync(lockPath, "utf8"), before); assert.equal(git(installed, "show-ref"), refs); assert.equal(git(installed, "rev-parse", "HEAD"), first);
  });
  await test("unsigned_tag_fails_production_verifier", async () => {
    await assert.rejects(update(["--repo", installed, "--apply", "--yes", "--accept-protocol"], { ...deps, verifySignature }), /signature not verified/);
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
  await test("pinned_channel_requires_explicit_version", async () => {
    await command(["--channel", "pinned"]);
    await assert.rejects(command(["--dry-run"]), /Pinned channel/);
    await command(["--channel", "stable"]);
  });
  await test("ignore_rule_change_cannot_strand_existing_private_files", async () => {
    write(installed, "user-cache/private.txt", "user-owned ignored bytes");
    await assert.rejects(command(["--apply", "--yes", "--accept-protocol"]), /Ignore rules change/);
    assert.equal(git(installed, "rev-parse", "HEAD"), first);
    assert.equal(fs.readFileSync(path.join(installed, "user-cache/private.txt"), "utf8"), "user-owned ignored bytes");
    assert.equal(fs.existsSync(path.join(stateDir(installed), "transaction.json")), false);
    fs.unlinkSync(path.join(installed, "user-cache/private.txt")); fs.rmdirSync(path.join(installed, "user-cache"));
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
    run(process.execPath, [path.join(stateDir(installed), "update.mjs"), "--rollback", "--yes"], installed);
    assert.equal(git(installed, "rev-parse", "HEAD"), first); assert.equal(readLock(installed).previous, null);
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
    for (const file of ["momm/SKILL.md", "momm/scripts/install.mjs", "momm/scripts/update.mjs"]) write(archive, file, fs.readFileSync(path.join(installed, file)));
    const output = JSON.parse(run(process.execPath, ["momm/scripts/install.mjs", "--custom-dir", destination], archive));
    assert.equal(output.installation.updater_available, false);
    assert.equal(fs.realpathSync(path.join(destination, "momm")), fs.realpathSync(path.join(archive, "momm")));
  });
  process.stdout.write(JSON.stringify({ passed: true, tests: results, note: "Positive transaction fixtures inject signature verification; the production unsigned rejection is tested separately. Live trusted-tag verification is a release gate." }, null, 2) + "\n");
} finally {
  if (path.dirname(fixture) === os.tmpdir() && path.basename(fixture).startsWith("momm-update-tests-")) fs.rmSync(fixture, { recursive: true, force: true });
}
