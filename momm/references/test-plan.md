# MOMM acceptance test plan

A self-contained conformance plan for the **unreleased momm 1.12.1 candidate**. Hand this whole file to a fresh agent session (any harness), have it run the exercises in order, and paste its filled-in results back to the requester for verification. A passing plan does not publish the release; tagging, release publication, and the update manifest remain separate gates.

## How to use this plan

**For the tester (the fresh session):**

1. Run every exercise in order. Do not skip one because you "expect" it to pass.
2. **Paste raw output, not summaries.** Exit codes, run IDs, and digests are the evidence. A prose claim that something "worked" is not a result.
3. If an exercise fails or behaves unexpectedly, **report it exactly as it happened**. A failed exercise honestly reported is a successful test run; a passed exercise that was never executed is a corrupted one.
4. Never edit source files to make an exercise pass. This is a read-only conformance check.
5. Fill in the Results Template at the end and return it verbatim.

**Golden rule:** every claim must be traceable to output you actually saw. If a command did not run, write `NOT RUN` and why.

### Setup

```bash
# CHECKOUT = the absolute canonical skills checkout being tested (the directory
# that contains install.mjs plus the momm/, myskills/, myrepo/, and
# yorkshire-pudding/ directories). Do not infer it from one harness's discovery
# directory: Codex, Claude, Gemini, and Antigravity use different link roots.
CHECKOUT="/absolute/path/to/skills"
SKILLS="$CHECKOUT"
REPO="$CHECKOUT"

MOMM_ROOT="$CHECKOUT/momm"
MOMM="$MOMM_ROOT/scripts/multi-review.mjs"
LEDGER="$MOMM_ROOT/scripts/ledger.mjs"
COMPLETION="$MOMM_ROOT/scripts/review-completion.mjs"
GOV="claude"   # <-- SET THIS to the harness you actually are: codex|gemini|claude|antigravity|copilot|grok|other

node "$MOMM" --version      # record this; every later result must come from this version

# One isolated but durable project for the whole run. Do not use /tmp: MOMM
# correctly refuses reviewer calls when evidence could be cleaned mid-review.
WORK="$(mktemp -d "$HOME/momm-acceptance-XXXXXX")"
git -C "$WORK" init -q
git -C "$WORK" config user.email "momm-acceptance@example.invalid"
git -C "$WORK" config user.name "MOMM Acceptance"
printf "acceptance fixture\n" > "$WORK/.acceptance-root"
git -C "$WORK" add .acceptance-root && git -C "$WORK" commit -q -m fixture
cd "$WORK"; echo "durable scratch project: $WORK"
```

Exercises B–H write private telemetry into `<git-root>/.ensemble_reviews/`, which is `$WORK/.ensemble_reviews/` even if a command runs from a nested directory. MOMM adds only a local `.git/info/exclude` rule, so the worktree stays clean. Note the scratch path in your results and delete it yourself only after the completion evidence has been inspected.

**Authentication prerequisite for section D:** D makes real model calls. Before starting D, run `node "$MOMM" --preflight --governor <you>` and make sure **at least one non-governor route shows auth evidence**. If none does, complete that provider's browser login first (its `login_hint` gives the exact command) — or record D as `NOT RUN — no authenticated route` and continue. Sections A–C and E–H do not need any reviewer login.

---

## A. Install and discovery

### A1 — Skill discovery across harnesses
**Goal:** every skill is linked and callable by name.
```bash
ls "$SKILLS"                                          # what is actually installed
node "$REPO/install.mjs" --target codex,claude --dry-run --pretty   # if you have the checkout
```
If `$REPO/install.mjs` does not exist, you are testing an install without its source checkout — record that and rely on the `ls` result alone.
**Expected:** the skills directory contains `momm`, `myrepo`, `myskills`, `myvoice`, `promptus-clone-voice`, `yorkshire-pudding`, `yorky`. A dry-run reports `already_linked` or `would_link`, never `conflict`.
**Paste back:** the skill list, and any `conflict` lines.

