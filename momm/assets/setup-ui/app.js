const EXPECTED_API_SCHEMA = "momm-setup/2";

const grid = document.querySelector("#provider-grid");
const summary = document.querySelector("#summary");
const statusTitle = document.querySelector("#status-title");
const setupProgress = document.querySelector("#setup-progress");
const setupPercent = document.querySelector("#setup-percent");
const progress = document.querySelector("#progress");
const verificationResults = document.querySelector("#verification-results");
const governorSelect = document.querySelector("#governor");
const quickSetupButton = document.querySelector("#quick-setup");
const quickSetupNote = document.querySelector("#quick-setup-note");
const refreshButton = document.querySelector("#refresh");
const maintenanceRefreshButton = document.querySelector("#maintenance-refresh");
const maintenanceSummary = document.querySelector("#maintenance-summary");
const maintenanceGrid = document.querySelector("#maintenance-grid");
const closeButton = document.querySelector("#close-server");
const pageAlert = document.querySelector("#page-alert");
const toast = document.querySelector("#toast");

let session = null;
let report = null;
let maintenance = null;
let refreshing = false;
let maintenanceRefreshing = false;
let quickSetupRunning = false;
let controllerChanging = false;
let statusStale = false;
let maintenanceStale = false;
let controllerGeneration = 0;
let verificationExpiryTimer = null;
const liveResults = new Map();
const activePolls = new Map();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 4200);
}

function setAlert(message, kind = "error") {
  pageAlert.textContent = message;
  pageAlert.className = `page-alert ${kind}`;
  pageAlert.hidden = false;
}

function clearAlert() {
  pageAlert.hidden = true;
  pageAlert.textContent = "";
  pageAlert.className = "page-alert";
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.method === "POST") {
    headers["Content-Type"] = "application/json";
    headers["X-MOMM-Token"] = session.token;
  }
  const response = await fetch(path, { ...options, headers, cache: "no-store" });
  let value = {};
  try { value = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(value.error || "Setup Center could not complete that action.");
    error.status = response.status;
    error.command = value.command || null;
    throw error;
  }
  return value;
}

function preserveFocus(container, html) {
  const active = document.activeElement;
  const key = active && container.contains(active) ? active.dataset.focusKey : null;
  container.innerHTML = html;
  if (key) container.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)?.focus();
}

function reviewerRoutes() {
  return report?.routes.filter((route) => route.role !== "governor" && session.providers[route.agent]) || [];
}

function liveRouteStatus(route) {
  return liveResults.get(route.agent)?.result?.route_status || null;
}

function routeState(route) {
  if (statusStale) return "stale";
  const live = liveResults.get(route.agent);
  if (live?.status === "running") return "testing";
  if (live?.status === "success" && (!live.expires_at || Date.parse(live.expires_at) > Date.now())) return "ready";
  if (["failed", "invalidated", "cancelled", "expired"].includes(live?.status)) return "failed";
  if (route.route_status && route.route_status !== "success") return "failed";
  if (route.installed === false) return "install";
  if (route.ready) return route.auth_evidence === "weak_shared_presence" ? "possible" : "detected";
  return "login";
}

function failurePresentation(live) {
  const status = live?.result?.route_status || live?.route_status || "error";
  const detail = live?.result?.detail || live?.detail || live?.error || "The provider did not return a usable result.";
  const presentations = {
    authentication_required: { label: "Sign-in expired", copy: detail, action: "login", actionLabel: "Sign in again" },
    missing: { label: "CLI missing", copy: detail, action: "install", actionLabel: "Install CLI" },
    provider_unavailable: { label: "Provider unavailable", copy: detail, action: "retry", actionLabel: "Retry check" },
    timeout: { label: "Check timed out", copy: detail, action: "retry", actionLabel: "Retry check" },
    cancelled: { label: "Check cancelled", copy: detail, action: "retry", actionLabel: "Retry check" },
    expired: { label: "Verification expired", copy: detail, action: "retry", actionLabel: "Verify again" },
    ineligible_tier: { label: "Account not eligible", copy: detail, action: "help", actionLabel: "Eligibility help" },
    invalid_output: { label: "Unreadable response", copy: detail, action: "retry", actionLabel: "Retry check" },
    disabled_no_oauth: { label: "OAuth route unavailable", copy: detail, action: "help", actionLabel: "Open provider guidance" },
    unsupported: { label: "Route unsupported", copy: detail, action: "help", actionLabel: "Open provider guidance" },
    command_error: { label: "CLI cannot run", copy: detail, action: "help", actionLabel: "Open provider guidance" },
    error: { label: "Check failed", copy: detail, action: "retry", actionLabel: "Retry check" },
  };
  return presentations[status] || { label: "Needs attention", copy: detail, action: "retry", actionLabel: "Retry check" };
}

function stateLabel(state, live) {
  if (state === "failed") return failurePresentation(live).label;
  return ({ possible: "Possible session", detected: "Session detected", ready: "Verified", login: "Sign in", install: "Install", testing: "Verifying", stale: "Check required" })[state] || "Check";
}

