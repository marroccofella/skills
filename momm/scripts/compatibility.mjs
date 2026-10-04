// MOMM 1.17.1 R1 — a remembered CLI/model compatibility failure, per machine.
//
// The case behind it (plan-1.17.1, R1): the Codex route failed every review with "CLI/model
// compatibility error", because the Codex configuration named a model that Codex CLI 0.157.1 did not
// support, and the user found out only after spending a review. The Codex help capture documents no
// command that says, without a model call, whether the CLI supports a model
// (references/cli/help/codex.txt), so MOMM remembers the failure it saw instead: route, CLI version, configured model and time, in
//   ~/.momm/compatibility-<machine>.json
// beside the capability overlay and under the same rules (capabilities.mjs): folder 0700, file 0600,
// written by rename (here from a temporary file created with O_EXCL under a random name), serialised by
// `<file>.lock` (O_EXCL, owner pid) that is never stolen.
//
// The record is shown at the next --preflight and dispatch while the same CLI version and model are
// in place. It stops applying when either changes and is removed when the route next succeeds. It is
// a notice: nothing is routed or refused on it. Nothing here starts a process, makes a request or
// writes outside ~/.momm; the Codex configuration is read through route-isolation.mjs, read-only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { codexIsolationArgs } from "./route-isolation.mjs";
import { UPDATE_COMMANDS } from "./update-clock.mjs";

export const COMPATIBILITY_SCHEMA = "momm-compatibility/1";
export const COMPATIBILITY_LOCK_TIMEOUT_MS = 5_000;
// How classifyFailure (multi-review.mjs) opens both details of this class; compatibility.test.mjs
// runs the classifier and pins the two together.
const COMPATIBILITY_DETAIL = /^CLI\/model compatibility error:/;
const ROUTE = /^[a-z][a-z0-9-]{0,31}$/;
const CLI_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]{1,40})?$/;
// The rule route-isolation.mjs passes a model by; anything else in a record is not shown.
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// Routes whose configured model MOMM reads (route-isolation.mjs); the others bind to the CLI version alone.
const READS_MODEL = new Set(["codex"]);
const NOT_RUN = new Set(["self_excluded", "not_dispatched"]);
const TRANSIENT = new Set(["EEXIST", "EPERM", "EBUSY", "EACCES"]);
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const NOT_OURS = "the compatibility record in the .momm folder of your home is not a regular file MOMM can read, so it was left alone.";
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// The capability overlay's machine identity (capabilities.mjs machineId), copied so a plain review
// does not load the registry; compatibility.test.mjs pins the two to the same answer.
export function machineId({ hostname = os.hostname(), platform = process.platform, homedir = os.homedir() } = {}) {
  return createHash("sha256").update(`${hostname}\n${platform}\n${homedir}`).digest("hex").slice(0, 16);
}
export function compatibilityPath(home = os.homedir(), machine = machineId()) {
  return path.join(home, ".momm", `compatibility-${machine}.json`);
}

export function isCompatibilityFailure(result) {
  return result?.status === "error" && COMPATIBILITY_DETAIL.test(String(result.detail ?? ""));
}

// The model a route is configured to use, where MOMM already reads it: Codex only, through the same
// read-only reader the review uses. null means "none set, or not a route MOMM reads a model for".
export function configuredModel(route, { home = os.homedir(), env = process.env, files = fs } = {}) {
  return READS_MODEL.has(route) ? codexIsolationArgs({ home, env, fs: files }).model : null;
}

// The model one run was given, read by the rule a record's model is held to: undefined when the run
// carries no settings, null when none was set, the value is not one a record can hold, or the route is
// not one MOMM reads a model for (its record binds to the CLI version alone, as the next check expects).
const givenModel = (route, run) => {
  if (!isPlainObject(run?.route_settings)) return undefined;
  const given = run.route_settings.model;
  return READS_MODEL.has(route) && typeof given === "string" && MODEL.test(given) ? given : null;
};

const validEntry = (entry, machine) => isPlainObject(entry) && entry.machine_id === machine
  && typeof entry.route === "string" && ROUTE.test(entry.route)
  && typeof entry.cli_version === "string" && CLI_VERSION.test(entry.cli_version)
  && (entry.model === null || (typeof entry.model === "string" && MODEL.test(entry.model)))
  && typeof entry.at === "string" && Number.isFinite(Date.parse(entry.at));

