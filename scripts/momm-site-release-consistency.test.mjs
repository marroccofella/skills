import assert from 'node:assert/strict';
import fs from 'node:fs';
import { improvementBody } from './momm-site-community.mjs';
import { releasePages } from './momm-release-pages.mjs';
import { fileURLToPath } from 'node:url';

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
    assert(development > signed, name + ': development route must follow signed-install guidance');
    assert(clone > development, name + ': clone command must be under the development heading');
    const section = text.slice(development).split(name.endsWith('.md') ? /\n## / : /<\/div>/)[0];
    const commands = section.match(/node install\.mjs --target [^\n<`]+/g) || [];
    assert(commands.length > 0, name + ': missing development preview');
    assert(commands.every(command => /(?:^|\s)--dry-run(?:\s|$)/.test(command)), name + ': development command must be preview-only');
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
assert.equal(failures.length, 0, failures.join('\n'));
console.log('Release/site consistency: released status, CI coverage, historical scope, verified front doors and tag-pinned evidence pass.');
