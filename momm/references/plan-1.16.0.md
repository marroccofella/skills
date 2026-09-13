# MOMM 1.16.0 plan — measurement, ratings, guidance, throughput, upkeep

Status: revision 2, 2026-09-13, after momm review run `rev_20260913112156_t8ik` (Codex MODIFY, Grok MODIFY, Antigravity ACCEPT; 13 findings, 12 suggestions, all applied — dispositions in the private ledger). Baseline is the 1.15.0 candidate (branch `release/momm-1.15.0`, cb3833d). Nothing here is built.

Each epic names what exists today, what changes, how it is proven, and what it must not break. The 1.15.0 release holds ship first and are not 1.16 work: evidence-cap streaming, the governor path in SKILL.md, the shallow-fetch promotion failure in `update --apply`, and Grok's exact-quote rejection rate. E6 below only adds the regression test for the shallow fetch; the fix itself is a 1.15 deliverable.

Ordering principle: measurement first (E1, E2), because the guidance, scheduling and update work all need numbers to prove they helped.

## E1 — Token and cost accounting per review

**Today.** No route reports tokens. The dispatcher records `duration_ms`, `input_bytes` and `process_progress` and nothing about model usage. Some CLIs already return usage the adapter discards: Claude's `--output-format json` carries `usage.input_tokens`, `output_tokens`, `cache_read_input_tokens`, `total_cost_usd`; Grok's JSON carries `usage.input_tokens`, `output_tokens`, `reasoning_tokens`, `total_cost_usd`, `modelUsage`; Codex prints `tokens used N` in plain mode and emits `token_count` events in `--json`; Antigravity's envelope has `duration_seconds`, `num_turns` and no token fields; Copilot's JSONL has not been checked.

**Change.**
- Two separate fields per reviewer result, never merged:
  - `usage_reported`: `{ input_tokens, output_tokens, reasoning_tokens, cached_tokens, total_tokens, cost_usd, model, cli_version }` parsed from the CLI's own envelope, or `null` when the CLI reports nothing. A per-route note records what each count includes: whether cached tokens are inside `input_tokens` (Claude: separate field; Grok: separate `cache_read_input_tokens`; Codex: `tokens used` is a total) and whether reasoning tokens are inside `output_tokens` (Grok: separate; Claude: `output_tokens_details.thinking_tokens` inside output).
  - `input_estimate`: `{ chars, tokens_est }` computed by the dispatcher (chars / 4) for every route, always labelled an estimate.
- Rollups (`report.usage_totals`, ledger track record) use `usage_reported` only, and every aggregate carries `coverage`: the fraction of reviews in the window that reported usage, so a route with no data shows "0 of 12 reported" rather than a zero. Cost per accepted finding is computed only from rows with non-null cost and at least one accepted finding; with zero accepted findings the cell shows "no accepted findings", never a division result.
- Stream a `reviewer.usage` event so the Setup Center and `--stream` consumers can show it live.
- Public export: usage rolls into `momm-evidence.json` and the CSVs with the same sanitisation as everything else, `coverage` included. Cost is shown only where the CLI reported it, captioned "as reported by the CLI".

**Proof.** Fixture replies for each route with known usage fields parse to exact numbers; a route with no usage yields `null` and coverage counts it as unreported; rollup tests cover zero accepted findings and zero reported rows. One live run per route shows the numbers in the report and ledger.

**Must not break.** Report schema stays `momm-report/1` with additive fields; the completion validator ignores usage; sanitiser still strips ANSI before parsing.

## E2 — Reviewer ratings: quantitative track record plus qualitative rating

**Today.** `ledger.mjs` computes per-route acceptance rate (applied / (applied + rejected)), false-positive rate, completion rate, timeouts, median findings per review and severity-weighted utility. There is no qualitative rating, no per-persona or per-size breakdown, no trend over time, and no way to record "this review was useful" separately from "this finding was applied".

**Change.**
- Keep the quantitative record as the primary signal and add three cuts: by persona, by input-size bucket, and by 30-day window with a sparkline.
- Governor-recorded qualitative rating per review, written at disposition time into `dispositions.jsonl` as an optional row kind `review_rating`: `{ run_id, reviewer, rating: 1..5, tags: [...], note }`. Tags are a fixed vocabulary (`specific`, `reproducible`, `off-artifact`, `boilerplate`, `hallucinated-lines`, `late`, `unique-catch`) so they aggregate. SKILL.md gains one sentence requiring the rating after triage.
- Ledger shows both per route: acceptance rate and mean rating with tag frequencies, with the caption that both are the governor's own judgement, not ground truth.
- Route recommendations derive from thresholds in one table, and only when the window holds at least 10 completed dispatches for that route and size bucket; below that the cell reads "insufficient data (n)". `cancelled_after_quorum` outcomes (E5) are excluded from completion rate and shown as their own count, so early exits can never make a route look unreliable.
- Public export carries ratings and tags with reviewer names; free-text notes stay private.