### A2 — All skills run together
**Goal:** the aggregate health check works and is honest.
```bash
node "$SKILLS/myskills/scripts/run-all.mjs" --pretty
echo "exit: $?"
```
**Expected:** a per-skill line for momm, myrepo, yorky, myvoice with a status each. Exit `0` only if every skill is `ok`. A skill whose engine is absent must read `unavailable` and the verdict must say so — it must **not** claim "all skills working".
**Paste back:** the full stderr summary block and the exit code.

---

## B. Zero-call safety (no model calls, no credentials read)

### B1 — Deterministic self-test
```bash
node "$MOMM" --self-test --pretty
echo "exit: $?"
```
**Expected:** `"passed": true`, every named check true, exit `0`. The checks include exact explicit timeouts, media signature/header screening, raw-claim preservation/correlation, metadata handling, partial-stage cleanup, link rejection and opened-source/path-swap binding, aggregate limits, attachment-only source isolation, aggregate artifact binding, and provider adapter contracts; none makes a model call. Record the live count instead of trusting a count frozen in this document.
**Paste back:** the `passed` value, the number of checks, exit code, and the name of any check that is `false`.

### B2 — Doctor
```bash
node "$MOMM" --doctor --pretty
echo "exit: $?"
```
**Expected:** a route inventory. **Zero model calls.** No credential *contents* anywhere in the output.
**Paste back:** the route list with each route's reported state.

### B3 — Preflight and governor self-exclusion
```bash
node "$MOMM" --preflight --governor "$GOV" --pretty
```
**Expected:** `model_calls_made: false`; **your own** (`$GOV`) route has `role: "governor"`; every other route reports install/auth evidence. Any unauthenticated route must carry a `login_hint` containing the provider's own browser-login command.
**Paste back:** `model_calls_made`, the `role` of your own governor route, and every `login_hint` **verbatim**.

### B4 — Setup Center safety contract
```bash
node "$SKILLS/momm/scripts/setup-ui.mjs" --self-test
echo "exit: $?"
```
**Expected:** `"passed": true`, **30 or more** checks including `host_allowlist`, `host_origin_http_enforced`, `loopback_only`, `provider_diagnostics_redacted`, `isolated_probe_ignores_rules_and_writes_nothing`, `shutdown_awaits_background_process_tree`, `controller_startup_parses`, and `every_provider_declares_review_modalities`.
**Paste back:** `passed`, check count, and any `false` check.

### B5 — Ledger and read-aloud contracts
```bash
node "$LEDGER" --self-test
echo "exit: $?"
```
**Expected:** `"passed": true`, every named check true, exit `0`. The checks cover local-voice-only speech, stale-callback and page-lifecycle cancellation, closed-vocabulary narration, hostile HTML escaping, honest no-verdict rendering, bounded attachment/region evidence, pending `0/N`, completion states, and non-ranking suggestion-decision counts. No speech engine or model is invoked.
**Paste back:** `passed`, check count, and any `false` check.

### B6 — Governor completion contract
```bash
node "$COMPLETION" --self-test
echo "exit: $?"
```
**Expected:** `"passed": true`, every named check true, exit `0`. Coverage includes exact obligations, separate raw correlated claims, peer gates, immutable digest anchors, lock namespaces, crash-tail recovery, temporary-storage relays, privacy-failure status, and refusal to adopt unrelated evidence.
**Paste back:** `passed`, live check count, and any `false` check.

### B7 — Deterministic fresh-user round trip
```bash
node "$SKILLS/momm/scripts/first-run-roundtrip.mjs"
echo "exit: $?"
```
**Expected:** `"passed": true`, every named journey step true, exit `0`. It uses no external provider and proves refusal-before-spend, Git-root storage, pending `0/N`, legacy-row non-authority, finalize/status, ledger rebuilding, temporary-risk relay, and structured status when privacy protection fails.
**Paste back:** the full output and exit code.

### B8 — Offline Setup Center UI contracts
```bash
node "$SKILLS/momm/scripts/setup-ui-contract-test.mjs"
echo "exit: $?"
```
**Expected:** `"passed": true`, **17 or more** checks, exit `0`, including the exact provider/modality matrix and the four-row provider card's mobile containment contract.
**Paste back:** `passed`, check count, and any `false` check.

---

