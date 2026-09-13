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
const usageTable = document.querySelector("#usage-table");
const usageSummary = document.querySelector("#usage-summary");
const usageRefreshButton = document.querySelector("#usage-refresh");
const guidanceEditor = document.querySelector("#guidance-editor");
const guidanceSummary = document.querySelector("#guidance-summary");
const guidanceError = document.querySelector("#guidance-error");
const guidanceSaveButton = document.querySelector("#guidance-save");
const guidanceReloadButton = document.querySelector("#guidance-reload");
const guidanceUser = document.querySelector("#guidance-user");
const guidanceUserCount = document.querySelector("#guidance-user-count");
const guidancePreview = document.querySelector("#guidance-preview");
const guidancePreviewRoute = document.querySelector("#guidance-preview-route");

let session = null;
let report = null;
let maintenance = null;
let refreshing = false;
let quickSetupRunning = false;
let usage = null;
let guidance = null;
let guidanceSaving = false;
let clockState = null;
let clockError = null;
let clockPoll = null;
let batchRunning = false;
// Batch ticks live here, not in the DOM: renderMaintenance replaces the table
// on every refresh (and between batch steps), and the checkbox is re-emitted
// from this Set so a selection survives the re-render.
const batchSelected = new Set();
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
  // Only rows with a verified command can join a batch; package-manager-owned
  // and missing installations get no checkbox, exactly as they get no Update button.
  const batchable = isBatchable(item);
  return `<tr><td class="batch-cell">${batchable ? `<input type="checkbox" data-batch="${item.agent}" aria-label="Select ${escapeHtml(provider.label)} for batch update" ${batchSelected.has(item.agent) ? 'checked' : ''} ${batchRunning ? 'disabled' : ''}>` : ''}</td><th scope="row">${escapeHtml(provider.label)}<small>${escapeHtml(controller || 'Reviewer CLI')}</small></th>
    <td>${escapeHtml(item.current || 'Not detected')}<small>${escapeHtml(item.installation?.kind || 'unknown')} install</small></td>
    <td>${escapeHtml(item.latest || 'Unavailable')}<small>${escapeHtml(item.source)}</small></td>
    <td>${miniStatus(item.status)}${attempt ? `<small role="status">${escapeHtml(attempt.message)}</small>` : ''}</td>
    <td>${action ? `<button class="mini-button" data-maint-provider="${item.agent}" data-maint-action="${action}">${label}</button>` : `<a href="${escapeHtml(provider.docs)}" target="_blank" rel="noreferrer">Update guide ↗</a>`}</td></tr>`;
}

