# Copy this prompt into your coding agent

Install MOMM if absent, or safely upgrade my existing installation to the latest publicly released
stable version. Do not install a candidate, an unsigned development head or a
version merely advertised by a page.

First detect my operating system and locate any actual installed MOMM skill (including the older
multi-llm-review name), its permanent repository clone, my current harness and
version. If absent, choose a permanent clone location outside my projects. Check the canonical marroccofella/skills release, manifest and release
notes, and show what changed since my installed version. Do not assume this
project directory is the skills clone or guess my harness installation targets.

Preserve my project, local changes, private review ledgers, reviewer logins and
existing skill scopes. Never request API keys, discard changes, overwrite an
unrelated discovery path or install tools in the background.

Before executing any newly fetched release code, verify its signed tag, expected
release-workflow signing identity and package hash. This applies to both an
ordinary update and a legacy bootstrap. Stop if verification is unavailable;
ask before installing a missing verifier.

If my installation has the explicit update command and a valid momm.lock,
run the information check and then the verified dry-run from the skills clone.
Show the exact target version, changed files, complete protocol/default/persona
diff, saved harness scopes, network destinations and rollback path. Verify the
signed tag, expected signing identity and package hash. Ask me before applying;
ask separately for protocol acceptance if it changed. Never use --yes to bypass
protocol consent or fall back to git pull when verification fails.

For a new installation, read the verified release's installer help. Install only
MOMM into this harness's documented user-level skill scope: preview with
`node momm/scripts/install.mjs --target <chosen-harness> --dry-run`, then ask
before applying the same command without `--dry-run`. Do not use the repository-wide
installer's default to install unrelated skills. For an unnamed harness, verify
its documented custom skill directory; never invent paths or claim universal support.

If my old installation lacks the updater or receipt, explain that it needs a
one-time bootstrap. Show the exact permanent clone/ref/link changes and preserved
old installation before asking me to approve them. Do not invent a receipt,
silently retarget links, trust an old unsigned tag retroactively or claim rollback
is available before verifying it. Ask before installing a missing verifier.

After an approved install or upgrade, verify the installed version and harness discovery.
Read the newly installed MOMM skill, relaunch only the MOMM Setup Center process
you started, and show its local URL. Explain how to check reviewer versions and
explicit update actions. Distinguish login presence from a successful review;
ask before sending a synthetic connectivity test or any project source.

Make MOMM my default peer-review workflow across projects using this harness's
documented user-level standing instructions. Preserve every existing rule and add
a labelled section: use MOMM for requested peer reviews and before finalizing
substantive coding changes, fixes, refactors and releases. The current agent stays
governor and sole writer; reproduce material findings, verify fixes and adjudicate
every suggestion. Respect project restrictions and provider-sharing permissions;
never recursively dispatch or run reviews for every conversational message.
Discovery links alone do not activate this rule. Verify it in a fresh context
where possible, or explain the necessary restart and any unsupported global scope.

From my chosen project, demonstrate a small approved review using the absolute
installed dispatcher path. Reproduce findings, decide every suggestion, verify
completion using the installed governor command, and give me the private ledger
link. Finish with the before/after version, the verified public release-note link,
test results, any unavailable routes and the verified recovery instructions.