## C. Security (these are the ones that matter most)

### C1 — DNS-rebinding defence on the live server
**Goal:** prove the running Setup Center refuses a spoofed `Host` and never leaks its session token. *(This was a real P0, fixed in 1.9.1 and strengthened in 1.10.0.)*
```bash
PORT=$((39000 + RANDOM % 2000))               # avoid collisions with anything already listening
node "$SKILLS/momm/scripts/setup-ui.mjs" --port $PORT --no-browser & SRV=$!
# Wait for readiness instead of guessing with sleep:
for i in $(seq 1 20); do
  curl -sf -o /dev/null -H "Host: 127.0.0.1:$PORT" "http://127.0.0.1:$PORT/api/session" && break
  sleep 0.5
done
echo -n "loopback: "; curl -s -o /dev/null -w "%{http_code}\n" -H "Host: 127.0.0.1:$PORT" "http://127.0.0.1:$PORT/api/session"
echo -n "spoofed:  "; curl -s -o /dev/null -w "%{http_code}\n" -H "Host: evil.example.com" "http://127.0.0.1:$PORT/api/session"
echo -n "bracket:  "; curl -s -o /dev/null -w "%{http_code}\n" -H "Host: [::1].evil.example" "http://127.0.0.1:$PORT/api/session"
echo -n "token leak count: "; curl -s -H "Host: evil.example.com" "http://127.0.0.1:$PORT/api/session" | grep -ci token
kill $SRV 2>/dev/null
```
**Expected:** loopback `200`; spoofed `403`; bracket `403`; token leak count `0`.
If the readiness loop never succeeds, the server did not start — report that rather than reporting the curl codes (all-`000` means "not tested", not "passed").
**Paste back:** all four values. **Any non-403 on a spoofed host is a critical failure — report it loudly.**

### C2 — API keys are never used
```bash
env | grep -iE "api[_-]?key|_token=" | wc -l      # informational: what exists in your env
node "$MOMM" --self-test --pretty | grep -iE "api_key|scrub|env"
```
**Expected:** the self-test includes an env-scrubbing/API-key check that passes. momm authenticates by OAuth only; **no exercise in this plan should ever require you to supply an API key.** If any prompt asks for one, stop and report it.
**Paste back:** the matching self-test lines, and confirmation no API key was ever requested.

### C3 — Unsupported media fails before dispatch and leaves no copy
**Goal:** prove that a requested text-only route cannot receive an image and that the private staging area is removed.
```bash
BEFORE="$(find "${TMPDIR:-/tmp}" -maxdepth 1 -type d -name 'momm-attach-*' 2>/dev/null | sort)"
node "$MOMM" --governor "$GOV" --reviewers copilot \
  --attach "$REPO/docs/momm/momm-poster.jpg" --no-ui >/dev/null 2>media.err; echo "exit: $?"
cat media.err
AFTER="$(find "${TMPDIR:-/tmp}" -maxdepth 1 -type d -name 'momm-attach-*' 2>/dev/null | sort)"
test "$BEFORE" = "$AFTER"; echo "temp-clean: $?"
test ! -e .ensemble_reviews/review-log.jsonl; echo "no-run-evidence: $?"
```
**Expected:** exit `1`; the error says no requested external reviewer can consume the image; `temp-clean: 0`; `no-run-evidence: 0`; zero provider calls.
**Paste back:** the exit/error and both final values.

---

## D. Live review dispatch

> D-exercises make real model calls through your OAuth sessions. If a route is unauthenticated it must **fail closed** with a status — that is a pass, not a failure.