function routeCopy(route, state, live) {
  if (state === "ready") return "Connection verified with a harmless synthetic sentence. Ready for peer review.";
  if (state === "possible") return "A shared local folder suggests a session may exist, but this is weak evidence. Verify before relying on it.";
  if (state === "detected") return route.auth_evidence === "live_status"
    ? "The provider's own status command found a signed-in session. Verify model access with synthetic text."
    : "A local account artifact was found. Its contents were not read; verify the live connection next.";
  if (state === "testing") return "Checking with the exact disclosed synthetic text from an isolated folder. MOMM includes no project rules, filenames, or source; provider-native saved configuration may still apply.";
  if (state === "failed") return failurePresentation(live).copy;
  if (state === "install") return "The reviewer CLI is not installed. Installation opens visibly and requires your confirmation.";
  if (state === "stale") return "The last local check failed. Check again before starting a verification.";
  if (route.agent === "gemini") return "Optional Gemini route. Sign in with Google; live verification determines account eligibility.";
  return "The CLI is installed, but no usable account evidence was found. Sign in visibly, then verify.";
}

function providerMaintenance(agent) {
  if (maintenanceStale) return { cli: null, models: null };
  return {
    cli: maintenance?.cli_updates?.find((item) => item.agent === agent),
    models: maintenance?.models?.find((item) => item.agent === agent),
  };
}

function maintenanceActionsEnabled(stale = maintenanceStale) {
  return stale === false;
}

function modelFact(route, state, modelReport) {
  if (state === "ready") return "Verified";
  if (modelReport?.models?.length) return `${modelReport.models.length} listed`;
  if (modelReport?.status === "available") return "Model command passed";
  if (modelReport?.status === "interactive_selector" && route.ready) return "Open model selector";
  if (modelReport?.status === "login_required" || state === "login") return "Needs sign-in";
  if (modelReport?.status === "timeout") return "Check timed out";
  if (modelReport?.status === "command_error") return "Command needs attention";
  if (route.ready) return "Ready to inspect";
  return "Not checked";
}

function helpRoute(provider, state, live) {
  const failure = state === "failed" ? failurePresentation(live) : null;
  const failureStatus = live?.result?.route_status || live?.route_status || null;
  if (state === "install" || failure?.action === "install") return { url: provider.docs.install, label: "Install guide ↗" };
  if (failureStatus === "command_error") return { url: provider.docs.install, label: "CLI repair guide ↗" };
  if (failureStatus === "ineligible_tier") return { url: provider.docs.models || provider.docs.install, label: "Eligibility guidance ↗" };
  if (["login", "possible"].includes(state) || failure?.action === "login" || failure?.action === "help") return { url: provider.docs.login, label: "Sign-in help ↗" };
  return { url: provider.docs.models || provider.docs.login, label: "Provider guide ↗" };
}

function actionButton(route, state, live) {
  const key = `provider-main-${route.agent}`;
  if (state === "stale") return `<button class="button primary" type="button" disabled data-focus-key="${key}">Check again first</button>`;
  if (state === "install") return `<button class="button primary" type="button" data-action="install" data-provider="${route.agent}" data-focus-key="${key}">Install CLI</button>`;
  if (state === "login") return `<button class="button primary" type="button" data-action="login" data-provider="${route.agent}" data-focus-key="${key}">Sign in</button>`;
  if (["possible", "detected"].includes(state)) return `<button class="button primary" type="button" data-test="${route.agent}" data-focus-key="${key}">Verify connection</button>`;
  if (state === "ready") return `<button class="button ghost" type="button" data-test="${route.agent}" data-focus-key="${key}">Verify again</button>`;
  if (state === "testing") return `<button class="button primary" type="button" disabled data-focus-key="${key}">Verifying…</button>`;
  const failure = failurePresentation(live);
  if (failure.action === "login") return `<button class="button primary" type="button" data-action="login" data-provider="${route.agent}" data-focus-key="${key}">${escapeHtml(failure.actionLabel)}</button>`;
  if (failure.action === "install") return `<button class="button primary" type="button" data-action="install" data-provider="${route.agent}" data-focus-key="${key}">${escapeHtml(failure.actionLabel)}</button>`;
  if (failure.action === "retry") return `<button class="button primary" type="button" data-test="${route.agent}" data-focus-key="${key}">${escapeHtml(failure.actionLabel)}</button>`;
  return "";
}

