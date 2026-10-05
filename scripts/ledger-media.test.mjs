// 1.17 E (owner, 29 September 2026): generated pictures appear in the private ledger beside the
// reviews, so the user can see what was made, by which route, from which prompt, with its hash.
// Only files the media report names, inside .ensemble_reviews/media/<run>/, whose bytes still match
// the recorded sha256, are shown; anything else is listed as a warning and never displayed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { privateTestFixture } from './private-test-fixture.mjs';
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: this suite decides where its fixtures' evidence lives

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const ledger = (cwd) => spawnSync(process.execPath, [path.join(root, 'momm/scripts/ledger.mjs')], { cwd, encoding: 'utf8', timeout: 30000, env: { ...process.env, NO_UPDATE_CHECK: '1' } });
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), jpg = Buffer.from('ffd8ffe000104a464946', 'hex');
const previousUmask = process.umask(0o077);

const dir = privateTestFixture('momm-ledger-media-');
try {
  const er = path.join(dir, '.ensemble_reviews');
  const run = 'media_20260929000000_abcdef12', out = path.join(er, 'media', run, 'step-1', 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, '01-good.png'), png);
  fs.writeFileSync(path.join(out, '02-changed.jpg'), jpg);
  fs.writeFileSync(path.join(dir, 'outside.png'), png);
  const file = (name, bytes, mime, recorded = sha(bytes)) => ({ path: `.ensemble_reviews/media/${run}/step-1/out/${name}`, sha256: recorded, bytes: bytes.length, mime, modality: 'image_gen' });
  const report = {
    schema: 'momm-media/1', run_id: run, at: '2026-09-29T00:00:00.000Z', prompt_sha256: 'p'.repeat(64), status: 'complete',
    steps: [{ step: 1, route: 'codex', files: [
      file('01-good.png', png, 'image/png'),
      file('02-changed.jpg', jpg, 'image/jpeg', 'f'.repeat(64)),
      { path: 'outside.png', sha256: sha(png), bytes: png.length, mime: 'image/png' },
      { path: `.ensemble_reviews/media/${run}/../../../outside.png`, sha256: sha(png), bytes: png.length, mime: 'image/png' },
    ] }],
  };
  fs.writeFileSync(path.join(er, 'media', run, 'report.json'), JSON.stringify(report));
  // 1.17 E: a media run that belongs to a guided generation shows its round, and after the reveal the
  // governor's critique summary per picture. A second run is in an unrevealed round: round only.
  const run2 = 'media_20260929000001_abcdef13', out2 = path.join(er, 'media', run2, 'step-1', 'out');
  fs.mkdirSync(out2, { recursive: true });
  const png2 = Buffer.concat([png, Buffer.from('2')]);
  fs.writeFileSync(path.join(out2, '01-next.png'), png2);
  fs.writeFileSync(path.join(er, 'media', run2, 'report.json'), JSON.stringify({ schema: 'momm-media/1', run_id: run2, status: 'complete', steps: [{ step: 1, route: 'grok', files: [{ path: `.ensemble_reviews/media/${run2}/step-1/out/01-next.png`, sha256: sha(png2), bytes: png2.length, mime: 'image/png' }] }] }));
  const genId = 'gen_20260929000000_0123abcd';
  fs.mkdirSync(path.join(er, 'generation', genId), { recursive: true });
  fs.writeFileSync(path.join(er, 'generation', genId, 'state.json'), JSON.stringify({
    schema: 'momm-generation/1', gen_id: genId,
    rounds: {
      1: { round: 1, entries: [{ maker: 'codex', run_id: run, pictures: [{ sha256: sha(png) }, { sha256: 'f'.repeat(64) }] }],
        reveal: { pictures: {
          B: { maker: 'codex', run_id: run, sha256: sha(png), critique: { met: 2, partly: 1, missed: 0, cant_tell: 1, letter_vs_spirit: 'Paint <b>on</b> the stone' } },
          C: { maker: 'codex', run_id: run, sha256: 'f'.repeat(64), critique: { met: 9, partly: 0, missed: 0, cant_tell: 0, letter_vs_spirit: 'SHOULD-NOT-SHOW' } },
        } } },
      2: { round: 2, entries: [{ maker: 'grok', run_id: run2, pictures: [{ sha256: sha(png2) }] }], reveal: null },
    },
  }));
  const result = ledger(dir);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(path.join(er, 'ledger.html'), 'utf8');
  assert.match(html, /Generated pictures/, 'the ledger has a generated-pictures section');
  assert.match(html, new RegExp(`<img[^>]+src="media/${run}/step-1/out/01-good\\.png"`), 'a verified picture is shown by its path relative to the ledger');
  assert.match(html, /codex/); assert.match(html, new RegExp(sha(png).slice(0, 12)));
  // Exactly the verified pictures are embedded, by relative path: an allow-list, not substring checks.
  const embedded = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(embedded.sort(), [`media/${run}/step-1/out/01-good.png`, `media/${run2}/step-1/out/01-next.png`].sort(), 'only the verified pictures are embedded');
  assert.doesNotMatch(html, /url\(/, 'no picture is embedded through CSS');
  // Each refused path is listed in its own item with its own reason (review rev_20260929211625_0b5ba54cb0e5).
  const refusedItems = Object.fromEntries([...html.matchAll(/<li>([^<]+) <em>not shown: ([^<]+)<\/em><\/li>/g)].map((m) => [m[1], m[2]]));
  assert.equal(refusedItems[`.ensemble_reviews/media/${run}/step-1/out/02-changed.jpg`], 'hash changed since it was recorded');
  assert.equal(refusedItems['outside.png'], "outside this run's folder");
  // traversal: the ../ path is refused on its own row, not hidden behind the plain outside.png row
  assert.equal(refusedItems[`.ensemble_reviews/media/${run}/../../../outside.png`], "outside this run's folder");
  const caption = (file) => (html.match(new RegExp(`src="media/[^"]*${file}"[^>]*><figcaption>([^<]*)</figcaption>`)) || [])[1] ?? '';
  assert.match(caption('01-good\\.png'), new RegExp(`guided generation ${genId} · round 1 · picture B · governor's critique: 2 met, 1 partly, 0 missed, 1 can't tell · letter vs spirit: Paint &lt;b&gt;on&lt;/b&gt; the stone`), 'a revealed picture shows its round and the critique summary, escaped');
  assert.match(caption('01-next\\.png'), new RegExp(`guided generation ${genId} · round 2 · not yet revealed$`), 'an unrevealed round shows the round only');
  assert.doesNotMatch(caption('01-next\\.png'), /critique/, 'no critique before the reveal');
  assert.doesNotMatch(html, /SHOULD-NOT-SHOW/, 'a critique of a picture that is not shown never appears');
} finally {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

// Review rev_20260929164940_85056e2a02ed (media-symlink-escape): a link inside a run folder that points
// outside it would pass the lexical check. It cannot reach the page: the ledger refuses an evidence
// tree that contains any link or junction (linked_entry) and writes nothing. This guards that reliance.
const linked = privateTestFixture('momm-ledger-media-link-');
try {
  const er = path.join(linked, '.ensemble_reviews'), run = 'media_20260929000000_link0001', out = path.join(er, 'media', run, 'step-1', 'out');
  fs.mkdirSync(out, { recursive: true });
  const elsewhere = path.join(linked, 'elsewhere');
  fs.mkdirSync(elsewhere); fs.writeFileSync(path.join(elsewhere, 'secret.png'), png);
  fs.symlinkSync(elsewhere, path.join(out, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(path.join(er, 'media', run, 'report.json'), JSON.stringify({ schema: 'momm-media/1', run_id: run, at: '2026-09-29T00:00:00.000Z', prompt_sha256: 'p'.repeat(64), status: 'complete', steps: [{ step: 1, route: 'codex', files: [{ path: `.ensemble_reviews/media/${run}/step-1/out/linked/secret.png`, sha256: sha(png), bytes: png.length, mime: 'image/png' }] }] }));
  const result = ledger(linked);
  assert.ifError(result.error);
  assert.notEqual(result.status, 0, 'an evidence tree with a link is refused');
  // Windows words it "link or junction"; POSIX reports linked_or_special_entry.
  assert.match(result.stderr, /linked_entry|linked_or_special_entry|link or junction/);
  assert.equal(fs.existsSync(path.join(er, 'ledger.html')), false, 'and no page is written');
} finally {
  fs.rmSync(linked, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
process.umask(previousUmask);
console.log(JSON.stringify({ passed: true, test: 'ledger shows verified generated pictures only; a linked evidence tree is refused' }));