### D1 — Baseline review of a known-good artifact
```bash
printf "FOR i = 1 TO 10\n    PRINT i\nNEXT i\nEND\n" > count.bas
node "$MOMM" --governor "$GOV" --input count.bas --label "acceptance D1" --no-ui | tee d1-report.json; echo "exit: ${PIPESTATUS[0]}"
```
*(Set `--governor` to whichever harness you actually are: `codex`, `gemini`, `claude`, `antigravity`, `copilot`, `grok`, or `other`.)*
**Expected:** a JSON report on stdout; the governor's own route reports `self_excluded`; a correct loop should draw ACCEPTs and no CRITICAL findings. The report says `review_complete: false` and its top-level `required_user_message` starts `MOMM REVIEW NOT FINISHED` even if every peer accepts. When the peer gate is met it includes `evidence.governor_work.pending_file` plus structured finalize/status commands; when the gate is blocked it exposes status only and no impossible draft.
**Note — no quorum flag here on purpose.** An unauthenticated route failing closed is a *pass* for this plan, and `--min-success` would turn that documented outcome into exit `3`. Quorum is exercised deliberately in G1 instead. If **every** reviewer failed closed, record their statuses (that is a valid, reportable result) and note that no verdict was obtainable.
**Paste back:** the `run_id`, each reviewer's `agent`/`status`/`verdict`/`confidence`, raw finding-claim obligation count, `review_complete`, `required_user_message`, and **the private ledger line printed on stderr**.

### D2 — Status vocabulary is closed
**Goal:** every non-success outcome is a *status*, never an invented error or a fabricated review.
**Expected:** every reviewer `status` in D1 is one of exactly:
`success`, `self_excluded`, `authentication_required`, `provider_unavailable`, `ineligible_tier`, `timeout`, `missing`, `invalid_output`, `disabled_no_oauth`, `unsupported`, `error`.
**Paste back:** the distinct status values you saw. Flag any value not on that list.

### D3 — Personas shape tone, never findings
Pick two routes that are **not** your governor and are authenticated:
```bash
R1=grok; R2=copilot     # <-- change if either is your governor or unauthenticated
node "$MOMM" --governor "$GOV" --input count.bas --reviewers grok,copilot \
  --personas grok=innovator,copilot=futureproof --label "acceptance D3" --no-ui
```
**Expected:** each reviewer entry records its persona. Personas may change tone and suggestions; they must not invent findings on correct code.
**Paste back:** the persona recorded per reviewer, and the findings count.

### D4 — Harmless live media witnesses (explicit sharing only)
**Goal:** verify each advertised adapter actually consumes a harmless synthetic/public fixture. Never use personal media, private source, credentials, biometric material, or a real person's voice for this exercise. Every `--attach` is an explicit per-file share authorization.

Run only routes that are authenticated, not your governor, and shown by Setup Center as capable. Use a newly generated image containing a random visible witness string, a one-page PDF containing a different witness, synthetic tones for audio, and a synthetic colour card for video. Raw PDF/audio/video also requires `--allow-unstripped-metadata`, which records that metadata was preserved by explicit opt-in. Audio requires the tester to own or have permission to share it; a generated tone satisfies that condition.

```bash
# Examples — replace the paths with harmless fixtures you generated for this test.
node "$MOMM" --governor "$GOV" --reviewers claude --attach witness.png --label "acceptance D4 image" --min-success 1 --no-ui
node "$MOMM" --governor "$GOV" --reviewers claude --attach witness.pdf --allow-unstripped-metadata --label "acceptance D4 pdf" --min-success 1 --no-ui
node "$MOMM" --governor "$GOV" --reviewers gemini --attach witness.mp3 --allow-unstripped-metadata --label "acceptance D4 audio" --min-success 1 --no-ui
node "$MOMM" --governor "$GOV" --reviewers gemini --attach witness.mp4 --allow-unstripped-metadata --label "acceptance D4 video" --min-success 1 --no-ui
```
**Expected:** each attempted capable route succeeds and describes the fixture-specific witness, not merely the shared text contract. Unsupported, unavailable, or governor routes are `NOT RUN`, never silently substituted. Codex image transport is verified only when Codex is not the active governor. Delete the fixtures after sealing the reports.
**Paste back:** fixture type/hash (not private paths), route/status, run ID, whether the witness was correctly identified, and any not-run reason.

---

## E. Evidence integrity