function providerCard(route) {
  const state = routeState(route);
  const live = liveResults.get(route.agent);
  const failureSource = live || route;
  const provider = session.providers[route.agent];
  const { cli, models } = providerMaintenance(route.agent);
  const detectedVersion = String(cli?.current || route.version || (route.route_status === "command_error" ? "Detected · unavailable" : "Not detected")).split("\n")[0];
  const cliText = route.route_status === "command_error" ? detectedVersion
    : cli?.status === "update_available" ? `${detectedVersion} → ${cli.latest}`
    : cli?.auto_managed ? `${detectedVersion} · auto-managed`
      : cli?.status === "install_method_dependent" ? `${detectedVersion} · updater varies`
        : detectedVersion;
  const authText = state === "ready" ? "Live verified"
    : state === "possible" ? "Weak shared evidence"
      : route.route_status === "command_error" ? "Not checked"
      : route.auth === "ok" ? "Provider status passed"
        : route.auth === "present" ? "Presence only"
          : route.installed === false ? "Unavailable" : "Not connected";
  const mainAction = actionButton(route, state, failureSource);
  const maintenanceActionable = maintenanceActionsEnabled();
  const updateAction = maintenanceActionable && cli?.status === "update_available" && provider.update
    ? `<button class="inline-action" type="button" data-action="update" data-provider="${route.agent}" data-focus-key="provider-update-${route.agent}">Update CLI</button>`
    : maintenanceActionable && cli?.status === "update_available" ? `<a class="inline-action link-action" href="${escapeHtml(provider.docs.install)}" target="_blank" rel="noopener noreferrer">Update guide</a>` : "";
  const modelAction = maintenanceActionable && ["possible", "detected", "ready"].includes(state)
    ? `<button class="button tertiary" type="button" data-action="models" data-provider="${route.agent}" data-focus-key="provider-models-${route.agent}">View models</button>` : "";
  const help = helpRoute(provider, state, failureSource);
  const failureDetail = state === "failed" ? `<p class="failure-code">Result: ${escapeHtml(liveRouteStatus(route) || route.route_status || "error")}</p>` : "";
  return `
    <article class="provider-card ${state}" data-card="${route.agent}" tabindex="-1">
      <div class="card-top">
        <div class="provider-name"><span class="provider-icon" aria-hidden="true">${escapeHtml(provider.label.slice(0, 1).toUpperCase())}</span><div><h3>${escapeHtml(provider.label)}</h3><small class="version">${provider.optional ? "Optional reviewer" : "Peer reviewer"}</small></div></div>
        <span class="status ${state === "possible" || state === "detected" ? "login" : state}">${escapeHtml(stateLabel(state, failureSource))}</span>
      </div>
      <p class="card-copy">${escapeHtml(routeCopy(route, state, failureSource))}</p>
      ${failureDetail}
      <div class="provider-facts">
        <div class="provider-fact"><span>CLI</span><div class="provider-fact-line"><strong title="${escapeHtml(cliText)}">${escapeHtml(cliText)}</strong>${updateAction}</div></div>
        <div class="provider-fact"><span>Account evidence</span><strong title="${escapeHtml(route.note || authText)}">${escapeHtml(authText)}</strong></div>
        <div class="provider-fact"><span>Models</span><strong title="${escapeHtml(models?.detail || modelFact(route, state, models))}">${escapeHtml(modelFact(route, state, models))}</strong></div>
      </div>
      <div class="card-actions">${mainAction}${modelAction}<a class="docs-link" href="${escapeHtml(help.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(help.label)}</a></div>
    </article>`;
}

function verificationNextAction(route) {
  const state = routeState(route);
  if (state === "ready") return "Ready for peer review";
  if (state === "testing") return "Verification is still running";
  if (state === "failed") return failurePresentation(liveResults.get(route.agent)).actionLabel;
  if (state === "install") return "Install the CLI";
  if (state === "login") return "Sign in, then verify";
  if (["possible", "detected"].includes(state)) return "Verify the detected session";
  return "Check again";
}

function renderVerificationResults(routes) {
  const rows = routes.filter((route) => liveResults.has(route.agent));
  verificationResults.hidden = rows.length === 0;
  if (!rows.length) {
    verificationResults.innerHTML = "";
    return;
  }
  verificationResults.innerHTML = `<h3>Connection check results</h3><ul>${rows.map((route) => {
    const live = liveResults.get(route.agent);
    const state = routeState(route);
    const detail = state === "failed" ? failurePresentation(live).copy : state === "ready" ? "Synthetic connection check passed." : routeCopy(route, state, live);
    return `<li><span><strong>${escapeHtml(session.providers[route.agent].label)}</strong><small>${escapeHtml(detail)}</small></span><span class="result-next ${state}">${escapeHtml(verificationNextAction(route))}</span></li>`;
  }).join("")}</ul>`;
}

function setProgress(value) {
  const bounded = Math.max(0, Math.min(100, value));
  setupPercent.textContent = `${bounded}%`;
  progress.style.width = `${bounded}%`;
  setupProgress.setAttribute("aria-valuenow", String(bounded));
}

function scheduleVerificationExpiry() {
  clearTimeout(verificationExpiryTimer);
  verificationExpiryTimer = null;
  const expiries = [...liveResults.values()]
    .filter((item) => item.status === "success" && Number.isFinite(Date.parse(item.expires_at || "")))
    .map((item) => Date.parse(item.expires_at));
  if (!expiries.length) return;
  const nextExpiry = Math.min(...expiries);
  verificationExpiryTimer = setTimeout(() => {
    let expired = false;
    for (const [provider, item] of liveResults) {
      if (item.status === "success" && Date.parse(item.expires_at || "") <= Date.now()) {
        liveResults.delete(provider);
        expired = true;
      }
    }
    if (expired) {
      render();
      showToast("A reviewer verification expired. Verify it again before relying on it.");
      refresh();
    }
  }, Math.max(25, nextExpiry - Date.now() + 25));
}

function updateControlLocks() {
  const verificationBusy = activePolls.size > 0 || quickSetupRunning;
  governorSelect.disabled = controllerChanging || verificationBusy || refreshing || maintenanceRefreshing;
  refreshButton.disabled = refreshing || controllerChanging || !session?.current_governor;
  maintenanceRefreshButton.disabled = maintenanceRefreshing || controllerChanging || !session?.current_governor;
  quickSetupButton.disabled = quickSetupRunning || refreshing || controllerChanging || !session?.current_governor || statusStale || !report;
}

