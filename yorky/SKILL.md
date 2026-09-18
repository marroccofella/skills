---
name: yorky
description: Yorkie v1.1 is the short callable name for yorkshire-pudding: translate prose, jokes, READMEs, long accurate documents, comments, docstrings, and code into authentic Yorkshire dialect at three gravy levels without breaking code. Use for Yorkshire speak, "yorkshirify", yorky, or Yorkie requests.
---

# Yorkie v1.1 → yorkshire-pudding

`yorky` is the short, callable name for the **[yorkshire-pudding](../yorkshire-pudding/SKILL.md)** skill, publicly presented as Yorkie v1.1. Follow that skill's full protocol — it is the canonical source.

**The zero-dependency translator lives in the canonical skill.** Resolve its path from the installed skills directory (not relative to your current working directory, which varies):

```text
node <skills-dir>/yorkshire-pudding/scripts/yorkshirify.mjs --level proper --input <file>
```

On a standard install that is `~/.agents/skills/yorkshire-pudding/scripts/yorkshirify.mjs` (Codex/Agent Skills) or `~/.claude/skills/yorkshire-pudding/scripts/yorkshirify.mjs` (Claude Code). Text can also be piped on stdin instead of using `--input`.

**Safety rules (non-negotiable, from the canonical skill):** identifiers, keys, URLs, placeholders, imports, and program logic are never touched — only human-readable prose is translated. Three gravy levels: `mild`, `proper`, `broad`.

For international or academic readers and extremely long documents, also follow
the canonical [long-form guide](../yorkshire-pudding/references/longform-guide.md).
See [yorkshire-pudding/SKILL.md](../yorkshire-pudding/SKILL.md) for the complete dialect guide, zone rules, and examples.
