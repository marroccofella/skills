# MOMM 1.15.1 — signed updater staging correction

This patch retains the [1.15.0 improvements](release-1.15.0.md) and corrects an
updater defect found by the fresh GitHub installation test after publication.
The original signed 1.15.0 tag is unchanged.

## What failed and what changed

The updater fetched signed objects into a bare Git repository. The pinned
gitsign 0.17.1 verifier could not discover that repository and returned
`repository does not exist`. It failed closed before changing the installation.

Staging now uses a normal empty repository with a `.git` directory. Candidate
files are still not checked out or executed before signature and package-hash
verification. No signature, source-sharing or protocol-consent gate is relaxed.

## Verification

- A real signed-tag comparison reproduced the bare-repository failure and passed
  with normal empty staging using the same tag, verifier and trust policy.
- The offline updater suite checks repository discovery and verifies no candidate
  files exist outside `.git` when the signature gate runs.
- Stable publication now runs a genuine signed preview and apply, using the
  actual verifier, in an isolated installation before pushing the release tags.
  The release record and workflow must succeed before these notes prove a release.

## Upgrading from 1.15.0

The old updater cannot repair itself because its signature-preview step fails.
Use the [installation and upgrade prompt](https://marroccofella.github.io/skills/momm/releases/upgrade.html)
for an explicitly approved bootstrap: fetch the latest signed tag into a separate
normal clone, verify its signature and package hash before executing its code,
then invoke that verified updater with `--repo` pointing at the existing clean
skills clone. Preview the saved harness scopes and policy diff, then explicitly
apply. Preserve logins, other skills and private ledgers. Never fall back to an
unsigned checkout, rewrite the old tag, or claim matching version strings prove
matching installed files.
