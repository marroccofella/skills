# Changes

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

