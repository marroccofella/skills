# Getting started without surprises

MOMM lets the coding agent you are already using ask other locally installed agent CLIs for read-only peer reviews. Your current agent remains the governor: it is the only writer, and it must reproduce a material finding before changing code. Peer collection is only the first phase; the review is unfinished until the governor's report-bound draft passes finalization and a fresh status check.

In the commands below, replace `<momm-root>` with the absolute installed or cloned directory containing MOMM's `SKILL.md`. Keep the working directory in the project being reviewed. Do not change into the MOMM directory: the working directory selects the reviewed project, its Git root, and the default private evidence location.

## The easiest first command

From the project you intend to review:

```text
node "<momm-root>/scripts/setup-ui.mjs" --governor codex
```

Replace `codex` with the agent currently driving the work: `claude`, `antigravity`, `copilot`, `grok`, `gemini`, or `other`. Supplying the governor at startup prevents any check from accidentally including the active writer. If it is omitted, reviewer checks stay paused until the user chooses the controller in the page.

The local Setup Center opens in the browser and:

- reads one six-provider manifest for Codex, Claude Code, Antigravity, GitHub Copilot, Grok, and optional Gemini;
- checks every route except the selected governor, which is always self-excluded;
- separates the active controller from unified provider cards that combine CLI, account, and model status;
- shows the reviewed text/image/PDF/audio/video input capability for each provider adapter;
- offers **Quick Setup** to verify every detected session in sequence, while leaving interactive OAuth sign-in as an explicit user action;
- opens visible install or provider-login terminals only after a user click;
- rechecks while the user completes browser OAuth;
- offers a harmless live test for which MOMM supplies no project source or rules; and
- checks skill releases, reviewer CLI updates, model access, runtimes, and relevant environment-variable names; and
- never reads credential contents or asks for API keys.

The server listens only on `127.0.0.1`, rejects non-local clients and cross-origin action requests, requires a random session token for actions, and accepts only fixed provider/action combinations. MOMM supplies no project content during setup. Provider-native saved account instructions or configuration may still apply inside that provider's CLI, so Setup Center discloses this boundary instead of claiming complete provider isolation. A later real peer review does send the user-selected diff or input to the chosen provider, so source-sharing permission must be confirmed before dispatch. The Setup Center cannot be meaningfully hosted as a normal public website because public pages cannot safely launch or inspect local CLIs.

When the user clicks **Verify connection**, MOMM makes one real provider call with a fixed, disclosed synthetic sentence. A one-use capability issued and consumed within that Setup Center instance binds the request to the exact sentence, provider, and controller; direct, replayed, or arbitrary-input attempts against that instance are rejected. This is a same-user process boundary rather than OS-backed parent authentication, while the fixed-input lock prevents the route from carrying project source. It runs from a newly created operating-system temporary directory, does not load the project's `.reviewrules`, accepts no input file, writes no report or `.ensemble_reviews` ledger entry, and removes the temporary directory afterward. Provider-native saved configuration may still apply. Raw provider diagnostics are scrubbed before display: browser OAuth URLs, authorization/device codes, account identifiers, credential-shaped values, and user-home paths are hidden while the status and next action remain readable. The check proves current connectivity only; it does not grant MOMM access to credentials and it does not prove future availability. Keep every authorization or device code in the provider terminal/browser—never paste one into Setup Center or chat.

## Stay updated

The **Skills & diagnostics** panel shows the four canonical skill families from the `myskills` functional runner: MOMM, myrepo, Yorkshire/yorky, and Promptus/myvoice. Alias names share one row. Functional health, dependency readiness, published version, local-newer state, and repository changes are separate signals—“version current” never means “working.” It offers a safe diff view and guided commit terminal for repository changes; neither action stages or commits automatically. Healthy system details remain collapsed, while active conflicts are expanded and explained. Its read-only checks:

- runs each canonical skill's safe self-test or readiness contract and separately compares local versions with the published manifest;
- checks Claude and Copilot against their npm releases, Grok through `grok update --check --json`, and reports Antigravity's built-in self-updater;
- verifies Node.js, Git, PowerShell on Windows, and the operating system;
- distinguishes provider login from account-specific model availability; and
- reports only the names of API-key, update-control, model, endpoint, and proxy variables that may alter behavior.

It never returns environment values. API-key variables, cloud credentials, and provider endpoint overrides are removed from every provider-facing subprocess. An update is applied only after the user clicks **Update**, confirms the action, and sees the provider's official updater in a visible terminal. Skill updates use `git pull --ff-only`, are offered only for the exact verified checkout, and are withheld when local repository changes are present.

For headless machines or people who prefer the terminal, replace `codex` with the harness currently driving the work:

```text
node "<momm-root>/scripts/onboard.mjs" --governor codex
```

Add `--link` only when the user wants MOMM added to the current harness's skill discovery. Add `--json` for automation.

## Understand the result

