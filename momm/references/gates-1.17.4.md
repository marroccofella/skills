# MOMM 1.17.4 — acceptance and release gates

Publication pending. The owner authorized implementing, testing and publishing this narrow
patch before 1.18 on 9 October 2026. This is not authorization to complete OAuth logins,
install the changed protocol locally, merge unrelated cleanup work or alter existing signed tags.

## Reproduced from issue #57

The released UI loses launch feedback after its toast, omits the Antigravity shared-evidence
caveat from the card, and supplies no discovery-retry control on an inconclusive version check.
New regression assertions failed against the original behavior before the governor's fix.
An additional check showed that a new login retained an earlier successful verification.
The patch clears it. The report's claim that all buttons fail is not established.

The existing Setup Center maintenance suite now includes these journey checks and runs through
the unchanged CI workflow. After the initial changes it passed 119 checks on Windows/Node 22.16.
Restricted execution initially denied loopback/child-process checks; that is not a product
failure or a successful run. The authorized unrestricted check passed; original attempts stand.

## Browser acceptance scope

The production browser assets and HTTP handler were exercised with synthetic route states.
An explicit browser click reached the production Windows launcher using a fixed harmless,
self-closing terminal command instead of a provider login. Spawn acceptance was observed,
not terminal visibility or successful authentication. The card kept unobserved-completion
feedback, and the timeout card exposed its safe command and zero-model discovery retry.
Clipboard write acknowledgement was observed; the browser connector's clipboard read did
not return content, so actual clipboard interoperability is not certified by that run.
The deterministic client test verifies exact login copying and fixed-field receipt contents.

## Gates still required

| Gate | Required before publication |
| --- | --- |
| Source-bound MOMM review | Valid external quorum, every finding/suggestion ruled, completion receipts and final-byte verification |
| Final sealed candidate | Clean tree, seal, full pack with default and external evidence modes, self-tests |
| Hosted matrix | All 15 required jobs on the exact sealed commit |
| Main promotion | Normal squash merge with identical tree; exact-main CI |
| Signed lifecycle | Signed checkpoint; all six hosted cells from 1.17.3 and 1.17.2, including interrupted recovery |
| Stable publication | Signed tag/release; fresh signature, identity and payload verification |
| Public closure | Publication record, live Pages check and meaningful issue/discussion update |

No outside Unix full-pack or native interactive OAuth journey is claimed. A successful review
or offline suite does not certify every real provider login or prove universal correctness.
Reviewer management remains a separate 1.18 specification, not bundled here.

## Initial review and triage checkpoint

Quorum 3/2 means three valid reviews against a minimum of two. Full reports, per-item governor
rulings and check references stay in private MOMM evidence (the default `.ensemble_reviews/`
or the configured external evidence home); they are not published. The public counts below
summarize those records without exporting source-bearing private reports.

- Source gate `rev_20261008212215_f2b1e0e4927e`, committed range
  `0def9750a36aa2ff46747d53cfa24f53166cf181..5cca6d32b8d6e865c8277ee5e25caa84286bdc51`:
  Claude, Copilot and Grok returned valid MODIFY reviews; Antigravity timed out and was not
  counted. Quorum 3/2, nine findings (seven WARNING and two NITPICK), twenty suggestions.
  Seven warning entries include overlapping authentication/verification-loss paths, not seven
  distinct outside-user defects. Twenty-one items were applied with modifications using actual
  failing-before/passing-after checks; eight architectural/API suggestions were declined with
  reasons. Historical receipts are retained rather than presented as observed login completion.
- Records gate `rev_20261008212257_a3aedf1e32c4`, the same committed range with a separate
  documentation/metadata scope: Antigravity ACCEPT, Copilot and Grok MODIFY, Claude's response
  was rejected for a quotation mismatch. Quorum 3/2, three findings and six suggestions.
  Two suggestions were applied (explicit candidate badge; existing seal metadata and corrected
  candidate-status annotation). Seven items were declined with executed renderer checks and
  inspection of the unchanged signed-update guards. The candidate version is required for the
  sealing/signing contract; it does not authorize an unsigned installation. A pre-tag availability
  notice can still precede a publishable tag. The public candidate/stable line remains explicit.
- Both completion receipts passed actual final verification and byte-hash validation on local
  commit `32e2ba59e39acab838adce5b8c19afec2fed9cef`. They validate records and current bytes at that
  checkpoint, not independent correctness. Later record/wording additions require the closing
  review; these paragraphs do not claim that review already happened.
- The corrected Setup Center suite passed 125 checks. The original whole-pack run on `5cca6d3`
  was 97/98, exit 1: its roadmap header still named 1.17.3 while the candidate manifest named
  1.17.4. The header was corrected; its original failure remains private and separate from
  subsequent runs. An authored reproduction harness also had a syntax-error batch; those
  attempts were preserved and not counted as product evidence. The corrected probes failed
  on their intended assertions, then passed after the fixes.

No source or private report has been published at this checkpoint. Closing review, final sealed
pack, hosted matrix, exact-main checks, signed checkpoint/drills/stable and public closure remain
release gates. No provider login, native Unix interactive journey or outside full-pack run is inferred.

## Dashboard follow-up and public testing preparation (9 October 2026)

The subsequent local dashboard tree was `b98c0bb54448f7a60df117e28d288c112d08e661`.
Its canonical dashboard suite passed 152 checks, including an aggregate that executes
20 governor-authored probes; the standalone 20-probe suite also passed. These are not
172 separate canonical checks. Browser simulation used the production assets/handler
with synthetic jobs and launch results; no real account login or CLI update was performed.

Final dashboard review `rev_20261009013355_600d5c886cc9` met quorum 2/2 (Claude MODIFY,
Copilot ACCEPT). All 13 items were ruled: two applied with modifications, eleven rejected.
The final local completion receipt validated reviewed bytes and governor evidence before
the no-byte-change commit. Earlier interrupted and invalid-output reviews remain separate,
not relabelled as successful or used to infer zero unknown usage.

The public-testing branch is assembled from that local tree on the existing public main
baseline. Original local history and private evidence are retained. Two synthetic token
fixtures are explicitly named as fixtures so the non-waivable publication scan can pass;
this changes test data, not production authentication. Notes and generated pages are
updated for the dashboard additions. Prior receipts are historical evidence for their
exact bytes, not automatic validation of this new public commit.

The candidate has a payload seal for integrity checking, not a signed stable tag or release
approval. Exact public HEAD, current CI status and original tester results belong in the
candidate PR and Discussion #32. Full final pack, hosted matrix, promotion, checkpoint,
lifecycle drills, stable signing and fresh public verification remain separate gates.