### E1 — Sealed report and input binding
```bash
ls .ensemble_reviews/reports/
node -e "const j=require('./.ensemble_reviews/reports/<D1_RUN_ID>.json');console.log('run',j.run_id);console.log('input_sha256',j.input_sha256);console.log('dispatcher_version',j.dispatcher_version);console.log('schema',j.report_schema)"
sha256sum count.bas    # (shasum -a 256 on macOS)
```
**Expected:** a sealed report file exists named for D1's `run_id`; its `input_sha256` **equals** the sha256 of `count.bas`; `dispatcher_version` matches the version recorded at Setup. Media runs additionally carry bounded attachment descriptors and an `artifact_sha256` that binds the text hash plus the ordered sent-byte hashes; reports must contain no original filename or staging/source path.
**Paste back:** all four report fields and the file's own sha256, so the binding can be checked.

### E2 — Run log carries version provenance
```bash
tail -3 .ensemble_reviews/review-log.jsonl
```
**Expected:** one JSON line per run including `run_id`, `dispatcher_version`, `report_sha256`, and `input_sha256`. (`label` appears only for runs given `--label`, so your D1 and D3 lines must have it and the tripwire runs need not.)
**Paste back:** those lines verbatim.

### E3 — Private ledger is produced and linked
```bash
node "$LEDGER"
ls -la .ensemble_reviews/ledger.html
```
**Expected:** the ledger builds, reports its run/report counts, and contains your D1 label. A run with zero completed external reviews says `no verdict` and never `0 findings`; failed routes use closed labels. Read-aloud is enabled only when the browser exposes a `localService === true` voice, speaks structured summaries rather than reviewer prose/attachment data, and stops cleanly. On macOS/Linux the private tree must be owner-only (dirs `0700`, files `0600`).
```bash
# POSIX only (Windows uses NTFS ACLs, not mode bits — record "n/a (Windows)"):
stat -c "%a %n" .ensemble_reviews .ensemble_reviews/ledger.html 2>/dev/null \
  || stat -f "%Lp %N" .ensemble_reviews .ensemble_reviews/ledger.html    # macOS/BSD
```
**Paste back:** the ledger path/counts, and the POSIX mode bits if applicable.

### E4 — Telemetry stays private
```bash
ls .ensemble_reviews/                                          # your scratch run's telemetry
git -C "$WORK" check-ignore -v --no-index .ensemble_reviews/.momm-private-probe
git -C "$WORK" status --porcelain
```
**Expected:** the scratch project holds the zone marker, `reports/`, `review-log.jsonl`, and `ledger.html`; `check-ignore` names `$WORK/.git/info/exclude`; `git status` is empty. The tracked `.gitignore` remains untouched. The ledger and reports are never committed or published.
**Paste back:** the directory listing, local-exclude match, and Git status.

---

## F. Protocol compliance (the human-in-the-loop parts)

### F1 — Reproduction gate
**Goal:** confirm the governor refuses to fix on reviewer authority alone.
Review a file with a **real** defect (write one: e.g. an off-by-one loop bound in any language) using one authenticated non-governor route and `--min-success 1`; save stdout as `f1-report.json`. Then, for every raw CRITICAL or WARNING claim in the generated draft:
1. Write a minimal failing test or an explicit manual reproduction **before** any fix.
2. Only then author a fix, and re-run the check.

**Expected:** the reproduction exists and fails before the fix, passes after. A claim that cannot be reproduced is `rejected` with `not_reproduced` evidence, not silently omitted. Correlated raw claims remain separate draft items, so the governor can reject a false merge independently.
**Paste back:** each item id, reviewer, reproduction, before/after result, and intended disposition.

### F2 — Machine-enforced completion
```bash
# Inspect the authoritative paths/argv without executing display_command text:
node -e 'const r=require("./f1-report.json"); console.log(r.evidence.governor_work.pending_file); console.log(JSON.stringify(r.evidence.governor_work.finalize)); console.log(JSON.stringify(r.evidence.governor_work.status))'
```

Edit the exact `pending_file`: decide every finding claim as `fixed`, `accepted_open`, or `rejected`; decide every suggestion as `applied` or `rejected`, classify its `claim_type`, attach required reproduction/verification, and add a passing `final_checks` entry. Then invoke the structured finalize `executable` with its exact `args` array. After it returns, invoke the structured status `executable` with its exact `args` array again; do not trust a remembered or copied display command.

