// Where a project's private MOMM evidence lives (1.17 A7, owner decision D1). Zero dependencies.
//
// Default, unchanged: <project>/.ensemble_reviews, spelled exactly as before.
// Opt-in: MOMM_EVIDENCE_HOME (or multi-review.mjs --evidence-home <dir>, which sets it for the
// process) places the evidence at <home>/<first 32 hex characters of sha256(project real path)>, so
// two projects with the same folder name never share a ledger. The resolved folder must lie outside
// the project by both its literal and its real spelling, compared with the project in both of its
// spellings; otherwise it is refused before anything is read or sent. The folder is then created and
// verified private by evidence-permissions.mjs exactly as the in-project folder is.
//
// Evidence references keep their logical spelling (".ensemble_reviews/reports/<run>.json") wherever
// the folder lives, so sealed reports, run logs, checks and receipts read the same in both modes;
// evidenceFile() maps a logical reference onto the folder actually in use.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const EVIDENCE_FOLDER = '.ensemble_reviews';
export const EVIDENCE_HOME_ENV = 'MOMM_EVIDENCE_HOME';
export const PROJECT_MARKER = 'project.json';
export const MARKER_SCHEMA = 'momm-evidence-home/1';

// Every refusal is one plain sentence a command can print as it is (1.17.1 R7): what was refused and
// why, then what to do instead. reason names the case for callers and tests.
const fail = (message, reason) => { const error = new Error(message); error.code = 'MOMM_EVIDENCE_LOCATION'; error.reason = reason; return error; };
const REMEDY = `Choose a private folder outside the project, for example one under your user profile (--evidence-home <dir> or ${EVIDENCE_HOME_ENV}=<dir>), or leave the setting out to keep the evidence in the project's ${EVIDENCE_FOLDER}. Nothing was read or sent.`;
// The printable line of a refused evidence location or folder, or null for any other error. A command
// prints it and exits 1; it never lets the refusal escape as a stack trace, and rethrows the rest.
export const evidenceRefusal = (error) => ((error?.code === 'MOMM_EVIDENCE_LOCATION' || error?.code === 'MOMM_EVIDENCE_PERMISSIONS') && typeof error.message === 'string' ? error.message : null);
// Windows: the native call returns the canonical spelling (case, 8.3 names), so a project reached as
// d:\app or D:\App keeps one folder. POSIX: the ordinary real path.
const realOf = (p, win) => String(win ? fs.realpathSync.native(p) : fs.realpathSync(p));
// The real location of a path that may not exist yet: the real path of its deepest existing
// ancestor with the rest appended. An entry that exists but cannot be resolved (a dangling link)
// has no trustworthy location, and null refuses it.
function realLocation(p, win) {
  const tail = [];
  let cursor = p;
  for (;;) {
    try { return path.join(realOf(cursor, win), ...tail); }
    catch {
      try { fs.lstatSync(cursor); return null; } catch { /* absent: resolve its parent */ }
      const parent = path.dirname(cursor);
      if (parent === cursor) return null;
      tail.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}
const within = (base, candidate, win) => {
  const key = (q) => (win ? q.toLowerCase() : q);
  const rel = path.relative(key(base), key(candidate));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
};

export const projectKey = (projectRealPath) => createHash('sha256').update(String(projectRealPath)).digest('hex').slice(0, 32);

// { dir, home, project }: home and project are null in the default mode.
export function evidenceLocation({ cwd = process.cwd(), env = process.env, home } = {}) {
  const project = path.resolve(cwd);
  const chosen = home ?? env?.[EVIDENCE_HOME_ENV];
  if (chosen === undefined || chosen === null || chosen === '') return { dir: path.join(project, EVIDENCE_FOLDER), home: null, project: null };
  const win = process.platform === 'win32';
  if (typeof chosen !== 'string' || !path.isAbsolute(chosen)) throw fail(`${EVIDENCE_HOME_ENV} must be an absolute path (got ${JSON.stringify(String(chosen)).slice(0, 200)}). ${REMEDY}`, 'not_absolute');
  let projectReal;
  try { projectReal = realOf(project, win); }
  catch { throw fail(`The project path ${project} could not be resolved, so its evidence home cannot be named. Run the command from the project's folder. Nothing was read or sent.`, 'project_unresolvable'); }
  const base = path.resolve(chosen);
  const dir = path.join(base, projectKey(projectReal));
  const dirReal = realLocation(dir, win);
  if (!dirReal) throw fail(`The evidence home ${dir} could not be resolved: a link on that path leads nowhere, or the folder cannot be reached. ${REMEDY}`, 'unresolvable');
  if ([project, projectReal].some((p) => within(p, dir, win) || within(p, dirReal, win))) {
    throw fail(`The evidence home must lie outside the project: ${dir}${dirReal !== dir ? ` (real path ${dirReal})` : ''} is inside the project ${project}${projectReal !== project ? ` (real path ${projectReal})` : ''}. ${REMEDY}`, 'inside_project');
  }
  return { dir, home: base, project: projectReal };
}
export const evidenceDir = (options) => evidenceLocation(options).dir;

// A logical reference: '.ensemble_reviews/...' belongs to the evidence folder, anything else to the
// project. Returns the base the reference is walked from and the parts to walk, so callers can keep
// refusing links on every step exactly as they did from the project root.
export function evidenceReference(relative, { root, dir }) {
  const project = path.resolve(root), parts = String(relative).split('/');
  if (parts[0] !== EVIDENCE_FOLDER || path.resolve(dir) === path.join(project, EVIDENCE_FOLDER)) return { base: project, parts };
  return { base: path.resolve(dir), parts: parts.slice(1) };
}
export function evidenceFile(relative, options) {
  const { base, parts } = evidenceReference(relative, options);
  return path.join(base, ...parts);
}

// project.json in an evidence-home folder records which project it belongs to (owner-only, written
// once). A folder that names another project is refused rather than shared.
export function recordEvidenceProject(location) {
  if (!location?.home) return null;
  const file = path.join(location.dir, PROJECT_MARKER);
  const body = `${JSON.stringify({ schema: MARKER_SCHEMA, project: location.project, key: path.basename(location.dir) }, null, 2)}\n`;
  try { fs.writeFileSync(file, body, { flag: 'wx', mode: 0o600 }); return { path: file, created: true }; }
  catch (error) { if (error?.code !== 'EEXIST') throw fail(`The evidence home marker ${file} could not be written (${error?.code ?? 'error'}). ${REMEDY}`, 'marker_unwritable'); }
  const recorded = readEvidenceProject(location.dir);
  if (recorded !== location.project) throw fail(`The evidence folder ${location.dir} belongs to ${recorded === null ? 'an unreadable or foreign marker' : `another project (${recorded})`}, not ${location.project}. MOMM never shares or clears it: choose another evidence home (--evidence-home <dir> or ${EVIDENCE_HOME_ENV}=<dir>). Nothing was read or sent.`, 'foreign_marker');
  return { path: file, created: false };
}
export function readEvidenceProject(dir) {
  try {
    const file = path.join(dir, PROJECT_MARKER), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) return null;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value?.schema === MARKER_SCHEMA && typeof value.project === 'string' ? value.project : null;
  } catch { return null; }
}

// multi-review.mjs --evidence-home <dir> | --evidence-home=<dir>: removed from argv and applied to
// env (so every module and child in this run follows it). Stops at a bare "--".
export function takeEvidenceHomeOption(argv, env = process.env) {
  let seen = false;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') break;
    let value;
    if (arg === '--evidence-home') {
      value = argv[i + 1];
      // Any option-shaped value (-v, --json) is the next flag, not a directory (gate-3 review of 1.17.0).
      if (typeof value !== 'string' || value === '' || value.startsWith('-')) throw fail('--evidence-home needs a directory: --evidence-home <dir>', 'usage');
      argv.splice(i, 2);
    } else if (typeof arg === 'string' && arg.startsWith('--evidence-home=')) {
      value = arg.slice('--evidence-home='.length);
      if (!value) throw fail('--evidence-home needs a directory: --evidence-home <dir>', 'usage');
      argv.splice(i, 1);
    } else continue;
    if (seen) throw fail('--evidence-home was given more than once', 'usage');
    seen = true;
    env[EVIDENCE_HOME_ENV] = path.resolve(value);
    i -= 1;
  }
  return seen;
}