| State or result | Meaning | Next step |
| --- | --- | --- |
| **Verified** / `success` | The isolated synthetic call succeeded; no evidence was persisted | The route is ready for a real review now |
| **Session detected** | Local OAuth evidence exists but has not been proven live | Click **Verify connection** |
| **Possible session** | A shared local folder suggests a session, but the evidence is weak | Verify before relying on it |
| **Sign in** / `authentication_required` | The CLI exists, but the session is absent or expired | Run the exact sign-in action shown, then verify again |
| **Install** / `missing` | The CLI is not on the current `PATH` | Run the shown installer, restart the terminal if required, then sign in |
| **Provider unavailable** / `provider_unavailable` | The provider failed transiently; this is not an auth diagnosis | Wait and retry; do not sign in again merely because of an outage |
| **Account not eligible** / `ineligible_tier` | The signed-in account cannot use that route | Follow the provider-specific eligibility help or choose another reviewer |
| **Check timed out** / `timeout` | The isolated call did not finish before its deadline | Retry once, then inspect network/provider health |
| **Unreadable response** / `invalid_output` | The CLI returned output that MOMM could not safely accept | Retry, then use Setup Center diagnostics if it repeats |
| `disabled_no_oauth` | The route cannot run under MOMM's OAuth-only policy | Choose another OAuth-capable route; never add an API key |
| `unsupported` | The installed adapter or account cannot perform this review | Choose another supported reviewer and retain the status as reported |
| **Check failed** / `error` | The route failed without a safer classification | Inspect the shown detail; do not assume login is the cause |
| **Governor** / `self_excluded` | This is the agent in control | Nothing; self-exclusion is the integrity boundary |

OAuth presence is local evidence, not proof that a session is live. MOMM preserves the provider's actual terminal result instead of turning every failure into “Needs login.” A non-success result is a route status, never a review finding.

## Keep evidence durable and private

In a Git repository, MOMM writes the default evidence under `<git-root>/.ensemble_reviews/` and adds that directory to Git's local `.git/info/exclude`. It verifies that Git honors the exclusion before spending reviewer calls. It does not modify or require a tracked `.gitignore`, so one user's private telemetry rule never becomes a project change. Outside Git, keep the selected evidence directory private and out of any publish or synchronization workflow yourself.

MOMM refuses reviewer calls when the resolved evidence directory is under the operating-system temporary directory. Run from a durable project, or select durable storage explicitly:

```text
node "<momm-root>/scripts/multi-review.mjs" --governor codex --evidence-dir <durable-directory> --reviewers antigravity --min-success 1
```

`--allow-ephemeral-evidence` is an explicit risky, test-only opt-in. It permits evidence that the operating system may clean before the governor can finish, so it is not a normal first-run or production workaround.

On POSIX systems, MOMM creates its own evidence directories and files with owner-only `0700` and `0600` modes where the filesystem honors them. Windows ignores those POSIX mode bits: files inherit the ACL of the chosen project or evidence directory. MOMM does not claim to harden or replace Windows ACLs, so choose a user-private location when other local accounts can read the workspace.

## Run the first review

Start with one ready reviewer and an explicit minimum-success gate:

```text
node "<momm-root>/scripts/multi-review.mjs" --governor codex --reviewers antigravity --min-success 1
```

With no `--input`, MOMM reviews `git diff HEAD`. It sends the sanitized diff to the selected provider, so confirm that the provider is allowed to receive the source before dispatching. To review a specific patch or text artifact, use `--input <file>`.

To review selected media, authorize each file explicitly:

```text
node "<momm-root>/scripts/multi-review.mjs" --governor codex --reviewers gemini --attach <file>
```

Attach-only means media-only: MOMM does not infer the repository diff or load `.reviewrules`. Add `--with-diff`, pipe text, or use `--input` only when that extra content is also approved for sharing. PNG/JPEG privacy metadata is removed from the private staging copy. PDF, audio, and video require `--allow-unstripped-metadata` because those containers can retain author, device, location, editing, or voice metadata. Confirm consent for every voice before sharing audio. MOMM never sends original filenames or paths; evidence records generated attachment IDs, sizes, formats, metadata status, and hashes only.

The capability gate filters the implicit pool rather than pretending every CLI accepts every format. Codex has a native PNG/JPEG path; Claude Code has the constrained PNG/JPEG/PDF path; Gemini is the explicit optional route for the reviewed image/PDF/audio/video set. MOMM never auto-adds Gemini, and media exits unsuccessfully when no capable external reviewer completes. Use `--help` for the exact allowlist and limits.

The dispatcher returns a peer-collection report with `review_complete: false`. That is deliberately unfinished, even when every reviewer says ACCEPT. Complete the governor phase as follows:

