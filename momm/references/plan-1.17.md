# MOMM 1.17 plan: one pen, a harder bench

Status: **built; sealed candidate 1.17.0, not released.** The current release is 1.16.1 (signed tag
`momm-1.16.1`, 28 September 2026). The plan had its completed review (quorum and a receipt) before any
1.17 code was merged; every scope item is now implemented on `release/momm-1.17` (see Progress), and
the release gates decide whether it becomes the signed tag `momm-1.17.0`.

**One plan.** A parallel draft written the same day in another session
(`momm-1.17-plan`, "safer review coverage, measured improvement") and two external reviews of the
drafts were merged into this file on 29 September 2026; that draft is superseded. What it added is
credited where it lands: the verified starting point, the whole-contract receipt identity, the
separate-tracks list, the design decisions and the pre-code acceptance package.

**Theme.** Keep one writer and make everything around it harder to fool. A failed reviewer's *role*
is covered by role, never by committee; every claim is typed and still has to survive reproduction;
and MOMM's own gates are audited for the ways their letter can be met while their purpose is
missed. Alongside that, close the debts 1.16.1 carried forward by name.

**Where this comes from.** Two owner proposals of 28 September 2026, recorded and reviewed in the
[ideas register](ideas-register.md): "1.17 design candidate: role-preserving review" and
"1.17 design candidate: loophole-aware critical review". The carried debts are the register's
"Planned for 1.17" list and the 1.16.1 [gate record](gates-1.16.1.md). This plan reconciles all
three; where it narrows a register idea, it says so.

**Sources of truth.** `versions.json` holds the published version. The newest
`references/release-*.md` is the dated record. `ROADMAP.md` opens with now, next, later. Nothing
else says "current".

**Standing constraints (unchanged, outrank this plan).** The governor is the only writer. Reviewer
output is untrusted evidence, and a cover reviewer is still a reviewer. Account logins only, no
API-key routes. Automatic updates stay off unless the owner turns them on; an agent never does.
`evidence --protect` is owner-invoked. Anything that spends provider quota on a probe or a
diagnostic run is disclosed and asked for first. A MOMM purpose clause may only tighten a gate,
never loosen one.

## Verified starting point (29 September 2026)

Already in the code, so not 1.17 deliverables; the register is corrected to match:

- `--split auto` is parsed and applied (a fixed 40 KB ceiling). What is missing is the evaluation the
  register asked for (five live runs above 100 KB with at most 10% coverage loss).
- `scheduler.mjs` has `adaptiveTimeoutMs` and `earlyExitDecision` with unit tests, but dispatch
  calls neither. They are helpers, not features; `--early-exit` still needs in-flight cancellation.
- Personas are assigned and reported per reviewer; recording the persona on dispositions is the gap
  (B6).
- `checks.mjs` already records governor-chosen test runs as evidence; a pre-review runner is a
  separate question (out of scope below).
- The modality registry already separates documented support, locally verified handling, expired
  evidence and runtime refusal.
- The release-observations workflow exists on `main` and has run successfully (for example run
  36362393798, 28 September); the public Improvement page still calls it proposed.

## Scope

| # | Item | Section | Kind |
| --- | --- | --- | --- |
| 1 | Reviewer launches resolved outside the project on macOS and Linux too | A1 | carried debt (accepted risk in 1.16.1) |
| 2 | Codex route fully isolated from the user's configuration | A2 | carried debt |
| 3 | Reviewers may cite what they saw in an attached image | A3 | carried debt |
| 4 | Long-hunk splitting keeps both halves of a change together | A4 | carried debt |
| 5 | In-review preflight no longer times out | A5 | carried debt |
| 6 | Interrupted-install recovery drilled on every cell | A6 | carried debt (not waived in 1.16.1) |
| 7 | Evidence folder outside the project, opt-in | A7 | owner decision D1 |
| 8 | Roles separate from routes; versioned role briefs | B1 | role-preserving stage 1 |
| 9 | Typed claims beside severity | B2 | role-preserving stage 1 |
| 10 | Opt-in role cover with one attempt budget | B3 | role-preserving stage 2 |
| 11 | Harder accept gate: mechanical `style`, recorded mutation, stale reports | B4 | role-preserving stage 3 + loophole rows |
| 12 | Narrow second look on one disputed claim | B5 | role-preserving stage 3 (subsumes `--cross-check`) |
| 13 | Role on dispositions and a per-route, per-role roster | B6 | role-preserving stage 4, measurement only |
| 14 | Loophole checklist in the adversary brief | C1 | loophole lens |
| 15 | MOMM invariants as depth-bounded property tests | C2 | loophole lens |
| 16 | Guided image generation: blind governor critique, consented regeneration rounds | E | owner proposal, 29 September |
| 17 | A cloned project's `.reviewrules` is skipped until trusted (the 1.16 grace ends) | A8 | promised in `guidance.mjs`; security gate |
| 18 | Capability evidence bound to the MOMM command that earned it | A9 | cross-version finding, 29 September |
| 19 | Generation routes isolated exactly like review routes | A10 | Grok pilot finding G4 |

"Done when" for each is in its section. Nothing outside this table ships in 1.17.

## A. Carried debts

### A1. Launch resolution on every platform

