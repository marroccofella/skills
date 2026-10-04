import assert from 'node:assert/strict';
import fs from 'node:fs';
import { improvementBody } from './momm-site-community.mjs';
import { releasePages } from './momm-release-pages.mjs';
import { releaseStatus, releaseStatusHtml, releaseStatusMarkdown, readmeStatusBlock } from './momm-site-home.mjs';
import { fileURLToPath } from 'node:url';
delete process.env.MOMM_EVIDENCE_HOME; // test isolation: this suite decides where its fixtures' evidence lives

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const failures = [];
function check(label, run) {
  try { run(); } catch (error) { failures.push(label + ': ' + error.message); }
}
check('released improvement copy', () => {
  const html = improvementBody();
  assert(html.includes('releases/1.17.0.html'));
  assert(!html.includes('1.17:</strong> candidate ideas'));
  assert(html.includes('not promised features'));
});
check('complete CI matrix', () => {
  const html = read('docs/momm/reference.html');
  assert(html.includes('Node 18, 20, 22 and 24'));
  assert(html.includes('24.15.0') && html.includes('24.19.0'));
  const workflow = read('.github/workflows/self-test.yml');
  assert(workflow.includes('node-version: [18.x, 20.x, 22.x, 24.x]'));
  assert(workflow.includes("node-version: '24.15.0'") && workflow.includes("node-version: '24.19.0'"));
});
check('historical architecture scope', () => {
  const html = read('docs/momm/technical.html');
  assert(html.includes('Architecture baseline: released MOMM 1.15.1'));
  assert(html.includes('does not describe later 1.16 or 1.17 features'));
});
check('safe front doors', () => {
  for (const name of ['docs/index.html', 'README.md']) {
    const text = read(name);
    const signed = text.indexOf('Install MOMM for me by following https://marroccofella.github.io/skills/momm/install');
    const development = text.indexOf('Development checkout — unsigned');
    const clone = text.indexOf('git clone https://github.com/marroccofella/skills');
    assert(signed >= 0, name + ': missing signed-install prompt');
    assert(development >= 0, name + ': missing development heading');
    assert(clone >= 0, name + ': missing clone command');
    assert(development > signed, name + ': development route must follow signed-install guidance');
    assert(clone > development, name + ': clone command must be under the development heading');
    const section = text.slice(development).split(name.endsWith('.md') ? /\n## / : /<\/div>/)[0];
    assert(section.includes('git clone https://github.com/marroccofella/skills'), name + ': clone command must be inside development section');
    const invocations = content => content.match(/node\s+(?:\.\/)?install\.mjs\b[^\n<`&;]*/g) || [];
    const commands = invocations(section);
    assert(commands.length > 0, name + ': missing development preview');
    for (const command of invocations(text)) {
      assert(/(?:^|\s)--dry-run(?:\s|$)/.test(command), name + ': installer command must be preview-only: ' + command);
    }
  }
});
check('immutable 1.17 evidence links', () => {
  const html = releasePages(root)['docs/momm/releases/1.17.0.html'];
  for (const file of ['plan-1.17.md', 'gates-1.17.md', 'third-party-test-plan-1.17.md', 'release-1.17-draft-notes.md']) {
    assert(html.includes('blob/momm-1.17.0/momm/references/' + file), file);
    assert(!html.includes('blob/main/momm/references/' + file), file);
  }
  assert(html.includes('pre-publication wording'));
});
// 1.17.1 S10: the README states the stable version and any candidate under test in one generated line.
// It is never a second truth: it must be exactly what versions.json and the release catalogue give today.
check('one generated release status line', () => {
  const manifest = JSON.parse(read('versions.json')), catalogue = JSON.parse(read('momm/references/release-history.json'));
  // The renderer keeps a CRLF README's line endings, so the comparison here is of lines, not of line endings.
  const status = releaseStatus(manifest, catalogue), line = releaseStatusMarkdown(status), readme = read('README.md').replace(/\r\n/g, '\n');
  const stale = 'README.md disagrees with versions.json and the release catalogue: run node scripts/render-momm-site.mjs';
  assert.equal(readme.split(readmeStatusBlock(status)).length - 1, 1, stale);
  assert.deepEqual(readme.split('\n').filter(text => /Stable: |Candidate under test/.test(text)), [line], 'README.md must state the release status once, in the generated line');
  assert(readme.indexOf(line) < readme.indexOf('## Install MOMM in one line'), 'the status line belongs above the install instructions');
  for (const [, target] of line.matchAll(/\]\(([^)]+)\)/g))
    if (!target.startsWith('https://')) assert(fs.existsSync(new URL('../' + target, import.meta.url)), 'the status line links to a missing file: ' + target);
  assert.equal(read('docs/momm/index.html').split(releaseStatusHtml(status)).length - 1, 1, 'the home page disagrees with versions.json and the release catalogue: run node scripts/render-momm-site.mjs');
  // The line follows the records. With a candidate under test, publishing it (the same entry becomes a
  // release) must leave one stable version and no candidate; without one, there is nothing under test.
  const newest = catalogue[catalogue.length - 1];
  if (newest.kind === 'version-notes') {
    assert.equal(status.candidate?.version, manifest.momm);
    assert.notEqual(status.stable.version, manifest.momm, 'a candidate under test is not the stable release');
    assert(line.includes(`Candidate under test: [${manifest.momm}, not released]`));
    const published = releaseStatus(manifest, [...catalogue.slice(0, -1), { ...newest, kind: 'release', tag: 'momm-' + newest.version, published_date: '2026-01-01T00:00:00Z' }]);
    assert.equal(published.candidate, null);
    assert(releaseStatusMarkdown(published).startsWith(`**MOMM release status.** Stable: [${manifest.momm} (signed tag)]`) && !releaseStatusMarkdown(published).includes('Candidate'));
  } else {
    assert.equal(status.candidate, null);
    assert.equal(status.stable.version, manifest.momm);
    assert(!line.includes('Candidate'));
  }
});
assert.equal(failures.length, 0, failures.join('\n'));
console.log('Release/site consistency: released status, CI coverage, historical scope, verified front doors and tag-pinned evidence pass.');