**Proof.** Fixture ledger with known rows produces expected rates, ratings, minimum-n behaviour and recommendation strings; self-test covers empty windows, a route with ratings but no dispositions, and a window of cancellations only. Live: run 1.16 on itself and inspect the panel.

**Must not break.** Existing rows without ratings keep working; `computeTrackRecord` stays null-prototype and additive.

## E3 — Dashboard: theme toggle, live usage, guidance editor

**Today.** The Setup Center is light-only with no `prefers-color-scheme` handling; the ledger page is the dark 42.uk theme, static, regenerated on demand. Neither shows token usage or lets the user edit reviewer guidance.

**Change.**
- Theme: one token set for both pages, `prefers-color-scheme` respected by default, a toggle persisted in `localStorage`, `data-theme` on the root; charts re-palette on toggle. Validate contrast with the existing chart-palette checker.
- Usage panel in the Setup Center after each verification run and in the ledger per run (from E1), showing coverage.
- Guidance editor (E4): lists governor guidance, global reviewer guidance and each route's guidance; saves to the project's `.momm/guidance.json` through the local server with the same confirm-the-exact-write pattern the CLI update buttons use, and refuses the write when the on-disk file changed since load. The "effective prompt preview" shows exactly the contract text plus resolved guidance with a literal `<artifact omitted: N bytes>` placeholder after the delimiter. It never renders source, and it is labelled as the prompt minus the artifact so delimiter and ordering bugs are still visible.
- Ledger regeneration while the Setup Center is open watches both `.ensemble_reviews/review-log.jsonl` and `.ensemble_reviews/dispositions.jsonl`, debounced, so ratings and dispositions written after a run refresh the page too.

**Proof.** Dashboard regression suite gains: toggle persists across reload; both themes pass contrast checks; guidance edit round-trips byte-exact and refuses a stale write; the preview contains the placeholder and no artifact bytes; a disposition append triggers regeneration.

**Must not break.** Setup Center stays local-only, reads no source code, never stores credentials; every write still needs the exact-command confirmation.

## E4 — Guidance prompts for governor and reviewers, global and per route

**Today.** Two mechanisms exist and are not user-facing: personas (`--personas codex=surgeon,...`, fixed texts in the dispatcher) and project `.reviewrules` (repository-controlled text appended to the contract). There is no way to give the governor standing instructions, no per-route free text, and no precedence rule between them.

