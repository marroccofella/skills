# MOMM 1.16.1 lifecycle drills

This branch exists only to run the signed lifecycle drills. It is never merged into `main` or the
sealed release branch, so the 1.16.1 seal (`3002fd7`, `2e19b3ae…aad617`) is untouched.

## Owner decision: GitHub-hosted runners (27 September 2026)

The 1.16.1 gate record (sealed at `3002fd7`) asks for signed lifecycle drills on Windows, macOS and
Linux, Node 18 and Node 24, run on "authorized native machines". The owner's only machine is Windows.
The owner decided to run all six cells on GitHub's hosted runners (`windows-latest`, `macos-latest`,
`ubuntu-latest`): real installs of each operating system, not emulation. Their results are recorded as
**GitHub-hosted runner** results, never as the owner's own machines. The decision and the receipts go
into the gate record in the commit after publication, because the sealed tree cannot change.

## What a drill does

`scripts/momm-lifecycle-drill.mjs`, in disposable user profiles and against real signed tags verified
with gitsign 0.17.1 (no mocks, no self-signing, no bypass): fresh signed install with the sealed package
hash checked; signed installs of older releases; upgrade, rollback and re-upgrade; refusal of a tampered
unsigned payload with the installation left unchanged. Each run writes a JSON receipt and its SHA-256,
kept as a workflow artifact.

## Runs

1. **Rehearsal** (`drills/target.json` = published `momm-1.16.0`, from `momm-1.15.1`): proves the
   machinery on all six cells. It is not the 1.16.1 gate.
2. **The gate** (after the owner merges PR #18 and runs the signed `main-checkpoint`): `target.json`
   names the checkpoint commit, `expect` 1.16.1, from `momm-1.16.0` and `momm-1.15.1`. All six cells must
   pass before the stable release.
