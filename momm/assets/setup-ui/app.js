const grid = document.querySelector("#provider-grid");
const summary = document.querySelector("#summary");
const statusTitle = document.querySelector("#status-title");
const setupPercent = document.querySelector("#setup-percent");
const progress = document.querySelector("#progress");
const governorSelect = document.querySelector("#governor");
const quickSetupButton = document.querySelector("#quick-setup");
const quickSetupNote = document.querySelector("#quick-setup-note");
const refreshButton = document.querySelector("#refresh");
const maintenanceRefreshButton = document.querySelector("#maintenance-refresh");
const maintenanceSummary = document.querySelector("#maintenance-summary");
const maintenanceGrid = document.querySelector("#maintenance-grid");
const closeButton = document.querySelector("#close-server");
const toast = document.querySelector("#toast");

let session = null;
let report = null;
let maintenance = null;
let refreshing = false;
let quickSetupRunning = false;
const liveResults = new Map();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 4200);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.method === "POST") {
    headers["Content-Type"] = "application/json";
    headers["X-MOMM-Token"] = session.token;
  }
  const response = await fetch(path, { ...options, headers });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Setup Center could not complete that action.");
  return value;
}

function reviewerRoutes() {
  return report?.routes.filter((route) => route.role !== "governor" && session.providers[route.agent]) || [];
}

function routeState(route) {
  const live = liveResults.get(route.agent);
  if (live?.status === "running") return "testing";
  if (live?.status === "success") return "ready";
  if (live?.status === "failed") return "failed";
  if (route.ready) return "detected";
  if (route.installed === false) return "install";
  return "login";
}

function stateLabel(state) {
  return ({ detected: "Session found", ready: "Verified", login: "Sign in", install: "Install", testing: "Verifying", failed: "Needs attention" })[state] || "Check";
}

function routeCopy(route, state) {
  if (state === "ready") return "Connection verified with a harmless synthetic sentence. Ready for peer review.";
  if (state === "detected") return "A local account session was found. Verify it without sending repository code.";
  if (state === "testing") return "Checking the connection with a synthetic sentence. This can take about a minute.";
  if (state === "failed") return "The check could not authenticate. Sign in again, then retry verification.";
  if (state === "install") return "The reviewer CLI is not installed. Installation opens visibly in a terminal.";
  return "The CLI is installed, but this provider account is not connected yet.";
}

function providerMaintenance(agent) {
  return {
    cli: maintenance?.cli_updates.find((item) => item.agent === agent),
    models: maintenance?.models.find((item) => item.agent === agent),
  };
}

function modelFact(route, state, modelReport) {
  if (state === "ready") return "Verified";
  if (modelReport?.models?.length) return `${modelReport.models.length} available`;
  if (modelReport?.status === "interactive_selector" && route.ready) return "Available in selector";
  if (modelReport?.status === "login_required" || ["login", "failed"].includes(state)) return "Needs sign-in";
  if (route.ready) return "Ready to verify";
  return "Not checked";
}

function providerCard(route) {
  const state = routeState(route);
  const provider = session.providers[route.agent];
  const { cli, models } = providerMaintenance(route.agent);
  const detectedVersion = String(cli?.current || route.version || "Not detected").split("\n")[0];
  const cliText = cli?.status === "update_available" ? `${detectedVersion} → ${cli.latest}` : cli?.auto_managed ? `${detectedVersion} · auto` : detectedVersion;
  const authText = state === "ready" ? "Verified" : route.ready ? "Session found" : route.installed === false ? "Unavailable" : "Not connected";
  let mainAction = "";
  if (state === "install") mainAction = `<button class="button primary" data-action="install" data-provider="${route.agent}">Install CLI</button>`;
  else if (["login", "failed"].includes(state)) mainAction = `<button class="button primary" data-action="login" data-provider="${route.agent}">Sign in</button>`;
  else if (state === "detected") mainAction = `<button class="button primary" data-test="${route.agent}">Verify connection</button>`;
  else if (state === "ready") mainAction = `<button class="button ghost" data-test="${route.agent}">Verify again</button>`;
  else mainAction = '<button class="button primary" disabled>Verifying…</button>';
  const updateAction = cli?.status === "update_available" ? `<button class="inline-action" data-action="update" data-provider="${route.agent}">Update</button>` : "";
  return `
    <article class="provider-card ${state === "ready" ? "ready" : state === "failed" ? "failed" : ""}" data-card="${route.agent}">
      <div class="card-top">
        <div class="provider-name"><span class="provider-icon">${escapeHtml(provider.label.slice(0, 1).toUpperCase())}</span><div><h3>${escapeHtml(provider.label)}</h3><small class="version">Peer reviewer</small></div></div>
        <span class="status ${state === "detected" ? "login" : state}">${stateLabel(state)}</span>
      </div>
      <p class="card-copy">${escapeHtml(routeCopy(route, state))}</p>
      <div class="provider-facts">
        <div class="provider-fact"><span>CLI</span><div class="provider-fact-line"><strong title="${escapeHtml(cliText)}">${escapeHtml(cliText)}</strong>${updateAction}</div></div>
        <div class="provider-fact"><span>Account</span><strong>${escapeHtml(authText)}</strong></div>
        <div class="provider-fact"><span>Models</span><strong>${escapeHtml(modelFact(route, state, models))}</strong></div>
      </div>
      <div class="card-actions">${mainAction}<a class="docs-link" href="${provider.docs}" target="_blank" rel="noreferrer">Help ↗</a></div>
    </article>`;
}

