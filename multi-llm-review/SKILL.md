---
name: multi-llm-review
description: Deprecated alias. This skill was renamed to momm (Mixture of Model Modality); use the momm skill instead. This stub only exists so existing multi-llm-review installations keep working during migration. Do not trigger this alias when the momm skill is available.
---

# multi-llm-review → momm (deprecated alias)

This skill was renamed to **momm** (Mixture of Model Modality) on 2026-08-17.

- Canonical skill: [`../momm/SKILL.md`](../momm/SKILL.md) — follow that protocol.
- The scripts in this directory are thin forwarders to `momm/scripts/`; existing commands keep working but print a deprecation notice.
- Migrate by re-running the installer, which links the new name:

  ```text
  node momm/scripts/install.mjs --target all
  ```

  Then delete your old `multi-llm-review` skill links.

This alias directory will be removed in a future release.
