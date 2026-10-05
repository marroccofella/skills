# MOMM 1.17.2 — release notes

**Released 5 October 2026.** The signed tag [momm-1.17.2](https://github.com/marroccofella/skills/releases/tag/momm-1.17.2)
names commit `80685113372a1f2a93d08a218801995a28ac2baa`, the exact sealed candidate tree
squash-merged from pull request 47. Do not install an unsigned branch as a signed release.

The immutable signed tag retains the pre-publication notes (publication pending) and
the `version-notes` history entry that were sealed before release. This post-release
document and the live release page are the publication record; the signed payload is
not retagged or resealed merely to change its historical notes.

Release evidence: [exact-main CI, 15/15](https://github.com/marroccofella/skills/actions/runs/37316304547),
[signed checkpoint](https://github.com/marroccofella/skills/actions/runs/37318187394),
[six hosted lifecycle cells, 13/13 steps each](https://github.com/marroccofella/skills/actions/runs/37319325734),
and [stable signing and update smoke](https://github.com/marroccofella/skills/actions/runs/37321320864).
Every lifecycle cell exercised recovery from interrupted upgrades from both 1.17.1 and 1.17.0.
Fresh-clone verification validated the Git signature, Rekor entry, expected certificate claims
and sealed payload; an intentionally wrong signing identity was refused.

1.17.2 is a patch for people who test MOMM and for anyone who keeps evidence outside their projects.
Nothing changes in how a review runs. One writer, read-only reviewers, account logins only and
automatic updates off: none of that changes.

**What was wrong**
- With `MOMM_EVIDENCE_HOME` set, 23 of the 97 commands of the suite pack failed on 1.17.1. That
  variable is the documented way to keep evidence, and the suite runner's saved report, outside a
  checkout. An independent tester found it on the day 1.17.1 was released: 74 of 97 suites, exit
  status 1. Every pre-release run of the pack had been made with the variable unset.
- The suites build small fixture projects with their own evidence folder. MOMM, as designed, looked
  in the external home instead, did not find the fixture's evidence, and the suites failed.
- `setup-ui.mjs --self-test` and `ledger.mjs --self-test` failed the same way, so someone with an
  evidence home was told that a working installation was broken.
- The runner's `--evidence-home` option, new in 1.17.1, had the same effect as the variable.
- A pack run with a real evidence home left folders for those fixture projects in that home.
- On 1.17.0 only six commands were tried: five suites and `setup-ui.mjs --self-test`. Each passed with
  the variable unset and failed with it set. The whole 1.17.0 pack was never run with the variable set,
  so there is no count for that release.

Reviews themselves were not affected: with an evidence home they worked before and work now.

**What changes**
- The suite runner starts every suite without `MOMM_EVIDENCE_HOME`, whether it came from your
  environment or from `--evidence-home`. Its own saved report still goes to the external home.
- Every suite drops the variable as its first statement, so a suite you start by hand passes too. A
  check holds that line in place in every suite, and a new suite starts other suites by hand under an
  inherited evidence home on every hosted operating system and Node version.
- The Setup Center and ledger self-tests no longer depend on your evidence home. A real Setup Center
  and a real ledger build still follow it.

**If you ran the 1.17.1 pack with a real evidence home**
It left one folder per fixture project under that home: 58 in one measured run on Windows. Whether
the 1.17.0 pack does the same was not measured; the check below serves for either. Every project
folder in an evidence home holds a `project.json` whose `project` is the path of the project the
folder belongs to. A folder is a fixture's only if all three of these hold:
- that path lies inside your temporary directory;
- the first folder name below the temporary directory is a prefix the suites use, then exactly six
  random letters and digits, as in `momm-governor-test-Ab3dE9`. The prefix is `momm probes tests-`,
  or `momm-` and one or more words of lower-case letters and digits, each followed by a hyphen. So
  the six characters come straight after a hyphen, and `momm-draft1` is not such a name. The suites
  name their temporary projects that way, and all 58 folders of the measured run were of this kind;
- the `project.json` was written while the pack was running.

Such a folder may be deleted. Leave every other folder. A path that no longer exists does not make a
folder a fixture's: a project of your own that you reviewed from a temporary folder and deleted
afterwards names a missing path there too, and its folder is your evidence. If you are unsure about
a folder, leave it.

**Testing 1.17.2**
The pack is expected to pass in three ways: with nothing set, with `MOMM_EVIDENCE_HOME` set to a
private folder outside the checkout, and with `--save-report --commit <full SHA> --evidence-home
<dir>`. After the second and third the evidence home should hold nothing but the runner's own run
folder (nothing at all without `--save-report`). The three self-tests are expected to pass with the
variable set or unset: `node momm/scripts/multi-review.mjs --self-test` (the dispatcher's, which
passed with the variable set on 1.17.1 too), `node momm/scripts/setup-ui.mjs --self-test` and
`node momm/scripts/ledger.mjs --self-test`.
Report in the [testing discussion](https://github.com/marroccofella/skills/discussions/32): your
operating system and Node version, which of the three ways you ran, and the last three lines the
runner printed.

**Known limits.** The tester's original result on 1.17.1, 74 of 97 with exit status 1, stands as the
record for that release; this patch does not relabel it. The hosted matrix does not run the whole pack
under an inherited evidence home: it runs the runner's own tests for it, the Setup Center and ledger
self-tests and a suite that starts a fixed set of suites by hand. The whole pack in the three ways was run by the
maintainer's harness on Windows only. The check that holds the line in every suite reads text: it
cannot see a module that would read the variable while it is being imported (none does today). The
limits listed in [the 1.17.1 notes](release-1.17.1.md) stand.

Details: [gate record and finding](gates-1.17.2.md) · [reviewer pack](third-party-test-plan-1.17.md)