function render() {
  if (!report) return;
  const routes = reviewerRoutes();
  const milestones = routes.reduce((count, route) => count + Number(route.installed !== false) + Number(Boolean(route.ready)) + Number(routeState(route) === "ready"), 0);
  const possibleMilestones = routes.length * 3;
  const percent = possibleMilestones ? Math.round((milestones / possibleMilestones) * 100) : 100;
  const verified = routes.filter((route) => routeState(route) === "ready").length;
  const signIns = routes.filter((route) => ["login", "failed"].includes(routeState(route))).length;
  const installs = routes.filter((route) => routeState(route) === "install").length;
  const verifications = routes.filter((route) => routeState(route) === "detected").length;
  const updates = maintenance?.cli_updates.filter((item) => item.status === "update_available").length || 0;
  const remaining = [];
  if (installs) remaining.push(`${installs} CLI${installs === 1 ? "" : "s"} to install`);
  if (signIns) remaining.push(`${signIns} account${signIns === 1 ? "" : "s"} to connect`);
  if (verifications) remaining.push(`${verifications} detected session${verifications === 1 ? "" : "s"} to verify`);
  if (updates) remaining.push(`${updates} provider CLI update${updates === 1 ? "" : "s"}`);
  setupPercent.textContent = `${percent}%`;
  progress.style.width = `${percent}%`;
  statusTitle.textContent = percent === 100 ? "Setup complete" : `Setup ${percent}% complete`;
  summary.textContent = remaining.length ? remaining.join(" · ") : "Every reviewer is installed, connected, and verified.";
  quickSetupButton.textContent = quickSetupRunning ? "Running checks…" : verifications ? `Verify ${verifications} detected session${verifications === 1 ? "" : "s"}` : "Run Quick Setup";
  quickSetupNote.textContent = signIns ? "Verifies detected sessions automatically. Provider sign-in opens visibly and still needs you." : "Uses harmless synthetic text only—never project content.";
  grid.innerHTML = routes.map(providerCard).join("");
}

function statusPresentation(status) {
  return ({ current: ["good", "Current"], available: ["good", "Available"], local_newer: ["neutral", "Local newer"], auto_managed: ["neutral", "Auto-managed"], interactive_selector: ["neutral", "In selector"], update_available: ["warn", "Update"], login_required: ["warn", "Sign in"], missing: ["bad", "Missing"], timeout: ["warn", "Retry"], unknown: ["neutral", "Unknown"] })[status] || ["neutral", escapeHtml(status)];
}

function miniStatus(status) {
  const [kind, label] = statusPresentation(status);
  return `<span class="mini-status ${kind}">${escapeHtml(label)}</span>`;
}

function skillRow(item) {
  return `<div class="skill-row"><span class="skill-row-name" title="Local ${escapeHtml(item.current)}${item.latest ? ` · Published ${escapeHtml(item.latest)}` : ""}">${escapeHtml(item.name)} · ${escapeHtml(item.current)}</span>${miniStatus(item.status)}</div>`;
}

function skillGroup(title, items, emptyText) {
  return `<section class="skill-group"><h4>${escapeHtml(title)}<span>${items.length}</span></h4>${items.length ? items.map(skillRow).join("") : `<p class="environment-note">${escapeHtml(emptyText)}</p>`}</section>`;
}

