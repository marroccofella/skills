# Contributing

Skills in this collection follow a shared architecture. PRs are welcome if they keep these invariants:

1. **One folder per skill**, with a standards-compliant `SKILL.md` (name + description frontmatter, full protocol in the body). Resource paths relative to the skill folder.
2. **OAuth-only, fail-closed.** No API-key adapters, fallbacks, or "just for convenience" key paths. Subprocesses run with key-scrubbed environments; unauthenticated backends return a structured status, never a workaround.
3. **The driving agent is the sole writer.** Subordinate model calls are read-only diagnostic tools whose output is untrusted data. No skill may instruct a harness to execute reviewer-authored actions unexamined.
4. **Deterministic core scripts, no npm dependencies.** Node 18+ standard library only. Git is required for repository workflows; explicit signed updates additionally need gitsign. Reviewer subprocesses must preserve timeout + process-tree-kill + hard-deadline containment (see `momm/scripts/multi-review.mjs` `runProcess`). Do not silently install prerequisites.
5. **Self-testable without model calls.** Ship a `--self-test` mode covering your safety-relevant logic; CI requests Linux/macOS/Windows × Node 18/20/22/24 plus Windows 24.15.0 and 24.19.0. Node 22/24 are primary targets; 18/20 are legacy compatibility checks. Configured jobs are not lifecycle proof.

Run the checks locally before opening a PR:

```bash
node <your-skill>/scripts/<entry>.mjs --self-test --pretty
```

## MOMM repository map

| Location | Responsibility |
| --- | --- |
| `momm/SKILL.md` | Agent protocol; policy changes require update acceptance |
| `momm/scripts/multi-review.mjs` | Read-only reviewer dispatch and report persistence |
| `momm/scripts/transport.test.mjs` | Real pipe, deadline, malformed-output and isolated Windows launcher fixtures |
| `momm/scripts/review-contract.mjs` | Completed reply/schema and quoted-scope validation |
| `momm/scripts/governor.mjs`, `governor.test.mjs` | Offline decision/evidence validation and controlled lifecycle tests |
| `momm/scripts/update.mjs` | Explicit update transaction, receipts and retained recovery runner |
| `momm/scripts/update.test.mjs` | Offline, disposable-Git transaction/failure fixtures |
| `momm/scripts/setup-ui.mjs`, `momm/assets/setup-ui/` | Local setup, guided provider actions and update preview |
| `momm/scripts/ledger.mjs` | User's private project ledger, never public by default |
| `docs/evidence/momm-evidence.json` | Deliberately sanitized public development snapshot |
| `scripts/render-momm-site.mjs` | Source of all five information pages, statistics and data tables |
| `docs/momm/site.css`, `site.js` | Shared public theme and progressive enhancements |
| `export-public-evidence.mjs` | Explicit private-to-public import; refuses malformed/conflicting records |
| `scripts/momm-release.mjs` | Canonical package seal and release consistency checks |

Do not hand-edit generated HTML, tables, public-report hashes or CSVs. Change the
renderer or the deliberately approved source snapshot, then regenerate:

```text
node scripts/render-momm-site.mjs
node scripts/render-momm-site.mjs --check
node scripts/check-momm-site.mjs
node scripts/doc-consistency.test.mjs
```

### Run every check, not a list that goes stale

The commands above cover the public pages only. **Before you push, run everything CI runs.**
There are two authoritative sources, and no third list is kept by hand:

- `.github/workflows/self-test.yml` is the authoritative selection. Every `node ...` line in its
  steps is a required check, on Linux, macOS and Windows across Node 18 to 24.
- `momm/references/test-catalog-1.16.1.md` is the complete source inventory and says what each
  suite covers. `momm/scripts/review-workflow.test.mjs` fails if a suite is missing from it, so a
  new `*.test.mjs` file cannot be added without being described.

A hand-written verification list in this file is how the 1.16.0 gate found sixty-five suites
unreachable by a contributor following the documentation. If you add a suite, add it to the
workflow and the catalogue; do not paste it here.

The public renderer is offline and deterministic; it never reads private ledgers
or changes the snapshot timestamp. Positive updater fixtures inject the signature
service for transaction testing. They are not a substitute for live trusted-tag
verification. The OS/Node CI matrix runs those fixtures without provider accounts.

## Release checklist

The [1.16.1 test catalog](momm/references/test-catalog-1.16.1.md) names every MOMM and
repository test suite. The safety workflow lists the selected commands and inline fixtures.
Run each command with its own checked exit code: a later success must never mask a failure.
New patch gates include byte-based media validation, expiry, immutable attempts/tool-produced
checks, installation completion, and PATH-resolution refusals. Exact native-machine and
signed-lifecycle results belong in the [gate record](momm/references/gates-1.16.1.md).

1. Work in an isolated branch. Preserve unrelated skills and concurrent edits.
2. Bump the dispatcher, manifest, README and release notes together. Regenerate
   pages; test links, mobile/desktop layout, keyboard focus and copy controls.
3. Run MOMM on a freshly generated diff with an explicit external-success quorum.
   Reproduce material claims and record every suggestion's disposition privately.
4. Run myrepo's offline safety tests and publication dry run. Scan publishable
   files and new Git history for secrets and machine-local paths. Show exact
   repository, visibility and publication scope; get the owner's approval.
5. Stage the intended files, then run `node scripts/momm-release.mjs --prepare`.
   This hashes the staged Git tree excluding the manifest itself. Stage the
   updated `versions.json`, commit, and run `node scripts/momm-release.mjs --check`.
6. Push the approved commit to main and wait for the full safety matrix. Dispatch
   `MOMM signed release` explicitly with the exact version. The workflow rechecks
   tests, hashes and the successful CI commit before signing immutable tags using
   GitHub OIDC. It refuses to replace an existing tag; a retry may reuse an
   existing tag only after verifying the exact commit and trusted signature.
7. Verify the published tag through the actual gitsign verifier and the public
   manifest; check the live pages. Only then call the version released. Do not
   rewrite legacy unsigned tags or describe the initial clone as signature-verified.

The signed development checkpoint is opt-in too: the release workflow signs
`momm-main-<commit>` alongside the stable tag, or independently when a maintainer
explicitly selects `main-checkpoint` mode. An unsealed development head is not
installable through the main channel. No background user-side installation exists.
