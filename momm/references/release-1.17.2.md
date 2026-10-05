# MOMM 1.17.2 — release notes

**Sealed; publication pending the signed release workflow.** Until the signed tag `momm-1.17.2` is
published, the current signed release remains 1.17.1. Do not install an unsigned branch as a signed release.

1.17.2 is a patch for people who test MOMM and for anyone who keeps evidence outside their projects.
Nothing changes in how a review runs. One writer, read-only reviewers, account logins only and
automatic updates off: none of that changes.

**What was wrong**
- With `MOMM_EVIDENCE_HOME` set, 23 of the 97 commands of the suite pack failed on 1.17.1. That
  variable is the documented way to keep evidence, and the suite runner's saved report, outside a
  checkout. An independent tester found it on the day 1.17.1 was released: 74 of 97 suites, exit
  status 1. The same commands fail on 1.17.0; nobody had run the whole pack that way before.
- The suites build small fixture projects with their own evidence folder. MOMM, as designed, looked
  in the external home instead, did not find the fixture's evidence, and the suites failed.
- `setup-ui.mjs --self-test` and `ledger.mjs --self-test` failed the same way, so someone with an
  evidence home was told that a working installation was broken.
- The runner's `--evidence-home` option, new in 1.17.1, had the same effect as the variable.
- A pack run with a real evidence home left folders for those fixture projects in that home.

Reviews themselves were not affected: with an evidence home they worked before and work now.

**What changes**
- The suite runner starts every suite without `MOMM_EVIDENCE_HOME`, whether it came from your
  environment or from `--evidence-home`. Its own saved report still goes to the external home.
- Every suite drops the variable as its first statement, so a suite you start by hand passes too. A
  check holds that line in place in every suite, and a new suite starts other suites by hand under an
  inherited evidence home on every hosted operating system and Node version.
- The Setup Center and ledger self-tests no longer depend on your evidence home. A real Setup Center
  and a real ledger build still follow it.

**If you ran the 1.17.1 or 1.17.0 pack with a real evidence home**
It left one folder per fixture project under that home. Each folder holds a `project.json` whose
`project` names the project it belongs to. Those that name a folder under your temporary directory
that no longer exists belong to the fixtures and are safe to delete. Folders that name your own
projects are your evidence: leave them.

**Testing 1.17.2**
The pack is expected to pass in three ways: with nothing set, with `MOMM_EVIDENCE_HOME` set to a
private folder outside the checkout, and with `--save-report --commit <full SHA> --evidence-home
<dir>`. After the second and third the evidence home should hold nothing but the runner's own run
folder (nothing at all without `--save-report`). `node momm/scripts/setup-ui.mjs --self-test` and
`node momm/scripts/ledger.mjs --self-test` are expected to pass with the variable set or unset.
Report in the [testing discussion](https://github.com/marroccofella/skills/discussions/32): your
operating system and Node version, which of the three ways you ran, and the last three lines the
runner printed.

**Known limits.** The tester's original result on 1.17.1, 74 of 97 with exit status 1, stands as the
record for that release; this patch does not relabel it. The hosted matrix does not run the whole pack
under an inherited evidence home: it runs the runner's own tests for it, the two self-tests and a
suite that starts a fixed set of suites by hand. The whole pack in the three ways was run by the
maintainer's harness on Windows only. The check that holds the line in every suite reads text: it
cannot see a module that would read the variable while it is being imported (none does today). The
limits listed in [the 1.17.1 notes](release-1.17.1.md) stand.

Details: [gate record and finding](gates-1.17.2.md) · [reviewer pack](third-party-test-plan-1.17.md)
