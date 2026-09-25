# ◆ MOMM — Mixture of Model Modality

One agent writes. Other installed AI CLIs challenge it. The driving agent verifies
material findings and records its decisions in your private project dashboard.

[Overview](https://marroccofella.github.io/skills/momm/) ·
[Get started](https://marroccofella.github.io/skills/momm/start.html) ·
[Update safely](https://marroccofella.github.io/skills/momm/updates.html) ·
[Public development evidence](https://marroccofella.github.io/skills/momm/evidence.html)

## Install only MOMM

```text
git clone https://github.com/marroccofella/skills.git
cd skills
node momm/scripts/install.mjs --target codex --dry-run
```

Inspect the preview. Only if you accept it, run:

```text
node momm/scripts/install.mjs --target codex
node momm/scripts/setup-ui.mjs
```

Choose your actual harness: `codex`, `claude`, `gemini` or `antigravity`. The root
installer installs the whole collection; this per-skill installer links only
MOMM. Git and Node 18+ are required for the update workflow. No credentials are copied.

Open the project to review in your agent, then ask:

> Use $momm to review my current changes. Keep this project as the working
> directory, reproduce material findings, record every suggestion's disposition,
> and show me the private ledger link.

MOMM sends sanitized input to the selected external providers via their CLI
account sessions. Redaction is not a confidentiality guarantee. One ready
external reviewer is enough to start; quotas and account restrictions still apply.

For release reviews, use `--tier deep` and an explicit success quorum. The default
base allowance is 180 seconds (deep: 240; Grok: 2x, capped at 360 unless `--timeout` is given); `--timeout` sets the base, and Grok
still gets 2x of it, uncapped.
`--stream` emits elapsed-time and byte-count updates without exposing reasoning.
A running process is not a completed review. `--effort medium` explicitly selects
the verified Claude/Grok effort setting; omission preserves provider defaults.
On Windows, native and official npm launchers run without shell interpretation;
an unsupported custom shim receives a specific explanation, not a login prompt.

## Explicit updates

```text
node momm/scripts/multi-review.mjs update
node momm/scripts/multi-review.mjs update --dry-run
```

After inspecting the plan and protocol diff, explicitly choose whether to apply:

```text
node momm/scripts/multi-review.mjs update --apply --accept-protocol
```

Check is information only. Preview verifies a staged signed release. Apply needs
your explicit choice; changed policy additionally needs `--accept-protocol`.
Nothing updates in the background. Read [the update and recovery contract](references/updating.md)
before the first update, including the gitsign prerequisite and legacy bootstrap.

## Read the contract

- [SKILL.md](SKILL.md): instructions the driving agent follows.
- [Getting started](references/getting-started.md): setup and exact statuses.
- [Harness compatibility](references/harness-compatibility.md): discovery paths.
- [Roadmap](ROADMAP.md): shipped work and remaining limitations.
- [Contributing](../CONTRIBUTING.md): offline checks, public rendering and release gates.

The reproduction gate is an agent protocol, not an automated proof of correctness.
Reviewers are read-only evidence sources. Votes and confidence never replace tests.

Part of the [42.uk](https://42.uk) universe. RELAX. IT'S ALREADY OVER.

[MIT licence](../LICENSE)
