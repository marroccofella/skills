# MOMM acceptance test plan

A self-contained conformance plan for **momm 1.10.1**. Hand this whole file to a fresh agent session (any harness), have it run the exercises in order, and paste its filled-in results back to the requester for verification.

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
# SKILLS = the directory holding the installed skills (each skill is a subdirectory).
SKILLS="$HOME/.agents/skills"                 # Git Bash on Windows: /c/Users/<you>/.agents/skills
# REPO = the canonical skills checkout (holds install.mjs at its root). If you are
# testing an install rather than a checkout, set REPO to the clone you installed from.
REPO="$(cd "$SKILLS/momm" && cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" && pwd)"

MOMM="$SKILLS/momm/scripts/multi-review.mjs"
GOV="claude"   # <-- SET THIS to the harness you actually are: codex|claude|antigravity|copilot|grok|other

node "$MOMM" --version      # record this; every later result must come from this version

# One isolated scratch directory for the whole run (never reuse a fixed path):
WORK="$(mktemp -d)"; cd "$WORK"; echo "scratch: $WORK"
```

Exercises B–H write private telemetry into `./.ensemble_reviews/` **in the current working directory**, which is why the run happens in `$WORK` — so nothing mixes into a real project's ledger. Note the scratch path in your results.

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
**Expected:** `"passed": true`, 35 or more named checks, exit `0`.
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
**Expected:** `"passed": true`, 14 or more checks including `host_allowlist_blocks_rebinding`, `loopback_only`, `api_keys_not_mentioned`, `terminal_rejects_newline_commands`.
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

---

## D. Live review dispatch

> D-exercises make real model calls through your OAuth sessions. If a route is unauthenticated it must **fail closed** with a status — that is a pass, not a failure.

### D1 — Baseline review of a known-good artifact
```bash
printf "FOR i = 1 TO 10\n    PRINT i\nNEXT i\nEND\n" > count.bas
node "$MOMM" --governor "$GOV" --input count.bas --label "acceptance D1" --no-ui; echo "exit: $?"
```
*(Set `--governor` to whichever harness you actually are: `codex`, `claude`, `antigravity`, `copilot`, or `other`.)*
**Expected:** a JSON report on stdout; the governor's own route reports `self_excluded`; a correct 10-line loop should draw ACCEPTs and no CRITICAL findings.
**Note — no quorum flag here on purpose.** An unauthenticated route failing closed is a *pass* for this plan, and `--min-success` would turn that documented outcome into exit `3`. Quorum is exercised deliberately in G1 instead. If **every** reviewer failed closed, record their statuses (that is a valid, reportable result) and note that no verdict was obtainable.
**Paste back:** the `run_id`, each reviewer's `agent`/`status`/`verdict`/`confidence`, `findings` count, and **the private ledger line printed on stderr**.

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

---

## E. Evidence integrity

### E1 — Sealed report and input binding
```bash
ls .ensemble_reviews/reports/
node -e "const j=require('./.ensemble_reviews/reports/<D1_RUN_ID>.json');console.log('run',j.run_id);console.log('input_sha256',j.input_sha256);console.log('dispatcher_version',j.dispatcher_version);console.log('schema',j.report_schema)"
sha256sum count.bas    # (shasum -a 256 on macOS)
```
**Expected:** a sealed report file exists named for D1's `run_id`; its `input_sha256` **equals** the sha256 of `count.bas`; `dispatcher_version` matches the version recorded at Setup.
**Paste back:** all four report fields and the file's own sha256, so the binding can be checked.

### E2 — Run log carries version provenance
```bash
tail -3 .ensemble_reviews/review-log.jsonl
```
**Expected:** one JSON line per run including `run_id`, `dispatcher_version`, `report_sha256`, and `input_sha256`. (`label` appears only for runs given `--label`, so your D1 and D3 lines must have it and the tripwire runs need not.)
**Paste back:** those lines verbatim.

### E3 — Private ledger is produced and linked
```bash
node "$SKILLS/momm/scripts/ledger.mjs"
ls -la .ensemble_reviews/ledger.html
```
**Expected:** the ledger builds, reports its run/report counts, and contains your D1 label. On macOS/Linux the private tree must be owner-only (dirs `0700`, files `0600`).
```bash
# POSIX only (Windows uses NTFS ACLs, not mode bits — record "n/a (Windows)"):
stat -c "%a %n" .ensemble_reviews .ensemble_reviews/ledger.html 2>/dev/null \
  || stat -f "%Lp %N" .ensemble_reviews .ensemble_reviews/ledger.html    # macOS/BSD
