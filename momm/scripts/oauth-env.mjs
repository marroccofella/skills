// Shared OAuth-only subprocess policy for every MOMM execution surface.
// Provider CLIs may use their own stored browser sessions, but never inherit
// API keys, cloud credentials, or provider endpoint overrides from MOMM.

export const FORBIDDEN_OAUTH_ENV_NAMES = Object.freeze(new Set([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "XAI_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "COHERE_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "COPILOT_GITHUB_TOKEN",
  "AWS_PROFILE",
  "AWS_DEFAULT_PROFILE",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_CONFIG_FILE",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "CLOUD_ML_REGION",
]));

const PROVIDER_NAME = /(?:OPENAI|ANTHROPIC|CLAUDE|CODEX|COPILOT|GEMINI|GOOGLE|XAI|GROK)/;
const SECRET_NAME = /(?:^|_)(?:API_?KEY|SECRET_?KEY|TOKEN|PASSWORD|CREDENTIALS?)(?:_|$)/;
const ENDPOINT_OVERRIDE = /(?:BASE_URL|ENDPOINT)$/;
const ALTERNATE_AUTH_MODE = /^(?:AWS_|AZURE_|GOOGLE_CLOUD_|ANTHROPIC_VERTEX_|ANTHROPIC_BEDROCK_|CLAUDE_CODE_USE_(?:BEDROCK|VERTEX|FOUNDRY)|GOOGLE_GENAI_USE_VERTEXAI$|CLOUD_ML_REGION$)/;
const REVIEWED_OAUTH_SECRET_NAMES = new Set(["CLAUDE_CODE_OAUTH_TOKEN"]);

// Reviewer subprocesses get a deliberately small runtime environment. Browser
// OAuth sessions remain available through the normal home/config directories;
// only an explicitly reviewed OAuth token variable may cross the boundary.
// Everything else (including unknown ambient tokens and cloud selectors) is
// fail-closed instead of relying on an ever-growing denylist.
export const ALLOWED_OAUTH_ENV_NAMES = Object.freeze(new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "SYSTEMDRIVE",
  "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
  "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
  "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)", "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS", "OS", "USER", "USERNAME", "LOGNAME", "SHELL",
  "LANG", "LANGUAGE", "TERM", "COLORTERM", "TZ", "SSL_CERT_FILE",
  "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "CLAUDE_CODE_OAUTH_TOKEN",
  "MULTI_LLM_REVIEW_DEPTH",
]));

export function isForbiddenOauthEnvironmentName(name) {
  const upper = String(name).toUpperCase();
  if (REVIEWED_OAUTH_SECRET_NAMES.has(upper)) return false;
  return FORBIDDEN_OAUTH_ENV_NAMES.has(upper)
    || SECRET_NAME.test(upper)
    || ALTERNATE_AUTH_MODE.test(upper)
    || (ENDPOINT_OVERRIDE.test(upper) && PROVIDER_NAME.test(upper));
}

export function isAllowedOauthEnvironmentName(name) {
  const upper = String(name).toUpperCase();
  return ALLOWED_OAUTH_ENV_NAMES.has(upper) || upper.startsWith("LC_");
}

export function cleanOauthEnv(source = process.env, { nestedReview = false } = {}) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (isAllowedOauthEnvironmentName(key) && !isForbiddenOauthEnvironmentName(key)) env[key] = value;
  }
  if (nestedReview) {
    const depth = Number.parseInt(env.MULTI_LLM_REVIEW_DEPTH || "0", 10) || 0;
    env.MULTI_LLM_REVIEW_DEPTH = String(depth + 1);
  }
  env.NO_COLOR = "1";
  env.NO_UPDATE_CHECK = "1";
  return env;
}

// Provider failures can contain browser URLs, device codes, account emails,
// credential-shaped values, and user-home paths. Keep the diagnosis useful
// without echoing any of that material into reports or Setup Center.
export function sanitizeProviderDiagnostic(value, { maxLength = 1200 } = {}) {
  return String(value || "")
    .replaceAll(/\u001b\[[0-9;]*m/g, "")
    .replace(/https?:\/\/[^\s<>"']+/gi, "[provider URL hidden — use the visible Sign in or Help action]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[account identifier hidden]")
    .replace(/\b(?:sk-ant-|sk-proj-|xai-|gh[pousr]_)[A-Za-z0-9._-]{8,}\b/gi, "[credential hidden]")
    .replace(/\b4\/[A-Za-z0-9._-]{12,}\b/g, "[authorization code hidden]")
    .replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, "[token hidden]")
    .replace(/((?:authorization|device|verification|user)[ _-]?code(?:\s*[:=]\s*|\s+))[^\s,;]+/gi, "$1[hidden]")
    .replace(/((?:access|refresh|identity|id)[ _-]?token(?:\s*[:=]\s*|\s+))[^\s,;]+/gi, "$1[hidden]")
    .replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+/gi, "<user-home>")
    .replace(/\/(?:Users|home)\/[^/\s"']+/g, "<user-home>")
    .trim()
    .slice(0, Math.max(0, maxLength));
}