function renderControllerRequired() {
  setProgress(0);
  statusTitle.textContent = "Choose the agent currently in control";
  summary.textContent = "MOMM must self-exclude your active driver before it can check any peer reviewer.";
  quickSetupButton.textContent = "Choose controller first";
  quickSetupNote.textContent = "This prevents an agent from reviewing its own work.";
  preserveFocus(grid, '<article class="provider-card empty-card"><h3>Reviewer checks are paused</h3><p class="card-copy">Choose the active driver in the Controller menu above. MOMM will then show every other supported reviewer.</p></article>');
  verificationResults.hidden = true;
  updateControlLocks();
}

function render() {
  if (!session?.current_governor || !report) {
    renderControllerRequired();
    return;
  }
  const routes = reviewerRoutes();
  const progressByRoute = routes.map((route) => Number(route.installed !== false) + Number(Boolean(route.ready)) + Number(routeState(route) === "ready"));
  const bestProgress = progressByRoute.length ? Math.max(...progressByRoute) : 0;
  const percent = Math.round((bestProgress / 3) * 100);
  const verified = routes.filter((route) => routeState(route) === "ready").length;
  const signIns = routes.filter((route) => routeState(route) === "login").length;
  const installs = routes.filter((route) => routeState(route) === "install").length;
  const candidates = routes.filter((route) => ["possible", "detected"].includes(routeState(route))).length;
  const failures = routes.filter((route) => routeState(route) === "failed").length;
  const updates = maintenanceStale ? 0 : maintenance?.cli_updates?.filter((item) => item.status === "update_available").length || 0;
  const remaining = [];
  if (verified) remaining.push(`${verified} live reviewer${verified === 1 ? "" : "s"} verified`);
  if (!verified && candidates) remaining.push(`${candidates} session${candidates === 1 ? "" : "s"} ready to verify`);
  if (failures) remaining.push(`${failures} check${failures === 1 ? " needs" : "s need"} recovery`);
  if (signIns) remaining.push(`${signIns} optional sign-in${signIns === 1 ? "" : "s"}`);
  if (installs) remaining.push(`${installs} optional CLI install${installs === 1 ? "" : "s"}`);
  if (updates) remaining.push(`${updates} maintenance update${updates === 1 ? "" : "s"}`);
  setProgress(verified ? 100 : percent);
  statusTitle.textContent = statusStale ? "Reviewer status needs a fresh check" : verified ? "Ready for peer review" : candidates ? "One verification away" : "Connect one reviewer to begin";
  summary.textContent = statusStale ? "The last refresh failed. Existing cards are marked stale and automatic verification is paused." : remaining.join(" · ") || "No external reviewer route is available on this computer yet.";
  quickSetupButton.textContent = quickSetupRunning ? "Running connection checks…" : candidates ? `Verify ${candidates} detected session${candidates === 1 ? "" : "s"}` : failures ? "Review recovery steps" : "Run Quick Setup";
  quickSetupNote.textContent = failures ? "Failures stay visible with a provider-specific next action. OAuth never opens automatically." : "MOMM supplies only the fixed isolated sentence; provider-native saved configuration may still apply.";
  preserveFocus(grid, routes.map(providerCard).join(""));
  renderVerificationResults(routes);
  scheduleVerificationExpiry();
  updateControlLocks();
}

function statusPresentation(status) {
  return ({
    current: ["good", "Published"], available: ["good", "Available"], ok: ["good", "Working"],
    local_newer: ["neutral", "Unpublished"], auto_managed: ["neutral", "Auto-managed"],
    install_method_dependent: ["neutral", "Method varies"], interactive_selector: ["neutral", "In selector"],
    update_available: ["warn", "Update"], login_required: ["warn", "Sign in"], unavailable: ["warn", "Unavailable"],
    timeout: ["warn", "Retry"], missing: ["bad", "Missing"], failing: ["bad", "Failing"], error: ["bad", "Error"],
    command_error: ["bad", "Check failed"], stale: ["warn", "Stale"], unknown: ["neutral", "Unknown"], not_checked: ["neutral", "Not checked"],
  })[status] || ["neutral", String(status || "Unknown")];
}

function miniStatus(status) {
  const [kind, label] = statusPresentation(status);
  return `<span class="mini-status ${kind}">${escapeHtml(label)}</span>`;
}

function versionForSkill(skill) {
  const versions = maintenance.skills.versions || [];
  return versions.find((item) => item.name === skill.skill)
    || versions.find((item) => (skill.aliases || []).includes(item.name))
    || { current: skill.version || "Unknown", latest: null, status: "unknown" };
}

