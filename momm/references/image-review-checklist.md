# Final-tree image gate — 1.16.1

This is a release check, not a claim of completed live coverage.

1. Pin and record the full candidate commit, Node version, OS and actual governor.
2. Use only a synthetic image whose visual defect and correct version are independently known.
   Example: a chart whose displayed total disagrees with two clearly labelled bars. Keep the
   expected answer private from the reviewers' prompt.
3. Use read-only preflight; verify two account-authenticated non-governor routes can actually
   receive the image. Do not count text-only reviews, API-key routes or stale probe evidence.
4. Run one bounded review with the image attached, `--min-success 2 --retry-invalid`, explicit
   reviewers and a synthetic local text brief. Do not change containment or run peer commands.
5. Record the run id, exact source/image hashes, exit, every attempt, failures, quorum and which
   routes identified the visual defect. A provider rejection is not a valid visual review.
6. Run the correct-image negative control if the prompt or adapter was changed, or if the attachment path or container handling changed: those decide which bytes reach the provider, so they can substitute one image for another just as a prompt change can. Reproduce and
   adjudicate findings; bind the final source to a tool-produced verification receipt.
7. Put only redacted, concise results on the 1.16.1 PR. Keep raw input, reports and ledger private.

Status: **not run on this candidate**. No earlier-tree live result substitutes for this gate.