Today `processScope.spawn` resolves a command and scrubs the child PATH only on Windows; on macOS and
Linux a bare `codex`, `claude`, `grok`, `agy` or `git` goes straight to `spawn`, so a PATH entry
inside the reviewed project (a direnv or virtual-environment `bin`) can supply it. The same holds
for `antigravityCommand`, `grokCommand`, `collectArtifact`'s `git` and `governor.mjs`'s `gitPath`.

Change: one resolver for every platform. A bare name is resolved against PATH entries that pass
`pathEntryOutside`, the resolved file must pass `executableOutside` (real path, so a link outside
the project that points inside it is refused), and the child PATH is scrubbed of project entries.
A command containing a path separator must be an absolute path MOMM resolved itself (for example the verified Grok or Antigravity binary); a relative path containing a separator is refused.

Done when: planted-executable regressions pass on Linux and macOS CI (PATH entry inside the project,
link from outside into the project, relative PATH entry); `process-scope.test.mjs`'s assertion that
POSIX returns the bare name is replaced by the new behaviour; release notes say that a CLI installed
only inside the reviewed project is now reported as not installed.

### A2. Codex isolation, completed

1.16.1 stopped project `AGENTS.md`, hooks, plugins, apps, multi-agent and image generation. Still
inherited: the user's MCP servers, global instructions and skills. `codex exec --ignore-user-config
--ignore-rules` is the documented route, but it also drops the model and effort the user shares with
the Codex desktop app.

Change: add `--ignore-user-config --ignore-rules`, and pass the model and reasoning effort
explicitly, read (never written) from the user's own Codex configuration; when it names none, pass
none and let Codex choose. MOMM never edits `~/.codex/config.toml`. Fix the stale comment that says
Codex's working directory is inside `.ensemble_reviews` (it is a private temporary directory).

Done when: adapter tests assert the arguments and that the configuration file is opened read-only;
one disclosed synthetic probe (owner-approved quota) shows login and a valid review; a canary shows
MCP servers are no longer loaded.

### A3. Image observations in reviewed scope

In an image review the only text MOMM sends is the brief, so a reviewer that quotes text it read in
the image fails the quotation rule and becomes `invalid_output`.

Change: when attachments were sent, a `reviewed_scope` entry may instead be
`{attachment, observation, assessment}`, where `attachment` must name an attachment actually sent in
that run. The entry names the attachment by its SHA-256 as sent, and may carry a `region`
`[x, y, w, h]` in whole pixels from the image's top-left corner, inside its bounds; a digest that does not
match a sent attachment, or a region outside the image, makes the answer `invalid_output`, as a failed
quote does. Such entries are recorded as unverifiable observations, never as quotes. This
assumes image review stays a supported claim (owner decision D8); anchors for PDF pages,
spreadsheet cells, slides and audio or video timecodes are not implied and are out of scope. At least one
entry must still quote the text artifact whenever the text artifact is non-empty, so the review stays
anchored to something MOMM can check.

Done when: tests accept an observation of a sent attachment, refuse one that names an attachment
not sent, refuse observation-only scope when the text brief is non-empty, and refuse observation
entries in a run with no attachments. Peer contract version rises (B2 shares the bump).

### A4. The full-range review can finish

Three causes kept 1.16.1's full-range reviews from quorum on every piece.

1. **Removal halves.** `lineSplitHunk` cuts by byte balance with no regard to line kind, so a cut can
   separate a run of `-` lines from the `+` lines that replace it. Change: a run of removals and the
   run of additions that follows it form one cut unit; a unit larger than the ceiling becomes a piece of
   its own, over the ceiling, when it still fits the route input limit, so the panel still reviews it;
   only a unit beyond that limit goes to `oversize` (reviewed by the governor directly). Done when a split test
   proves no piece carries a removal without its replacement, including the one-long-line case.
2. **Codex quotations.** Failed answers are not stored, so nobody knows what Codex quoted. Change:
   when an answer fails the quotation rule, the private attempt record keeps the failing quote's
   SHA-256, its length and its first 80 characters after the usual redaction. Done when one
   disclosed diagnostic range run (owner-approved quota) shows what Codex quotes, and the fix or
   the refusal that follows is recorded.
3. **Grok on dense pieces.** Grok ran past 360 s on 24 KB pieces in 1.16.1, and on 29 September took
   255 s at 9.9 KB and 313 s at 22.9 KB, then timed out with no output at 28.9 KB and 34.4 KB. Change:
   a Grok-only piece ceiling set from these measurements (about 20 KB), and Grok reviews read with
   streaming output so a timeout still records time to first output and bytes received. The deadline
   stays fixed; a longer timeout alone is not a fix.

### A5. In-review preflight

Every recent report shows `version_status: "timeout"` for every route although a standalone
`--preflight` answers in about a second. The code map shows synchronous PowerShell permission
audits and realpath calls on the event loop while routes launch, which can starve the 5 s version
timers. The same synchronous audits are slow and not always reliable: during the 1.17 plan review each
`checks.mjs` record took 15 to 50 s, and twice on 28 and 29 September (in two projects) a check was refused
with `inspection_unavailable`, then passed on an immediate retry with the folder still private. Change:
run preflight to completion before dispatch (bounded, as the standalone command is), so its timers
never compete with launch work; profile the permission audit and make an `inspection_unavailable`
result say whether it timed out. Done when a normal review's preflight rows carry
real versions, and a test with a deliberately blocked loop shows preflight is unaffected.

### A6. Interrupted-install recovery drill

The 1.16.1 drills did not stop an update mid-transaction. Change, on the drills branch only (no
product code): the drill starts an apply, kills it as soon as the transaction journal reaches
`prepared`, then recovers with the retained updater and verifies the original installation. Done
when all six cells pass the new step.

### A7. Evidence outside the project (owner decision D1)

The need is concrete: on the Mannin project (28 September) every review was refused before anything was
sent, because the evidence folder inherited the D: drive's default grants to other local accounts plus
grants added to the project folder; each such project needs the owner to run `evidence --protect` once. Proposed, opt-in: `MOMM_EVIDENCE_HOME` (or `--evidence-home`)
places a project's evidence under the user's profile, in a folder named by a hash of the
project's real path (so two projects with the same folder name never share a ledger), created private;
the resolved location must lie outside the project's real path (both spellings), or it is refused; the
default location is unchanged in 1.17. The same permission checks apply wherever the folder lives.
Done when the governor, ledger, checks and attempt records all follow the setting, and a test shows
a private per-user folder passes while a broadened one is refused exactly as today.

### A8. Untrusted `.reviewrules` skipped by default (security gate)

`guidance.mjs` records the promise: 1.16 still applies a project's untrusted `.reviewrules` to every
reviewer prompt (`reviewrulesGrace: true`) with a loud notice, and "the grace ends in 1.17". A cloned
repository must not be able to inject reviewer instructions by default. Change: the default flips to
skip-until-trusted; the notice names the file, its hash and the exact trust command; trusting one hash
never trusts a changed file. The 1.17 release notes tell existing users that their rules now need one
`guidance --trust`. Done when tests cover a trusted file, an untrusted file (skipped, notice shown), a
changed hash after trust (skipped again), a missing file and a clean project, and the report records
which rules were applied by hash.

### A9. Capability evidence bound to the command that earned it

A capability probe proves a specific command line, not a route in general. On 29 September the 1.17
probe recorded Grok image generation as verified in the machine-wide overlay that the installed 1.16.1
also reads, although 1.16.1 still sends the command that fails. Change: each overlay entry records a
fingerprint of the exact command shape the probe used (flags, permission grants, isolation
environment), and the runner routes only when its own command for that cell has the same fingerprint;
otherwise the cell reads as `reprobe`. Entries also carry the classifier version (G3 prevention).
Older MOMM versions ignore the new fields, so the 1.17 release notes say plainly that Grok image
generation does not work on 1.16.1.

### A10. Generation isolated like review

Grok's review adapter switches off its imports of the user's Claude Code and Cursor setup
(skills, rules, agents, MCP servers, hooks), its memory and its auto-updater; the generation runner and
the generation probe switch off none of them, and the runner also omits `--disable-web-search`. In the
pilot a generation run started the user's MCP servers. Change: one isolation definition per route,
shared by review, probe and generation, and a test that the probe and the runner build the same
isolation for the same cell. Applies to every route with generation (Codex, Antigravity, Grok).

## B. Role-preserving review

### B1. Roles separate from routes

A *role* is the stance a reviewer takes (surgeon, architect, adversary, verifier, innovator,
fresh eyes; today's personas). A *route* is the CLI that performs it. Change: each role brief moves
from source text to its own versioned file under `momm/roles/`, carrying a version and a review
date; the report records per reviewer `role` and `role_brief {version, sha256}`; `--personas` keeps
its syntax. Done when the briefs load from files, their hashes appear in the report and the
guidance layer, and a brief past its review date produces a visible notice (not a refusal).

### B2. Typed claims

Each finding gains `claim_type`: `DEFECT` (reproducible, must be proven or refuted), `RISK`
(plausible, needs a probe), `QUESTION` (a missing assumption), `IDEA` (optional) or
`NOISE` (style, taste, out of scope). Only `DEFECT` and `RISK` hold up acceptance by their type; for an
`IDEA`, `QUESTION` or `NOISE` claim, its type alone never blocks. Rules:

- The field is additive; an answer without it is valid and the claim is `untyped`.
- Severity keeps its own gate: a `CRITICAL` or `WARNING` blocks acceptance whatever its type.
- When findings from several reviewers merge, the merged type is the most blocking one
  (`DEFECT` > `RISK` > `QUESTION` > `IDEA` > `NOISE`); a merge never lowers it.
- The governor may re-type a claim only in its decision row, with `retyped_from` and a reason;
  lowering severity is recorded the same way.

Done when the contract, the merge and the governor validator enforce these rules in tests.

### B3. Opt-in role cover

With `--cover`, when a route's review of a piece ends `timeout`, `invalid_output`,
`provider_unavailable` or `error`, MOMM may send the same role to another requested route for that
piece. Rules:

- **One attempt budget per piece and role:** at most two route invocations in total, counted across
  outage retry, `--retry-invalid` and cover. Every invocation counts, including failed ones.
- **Never around a login or an allowance:** `authentication_required`, `quota`, `ineligible_tier`,
  `disabled_no_oauth`, `self_excluded`, `cancelled` and `unsupported` are never covered (owner
  decision D3).
- **An independent cover:** the cover route gets the vacated role's brief and the failure status, and
  no other reviewer's claims. Route CLIs take one prompt, so text cannot be kept out of the
  instruction channel by labelling it; sharing earlier claims would also make the cover's opinion
  depend on theirs. (This narrows the proposal, which suggested passing the claims on the table.)
- **Labelled, never disguised:** the reviewer entry records `covering_for`, the failed route's
  status, the role and the brief version. A cover is never presented as a native review.
- **No correlated votes from covers:** a cover adds a quorum vote only if its route's model family is
  known and differs from every family that already has a successful review of the piece. Families
  come from one versioned table reported with the run (`codex` OpenAI, `claude` Anthropic,
  `antigravity` and `gemini` Google, `grok` xAI). `copilot` runs a user-configured model, so an
  unknown family adds no vote as a cover. Native reviews keep today's counting in 1.17; that a native
  Copilot and another route may share a model is documented, not closed.

Done when every terminal status has a tested cover rule, the budget and correlation invariants hold
in C2's property tests, and the report shows roles covered per piece.

### B4. A harder accept gate

1. **Mechanical `style` (closes the `change_kind` loophole).** A decision may be `style` only when,
   for every file it touched, every changed line is whitespace or a comment in both its old and new
   form. A line turned from code into a comment is therefore a behaviour change, and so is any comment that
   carries a tool directive (for example `eslint-disable`, `@ts-expect-error`, `@ts-ignore`,
   `prettier-ignore`, `istanbul ignore`, `noqa`, `type: ignore`, `pragma`), from one versioned list. A
   code line whose only change is whitespace counts as style, except in whitespace-significant files
   (Python, YAML, Makefile and the like), which fail closed. Files the check
   cannot classify (binary, renamed, generated, or a type with no comment syntax, such as Markdown)
   fail closed to `behavior`, so they need failing-before and passing-after evidence (owner
   decision D4).
2. **Recorded mutation (narrows test adequacy).** `checks.mjs --phase mutation` records the chosen
   test run with that one decision's change reverted (per decision, not all fixes at once); it must fail. The validator reports how many applied decisions
   carry one. Optional in 1.17 and never presented as proof: a revert that does not build also fails.
3. **Stale reports and complete receipt identity.** A review is bound to everything that shaped it:
   the dispatcher (which holds the prompt template), peer contract, process scope, each route's
   command fingerprint (A9), role brief versions and hashes (B1), guidance and `.reviewrules` hashes,
   each reviewer's CLI version and, where the CLI reports it, model id, the capability evidence used
   with its expiry, every attachment's SHA-256, and the source snapshot. The governor validator
   compares these with what is installed now and marks the review `stale` when any differ; a stale
   review can still be completed, and its receipt says so. Public receipts carry hashes only, never
   credentials, prompt text or reviewer content.

Done when each has tests, including a commented-out line recorded as `style` being refused.

### B5. Narrow second look

`multi-review.mjs --second-look <run_id> --finding <finding_id> [--reviewers <route>]` sends one
claim, as quoted data, with the original artifact to one route that was not among its sources, and
asks it to confirm or refute with evidence. It writes a separate report linked to the original and
never changes the original. Used when two roles contradict, when a `CRITICAL` fails reproduction,
when the only review of a role was a cover, or to test the governor's rejection of a `CRITICAL`.
This is the register's `--cross-check`, narrowed to one claim. It is never a debate: the disputed
claim is the object under review, fenced and labelled as untrusted text; the route is told to judge it
against the artifact, and its verdict must quote the artifact. No other reviewer output is included.

Done when a test shows the original report and log are unchanged, the second look is linked both
ways, and it refuses a route that was a source of the claim.

### B6. Measure before choosing pairings

Decision rows may carry `role` (the governor copies it from the report). The scorecard adds, per
route and role: valid-review rate, reproduced-claim rate (applied with a failing-before record),
false-`CRITICAL` rate (rejected after investigation), median time, and cover success. Nothing routes
on these numbers in 1.17; they are shown, labelled as this project's governor decisions. Pairing
studies and the seeded benchmark wait for a corpus no reviewer model has seen (register,
"Controlled benchmark").

## C. The loophole lens

### C1. Loophole checklist

A short versioned file, `momm/roles/checklists/loophole.md`: the four themes (letter against spirit,
categorical arbitrage, temporal latency, compositional blind spots), one line each, and the five
techniques by name. The adversary brief includes it by reference. Findings raised through it must
still quote the artifact and name a concrete sequence of steps. Done when the adversary prompt
carries the checklist and its hash, and no other brief does.

### C2. Invariants as property tests

A depth-bounded test over the step alphabet `retry`, `retry-invalid`, `cover`, `split`, `re-type`,
`re-severity` checks that no sequence reaches: a third invocation for one piece and role; a cover
counted as a second vote for one family; a piece holding a removal without its replacement; a
merged claim type lower than any of its sources; a claim type or severity lowered
without a recorded decision row (a recorded `retyped_from` with a reason is the one allowed lowering); an
unclassifiable diff recorded as `style`.

## E. Guided image generation (owner proposal, 29 September 2026)

**What the owner is after.** A picture that matches what the user *meant*, not only what they typed.
Each image generator reads a prompt differently, so asking every capable one gives a spread of
interpretations. The governor then acts as art director: it judges every picture against the
user's intent, shows the user everything, and steers the next attempt with its critique. The user
decides, round by round, how much the image makers are allowed to see.

**Why it fits MOMM.** One judge, several makers, and the user in charge of every step that spends
allowance or shares a picture with another provider. It is not a review: it produces no findings,
no quorum and no dispositions, and nothing it makes counts as review evidence. It extends the 1.16
modality runner (`modality.mjs`) as a separate command with its own consent, as generation already is.

### E1. The rounds

0. **Can anything make a picture?** If no route's image-generation cell is routable, MOMM says so
   first, names what clears each blocker (a re-probe, an account allowlist), and stops before asking
   the user anything else.
1. **Intent check (no generation).** The governor restates the request as a short checklist: what
   must appear, what must not, subject, setting, mood and style, any text in the picture, shape and
   size. The user confirms or corrects it. The user's own words are stored unchanged; the checklist
   sits beside them and never replaces them.
2. **First round, with consent.** Confirming the checklist is a check on meaning, not a yes to spend
   anything, so the governor asks separately:
   > I can send your request to Codex and Antigravity now. That makes two pictures, one from each,
   > and uses your allowance on both. Shall I go ahead?

   (The routes and the count are whatever is routable at the time.) On yes, every route whose
   image-generation cell is routable (no blocker, level at least `documented`) receives the user's
   words, unchanged. Pictures are harvested as today
   (step-scoped, hashed, under `.ensemble_reviews/media/<run>/`).
3. **Critique.** The governor looks at every picture *blind*, labelled A, B, C, without knowing which
   route made it, so the provider's name cannot sway the judgement. For each picture and each
   checklist item it records `met`, `partly`, `missed` or `can't tell`, and for every `met`,
   `partly` or `missed` it names what it can actually see ("the harbour is at night; the request
   asked for dawn"). It also names where a picture meets the words but misses the point (the
   letter-against-spirit check from C1). No verdict rests on taste alone. The runner keeps the
   route-to-label map to itself and reveals it only after the critique's hash is recorded in the run
   report; the report shows the critique hash and time before the reveal. (The governor runs as the
   same user, so this makes early peeking visible rather than impossible.)