1. Relay the report's top-level `required_user_message` verbatim. It tells the user that work remains and includes the private ledger link or an explicit ledger failure.
2. Inspect every report-bound finding. Reproduce each plausible CRITICAL or WARNING with a minimal test or an explicit manual reproduction before authoring a fix. Reviewer agreement prioritizes investigation; it is never permission to edit.
3. Edit the exact file in `evidence.governor_work.pending_file`. Do not invent a replacement draft. Decide every stable raw reviewer finding claim as `fixed`, `accepted_open`, or `rejected`, with the reproduction and verification the draft requires. Correlated claims remain separate obligations so a mistaken grouping cannot hide a defect. Decide every suggestion as `applied` or `rejected`, give a reason, and classify its `claim_type` as `behavioral`, `style`, `documentation`, or `other`. An applied behavioral suggestion needs reproduced-before evidence, and every applied suggestion needs passing verification. Add at least one passing final project check.
4. Invoke `evidence.governor_work.finalize.executable` directly with the exact `evidence.governor_work.finalize.args` array. These structured fields are authoritative for agents and automation; `display_command` is only a human copy/paste aid.
5. After finalization, invoke `evidence.governor_work.status.executable` with its exact `args` array to perform a fresh `--status` check. Do not reuse the dispatcher snapshot or assume finalization succeeded. Only an exit-zero `complete_no_action`, `complete_clean`, or `complete_with_open_findings` status is complete, and a run with `accepted_open` findings is not clean.
6. Relay the fresh status result's `required_user_message` verbatim and summarize every disposition with its evidence. Treat `.ensemble_reviews/dispositions.jsonl` as read-only legacy history; never write it, because it cannot satisfy machine completion.

## A low-stress team rollout

1. Pin a reviewed MOMM version or repository commit.
2. Run onboarding without `--link` first; use `--link` only after confirming the detected harness.
3. Bring one provider online, run a small non-sensitive review, and inspect the report.
4. Add providers gradually and set `--min-success` to the release quorum your team requires.
5. Verify MOMM added the private evidence directory to the repository's local `.git/info/exclude`; do not add it to tracked `.gitignore` merely for MOMM. Evidence is per-machine telemetry and may reference internal code.
6. Never put provider API keys into CI for MOMM. Its supported trust model is local OAuth/account sessions only.

## Common recovery steps

- **Command still missing after install:** open a new terminal so the updated user `PATH` is loaded, then rerun onboarding.
- **Login is still reported absent:** run the exact login command shown, finish the browser flow, and rerun onboarding. Never paste a token, authorization code, or device code into chat.
- **No changes to review:** make or stage a change, or pass `--input <file>`.
- **Evidence location refused:** stay in a durable project or choose a durable `--evidence-dir`. Use `--allow-ephemeral-evidence` only for a disposable test whose evidence may vanish.
- **Local Git exclusion failed:** repair `.git/info/exclude` or put `--evidence-dir` outside the repository; MOMM fails before dispatch rather than risk a private transcript entering Git.
- **Status says `blocked_peer_gate`:** no adjudication draft can make the run complete; restore enough external reviewers and collect fresh peer evidence.
- **Status says `pending`:** edit the report's existing `pending_file`, correct the stated decision evidence, finalize again, and run a fresh structured status gate. Do not repair completion by writing legacy JSONL.
- **Status says `legacy_unverifiable`:** the report has no supported sealed obligation derivation. Preserve it as historical evidence and collect fresh peer evidence with the current MOMM release; never mutate the old report or try to complete it with legacy JSONL.
- **Status says `invalid`:** do not overwrite or invent evidence. Inspect the reported validation error and restore a known-good local sidecar/log/report set; if that cannot be done, preserve the invalid zone for diagnosis and collect fresh peer evidence in a new private evidence zone. An invalid completed run may no longer have a pending draft.
- **Provider outage:** wait and rerun. Do not log in again for a `provider_unavailable` result.
- **Source cannot leave the machine:** do not dispatch to external providers; review locally with the governor instead.

## Official account and model routes

| Provider | Sign in | View/select models | Official help |
| --- | --- | --- | --- |
| OpenAI Codex | `codex login` | launch `codex`, then `/model` | [CLI](https://learn.chatgpt.com/docs/codex/cli) · [authentication](https://learn.chatgpt.com/docs/auth) · [models](https://learn.chatgpt.com/docs/models) |
| Claude Code | `claude auth login` | launch `claude`, then `/model` | [setup](https://code.claude.com/docs/en/setup) · [authentication](https://code.claude.com/docs/en/authentication) · [models](https://code.claude.com/docs/en/model-config) |
| Google Antigravity | launch `agy`; browser sign-in opens when needed | `agy models` or interactive `/model` | [install](https://antigravity.google/docs/cli/install/) · [reference](https://antigravity.google/docs/cli/reference) · [models](https://antigravity.google/docs/cli/headless/) |
| GitHub Copilot CLI | `copilot login` | launch `copilot`, then `/model` | [install](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli) · [authentication](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli) · [reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) |
| Grok | `grok login` | `grok models` or interactive `/model` | [overview](https://docs.x.ai/build/overview) · [CLI reference](https://docs.x.ai/build/cli/reference) |
| Gemini CLI (optional) | launch `gemini` and choose Google sign-in; `/auth` changes it | launch `gemini`, then `/model manage` | [getting started](https://geminicli.com/docs/get-started/) · [authentication](https://geminicli.com/docs/get-started/authentication/) · [commands](https://geminicli.com/docs/reference/commands/) |

Antigravity does not expose a supported `agy login` command, and current Copilot uses `/model`, not `/models`. Gemini remains optional because current account eligibility varies; rely on live verification rather than assuming eligibility from a local folder or plan name.