**Expected:** an incomplete draft fails nonzero and names missing decisions. The complete draft produces an immutable sidecar and a log digest anchor. Fresh status exits `0` only as `complete_no_action`, `complete_clean`, or `complete_with_open_findings`, reports exact `N/N`, rebuilds the ledger, and leaves the sealed report hash unchanged. `accepted_open` must never be labeled clean. `.ensemble_reviews/dispositions.jsonl` is legacy history only; do not create or append it.
**Paste back:** finalize output/exit, fresh status output/exit, the final disposition table for every finding claim and suggestion, report hash before/after, and completion-sidecar hash.

### F3 — Both mandatory relays reach the user
**Expected:** immediately after peer collection, the governor relays the report's `required_user_message` verbatim; it must say the review is not finished. After finalization, the governor runs fresh status and relays that result's `required_user_message` verbatim; it must include the validated state/count and ledger link or explicit ledger/privacy failure. Temporary evidence risk must survive into the final relay when the explicit test-only override was used.
**Paste back:** both exact relay lines. A bare ledger URL, a paraphrase, or a “complete” claim before fresh status is a failure.

---

## G. Tripwires (correct behaviour here is refusal or failure)

> These exist to detect a session reporting results it did not earn. Record the exact 1.12.1 candidate commit under test; do not transfer these results to another commit.

### G1 — Quorum gate
```bash
echo "x" | node "$MOMM" --governor "$GOV" --reviewers codex --min-success 5 --no-ui >/dev/null 2>&1; echo "exit: $?"
```
**Expected exit: `1` before dispatch** because five successes are impossible from the requested pool. This is configuration refusal, not a dispatch-time missed quorum. A reachable `--min-success 1` whose only external route returns a non-success status exits `3`; timeouts cannot silently thin a release review.

### G2 — Oversized input refused
```bash
ERR="$(mktemp)"
node -e "process.stdout.write(String.fromCharCode(120).repeat(200000))" | node "$MOMM" --governor "$GOV" --max-bytes 1000 --no-ui >/dev/null 2>"$ERR"; echo "exit: $?"; cat "$ERR"
```
**Expected exit: `1`**, with an error naming the byte count and the limit.

### G3 — Unknown route fails closed
```bash
echo "x" | node "$MOMM" --governor "$GOV" --reviewers bogus_route --no-ui 2>/dev/null | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);for(const r of j.reviewers)console.log(r.agent,r.status,r.verdict??'(none)')})"
```
**Expected:** `bogus_route unsupported (none)` — a **status**, with **no verdict and no findings**. A route that does not exist must never produce a review.

### G4 — Recursion guard
```bash
MULTI_LLM_REVIEW_DEPTH=1 node "$MOMM" --governor "$GOV" --input count.bas --no-ui 2>&1 | head -5
```
**Expected — this exact refusal**, and no review is performed:
```json
{"error":"Nested multi-LLM dispatch is blocked to prevent recursive harness calls"}
```
(A reviewer must never recursively spawn its own coalition.)

### G5 — Governor cannot review itself
```bash
node "$MOMM" --preflight --governor "$GOV" --pretty | grep -A2 "\"agent\": \"$GOV\""
```
**Expected:** `role: "governor"`, never a reviewer slot.

---

## H. Companion skills

### H1 — myrepo refuses to leak
```bash
LEAKY="$(mktemp -d)"
printf '%s' 'const k = { api_' 'key: "abcd1234efgh5678" };' > "$LEAKY/app.js"
printf '<title>x</title>' > "$LEAKY/index.html"
node "$SKILLS/myrepo/scripts/publish.mjs" --name probe --dir "$LEAKY" --dry-run; echo "exit: $?"
rm -rf "$LEAKY"
```
**Expected exit: `2`** — refuses to publish, naming the inline credential. The secret scan is **never waivable**.

### H2 — yorky translates without breaking code
```bash
echo "Something to eat at the pub" | node "$SKILLS/yorkshire-pudding/scripts/yorkshirify.mjs" --level proper
node "$SKILLS/yorkshire-pudding/scripts/yorkshirify.mjs" --self-test; echo "self-test exit: $?"
```
**Expected:** prose becomes dialect (e.g. "Summat to eat at t'pub"); self-tests pass; identifiers/URLs/keys untouched.

