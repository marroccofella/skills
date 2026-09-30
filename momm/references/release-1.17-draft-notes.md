# MOMM 1.17 — draft notes (not released)

User-visible changes, collected as each work package lands. Wording is provisional until the
release notes are written.

- **Project review rules need trusting once.** A `.reviewrules` file that arrives with a cloned repository is no longer applied until you trust its exact hash; MOMM prints the file's hash and the one command to trust it. A changed file needs trusting again. (1.16 applied it for one release with a warning.)
- **Reviewer readiness in reports is real again.** The version and login check now finishes before reviews start, so reports no longer show every route as "timeout" while it reviews normally. It adds about a second.
- `--split` never cuts between removed lines and the added lines that replace them. A replaced block larger than the ceiling (for example one changed long line in a minified file) is now reviewed by the panel as a piece of its own, over the ceiling, up to the 2 MB split cap, instead of becoming governor_direct scope; such pieces carry `over_ceiling: true` in the `split` event and report. (A4.1)
- `--split` with Grok among the reviewers caps the ceiling for the whole run at 20 KB, so every route reviews the same pieces and Grok is not sent pieces it timed out on; the report records `split.ceiling_capped_for: ["grok"]` and `split.ceiling_requested_bytes`. Runs without Grok are unchanged. (A4.3, piece ceiling)
- A reviewer CLI (or Git) installed only inside the reviewed project is now reported as not installed on macOS and Linux too, as it already was on Windows: MOMM launches a bare name only from an absolute PATH entry outside the project, checks the executable's real path, and removes project entries from the child's PATH (plan A1).
- **A stale update claim can be released with one command.** If an updater is killed mid-update, recovery still refuses while its `update.active` claim remains (PIDs are reused, so MOMM never takes a claim by itself), but the refusal now prints `node "<state dir>/update.mjs" --release-claim <token>` followed by the recovery command. After you confirm no updater is running, that command removes only the claim, and only when the token matches exactly and the recorded process is not running; `transaction.json` and `momm.lock` are left alone. It cannot be combined with `--apply`, `--dry-run` or `--rollback`. (A6b, found by the 1.17 drill rehearsal)
- **Route and role roster in the scorecard.** `scorecard.mjs` (`--json`, Markdown and `--html`) adds a table per route and role: valid-review rate, reproduced-claim rate (applied findings with a failing-before record), false-`CRITICAL` rate (`CRITICAL` findings rejected after an investigation), median review time and cover success (read from the report's `covers[]`: each cover is a review asked of the covering route in the role it covered). Empty denominators read "no data", not 0%. It is labelled as this project's governor decisions, not a benchmark, and nothing routes on it. Decision rows may carry an optional `role`, which `governor.mjs --run` checks against the report; without it, the role comes from the report (`role`, else `persona`). (B6)
- **Codex reviews no longer load your Codex setup (A2).** Codex reviewers run with `--ignore-user-config --ignore-rules`, so your MCP servers, global instructions, skills and execpolicy rules stay out of the review. The model and reasoning effort you chose (`model` and `model_reasoning_effort` at the top of `$CODEX_HOME/config.toml`, else `~/.codex/config.toml`) are read, never written, and passed explicitly with `-m` and `-c model_reasoning_effort=`; when you set neither, none is passed and Codex chooses. A value that is not a plain id (letters, digits, `.`, `_`, `-`) is left out with a notice. Each Codex entry in the report carries `route_settings`: the model and effort used and whether each came from your configuration (`user_config`) or Codex's default (`codex_default`). The file's path is not recorded. Login still uses `CODEX_HOME`. Codex probes (`probes.mjs`) now send exactly the review's command, so Codex input-cell evidence recorded by 1.16.x reads as `reprobe` once; run the Codex probe again to route those cells.
- **Grok reviews stream their output (A4.3).** Grok now answers with `--output-format streaming-json`, so a Grok review that runs out of time still records when its first output arrived (`process_progress.first_output_ms`), how many bytes came (`stdout_bytes`), how many events and the last event's type (`stream_events`, `last_event_type`). It stays a `timeout`; a partial answer is never accepted, and the deadline is unchanged. A stream that is malformed, stops for any reason other than `end_turn`, or never states how it stopped is `invalid_output`. The stream format is the one Grok CLI 1.0.41 prints (verified on a live capture).
- The updater (`update.mjs`, including `--check-all`), direct `probes.mjs` runs and the Setup Center's terminal and browser launchers follow the same rule on macOS and Linux: a Git, CLI or `osascript`/`open`/`x-terminal-emulator`/`xdg-open` found only inside the project (or the skills clone, for the updater) is treated as not installed, and the Setup Center takes those helpers from /usr/bin or /bin first.

- **Role briefs are versioned files (B1).** Each reviewer persona (surgeon, architect, adversary, verifier, fresheyes, innovator, socratic, futureproof) is now a *role* brief in `momm/roles/<role>.md` with a version and a review date, kept apart from the route that performs it. Every reviewer entry in the report records `role` and `role_brief` (`version` and the sha256 of the file), and the guidance persona layer is hashed from the same file. The brief texts, and so the prompts, are unchanged; `--personas` works as before. A brief past its review date still applies and is listed in the report's `notices` and on stderr. The update preview now shows changes to `momm/roles`.
- **Loophole checklist for the adversary (C1).** The adversary brief includes `momm/roles/checklists/loophole.md`: four themes (letter against spirit, categorical arbitrage, temporal latency, compositional blind spots) and five techniques (boundary values, intent anchoring, invariants, payoff auditing, sunset and review triggers). Findings raised through it must still quote the artifact and name a concrete sequence of steps. No other role carries it; the adversary's `role_brief.checklist` records its version and hash.
- **Role cover, opt-in (B3).** With `--cover`, when a route's review of a piece ends `timeout`, `invalid_output`, `provider_unavailable` or `error`, MOMM sends the same role brief once to another requested route (never the governor or the failed route), with a line naming the failure status and no other reviewer's claims. One budget of two invocations per piece and role covers the outage retry, `--retry-invalid` and the cover, so an outage that was already retried is not covered. A login, quota, retired tier, exclusion or cancellation is never covered. Covers are reported under `covers[]` (`covering_for`, `covered_status`, `role`, `role_brief`, `counted_for_quorum`) and in each split piece's `roles_covered`, never as native reviews. A cover adds a quorum vote only when its model family is known and new to that piece; the family table is reported as `model_families` (version 1: codex OpenAI, claude Anthropic, antigravity and gemini Google, grok xAI, copilot unknown). The completion validator recounts cover votes, refuses a cover beyond the budget, and treats a cover's suggestions as items to rule on.
- **Invariants as property tests (C2).** Every sequence of retry, retry-invalid, cover, split, re-type and re-severity up to depth 5 is run from seeded starts; none may reach a third invocation for one piece and role, a second vote for one model family from a cover, a merged claim type below a source, or a lowered type or severity without a recorded decision row.
- **A second look at one claim (B5).** `multi-review.mjs --second-look <run_id> --finding <finding_id> [--reviewers <route>]` sends that one finding, fenced and labelled as untrusted data, with the original artifact to exactly one route that was not among its sources and is not the governor, and asks it to CONFIRM or REFUTE the claim; the answer must quote the artifact and may not add findings or suggestions. The artifact is taken from the stored input or re-read from the source snapshot and must match the report's `input_sha256`; otherwise the command refuses. The result is a separate report, `.ensemble_reviews/second-looks/<id>.json` (`momm-second-look/1`), linked to the run and finding, plus one `review-log.jsonl` line naming both ids; the original report is never changed. This is the register's `--cross-check`, narrowed to one claim and never a debate.

## Peer contract `momm-peer-review/3`

- **Typed claims (B2).** A reviewer may label each finding with a `claim_type`: `DEFECT`
  (reproducible), `RISK` (plausible, needs a probe), `QUESTION` (a missing assumption), `IDEA`
  (optional) or `NOISE` (style, taste, out of scope). The field is optional; an answer without it is
  still valid and the claim is untyped. An unknown value is refused as invalid output.
- When findings from several reviewers merge, the report keeps the most blocking type of its sources;
  a merge never lowers it.
- Severity still gates on its own: a `CRITICAL` or `WARNING` finding needs reproduction whatever its
  type, so a real defect typed `IDEA` still blocks.
- The governor may re-type a finding, or change its severity, only in its decision row, recorded as
  `claim_type` + `retyped_from` + `retype_reason` (or `severity` + `severity_from` +
  `severity_reason`) against the report's value. `governor.mjs --run` refuses an unrecorded change.
  See `references/governor-completion.md`.
- **Image observations (A3).** In a review with attachments, a reviewer may cite what it saw in an
  attached image by the attachment's full sha256 (`attachment_sha256`, `observation`,
  `assessment`, optional `region`). The digest must name an attachment sent in that run; a region
  must lie inside the image's pixel bounds, read from the image header (PNG, JPEG, GIF, WebP, BMP).
  When the bounds cannot be read, the region is kept and marked `region_unchecked`. Observations
  are recorded as unverifiable (`kind: "observation"`), never as quotes, and at least one entry must
  still quote the text brief. Observation entries in a run without attachments are refused.