// Never throws: a record that is missing, damaged, hand-edited or behind a link reads as empty, so
// a check that only shows a notice can never fail on it. `problem` says why for the writer.
export function readCompatibility(home = os.homedir(), { machine = machineId() } = {}) {
  const file = compatibilityPath(home, machine);
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { return { path: file, entries: [], problem: error?.code === "ENOENT" ? null : "unreadable" }; }
  if (!stat.isFile()) return { path: file, entries: [], problem: "not_a_file" };
  try {
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isPlainObject(doc) || doc.schema !== COMPATIBILITY_SCHEMA || !Array.isArray(doc.entries)) return { path: file, entries: [], problem: "damaged" };
    return { path: file, entries: doc.entries.filter((entry) => validEntry(entry, machine)).map(({ route, cli_version, model, at, machine_id }) => ({ route, cli_version, model, at, machine_id })), problem: null };
  } catch { return { path: file, entries: [], problem: "damaged" }; }
}

export function compatibilityNotice(entry) {
  const update = UPDATE_COMMANDS[entry.route] ?? null;
  return `${entry.route}: ${entry.model
    ? `CLI ${entry.cli_version} and the configured model ${entry.model} did not work together on this machine (CLI/model compatibility error, ${entry.at}). Neither has changed.`
    : `CLI ${entry.cli_version} ended a review on this machine with a CLI/model compatibility error (${entry.at}). The CLI version has not changed.`} `
    + `${update ? `Update the CLI before you spend a review: ${update}` : "Update the CLI with the provider's official command before you spend a review"}. `
    + `MOMM changes no CLI setting. This notice goes when the CLI version${READS_MODEL.has(entry.route) ? " or the configured model" : ""} changes, or the route succeeds.`;
}

// Said once, in the run that first sees the failure: the record exists, where it shows, how it goes.
export function rememberedNotice(route) {
  const update = UPDATE_COMMANDS[route] ?? null;
  return `${route}: MOMM remembered this CLI/model compatibility error on this machine. --preflight and the next review say so before any allowance is spent, until the CLI version${READS_MODEL.has(route) ? " or the configured model" : ""} changes or the route succeeds. `
    + `${update ? `Update the CLI: ${update}` : "Update the CLI with the provider's official command"}.`;
}

// The record for `route` when the same CLI version and configured model are still in place; null
// otherwise, and null when the installed version could not be read (that confirms nothing).
// Never throws: preflight must not fail on a notice.
export function knownIncompatibility({ route, cliVersion, model, home, env = process.env, machine } = {}) {
  try {
    if (typeof cliVersion !== "string" || !cliVersion) return null;
    home ??= os.homedir(); machine ??= machineId();
    const entry = readCompatibility(home, { machine }).entries.find((candidate) => candidate.route === route);
    if (!entry || entry.cli_version !== cliVersion) return null;
    const current = model === undefined ? configuredModel(route, { home, env }) : model;
    if (entry.model !== (current ?? null)) return null;
    return { route: entry.route, cli_version: entry.cli_version, model: entry.model, at: entry.at, update_command: UPDATE_COMMANDS[route] ?? null, notice: compatibilityNotice(entry) };
  } catch { return null; }
}

