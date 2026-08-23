// One reviewed source of truth for every MOMM adapter surface: dispatcher,
// onboarding, Setup Center actions, help routes, and controller matrices.

export const PROVIDER_MANIFEST = Object.freeze({
  codex: {
    label: "OpenAI Codex",
    docs: {
      install: "https://learn.chatgpt.com/docs/codex/cli",
      login: "https://learn.chatgpt.com/docs/auth",
      models: "https://learn.chatgpt.com/docs/models",
    },
    login: { win32: "codex login", darwin: "codex login", linux: "codex login" },
    update: null,
    models: { win32: "codex", darwin: "codex", linux: "codex" },
    install: { win32: "npm install -g @openai/codex", darwin: "npm install -g @openai/codex", linux: "npm install -g @openai/codex" },
    loginHint: "codex login   (ChatGPT account, browser flow)",
    installHint: "npm install -g @openai/codex",
    loginNote: "Complete OpenAI sign-in in the browser window that opens.",
    modelsNote: "When Codex opens, type /model to view models available to this account.",
  },
  claude: {
    label: "Claude Code",
    docs: {
      install: "https://code.claude.com/docs/en/setup",
      login: "https://code.claude.com/docs/en/authentication",
      models: "https://code.claude.com/docs/en/model-config",
    },
    login: { win32: "claude auth login", darwin: "claude auth login", linux: "claude auth login" },
    update: { win32: "claude update", darwin: "claude update", linux: "claude update" },
    models: { win32: "claude", darwin: "claude", linux: "claude" },
    install: { win32: "npm install -g @anthropic-ai/claude-code", darwin: "npm install -g @anthropic-ai/claude-code", linux: "npm install -g @anthropic-ai/claude-code" },
    loginHint: "claude auth login   (Anthropic account, browser flow)",
    installHint: "npm install -g @anthropic-ai/claude-code",
    loginNote: "Complete Anthropic sign-in in the browser window that opens.",
    modelsNote: "When Claude opens, type /model to view models available to this account.",
  },
  antigravity: {
    label: "Antigravity",
    docs: {
      install: "https://antigravity.google/docs/cli/install/",
      login: "https://antigravity.google/docs/cli/reference",
      models: "https://antigravity.google/docs/cli/headless/",
    },
    login: { win32: "agy", darwin: "agy", linux: "agy" },
    update: { win32: "agy update", darwin: "agy update", linux: "agy update" },
    models: { win32: "agy models", darwin: "agy models", linux: "agy models" },
    install: {
      win32: "irm https://antigravity.google/cli/install.ps1 | iex",
      darwin: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
      linux: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
    },
    loginHint: "agy   (opens Google browser sign-in when needed)",
    installHint: "installer at antigravity.google/docs/cli/install (provides the agy command)",
    loginNote: "Complete Google sign-in in the browser window that opens.",
    modelsNote: "The terminal lists models available to the signed-in Google account.",
  },
  copilot: {
    label: "GitHub Copilot",
    docs: {
      install: "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli",
      login: "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli",
      models: "https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference",
    },
    login: { win32: "copilot login", darwin: "copilot login", linux: "copilot login" },
    update: { win32: "copilot update", darwin: "copilot update", linux: "copilot update" },
    models: { win32: "copilot", darwin: "copilot", linux: "copilot" },
    install: { win32: "npm install -g @github/copilot", darwin: "npm install -g @github/copilot", linux: "npm install -g @github/copilot" },
    loginHint: "copilot login   (GitHub account, browser flow)",
    installHint: "npm install -g @github/copilot",
    loginNote: "Complete GitHub sign-in in the browser window that opens. Device code is available for remote or headless use.",
    modelsNote: "When Copilot opens, type /model to view models available to this account.",
  },
  grok: {
    label: "Grok",
    docs: {
      install: "https://docs.x.ai/build/overview",
      login: "https://docs.x.ai/build/cli/reference",
      models: "https://docs.x.ai/build/cli/reference",
    },
    login: { win32: "grok login", darwin: "grok login", linux: "grok login" },
    update: { win32: "grok update", darwin: "grok update", linux: "grok update" },
    models: { win32: "grok models", darwin: "grok models", linux: "grok models" },
    install: {
      win32: "irm https://x.ai/cli/install.ps1 | iex",
      darwin: "curl -fsSL https://x.ai/cli/install.sh | bash",
      linux: "curl -fsSL https://x.ai/cli/install.sh | bash",
    },
    loginHint: "grok login   (xAI account, browser flow; or grok login --device-code without a browser)",
    installHint: "Windows: irm https://x.ai/cli/install.ps1 | iex — other platforms: x.ai/cli",
    loginNote: "Complete xAI sign-in in the browser, or use device authentication if prompted.",
    modelsNote: "The terminal lists Grok models visible to this installation and account.",
  },
  gemini: {
    label: "Gemini CLI",
    docs: {
      install: "https://geminicli.com/docs/get-started/",
      login: "https://geminicli.com/docs/get-started/authentication/",
      models: "https://geminicli.com/docs/reference/commands/",
    },
    login: { win32: "gemini", darwin: "gemini", linux: "gemini" },
    update: { win32: "gemini update", darwin: "gemini update", linux: "gemini update" },
    models: { win32: "gemini", darwin: "gemini", linux: "gemini" },
    install: { win32: "npm install -g @google/gemini-cli", darwin: "npm install -g @google/gemini-cli", linux: "npm install -g @google/gemini-cli" },
    loginHint: "gemini   then choose Google sign-in (use /auth to change authentication)",
    installHint: "npm install -g @google/gemini-cli",
    loginNote: "Choose Google sign-in when Gemini opens. Account eligibility is confirmed by live verification.",
    modelsNote: "When Gemini opens, type /model manage to view models available to this account.",
    optional: true,
  },
});

export const PROVIDER_IDS = Object.freeze(Object.keys(PROVIDER_MANIFEST));
export const GOVERNOR_IDS = Object.freeze([...PROVIDER_IDS, "other"]);
export const DEFAULT_REVIEWERS = Object.freeze(["codex", "claude", "antigravity", "copilot", "grok"]);
export const LOGIN_HINTS = Object.freeze(Object.fromEntries(PROVIDER_IDS.map((id) => [id, PROVIDER_MANIFEST[id].loginHint])));
export const INSTALL_HINTS = Object.freeze(Object.fromEntries(PROVIDER_IDS.map((id) => [id, PROVIDER_MANIFEST[id].installHint])));