function skillHealthRow(skill) {
  const version = versionForSkill(skill);
  const aliases = skill.aliases?.length ? ` · also ${skill.aliases.join(", ")}` : "";
  let actions = "";
  if (!maintenanceStale && skill.skill === "myrepo" && skill.dependencies?.gh_cli === "missing") {
    actions += '<button class="mini-button" type="button" data-action="install" data-provider="github-cli">Install GitHub CLI</button>';
    actions += '<a class="mini-link" href="https://cli.github.com/manual/installation" target="_blank" rel="noopener noreferrer">Guide ↗</a>';
  } else if (!maintenanceStale && skill.skill === "myrepo" && skill.dependencies?.gh_auth === "login_required") {
    actions += '<button class="mini-button" type="button" data-action="login" data-provider="github-cli">Sign in to GitHub CLI</button>';
  }
  if (!maintenanceStale && skill.skill === "promptus-clone-voice" && skill.status === "unavailable") {
    actions += '<a class="mini-link" href="https://github.com/marroccofella/skills/tree/main/promptus-clone-voice" target="_blank" rel="noopener noreferrer">Setup guide ↗</a>';
  }
  if (!maintenanceStale && ["failing", "error", "missing"].includes(skill.status)) actions += '<button class="mini-button" type="button" data-retest-skills>Retest</button>';
  return `<li class="skill-health-row">
    <div class="health-main"><strong class="health-name">${escapeHtml(skill.skill)}${escapeHtml(aliases)}</strong><span class="health-detail">${escapeHtml(skill.role)} · ${escapeHtml(skill.detail)}</span></div>
    <div class="health-side"><span class="version-state" title="Local ${escapeHtml(version.current)}${version.latest ? ` · Published ${escapeHtml(version.latest)}` : ""}">${escapeHtml(version.current || "Unknown")}</span>${miniStatus(version.status)}${miniStatus(skill.status)}${maintenanceStale ? miniStatus("stale") : ""}${actions}</div>
  </li>`;
}