---

## Results template — fill in and return verbatim

The template below is an **index**, not a substitute for raw output. Fill each line with the short answer, then append the raw output blocks under `RAW OUTPUT` at the end — at minimum for B1, C1, D1, E1, E2, and every tripwire. Where a value does not fit on the line, write `see raw` and include it below.

```
MOMM ACCEPTANCE RESULTS
Tester harness (governor): ..................
momm --version output:     ..................
OS / Node version:         ..................
Date run:                  ..................

A1 skills present: ............................  PASS/FAIL
A2 myskills verdict + exit: ...................  PASS/FAIL
B1 self-test passed / checks / exit: ..........  PASS/FAIL
B2 doctor routes: .............................  PASS/FAIL
B3 model_calls_made / governor role: ..........  PASS/FAIL
   login_hints (verbatim): ....................
B4 setup-ui passed / checks: ..................  PASS/FAIL
B5 ledger passed / checks: ....................  PASS/FAIL
B6 completion contract / checks: ..............  PASS/FAIL
B7 fresh-user round trip: ......................  PASS/FAIL
B8 UI contracts passed / checks: ..............  PASS/FAIL
C1 loopback / spoofed / bracket / leak-count:    ....  PASS/FAIL
C2 API key ever requested? (must be NO): ......  PASS/FAIL
C3 media refusal / temp-clean / no-evidence: ...  PASS/FAIL
D1 run_id: ....................................
   reviewers (agent/status/verdict/conf): .....
   findings count: ............................  PASS/FAIL
   ledger line relayed: .......................
D2 distinct statuses seen: ....................  PASS/FAIL
D3 personas recorded / findings: ..............  PASS/FAIL
D4 media witness route/status/run IDs: .........  PASS/FAIL/NOT RUN
E1 report input_sha256 == file sha256? ........  PASS/FAIL
   dispatcher_version in report: ..............
E2 review-log lines (paste): ..................  PASS/FAIL
E3 ledger counts / POSIX modes: ...............  PASS/FAIL
E4 local exclude / clean Git status: ..........  PASS/FAIL
F1 finding id / reproduction / before-after: ..  PASS/FAIL
F2 completion state / N-of-N / hashes: .........  PASS/FAIL
F3 pending + final messages relayed verbatim? ..  PASS/FAIL
G1 impossible quorum exit (expect 1): ..........  PASS/FAIL
G2 oversize exit (expect 1): ..................  PASS/FAIL
G3 bogus route status (expect unsupported): ...  PASS/FAIL
G4 recursion guard held: ......................  PASS/FAIL
G5 governor role (expect governor): ...........  PASS/FAIL
H1 myrepo exit (expect 2): ....................  PASS/FAIL
H2 yorky translation + self-test: .............  PASS/FAIL

Anything unexpected, broken, or not run:
...............................................

RAW OUTPUT (required for B1, C1, D1, E1, E2 and all tripwires)
--- B1 ---
--- C1 ---
--- D1 ---
--- E1 ---
--- E2 ---
--- G1..G5 ---
--- H1..H2 ---
```

## How these results get verified

Results are cross-checked, so guessing is detectable rather than merely discouraged:

- **Run IDs** must exist as sealed reports and as lines in `review-log.jsonl`, with matching `report_sha256`.
- **`input_sha256`** must equal the independently computed digest of the reviewed file.
- **`artifact_sha256`** on media runs must bind the text digest and ordered sent-media digests while exposing neither paths nor original names.
- **Exit codes** (G1 impossible configuration=1, G2=1, H1=2) and the `unsupported` status in G3 are fixed for the exact candidate commit under test.
- **Status values** must fall inside the closed vocabulary; an invented status reveals a fabricated report.
- **`dispatcher_version`** must be identical across the report, the run log, and the Setup output.
- **Completion** must bind the exact sealed report digest, cover every stable raw finding-claim and suggestion item, preserve the report bytes, and carry a matching `review_completed` log anchor. Legacy free-form rows never satisfy it.

A test run that honestly reports failures is more valuable than one that reports all-pass. Report what happened.