- The attached-media section of the review contract now lists each attachment's full sha256 and,
  when known, its pixel size. Report attachment descriptors record `width` and `height` when the
  header states them.
- Reports sealed under `momm-peer-review/2` (1.16.x) still pass the completion validator and the
  attempt audit; their findings are untyped.
User-visible changes on the 1.17 branch, collected as they land. Not a release note until 1.17 is
released; wording will change.

## A harder accept gate (B4)

- **`style` is checked, not trusted.** The completion validator now reads the bytes of every file a
  `style` decision touched. Each changed line must be whitespace, or a comment before and after the
  change. Commenting out a line of code, editing a tool directive such as `eslint-disable`,
  `@ts-expect-error` or `noqa`, and re-indenting Python or YAML are behavior changes. Files with no
  known comment syntax (Markdown, JSON, HTML and others), binary and generated files fail closed to
  behavior. A refused label leaves the item open with a reason such as
  `change_kind style refused: src/a.js:12 changes code`. A style decision needs the reviewed bytes:
  record a before check for it (it may pass) or review with `--store-input`.
- **Recorded mutation (optional).** `checks.mjs --phase mutation --item <id> --test <t> --artifact <f>`
  records the decision's test run with only that decision's change reverted. The validator reports
  `mutation: {applied_decisions, with_mutation_record, mutation_survived, invalid}`; a mutation that
  still passes is a warning, never a refusal, and no count is presented as proof.