function renderMaintenance() {
  if (!maintenance) return;
  const health = maintenance.skills.health || { skills: [], verdict: "Unable to check skills", code_health: "unknown", dependency_readiness: "unknown" };
  const rawSkillUpdates = maintenanceStale ? [] : (maintenance.skills.versions || []).filter((item) => item.status === "update_available");
  const knownSkillNames = new Set(health.skills.flatMap((item) => [item.skill, ...(item.aliases || [])]));
  const canonicalSkillUpdates = health.skills.filter((item) => versionForSkill(item).status === "update_available").map((item) => versionForSkill(item));
  const unmatchedSkillUpdates = rawSkillUpdates.filter((item) => !knownSkillNames.has(item.name));
  const skillUpdates = [...canonicalSkillUpdates, ...unmatchedSkillUpdates];
  const cliUpdates = maintenanceStale ? [] : (maintenance.cli_updates || []).filter((item) => item.status === "update_available");
  const controllerCliUpdate = cliUpdates.find((item) => item.agent === session.current_governor) || null;
  const environmentWarnings = Object.entries(maintenance.environment || {}).filter(([, names]) => names.length);
  const runtimeIssues = [!maintenance.runtime.node_supported, !maintenance.runtime.git, maintenance.runtime.platform.startsWith("win32") && !maintenance.runtime.powershell].filter(Boolean).length;
  const dependencyLabel = ({ ready: "Dependencies ready", attention: "Dependencies need attention", not_checked: "Dependencies not checked" })[health.dependency_readiness] || "Dependency readiness unknown";
  const healthAttention = health.skills.some((item) => item.status !== "ok") || health.code_health !== "passing" || health.dependency_readiness !== "ready";
  maintenanceSummary.textContent = maintenanceStale ? "Maintenance data is stale because the last check failed. Previous details are reference-only; update, sign-in, and install actions are disabled until Retest skills succeeds."
    : `${health.verdict}. ${dependencyLabel}. ${runtimeIssues ? `${runtimeIssues} runtime issue${runtimeIssues === 1 ? "" : "s"}` : `Runtime supported (Node ${maintenance.runtime.node}, Git${maintenance.runtime.powershell ? ", PowerShell" : ""})`}${cliUpdates.length || skillUpdates.length ? ` · ${cliUpdates.length + skillUpdates.length} update${cliUpdates.length + skillUpdates.length === 1 ? "" : "s"} available` : ""}. Checked ${new Date(maintenance.checked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`;

  const repoDirty = maintenance.skills.repository_dirty === true;
  const checkoutVerified = maintenance.skills.repository_present === true;
  const skillActions = [
    !maintenanceStale && repoDirty && checkoutVerified ? '<button class="mini-button" type="button" data-maint-provider="skills" data-maint-action="diff">Review diff</button>' : "",
    !maintenanceStale && repoDirty && checkoutVerified ? '<button class="mini-button" type="button" data-maint-provider="skills" data-maint-action="commit">Commit walkthrough…</button>' : "",
    !maintenanceStale && skillUpdates.length && checkoutVerified && !repoDirty ? '<button class="mini-button" type="button" data-maint-provider="skills" data-maint-action="update">Update skills</button>' : "",
  ].join("");
  const changed = maintenance.skills.changed_paths || [];
  const repositoryNote = !checkoutVerified ? "Standalone or unverified layout: health checks still work, but Git actions are disabled so an adjacent repository can never be targeted."
    : repoDirty ? `Repository changes are separate from version and health: ${changed.length} changed path${changed.length === 1 ? "" : "s"}.`
      : "The verified skills checkout is clean.";
  const changedDetails = changed.length ? `<details class="changed-paths"><summary>Show changed paths</summary><ul>${changed.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>` : "";
  const extraUpdateRows = [
    controllerCliUpdate ? `<li class="skill-health-row"><div class="health-main"><strong class="health-name">Controller · ${escapeHtml(session.providers[controllerCliUpdate.agent]?.label || controllerCliUpdate.agent)}</strong><span class="health-detail">${escapeHtml(controllerCliUpdate.current || "Installed version")} → ${escapeHtml(controllerCliUpdate.latest || "new version")} · shown here because the controller is self-excluded from reviewer cards</span></div><div class="health-side">${miniStatus("update_available")}<button class="mini-button" type="button" data-action="update" data-provider="${escapeHtml(controllerCliUpdate.agent)}">Update controller CLI</button><a class="mini-link" href="${escapeHtml(session.providers[controllerCliUpdate.agent]?.docs?.install || "#")}" target="_blank" rel="noopener noreferrer">Guide ↗</a></div></li>` : "",
    ...unmatchedSkillUpdates.map((item) => `<li class="skill-health-row"><div class="health-main"><strong class="health-name">${escapeHtml(item.name)}</strong><span class="health-detail">Maintenance tool manifest entry · ${escapeHtml(item.current || "Unknown")} → ${escapeHtml(item.latest || "new version")}</span></div><div class="health-side">${miniStatus("update_available")}<span class="health-detail">${repoDirty ? "Review local changes above before updating" : checkoutVerified ? "Use Update skills above" : "Git update unavailable in this layout"}</span></div></li>`),
  ].filter(Boolean);
  const extraUpdates = extraUpdateRows.length ? `<div class="repository-state"><strong>Additional named updates</strong><ul class="health-list">${extraUpdateRows.join("")}</ul></div>` : "";

  const environmentLabels = {
    api_key_names_present: "API-key variables are present; their values are stripped before provider commands.",
    update_controls_present: "Update-control variables may disable update checks.",
    model_overrides_present: "Model override variables may change a CLI's selected model.",
    endpoint_overrides_present: "Endpoint override variables are stripped before provider commands.",
    proxy_names_present: "Ambient proxy variables are isolated from provider commands; operating-system network settings still apply.",
  };
  const environmentDetails = environmentWarnings.length ? environmentWarnings.map(([key, names]) => `<p><strong>${escapeHtml(names.join(", "))}</strong> — ${escapeHtml(environmentLabels[key])}</p>`).join("") : "<p>No active environment conflicts detected. Values were not inspected or displayed.</p>";
  const nodeGuidance = maintenance.runtime.node_supported ? (maintenance.runtime.node_recommended ? "" : " — supported; Node 22+ recommended") : " — unsupported; Node 18+ required";
  const runtimeDetails = [
    `<p><strong>Node.js</strong> ${escapeHtml(maintenance.runtime.node)}${nodeGuidance}</p>`,
    `<p><strong>Git</strong> ${escapeHtml(maintenance.runtime.git || "Not detected")}</p>`,
    maintenance.runtime.platform.startsWith("win32") ? `<p><strong>PowerShell</strong> ${escapeHtml(maintenance.runtime.powershell || "Not detected")}</p>` : "",
    `<p><strong>System</strong> ${escapeHtml(maintenance.runtime.platform)}</p>`,
    `<p><strong>Health runner</strong> myskills ${escapeHtml(health.myskills_version || "not available")}</p>`,
  ].join("");

  preserveFocus(maintenanceGrid, `
    <article class="health-card wide ${healthAttention ? "attention" : ""} ${maintenanceStale ? "stale" : ""}">
      <div class="health-card-head"><div><h3>Skills that actually work here</h3><span class="health-count">${maintenanceStale ? "Previous result · " : ""}Functional health and published version are independent · ${escapeHtml(dependencyLabel)}</span></div><div class="skill-actions">${skillActions}<button class="mini-button" type="button" data-retest-skills>Retest skills</button></div></div>
      <ul class="health-list">${health.skills.length ? health.skills.map(skillHealthRow).join("") : '<li class="health-item"><span>Unable to obtain canonical myskills health.</span></li>'}</ul>
      ${extraUpdates}
      <div class="repository-state"><strong>Repository state</strong><p>${escapeHtml(repositoryNote)}</p>${changedDetails}</div>
    </article>
    <details class="diagnostics" ${runtimeIssues || environmentWarnings.length ? "open" : ""}>
      <summary><span>System & diagnostic info</span><span class="health-count">${runtimeIssues || environmentWarnings.length ? `${runtimeIssues + environmentWarnings.length} item${runtimeIssues + environmentWarnings.length === 1 ? "" : "s"} need attention` : "Healthy · expand for details"}</span></summary>
      <div class="diagnostics-body">
        <section class="diagnostic-block"><h4>Runtime</h4>${runtimeDetails}</section>
        <section class="diagnostic-block"><h4>Environment signals</h4>${environmentDetails}</section>
      </div>
    </details>`);
}

async function loadMaintenance(force = false, { throwOnError = false } = {}) {
  if (!session?.current_governor) return false;
  const generation = controllerGeneration;
  const governor = session.current_governor;
  maintenanceRefreshing = true;
  updateControlLocks();
  maintenanceSummary.textContent = "Running canonical skill tests and checking published versions, provider CLIs, models, runtimes, and environment names…";
  try {
    const next = await api("/api/maintenance", { method: "POST", body: JSON.stringify({ force, controller_revision: generation }) });
    if (generation !== controllerGeneration || next.controller_revision !== generation || next.governor !== governor) return false;
    maintenance = next;
    maintenanceStale = false;
    renderMaintenance();
    render();
    return true;
  } catch (error) {
    maintenanceStale = true;
    if (maintenance) renderMaintenance();
    else maintenanceSummary.textContent = "Maintenance check failed. No previous result is treated as healthy.";
    render();
    setAlert(error.message);
    if (throwOnError) throw error;
    return false;
  } finally {
    maintenanceRefreshing = false;
    updateControlLocks();
  }
}

