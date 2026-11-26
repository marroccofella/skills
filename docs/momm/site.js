"use strict";
document.querySelectorAll("button[data-copy]").forEach(button => {
  const target = document.getElementById(button.dataset.copy);
  if (!target) return;
  const title = button.getAttribute('aria-label') || 'Copy to clipboard';
  button.title = title;
  target.title = title;
  target.tabIndex = 0;
  target.setAttribute('role', 'button');
  target.setAttribute('aria-label', title);
  const notice = document.createElement('span');
  notice.className = 'copy-notice';
  notice.setAttribute('role','status');
  button.before(notice);
  let manualField, resetTimer, generation = 0;
  async function copy() {
    const current = ++generation;
    clearTimeout(resetTimer);
    manualField?.remove();
    try {
      await navigator.clipboard.writeText(target.textContent);
      if (current !== generation) return;
      button.textContent = 'Copied';
      notice.textContent = 'Copied to clipboard.';
    } catch {
      if (current !== generation) return;
      manualField = document.createElement('textarea');
      manualField.className = 'manual-copy-text';
      manualField.setAttribute('aria-label', 'Selected example for manual copying');
      manualField.readOnly = true;
      manualField.rows = target.textContent.includes('\n') ? 4 : 1;
      manualField.value = target.textContent;
      target.after(manualField);
      manualField.focus();
      manualField.select();
      notice.textContent = 'Text selected. Press Ctrl+C (⌘C on Mac) to copy.';
      button.textContent = 'Copy';
      return;
    }
    resetTimer = setTimeout(() => {
      if (current === generation) { button.textContent = 'Copy'; notice.textContent = ''; }
    }, 3500);
  }
  button.addEventListener('click', copy);
  target.addEventListener('click', copy);
  target.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!event.repeat) copy(); }
  });
});
const harness = document.getElementById("harness");
function syncHarness() {
  if (!harness || !["codex", "claude", "gemini", "antigravity"].includes(harness.value)) return;
  document.querySelector("#install-preview code").textContent = `node momm/scripts/install.mjs --target ${harness.value} --dry-run`;
  document.querySelector("#install-apply code").textContent = `node momm/scripts/install.mjs --target ${harness.value}`;
}
harness?.addEventListener("change", syncHarness);
window.addEventListener("pageshow", syncHarness);
syncHarness();
function revealChapter() {
  let id;
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
  if (!id.startsWith('tour-')) return;
  const chapter = document.getElementById(id), details = chapter?.closest('details');
  if (details) { details.open = true; chapter.scrollIntoView({behavior:'instant',block:'start'}); }
}
window.addEventListener('hashchange', revealChapter);
revealChapter();
