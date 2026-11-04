# Getting started without surprises

Before running newly downloaded MOMM code, use the [new/legacy bootstrap guide](bootstrap.md).
It covers the verifier prerequisite, signed release and package check, and explicit
installation approval. A downloaded clone is not automatically a verified release.
The Setup Center instructions below assume a trusted installation.

## CLI versions and explicit updates

In the local Setup Center, open **CLI versions, skills & diagnostics**. The six-CLI table includes the active controller even though it cannot review itself. It shows the installed version, latest checked version, source and installation type. **Check everything** refreshes these observations without installing anything. An unknown latest version is not a current version; Antigravity has no verified check-only updater, so its **Check / update…** action needs explicit consent.

Each update previews the exact command, then asks before opening its terminal. npm updates target the detected prefix; native updates target the detected executable. Homebrew, project-local and unknown wrappers use their update guide rather than a guessed global install. Finish in the terminal, then check versions again. A changed version invalidates the old connectivity result; verify the connection separately. An update does not repair exhausted quota or an ineligible account tier.

This panel runs locally; the public GitHub Pages information site cannot inspect or update software on your computer.

MOMM lets the coding agent you are already using ask other locally installed agent CLIs for read-only peer reviews. Your current agent remains the governor: it is the only writer, and it must reproduce a finding before changing code.

## The easiest first command

From the cloned skills repository:

```text
node momm/scripts/setup-ui.mjs
```

From inside the `momm` directory, omit the leading `momm/`. The local Setup Center opens in the browser and:

- checks every reviewer route automatically;
- separates the active controller from unified provider cards that combine CLI, account, and model status;
- offers **Quick Setup** to verify every detected session in sequence, while leaving interactive OAuth sign-in as an explicit user action;
- opens visible install or provider-login terminals only after a user click;
- rechecks while the user completes browser OAuth;
- offers a harmless live test containing no project source; and
- checks skill releases, reviewer CLI updates, model access, runtimes, and relevant environment-variable names; and
- never reads credential contents or asks for API keys.

The server listens only on `127.0.0.1`, rejects non-local clients, requires a private session for API access, and accepts only fixed provider/action combinations. Open the full private launch link printed by the command, fragment included (it has the shape `http://127.0.0.1:<port>/#<capability>`); treat that printed link as sensitive and do not share it. Its random capability arrives in the URL fragment, which is not sent on the first GET; the page then sends that same capability on its own same-origin API calls. It is removed from the address bar, and stays in that tab's session storage. A bare bookmarked localhost address or a new tab may require reopening the launch link. Restarting the server invalidates the old link. The capability is not written into the ledger or its Setup Center pointer. The **Private ledger** button obtains a one-use, one-minute navigation ticket. This limits unauthorized local HTTP clients, not administrators or hostile programs running as your own account. Setup sends no project content. A later real peer review does send the user-selected diff or input to the chosen provider, so source-sharing permission must be confirmed before dispatch. The Setup Center cannot be meaningfully hosted as a normal public website because public pages cannot safely launch or inspect local CLIs.

## Stay updated

The **Skills & diagnostics** panel groups skills as **Update available**, **Modified locally**, or **Up to date**. It offers a safe diff view and guided commit terminal for local changes; neither action stages or commits automatically. Healthy system details remain collapsed, while active conflicts are expanded and explained. Its read-only checks:

- compares every local skill version in `versions.json` with the published manifest;
- checks Claude and Copilot against their npm releases, Grok through `grok update --check --json`, and reports Antigravity's built-in self-updater;
- verifies Node.js, Git, PowerShell on Windows, and the operating system;
- distinguishes provider login from account-specific model availability; and
- reports only the names of API-key, update-control, model, endpoint, and proxy variables that may alter behavior.

It never returns environment values. Provider CLI updates open their official updater only after an explicit user action. The MOMM update action opens `update --dry-run`: a staged signed preview, never an installation. Applying requires the user's own `update --apply` command and `--accept-protocol` when policy changes. It does not bypass the updater with `git pull`. See [updating.md](updating.md).

