# MOMM 1.17 — independent reviewer pack

**Candidate testing, not a release approval.** 1.17 is not released until the signed tag `momm-1.17.0`
exists. Test the exact commit you are given, report honestly, and never turn a result green by
leaving a check out.

- Repository: https://github.com/marroccofella/skills
- Candidate pull request: named in your invitation (the `release/momm-1.17` branch).
- Feedback: the "MOMM 1.17 candidate testing" discussion linked from
  https://github.com/marroccofella/skills/discussions.
- The plan you are testing against: `momm/references/plan-1.17.md` at the pinned commit.

## 1. Pin the exact commit

Use the full 40-character commit in your invitation. Replace `<PINNED_SHA>` below with it. If you were
given no full commit, stop and ask; never test a moving branch.

```text
git clone https://github.com/marroccofella/skills momm-117-review
cd momm-117-review
git checkout --detach <PINNED_SHA>
git rev-parse HEAD
git status --porcelain
node --version
git --version
```

`HEAD` must print exactly the pinned commit and `status` must print nothing. On the sealed candidate the
dispatcher declares `1.17.0` (`node momm/scripts/multi-review.mjs --version`) and
`node scripts/momm-release.mjs --check` passes. Record your operating system
and version, CPU architecture, Node and Git versions, the harness you are using (Claude Code, Codex,
Copilot, and so on) and the UTC time. Node 18, 20, 22 and 24 are all tested in CI; please say which you used.

## 2. Safety rules for testing

- Your current harness is the governor and the only writer. It never sends its own work to itself as a
  reviewer.
- Account logins only. Never use an API key, read a credential file, or work around a quota.
- Do not install this candidate over a MOMM you use for real work. Test it from the clone above.
- Do not turn on automatic updates, run `evidence --protect` on a real project, change discovery links,
  merge, sign, tag or publish anything.
- Sections 3 and 4 make no provider calls. Section 5 does, and uses your own allowance on each route
  you choose; it is optional.

## 3. Automated checks (offline, about 30 to 60 minutes)

From the clone:

```text
node scripts/run-ci-suites.mjs
```

It runs every suite the CI workflow runs, prints `PASS` or `FAIL` for each with its time, and ends with
"N of N suites passed". Report the last line and any `FAIL` lines with their output. To re-run a subset:
`node scripts/run-ci-suites.mjs --grep split`.

Also run the dispatcher's own self-test and the Setup Center self-test:

```text
node momm/scripts/multi-review.mjs --self-test
node momm/scripts/setup-ui.mjs --self-test
```

On macOS and Linux, the security suites include real-filesystem tests that cannot run on Windows (a
program planted inside a project must never be launched). Please say whether you ran them on a Unix
machine; that coverage is the most useful thing a macOS or Linux reviewer can add.

## 4. What changed, and how to check each item

Each row names what to look at and the test that proves it. "Read" means inspect the code or document at
the pinned commit; the tests already ran in section 3.

| Item | What should now be true | Where it is proven |
| --- | --- | --- |
| A1 | On macOS and Linux a reviewer CLI or Git found only inside the reviewed project is reported as not installed, never launched; the child PATH has no project entries. The updater, direct probe runs and the Setup Center's terminal and browser helpers follow the same rule. | `process-scope.test.mjs`, `executable-resolution.test.mjs`, `update.test.mjs`, `probes.test.mjs` |
| A2 | Codex runs with `--ignore-user-config --ignore-rules`; your model and effort are read from your Codex settings (read-only) and passed explicitly; your MCP servers and global instructions are no longer loaded. | `codex-isolation.test.mjs`, `adapter-cleanup.test.mjs`; live check in section 5 |
| A3 | In an image review, a reviewer may cite what it saw by the attachment's sha256 and a pixel region; a wrong digest or a region outside the image is refused. | `scripts/momm-media-contract.test.mjs` |
| A4 | Splitting never separates removed lines from the lines that replace them; a split run with Grok caps pieces at 20 KB; Grok reviews stream, so a timeout still records what arrived; a rejected quote keeps a short private diagnostic; a quote copied from one side of one diff hunk without the line markers counts, and one that mixes sides or hunks does not. | `split.test.mjs`, `grok-stream.test.mjs`, `quotation-diagnostics.test.mjs`, `adapter-cleanup.test.mjs` |
| A5 | Reports show real reviewer versions instead of "timeout": preflight finishes before reviews start. | `attachment-cleanup.test.mjs` |
| A6 | An upgrade killed mid-transaction can be recovered. After a crash, the stale claim is released with `update.mjs --release-claim <token>` (the refusal message prints it) and then `--rollback --yes`. | `update.test.mjs`, `update-claim.test.mjs`; the lifecycle drills (section 6) |
| A7 | `MOMM_EVIDENCE_HOME` (or `--evidence-home`) keeps a project's evidence under your own profile, one hashed folder per project, with the same privacy check; a location inside the project is refused. | `evidence-location.test.mjs` |
| A8 | A `.reviewrules` file that arrives with a clone is ignored until you trust its exact hash; a changed file needs trusting again. | `guidance.test.mjs` |
| A9 | A capability probe is tied to the exact command that earned it. A 1.17 success on a command that changed since 1.16.1 is stored so 1.16.1 cannot use it. | `capabilities.test.mjs`, `probes.test.mjs` |
| A10 | Grok runs isolated from your Claude Code and Cursor setup for reviews, probes and picture generation alike. | `modality.test.mjs`, `adapter-cleanup.test.mjs` |
| B1, C1 | Reviewer roles are versioned files under `momm/roles/` with a review date; the report records each role's version and hash; only the adversary role carries the loophole checklist. | `roles.test.mjs` |
| B2 | Findings may carry a claim type (`DEFECT`, `RISK`, `QUESTION`, `IDEA`, `NOISE`); a merge keeps the most blocking type; a `CRITICAL` or `WARNING` needs reproduction whatever its type. | `governor.test.mjs` |
| B3, C2 | With `--cover`, a failed role is covered by another requested route, never after a login or quota failure; at most two attempts per piece and role; a cover never counts twice for one model family. A property test drives every short sequence of retries, covers and splits. | `cover.test.mjs`, `invariants.test.mjs` |
| B4 | A decision marked `style` is checked against the bytes (a commented-out line, a tool directive, a Python reindent is not style); mutation records are optional and reported; the validator says whether a review is stale. | `governor.test.mjs`, `review-claims.test.mjs` |
| B5 | `--second-look <run> --finding <id>` asks one route that was not a source to confirm or refute one claim; the original report never changes. | `second-look.test.mjs` |
| B6 | The scorecard shows a roster per route and role, labelled as this project's decisions, not a benchmark. | `scorecard.test.mjs`, `scorecard-roster.test.mjs` |
| E | `generation-rounds.mjs` runs consented picture rounds: a costed question each round, the user's words sent unchanged, blind critique saved before labels are revealed, and a local gallery. The ledger shows generated pictures only while their bytes match. | `generation-rounds.test.mjs`, `scripts/ledger-media.test.mjs` |