**Change.**
- One file, `.momm/guidance.json` per project, with an optional user-level default at `~/.momm/guidance.json`: `{ governor: "...", reviewers: { "*": "...", codex: "...", grok: "..." } }`, each a bounded plain-text block (cap 2 000 characters, no control characters, scanned by the sanitiser like any input).
- Trust: project-level guidance is repository content and can arrive with a clone, so it is applied only after the user has trusted that exact file hash once (`momm guidance --trust` or the Setup Center editor, which trusts what it saves). An untrusted or changed project file is ignored with a visible notice in the report and stream; `.reviewrules` gets the same trust gate in 1.16, with a one-release grace where it stays auto-applied but warns.
- Layers append, never replace, in this order, lowest first: built-in persona → user-level `*` → user-level route → trusted project `.reviewrules` → trusted project `*` → trusted project route → `--guidance-file` → `--guidance codex="..."` → `--personas`. Later layers cannot delete earlier text; a run with no guidance produces a prompt byte-identical to 1.15.
- Reviewer guidance is appended inside the contract before the artifact delimiter with the same "never the schema, never the truthfulness" framing personas use; it cannot lift the read-only rules or the JSON contract. Containment stays in adapter flags, not prompt text.
- Governor guidance is a runtime prefix printed for the current process (in the report's `governor_guidance` field and at the top of `--pretty` output). SKILL.md is never modified by this feature; the signed skill stays byte-identical to its manifest.
- Provenance: the report stores `guidance_sha256` per layer and per route plus the resolved text in a local-only sidecar `.ensemble_reviews/guidance/<run_id>.json`. Public export carries hashes only; user-level and project text never leaves the machine.

**Proof.** Precedence table tested exhaustively with fixtures, including `.reviewrules` and `--guidance-file` at every position; oversized or control-character guidance rejected before dispatch; untrusted project guidance ignored with the notice present; report carries hashes and the sidecar carries text; export test asserts no guidance text in `momm-evidence.json`; a canary shows a reviewer guidance line cannot re-enable tools.

**Must not break.** Runs with no guidance produce byte-identical prompts to 1.15; `.reviewrules` keeps working through the grace release.

## E5 — Throughput: chunking, lane scheduling, bounded parallelism

**Today.** Reviewers already run concurrently within one run. There is no built-in splitting of large inputs, so a 135 KB diff either times out on Grok and Antigravity or the governor chunks by hand and runs lanes with shell scripts, as was done for the 1.15 gate. Timeouts are static per route and there is no machine-wide cap on concurrent CLI processes.

**Change.**
- `--split auto|<KB>`, default off in alpha and beta. Splitting is file-first: whole files stay together while under the ceiling; only files over the ceiling are split at hunk boundaries, and every piece repeats the `diff --git` / `---` / `+++` header plus three context lines so each piece is a valid diff whose quotes still corroborate. The ceiling is the minimum across the active routes so piece boundaries are identical for all reviewers.
- Oversize units: a single hunk larger than the ceiling is dispatched unsplit as an `oversize_piece` only to routes whose hard limit admits it, marked in the report, and never silently dropped. If no route admits it, the run reports it as unreviewed scope and the governor reviews it directly. Line-splitting a hunk is not permitted.
- Parent/child semantics: pieces are sub-runs with `parent_run_id`; the parent report merges findings with per-piece provenance and cross-piece corroboration by finding identity and quotation. `--min-success` applies per piece; the parent is complete only when every piece met its quorum, otherwise it exits 3 listing the failing pieces. The completion validator sees the parent run and its piece list.
- Scheduler: global concurrency cap (`--jobs`, default number of routes, hard cap 6) and per-route caps (Antigravity 2, Grok 2 by default), queueing pieces. Progress flows through existing `--stream` events with `piece` and `parent_run_id` fields.
- Adaptive timeouts: base timeout scaled by piece size using the route's median seconds per KB from the E2 buckets, floored at the current default.
- Early exit after quorum is opt-in (`--early-exit`), skipped for any route whose track record sets a "do not early-exit" bit (unique-catch rate or exact-quote share above threshold), records `cancelled_after_quorum`, and is excluded from completion statistics (E2).
- `--split auto` becomes the default only after at least five live runs on inputs over 100 KB beat the manual-lane baseline on wall-clock without loss of quorum rate or of coverage on a fixture set of defects that span files and hunks.

**Proof.** Splitter tests: every piece is a valid diff with headers; never splits inside a hunk; never produces an empty piece; reassembly is truncation-free; oversize hunks are flagged. Scheduler tests with fake processes for caps, queue order, cancellation and the no-early-exit bit. Coverage fixture: split and unsplit reviews of defects that span pieces must find the same defects. One live gate on the real 135 KB diff with numbers in the release notes.

**Must not break.** A single small input runs exactly as in 1.15.

## E6 — Easier updating: skill, reviewers, CLIs

**Today.** 1.15 introduced the signed updater (`update.mjs`: manifest check, dry run, explicit apply, rollback, receipts) and the Setup Center's CLI version table with confirmed update commands. Legacy unsigned releases cannot be installed by the updater and are handled by the 1.15 bootstrap path; that stays as designed and is out of scope here. Reviewer CLI updates are one button per CLI with no batch and no "what changed", and a custom-dir install has no Setup Center update path.

**Change.**
- Regression test for the shallow-fetch promotion using the 2026-09-13 reproduction (three-commit source, root at base, depth-1 staging), asserting `refs/momm/verified` is created; the fix itself lands in 1.15.
- `update --check-all`: one command that reports the skill version, every reviewer CLI's installed and latest version, and the last successful review per route, as one table and one JSON, for harness and custom-dir installs alike.
- Custom-dir installs become first-class in the Setup Center: the receipt's `custom_dirs` are listed and `update --dry-run` / `--apply` work against them with the same confirmation.
- CLI batch update in the Setup Center: select several, see the exact commands, confirm once, run sequentially, re-verify versions after each; refuse package-manager-owned paths as today.
- After any CLI update, re-run that route's canary probes automatically (tool containment and a one-line review) and record the result against the new version in the ledger, because 1.14→1.15 showed containment flags change meaning between CLI versions.
- Release notes surfaced in the Setup Center from the signed manifest before apply; protocol changes shown as a diff, as 1.15 does in the terminal.

**Proof.** The shallow-fetch fixture passes; `--check-all` output validated against `--version` of each CLI for both install kinds; batch update tested with a fake registry; canary probes recorded with CLI version in a fixture ledger.

**Must not break.** No automatic updates, ever; every apply needs the explicit command; OAuth logins untouched by updates.

## Sequencing and size

1. Release 1.15.0 (holds closed, signed tag, Pages).
2. 1.16.0-alpha: E1 + E2 (measurement). Two to three days of work plus a week of collecting numbers.
3. 1.16.0-beta: E4 then E3 (guidance, dashboard), because the editor needs the guidance model and its trust gate.
4. 1.16.0-rc: E5 (throughput, split off by default) using E1/E2 numbers to prove it, then E6.
5. Release gate as for 1.15: local suites, OS matrix CI, momm review of the release diff with quorum on every piece, privacy scan, signed tag.

## Non-goals for 1.16

API-key routes; automatic updates; executing reviewer-supplied test snippets; new reviewer families (Kimi, Mistral), tracked in `references/cli/candidates.md`; any change to the read-only containment model; modifying SKILL.md at runtime.

## Open questions for the owner

- Should ratings be public in the evidence page, or private only? Default in this plan: public numbers and tags, private notes.
- Is a per-route cost figure acceptable on the public page when only two routes report cost? Default: show "as reported by the CLI" with coverage, blank otherwise.
- Should `.reviewrules` lose its auto-apply after the grace release, or keep it for repositories the user owns? Default: trust gate for both, one-release grace.