function mergeServerVerifications(verifications = []) {
  const incoming = new Set(verifications.map((item) => item.provider));
  for (const provider of [...liveResults.keys()]) if (!incoming.has(provider)) liveResults.delete(provider);
  for (const verification of verifications) liveResults.set(verification.provider, verification);
  for (const verification of verifications.filter((item) => item.status === "running")) ensureJobPolling(verification, false);
}

async function refresh({ throwOnError = false } = {}) {
  if (!session?.current_governor || refreshing) return false;
  const generation = controllerGeneration;
  const governor = session.current_governor;
  refreshing = true;
  updateControlLocks();
  summary.textContent = "Checking this computer…";
  try {
    const next = await api(`/api/status?controller_revision=${encodeURIComponent(generation)}`);
    if (generation !== controllerGeneration || next.controller_revision !== generation || next.governor !== governor) return false;
    report = next;
    statusStale = false;
    mergeServerVerifications(next.verifications || []);
    render();
    return true;
  } catch (error) {
    statusStale = true;
    if (report) render();
    else summary.textContent = "We could not check the local reviewers.";
    setAlert(`${error.message} Automatic verification is paused until Check again succeeds.`);
    if (throwOnError) throw error;
    return false;
  } finally {
    refreshing = false;
    updateControlLocks();
  }
}

