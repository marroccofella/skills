# Source Ledger

Audit date: **2026-08-15**

## Direct live UI evidence

Inspected through the rendered browser application:

- [app.promptus.ai](https://app.promptus.ai/) redirect and anonymous app shell.
- Live routes for Playground, My Collection, CosyTemplates, CosyClaw, Upgrades, Explore, Server, Settings, Help, Chat, ComfyUI, and Login.
- Rendered computed styles, stylesheet inventory, responsive viewport, image assets, navigation states, panels, buttons, inputs, badges, radii, shadows, and type stack.
- Exact assets captured from the public app build: contour background and Promptus light logo.

Confidence: **highest for the audited build and date**. Authentication-gated screens were not entered, and the local Cosy service was stopped, so anonymous text and shell states were used where applicable.

## Local installed evidence

Read-only inventory of the Windows installation:

- `%APPDATA%\promptusai\install.json` (installation location and launcher schema only).
- Executable version metadata for Promptus, PManager, and PQueue.
- Top-level installation components.
- Bundled CosyFlow and API workflow metadata, aggregated without printing provider secrets.
- Managed ComfyUI/custom-node structure.
- Embedded Python and unpacked native Node dependency names.
- Existing repository research:
  - `promptus-clone-voice/references/recreation-analysis.md`
  - `promptus-clone-voice/references/promptus-conventions.md`
  - `promptus-clone-voice/references/dependencies-and-storage.md`
  - `promptus-clone-voice/references/reading-promptus-logs.md`

Confidence: **high for this machine and date**. Counts, versions, paths, and installed nodes can differ on another machine or release.

## Official Promptus sources

- [Promptus homepage](https://www.promptus.ai/)
- [Pricing and Web/Desktop distinction](https://www.promptus.ai/pricing)
- [CosyUI and CosyTemplates](https://www.promptus.ai/cosyui)
- [ComfyUI/CosyFlow product layer](https://www.promptus.ai/comfyui)
- [Local AI product](https://www.promptus.ai/local)
- [Features](https://www.promptus.ai/features)
- [FAQs](https://www.promptus.ai/resources/faqs)
- [About](https://www.promptus.ai/resources/about)
- [Press kit and historical color guidance](https://www.promptus.ai/resources/press-kit)
- [Why the Promptus name was chosen](https://www.promptus.ai/blog/why-we-named-our-company-promptus)
- [ComfyUI local/cloud explanation](https://www.promptus.ai/blog/is-comfyui-web-based)
- [Lifetime desktop positioning](https://www.promptus.ai/lifetime-promptus)

Confidence: **authoritative for stated product intent**, but marketing numbers, model names, prices, and platform claims may change or differ across pages.

## Important contradictions / freshness warnings

- Subscription prices differed between the live login iframe and the official pricing page.
- The website advertises 150+, 169+, 615+, or other workflow totals in different contexts, while the installed build contained 197 local bundled and 124 API workflow files.
- One official page says Windows + Mac; another says Windows only. Treat platform support as release/channel specific and verify before purchase or deployment.
- The app shell version and desktop executable version are different version streams.
- The public press-kit palette does not match the current live application theme.

## Research boundaries

- No account login, purchase, form submission, server start, workflow install, or external write was performed.
- No secret-bearing provider configuration was printed or copied.
- No claim was made that every on-disk provider workflow is enabled for the current account.
- No source package from the large desktop `app.asar` was unpacked; desktop/web framework statements are labelled as observations or inference accordingly.
