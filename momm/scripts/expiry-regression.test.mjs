import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeOverlayEntry, effective, autoReviewers, renderMatrix } from './capabilities.mjs';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'momm-expiry-'));
try {
  const now = new Date('2026-09-01T00:00:00Z');
  const entry = writeOverlayEntry(home, { route: 'codex', direction: 'input', modality: 'image', level: 'verified', blocker: null, cli_version: '1.0.0' }, { now, machine: 'test' }).entry;
  assert.ok(entry.expires_at, 'successful probes need a finite expiry');
  const matrix = effective({ home, machine: 'test', installedVersions: { codex: '1.0.0' }, now: new Date('2026-10-01T00:00:00Z') });
  assert.equal(matrix.routes.codex.input.image.blocker, 'reprobe', 'stale success must not fall back to baseline yes');
  assert.equal(autoReviewers(matrix, ['image'], { pool: ['codex'] }).empty, true);
  assert.match(renderMatrix(matrix), /expires.*2026-09-08/i);
  assert.match(renderMatrix(matrix), /probes\.mjs codex --modalities/);
  const changed = effective({ home, machine: 'test', installedVersions: { codex: '2.0.0' }, now });
  assert.equal(changed.routes.codex.input.image.blocker, 'reprobe');
  console.log('PASS: finite expiry, stale and changed success fail closed; visible manual action; no subprocesses');
} finally { fs.rmSync(home, { recursive: true, force: true }); }