async function launchAction(provider, action) {
  if (["install", "update"].includes(action) && !window.confirm(`Open a visible terminal and run this ${action === "install" ? "documented installer" : "provider updater"}?`)) return;
  try {
    const generation = controllerGeneration;
    const result = await api("/api/action", { method: "POST", body: JSON.stringify({ provider, action, controller_revision: generation }) });
    if (generation !== controllerGeneration || result.controller_revision !== generation) return;
    if (liveResults.has(provider) && ["login", "install"].includes(action)) liveResults.delete(provider);
    setAlert(`${result.note || "Follow the visible terminal instructions."} Command: ${result.command}`, "info");
    showToast("A visible terminal was opened. This page will not type credentials or authorization codes for you.");
    if (["login", "install"].includes(action)) {
      let attempts = 0;
      const generation = controllerGeneration;
      const poll = setInterval(async () => {
        attempts += 1;
        if (generation !== controllerGeneration || attempts > 30) return clearInterval(poll);
        const ok = await refresh();
        if (!ok || attempts >= 30) clearInterval(poll);
      }, 4000);
    }
    if (action === "update") setTimeout(() => loadMaintenance(true), 12_000);
  } catch (error) {
    const fallback = error.command ? ` Run this exact command manually in a terminal: ${error.command}` : "";
    setAlert(`${error.message}${fallback}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureJobPolling(job, notify = true) {
  if (!job?.id || activePolls.has(job.provider)) return activePolls.get(job.provider) || Promise.resolve(job);
  const generation = controllerGeneration;
  const promise = (async () => {
    const deadline = Date.now() + 230_000;
    let current = job;
    while (current.status === "running" && Date.now() < deadline && generation === controllerGeneration) {
      await delay(1800);
      current = await api(`/api/job/${job.id}?controller_revision=${encodeURIComponent(generation)}`);
      if (current.controller_revision !== generation) throw new Error("The active controller changed; this result was discarded.");
      liveResults.set(job.provider, current);
      render();
    }
    if (generation !== controllerGeneration) return current;
    if (current.status === "running") {
      current = { ...current, status: "failed", result: { route_status: "timeout", detail: "The local polling window ended. Check again to resume the server-side result." } };
      liveResults.set(job.provider, current);
      render();
    }
    if (notify) {
      const label = session.providers[job.provider]?.label || job.provider;
      if (current.status === "success") showToast(`${label} is verified and ready.`);
      else setAlert(`${label}: ${failurePresentation(current).copy}`);
    }
    return current;
  })().catch((error) => {
    const failed = { ...job, status: "failed", result: { route_status: "error", detail: error.message } };
    liveResults.set(job.provider, failed);
    render();
    if (notify) setAlert(error.message);
    return failed;
  }).finally(() => {
    activePolls.delete(job.provider);
    updateControlLocks();
  });
  activePolls.set(job.provider, promise);
  updateControlLocks();
  return promise;
}

async function runTest(provider, notify = true) {
  const existing = liveResults.get(provider);
  if (existing?.status === "running") return ensureJobPolling(existing, notify);
  liveResults.set(provider, { provider, status: "running", started_at: new Date().toISOString() });
  render();
  try {
    const generation = controllerGeneration;
    const job = await api("/api/test", { method: "POST", body: JSON.stringify({ provider, controller_revision: generation }) });
    if (generation !== controllerGeneration || job.controller_revision !== generation) throw new Error("The active controller changed; this verification was discarded.");
    liveResults.set(provider, job);
    render();
    return ensureJobPolling(job, notify);
  } catch (error) {
    const failed = { provider, status: "failed", result: { route_status: error.status === 409 && /sign in/i.test(error.message) ? "authentication_required" : "error", detail: error.message } };
    liveResults.set(provider, failed);
    render();
    if (notify) setAlert(error.message);
    return failed;
  }
}

async function runQuickSetup() {
  if (quickSetupRunning || !session?.current_governor) return;
  quickSetupRunning = true;
  clearAlert();
  updateControlLocks();
  render();
  try {
    await refresh({ throwOnError: true });
    const eligible = reviewerRoutes().filter((route) => ["possible", "detected"].includes(routeState(route)));
    if (!eligible.length) {
      const failed = reviewerRoutes().filter((route) => routeState(route) === "failed");
      const disconnected = reviewerRoutes().filter((route) => ["install", "login"].includes(routeState(route)));
      setAlert(failed.length ? "No failed connection is safe to retry automatically. Follow the provider-specific recovery action shown below."
        : disconnected.length ? "No session is ready for automatic verification. Install or sign in to one provider; OAuth will only open when you click its button."
          : "Every detected reviewer is already verified.", failed.length ? "error" : "info");
      return;
    }
    const outcomes = [];
    for (const route of eligible) outcomes.push(await runTest(route.agent, false));
    const passed = outcomes.filter((item) => item.status === "success").length;
    const failed = outcomes.length - passed;
    setAlert(`Quick Setup finished: ${passed} verified, ${failed} need attention. Every result and next action remains visible below.`, failed ? "error" : "success");
  } catch (error) {
    setAlert(`Quick Setup stopped before sending any new check: ${error.message}`);
  } finally {
    quickSetupRunning = false;
    updateControlLocks();
    render();
  }
}

async function chooseController() {
  const next = governorSelect.value;
  const previous = session.current_governor || "";
  if (!next || next === previous) return;
  controllerChanging = true;
  updateControlLocks();
  try {
    const result = await api("/api/controller", { method: "POST", body: JSON.stringify({ governor: next, controller_revision: controllerGeneration }) });
    controllerGeneration = result.controller_revision;
    session.current_governor = result.current_governor;
    report = null;
    maintenance = null;
    liveResults.clear();
    statusStale = false;
    maintenanceStale = false;
    clearAlert();
    await refresh({ throwOnError: true });
    await loadMaintenance(true);
  } catch (error) {
    governorSelect.value = previous;
    setAlert(error.message);
  } finally {
    controllerChanging = false;
    updateControlLocks();
  }
}

function handleProviderClick(event) {
  const actionButton = event.target.closest("[data-action]");
  const testButton = event.target.closest("[data-test]");
  if (actionButton) launchAction(actionButton.dataset.provider, actionButton.dataset.action);
  else if (testButton) runTest(testButton.dataset.test);
}

grid.addEventListener("click", handleProviderClick);
verificationResults.addEventListener("click", handleProviderClick);
maintenanceGrid.addEventListener("click", (event) => {
  const maintenanceButton = event.target.closest("[data-maint-action]");
  const actionButton = event.target.closest("[data-action]");
  const retestButton = event.target.closest("[data-retest-skills]");
  if (maintenanceButton) launchAction(maintenanceButton.dataset.maintProvider, maintenanceButton.dataset.maintAction);
  else if (actionButton) launchAction(actionButton.dataset.provider, actionButton.dataset.action);
  else if (retestButton) loadMaintenance(true);
});
quickSetupButton.addEventListener("click", runQuickSetup);
refreshButton.addEventListener("click", () => refresh());
maintenanceRefreshButton.addEventListener("click", () => loadMaintenance(true));
governorSelect.addEventListener("change", chooseController);
closeButton.addEventListener("click", async () => {
  closeButton.disabled = true;
  try {
    const result = await api("/api/shutdown", { method: "POST", body: "{}" });
    if (result.closing !== true || result.cleanup_complete !== true) throw new Error("Setup Center did not confirm cleanup.");
    document.body.innerHTML = '<main style="max-width:680px;margin:18vh auto;padding:30px;font-family:system-ui"><h1>Setup Center closed</h1><p>Active checks were cleaned up. You can close this tab safely.</p></main>';
  } catch (error) {
    closeButton.disabled = false;
    setAlert(`Setup Center is still running: ${error.message}`);
  }
});

(async () => {
  try {
    session = await api("/api/session");
    if (session.api_schema !== EXPECTED_API_SCHEMA) {
      setAlert(`This page and the running MOMM backend are incompatible (${session.api_schema || "unknown"}). Restart Setup Center to load one matching version.`);
      governorSelect.disabled = true;
      quickSetupButton.disabled = true;
      refreshButton.disabled = true;
      maintenanceRefreshButton.disabled = true;
      return;
    }
    controllerGeneration = session.controller_revision;
    governorSelect.value = session.current_governor || "";
    if (!session.current_governor) {
      renderControllerRequired();
      maintenanceSummary.textContent = "Choose the active controller before running health checks.";
      return;
    }
    await refresh({ throwOnError: true });
    await loadMaintenance(false);
  } catch (error) {
    statusStale = true;
    statusTitle.textContent = "Setup Center could not start";
    summary.textContent = "Restart the local Setup Center, then reload this page.";
    setAlert(error.message);
  }
})();
