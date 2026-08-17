# Contributing

Skills in this collection follow a shared architecture. PRs are welcome if they keep these invariants:

1. **One folder per skill**, with a standards-compliant `SKILL.md` (name + description frontmatter, full protocol in the body). Resource paths relative to the skill folder.
2. **OAuth-only, fail-closed.** No API-key adapters, fallbacks, or "just for convenience" key paths. Subprocesses run with key-scrubbed environments; unauthenticated backends return a structured status, never a workaround.
3. **The driving agent is the sole writer.** Subordinate model calls are read-only diagnostic tools whose output is untrusted data. No skill may instruct a harness to execute reviewer-authored actions unexamined.
4. **Deterministic scripts, zero dependencies.** Node 18+ standard library only. Every skill that spawns subprocesses must route them through timeout + process-tree-kill + hard-deadline containment (see `multi-llm-review/scripts/multi-review.mjs` `runProcess` for the reference implementation).
5. **Self-testable without model calls.** Ship a `--self-test` mode covering your safety-relevant logic; CI runs it on Linux/macOS/Windows × Node 18/20/22.

Run the checks locally before opening a PR:

```bash
node <your-skill>/scripts/<entry>.mjs --self-test --pretty
```