For headless machines or people who prefer the terminal, replace `codex` with the harness currently driving the work:

```text
node momm/scripts/onboard.mjs --governor codex
```

Add `--link` only when the user wants MOMM added to the current harness's skill discovery. Add `--json` for automation.

## Understand the result

| State | Meaning | Next step |
| --- | --- | --- |
| `ready` | A harmless live check succeeded | Use it for the first review |
| `detected` | Local OAuth evidence exists but has not been proven live | Click **Verify connection** |
| `login` | CLI exists, but no account session was detected | Run the exact `login` action shown |
| `install` | CLI is not on the current `PATH` | Run the exact `install` action shown, restart the terminal if required, then log in |
| `governor` | This is the agent in control | It is deliberately excluded from reviewers |
| `attention` | The probe is inconclusive | Run `multi-review.mjs --doctor` and inspect the route |

OAuth presence is only local evidence, not proof that a session is live. The Setup Center makes that distinction visible and fails closed with **Needs login** when its synthetic verification finds an expired or shared session.

### Setup action feedback (1.17.4)

A sign-in click leaves a receipt on its card until that tab reloads, rather than only a
temporary notification. **Launch request accepted** means the terminal process was admitted;
the page cannot observe completion inside a detached terminal, prove that a browser opened,
or certify the login. Finish the provider's login yourself, then choose **Verify after login**.
That check sends one synthetic provider request and uses allowance, never project source.
A confirmed login launch clears the previous successful check; a confirmed refusal preserves it.
An unconfirmed launch invalidates a previous success conservatively, but retains evidence that
authentication is required. Verification remains separate from
the terminal action's unobserved completion; receipts are not installation or review receipts.

**Retry discovery** reruns local discovery without a model call. An inconclusive version check
is not proof of missing installation or authentication. Run the displayed version command in a
fresh terminal when PATH changed. CLI updates do not repair authentication, quota, retired tiers
or service outages. A compatibility warning continues to offer its update path, not another login.

**Copy login command** copies a fixed official command and launches nothing. **Copy action receipt**
copies only provider, action, launch status and `completion: unobserved`; there are no commands,
OAuth codes/URLs, account identifiers, machine paths or raw diagnostics. Receipts disappear on
reload. If copying is unavailable, the login command remains visible. A lost launch response is
unconfirmed: check whether a terminal already opened before retrying.

