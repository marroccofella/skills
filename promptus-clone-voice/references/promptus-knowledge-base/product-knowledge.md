# Product Knowledge

## Positioning

Promptus is a generative-AI creation and workflow platform spanning local desktop execution, browser creation, packaged ComfyUI workflows, optional cloud/API models, and distributed compute. The official mission is to make generative AI accessible while keeping advanced workflow control available to creators, developers, teams, and studios.

The product promise has two layers:

1. **Simple creation:** describe an output, choose a model or workflow, and generate images, video, audio, music, text, 3D, or edited media.
2. **Reusable execution:** package complex node graphs as CosyFlows with curated inputs, dependency metadata, defaults, and predictable outputs.

Official overview: [Promptus homepage](https://www.promptus.ai/) and [About Promptus](https://www.promptus.ai/resources/about).

## Product surfaces observed in the live app

| Surface | Purpose | Access observed |
|---|---|---|
| Playground | Unified prompt-driven generation across image, video, audio, 3D, and more; includes prompt enhancement, meme mode, model/options, credit display, and advanced settings. | Public shell; generation requires account/available backend. |
| My Collection | Manage generated images, videos, and audio. | Login required. |
| CosyTemplates | Browse packaged workflows and run them through Cosy. | Shell is public; catalogue requires the Cosy server. |
| Login / Profile | Authentication, subscription, and account entry point. | Public. |
| CosyClaw | A private hosted AI workspace powered by OpenClaw in a dedicated container. | Login required. |
| Upgrades | Account upgrades and entitlement changes. | Login required. |
| Explore | Community creations. | Public heading observed; content depends on remote data. |
| Server | Start/stop local ComfyUI, GPU, CPU, Cosy, ByteDance, CWorker, and Horde services through PManager. | Desktop/local context. |
| Settings | Generator preferences, menu ordering, sound/animation behavior, trust controls, and ByteDance enablement. | Public shell; some values may be local/account scoped. |
| Help | Tutorials, generated-media action explanations, offline setup, sampler descriptions, Discord, and email support. | Public. |
| Chat | Chat surface. | Present in navigation; no content loaded during the anonymous audit. |
| Comfy UI | Embedded local or cloud ComfyUI workspace. | Local instance was offline during the audit. |

Live app title: “Promptus - AI Video, Images, 3D, Audio and Photo Editor”.

## Core concepts and vocabulary

### Promptus Web

Browser-based creation with no local installation required. It is oriented around the Playground, account credits, collections, community, and provider-backed models.

### Promptus App / Desktop

The Windows desktop application packages the browser experience with local service management, ComfyUI, local model storage, output handling, and offline-capable execution. Official pages distinguish the desktop one-time licence from web subscription plans. See [Promptus pricing](https://www.promptus.ai/pricing).

### ComfyUI

The node-based execution engine used for complex local and cloud workflows. Promptus packages it and exposes it directly while also providing simpler interfaces over its graphs.

### CosyUI

Promptus's workflow infrastructure layer over ComfyUI. Official documentation describes it as accepting a ComfyUI JSON graph, resolving missing nodes/models, running the graph, and saving a cleaned-up reusable tool. See [CosyUI](https://www.promptus.ai/cosyui).

### CosyTemplate

A verified workflow shipped by Promptus. It carries a known graph, metadata, dependencies, public variables, and example intent.

### CosyFlow

A packaged reusable workflow/tool. It can be locally installed, exposed in Playground, shared, or exported as a local API. A CosyFlow is the hand-off layer between a raw node graph and a focused end-user tool.

### CosyCloud

Cloud execution for compatible ComfyUI/Cosy workflows. Official pages position it as the hosted alternative when a local GPU is unavailable or temporary scale is needed.

### CosyClaw

The anonymous live screen described CosyClaw as a private hosted AI workspace powered by OpenClaw, delivered in a dedicated container with access to advanced AI workflows. No deeper public technical page was located during this audit, so this description should not be expanded without fresh evidence.

### PManager / PQueue

Desktop lifecycle applications. PManager installs and starts local services; PQueue manages queued work. The live Server screen explicitly says servers must first be installed through PManager.

### CWorker

A ComfyUI-dependent worker surfaced in the live server controls. In the installed voice workflow it participates in Promptus-managed generation/service orchestration.

### Horde

Distributed AI Horde execution. The app exposes a Horde server toggle and the installation includes Horde model metadata and bridge code.

### My Collection vs Comfy Output

- **My Collection** is the account/cloud collection surface.
- **Comfy Output** is local ComfyUI output stored on the machine.

Do not use these names interchangeably in support, UI copy, or documentation.

## Creation capabilities

Observed across the live app, official website, and installed workflow catalogue:

- Text-to-image, image-to-image, inpainting, outpainting, relighting, style/reference control, background removal, restoration, and upscaling.
- Text-to-video, image-to-video, first/last-frame video, pose/motion transfer, video edit, lip sync, and animation.
- Text-to-audio, music generation/editing, speech synthesis, voice cloning, and speech-to-text.
- Text/image/multiview-to-3D model, mesh, and Gaussian splat workflows.
- LLM text generation and multimodal image/video/audio understanding.
- Prompt enhancement, meme creation, image description, reusable custom fields, public/private collections, and export/share actions.
- Local API export for saved CosyFlows.

## Audiences

Official pages name creators, designers, developers, marketers, product teams, studios, agencies, enterprises, startups, freelancers, and GPU owners. The product's distinctive fit is users who want simple everyday generation without losing access to graph-level control and local execution.

## Execution choices

| Mode | Strength | Main caveat |
|---|---|---|
| Web/provider | Fast start, current commercial models, no local setup. | Credit cost, provider availability, and cloud data handling. |
| Local GPU | Privacy, predictable marginal cost, offline workflows, custom models. | Hardware/VRAM, model downloads, and local maintenance. |
| Local CPU | Broad hardware reach for lighter tasks and utilities. | Usually slower and unsuitable for many large generative models. |
| CosyCloud / managed GPU | Larger hardware and temporary scale. | Hosted cost and cloud privacy assumptions. |
| Horde/distributed | Flexible community compute and monetizable idle GPUs. | Queue/provider variability and different trust boundaries. |
| Direct API workflows | Access to specialist commercial models. | Provider keys/credits, network dependence, and changing model terms. |

## Pricing snapshot and warning

Pricing was inconsistent across first-party surfaces on the audit date:

- The live anonymous login subscription iframe showed Artisan **$7/month** and Designer **$29/month**.
- The official pricing page showed promotional Artisan **$5/month**, Designer **$25/month**, and a **$49 lifetime** local-app licence.

This is a time-sensitive commercial detail, not a stable product constant. Always link to [current pricing](https://www.promptus.ai/pricing) instead of hard-coding a price into a new app.

## Brand philosophy

Promptus explains the Latin root *promptus* as “ready”, “evident”, “accessible”, or “prepared”. That supports a practical product-writing rule: advanced systems should feel available and ready to act, rather than mysterious or technically obstructive. See [Why We Named Our Company Promptus](https://www.promptus.ai/blog/why-we-named-our-company-promptus).
