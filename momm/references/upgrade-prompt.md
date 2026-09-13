# Copy this prompt into your coding agent

Help me upgrade my existing MOMM installation to the latest publicly released
stable version. Do not install a candidate, an unsigned development head or a
version merely advertised by a page.

First locate the actual installed MOMM skill (including the older
multi-llm-review name), its permanent repository clone, my current harness and
version. Check the canonical marroccofella/skills release, manifest and release
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

If my old installation lacks the updater or receipt, explain that it needs a
one-time bootstrap. Show the exact permanent clone/ref/link changes and preserved
old installation before asking me to approve them. Do not invent a receipt,
silently retarget links, trust an old unsigned tag retroactively or claim rollback
is available before verifying it. Ask before installing a missing verifier.

After an approved upgrade, verify the installed version and harness discovery.
Read the newly installed MOMM skill, relaunch only the MOMM Setup Center process
you started, and show its local URL. Explain how to check reviewer versions and
explicit update actions. Distinguish login presence from a successful review;
ask before sending a synthetic connectivity test or any project source.

From my chosen project, demonstrate a small approved review using the absolute
installed dispatcher path. Reproduce findings, decide every suggestion, verify
completion using the installed governor command, and give me the private ledger
link. Finish with the before/after version, the verified public release-note link,
test results, any unavailable routes and the verified recovery instructions.
