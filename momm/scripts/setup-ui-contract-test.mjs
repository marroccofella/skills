#!/usr/bin/env node

// Deterministic release contract for the built Setup Center. This test makes
// no network requests, starts no server, and invokes no provider CLI.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_REVIEWERS,
  GOVERNOR_IDS,
  PROVIDER_IDS,
  PROVIDER_MANIFEST,
} from "./provider-manifest.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mommRoot = path.resolve(scriptDir, "..");
const assetDir = path.join(mommRoot, "assets", "setup-ui");
const app = fs.readFileSync(path.join(assetDir, "app.js"), "utf8");
const html = fs.readFileSync(path.join(assetDir, "index.html"), "utf8");
const css = fs.readFileSync(path.join(assetDir, "styles.css"), "utf8");
const server = fs.readFileSync(path.join(scriptDir, "setup-ui.mjs"), "utf8");
const oauthEnvironment = fs.readFileSync(path.join(scriptDir, "oauth-env.mjs"), "utf8");
const dispatcher = fs.readFileSync(path.join(scriptDir, "multi-review.mjs"), "utf8");
const probeContract = fs.readFileSync(path.join(scriptDir, "setup-probe-contract.mjs"), "utf8");

const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function contract(name, check) {
  try {
    check();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, detail: String(error?.message || error) });
  }
}

function extractFunction(source, name) {
  const startPattern = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const found = startPattern.exec(source);
  assert(found, `function ${name} was not found`);
  const rest = source.slice(found.index + found[0].length);
  const next = /\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(rest);
  return source.slice(found.index, next ? found.index + found[0].length + next.index : source.length);
}

function openingTag(id) {
  const found = new RegExp(`<[^>]+\\bid=["']${id}["'][^>]*>`, "i").exec(html);
  assert(found, `#${id} was not found in index.html`);
  return found[0];
}

const cssRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selectors: match[1].split(",").map((selector) => selector.trim()),
  declarations: match[2],
}));

function exactRuleDeclarations(selector) {
  return cssRules.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.declarations);
}

function hasMinHeight(selector, minimum) {
  return exactRuleDeclarations(selector).some((declarations) => {
    const match = /(?:^|;)\s*min-height\s*:\s*(\d+(?:\.\d+)?)px\b/i.exec(declarations);
    return match && Number(match[1]) >= minimum;
  });
}

