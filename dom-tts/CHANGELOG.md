# 0.5.0-dev.1 — bug-fix evolution

Based on reviewed 0.4.0-dev.2 (75ba1ce, PR #39). Failure-first terminal summaries,
saved inclusion settings and watcher precedence, filename/path status summaries,
fresh-process Windows ACL checks, POSIX mode revalidation, recovery cleanup ownership,
relative/project-local Linux engine rejection, sanitized blocked-policy/install errors,
meaningful settings preservation, native privacy/latency verdicts and checked-in native
boundary tests. No new providers, global watcher, microphone, tray or Duplex features.
The previous golden/reply corpus stays; five expectations changed after output review.
See EVOLUTION.md for migration and open release gates.

# Changes

## 0.4.0-dev.2

- Windows permission check: 60-second limit, typed failure reasons, and a folder-bound
  marker so it runs once per state folder instead of before every playback.
- Automatic recovery of a dead owner's playback lock, orphaned speech files and stale
  "speaking" status; live owners and locks still being written are never removed.
- Markdown tables spoken row by row; blockquote markers removed; unified diffs and
  Python stack frames skipped in informative mode; log modes read fenced output and
  match names such as FileNotFoundError.
- A POSIX state directory too long for the stop socket (over about 85 characters;
  macOS allows 104 bytes per socket path) now fails with a clear message instead of
  a truncated socket.
- 30 realistic multi-paragraph replies added to the corpus with per-mode expectations.
- One path-filtered CI workflow; the 0.3.2 workflow and the inert nested copy removed.
  CI verifies the committed manifest instead of regenerating it.

## 0.4.0-dev.1

- Portable CLI and Agent Skill, with Windows SAPI, macOS say and Linux espeak-ng adapters.
- Golden text corpus, strict options, abbreviation-aware summaries, word-aware bounded chunks.
- Retain failed watcher messages for retry; consent-gated commentary and normalized JSONL.
- One Windows speech process per request; authenticated local IPC stop without PID killing.
- Private, atomic runtime state without stored speech snippets or transcript paths.
- Allowlisted child environment and portable typed diagnostics.
- Hash-verified source installation with retained upgrade/rollback/uninstall snapshots.

Native macOS/Linux audio, a second Windows host, agent trigger scoring and listener
quality evaluation remain required before a stable release.

