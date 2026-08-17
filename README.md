# skills

A collection of portable, cross-harness [Agent Skills](https://agentskills.io) — each skill is a top-level folder with a standards-compliant `SKILL.md`, installable into any compatible AI coding harness (Claude Code, OpenAI Codex, Google Antigravity, Gemini CLI, and others).

| Skill | What it does |
|-------|--------------|
| [multi-llm-review](multi-llm-review/) | OAuth-only multi-model peer code review: dispatches a git diff to the *other* installed LLM CLIs in parallel and returns structured, deduplicated findings — while the driving agent stays the sole writer. |

## multi-llm-review

Have every frontier model on your machine review your code, using only the subscriptions you already pay for — zero API keys, ever.

```
              ┌────────────────────────────┐
 your change  │  governor (the agent you   │   applies only fixes it
 ────────────▶│  are talking to — writes,  │◀── verifies itself, after
              │  tests, commits)           │    reproducing findings
              └─────────────┬──────────────┘
                            │ dispatches diff (read-only)
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
          Codex CLI    Claude Code     Antigravity
         (ChatGPT      (Anthropic      (Google
          OAuth)        OAuth)          OAuth)
```

### Design principles

- **OAuth-only, fail-closed.** Every known API-key environment variable is stripped from reviewer subprocesses. A reviewer that isn't logged in returns `authentication_required`; there is no fallback path.
- **Governor is the sole writer.** Reviewers are untrusted, read-only diagnostic tools. Their output is evidence, never instructions.
- **Reproduction gate.** No finding is acted on by consensus or authority — the governor must reproduce it with a failing test before authoring a fix.
- **Every voice heard, none obeyed blindly.** Reviewer improvement suggestions get an explicit apply/reject disposition, logged to `.ensemble_reviews/dispositions.jsonl` with the run's `run_id`.
- **Termination-proof dispatcher.** Layered Windows/Unix process-tree cleanup (tree kill → child-kill backstop → hard deadline → explicit exit) guarantees the dispatcher always returns a structured report, even in kill-restricted sandboxes.

### Quick start

```bash
# 1. Link the skill into your user-level skills directory (Windows)
node multi-llm-review/scripts/install.mjs --target all

# 2. Check which reviewer CLIs are installed and authenticated (no model calls)
node multi-llm-review/scripts/multi-review.mjs --doctor --pretty

# 3. Review your current changes (replace "claude" with your driving agent)
git diff HEAD | node multi-llm-review/scripts/multi-review.mjs --governor claude --pretty
```

Or, inside any harness that supports Agent Skills, simply ask:

> Use $multi-llm-review to review my current changes.

See [multi-llm-review/SKILL.md](multi-llm-review/SKILL.md) for the full protocol, [references/invocation-prompts.md](multi-llm-review/references/invocation-prompts.md) for paste-ready prompts, and [references/harness-compatibility.md](multi-llm-review/references/harness-compatibility.md) for per-harness discovery details.

### Requirements

- Node.js 18+ (the dispatcher is a single zero-dependency script)
- At least one reviewer CLI installed and logged in via its official OAuth flow:
  - [Codex CLI](https://developers.openai.com/codex/cli) — `codex login` (ChatGPT account)
  - [Claude Code](https://claude.com/claude-code) — `claude /login` (Anthropic account)
  - [Antigravity CLI](https://antigravity.google/docs/cli/install) — `agy` (Google account)

`demo/stats.py` at the repo root is a deliberately imperfect fixture used for live-testing the ensemble.

## License

MIT — see individual skill folders for details.