The page observes a provider launch for at most 15 seconds (120 seconds for the signed-update
preview's prerequisites). This bounds the page's waiting state, not the terminal or OAuth flow:
an unconfirmed request can still have launched. No observation timeout automatically retries it.
After a live check passes, the last terminal action stays explicitly historical and no longer
tells you to finish logging in. Blocked update actions retain fixed, actionable refusal reasons.

## Run the first review

Start with one ready reviewer and an explicit minimum-success gate:

```text
node momm/scripts/multi-review.mjs --governor codex --reviewers antigravity --min-success 1
```

With no `--input`, MOMM reviews `git diff HEAD`. It sends the sanitized diff to the selected provider, so confirm that the provider is allowed to receive the source before dispatching. To review a specific patch or text artifact, use `--input <file>`.

The governor then reproduces plausible findings, authors any fixes itself, runs local checks, and records an explicit disposition for every improvement suggestion. Reviewer consensus prioritizes investigation; it is never permission to edit.

## Add a Bumbler reviewer

A Bumbler is a lower-powered open model you run yourself, added to the pool as
one more reviewer. Add it in the Setup Center under Bumblers in the review pool,
which saves `bumblers.json`, or edit that file in your reviewer home, which is
`~/.momm-reviewers` unless `MOMM_REVIEWER_HOME` says otherwise. Keep this file
out of your project:

Use the private reviewer home created by MOMM's settings setup. The file must
have owner-only access (for example, 0600 on POSIX), be a regular file with one link, and
be no larger than 1,000,000 bytes. Linked paths and unverifiable privacy refuse
before content is loaded. Reading these settings never repairs permissions.

```json
{"bab":{"base_url":"http://100.64.0.1:8080/v1","model":"your-model-id","max_tokens":1024,"timeout_seconds":180}}
```

Add an optional `guidance` field, up to 4000 characters, to give one Bumbler its own
reviewing style on top of MOMM's general guidance. Optional `rest_seconds`, from 0 to
3600, pauses that Bumbler between requests in one run. A small GPU can slow sharply
under sustained load, and on the first Bumbler a 90-second rest kept full speed.
Optional `parallel`, from 1 to 8, lets a split review send that many pieces to the
Bumbler at once; set it no higher than the slots its server runs. On the first
Bumbler, two requests sharing one GPU each ran slower than one alone, so check that
`max_tokens` can finish within `timeout_seconds` at the speed you see when shared. A server shared by
several people may answer 429 when it is full: the Bumbler waits as the server asks
(seconds or a date; otherwise 2 s, growing to 30 s, plus a little jitter) and tries
again, but never past its time limit, and the report counts those busy answers in
`busy_waits`. Only 429 is asked again; a timeout or broken connection is not, because
the model may already have started. Set `wait_when_busy: false` to ask exactly once.
Set `enabled: false` (in the Setup Center, untick "Joins default reviews") to keep a
Bumbler saved and listed without it joining default reviews; naming it in `--reviewers`
still uses it.
`rest_seconds` is a pause for the whole Bumbler: a piece that is ready to go waits
until that long after the latest answer. Two Bumblers on the same model are two
samples of one model, not two kinds of reviewer; each valid review still counts once. The name is your choice, in
lowercase, and cannot be a built-in reviewer. One server running two different models
can be saved as two Bumblers, because they give two opinions; the same model twice
is refused.
`base_url` is an OpenAI-compatible server ending in `/v1`, on a literal tailnet
address in 100.64.0.0/10 or `127.0.0.1`. `max_tokens` and `timeout_seconds` are optional and default
to 1024 and 180; an explicit `--timeout` wins. Then name it alongside your other
reviewers:

```bash
node momm/scripts/multi-review.mjs --preflight --governor claude --reviewers bab
node momm/scripts/multi-review.mjs --governor claude --reviewers codex,antigravity,bab --min-success 2
```

This route carries no login or API key, so review text goes to that address with
nothing else protecting it. A tailnet address is reachability, not authentication:
choose the machine yourself and decide what may be sent to it. Preflight only
shows whether the server answers. A Bumbler takes one piece at a time. A slow or
stopped model shows as a status on the report. Its answers are evidence for the
governor. A saved Bumbler joins every review unless you name reviewers with
`--reviewers`, and a valid review counts towards `--min-success` like any other. A
large split review waits on the Bumbler for each piece, so name your reviewers when
you want a faster run.
If its quotes fail validation, its findings still reach the governor, marked
`quotes_unverified`, and its row shows `invalid_output`. With `--strict`, a named
Bumbler must still answer. The Bumbler Bees cards are separate OAuth drafts.

## A low-stress team rollout

1. Pin a reviewed MOMM version or repository commit.
2. Run onboarding without `--link` first; use `--link` only after confirming the detected harness.
3. Bring one provider online, run a small non-sensitive review, and inspect the report.
4. Add providers gradually and set `--min-success` to the release quorum your team requires.
5. Keep `.ensemble_reviews/` ignored. It is private, per-machine telemetry and may reference internal code.
6. Never put provider API keys into CI for MOMM. Its supported trust model is local OAuth/account sessions only.

## Common recovery steps

- **Command still missing after install:** open a new terminal so the updated user `PATH` is loaded, then rerun onboarding.
- **Login is still reported absent:** run the exact login command shown, finish the browser flow, and rerun onboarding. Never paste a token into chat.
- **No changes to review:** make or stage a change, or pass `--input <file>`.
- **Provider outage:** wait and rerun. Do not log in again for a `provider_unavailable` result.
- **Source cannot leave the machine:** do not dispatch to external providers; review locally with the governor instead.

Provider setup references: [Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started), [Antigravity CLI](https://antigravity.google/docs/cli/install/), [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli), and [Grok CLI](https://x.ai/cli).
