import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeOverlayEntry, effective, autoReviewers, renderMatrix, SUCCESS_EXPIRY_MS } from './capabilities.mjs';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-expiry-'));
try {
  const now = new Date('2026-09-01T00:00:00Z');
  const entry = writeOverlayEntry(home, { route: 'codex', direction: 'input', modality: 'image', level: 'verified', blocker: null, cli_version: '1.0.0' }, { now, machine: 'test' }).entry;
  assert.ok(entry.expires_at, 'successful probes need a finite expiry');
  const matrix = effective({ home, machine: 'test', installedVersions: { codex: '1.0.0' }, now: new Date('2026-10-01T00:00:00Z') });
  assert.equal(matrix.routes.codex.input.image.blocker, 'reprobe', 'stale success must not fall back to baseline yes');
  assert.equal(autoReviewers(matrix, ['image'], { pool: ['codex'] }).empty, true);
  const expiryDay = new Date(now.getTime() + SUCCESS_EXPIRY_MS).toISOString().slice(0, 10);
  assert.match(renderMatrix(matrix), new RegExp('expires.*' + expiryDay, 'i'), 'the rendered expiry must follow SUCCESS_EXPIRY_MS, not a date frozen in the test');
  assert.match(renderMatrix(matrix), /probes\.mjs codex --modalities/);
  const changed = effective({ home, machine: 'test', installedVersions: { codex: '2.0.0' }, now });
  assert.equal(changed.routes.codex.input.image.blocker, 'reprobe');
  // F09: prove the entry was usable when written, so the later `reprobe` is a real transition and
  // not a cell that was blocked all along.
  const atWrite = effective({ home, machine: 'test', installedVersions: { codex: '1.0.0' }, now });
  assert.equal(atWrite.routes.codex.input.image.blocker, null, 'the overlay must be usable at write time');
  assert.equal(atWrite.routes.codex.input.image.level, 'verified');
  // F15: a stale successful probe replaces the cell's blocker with `reprobe`. The cell stays blocked
  // either way, but the displaced baseline blocker is the more specific diagnosis and must survive.
  writeOverlayEntry(home, { route: 'antigravity', direction: 'output', modality: 'code_exec', level: 'verified', blocker: null, cli_version: '1.0.0' }, { now, machine: 'test' });
  const displaced = effective({ home, machine: 'test', installedVersions: { antigravity: '1.0.0', codex: '1.0.0' }, now: new Date('2026-10-01T00:00:00Z') }).routes.antigravity.output.code_exec;
  assert.equal(displaced.blocker, 'reprobe', 'a stale success still blocks routing');
  assert.match(displaced.reason, /allowlist/, 'the baseline blocker the stale entry displaced must still be named in the reason');
  console.log('PASS: finite expiry, stale and changed success fail closed; visible manual action; no subprocesses');
} finally { fs.rmSync(home, { recursive: true, force: true }); }
