# skills

![CI](https://github.com/marroccofella/skills/actions/workflows/self-test.yml/badge.svg)
![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Auth](https://img.shields.io/badge/auth-OAuth%20only%20%C2%B7%20zero%20API%20keys-orange)

A collection of portable, cross-harness [Agent Skills](https://agentskills.io) — each skill is a top-level folder with a standards-compliant `SKILL.md`, installable into any compatible AI coding harness (Claude Code, OpenAI Codex, Google Antigravity, Gemini CLI, and others). More skills coming; contributions welcome per [CONTRIBUTING.md](CONTRIBUTING.md).

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

### What this is not

This is **not** a multi-agent coding system. Reviewers never write code, run your tests, or touch your files — the agent you are talking to remains the only writer, and it must reproduce any finding with a failing test before acting on it. Reviewer output is treated as untrusted data throughout.

### Quick start

```bash
# 1. Link the skill into your user-level skills directory
#    (junctions on Windows, symlinks on Linux/macOS — install.mjs handles both)
node multi-llm-review/scripts/install.mjs --target all

# 2. Check which reviewer CLIs are installed and authenticated (no model calls)
node multi-llm-review/scripts/multi-review.mjs --doctor --pretty

# 3. Review your current changes (replace "claude" with your driving agent)
git diff HEAD | node multi-llm-review/scripts/multi-review.mjs --governor claude --pretty
```

Or, inside any harness that supports Agent Skills, simply ask:

> Use $multi-llm-review to review my current changes.

Harness discovery in one line: Codex reads `~/.agents/skills`, Claude Code reads `~/.claude/skills`, and Gemini/Antigravity use their native `skills link` command — `install.mjs --target all` covers the lot.

See [multi-llm-review/SKILL.md](multi-llm-review/SKILL.md) for the full protocol, [references/invocation-prompts.md](multi-llm-review/references/invocation-prompts.md) for paste-ready prompts, and [references/harness-compatibility.md](multi-llm-review/references/harness-compatibility.md) for per-harness discovery details.

<details>
<summary><b>Example report</b> (real run: Codex governing, Claude + Antigravity reviewing a small Python diff)</summary>

```json
{
  "policy": "oauth-only",
  "run_id": "rev_20260816_xxxx",
  "governor": "codex",
  "reviewers": [
    { "agent": "codex", "status": "self_excluded" },
    { "agent": "claude", "status": "success", "verdict": "MODIFY", "confidence": 0.9 },
    { "agent": "antigravity", "status": "success", "verdict": "MODIFY", "confidence": 1 }
  ],
  "findings": [
    {
      "id": "zero-division-empty-items",
      "severity": "CRITICAL",
      "target_file": "calc.py",
      "issue": "The average function raises a ZeroDivisionError when called with an empty collection.",
      "test_suggestion": "Call average([]) and verify it raises ValueError rather than ZeroDivisionError.",
      "sources": ["antigravity"]
    },
    {
      "id": "average-consumes-generator",
      "severity": "NITPICK",
      "target_file": "calc.py",
      "issue": "average() calls sum() then len(), so generator input is exhausted and fails with TypeError.",
      "sources": ["claude"]
    }
  ],
  "consensus": { "corroborated": [], "single_source": ["zero-division-empty-items", "average-consumes-generator"] },
  "decision_rule": "Consensus prioritizes investigation; the governor must reproduce and verify before editing."
}
```

The governor then reproduces each finding with a failing test, fixes what proves real, and records an explicit apply/reject disposition for every reviewer suggestion.

</details>

### Requirements

- Node.js 18+ (the dispatcher is a single zero-dependency script)
- At least one reviewer CLI installed and logged in via its official OAuth flow:
  - [Codex CLI](https://developers.openai.com/codex/cli) — `codex login` (ChatGPT account)
  - [Claude Code](https://claude.com/claude-code) — `claude /login` (Anthropic account)
  - [Antigravity CLI](https://antigravity.google/docs/cli/install) — `agy` (Google account)

`demo/stats.py` at the repo root is a deliberately imperfect fixture used for live-testing the ensemble.

## License

MIT — see individual skill folders for details.
