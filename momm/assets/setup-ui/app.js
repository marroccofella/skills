// Theme: system preference by default; an explicit choice is remembered per
// browser in localStorage (a per-viewer convenience, never sent anywhere).
(() => {
  const root = document.documentElement, key = "momm-setup-theme";
  let saved = null; try { saved = localStorage.getItem(key); } catch {}
  if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  const button = document.querySelector("#theme-toggle");
  if (!button) return;
  button.addEventListener("click", () => {
    const explicit = root.getAttribute("data-theme");
    const dark = explicit ? explicit === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem(key, next); } catch {}
  });
})();
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
const updateAttempts = new Map();

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
  if (session?.token) headers['X-MOMM-Token'] = session.token;
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
  // A cached success must not survive an expired session: only honor it while
  // the latest readiness poll still reports the route ready. No mutation during
  // render — the guard alone stops it showing "Verified" and counting toward
  // completion once readiness falls.
  if (live?.status === "success" && route.ready === true) return "ready";
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
  if (state === "failed") {
    const result = liveResults.get(route.agent)?.result;
    if (result?.route_status === 'authentication_required') return result.detail || 'Sign in using this provider’s browser login, then verify again.';
    return result?.detail || 'The check did not complete. Inspect the error; an update, quota limit, timeout or service outage is not an expired login.';
  }
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
  if (modelReport?.status === "login_required" || state === 'login' || (state === 'failed' && liveResults.get(route.agent)?.result?.route_status === 'authentication_required')) return "Needs sign-in";
  if (state === 'failed') return 'Check failed';
  if (route.ready) return "Ready to verify";
  return "Not checked";
}

