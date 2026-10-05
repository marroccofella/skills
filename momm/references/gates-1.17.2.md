# 1.17.2 gate record — candidate, not released

This record names no current commit: a file cannot name its own commit. The candidate under test is
the head of the 1.17.2 pull request. The published release stays 1.17.1 until the signed tag
`momm-1.17.2` exists.

## Why this release exists

On 4 October 2026, the day 1.17.1 was released, an independent tester ran the official suite pack on
the released tag (Windows, Node 24.19) with `MOMM_EVIDENCE_HOME` set, the documented way to keep the
runner's saved report outside a checkout. The result was 74 of 97 suites passed, 23 failed, exit
status 1. The tester reported it as not ready within that test's scope, kept the original report, and
noted that one suite passed again with the variable removed. That result stands as the record for
1.17.1. On 5 October 2026 the owner instructed that the fix be completed and released as 1.17.2.

## The finding

- **Reproduced.** The maintainer's harness ran the same command on a fresh clone of the tag
  (Windows, Node 22.16) with the variable set to a fresh private folder: 74 of 97, exit status 1, the
  same 23 commands. With the variable unset the same clone gave 97 of 97.
- **Cause.** `scripts/run-ci-suites.mjs` handed its whole environment to every suite it started, and
  its `--evidence-home` option (new in 1.17.1) sets the same variable. The suites build fixture
  projects with an in-project `.ensemble_reviews`; the product, as designed, resolves evidence to the
  external home when the variable is set, did not find the fixture's evidence there, and 22 suites
  failed. `setup-ui.mjs --self-test` failed on two of its checks for the same reason, and
  `ledger.mjs --self-test`, which no suite runs, on two of its own.
- **Who was affected.** Anyone running the pack, a suite or one of those two self-tests with the
  variable set on 1.17.1. On 1.17.0 six commands were sampled on the tag (five suites and
  `setup-ui.mjs --self-test`): each passed with the variable unset and failed with it set. The whole
  1.17.0 pack was not run with the variable set, so this record gives no count for that release.
  Reviews with an evidence home were not affected; the dispatcher's self-test passed under it.
- **A second effect.** Six more suites passed under the variable while writing their fixtures'
  evidence into the caller's home. A pack run with a real evidence home therefore left one folder per
  fixture project there (58 in a scratch home during the baseline run).
- **Why the 1.17.1 gates missed it.** Every pre-release run of the pack, local and hosted, was made
  with the variable unset. The one mode the reviewer pack recommends for unreliable in-project storage
  was never run as a whole.

## The fix

- The runner removes `MOMM_EVIDENCE_HOME` from the environment it gives to suites, in every spelling
  of the name on Windows; its own report is saved where it was.
- `delete process.env.MOMM_EVIDENCE_HOME;` is the first statement after the imports in every suite.
  It is a statement in each suite and not something the shared test-support module does when it is
  imported, because `momm/scripts/ledger.mjs` imports that module and a real ledger build must not
  lose the user's setting.
- `setup-ui.mjs --self-test` and `ledger.mjs --self-test` drop the variable as they start. Each is
  reached only from its `--self-test` argument and the process ends afterwards.
- `scripts/source-hygiene.test.mjs` requires the statement, on a line of its own, in every tracked
  suite and every file the workflow runs, and reports any layout it cannot read.
- `scripts/evidence-home-isolation.test.mjs` starts a fixed set of suites by hand under an inherited
  evidence home, and with it unset as the control, on every hosted cell.

## Release gates

| Gate | Evidence required | Status |
| --- | --- | --- |
| 1. The pack in three ways on the sealed commit (nothing set; `MOMM_EVIDENCE_HOME` inherited; `--save-report --evidence-home`), the three self-tests with the variable set and unset, and the OS by Node matrix | Run output and job logs | named in the pull request |
| 2. Lifecycle drills on the signed checkpoint, upgrading from 1.17.1 and 1.17.0 | Six hosted cells | after the merge |
| 3. MOMM range reviews of every change, with completion receipts | Receipts | recorded below: four reviews, each with a complete receipt; what the last of them could not cover is said under it |
| 4. Privacy and history scan before every push | Scanner exit 0 | applied to every push |
| 5. Live review with every installed reviewer route valid | Report | see the reviews below, by route and piece |
| 6. Signed tag `momm-1.17.2` | Release workflow run | approved by the owner's instruction of 5 October 2026, if every gate above passes on the final sealed commit |

## Reviews

Gate 3 is met only when every range review of the 1.17.2 changes is listed here with a complete
receipt. Listed: the two reviews of the fix, the review of the release changes (version, records, the
new suite and its registration), and one last review of the changes that review led to and of the
entries this record had gained by then.