If a row's suite does not exist at the pinned commit, report that as a finding: the item is not done.

## 5. Optional live checks (uses your allowance)

Use a throwaway folder with made-up content, never real code. Run each command from that folder, with
`<clone>` replaced by the absolute path of your clone.

1. **Reviewer readiness:** `node "<clone>/momm/scripts/multi-review.mjs" --preflight --governor <your harness>`.
   Every route you have installed should show a real version.
2. **A small review:** put a two-line synthetic diff in `demo.diff` and run
   `node "<clone>/momm/scripts/multi-review.mjs" --governor <your harness> --input demo.diff --min-success 2 --stream`.
   Report each route's status. Then try `--cover` and, for one finding, `--second-look <run_id> --finding <id>`.
3. **Guided pictures (only if a route can generate images on your account):**
   `node "<clone>/momm/scripts/generation-rounds.mjs" start --prompt "A red bicycle leaning on a blue door"`,
   then follow the printed steps. Report whether each question named the routes and picture count before
   anything was sent.

Report exactly what was sent and to which routes. Never paste credentials, private code or full reviewer
replies into the discussion.

## 6. Lifecycle

Install, upgrade, rollback, re-upgrade, tamper refusal and interrupted-upgrade recovery run on GitHub's
hosted Windows, macOS and Linux runners, on Node 18 and 24, against the signed development checkpoint of
the candidate. The drill tool lives on the never-merged branch `drills/momm-1.17`, not in the candidate.
If you have a spare machine and want to run it yourself, use a second clone, pinned like the first:

```text
git clone https://github.com/marroccofella/skills momm-117-drills
cd momm-117-drills
git checkout --detach <DRILL_SHA>
git rev-parse HEAD
git status --porcelain
node scripts/momm-lifecycle-drill.mjs --checkpoint <CHECKPOINT_SHA> --expect 1.17.0 --from momm-1.16.1,momm-1.16.0 --out drill-receipts
```

`<DRILL_SHA>` is the full 40-character commit of the drill tool on `drills/momm-1.17`, named in the
discussion next to the checkpoint. `HEAD` must print exactly that commit and `status` must print nothing
before you run the drill. If you were given no full drill commit, stop and ask; never run the drill from
the branch tip, which can move. `<CHECKPOINT_SHA>` is the commit of the signed development checkpoint
named in the discussion (it exists only after the candidate is merged and checkpointed). The drill works in disposable user profiles,
needs `gitsign`, and never touches your real MOMM.

## 7. How to report

Post one comment in the discussion using this outline. If you ran the lifecycle drill (section 6), fill in
`Drill commit: <DRILL_SHA>` with the exact commit `git rev-parse HEAD` printed in the drill clone.

```text
## MOMM 1.17 candidate review — <your name or handle> — READY | NOT READY | BLOCKED

Commit: <PINNED_SHA>   OS: <...>   Node: <...>   Harness: <...>   Time (UTC): <...>

Automated checks: <N of N suites passed> (list any FAIL)
Self-tests: dispatcher <pass|fail>, Setup Center <pass|fail>
Unix-only security tests run: yes | no
Items checked (section 4): <A1 ok, A2 ok, ...; anything missing>
Live checks (section 5, optional): <what you ran, which routes, results>
Drill commit: <DRILL_SHA, or "not run">   Checkpoint: <CHECKPOINT_SHA, or "not run">   Drill result: <...>

### DEFECT <n> — release-blocking | not blocking — <title>
What you did, what you expected, what happened, how to reproduce (commands), and the output.
```

Every defect is reproduced before it is fixed, and every fix gets a test. A new candidate gets a new
commit to pin; results never carry over silently.