4. **Show everything.** Every picture, its label, its maker and the critique are shown to the user
   in a private local gallery. Nothing is published.
5. **Second round, with consent.** The governor asks:
   > I've compared all the pictures with what you asked for. Would you like me to pass my notes to
   > the image makers so each can try again? Each one sees only my notes on its own picture, not
   > anyone else's. This makes one more picture per maker and uses your allowance on each of them.

   On yes, each maker receives the user's words unchanged, then a separate, labelled section with
   the checklist and the governor's notes on *its own* picture. A maker whose image-input cell is
   routable also gets its own first picture, by hash, to edit rather than start again; that shares
   nothing with another provider. On no, the run stops here.
6. **Final round, with separate consent.** After critiquing the second round, the governor asks:
   > One more option: each image maker could see all the pictures so far, along with my notes, and
   > have a final go at combining the best of them. This often gets closest to what you meant, but
   > the results can start to look alike, and every picture is shared with every provider taking
   > part. Shall I do that?

   On yes, each maker whose image-input cell is routable receives the user's words, the checklist,
   the governor's notes on every picture, and every picture so far as reference images. A maker
   that cannot take images in gets the notes only, and the gallery says so. The governor critiques
   the final pictures the same blind way, recommends one with its reasons, and the user chooses.

7. **Suggested rounds the user can pick (owner, 29 September).** Every critique ends with the
   governor's concrete suggestions, each written as a round the user can choose, for example:
   > Here is what I would try next. Pick any, none, or add your own:
   > 1. Put the clock tower in the right place, rising centrally above the columns (all three).
   > 2. Make the paint look real: spray texture, overspray and drips on the stone (B and C).
   > 3. Move the graffiti from the board onto the building itself (B).
   > 4. Combine A's paint with C's view of the front and the lions.

   Each pick becomes its own round with its own costed question; the user's own additions are
   carried as the user's words, never merged into the governor's. The user can stop after any
   round. Suggestions are never pre-selected, and the recommendation is labelled as the governor's.

