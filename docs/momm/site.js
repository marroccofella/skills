"use strict";
document.querySelectorAll("button[data-copy]").forEach(button => {
  let resetTimer, generation = 0;
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copy);
    if (!target) return;
    const current = ++generation;
    clearTimeout(resetTimer);
    try { await navigator.clipboard.writeText(target.textContent); if (current !== generation) return; button.textContent = "Copied"; }
    catch { if (current !== generation) return; const range = document.createRange(); range.selectNodeContents(target); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); button.textContent = "Select + copy"; }
    resetTimer = setTimeout(() => { if (current === generation) button.textContent = "Copy"; }, 2500);
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
