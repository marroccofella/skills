# Promptus Knowledge Base

Research snapshot: **2026-08-15**

This pack documents the Promptus product family, the locally observed technology stack, the CosyFlow ecosystem, and the visual system used by the live Promptus application. It also includes a framework-neutral starter template for new Promptus-aligned apps.

## Start here

- [Product knowledge](product-knowledge.md) — product surfaces, audiences, capabilities, and terminology.
- [Technology architecture](technology-architecture.md) — desktop, web, local services, execution paths, storage, and integrations.
- [Workflow catalogue](workflow-catalog.md) — the observed CosyTemplate/CosyFlow inventory and metadata rules.
- [Design system](design-system.md) — exact live-app colors, typography, spacing, components, states, responsive behavior, and brand variants.
- [Source ledger](source-ledger.md) — what was inspected, when, and how confident each class of claim is.
- [Starter template](template/README.md) — a drop-in HTML/CSS/JS reference implementation plus JSON and Tailwind tokens.

## Evidence labels

The documents use these labels to prevent observations from being mistaken for timeless product promises:

- **Live UI** — measured directly in `app.promptus.ai` / the redirected Promptus PWA on 2026-08-15.
- **Installed** — read from the local Windows Promptus installation on 2026-08-15.
- **Official** — stated on a Promptus-owned public page.
- **Inferred** — technically likely from artefacts, but not explicitly documented by Promptus.

## Snapshot highlights

- Live navigation exposes Playground, My Collection, CosyTemplates, Login/Profile, CosyClaw, Upgrades, Explore, Server, Settings, Help, Chat, and embedded ComfyUI.
- The desktop product is local-first and combines a packaged web app, ComfyUI, a Cosy workflow service, local GPU/CPU execution, distributed Horde execution, and optional cloud/API providers.
- The audited installation contained **197 bundled local workflows**, **124 bundled API workflows**, and **11 user-local workflows**.
- The live application theme is purple/amber/cyan, while the current marketing website uses a pink-led brand treatment. The included starter deliberately follows the live application because that is the requested match target.

## Maintenance rule

Treat pricing, model lists, workflow counts, server versions, and public statistics as volatile. Re-audit the live app and installation before publishing them externally. Stable design primitives and naming conventions can be reused more confidently, but should still be checked after a major Promptus release.