function renderMaintenance() {
  if (!maintenance) return;
  const skillUpdates = maintenance.skills.versions.filter((item) => item.status === "update_available");
  const modifiedSkills = maintenance.skills.versions.filter((item) => item.status === "local_newer");
  const currentSkills = maintenance.skills.versions.filter((item) => !["update_available", "local_newer"].includes(item.status));
  const cliUpdates = maintenance.cli_updates.filter((item) => item.status === "update_available");
  const environmentWarnings = Object.entries(maintenance.environment).filter(([, names]) => names.length);
  const runtimeIssues = [!maintenance.runtime.node_ready, !maintenance.runtime.git, maintenance.runtime.platform.startsWith("win32") && !maintenance.runtime.powershell].filter(Boolean).length;
  const totalUpdates = skillUpdates.length + cliUpdates.length;
  const updateSummary = [skillUpdates.length ? `${skillUpdates.length} skill update${skillUpdates.length === 1 ? "" : "s"}` : "", cliUpdates.length ? `${cliUpdates.length} provider CLI update${cliUpdates.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  maintenanceSummary.textContent = `${runtimeIssues ? `${runtimeIssues} runtime issue${runtimeIssues === 1 ? "" : "s"}` : `Runtime dependencies healthy (Node ${maintenance.runtime.node}, Git${maintenance.runtime.powershell ? ", PowerShell" : ""})`}${totalUpdates ? ` · ${updateSummary} available` : ""}. Checked ${new Date(maintenance.checked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`;

  const repoDirty = maintenance.skills.repository_dirty === true;
  const skillActions = [
    repoDirty ? '<button class="mini-button" data-maint-provider="skills" data-maint-action="diff">Review diff</button>' : "",
    repoDirty ? '<button class="mini-button" data-maint-provider="skills" data-maint-action="commit">Commit…</button>' : "",
    skillUpdates.length && maintenance.skills.repository_present && !repoDirty ? '<button class="mini-button" data-maint-provider="skills" data-maint-action="update">Update skills</button>' : "",
  ].join("");
  const dirtyNote = repoDirty ? "This repository has local changes. Automatic pulls remain blocked until you review and handle them. Commit opens a guided terminal; it never stages or commits without you." : "The skills repository is clean. Published updates can be fast-forwarded safely when available.";

  const environmentLabels = {
    api_key_names_present: "API-key variable names are present; MOMM strips them and remains OAuth-only.",
    update_controls_present: "Update-control variables may disable automatic update checks.",
    model_overrides_present: "Model override variables may change a CLI's selected model.",
    endpoint_overrides_present: "Endpoint override variables may reroute provider traffic.",
    proxy_names_present: "Proxy variables may affect sign-in and update connectivity.",
  };
  const environmentDetails = environmentWarnings.length ? environmentWarnings.map(([key, names]) => `<p><strong>${escapeHtml(names.join(", "))}</strong> — ${escapeHtml(environmentLabels[key])}</p>`).join("") : "<p>No active environment conflicts detected. Variable values were not read.</p>";
  const runtimeDetails = [
    `<p><strong>Node.js</strong> ${escapeHtml(maintenance.runtime.node)}${maintenance.runtime.node_ready ? "" : " — version 22+ recommended"}</p>`,
    `<p><strong>Git</strong> ${escapeHtml(maintenance.runtime.git || "Not detected")}</p>`,
    maintenance.runtime.platform.startsWith("win32") ? `<p><strong>PowerShell</strong> ${escapeHtml(maintenance.runtime.powershell || "Not detected")}</p>` : "",
    `<p><strong>System</strong> ${escapeHtml(maintenance.runtime.platform)}</p>`,
  ].join("");

  maintenanceGrid.innerHTML = `
    <article class="health-card wide">
      <div class="health-card-head"><div><h3>Skills</h3><span class="health-count">Grouped by action needed</span></div><div class="skill-actions">${skillActions}</div></div>
      <div class="skill-groups">
        ${skillGroup("Update available", skillUpdates, "No published updates")}
        ${skillGroup("Modified locally", modifiedSkills, repoDirty ? "Repository changes detected — use Review diff" : "No local changes")}
        ${skillGroup("Up to date", currentSkills, "Nothing checked")}
      </div>
      <p class="environment-note">${escapeHtml(dirtyNote)}</p>
    </article>
    <details class="diagnostics" ${runtimeIssues || environmentWarnings.length ? "open" : ""}>
      <summary><span>System & diagnostic info</span><span class="health-count">${runtimeIssues || environmentWarnings.length ? `${runtimeIssues + environmentWarnings.length} item${runtimeIssues + environmentWarnings.length === 1 ? "" : "s"} need attention` : "Healthy · expand for details"}</span></summary>
      <div class="diagnostics-body">
        <section class="diagnostic-block"><h4>Runtime</h4>${runtimeDetails}</section>
        <section class="diagnostic-block"><h4>Environment signals</h4>${environmentDetails}</section>
      </div>
    </details>`;
}

async function loadMaintenance(force = false) {
  maintenanceRefreshButton.disabled = true;
  maintenanceSummary.textContent = "Checking published skills, reviewer CLIs, models, runtimes, and environment names…";
  try {
    maintenance = await api("/api/maintenance", { method: "POST", body: JSON.stringify({ governor: governorSelect.value, force }) });
    renderMaintenance();
    render();
  } catch (error) {
    maintenanceSummary.textContent = "The maintenance check could not finish. Your reviewer setup is unaffected.";
    showToast(error.message);
  } finally { maintenanceRefreshButton.disabled = false; }
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  refreshButton.disabled = true;
  summary.textContent = "Checking this computer…";
  try {
    report = await api(`/api/status?governor=${encodeURIComponent(governorSelect.value)}`);
    for (const route of report.routes) {
      if (route.ready && liveResults.get(route.agent)?.status === "failed") liveResults.delete(route.agent);
    }
    render();
  } catch (error) {
    summary.textContent = "We could not check the local reviewers.";
    showToast(error.message);
  } finally {
    refreshing = false;
    refreshButton.disabled = false;
  }
}

async function launchAction(provider, action) {
  if (["install", "update"].includes(action) && !window.confirm(`Open a visible terminal and run this ${action === "install" ? "official installer" : "update"}?`)) return;
  try {
    const result = await api("/api/action", { method: "POST", body: JSON.stringify({ provider, action }) });
    showToast(`${result.note || "Follow the instructions in the terminal."} This page will keep checking.`);
    if (["login", "install"].includes(action)) {
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts += 1;
        await refresh();
        if (attempts >= 75) clearInterval(poll);
      }, 4000);
    }
    if (action === "update") setTimeout(() => loadMaintenance(true), 12_000);
  } catch (error) { showToast(error.message); }
}

async function runTest(provider, notify = true) {
  liveResults.set(provider, { status: "running" });
  render();
  try {
    const job = await api("/api/test", { method: "POST", body: JSON.stringify({ provider, governor: governorSelect.value }) });
    return await new Promise((resolve) => {
      const poll = setInterval(async () => {
        try {
          const current = await api(`/api/job/${job.id}`);
          if (current.status === "running") return;
          clearInterval(poll);
          liveResults.set(provider, current);
          render();
          if (notify) showToast(current.status === "success" ? `${session.providers[provider].label} is verified and ready.` : `${session.providers[provider].label} still needs account sign-in.`);
          resolve(current);
        } catch (error) {
          clearInterval(poll);
          const failed = { status: "failed", error: error.message };
          liveResults.set(provider, failed);
          render();
          if (notify) showToast(error.message);
          resolve(failed);
        }
      }, 1800);
    });
  } catch (error) {
    const failed = { status: "failed", error: error.message };
    liveResults.set(provider, failed);
    render();
    if (notify) showToast(error.message);
    return failed;
  }
}

async function runQuickSetup() {
  if (quickSetupRunning) return;
  quickSetupRunning = true;
  quickSetupButton.disabled = true;
  render();
  try {
    await refresh();
    await loadMaintenance(false);
    const eligible = reviewerRoutes().filter((route) => route.ready && routeState(route) !== "ready");
    if (!eligible.length) {
      const disconnected = reviewerRoutes().filter((route) => !route.ready);
      showToast(disconnected.length ? "Detected sessions are checked. Use Sign in on the remaining provider cards." : "All available reviewer connections are already verified.");
      return;
    }
    let passed = 0;
    for (const route of eligible) {
      const result = await runTest(route.agent, false);
      if (result.status === "success") passed += 1;
    }
    showToast(`Quick Setup finished: ${passed} of ${eligible.length} connection${eligible.length === 1 ? "" : "s"} verified.`);
  } finally {
    quickSetupRunning = false;
    quickSetupButton.disabled = false;
    render();
  }
}

grid.addEventListener("click", (event) => {
  const actionButton = event.target.closest("[data-action]");
  const testButton = event.target.closest("[data-test]");
  if (actionButton) launchAction(actionButton.dataset.provider, actionButton.dataset.action);
  if (testButton) runTest(testButton.dataset.test);
});
maintenanceGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-maint-action]");
  if (button) launchAction(button.dataset.maintProvider, button.dataset.maintAction);
});
quickSetupButton.addEventListener("click", runQuickSetup);
refreshButton.addEventListener("click", refresh);
maintenanceRefreshButton.addEventListener("click", () => loadMaintenance(true));
governorSelect.addEventListener("change", () => { liveResults.clear(); refresh(); loadMaintenance(true); });
closeButton.addEventListener("click", async () => {
  try { await api("/api/shutdown", { method: "POST", body: "{}" }); }
  finally { document.body.innerHTML = '<main style="max-width:680px;margin:18vh auto;padding:30px;font-family:system-ui"><h1>Setup Center closed</h1><p>You can close this tab safely.</p></main>'; }
});

(async () => {
  try {
    session = await api("/api/session");
    await refresh();
    loadMaintenance(false);
  } catch (error) {
    summary.textContent = "Setup Center could not start.";
    showToast(error.message);
  }
})();