- **Stale reviews.** The validator reports `stale: {stale, changed, unknown, matched}`: whether the
  installed dispatcher, peer contract, process scope, governor, file-based guidance or recorded command
  fingerprints differ from those the review ran with. Reviewer CLI versions, models and attachments
  cannot be confirmed offline and are listed as unknown. A stale review can still be completed; the
  receipt records the block (field names only, no hashes or text). Each reviewer's and cover's role
  brief (and the adversary's checklist) is compared by file hash with the installed `momm/roles`
  (B1); a role recorded without its brief hash is unknown.
User-visible changes collected while 1.17 is built. Nothing here is released until the 1.17 gates pass.

## Guided image generation (plan E1 to E3)

- New command `momm/scripts/generation-rounds.mjs` runs guided image generation one round at a time:
  `start`, `checklist`, `confirm-checklist`, `question`, `round`, `blind`, `critique`, `reveal` and
  `gallery`. Its state is kept privately in `.ensemble_reviews/generation/<gen_id>/state.json` (or the
  project's folder under `MOMM_EVIDENCE_HOME`)
  (schema `momm-generation/1`).
- If no route can make a picture, it says so first ("nothing can make a picture"), names what clears
  each blocker, and stops.
- The user's words are stored byte for byte and reach every image maker unchanged in every round. The
  governor's intent checklist sits beside them and is confirmed by the user before anything is sent.
- No round runs without `--consent`, and each round needs its own costed question naming the makers
  and the number of pictures. A round the user was not asked about is refused.
- Notes rounds send each maker only the governor's notes on its own picture, in a labelled section after
  the user's words, and attach its own previous picture (by hash) only if it can take images in. A
  picked suggestion travels as the governor's notes; the user's added words travel in their own section.
- A combine round shares every picture with every provider taking part and needs a separate yes,
  recorded as `--share-all`; makers that cannot take images in get the notes only.
- The governor judges pictures blind (labelled A, B, C in a random order). Every checklist item needs
  a result for every picture, with visible evidence for each `met`, `partly` or `missed`. The critique's
  hash and time are saved before the makers are revealed.
- A maker that refuses or fails is recorded with the provider's reason; MOMM never rephrases the user's
  words to get past a refusal.
- A private local gallery shows every picture, labelled AI-generated, with what each maker received
  (by hash, plus the readable words and notes), the critique and the suggested rounds. It is never
  published.
- The private ledger's "Generated pictures" section now shows, for a picture made in a guided
  generation, its round and, once that round is revealed, the governor's critique summary.

## Evidence outside the project (opt-in)

- Set `MOMM_EVIDENCE_HOME=<dir>` (or pass `--evidence-home <dir>` to `multi-review.mjs`) to keep a
  project's private evidence under `<dir>/<hash of the project's real path>/` instead of
  `.ensemble_reviews/`. Two projects with the same folder name get different folders.
- The default is unchanged: without the setting, evidence stays in `.ensemble_reviews/` exactly as before.
- The same privacy rule applies wherever the folder lives: MOMM creates it private and refuses a
  broadened one before reading or sending anything. A location inside the project, by its literal or
  its real path, is refused with both paths named.
- The folder holds a `project.json` marker naming the project it belongs to; the ledger shows it.
- Reviews, attempt records, `checks.mjs` (including `--phase mutation`), `governor.mjs`,
  `attempt-audit.mjs`, the ledger, the scorecard, generated media, guided generation rounds (state,
  blind copies, critiques and gallery), second looks, `evidence --status` / `evidence --protect`, the Setup Center (ledger
  view, status link, usage panel, watched folder, setup-center pointer), the probe ledger
  (`probes.jsonl`) and `update --check-all`'s last-review search all use the resolved folder. A setting
  that cannot be honoured shows no evidence; it never falls back to the in-project folder.
  Report references keep their `.ensemble_reviews/...` spelling in both modes.
- No `.gitignore` rule is added when the evidence lives outside the project.

## Quotation refusals are diagnosable (private)

- When a reviewer's answer is refused because a `reviewed_scope` quote is not in the artifact, the
  private attempt record now keeps, for each failing quote, its SHA-256, its length, its first 80
  characters after the usual secret redaction, and which comparisons were tried. The answer itself is
  never stored, and nothing new appears in the report.