function renderMaintenance() {
  if (!maintenance) return;
  pruneBatchSelection();
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
      <div class="health-card-head"><div><h3>CLI versions & updates</h3><span class="health-count">All six installations, including your controller</span></div><div class="skill-actions"><button id="batch-update" class="mini-button" type="button" disabled>Update selected…</button></div></div>
      <div class="cli-table-scroll"><table class="cli-table"><thead><tr><th><span class="sr-only">Select for batch update</span></th><th>Provider</th><th>Installed</th><th>Latest checked</th><th>Status</th><th>Action</th></tr></thead><tbody>${maintenance.cli_updates.map(cliRow).join('')}</tbody></table></div>
      <p class="environment-note">Checks never install updates. Each update shows its command and needs your confirmation. Tick several and use Update selected to see every exact command, confirm once, and run them one after another with a version re-check between. Unknown means unverified, not current. Installation versions do not prove account access or a successful review. After an updater finishes, use Check everything to verify the detected version.</p>
    </article>
    <article id="update-clock-card" class="health-card wide"></article>
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
  renderUpdateClock();
  updateBatchButton();
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
    loadUpdateClock(); // the server fed installed versions to the clock; Check everything also triggered setup.check
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
          loadUsage(); // every verification is a sealed report; show what its CLI reported
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

// --- Usage panel (1.16 E1) --------------------------------------------------------
// Renders rollupUsage rows from the server. A route that reported nothing shows
// "0 of n reported", never a zero: absence of data is not a measurement.
function providerLabel(agent) {
  return session?.providers?.[agent]?.label || agent;
}

function reportedCell(count, total, value) {
  if (!count) return `<span class="not-reported">not reported</span><small>0 of ${total} reported</small>`;
  return `${escapeHtml(value)}<small>${count} of ${total} reported</small>`;
}

function renderUsage() {
  if (!usage) return;
  const rows = Array.isArray(usage.rows) ? usage.rows : [];
  const coverage = usage.coverage || {};
  if (!rows.length) {
    usageSummary.textContent = usage.note || "No usage recorded yet.";
    usageTable.innerHTML = `<p class="environment-note">${escapeHtml(usage.note || "No usage recorded yet.")}</p>`;
    return;
  }
  const scope = coverage.reports_available > coverage.reports_scanned ? ` (newest ${coverage.limit} of ${coverage.reports_available} reports)` : "";
  usageSummary.textContent = `${coverage.reviews} completed review${coverage.reviews === 1 ? "" : "s"} across ${coverage.reports_scanned} report${coverage.reports_scanned === 1 ? "" : "s"}${scope}; ${coverage.reports_with_usage} report${coverage.reports_with_usage === 1 ? "" : "s"} carr${coverage.reports_with_usage === 1 ? "ies" : "y"} CLI-reported usage.`;
  const costPerFinding = (row) => {
    if (row.cost_per_accepted_finding === null || row.cost_per_accepted_finding === undefined) return '<span class="not-reported">not reported</span>';
    if (typeof row.cost_per_accepted_finding === "string") return `${escapeHtml(row.cost_per_accepted_finding)}<small>total $${Number(row.total_cost_usd).toFixed(4)} beside it</small>`;
    return `$${Number(row.cost_per_accepted_finding).toFixed(4)}<small>as reported by the CLI</small>`;
  };
  usageTable.innerHTML = `<table class="cli-table usage-rows"><thead><tr><th>Route</th><th>Reviews</th><th>Median total tokens</th><th>Total cost (USD, as reported)</th><th>Cost per accepted finding</th></tr></thead><tbody>${rows.map((row) => `<tr>
    <th scope="row">${escapeHtml(providerLabel(row.agent))}</th>
    <td>${escapeHtml(row.reviews)}</td>
    <td>${reportedCell(row.tokens_reported, row.reviews, row.median_total_tokens === null ? "—" : Number(row.median_total_tokens).toLocaleString())}</td>
    <td>${reportedCell(row.cost_reported, row.reviews, row.total_cost_usd === null ? "—" : `$${Number(row.total_cost_usd).toFixed(4)}`)}</td>
    <td>${costPerFinding(row)}</td></tr>`).join("")}</tbody></table>${usage.note ? `<p class="environment-note">${escapeHtml(usage.note)}</p>` : ""}`;
}

async function loadUsage() {
  try {
    usage = await api("/api/usage");
    renderUsage();
  } catch (error) {
    usageSummary.textContent = "Usage could not be read from the local reports.";
    showToast(error.message);
  }
}

// --- Standing guidance editor (1.16 E3/E4) -------------------------------------------
// Edits the project file only. The save carries the sha256 the editor loaded so
// a concurrent change on disk is refused (409) instead of overwritten; the
// server validates block and route budgets before any byte is written.
const GUIDANCE_PER_BLOCK = 2000;
const GUIDANCE_PER_ROUTE = 6000;

function guidanceBlocks() {
  const routes = guidance?.routes || ["codex", "claude", "gemini", "antigravity", "copilot", "grok"];
  return [
    { key: "governor", label: "Governor", hint: "Standing instructions for the agent driving the review. Shown at the top of --pretty output and kept in the private sidecar; never written to the report." },
    { key: "*", label: "All reviewers", hint: "Appended to every reviewer prompt for this project, after any user-level guidance." },
    ...routes.map((route) => ({ key: route, label: providerLabel(route), hint: `Appended after the shared block, for ${providerLabel(route)} only.`, route })),
  ];
}

function loadedBlock(source, key) {
  if (!source) return "";
  const value = key === "governor" ? source.governor : source.reviewers?.[key];
  return typeof value === "string" ? value : "";
}

// Layers that stay fixed while editing here: user-level "*" and route blocks and
// the project's .reviewrules. Project blocks are replaced by the draft.
function fixedLayers(route) {
  return (guidance?.effective?.[route]?.layers || []).filter((layer) => layer.name !== "persona" && (!layer.name.startsWith("project:") || layer.name === "project:.reviewrules"));
}

function routeTotal(route, draft) {
  const blocks = [...fixedLayers(route).map((layer) => layer.chars), ...["*", route].map((key) => draft[key]).filter((text) => typeof text === "string" && text.trim()).map((text) => text.length)];
  return blocks.reduce((sum, chars) => sum + chars, 0) + Math.max(0, blocks.length - 1) * 2;
}

function draftValues() {
  const values = {};
  for (const area of guidanceEditor.querySelectorAll?.("[data-guidance]") || []) values[area.dataset.guidance] = area.value;
  return values;
}

// Empty blocks are omitted so the file only holds what the user wrote.
function draftGuidance() {
  const values = draftValues();
  const out = {};
  if (values.governor?.trim()) out.governor = values.governor;
  const reviewers = Object.fromEntries(Object.entries(values).filter(([key, text]) => key !== "governor" && text.trim()));
  if (Object.keys(reviewers).length) out.reviewers = reviewers;
  return out;
}

function updateGuidanceCounters() {
  if (!guidance) return;
  const values = draftValues();
  let over = false;
  for (const block of guidanceBlocks()) {
    const length = (values[block.key] || "").length;
    const counter = guidanceEditor.querySelector?.(`[data-count="${block.key}"]`);
    if (counter) { counter.textContent = `${length.toLocaleString()} / ${GUIDANCE_PER_BLOCK}`; counter.classList.toggle("over", length > GUIDANCE_PER_BLOCK); }
    if (length > GUIDANCE_PER_BLOCK) over = true;
    if (block.route) {
      const total = routeTotal(block.route, values);
      const totalNode = guidanceEditor.querySelector?.(`[data-total="${block.key}"]`);
      if (totalNode) { totalNode.textContent = `route total ${total.toLocaleString()} / ${GUIDANCE_PER_ROUTE}`; totalNode.classList.toggle("over", total > GUIDANCE_PER_ROUTE); }
      if (total > GUIDANCE_PER_ROUTE) over = true;
    }
  }
  guidanceSaveButton.disabled = over || guidanceSaving;
  guidanceSaveButton.title = over ? "A block or a route stack is over its cap; trim it to save." : "";
}

function renderGuidancePreview() {
  if (!guidance) return;
  const routes = guidance.routes || [];
  if (guidancePreviewRoute.options && guidancePreviewRoute.options.length !== routes.length) {
    guidancePreviewRoute.innerHTML = routes.map((route) => `<option value="${escapeHtml(route)}">${escapeHtml(providerLabel(route))}</option>`).join("");
  }
  const route = routes.includes(guidancePreviewRoute.value) ? guidancePreviewRoute.value : routes[0];
  guidancePreview.textContent = guidance.resolve_error ? `Preview unavailable: ${guidance.resolve_error}` : guidance.preview?.[route] || "";
}

function renderGuidance() {
  if (!guidance) return;
  const project = guidance.project, user = guidance.user;
  const state = guidance.project_error ? `Project file unreadable: ${guidance.project_error}`
    : !project ? "No project guidance yet. Blocks you save here are written to .momm/guidance.json and trusted."
    : guidance.trusted ? "Project guidance loaded and trusted for this project."
    : "Project guidance is on disk but NOT trusted: runs ignore it until you save it here or trust its hash with the CLI.";
  guidanceSummary.textContent = `${state}${guidance.notices?.length ? ` · ${guidance.notices.length} notice${guidance.notices.length === 1 ? "" : "s"} from the resolver.` : ""}`;
  guidanceEditor.innerHTML = guidanceBlocks().map((block) => `
    <article class="guidance-block" data-block="${escapeHtml(block.key)}">
      <label>
        <span class="guidance-label">${escapeHtml(block.label)}<small>${escapeHtml(block.hint)}</small></span>
        <textarea data-guidance="${escapeHtml(block.key)}" rows="4" spellcheck="false" aria-label="${escapeHtml(block.label)} guidance">${escapeHtml(loadedBlock(project, block.key))}</textarea>
      </label>
      <div class="guidance-meter"><small data-count="${escapeHtml(block.key)}"></small>${block.route ? `<small data-total="${escapeHtml(block.key)}" title="Includes the user-level layers and .reviewrules below plus the shared block"></small>` : ""}</div>
    </article>`).join("");
  const userBlocks = guidanceBlocks().map((block) => [block, loadedBlock(user, block.key)]).filter(([, text]) => text);
  guidanceUserCount.textContent = guidance.user_error ? "unreadable" : userBlocks.length ? `${userBlocks.length} block${userBlocks.length === 1 ? "" : "s"}` : "none";
  guidanceUser.innerHTML = guidance.user_error ? `<p class="environment-note">${escapeHtml(guidance.user_error)}</p>`
    : userBlocks.length ? userBlocks.map(([block, text]) => `<section class="diagnostic-block"><h4>${escapeHtml(block.label)}</h4><pre class="guidance-readonly">${escapeHtml(text)}</pre></section>`).join("")
    : `<p class="environment-note">No user-level guidance file. Create ${escapeHtml(guidance.user_file)} by hand to apply text to every project; this page never writes outside the project.</p>`;
  const problems = [guidance.project_error, guidance.resolve_error, ...(guidance.notices || [])].filter(Boolean);
  guidanceError.hidden = !problems.length;
  guidanceError.textContent = problems.join(" · ");
  renderGuidancePreview();
  updateGuidanceCounters();
}

async function loadGuidance() {
  try {
    guidance = await api("/api/guidance");
    renderGuidance();
  } catch (error) {
    guidanceSummary.textContent = "Guidance could not be loaded.";
    showToast(error.message);
  }
}

async function saveGuidanceDraft() {
  if (!guidance || guidanceSaving) return;
  const draft = draftGuidance();
  const blocks = [...(draft.governor ? ["governor"] : []), ...Object.keys(draft.reviewers || {})];
  const summary = blocks.length ? blocks.map((key) => `${key === "governor" ? "Governor" : key === "*" ? "All reviewers" : providerLabel(key)} (${(key === "governor" ? draft.governor : draft.reviewers[key]).length} chars)`).join("\n") : "(no blocks: the file becomes an empty object)";
  if (!window.confirm(`Write this project's guidance file and trust exactly those bytes?\n\n${guidance.file}\n\n${summary}\n\nReviewer blocks are sent to the reviewer CLIs you select for a run in this project.`)) return;
  guidanceSaving = true;
  updateGuidanceCounters();
  try {
    guidance = await api("/api/guidance", { method: "POST", body: JSON.stringify({ expected_sha256: guidance.project_sha256, guidance: draft }) });
    renderGuidance();
    showToast("Guidance saved and trusted for this project.");
  } catch (error) {
    guidanceError.textContent = error.message;
    guidanceError.hidden = false;
    showToast(error.message);
  } finally {
    guidanceSaving = false;
    updateGuidanceCounters();
  }
}

// --- Automatic updates card (1.16 E6) --------------------------------------------------
// Off by default. Every mutation goes to /api/update-clock; the timer buttons
// echo the exact OS command back so the server can refuse a stale page.
function sourceLabel(name) {
  if (name === "skill") return "MOMM skill";
  if (name === "models") return "Model lists";
  return name.startsWith("cli:") ? `${providerLabel(name.slice(4))} CLI` : name;
}

function formatWhen(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

function formatInterval(ms) {
  if (!Number.isFinite(ms)) return "—";
  return ms >= 3_600_000 ? `${Math.round(ms / 360_000) / 10} h` : `${Math.round(ms / 60_000)} min`;
}

function updateCell(row) {
  if (row.kind === "models") return row.new_models && Object.values(row.new_models).some((list) => list.length) ? miniStatus("update_available") : miniStatus("current");
  if (row.update_available === true) return `${miniStatus("update_available")}${row.needs_protocol_acceptance ? '<small>Protocol changed: needs acceptance</small>' : ""}`;
  if (row.update_available === false) return miniStatus("current");
  return miniStatus("unknown");
}

function renderUpdateClock() {
  const card = document.querySelector("#update-clock-card");
  if (!card) return;
  if (!clockState) {
    card.innerHTML = `<div class="health-card-head"><div><h3>Automatic updates</h3><span class="health-count">Off by default</span></div></div><p class="environment-note">${escapeHtml(clockError || "Loading the update clock…")}</p>`;
    return;
  }
  const auto = clockState.auto_update || {};
  const toggle = (key, label, hint) => `<label class="switch${!auto.enabled && key !== "enabled" ? " dim" : ""}"><input type="checkbox" data-clock-setting="${key}" ${auto[key] ? "checked" : ""} ${key !== "enabled" && !auto.enabled ? "disabled" : ""}><span>${escapeHtml(label)}<small>${escapeHtml(hint)}</small></span></label>`;
  const rows = (clockState.sources || []).map((row) => `<tr>
    <th scope="row">${escapeHtml(sourceLabel(row.name))}${row.status === "unknown" ? "<small>No check-only command</small>" : ""}</th>
    <td>${escapeHtml(row.installed || "—")}</td>
    <td>${escapeHtml(row.latest || "—")}</td>
    <td>${updateCell(row)}</td>
    <td>${escapeHtml(formatWhen(row.last_checked_at))}</td>
    <td>${escapeHtml(formatWhen(row.next_due_at))}</td>
    <td>${escapeHtml(formatInterval(row.interval_ms))}</td>
    <td class="clock-error">${escapeHtml(row.last_error || "—")}</td></tr>`).join("");
  const timer = clockState.timer || {};
  const activity = clockState.activity || {};
  card.innerHTML = `
    <div class="health-card-head"><div><h3>Automatic updates</h3><span class="health-count">${auto.enabled ? "On: signed skill updater and official CLI commands only" : "Off by default; nothing is installed without you"}</span></div>
      <div class="skill-actions"><button class="mini-button" data-clock-action="check" ${activity.running ? "disabled" : ""}>${activity.running ? "Checking…" : "Check now"}</button>${auto.enabled ? '<button class="mini-button" data-clock-action="apply">Apply now…</button>' : ""}</div></div>
    <div class="switch-row">
      ${toggle("enabled", "Automatic updates", "Master switch. Applies only through the signed updater and each CLI's official command.")}
      ${toggle("skill", "Skill", "MOMM itself, after a successful signed dry run.")}
      ${toggle("clis", "CLIs", "Reviewer CLIs with a fixed official command; package-manager installs are skipped.")}
      ${toggle("models", "Models", "Record new model names only; configured models never change.")}
      ${toggle("accept_protocol", "Accept protocol changes", "Let a skill update that changes the review protocol apply without you.")}
    </div>
    <div class="cli-table-scroll"><table class="cli-table clock-table"><thead><tr><th>Source</th><th>Installed</th><th>Latest</th><th>Update</th><th>Last checked</th><th>Next due</th><th>Interval</th><th>Last error</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="environment-note">Estimated ${escapeHtml(clockState.overhead_estimate_per_day ?? "—")} conditional request${clockState.overhead_estimate_per_day === 1 ? "" : "s"} per day at the current intervals. Checks run only on events (review start or finish, opening this page, Check everything, the timer below); nothing polls.${activity.last_finished_at ? ` Last check ${escapeHtml(formatWhen(activity.last_finished_at))} (${escapeHtml(activity.last_event || "—")}${activity.last_result?.skipped_reason ? `, ${escapeHtml(activity.last_result.skipped_reason)}` : ""}).` : ""}${activity.last_error ? ` Last error: ${escapeHtml(activity.last_error)}.` : ""}</p>
    <div class="timer-row">
      <div><strong>Timer</strong><small>Runs the clock every 6 hours when no MOMM process is open. Registered only with your confirmation of the exact command.</small><code>${escapeHtml(timer.install || "")}</code></div>
      <div class="skill-actions"><button class="mini-button" data-timer-action="install">Install…</button><button class="mini-button" data-timer-action="remove">Remove…</button></div>
    </div>`;
  if (activity.running && !clockPoll) clockPoll = setTimeout(() => { clockPoll = null; loadUpdateClock(); }, 4000);
}

async function loadUpdateClock() {
  try {
    clockState = await api("/api/update-clock");
    clockError = null;
  } catch (error) { clockError = error.message; }
  renderUpdateClock();
}

async function clockPost(body) {
  const value = await api("/api/update-clock", { method: "POST", body: JSON.stringify(body) });
  clockState = value;
  clockError = null;
  renderUpdateClock();
  return value;
}

async function setClockSetting(key, checked) {
  if (key === "enabled" && checked && !window.confirm("Turn on automatic updates?\n\nMOMM will apply only through its signed updater (after a successful dry run) and each reviewer CLI's official update command, and only for the sources ticked below. Nothing runs until the next check event. You can turn this off at any time.")) { renderUpdateClock(); return; }
  try {
    await clockPost({ op: "set", patch: { auto_update: { [key]: checked } } });
    showToast(key === "enabled" ? (checked ? "Automatic updates on." : "Automatic updates off.") : "Setting saved.");
  } catch (error) { showToast(error.message); renderUpdateClock(); }
}

async function clockAction(action) {
  try {
    if (action === "check") {
      const value = await clockPost({ op: "trigger", event: "setup.check" });
      showToast(value.result?.ran ? `Checked ${value.result.results.length} source${value.result.results.length === 1 ? "" : "s"}.` : `Check skipped: ${value.result?.skipped_reason || "another check is running"}.`);
    } else if (action === "apply") {
      if (!window.confirm("Apply available updates now through the signed updater and the official CLI commands, for the sources ticked above?")) return;
      const value = await clockPost({ op: "apply" });
      showToast(value.notices?.length ? value.notices.join(" · ") : value.applied?.length ? `Applied ${value.applied.length} update${value.applied.length === 1 ? "" : "s"}.` : `Nothing applied: ${value.skipped?.[0]?.reason || "nothing due"}.`);
      loadMaintenance(true);
    }
  } catch (error) { showToast(error.message); }
}

async function timerAction(action) {
  const command = clockState?.timer?.[action];
  if (!command) { showToast("The timer command is not available yet. Refresh the update clock first."); return; }
  if (!window.confirm(`${action === "install" ? "Register" : "Remove"} the MOMM update timer with this exact command?\n\n${command}`)) return;
  try {
    await clockPost({ op: "timer", action, confirm: true, expected_command: command });
    showToast(action === "install" ? "Timer registered." : "Timer removed.");
  } catch (error) { showToast(error.message); }
}

// --- Batch CLI update (1.16 E6) -----------------------------------------------------------
// Same server path and same exact-command confirmation as the single buttons,
// run one after another with a version re-check between them. Rows without a
// verified command (package-manager owned, not installed) offer no checkbox and
// are refused by the server if they arrive anyway.
function isBatchable(item) {
  return Boolean(item && item.installed && item.update_command);
}

// Drop ticks for rows that are no longer batchable (uninstalled, or now owned
// by a package manager) so a stale selection never reaches the confirm dialog.
function pruneBatchSelection() {
  for (const agent of [...batchSelected]) {
    if (!isBatchable(maintenance?.cli_updates?.find?.((item) => item.agent === agent))) batchSelected.delete(agent);
  }
}

function selectedBatch() {
  pruneBatchSelection();
  return [...batchSelected];
}

function toggleBatch(agent, checked) {
  if (checked && isBatchable(maintenance?.cli_updates?.find?.((item) => item.agent === agent))) batchSelected.add(agent);
  else batchSelected.delete(agent);
  updateBatchButton();
}

function updateBatchButton() {
  const button = document.querySelector("#batch-update");
  if (!button) return;
  const count = selectedBatch().length;
  button.disabled = batchRunning || !count;
  button.textContent = batchRunning ? "Updating…" : count ? `Update ${count} selected…` : "Update selected…";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForVersionChange(provider, before, attempts = 12) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(10_000);
    await loadMaintenance(true);
    const current = maintenance?.cli_updates.find((item) => item.agent === provider)?.current;
    if (current && current !== before) return current;
  }
  return null;
}

async function runBatchUpdate() {
  if (batchRunning || !maintenance) return;
  const selected = selectedBatch().map((agent) => maintenance.cli_updates.find((item) => item.agent === agent)).filter(Boolean);
  const runnable = selected.filter((item) => item.installed && item.update_command);
  const refused = selected.filter((item) => !(item.installed && item.update_command));
  if (!runnable.length) { showToast("No selected CLI has a verified update command. Package-manager installs update through their manager."); return; }
  const list = runnable.map((item) => `${providerLabel(item.agent)}: ${item.update_command}`).join("\n");
  if (!window.confirm(`Open a visible terminal for each of these ${runnable.length} update command${runnable.length === 1 ? "" : "s"}, one after another, re-checking the detected version after each?\n\n${list}${refused.length ? `\n\nSkipped (no verified command): ${refused.map((item) => providerLabel(item.agent)).join(", ")}` : ""}`)) return;
  batchRunning = true;
  updateBatchButton();
  const outcomes = [];
  try {
    for (const item of runnable) {
      const before = item.current;
      try {
        await api("/api/action", { method: "POST", body: JSON.stringify({ provider: item.agent, action: "update", expected_command: item.update_command }) });
        const attempt = { before, observed: false, message: "Updater opened (batch). Waiting for the detected version to change…" };
        updateAttempts.set(item.agent, attempt);
        liveResults.delete(item.agent);
        renderMaintenance(); render();
        const after = await waitForVersionChange(item.agent, before);
        attempt.observed = Boolean(after);
        attempt.message = after ? `Detected ${before || "unknown"} → ${after}. Verify connection again.` : "No version change observed. Finish in the terminal, then Check everything.";
        outcomes.push(`${providerLabel(item.agent)} ${after ? `${before || "?"} → ${after}` : "not verified"}`);
      } catch (error) { outcomes.push(`${providerLabel(item.agent)} refused: ${error.message}`); }
      renderMaintenance();
    }
  } finally {
    batchRunning = false;
    batchSelected.clear(); // the queue was consumed; a fresh selection starts the next batch
    renderMaintenance(); render();
  }
  showToast(`Batch update finished. ${outcomes.join(" · ")}`);
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
  const clockButton = event.target.closest("[data-clock-action]");
  if (clockButton) clockAction(clockButton.dataset.clockAction);
  const timerButton = event.target.closest("[data-timer-action]");
  if (timerButton) timerAction(timerButton.dataset.timerAction);
  if (event.target.closest("#batch-update")) runBatchUpdate();
});
maintenanceGrid.addEventListener("change", (event) => {
  if (event.target.matches("[data-clock-setting]")) setClockSetting(event.target.dataset.clockSetting, event.target.checked);
  if (event.target.matches("[data-batch]")) toggleBatch(event.target.dataset.batch, event.target.checked);
});
guidanceEditor.addEventListener("input", (event) => { if (event.target.matches("[data-guidance]")) updateGuidanceCounters(); });
guidanceSaveButton.addEventListener("click", saveGuidanceDraft);
guidanceReloadButton.addEventListener("click", loadGuidance);
guidancePreviewRoute.addEventListener("change", renderGuidancePreview);
usageRefreshButton.addEventListener("click", loadUsage);
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
    loadGuidance();
    loadUsage();
    loadUpdateClock();
  } catch (error) {
    summary.textContent = "Setup Center could not start.";
    showToast(error.message);
  }
})();
