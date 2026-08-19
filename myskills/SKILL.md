---
name: myskills
description: Run every installed skill together from any harness and confirm each one actually works — momm (multi-model peer review), myvoice/promptus-clone-voice (consented local voice cloning), myrepo (publish to GitHub with a live page), and yorky/yorkshire-pudding (Yorkshire dialect). Use when the user says "myskills", asks to check, verify, test, or list their skills, asks what skills are available or whether they are working, or wants the review → voice → publish flow. Reports a single verdict with versions and live dependency status.
---

# myskills — run them all, confirm they work

One entry point that exercises every skill for real and returns a single verdict. A skill is reported working only when **its own check passes** — never because its folder exists.

## Run it

```text
node scripts/run-all.mjs --pretty
```

- **`--pretty`** — human-readable JSON on stdout; a per-skill summary always prints to stderr.
- **`--quick`** — skip slow live-dependency probes (Promptus services, `gh auth`, publisher dry-run).
- **`--flow`** — print how the skills compose, without running anything.
- Exit code is **0 when every skill is working**, **1 if any is missing, failing, or errored**, so a harness can gate on it.

Relay the per-skill lines to the user, including versions and any `unavailable` engine (e.g. Promptus not running) — those are statuses, not failures of the skill itself.

## What it checks

| Skill | Called as | Proof required |
|---|---|---|
| momm | `momm` | `--self-test` passes (35 deterministic checks) |
| myrepo | `myrepo` | `--dry-run` privacy + secret gates pass; `gh auth` state reported |
| yorkshire-pudding | `yorky` | self-tests pass **and** a live translation is verified |
| promptus-clone-voice | `myvoice` | Promptus services (ComfyUI, Cosy, CWorker) report ready |

## How they compose

1. **momm** — review it. Reproduce every finding before fixing; record dispositions.
2. **myvoice** — voice it, with consent and a recorded human listening verdict.
3. **myrepo** — publish it, after confirming repo name and visibility with the user.
4. **yorky** — flavour any prose, never touching identifiers, keys, URLs, or logic.

Each skill keeps its own protocol and safety gates; `myskills` orchestrates and verifies, it never bypasses them. Install everything with `node install.mjs --target all` from the repo root.
