# multi-llm-review → momm (deprecated forwarders)

`multi-llm-review` was renamed to **momm** (Mixture of Model Modality) on 2026-08-17.
It is no longer a skill of its own: this folder has no `SKILL.md`, so a harness never
discovers the old name beside the new one.

- Canonical skill: [`../../SKILL.md`](../../SKILL.md) — follow that protocol.
- The scripts in this directory are thin forwarders to `momm/scripts/`; they print a deprecation notice and then run the real command.
- Migrate by re-running the installer, which links the new name:

  ```text
  node momm/scripts/install.mjs --target all
  ```

  Then delete your old `multi-llm-review` skill links.

These forwarders will be removed in a future release.