Rounds two and three above are the first two such suggestions; beyond them the user decides how far
to go, one costed round at a time, and none starts without the user's yes.

### E2. Rules

- **The user's words are never rewritten.** 1.16's runner rule is that no text produced by a step
  enters a later step's prompt. E keeps that for maker output. The one addition is the governor's
  own checklist and critique, sent only after the user agrees, in a labelled section after the
  user's words.
- **Consent per round, with the cost stated.** Each question says how many pictures it will make and
  on which routes; the quota rule of owner decision D6 applies.
- **Sharing pictures between providers needs its own yes.** Round three sends one provider's
  pictures to the others. That is a separate question, never implied by the first.
- **Provenance.** Every picture records its route, round, the exact prompt parts it received (user
  words, checklist, notes, reference images by hash), and the images it was shown.
- **The governor recommends; the user decides.** A recommendation is labelled as the governor's
  judgement against the checklist, not a measurement.
- **Refusals stay refusals.** A route that declines or fails a request is reported with its reason.
  MOMM never rephrases the user's words to get past a provider's refusal.

### E2a. Pilot, 29 September 2026 (hand-run, before the runner exists)

The owner asked for a test: graffiti reading "entrepreneuria" on Leeds Town Hall. Round one ran
through the existing modality runner on Codex, Antigravity and Grok in parallel (61 s, 50 s, 59 s),
the governor critiqued the three pictures against a checklist, the pictures were shown in the
harness, and the ledger gained a "Generated pictures" section that shows a picture only while its
bytes match the recorded hash. The critique could not be fully blind, because the governor had seen
the file names first; the runner must withhold them. The pilot also found three route defects:

