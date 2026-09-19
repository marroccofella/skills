# New installations and legacy upgrades: verify before executing

Start here if MOMM is absent, an older installation has no updater or `momm.lock`,
or verification tools are missing. The existing installation remains usable while
you prepare a replacement. Do not repair trust failures with `git pull`, an
invented receipt, an unsigned tag, or a force flag.

## What the verification messages actually mean

| Observation | Meaning | Next step |
| --- | --- | --- |
| `gitsign_missing` | No signature check ran. Expected on a first install: most machines do not have the verifier yet | Ask once, in plain words, then install it as described under [Getting the verifier](#getting-the-verifier-gitsign-once) |
| `gitsign_unusable` | Installed verifier cannot perform the required check | Inspect its version/help and official installation instructions; do not bypass |
| GitHub `bad_cert` / Unverified | GitHub's badge is not a Sigstore verification result | Use gitsign with the expected release-workflow identity, issuer and transparency checks |
| `signature_unverified` | Required verification did not succeed | Stop; inspect network, trust-service and identity diagnostics. Do not assume tampering or assume safety |
| `hash_mismatch` | Package bytes disagree with the signed manifest | Stop before installation and report the exact release and diagnostic |
| `verified_prepared` | Signature and package hash passed in a new directory | Still not installed. Inspect the protocol and installer preview, then seek approval |

Sigstore uses short-lived certificates and a transparency record of signing time.
GitHub does not recognize these through its ordinary verified badge. A verified
commit badge also does not replace verification of the release tag and package.
See [gitsign's explanation](https://github.com/sigstore/gitsign#why-doesnt-github-show-commits-as-verified)
and [official installation instructions](https://github.com/sigstore/gitsign#installation).
No separate cosign installation is required for this gitsign path.

## Getting the verifier (gitsign), once

MOMM releases are signed with Sigstore, the signing system used by npm, Kubernetes and Python
packages. Checking that signature needs one small program, `gitsign`, from the Sigstore project.
Most machines do not have it, so a first install almost always pauses here. That is the design
working, not a fault: without the verifier no signature check can run, and MOMM never installs
unverified code. It is a one-time step; upgrades reuse it.

**What the agent should say, in words like these, and then wait for a yes:** "MOMM checks that a
release is genuine before installing it. That needs a small verifier called gitsign, from the
Sigstore project, which this machine does not have yet. It is a one-time install for your user
account only. May I install it? I will show you what I run."

Install the version MOMM's own release workflow uses, **0.17.1**, from the official project only
(`github.com/sigstore/gitsign`). Never from a mirror, a package of unknown origin or a search result.

| System | How |
| --- | --- |
| macOS, or Linux with Homebrew | `brew install gitsign` |
| Debian or Ubuntu | Download `gitsign_0.17.1_linux_amd64.deb` (or `arm64`) from the official release page, check it as below, then `sudo dpkg -i` it |
| Fedora, RHEL | The matching `.rpm` from the same page, checked the same way |
| Any system with Go 1.22 or later | `go install github.com/sigstore/gitsign@v0.17.1` |
| **Windows** | There is no installer or winget package. Download `gitsign_0.17.1_windows_amd64.exe` (or `arm64`) and `checksums.txt` from `https://github.com/sigstore/gitsign/releases/tag/v0.17.1`. Compare `Get-FileHash <file> -Algorithm SHA256` with that file's line in `checksums.txt`; stop if they differ. Save it as `gitsign.exe` in a folder for the user only, for example `%LOCALAPPDATA%\Programs\gitsign`, and add that folder to the **user** PATH. No administrator rights are needed. |

Then confirm with `gitsign --version` in a new terminal, and continue with the verified install.

What the checksum does and does not prove: it shows the download is the file the Sigstore project
published, intact. The trust still rests on the official `sigstore/gitsign` repository over HTTPS,
as it does for the Homebrew and Go routes. If a download, a checksum or `gitsign --version` fails,
stop and report it; do not look for another source and do not continue without the verifier.

## First establish trust in the bootstrap tool

Older releases do not contain `momm/scripts/bootstrap.mjs`. Obtain the standalone
[bootstrap source](https://github.com/marroccofella/skills/blob/momm-1.16.0/momm/scripts/bootstrap.mjs)
separately from the candidate release. Inspect the complete file with your agent
and approve trusting it before running it; alternatively use a copy your
organization has already reviewed and distributed. It imports Node builtins only.
It cannot authenticate itself. Downloading this file over HTTPS or reviewing its
text is not equivalent to verifying the target release's signature.

Do not execute an unverified candidate's installer, Setup Center or updater to
verify that same candidate. The separately trusted bootstrap tool verifies Git
objects before checking out release files, and never executes the fetched code.
Node 18+ and Git are required; prerequisite installation remains your decision.

## Check first: no network, writes or model calls

Use the absolute path to your separately trusted copy:

```text
node <trusted-bootstrap.mjs> --check
node <trusted-bootstrap.mjs> --check --existing <actual-old-skills-clone>
```

Missing tools produce exit code 2 and structured next steps, not a claim that the
signature is bad. The command never scans arbitrary projects or guesses a harness.
Receipt presence is not full receipt validation. Invalid or unreadable receipts
need inspection; never synthesize one to unblock an update.

## Prepare an exact public stable release

Choose the version from [published releases](https://github.com/marroccofella/skills/releases),
not a candidate branch. The permanent parent folder must already exist and the
new destination must not exist. Example version 1.15.1 is a fixed example, not a
promise that it will always be the latest release:

```text
node <trusted-bootstrap.mjs> --prepare --version 1.15.1 --destination <new-permanent-directory>
```

This explicit operation contacts GitHub and Sigstore trust/transparency services.
It rejects draft/prerelease metadata, requires an annotated tag, verifies the
exact release-workflow identity, GitHub OIDC issuer, repository, ref and commit,
then recomputes the canonical package hash from signed Git objects. Only after
these checks pass does it check out the release, with hooks disabled.

It never installs a verifier, runs release code, changes discovery links, creates
an installation receipt or modifies the old clone. Save its JSON result in your
private support record. On failure it retains the new diagnostic directory;
inspect it, and choose a different new destination for a later attempt. There is
no overwrite, force or automatic cleanup option.

## Choose the correct installation path

| Starting point | After the new release is verified |
| --- | --- |
| No MOMM installation | Read the verified protocol and installer help; preview only MOMM for your explicit harness, then approve installation |
| Old release without updater or receipt | Preserve the old clone, private ledgers, settings and exact link targets; inspect the old/new protocol diff; approve each discovery-link change explicitly |
| 1.15.0 with a valid receipt | Its staging-discovery defect requires the verified newer updater's `--repo <old-clone>` option; preview first, then approve apply and any protocol change |
| Working updater with a valid receipt | Use its normal check and verified `--dry-run`; apply only after approval |
| Invalid receipt, unknown path or local edits | Stop the installation step and inspect. Never overwrite or guess the missing scope |

From the verified prepared clone, a MOMM-only new-install preview is:

```text
node momm/scripts/install.mjs --target <chosen-harness> --dry-run
```

Inspect the verified `SKILL.md`, saved/selected scopes and proposed links. Ask
before applying the same command without `--dry-run`. Do not select `all` unless
the user actually wants every supported harness. Custom scopes require the
harness's documented directory. Existing paths are conflicts, not permission to
delete: record and retain the old link/directory before any approved replacement.
Do not delete the old repository or private ledgers. Verify the new link target,
installed version and receipt after installation.

### First-class legacy migration: no improvised file moves

The separately trusted `migrate-legacy.mjs` helper, together with its adjacent
`bootstrap.mjs`, handles an existing entry named `momm`. Older published releases
do not contain these helpers; inspect/trust both files separately first. It is
not an installer flag in 1.15.1. Both preview and apply re-verify the exact public
release and compare its working files with signed Git objects before any release
code runs. Use a newly prepared clone with no installation receipt.
Repository-local configuration is not authenticated by a release signature:
the helper refuses nonstandard Git administration, replacement refs, alternate
object stores and executable/config indirection. It verifies object contents as
well as the signed tag. If this guard refuses a modified clone, prepare a new
directory; do not remove the guard or overwrite the old clone's configuration.
Git and gitsign are resolved to absolute executable paths outside the directory
being inspected, never by searching that directory. Tracked changes and untracked
or ignored working files are refused before linking the release. Missing tools or
an unavailable integrity check carry separate prerequisite/cause codes; a timeout
is not evidence of tampering.

```text
node <trusted-migrate-legacy.mjs> --prepared <verified-clone> --version 1.15.1 --skill-path <absolute-existing-momm-entry> --backup <absolute-new-backup-outside-discovery>
```

The default is a non-changing preview: exact source, destination, backup, journal
and full old/new protocol. After separately approving the link change and any
protocol change, repeat with `--apply --plan-sha256 <approved-preview-hash> --accept-protocol`.
Use the preview's `plan_sha256`: it binds the release, full old/new protocol,
original entry and exact paths. If any of these change, obtain a new preview and
approval. This moves the old entry
atomically to the approved same-volume backup, runs only the verified MOMM-only
installer for the explicitly named discovery parent, and checks the new link and
receipt. A failed install attempts restoration; if another entry has appeared,
it stops rather than overwriting it. Other agents/updates should be idle during
migration. A competing migration is refused by an exclusive discovery lock.
If a previous lock's process ID is still alive or cannot be inspected, recovery
stops for owner verification; it never assumes that a reused or inaccessible PID
is safe to ignore. Do not delete the lock just to force progress. This uncommon
case still requires deliberate operator inspection.
Rollback also takes an exclusive recovery claim, including when the original
owner is dead. A recovery claim left by an interruption remains fail-closed for
operator inspection; it is never silently stolen or deleted to force progress.
A migration lock with no journal gets `orphan_lock_no_journal` and inspection
guidance. It is not falsely offered a rollback command for a nonexistent journal.

Never put `momm.1.10.2.bak` under a skill-discovery directory: some harnesses may
discover it as another active skill. Backups and the migration journal must be
outside that directory, retained until the user chooses to remove them. The helper
prints the exact recovery command:

```text
node <trusted-migrate-legacy.mjs> --rollback <absolute-migration-journal>
```

Project `.ensemble_reviews/` folders and project `.gitignore` files stay in place.
They must not be blindly copied into or over a new clone. Files inside the old
physical skill directory move intact with its backup; when the old entry is a
symlink/junction, its original target is never moved. Relative links are restored
with their original text; a moved relative backup link may not resolve until
restored. Rollback retains the prepared clone and any new receipt for diagnosis,
not as an active installation. This is process-recovery support, not a disk backup
or a promise of power-loss durability.

Protocol review must inspect actual removed rules and their enforcement—not
count occurrences of “sanitize” or “redact”. The explicit rule against relaying
sensitive provider diagnostics remains part of MOMM's hard constraints.

For a legacy transition without this helper, recovery initially means restoring the preserved old
discovery link. Do not promise `update --rollback` before a genuine previous
installation has been recorded and verified by the updater. A prepared signature
proof is not itself a completed installation receipt.

Restart only the relevant agent session/Setup Center if necessary, then run an
approved synthetic reviewer check separately. Tool readiness, a valid release,
correct harness discovery and a successful live review are four different checks.

## Release acceptance requirements

The bootstrap fixtures belong in the Windows/macOS/Linux Node matrix. They cover
missing tools, new/legacy/staging routes, wrong identities, unsigned tags, bad
hashes, draft releases and preservation of an existing destination. Fake verifier
fixtures test control flow, not cryptography: release validation also needs a
genuine signed release preparation and an intentionally wrong-identity control.
Native macOS results must be recorded separately from simulated macOS messages.

Do not call this prevention live until the code, public upgrade guide and Pages
changes are published together and checked from a clean environment. Never retag
or rewrite an existing release to hide an earlier limitation.
