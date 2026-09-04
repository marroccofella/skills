# MOMM 1.14.1 — second round of feedback on the page

Released 2026-09-04, a patch on 1.14.0 after a second external read of the rewritten page.

## Done

- **FAQ answers are visible without clicking.** They were inside collapsed `<details>` elements, which read as empty headings in a text paste. They are now plain question-and-answer blocks, with the CI answer corrected: there is no token or API-key path, so a headless runner without an authenticated CLI session cannot review — run it pre-push locally with `--tier quick`.
- **ANSI and OSC escape sequences are stripped before the JSON parse boundary.** A CLI that believes it is on a TTY can wrap its reply in colour or title sequences; those no longer misfile a valid reply as `invalid_output`. Self-test `ansi_wrapped_json_still_parses`. (This is hygiene, not the Antigravity fix: its diagnosed failure is an empty `response` above roughly 30 KB of input, still on the roadmap.)
- **The route table is also published as Markdown** (`docs/momm/data/routes.md`) and shown beside the static HTML table, so it copies cleanly into a terminal or text browser.
- **Footer reordered**: the 42.uk house motto is mentioned mid-paragraph; the page ends on the licence.

## Declined, again with the reason

- **Auto-executing a reviewer-supplied `repro_assertion`.** Running a snippet authored by an untrusted reviewer — even in a sandbox, even to save the driver tokens — is exactly the instruction-following the protocol forbids, and a sandbox escape would be a code-execution primitive handed to whichever vendor is wrong that day. Reviewers already return `test_suggestion`; the driver rewrites and runs its own reproduction.
- **"Automated reproduction gate" in the header.** The gate is mandatory by protocol and enforced by the driving agent, not automated by the dispatcher; the honest word stays "reproduction gate".

## Verification

Dispatcher self-test 65/65, ledger, Setup Center, myskills health contract, myrepo offline self-test; page audit on the live URL; the Windows/macOS/Linux × Node 18/20/22 Actions matrix.
