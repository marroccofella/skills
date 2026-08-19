---
name: yorky
description: Translate owt and everything — prose, jokes, READMEs, commit messages, error strings, comments, docstrings, even whole code files — into authentic Yorkshire dialect at three gravy levels (mild, proper, broad) without ever breaking the code. "yorky" is the short callable name for the yorkshire-pudding skill; use it when a user asks for Yorkshire speak, Yorkshire accent or dialect, to "yorkshirify" something, t'northern version of a text, or invokes yorky or yorkshire pudding by name.
---

# yorky → yorkshire-pudding

`yorky` is the short, callable name for the **[yorkshire-pudding](../yorkshire-pudding/SKILL.md)** skill. Follow that skill's full protocol — it is the canonical source.

**The zero-dependency translator lives in the canonical skill.** Resolve its path from the installed skills directory (not relative to your current working directory, which varies):

```text
node <skills-dir>/yorkshire-pudding/scripts/yorkshirify.mjs --level proper --input <file>
```

On a standard install that is `~/.agents/skills/yorkshire-pudding/scripts/yorkshirify.mjs` (Codex/Agent Skills) or `~/.claude/skills/yorkshire-pudding/scripts/yorkshirify.mjs` (Claude Code). Text can also be piped on stdin instead of using `--input`.

**Safety rules (non-negotiable, from the canonical skill):** identifiers, keys, URLs, placeholders, imports, and program logic are never touched — only human-readable prose is translated. Three gravy levels: `mild`, `proper`, `broad`.

See [yorkshire-pudding/SKILL.md](../yorkshire-pudding/SKILL.md) for the complete dialect guide, zone rules, and examples.
