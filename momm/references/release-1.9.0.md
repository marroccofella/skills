# MOMM 1.9.0 — guided setup and maintenance

Released 2026-08-23.

MOMM 1.9.0 turns first-run setup from a collection of terminal checks into a local, task-oriented Setup Center. The current coding agent remains the sole controller and writer; external CLIs remain untrusted, read-only reviewers.

## What changed

### Local Setup Center

- Added a browser-based Setup Center served only on `127.0.0.1`.
- Added a separate **Controller** selector so the active driver is never presented as part of its own peer-review pool.
- Consolidated CLI installation/version, account-session evidence, model access, and the next action into one provider card for Claude Code, Antigravity, GitHub Copilot, and Grok.
- Added a real completion indicator with non-overlapping counts for installations, sign-ins, detected sessions awaiting verification, and provider CLI updates.
- Added **Quick Setup**, which refreshes local state and verifies detected sessions sequentially using harmless synthetic text. It never launches interactive OAuth automatically.
- Kept provider installation, sign-in, and updates as explicit, visible user actions.

### Skills and diagnostics

- Added read-only checks for local versus published skill versions.
- Grouped skills into **Update available**, **Modified locally**, and **Up to date**.
- Added **Review diff** and **Commit…** terminal handoffs for local changes. These handoffs never stage or commit files automatically.
- Blocked automatic skill pulls whenever the repository has uncommitted changes; clean updates use `git pull --ff-only`.
- Added provider-native CLI update checks and model-access reporting.
- Reduced runtime noise to a one-line health summary and a collapsed diagnostics panel. Environment checks report relevant variable names only, never values.

### Guided onboarding

- Added `scripts/onboard.mjs` as a zero-model-call terminal fallback for headless environments.
- Added a first-run walkthrough with exact setup states, recovery actions, rollout guidance, and source-sharing boundaries.
- Updated harness compatibility notes for the locally verified Claude Code, Antigravity, Copilot, and Grok CLI surfaces.

## Trust boundaries

- Setup and maintenance never read credential contents, passwords, API-key values, or environment-variable values.
- MOMM remains OAuth/account-session only. Known API-key variables are stripped from reviewer processes.
- Setup sends no repository or project content. Optional connection verification sends only disclosed synthetic text.
- A real peer review does send the user-selected diff or input to the chosen provider. The user must confirm that source may be shared before dispatch.
- The controller remains the only writer and must reproduce material findings before applying changes.
- Reviewers cannot commit, edit the working tree, or authorize their own findings.

## Deliberately not automated

- Completing browser OAuth or handling credentials.
- Opening multiple interactive sign-in flows from Quick Setup.
- Staging or committing local skill changes.
- Pulling over a dirty working tree.
- Installing or updating provider software without a visible user confirmation.

## Verification

The release adds CI coverage for guided onboarding and the Setup Center safety contract. Before publication it passed:

- Setup Center syntax and deterministic self-tests;
- MOMM dispatcher deterministic self-tests;
- zero-call onboarding and input-safety checks;
- official Agent Skill structure validation;
- live loopback HTTP, maintenance API, and CSRF-protected action checks;
- the dirty-repository update guard; and
- `git diff --check`.

Start the graphical flow with:

```text
node momm/scripts/setup-ui.mjs
```

For a terminal-only first run:

```text
node momm/scripts/onboard.mjs --governor codex
```