- **Grok could never generate.** Its image tool asks permission, and headless mode cancels the
  request (session log: decision `cancelled`); MOMM's `acceptEdits` covers edits only. Fixed by
  allowing exactly the media tool the step needs (`--allow image_gen`, `--allow image_to_video`).
- **A misread gate kept itself alive.** Antigravity's gate phrasing was read into a Grok reply and
  recorded as an `allowlist` blocker; because a probe skips a gate it cannot clear, the wrong record
  also stopped the probe that would correct it. Gate phrasings are now scoped to their own route,
  and a gate recorded against another route reads as `reprobe`.
- **Grok generation is not isolated.** Its generation runs loaded the user's MCP servers, which review
  runs switch off. Generation routes get the same isolation as review routes (A10).

Grok video generation is blocked by the account's zero-data-retention setting, a genuine gate the
owner may change with `/privacy`.

### E3. Done when

Tests with a fake runner show:
- the user's words reach every maker byte for byte in every round;
- round two carries only that maker's own notes;
- round three runs only after its own yes and attaches pictures only to makers that can take them;
- critiques are saved before labels are revealed;
- every checklist item has a result for every picture, with visible evidence for each `met`,
  `partly` or `missed`;
- no round starts without consent, the first round included, and every question states the count and routes;
- round two attaches a maker's own picture only, and only when it can take images in;
- the gallery shows every picture with its provenance.

