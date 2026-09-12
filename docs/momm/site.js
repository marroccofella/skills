"use strict";
document.querySelectorAll("button[data-copy]").forEach(button => {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copy);
    if (!target) return;
    try { await navigator.clipboard.writeText(target.textContent); button.textContent = "Copied"; }
    catch { const range = document.createRange(); range.selectNodeContents(target); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); button.textContent = "Select + copy"; }
    setTimeout(() => { button.textContent = "Copy"; }, 2500);
  });
});
const harness = document.getElementById("harness");
harness?.addEventListener("change", () => {
  if (!["codex", "claude", "gemini", "antigravity"].includes(harness.value)) return;
  document.querySelector("#install-preview code").textContent = `node momm/scripts/install.mjs --target ${harness.value} --dry-run`;
  document.querySelector("#install-apply code").textContent = `node momm/scripts/install.mjs --target ${harness.value}`;
});
