// Governor-inspected independent offline regression probes. Actual page scripts; no speech,
// network, provider calls or production writes. Focus probe models DOM removal;
// it is not a claim of a real browser keyboard/accessibility verification.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync(path.join(root,'docs/evidence/index.html'), 'utf8');
const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const bootstrap = blocks.find(s => s.includes('const RAW_EXPORT'));
const studio = blocks.find(s => s.includes('const MODEL ='));
const tips = blocks.find(s => s.includes('const TIPS ='));
assert(bootstrap && studio && tips, 'Actual page script boundaries changed');
const source = JSON.parse(fs.readFileSync(path.join(root,'docs/evidence/momm-evidence.json'), 'utf8'));
const results = [];
function test(name, fn) { try { const detail = fn(); results.push({ name, passed: true, detail }); } catch (e) { results.push({ name, passed: false, error: e.message }); } }

function harness(data = source, hash = '') {
  const nodes = new Map();
  const document = { documentElement: { dataset: {} }, activeElement: null, getElementById(id) { if (!nodes.has(id)) nodes.set(id, node(id)); return nodes.get(id); } };
  function node(id, parent = null, dataset = {}) {
    let text = '', markup = ''; const classes = new Set(), listeners = new Map();
    const el = { id, parent, dataset, value: '', disabled: false, style: {}, listeners, children: [],
      classList: { add(x) { classes.add(x); }, remove(x) { classes.delete(x); }, contains(x) { return classes.has(x); }, toggle(x) { classes.has(x) ? classes.delete(x) : classes.add(x); } },
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
      setAttribute() {}, focus() { document.activeElement = el; },
      contains(child) { return child === el || el.children.includes(child); },
      matches(selector) { return !!dataset.id && selector.startsWith('button'); },
      closest(selector) { return el.matches(selector) ? el : null; },
      querySelector(selector) { const id = selector.match(/data-id="([^"]+)"/)?.[1], project = selector.match(/data-project="([^"]+)"/)?.[1]; return el.children.find(n => (!id || n.dataset.id === id) && (!project || n.dataset.project === project)) ?? null; },
      querySelectorAll(selector) { return selector.startsWith('button') ? el.children : []; },
      insertAdjacentHTML(_at, value) { el.innerHTML += value; },
      click() { for (const fn of parent?.listeners.get('click') ?? []) fn({ target: el }); },
      get textContent() { return text; }, set textContent(v) { text = String(v); },
      get innerHTML() { return markup; }, set innerHTML(v) {
        // Browser DOM removal destroys focus if a focused descendant is removed.
        if (el.children.includes(document.activeElement)) document.activeElement = document.body;
        markup = String(v); el.children = [];
        if (id === 'runs') for (const m of markup.matchAll(/<button data-id="([^"]+)" data-project="([^"]+)"/g))
          el.children.push(node('run-button', el, { id: m[1], project: m[2] }));
      },
    };
    if (id === 'data') el.textContent = JSON.stringify(data);
    return el;
  }
  document.body = node('body'); document.activeElement = document.body;
  const context = vm.createContext({ document, CSS: { escape: s => s }, window: {},
    localStorage: { getItem() { throw Error('Storage denied'); }, setItem() { throw Error('Storage denied'); } },
    history: { replaceState() {} }, location: { hash }, requestAnimationFrame(fn) { fn(); },
  });
  vm.runInContext(bootstrap, context, { timeout: 3000 });
  return { context, nodes, document, loadStudio() { vm.runInContext(studio, context, { timeout: 3000 }); } };
}

test('selection retains focused run (DOM-removal model)', () => {
  const h = harness(); h.loadStudio();
  const second = h.nodes.get('runs').children[1]; assert(second);
  second.focus(); const expected = { ...second.dataset }; second.click();
  assert.equal(h.document.activeElement.dataset.id, expected.id, 'Run activation removed focused button without restoring focus');
  assert.equal(h.document.activeElement.dataset.project, expected.project);
});

test('all actual headline labels have exact tooltip definitions', () => {
  const h = harness(), labels = vm.runInContext('stats.map(s=>s[1])', h.context);
  const start = tips.indexOf('  const TIPS ='), end = tips.indexOf('  const SELECTORS =');
  assert(start >= 0 && end > start);
  const missing = vm.runInNewContext(tips.slice(start, end) + '\nlabels.filter(label => !TIPS[label]);', { labels });
  assert.equal(missing.length, 0, `Missing exact label definitions: ${missing.join(', ')}; prefix fallback can supply an unrelated explanation`);
});

test('title uses linked report findings rather than missing log count', () => {
  const h = harness(); h.loadStudio();
  h.context.fixture = { project: 'Fixture', run: { run_id: 'rev_fixture', governor: 'codex', findings_count: null, reviewer_status: { claude: 'success' } },
    report: { report: { reviewers: [{ agent: 'claude', status: 'success', verdict: 'MODIFY' }], findings: [{ severity: 'WARNING', issue: 'Synthetic claim' }] } }, dispositions: [] };
  vm.runInContext('renderDetail(fixture)', h.context);
  assert(h.nodes.get('detail').innerHTML.includes('Recorded 1 defect claim'));
  assert(!h.nodes.get('detail-title').textContent.includes('no findings recorded'), h.nodes.get('detail-title').textContent);
});

test('malformed fragment falls back to initial detail', () => {
  const h = harness(source, '#%E0'); h.loadStudio();
  assert(h.nodes.get('detail').innerHTML.includes('model-banner'));
});

const decision = { run_id: 'rev_shared', reviewer: 'claude', disposition: 'rejected', suggestion: 'fixture', reason: 'fixture' };
const project = (name, runs = []) => ({ name, root: name, runs, reports: {}, dispositions: [decision] });
test('legacy projects retain separately scoped orphan rows', () => {
  const h = harness({ generated: '2026-01-01', projects: [project('A'), project('B')] });
  assert.equal(vm.runInContext('allRuns.filter(e=>e.orphan).length', h.context), 2);
});
test('event-only run does not hide its surviving dispositions', () => {
  const h = harness({ generated: '2026-01-01', projects: [project('A', [{ run_id: 'rev_shared', event: 'evidence_backfill' }])] });
  assert.equal(vm.runInContext('allRuns.filter(e=>e.orphan).length', h.context), 1);
});

console.log(JSON.stringify({ passed: results.every(r => r.passed), browser_verified: false, tests: results }, null, 2));
if (results.some(r => !r.passed)) process.exitCode = 1;