The live pilot has run (E2a): after re-probes on 29 September, Codex and Antigravity image generation
are verified on 1.16.1's commands, and Grok's only on the 1.17 commands (G1 to G3). The runner-level
proof of E1 still needs the rounds command, its tests and a second pilot.

## Gate self-audit (new gates in this plan)

Required in every plan from 1.17 on: for each new gate, how its letter could be met while its
purpose is missed, and what catches that.

| New gate | Letter met, purpose missed | Caught by |
| --- | --- | --- |
| Role cover | A cover counted as a fresh opinion, or steered by other reviewers | A cover adds a vote only from a new, known family; it sees no other reviewer's claims; it is labelled |
| Attempt budget | Retries and covers chained into more answers | One shared budget, property-tested (C2) |
| `claim_type` | A real defect typed `IDEA` | Severity gates independently; merge never lowers; re-typing recorded |
| Mechanical `style` | Code hidden by commenting it out; a directive comment edited; a Python reindent | Both forms of each line must be comment or whitespace; directive comments and whitespace-significant files are `behavior` |
| Mutation record | A revert that fails to build counts as a failing test | Optional, reported as a count, never as proof |
| Second look | Becomes a debate or rewrites history | One claim, data-only, separate report, originals unchanged |
| Image observations | Any text accepted as "seen in the image" | Observations are labelled unverifiable; a text quote is still required when there is text |
| Evidence home | A private folder inside the project passes as "outside" | The location must be outside the project's real path, and private |
| POSIX resolution | A link outside the project points inside it | Real-path check on the resolved executable |
| Generation consent | One yes stretched to cover sharing pictures between providers | Round three asks its own question; provenance records what each maker was shown |
| Governor critique | "Looks right" with nothing seen; a provider's name swaying the verdict | Every item needs visible evidence or `can't tell`; critique is blind and saved before labels are revealed |
| Intent checklist | The checklist quietly replaces what the user said | The user's words are sent unchanged, byte for byte, and the checklist is confirmed by the user first |

## Explicitly out of 1.17

`--early-exit` end to end (the helper exists; cancellation does not); evaluating and promoting
`--split auto` (it exists with a fixed ceiling); wiring the adaptive-timeout helper into dispatch; a
higher `--jobs` ceiling and ledger-learned caps;
bounded surrounding-code context; a deterministic pre-review runner; the global ledger;
installation-management interfaces (register F3 to F8); the consented verifier install; removing the
Gemini route; split cover, sketch patches, shuffled passes, automatic pairing and project memory
(register, deferred); routing on roster numbers; the seeded benchmark corpus and a public scoreboard;
signed receipts; MOMM World; plan, draft and final review checkpoints, reusable task briefs, and
consistency checks across reports, spreadsheets, slides and media (proposed earlier; not this
release); anchors for PDF pages, spreadsheet cells, slides and audio or video timecodes; the Mannin
canvas application's image routing (tracked in that project's repair contract); paid managed
reviewers or any hosted service, account or billing; automatic continuation of generation rounds (each round needs its own yes), automatic choice of a final picture,
and any rephrasing of a user's request to get past a provider's refusal. The film captions and poster are media-pipeline work for the owner, not
code.

## Owner decisions

- **D1. Evidence outside the project.** Recommended: opt-in in 1.17, default unchanged. Alternatives:
  make it the default (needs a migration), or defer.
- **D2. Codex model and effort.** Recommended: read them from the user's Codex configuration,
  read-only, and pass them explicitly. Alternative: a MOMM default model.
- **D3. Cover for login and allowance failures.** Recommended: never (as above). Alternative: allow a
  cover for `quota` only, with explicit opt-in.
- **D4. Documentation edits under mechanical `style`.** Recommended: they count as `behavior` (a docs
  change can be wrong). Alternative: exempt Markdown.
- **D5. Version.** Recommended: `1.17.0`, because the peer contract, report and command line gain
  fields and flags.
- **D8. Image review as a supported claim.** Recommended: yes, with A3's digest-and-region anchors, and
  no claim for other media anchors in 1.17.
- **D9. `.reviewrules` migration.** Recommended: flip the default in 1.17 as promised, with the notice
  and release-note wording in A8; no automatic trust of existing files.
- **D10. Installation management (register F3 to F8).** Recommended: a separate workstream after 1.17,
  each step with its own threat model, dry run and rollback proof.
- **D6. Quota-spending runs.** A2's probe, A4's diagnostic range run, and release gates 3 and 5 (the
  self-review and the live image review) are each asked for when they are due, with their provider
  traffic disclosed. A review of this plan or of an item is covered by the owner's standing rule to
- **D7. Guided generation pilot.** Re-probing the image-generation cells (Codex, Antigravity) and the
  pilot itself spend allowance on each maker; both are asked for when due. Grok's allowlist is an
  account matter for the owner.
  review substantive changes.

## Traceability

Every proposal on record, where it went, and its status (Open, Implemented or Out). Every row
that was Open is now Implemented; the release gates are tracked separately.

| Source | Proposal | Disposition | Status |
| --- | --- | --- | --- |
| Register, planned for 1.17 | POSIX launch resolution | A1 | Implemented |
| Register, planned for 1.17 | Full Codex isolation | A2 | Implemented |
| Register, planned for 1.17 | Image quotation | A3 (D8) | Implemented |
| Register, planned for 1.17 | Full-range review can finish | A4 | Implemented |
| Register, planned for 1.17 | In-review preflight timeouts | A5 | Implemented |
| Register, planned for 1.17 / 1.16.1 gate record | Interrupted-install drill | A6 | Implemented |
| Register, planned for 1.17 | Evidence outside the project | A7 (D1) | Implemented |
| Register, planned for 1.17 | Film captions, poster | Out: owner's media pipeline | Out |
| Register, 1.17 candidates | `--early-exit`, `--split auto`, caps and `--jobs`, adaptive timeouts | Out; status corrected under "Verified starting point" | Out |
| Register, 1.17 candidates | `--cross-check` | B5 (narrowed to one claim) | Implemented |
| Register, 1.17 candidates | One observation across finding ids | Out | Out |
| Register, 1.17 candidates | Bounded surrounding context | Out | Out |
| Register, 1.17 candidates | Deterministic evidence beside reviews | Exists (`checks.mjs`); pre-review runner out | Out |
| Register, 1.17 candidates | Persona on dispositions | B6 | Implemented |
| Register, measurement | Receipt invalidation on change | B4.3 | Implemented |
| Register, measurement | Benchmark, scoreboard, training sets, signed receipts, MOMM World, CLI health feed | Out | Out |
| Register, installation management | F3 to F8 | Out (D10) | Out |
| `guidance.mjs` promise | `.reviewrules` grace ends | A8 (D9) | Implemented |
| Owner, 28 September | Role-preserving review | B1 to B6 | Implemented |
| Owner, 28 September | Loophole-aware critical review | C1, C2, gate self-audit, B4.1, B4.2 | Implemented |
| Owner, 29 September | Guided image generation, suggested rounds | E | Implemented |
| Grok pilot, 29 September | G1 to G3 | Implemented (E2a) | Implemented |
| Grok pilot, 29 September | G4 generation isolation | A10 | Implemented |
| Grok pilot, 29 September | G5 video under ZDR (zero data retention) | Owner setting; stays fail-closed | Out |
| Grok pilot, 29 September | G6 review timeouts | A4.3 | Implemented |
| External review, 29 September | Cross-version capability evidence | A9 | Implemented |
| External review, 29 September | Plan and roadmap status wording | Status paragraph; docs change on `main` (work order) | Implemented |
| External review, 29 September | Improvement page and observer wording | Docs change on `main` (work order) | Implemented |
| External review, 29 September | Broader workflow products | Out, named | Out |
| Mannin, 28 September | Evidence folder refused on inherited grants | A7 | Implemented |
| Mannin, 28 September | Canvas image routing | Out: Mannin repair contract | Out |
| Earlier proposals | Paid managed reviewers | Out | Out |

## Pre-code acceptance package

Before implementing an item, write its tests first: role and route separation; every failure-class
transition; no route or budget expansion; a cover never adding a correlated vote; blind cover versus
targeted second look; same-family independence; source and contract invalidation; stale and partial
receipts; missing or expired capability; command-fingerprint mismatch; `.reviewrules` trust states;
interrupted updater recovery; cross-platform executable containment; generation isolation parity.
No reviewer-authored patch is run; every material finding is reproduced or rejected with evidence;
every suggestion gets a disposition.

## Release gates

1. Local suites and the OS by Node matrix on the commit that will be tagged, read from job logs.
2. Lifecycle drills including A6, on the signed checkpoint of that commit.
3. Self-review of the 1.17 delta with per-piece quorum and a completion receipt, under the B4 rules.
4. Privacy and history scan before every push.
5. One live image review on the final tree, exercising A3.
6. Signed tag `momm-1.17.0`, only on the owner's go-ahead.

## Work order

1. This plan and its completed review (quorum and a receipt, bound to the final text). In parallel, a
   docs-only change on `main`: the roadmap's now and next, the Improvement page's PR #18 wording, and
   the observer's status (the workflow exists and has run; nothing more is claimed).
2. A1, A4.1, A4.3, A5 and A8: offline, testable, security first.
3. B2 and A3 together (one peer-contract bump), then B1 and C1.
4. B4, then B3 with C2, then B5.
5. B6, then E: the landed slice (E2a) is done; the rounds command gets fake-runner tests first, and
   only its second live pilot waits for D7.
6. A2 and the A4.2 diagnostic, with the owner's quota approval.
7. A7 per D1; A6 on the drills branch.
8. Documentation, release notes, gate record, version, seal. Commit, run the full OS by Node matrix on
   that exact SHA, and only then ask reviewers to approve it. Any commit made after reviewer comments
   changes the SHA, so the matrix runs again and gate 1 is read from the new job logs; then the remaining
   release gates.

## Progress

Every item in the scope table is built and merged on `release/momm-1.17`, each with failing-first
tests; the full CI suite set passed after every merge batch (91 suites on the final merge). What
remains is the release gates.

- **Grok route (E2a pilot findings):** G1 media-tool grants, G2 route-scoped gate phrasing, G3 a
  misread gate reads as reprobe.
- **A10:** one isolation definition shared by review, probe and generation (`route-isolation.mjs`).
- **A9:** capability evidence bound to a canonical command-shape fingerprint; the writer always stamps
  one; a success on a command changed since 1.16.1 is stored as `probe_failed` plus
  `verified_command_shape_sha256`, so 1.16.1 never routes it; account gates stand.
- **A8:** an untrusted `.reviewrules` is skipped until its exact hash is trusted.
- **A5:** preflight finishes before dispatch.
- **A4.1:** a replaced block is one cut unit; one over the ceiling is its own piece up to the 2 MB cap.
- **A4.2:** a quotation refusal leaves each failing quote's SHA-256, length, redacted 80-character
  prefix and the comparisons tried in the private attempt record only.
- **A4.3:** a split run with Grok caps the ceiling at 20 KB and records it; Grok reviews read
  `--output-format streaming-json` in the shape verified on a live Grok CLI 1.0.41 capture (`text`
  lines, then one `end`); a timeout keeps `first_output_ms`, `stdout_bytes`, `stream_events` and
  `last_event_type` and stays `timeout`.
- **A2:** `--ignore-user-config --ignore-rules`; `model` and `model_reasoning_effort` read read-only
  from the user's Codex configuration and passed only when set and valid (`route_settings` in the
  report); probes send the review's own command line, and Codex input cells carry the isolation in their
  command shape, so 1.16.1 evidence reads as reprobe once. Codex generation is unchanged.
  Live evidence, 30 September 2026 (disclosed quota, D6): a synthetic review from the candidate
  returned a valid `momm-peer-review/3` answer with preflight version 0.157.1 and model and effort from
  the user's configuration; with four MCP servers configured (three local processes), the process tree
  of a candidate run started none of them, while the same run under installed 1.16.1 started all three.
- **A1 and follow-ups:** one launch resolver for every platform, also in the updater (including
  `--check-all`), direct probe runs and the Setup Center's terminal and browser helpers.
- **B2 and A3:** typed claims (merge keeps the most blocking type; severity still gates; recorded
  re-typing only) and image observations bound to a sent attachment's sha256 and pixel bounds, under
  peer contract `momm-peer-review/3` (sealed /2 reports still validate).
- **B1 and C1:** role briefs are versioned files in `momm/roles` with a review date; the report records
  `role` and `role_brief`; the loophole checklist is on the adversary only.
- **B3 and C2:** `--cover` with one attempt budget per piece and role, never after a login or quota
  failure, and family-gated votes that the validator recounts; a seeded 200-case split property test and
  a depth-5 step-alphabet property test for retries, covers and splits.
- **B4:** `style` decided from the bytes by `style-classifier.mjs` (directives, whitespace-significant
  and unclassifiable files fail closed); `checks.mjs --phase mutation` recorded and reported, never
  required; the validator reports `stale` against the installed dispatcher, peer contract, process
  scope, governor, file-based guidance, role brief hashes and recorded command fingerprints (CLI
  versions, models and attachments are `unknown`), and the receipt carries it.
- **B5:** `--second-look <run> --finding <id>` sends one claim to one route that was not its source and
  writes a separate `momm-second-look/1` report; the original is never changed.
- **B6 and A6b:** an optional `role` on decision rows (a cover's rows carry the role it covered) and the
  scorecard's per-route, per-role roster reading `covers[]`, labelled as this project's governor
  decisions; `update.mjs --release-claim <token>` removes only `update.active`, only for the exact token
  and a process that is not running, and the refusal prints it before the recovery command.
- **A7 (per D1):** opt-in `MOMM_EVIDENCE_HOME` / `--evidence-home` resolves, through
  `evidence-location.mjs`, to a private per-project folder named by a hash of the project's real path,
  refused inside the project; every evidence reader and writer follows it; the default is unchanged.
- **E:** the rounds command (`generation-rounds.mjs`) with a fake-runner suite; the ledger shows
  generated pictures only while their bytes match their hash. Blind copies keep any provider metadata
  inside the image file. The second live pilot is optional (D7).
- **A6:** on `drills/momm-1.17`, the interrupted-upgrade step; rehearsal 1 (run 36635871345) found the
  stale claim, rehearsal 2 (run 36637157857) passed all six cells.
- **Docs on `main`:** roadmap now and next and the Improvement page status (PR #30), merged into this
  branch.
- **Owner decisions D1 to D10:** delegated to the recommended options on 29 September 2026 ("complete
  any and all outstanding items").

Release gates still open: gate 1 on the sealed commit, gate 2 on its signed checkpoint, gate 3 (the
self-review of this delta), gate 5 (one live image review), and gate 6 (the owner's go-ahead). The
A4.2 diagnostic range run is part of gate 3.
