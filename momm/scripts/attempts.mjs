// Additive attempt evidence. Never replaces an earlier attempt or interprets peer instructions.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { requirePrivateEvidence } from './evidence-permissions.mjs';
export const OUTCOMES = Object.freeze(['succeeded', 'timeout', 'quota', 'authentication_required', 'ineligible_tier', 'invalid_output', 'empty', 'cancelled', 'provider_unavailable', 'failed', 'not_dispatched']);
export function outcomeFor(result) {
  const s = result.status;
  if (s === 'success') return 'succeeded';
  if (['timeout', 'quota', 'authentication_required', 'ineligible_tier', 'cancelled', 'provider_unavailable', 'empty'].includes(s)) return s;
  if (s === 'invalid_output') return /(?:^empty(?:\b|_)|required JSON schema — empty stdout)/i.test(result.detail ?? '') ? 'empty' : 'invalid_output';
  if (['self_excluded', 'disabled', 'disabled_no_oauth', 'missing', 'unsupported', 'not_dispatched'].includes(s)) return 'not_dispatched';
  if (s === 'error') return 'failed';
  throw new Error(`Unclassified reviewer status: ${String(s)}`);
}
const digest = value => createHash('sha256').update(value).digest('hex');
export function startAttempt(root, metadata) {
  const record = {...metadata,schema:'momm-attempt-start/1',attempt_id:randomUUID(),event:'started'};
  return persistAttempt(root, record);
}
export function attemptRecord(result, { runId, piece = 'whole', inputHash, pieceHash, ordinal, durationMs, startedAt, attemptId = randomUUID() }) {
  const reported = result.usage?.reported ?? null;
  return { schema: 'momm-attempt/1', run_id: runId, attempt_id: attemptId, piece, input_sha256: inputHash, piece_sha256: pieceHash,
    route: result.agent, ordinal, started_at: startedAt, finished_at: new Date().toISOString(), duration_ms: durationMs,
    status: result.status, outcome: outcomeFor(result), usage: result.usage ?? null,
    accounting: { tokens: reported && [reported.total_tokens, reported.input_tokens, reported.output_tokens].some(Number.isFinite) ? 'reported' : 'unavailable', cost: Number.isFinite(reported?.cost_usd) ? 'reported' : 'unavailable' } };
}
export function persistAttempt(root, record) {
  const evidence = path.join(root, '.ensemble_reviews'); requirePrivateEvidence(evidence);
  if (!/^rev_[A-Za-z0-9_]+$/.test(record.run_id) || typeof record.attempt_id !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(record.attempt_id)) throw new Error('Unsafe attempt identity');
  const dir = path.join(evidence, 'attempts');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe attempt directory');
  const relative = `.ensemble_reviews/attempts/${record.run_id}-${record.attempt_id}${record.event==='started'?'.started':''}.json`;
  const bytes = JSON.stringify(record, null, 2) + '\n';
  fs.writeFileSync(path.join(root, relative), bytes, { flag: 'wx', mode: 0o600 });
  return { path: relative, sha256: digest(bytes), attempt_id: record.attempt_id };
}
export function attemptTotals(attempts) {
  const groups = new Map();
  for (const a of attempts) { if (!groups.has(a.route)) groups.set(a.route, []); groups.get(a.route).push(a); }
  return [...groups].map(([route, rows]) => {
    const costs = rows.map(r => r.usage?.reported?.cost_usd).filter(Number.isFinite);
    return { route, attempts: rows.length, duration_ms: rows.reduce((n, r) => n + (Number.isFinite(r.duration_ms) ? r.duration_ms : 0), 0), cost_usd_reported: costs.length ? costs.reduce((a, b) => a + b, 0) : null, cost_coverage: `${costs.length} of ${rows.length}`, complete_cost: costs.length === rows.length };
  });
}
