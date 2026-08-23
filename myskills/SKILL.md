---
name: myskills
description: Run the four canonical skill families from any harness and report functional health separately from dependency readiness — momm (multi-model peer review), myrepo (GitHub publishing), promptus-clone-voice/myvoice (consented local voice cloning), and yorkshire-pudding/yorky (Yorkshire dialect). Use when the user says "myskills", asks to check, verify, test, or list these skills, asks whether they are working, or wants the review → voice → publish flow. Reports aliases and versions without treating either as proof of health.
---

# myskills — test the four skill families

One entry point that exercises each canonical family and reports both code health and the local dependencies needed to use it. A skill is reported working only when **its own check passes** — never because its folder exists or its version is current.

## Run it

```text
node scripts/run-all.mjs --pretty
```

- **`--pretty`** — human-readable JSON on stdout; a per-skill summary always prints to stderr.
- **`--quick`** — keep deterministic safety checks, skip live-dependency probes, and report skipped families or dependencies as `not_checked`; it never turns unknown readiness green.
- **`--flow`** — print how the skills compose, without running anything.
- Exit code is **1** when a functional check is missing, failing, or errored. Dependency-only attention, such as a missing engine or GitHub sign-in, is reported separately and does not falsely turn a passing safety test into a code failure.

Relay the per-skill lines to the user, including aliases, versions, dependency states, and any `unavailable` engine (for example, Promptus not installed). Never summarize `code_health: passing` as “everything is ready” when `dependency_readiness` still needs attention.

## Canonical families and aliases

myskills 1.1.0 returns four functional records:

- `momm`
- `myrepo`
- `yorkshire-pudding`, also invoked as `yorky`
- `promptus-clone-voice`, also invoked as `myvoice`

An alias belongs on its canonical record; it is not another installed skill or another health check. `myskills_version` identifies the orchestrator itself and does not create a fifth functional family.

## What it checks

| Skill | Called as | Proof required |
|---|---|---|
| momm | `momm` | every bundled deterministic `--self-test` check passes |
| myrepo | `myrepo` | zero-network `--self-test` privacy + secret gates pass; `gh_cli` and `gh_auth` readiness reported separately |
| yorkshire-pudding | `yorky` | self-tests pass **and** a live translation is verified |
| promptus-clone-voice | `myvoice` | Promptus services (ComfyUI, Cosy, CWorker) report ready |

## Read the report

- `code_health` summarizes functional checks. It is `failing` only when a canonical family's own proof is missing, failing, or errored.
- `dependency_readiness` is `attention` when a required local engine, CLI, or account session is unavailable, and `not_checked` when `--quick` deliberately skips those probes.
- Each `skills[]` record carries one canonical `skill`, its `aliases`, functional `status`, explanatory `detail`, and any detected `version`.
- myrepo additionally reports `dependencies.gh_cli` as `ready` or `missing`, and `dependencies.gh_auth` as `ready`, `login_required`, or `not_checked` when the CLI is absent.

Version state and functional health answer different questions. A current version can still fail its self-test or lack a required engine; a local version can be newer than the published manifest and still pass. Do not group “current,” “update available,” or “local newer” as health verdicts, and do not relabel an unavailable version check as “up to date.”

## How they compose

1. **momm** — review it. Reproduce every finding before fixing; record dispositions.
2. **myvoice** — voice it, with consent and a recorded human listening verdict.
3. **myrepo** — publish it, after confirming repo name and visibility with the user.
4. **yorky** — flavour any prose, never touching identifiers, keys, URLs, or logic.

Each skill keeps its own protocol and safety gates; `myskills` orchestrates and verifies, it never bypasses them. Install everything with `node install.mjs --target all` from the repo root.