function providerCard(route) {
  const state = routeState(route);
  const provider = session.providers[route.agent];
  const { cli, models } = providerMaintenance(route.agent);
  const detectedVersion = String(cli?.current || route.version || "Not detected").split("\n")[0];
  const cliText = cli?.status === "update_available" ? `${detectedVersion} → ${cli.latest}` : detectedVersion;
  const authText = state === "ready" ? "Verified" : route.ready ? "Session found" : route.installed === false ? "Unavailable" : "Not connected";
  let mainAction = "";
  if (state === "install") mainAction = `<button class="button primary" data-action="install" data-provider="${route.agent}">Install CLI</button>`;
  else if (state === 'login' || (state === 'failed' && liveResults.get(route.agent)?.result?.route_status === 'authentication_required')) mainAction = `<button class="button primary" data-action="login" data-provider="${route.agent}">Sign in</button>${state === 'failed' && route.ready ? `<button class="button ghost" data-test="${route.agent}">Verify again</button>` : ''}`;
  else if (state === 'failed') mainAction = `<button class="button ghost" data-test="${route.agent}">Retry check</button>`;
  else if (state === "detected") mainAction = `<button class="button primary" data-test="${route.agent}">Verify connection</button>`;
  else if (state === "ready") mainAction = `<button class="button ghost" data-test="${route.agent}">Verify again</button>`;
  else mainAction = '<button class="button primary" disabled>Verifying…</button>';
  const updateAction = cli?.status === "update_available" && cli.update_command ? `<button class="inline-action" data-action="update" data-provider="${route.agent}">Update</button>` : "";
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
        <div class="provider-fact"><span>Modalities</span><strong title="What this reviewer can consume via --attach; text-only routes sit out media reviews as unsupported">${escapeHtml((provider.modalities || ["text"]).join(" · "))}</strong></div>
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
  const signIns = routes.filter((route) => routeState(route) === 'login' || (routeState(route) === 'failed' && liveResults.get(route.agent)?.result?.route_status === 'authentication_required')).length;
  const failedChecks = routes.filter(route => routeState(route) === 'failed' && liveResults.get(route.agent)?.result?.route_status !== 'authentication_required').length;
  const installs = routes.filter((route) => routeState(route) === "install").length;
  const verifications = routes.filter((route) => routeState(route) === "detected").length;
  const updates = maintenance?.cli_updates.filter((item) => item.status === "update_available").length || 0;
  const remaining = [];
  if (installs) remaining.push(`${installs} CLI${installs === 1 ? "" : "s"} to install`);
  if (signIns) remaining.push(`${signIns} account${signIns === 1 ? "" : "s"} to connect`);
  if (failedChecks) remaining.push(`${failedChecks} failed check${failedChecks === 1 ? '' : 's'} to investigate`);
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

function cliRow(item) {
  const provider = session.providers[item.agent];
  const controller = item.agent === governorSelect.value ? ' · Controller (not a reviewer)' : '';
  const attempt = updateAttempts.get(item.agent);
  const action = !item.installed ? 'install' : item.update_command ? 'update' : null;
  const label = action === 'install' ? 'Install…' : item.agent === 'antigravity' ? 'Check / update…' : 'Update…';
  return `<tr><th scope="row">${escapeHtml(provider.label)}<small>${escapeHtml(controller || 'Reviewer CLI')}</small></th>
    <td>${escapeHtml(item.current || 'Not detected')}<small>${escapeHtml(item.installation?.kind || 'unknown')} install</small></td>
    <td>${escapeHtml(item.latest || 'Unavailable')}<small>${escapeHtml(item.source)}</small></td>
    <td>${miniStatus(item.status)}${attempt ? `<small role="status">${escapeHtml(attempt.message)}</small>` : ''}</td>
    <td>${action ? `<button class="mini-button" data-maint-provider="${item.agent}" data-maint-action="${action}">${label}</button>` : `<a href="${escapeHtml(provider.docs)}" target="_blank" rel="noreferrer">Update guide ↗</a>`}</td></tr>`;
}

function renderMaintenance() {
  if (!maintenance) return;
  const skillUpdates = maintenance.skills.versions.filter((item) => item.status === "update_available");
  const modifiedSkills = maintenance.skills.versions.filter((item) => item.status === "local_newer");
  const currentSkills = maintenance.skills.versions.filter((item) => item.status === 'current');
  const unknownSkills = maintenance.skills.versions.filter(item => !['update_available','local_newer','current'].includes(item.status));
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
    skillUpdates.length && maintenance.skills.repository_present && !repoDirty ? '<button class="mini-button" data-maint-provider="skills" data-maint-action="update">Preview MOMM update</button>' : "",
  ].join("");
  const dirtyNote = repoDirty ? "This repository has local changes. Review and handle them before applying an update. Commit opens a guided terminal; it never stages or commits without you." : "The repository is clean. Preview a signed MOMM update, inspect its policy diff, then choose explicitly whether to apply it. Other skill updates remain separate decisions.";

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
      <div class="health-card-head"><div><h3>CLI versions & updates</h3><span class="health-count">All six installations, including your controller</span></div></div>
      <div class="cli-table-scroll"><table class="cli-table"><thead><tr><th>Provider</th><th>Installed</th><th>Latest checked</th><th>Status</th><th>Action</th></tr></thead><tbody>${maintenance.cli_updates.map(cliRow).join('')}</tbody></table></div>
      <p class="environment-note">Checks never install updates. Each update shows its command and needs your confirmation. Unknown means unverified, not current. Installation versions do not prove account access or a successful review. After an updater finishes, use Check everything to verify the detected version.</p>
    </article>
    <article class="health-card wide">
      <div class="health-card-head"><div><h3>Skills</h3><span class="health-count">Grouped by action needed</span></div><div class="skill-actions">${skillActions}</div></div>
      <div class="skill-groups">
        ${skillGroup("Update available", skillUpdates, "No published updates")}
        ${skillGroup("Modified locally", modifiedSkills, repoDirty ? "Repository changes detected — use Review diff" : "No local changes")}
        ${skillGroup("Up to date", currentSkills, "Nothing checked")}
        ${unknownSkills.length ? skillGroup('Not verified',unknownSkills,'') : ''}
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
    const fresh = await api("/api/maintenance", { method: "POST", body: JSON.stringify({ governor: governorSelect.value, force }) });
    // Refuse incomplete server responses before touching the last good display
    // or invalidating live checks. Presence evidence never clears failed checks.
    const records = value => Array.isArray(value) && value.every(item => item && typeof item === 'object' && !Array.isArray(item));
    if (!records(fresh?.cli_updates) || !records(fresh?.models) || !records(fresh?.skills?.versions)
      || !fresh.environment || typeof fresh.environment !== 'object' || Array.isArray(fresh.environment)
      || !Object.values(fresh.environment).every(names => Array.isArray(names) && names.every(name => typeof name === 'string'))
      || typeof fresh.runtime?.platform !== 'string') throw new Error('Invalid maintenance response; previous results retained.');
    for (const item of fresh.cli_updates) {
      const previous = maintenance?.cli_updates.find(x => x.agent === item.agent)?.current;
      if (previous && previous !== item.current) liveResults.delete(item.agent);
      const attempt = updateAttempts.get(item.agent);
      if (attempt && item.current && item.current !== attempt.before) {
        attempt.observed = true;
        attempt.message = `Detected ${attempt.before || 'unknown'} → ${item.current}. Verify connection again.`;
      }
    }
    maintenance = fresh;
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
  const cli = maintenance?.cli_updates.find(item => item.agent === provider);
  const command = action === 'update' ? cli?.update_command : action === 'install' ? (cli?.install_command || session.providers[provider]?.install?.[session.platform]) : null;
  if (['install','update'].includes(action) && provider !== 'skills' && !command) { showToast('No verified update command for this installation. Use its update guide.'); return; }
  if (["install", "update"].includes(action) && !window.confirm(`Open a visible terminal and run this ${action === "install" ? "official installer" : provider === 'skills' ? 'MOMM update preview (no installation)' : "provider update"}?\n\n${command || 'Preview the signed MOMM update and policy diff.'}`)) return;
  try {
    const result = await api("/api/action", { method: "POST", body: JSON.stringify({ provider, action, expected_command: command }) });
    showToast(`${result.note || "Follow the instructions in the terminal."} This page will keep checking.`);
    if (["login", "install"].includes(action)) {
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts += 1;
        await refresh();
        if (attempts >= 75) clearInterval(poll);
      }, 4000);
    }
    if (action === 'update' && provider !== 'skills') {
      const attempt = {before:cli?.current,observed:false,message:'Updater opened. Completion not yet verified.'};
      updateAttempts.set(provider,attempt);
      liveResults.delete(provider);
      renderMaintenance(); render();
      const poll = async (remaining) => {
        if (updateAttempts.get(provider) !== attempt) return;
        await loadMaintenance(true);
        if (attempt.observed) { await refresh(); return; }
        if (remaining > 0) setTimeout(() => poll(remaining-1), 10_000);
        else { attempt.message = 'No version change observed. Finish in the terminal, then Check everything.'; renderMaintenance(); }
      };
      setTimeout(() => poll(11),10_000);
    }
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
          if (notify) showToast(current.status === "success" ? `${session.providers[provider].label} passed the synthetic check.` : `${session.providers[provider].label}: ${current.result?.route_status || 'check failed'}. See the card for details.`);
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