- `rev_20261004215722_98380aae661e` — the fix (two pieces). Piece 1: four valid reviews, one from each
  route (Codex, Antigravity, Copilot, Grok), each at the first attempt. Piece 2: three valid reviews,
  from Codex and Copilot at the first attempt and from Grok on its retry, after its first answer was
  refused because a quote did not match the diff. Antigravity gave no valid review of piece 2: its
  answer was refused on both attempts as not strict JSON. Quorum is two valid reviews of a piece, and
  it was met on both pieces. Verdicts by route: Codex ACCEPT, Copilot MODIFY, Grok MODIFY, and
  Antigravity ACCEPT, which rests on piece 1 alone. 4 WARNING and 1 NITPICK: one real and fixed, four
  shown not to hold. 16 suggestions ruled, five applied. Receipt complete.
  The real finding: the first version of the
  check that holds the isolation line could be passed by nine layouts in which a suite kept or
  restored the caller's home (code sharing a line with the end of a comment or of an import, code after
  the statement on its line, a comment ended by a bare CR or U+2028, the statement inside a second
  comment). No suite used any of them. The check now reads a comment or a plain import at a time and
  requires the statement alone on its line. Not real: that the self-tests should restore the variable
  (each process ends after its self-test, and a real ledger build still follows the caller's home);
  that the stand-in `process` of two sandboxed suites hides something they read; that the ledger
  change was missing from the range.
- `rev_20261004232657_33a8659f01ff` — the tightened check and the ledger scenario (one piece). Codex,
  Antigravity and Copilot ACCEPT, Grok MODIFY. All four routes returned a valid review at the first
  attempt. 1 WARNING and 1 NITPICK: none real, two shown not to hold. Eight suggestions ruled, none
  applied. Receipt complete. The WARNING said an import written across a line continuation is skipped
  and code after it missed; that suite and six sister spellings were run through the check itself and
  none is accepted.
- `rev_20261005085544_5f04d7ebefc8` — the release changes (three pieces). Each piece had four valid
  reviews, one from each route (Codex, Antigravity, Copilot, Grok), each at the first attempt. Verdicts
  by route: Antigravity ACCEPT; Codex, Copilot and Grok MODIFY. 10 WARNING and 1 NITPICK: five real and
  fixed, six shown not to hold. 27 suggestions ruled, five applied. Receipt complete. The real
  findings: the records gave 1.17.0 the count that was measured on 1.17.1 (on 1.17.0 six commands were
  tried, and its whole pack was never run with the variable set); the advice on what to delete from a
  real evidence home would have had a user delete the evidence of a temporary project of their own
  (it now names three things only a fixture's folder has, and says to leave anything else); the entry
  of the first review above said four valid reviews and none in one paragraph (it is now by piece);
  the new suite counted an evidence home that was gone as left empty (it must now be there, the same
  folder, untouched and empty); and the notes named two of the three self-tests. Not real: that the
  manifest and the bootstrap link name 1.17.2 before its tag (every release is sealed that way,
  because the sealed tree cannot change before the tag is made from it), and four claims that a file
  or a change was missing from the range, each made from one piece of it.
- `rev_20261005102718_5f47d30cf18c` — the last review: what the review above led to, and this record's
  entries up to then (three pieces). Pieces 1 and 3: four valid reviews each, one from each route, at
  the first attempt. Piece 2: three valid reviews, from Codex, Antigravity and Grok at the first
  attempt; Copilot gave no valid review of piece 2, its answer being refused on both attempts because
  a quote did not match the diff. Quorum was met on all three pieces. Verdicts by route: Codex ACCEPT,
  Antigravity ACCEPT, Grok MODIFY, and Copilot MODIFY, which rests on pieces 1 and 3. 3 WARNING and
  1 NITPICK: four real and fixed, none shown not to hold. 15 suggestions ruled, five applied. Receipt
  complete. Fixed: two stand-in children of the new suite removed the evidence home and remade it at
  once, which Windows can refuse for a moment after a removal (they now try again for up to two
  seconds; this was reasoned from the code and could not be made to happen in 300 tries on the triage
  machine); the suite now fails, with the reason, where a file system does not keep the modification
  time it sets on a new evidence home, instead of checking nothing; each suite's control run now ends
  before its evidence home is made; the name rule in the cleanup advice says exactly what the suites
  produce; the roadmap says the tag will be created, not that it is; and four sentences about 1.17.0
  use one tense.

Nothing was reviewed after the last review. What changed after it: the changes it asked for, listed
just above, which are in the new suite, the release notes, the reviewer pack, the diagnostics note,
the roadmap and one sentence of the manifest; and in this record its own entry, the status of gate 3,
one verb in "Who was affected" and the list below. The hosted matrix is the next check of the suite
changes, on every cell. A record cannot carry the review of its own last lines; they are for the
reader to check against the receipts. Each receipt was recorded on the tree that held that review's
own changes; the two reviews of the fix still validate on the final tree, and the last two bind files
that were edited afterwards as described here.

## Still required before the tag

Owner approval. On 5 October 2026 the owner instructed that 1.17.2 be completed and released. That
instruction is the owner's approval for the signed tag, on condition that every gate passes on the
final sealed commit. If a gate does not pass, the tag is not made and the decision goes back to the
owner.

1. Gate 1 on the sealed commit: the pack in three ways, the self-tests both ways, and the matrix.
2. The squash merge with the sealed tree unchanged, and the matrix green on `main`.
3. The signed `main-checkpoint`, then the six lifecycle drill cells on it.
4. The signed tag, then the publication record.
