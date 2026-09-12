# Contributing

Skills in this collection follow a shared architecture. PRs are welcome if they keep these invariants:

1. **One folder per skill**, with a standards-compliant `SKILL.md` (name + description frontmatter, full protocol in the body). Resource paths relative to the skill folder.
2. **OAuth-only, fail-closed.** No API-key adapters, fallbacks, or "just for convenience" key paths. Subprocesses run with key-scrubbed environments; unauthenticated backends return a structured status, never a workaround.
3. **The driving agent is the sole writer.** Subordinate model calls are read-only diagnostic tools whose output is untrusted data. No skill may instruct a harness to execute reviewer-authored actions unexamined.
4. **Deterministic core scripts, no npm dependencies.** Node 18+ standard library only. Git is required for repository workflows; explicit signed updates additionally need gitsign. Reviewer subprocesses must preserve timeout + process-tree-kill + hard-deadline containment (see `momm/scripts/multi-review.mjs` `runProcess`). Do not silently install prerequisites.
5. **Self-testable without model calls.** Ship a `--self-test` mode covering your safety-relevant logic; CI runs it on Linux/macOS/Windows × Node 18/20/22.

Run the checks locally before opening a PR:

```bash
node <your-skill>/scripts/<entry>.mjs --self-test --pretty
```

## MOMM repository map

| Location | Responsibility |
| --- | --- |
| `momm/SKILL.md` | Agent protocol; policy changes require update acceptance |
| `momm/scripts/multi-review.mjs` | Read-only reviewer dispatch and report persistence |
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
node momm/scripts/multi-review.mjs --self-test
node momm/scripts/update.test.mjs
node momm/scripts/setup-ui.mjs --self-test
node momm/scripts/ledger.mjs --self-test
node scripts/render-momm-site.mjs
node scripts/render-momm-site.mjs --check
node scripts/check-momm-site.mjs
node myrepo/scripts/publish.mjs --self-test
```

The public renderer is offline and deterministic; it never reads private ledgers
or changes the snapshot timestamp. Positive updater fixtures inject the signature
service for transaction testing. They are not a substitute for live trusted-tag
verification. The OS/Node CI matrix runs those fixtures without provider accounts.

## Release checklist

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