```
**Paste back:** the ledger path/counts, and the POSIX mode bits if applicable.

### E4 — Telemetry stays private
```bash
ls .ensemble_reviews/                                          # your scratch run's telemetry
git -C "$REPO" check-ignore -v .ensemble_reviews/ || echo "NOT IGNORED IN REPO"   # authoritative, not a text match
```
**Expected:** the scratch directory holds `reports/`, `review-log.jsonl`, `ledger.html`. The *repository* must gitignore `.ensemble_reviews/` — check `$REPO`, not the scratch directory (which is not a git repo at all). The ledger and reports are never committed or published.
**Paste back:** the directory listing and the gitignore line (or `NOT IGNORED IN REPO`).

---

## F. Protocol compliance (the human-in-the-loop parts)

### F1 — Reproduction gate
**Goal:** confirm the governor refuses to fix on reviewer authority alone.
Review a file with a **real** defect (write one: e.g. an off-by-one loop bound in any language). Then, for the first CRITICAL or WARNING returned:
1. Write a minimal failing test or an explicit manual reproduction **before** any fix.
2. Only then author a fix, and re-run the check.

**Expected:** the reproduction exists and fails before the fix, passes after. A finding that cannot be reproduced must be **rejected with a stated reason**, not applied.
**Paste back:** the finding id, the reproduction you used, its before/after result, and your disposition.

### F2 — Dispositions are logged and complete
```bash
tail -5 .ensemble_reviews/dispositions.jsonl 2>/dev/null || echo "no dispositions file yet"
```
**Expected:** one JSONL line per suggestion (`timestamp`, `run_id`, `reviewer`, `suggestion`, `disposition`, `reason`, optional `evidence`). **Every** `suggested_improvements` entry gets an explicit apply-or-reject — none silently dropped.
**If a run returned zero suggestions**, no dispositions exist and the file may be absent — that is a **pass**, not a failure. Say so explicitly (`0 suggestions → 0 dispositions`) rather than inventing rows. Use the F1 defect review, which does produce findings, as the real test of this exercise.
**Paste back:** the lines (or the zero-suggestion statement), plus a disposition table for the run.

### F3 — Ledger link relayed in chat
**Expected:** after **every** completed review, the governor relays the private ledger `file://` link to the user in chat, one line. *(This is SKILL.md's requirement and the single most commonly dropped step — check it explicitly.)*
**Paste back:** the exact line you relayed, for each review you ran.

---

## G. Tripwires (correct behaviour here is refusal or failure)

> These exist to detect a session reporting results it did not earn. **All expected values below were verified against momm 1.10.1** — they are facts, not guesses.

### G1 — Quorum gate
```bash
echo "x" | node "$MOMM" --governor "$GOV" --reviewers codex --min-success 5 --no-ui >/dev/null 2>&1; echo "exit: $?"
```
**Expected exit: `3`** (quorum unreachable — timeouts must never silently thin a release review).

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
C1 loopback / spoofed / bracket / leak-count:    ....  PASS/FAIL
C2 API key ever requested? (must be NO): ......  PASS/FAIL
D1 run_id: ....................................
   reviewers (agent/status/verdict/conf): .....
   findings count: ............................  PASS/FAIL
   ledger line relayed: .......................
D2 distinct statuses seen: ....................  PASS/FAIL
D3 personas recorded / findings: ..............  PASS/FAIL
E1 report input_sha256 == file sha256? ........  PASS/FAIL
   dispatcher_version in report: ..............
E2 review-log lines (paste): ..................  PASS/FAIL
E3 ledger counts / POSIX modes: ...............  PASS/FAIL
E4 .ensemble_reviews gitignored? ..............  PASS/FAIL
F1 finding id / reproduction / before-after: ..  PASS/FAIL
F2 dispositions logged (paste lines): .........  PASS/FAIL
F3 ledger link relayed every run? .............  PASS/FAIL
G1 quorum exit (expect 3): ....................  PASS/FAIL
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
- **Exit codes** (G1=3, G2=1, H1=2) and the `unsupported` status in G3 are fixed, verified constants.
- **Status values** must fall inside the closed vocabulary; an invented status reveals a fabricated report.
- **`dispatcher_version`** must be identical across the report, the run log, and the Setup output.

A test run that honestly reports failures is more valuable than one that reports all-pass. Report what happened.