contract("api schema is versioned and fail-closed", () => {
  const clientSchema = /const\s+EXPECTED_API_SCHEMA\s*=\s*["']([^"']+)["']/.exec(app)?.[1];
  const serverSchema = /const\s+setupApiSchema\s*=\s*["']([^"']+)["']/.exec(server)?.[1];
  assert(clientSchema && /^momm-setup\/\d+$/.test(clientSchema), "client API schema is missing or unversioned");
  assert(serverSchema === clientSchema, `client/server API schema mismatch (${clientSchema} vs ${serverSchema})`);
  assert(/session\.api_schema\s*!==\s*EXPECTED_API_SCHEMA/.test(app), "client does not reject an incompatible backend schema");
  const mismatchBlock = app.slice(app.indexOf("session.api_schema !== EXPECTED_API_SCHEMA"));
  assert(/setAlert\([\s\S]{0,300}(?:incompatible|Restart Setup Center)/i.test(mismatchBlock), "schema mismatch is not explained persistently");
  for (const control of ["governorSelect", "quickSetupButton", "refreshButton", "maintenanceRefreshButton"]) {
    assert(new RegExp(`${control}\\.disabled\\s*=\\s*true`).test(mismatchBlock), `${control} remains enabled after schema mismatch`);
  }
  assert(/api_schema\s*:\s*setupApiSchema/.test(server), "session payload does not expose the backend API schema");
});

contract("every terminal failure has explicit recovery semantics", () => {
  const presentation = extractFunction(app, "failurePresentation");
  assert(/result\?\.route_status/.test(presentation), "failure routing does not use the backend route_status");
  const expectedRecovery = {
    authentication_required: "login",
    provider_unavailable: "retry",
    ineligible_tier: "help",
    timeout: "retry",
    cancelled: "retry",
    expired: "retry",
    missing: "install",
    invalid_output: "retry",
    disabled_no_oauth: "help",
    unsupported: "help",
    command_error: "help",
    error: "retry",
  };
  for (const [status, action] of Object.entries(expectedRecovery)) {
    const entry = new RegExp(`\\b${status}\\s*:\\s*\\{([^}]*)\\}`).exec(presentation)?.[1];
    assert(entry, `${status} has no explicit failure presentation`);
    assert(/\blabel\s*:/.test(entry) && /\bcopy\s*:/.test(entry) && /\bactionLabel\s*:/.test(entry), `${status} lacks persistent user-facing recovery detail`);
    assert(new RegExp(`\\baction\\s*:\\s*["']${action}["']`).test(entry), `${status} must route to ${action}`);
  }
  assert(/return\s+presentations\[status\]/.test(presentation), "failure presentation does not select by closed status");
  const nextAction = extractFunction(app, "verificationNextAction");
  assert(/failurePresentation\([\s\S]*\)\.actionLabel/.test(nextAction), "persistent results do not expose the provider-specific recovery action");
  const helpRoute = extractFunction(app, "helpRoute");
  assert(/failureStatus\s*===\s*["']command_error["'][\s\S]{0,180}provider\.docs\.install[\s\S]{0,120}CLI repair guide/.test(helpRoute), "command errors do not route to CLI repair guidance");
  assert(/failureStatus\s*===\s*["']ineligible_tier["'][\s\S]{0,180}provider\.docs\.models[\s\S]{0,160}Eligibility guidance/.test(helpRoute), "account ineligibility falls through to misleading sign-in help");
  assert(/route\.route_status\s*===\s*["']command_error["'][\s\S]{0,300}could not run[\s\S]{0,300}if\s*\(!route\.ready\)[\s\S]{0,180}Sign in/.test(server), "verification API collapses CLI command errors into sign-in recovery");
  const commandErrorEntry = extractFunction(dispatcher, "commandErrorPreflightEntry");
  assert(/repair_hint/.test(commandErrorEntry) && !/login_hint/.test(commandErrorEntry), "machine-readable command_error exposes an immediate login action instead of repair guidance");
});

contract("connection results and errors remain visible", () => {
  const alertTag = openingTag("page-alert");
  assert(/\brole=["']alert["']/i.test(alertTag), "persistent page alert lacks role=alert");
  openingTag("verification-results");
  const setAlert = extractFunction(app, "setAlert");
  assert(/pageAlert\.hidden\s*=\s*false/.test(setAlert), "setAlert does not reveal the persistent alert");
  assert(!/setTimeout|showToast/.test(setAlert), "setAlert auto-dismisses or delegates to a transient toast");
  const renderResults = extractFunction(app, "renderVerificationResults");
  assert(/verificationResults\.hidden\s*=\s*rows\.length\s*===\s*0/.test(renderResults), "result visibility is not tied to retained provider results");
  assert(/failurePresentation\(/.test(renderResults) && /verificationNextAction\(/.test(renderResults), "result rows omit failure detail or next action");
  const mergeResults = extractFunction(app, "mergeServerVerifications");
  assert(/liveResults\.set/.test(mergeResults), "completed server verifications are not restored after reload");
  const quickSetup = extractFunction(app, "runQuickSetup");
  assert(/setAlert\(/.test(quickSetup), "Quick Setup completion is not persisted in the page alert");
});

contract("provider diagnostics cannot expose authentication material", () => {
  assert(/function\s+sanitizeProviderDiagnostic\s*\(/.test(oauthEnvironment), "shared provider diagnostic scrubber is missing");
  for (const marker of ["[provider URL hidden", "[authorization code hidden]", "[account identifier hidden]", "<user-home>"]) {
    assert(oauthEnvironment.includes(marker), `diagnostic scrubber lacks ${marker}`);
  }
  const connectivity = extractFunction(server, "startConnectivityJob");
  const models = extractFunction(server, "modelStatus");
  assert(/sanitizeProviderDiagnostic\(/.test(connectivity), "connection job returns raw provider output");
  assert(/sanitizeProviderDiagnostic\(/.test(models), "model discovery returns raw provider output");
  assert(/provider_diagnostics_redacted/.test(server), "Setup Center self-test does not enforce diagnostic redaction");
});

contract("OAuth-only subprocesses fail closed on ambient credentials", () => {
  const cleaner = extractFunction(oauthEnvironment, "cleanOauthEnv");
  assert(/isAllowedOauthEnvironmentName\(key/.test(cleaner), "subprocess environment is not governed by an explicit allowlist");
  assert(/isForbiddenOauthEnvironmentName\(key/.test(cleaner), "reviewed allowlist entries are not rechecked against forbidden auth modes");
  assert(/provider === \"claude\"/.test(oauthEnvironment), "provider-scoped OAuth policy is missing");
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "AWS_PROFILE", "CLAUDE_CODE_USE_BEDROCK", "GOOGLE_GENAI_USE_VERTEXAI"]) {
    assert(oauthEnvironment.includes(`"${name}"`), `${name} has no regression guard`);
  }
  assert(/UNREVIEWED_AMBIENT_VALUE/.test(dispatcher), "dispatcher self-test has no unknown ambient-value canary");
  assert(/strict_environment_drops_unreviewed_values/.test(dispatcher), "dispatcher does not assert fail-closed unknown environment handling");
});

contract("setup probe is capability-bound to one exact payload", () => {
  const validator = extractFunction(dispatcher, "validSetupProbe");
  assert(/channel\.channel/.test(validator) && /channel\.send/.test(validator), "setup probe does not require the server IPC channel");
  assert(/artifact\s*===\s*SETUP_PROBE_INPUT/.test(dispatcher), "setup probe does not require the exact fixed payload");
  assert(/setupProbeDescriptor/.test(dispatcher) && /input_sha256/.test(probeContract), "setup probe descriptor is not bound to its payload");
  assert(/consumeSetupProbeAuthorization/.test(server) && /consumed/.test(server), "setup probe authorization is not one-use");
  assert(/issueSetupProbeAuthorization/.test(server) && /setupProbeAuthorization/.test(server), "Setup Center does not mint a one-time probe capability");
  assert(/stdio:\s*setupProbeAuthorization\s*\?\s*\[[^\]]*"ipc"/.test(server), "authorized setup probe is not carried over a private IPC channel");
  assert(/forged\.code\s*!==\s*0/.test(server) && /arbitrary\.code\s*!==\s*0/.test(server), "Setup Center self-test does not reject direct or arbitrary-payload probe attempts");
  assert(probeContract.includes("SETUP_PROBE_INPUT") && probeContract.includes("setupProbeDescriptor") && probeContract.includes("SETUP_PROBE_AUTH_REQUEST"), "shared fixed probe contract is missing");
  assert(/provider-native saved (?:instructions|configuration) may still apply/i.test(html), "UI overpromises isolation from provider-native saved configuration");
});

contract("controller-scoped responses cannot cross controller generations", () => {
  assert(/controllerRevision\s*\+=\s*1/.test(server), "backend controller revision never advances");
  assert(/beginControllerOperation/.test(server) && /assertControllerOperation/.test(server), "backend has no controller operation capture/revalidation");
  for (const endpoint of ["/api/status", "/api/maintenance", "/api/test"]) assert(server.includes(endpoint), `${endpoint} is missing`);
  assert(/controller_revision/.test(app) && /next\.controller_revision\s*!==\s*generation/.test(app), "frontend does not discard stale controller responses");
  const locks = extractFunction(app, "updateControlLocks");
  assert(/governorSelect\.disabled\s*=\s*[^;]*refreshing[^;]*maintenanceRefreshing/.test(locks), "controller remains selectable during status or maintenance work");
});

contract("verification shutdown cancels and awaits the complete process tree", () => {
  const killer = extractFunction(server, "terminateProcessTree");
  assert(/taskkill/.test(killer) && /"\/T"/.test(killer) && /process\.kill\(-child\.pid/.test(killer), "cross-platform process-tree termination is incomplete");
  const cancel = extractFunction(server, "cancelConnectivityJobs");
  assert(/abort_controller\?\.abort/.test(cancel) && /Promise\.allSettled/.test(cancel), "active verification cancellation is not awaited");
  assert(/await\s+cancelConnectivityJobs\(/.test(server) && /await\s+cancelBackgroundWork\(/.test(server) && /cleanup_complete/.test(server), "shutdown responds before verification cleanup completes");
  const closeStart = app.indexOf('closeButton.addEventListener("click"');
  const closeHandler = app.slice(closeStart, app.indexOf("\n\n(async () =>", closeStart));
  assert(!/\bfinally\b/.test(closeHandler) && /result\.cleanup_complete/.test(closeHandler), "frontend claims closure without confirmed cleanup");
});

contract("verification expiry and maintenance staleness fail closed", () => {
  const status = extractFunction(server, "statusReport");
  assert(/job\.status\s*=\s*"expired"/.test(status) && /latestJobs\.delete/.test(status), "expired success can remain current");
  assert(/job\.status\s*=\s*"invalidated"/.test(status), "auth invalidation does not mutate the stored job");
  assert(/function\s+scheduleVerificationExpiry/.test(app) && /setTimeout/.test(extractFunction(app, "scheduleVerificationExpiry")), "frontend has no expiry repaint timer");
  assert(/incoming\.has\(provider\)/.test(extractFunction(app, "mergeServerVerifications")), "server-omitted verification results can resurrect locally");
  const providerMaintenance = extractFunction(app, "providerMaintenance");
  assert(/if\s*\(maintenanceStale\)\s*return\s*\{\s*cli:\s*null,\s*models:\s*null\s*\}/.test(providerMaintenance), "stale provider maintenance facts remain visible");
  const gateSource = extractFunction(app, "maintenanceActionsEnabled");
  const actionGate = Function(`${gateSource}; return maintenanceActionsEnabled;`)();
  const transition = [false, true, false].map((stale) => actionGate(stale));
  assert(JSON.stringify(transition) === JSON.stringify([true, false, true]), "maintenance action gate does not fail closed and recover deterministically");
  const providerCard = extractFunction(app, "providerCard");
  assert(/updateAction\s*=\s*maintenanceActionable/.test(providerCard), "provider update action ignores stale maintenance state");
  assert(/modelAction\s*=\s*maintenanceActionable/.test(providerCard), "provider model action ignores stale maintenance state");
  assert(/!maintenanceStale/.test(extractFunction(app, "skillHealthRow")), "stale skill actions remain enabled");
  const maintenanceLoader = extractFunction(app, "loadMaintenance");
  assert(/maintenanceStale\s*=\s*true[\s\S]{0,500}renderMaintenance\(\)[\s\S]{0,200}render\(\)/.test(maintenanceLoader), "maintenance failure does not immediately redraw provider cards");
  assert(/maintenanceStale\s*=\s*false[\s\S]{0,200}renderMaintenance\(\)[\s\S]{0,100}render\(\)/.test(maintenanceLoader), "successful maintenance refresh does not restore actions through a redraw");
  const renderFunction = extractFunction(app, "render");
  assert(/const\s+updates\s*=\s*maintenanceStale\s*\?\s*0/.test(renderFunction), "status banner counts stale maintenance updates");
});

contract("maintenance never reads credential-bearing remotes and traces every update", () => {
  const checkout = extractFunction(server, "skillsCheckoutState");
  assert(!/runCommand\([^)]*["']remote["']|["']get-url["']/.test(checkout), "maintenance still reads a Git remote URL");
  assert(/credential_bearing_url_fixture_redacted/.test(server), "embedded-token URL regression fixture is missing");
  assert(/controllerCliUpdate/.test(app) && /Update controller CLI/.test(app), "controller CLI updates have no visible named row/action");
  assert(/unmatchedSkillUpdates/.test(app) && /Additional named updates/.test(app), "unmatched skill-manifest updates remain hidden");
});

contract("dynamic grids are not live regions", () => {
  for (const id of ["provider-grid", "maintenance-grid", "verification-results"]) {
    const tag = openingTag(id);
    assert(!/\baria-live\s*=/i.test(tag), `#${id} must not re-announce its entire contents`);
    assert(!/\brole=["'](?:status|alert)["']/i.test(tag), `#${id} must not be a whole-grid live region`);
  }
});

contract("progress is semantic and bounded", () => {
  const tag = openingTag("setup-progress");
  assert(/\brole=["']progressbar["']/i.test(tag), "setup progress lacks role=progressbar");
  assert(/\baria-valuemin=["']0["']/i.test(tag), "setup progress lacks aria-valuemin=0");
  assert(/\baria-valuemax=["']100["']/i.test(tag), "setup progress lacks aria-valuemax=100");
  assert(/\baria-valuenow=["']0["']/i.test(tag), "setup progress lacks an initial aria-valuenow");
  const setProgress = extractFunction(app, "setProgress");
  assert(/Math\.max\(0,\s*Math\.min\(100,\s*value\)\)/.test(setProgress), "progress updates are not bounded to 0..100");
  assert(/setAttribute\(["']aria-valuenow["']/.test(setProgress), "visual progress updates do not update aria-valuenow");
});

contract("interactive controls retain 44px targets and visible focus", () => {
  const touchTargets = [".button", "select", ".inline-action", ".mini-button", ".docs-link", ".mini-link", ".text-button"];
  for (const selector of touchTargets) {
    assert(hasMinHeight(selector, 44), `${selector} has no direct min-height of at least 44px`);
  }
  const focusSelectors = cssRules.flatMap((rule) => rule.selectors).filter((selector) => selector.includes(":focus-visible"));
  for (const selector of [".button:focus-visible", "select:focus-visible", "a:focus-visible", ".text-button:focus-visible", ".inline-action:focus-visible", ".mini-button:focus-visible"]) {
    assert(focusSelectors.includes(selector), `${selector} has no explicit visible-focus rule`);
  }
  const focusDeclarations = cssRules.filter((rule) => rule.selectors.some((selector) => selector.includes(":focus-visible"))).map((rule) => rule.declarations).join("\n");
  assert(/outline\s*:\s*(?!0|none)/i.test(focusDeclarations), "focus-visible styles do not draw an outline");
  const externalLinks = [...app.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/g)].map((match) => match[0]);
  assert(externalLinks.length > 0, "no external help links were found");
  assert(externalLinks.every((tag) => /\brel=["'][^"']*\bnoopener\b[^"']*\bnoreferrer\b[^"']*["']/.test(tag)), "an external help link lacks explicit noopener noreferrer protection");
});

contract("320px maintenance actions wrap without horizontal overflow", () => {
  const bodyRule = cssRules.find((rule) => rule.selectors.includes("body"));
  assert(bodyRule && /min-width\s*:\s*0(?:px)?(?:\s*;|$)/i.test(bodyRule.declarations), "body retains a rigid minimum width that can overflow beside a vertical scrollbar");
  assert(/\.skill-actions\s*\{[^}]*flex-wrap\s*:\s*wrap/i.test(css), "skill actions do not wrap");
  const mobile = css.slice(css.indexOf("@media (max-width: 520px)"));
  assert(/\.health-card-head\s*\{[^}]*flex-direction\s*:\s*column/i.test(mobile), "mobile health header does not stack");
  assert(/\.skill-actions\s*\{[^}]*width\s*:\s*100%[^}]*justify-content\s*:\s*flex-start/i.test(mobile), "mobile skill actions do not use the available width");
  assert(/\.local-pill\s*\{[^}]*display\s*:\s*none/i.test(mobile), "mobile header still crowds the controller with the local-only pill");
});

contract("provider manifest is a six-provider official-route allowlist", () => {
  const expectedIds = ["codex", "claude", "antigravity", "copilot", "grok", "gemini"];
  assert(JSON.stringify(PROVIDER_IDS) === JSON.stringify(expectedIds), `provider ids must be exactly ${expectedIds.join(", ")}`);
  assert(JSON.stringify(Object.keys(PROVIDER_MANIFEST)) === JSON.stringify(expectedIds), "manifest key order/content differs from PROVIDER_IDS");
  const officialHosts = {
    codex: new Set(["developers.openai.com", "learn.chatgpt.com"]),
    claude: new Set(["docs.anthropic.com", "code.claude.com", "claude.com"]),
    antigravity: new Set(["antigravity.google"]),
    copilot: new Set(["docs.github.com"]),
    grok: new Set(["docs.x.ai", "x.ai"]),
    gemini: new Set(["geminicli.com"]),
  };
  for (const id of expectedIds) {
    const provider = PROVIDER_MANIFEST[id];
    assert(provider && typeof provider.label === "string" && provider.label.trim(), `${id} has no label`);
    assert(provider.docs && JSON.stringify(Object.keys(provider.docs).sort()) === JSON.stringify(["install", "login", "models"]), `${id} must define install/login/models documentation routes`);
    for (const [purpose, value] of Object.entries(provider.docs)) {
      const url = new URL(value);
      assert(url.protocol === "https:", `${id}.${purpose} must use HTTPS`);
      assert(officialHosts[id].has(url.hostname), `${id}.${purpose} uses non-allowlisted host ${url.hostname}`);
      assert(url.pathname && url.pathname !== "/", `${id}.${purpose} must route beyond a generic homepage`);
    }
    for (const action of ["login", "install", "models"]) {
      for (const platform of ["win32", "darwin", "linux"]) {
        assert(typeof provider[action]?.[platform] === "string" && provider[action][platform].trim(), `${id}.${action}.${platform} is missing`);
      }
    }
    assert(typeof provider.loginHint === "string" && provider.loginHint.trim(), `${id} has no login hint`);
    assert(typeof provider.installHint === "string" && provider.installHint.trim(), `${id} has no install hint`);
  }
});

contract("controller and reviewer parity is explicit", () => {
  const expectedGovernors = [...PROVIDER_IDS, "other"];
  assert(JSON.stringify(GOVERNOR_IDS) === JSON.stringify(expectedGovernors), "every provider plus other must be able to govern");
  assert(JSON.stringify(DEFAULT_REVIEWERS) === JSON.stringify(["codex", "claude", "antigravity", "copilot", "grok"]), "default reviewer pool changed without an explicit contract update");
  assert(PROVIDER_MANIFEST.gemini.optional === true, "Gemini must remain visibly opt-in/tier-dependent");
  assert(PROVIDER_IDS.filter((id) => id !== "gemini").every((id) => PROVIDER_MANIFEST[id].optional !== true), "only Gemini may be excluded from the default pool");

  const controllerSelect = /<select\b[^>]*\bid=["']governor["'][^>]*>([\s\S]*?)<\/select>/i.exec(html)?.[1];
  assert(controllerSelect, "controller selector was not found");
  const optionValues = [...controllerSelect.matchAll(/<option\b[^>]*\bvalue=["']([^"']*)["'][^>]*>/gi)].map((match) => match[1]);
  assert(JSON.stringify(optionValues) === JSON.stringify(["", ...GOVERNOR_IDS]), "controller selector and manifest governors differ");

  const routes = extractFunction(app, "reviewerRoutes");
  assert(/route\.role\s*!==\s*["']governor["']/.test(routes), "frontend does not self-exclude the governor route");
  assert(/session\.providers\[route\.agent\]/.test(routes), "frontend routes are not constrained by the shared provider payload");
  assert(/PROVIDER_MANIFEST/.test(server) && /setupReviewers\s*=\s*PROVIDER_IDS\.join/.test(server), "backend does not derive setup routes from the shared provider manifest");

  for (const governor of GOVERNOR_IDS) {
    const visible = PROVIDER_IDS.filter((id) => id !== governor);
    assert(!visible.includes(governor), `${governor} appears in its own reviewer pool`);
    assert(visible.length === (governor === "other" ? 6 : 5), `${governor} has an incomplete setup reviewer pool`);
    const defaults = DEFAULT_REVIEWERS.filter((id) => id !== governor);
    assert(!defaults.includes(governor), `${governor} appears in its default dispatch pool`);
  }
});

const passed = results.every((result) => result.passed);
process.stdout.write(`${JSON.stringify({ passed, mode: "offline-release-contract", tests: results }, null, 2)}\n`);
if (!passed) {
  for (const result of results.filter((item) => !item.passed)) process.stderr.write(`FAIL ${result.name}: ${result.detail}\n`);
  process.exitCode = 1;
}