// The temporary file has a name nobody can prepare and is created exclusively ("wx"): an entry already
// at that name, a link included, is never written through, emptied or moved into the record's place.
// The write is refused instead (the message names no path), and only a file made here is removed.
function writePrivate(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let fd;
  try { fd = fs.openSync(temporary, "wx", 0o600); } catch (error) { throw new Error(`a temporary file for the compatibility record could not be created in the .momm folder of your home (${error?.code ?? "error"}), so the record was left as it was.`); }
  try {
    try { fs.writeFileSync(fd, text, "utf8"); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  } catch (error) { try { fs.unlinkSync(temporary); } catch { /* moved into place, or already gone */ } throw error; }
}
// The overlay's lock discipline: the lock holds the owner's pid and is never stolen, because a PID
// check and an unlink are not atomic. The message names no path; the caller's report may be shared.
function withLock(file, timeoutMs, fn) {
  const lock = `${file}.lock`, deadline = Date.now() + timeoutMs;
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  for (;;) {
    try { fs.writeFileSync(lock, `${process.pid}\n`, { flag: "wx", mode: 0o600 }); break; } catch (error) {
      if (!TRANSIENT.has(error?.code)) throw error;
      if (Date.now() >= deadline) throw new Error(`the compatibility record's lock (${path.basename(lock)} in the .momm folder of your home) is held. Stop every MOMM run and confirm none remains before you remove only that lock, then retry. PID or age alone does not prove it is safe.${error?.code && error.code !== "EEXIST" ? ` The lock could not be created (${error.code}); if no lock file exists, check that the folder is writable.` : ""}`);
      sleepMs(20);
    }
  }
  try { return fn(); } finally { try { fs.unlinkSync(lock); } catch { /* already gone */ } }
}

// After dispatch: settle each route's record from what it just returned. `results` are the route
// results (every piece of a split run, and covers), `versions` the CLI versions preflight read.
//   a success                       -> the record is removed
//   a compatibility failure         -> recorded with the version and the model the route was given
//   any other outcome               -> kept while version and model stand, removed once either changed
// A success and a compatibility failure in one run: the success shows the pair works and the record
// goes, unless the success is known to have been given another model than the failure (the
// configuration changed between two pieces). That failure stands and is recorded for its own model.
// An unread version neither records nor removes. Never throws: a review does not fail on its memory.
export function settleCompatibility({ results = [], versions = {}, governor = null, home, machine, now = new Date(), lockTimeoutMs = COMPATIBILITY_LOCK_TIMEOUT_MS } = {}) {
  const outcome = { recorded: [], cleared: [], error: null };
  try {
    home ??= os.homedir(); machine ??= machineId();
    const byRoute = new Map();
    for (const result of results) {
      if (!result || typeof result.agent !== "string" || result.agent === governor || NOT_RUN.has(result.status) || !ROUTE.test(result.agent)) continue;
      byRoute.set(result.agent, [...(byRoute.get(result.agent) ?? []), result]);
    }
    // What the runs say about each route's entry among `entries`: an entry to record, or null to remove one.
    const planFor = (entries) => {
      const plan = [];
      for (const [route, runs] of byRoute) {
        const existing = entries.find((entry) => entry.route === route) ?? null;
        const version = typeof versions?.[route] === "string" && CLI_VERSION.test(versions[route]) ? versions[route] : null;
        const succeeded = runs.filter((run) => run.status === "success");
        const answers = (success, failed) => { const one = givenModel(route, success), other = givenModel(route, failed); return one === undefined || other === undefined || one === other; };
        const failure = runs.find((run) => isCompatibilityFailure(run) && !succeeded.some((success) => answers(success, run)));
        if (failure) {
          if (version) plan.push({ route, entry: { route, cli_version: version, model: givenModel(route, failure) ?? null, at: new Date(now).toISOString(), machine_id: machine } });
          continue;
        }
        if (succeeded.length) { if (existing) plan.push({ route, entry: null }); continue; }
        if (!existing || !version) continue;
        // Every run's model, in any order: the entry is kept while any run was given the model it names.
        const given = runs.map((run) => givenModel(route, run)).filter((model) => model !== undefined);
        if (existing.cli_version !== version || (given.length && !given.includes(existing.model))) plan.push({ route, entry: null });
      }
      return plan;
    };
    const before = readCompatibility(home, { machine });
    if (!planFor(before.entries).length) return outcome;
    // A link or a folder in the record's place is someone else's: never followed, never replaced.
    if (before.problem === "not_a_file" || before.problem === "unreadable") throw new Error(NOT_OURS);
    withLock(before.path, lockTimeoutMs, () => {
      // Read again under the lock and decide again from that reading: another run may have changed the
      // record since the first one, and a removal planned from the older entry would erase its newer one.
      const current = readCompatibility(home, { machine });
      if (current.problem === "not_a_file" || current.problem === "unreadable") throw new Error(NOT_OURS);
      const plan = planFor(current.entries);
      if (!plan.length) return;
      let entries = current.entries;
      for (const { route, entry } of plan) {
        const had = entries.some((candidate) => candidate.route === route);
        entries = entries.filter((candidate) => candidate.route !== route);
        if (entry) { entries.push(entry); outcome.recorded.push(route); } else if (had) outcome.cleared.push(route);
      }
      writePrivate(current.path, `${JSON.stringify({ schema: COMPATIBILITY_SCHEMA, machine_id: machine, entries }, null, 2)}\n`);
    });
  } catch (error) {
    outcome.recorded = []; outcome.cleared = [];
    // No home path in what may reach a shared report.
    const said = String(error?.message ?? error);
    outcome.error = (typeof home === "string" && home ? said.replaceAll(home, "<home>") : said).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300);
  }
  return outcome;
}
