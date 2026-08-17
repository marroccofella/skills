# Workflow Catalogue

## Audited on-disk inventory

Snapshot date: **2026-08-15**

| Catalogue | Files | Main categories |
|---|---:|---|
| Bundled local workflows | 197 | 94 image, 55 video, 13 audio, 8 3D, 4 LLM, plus Promptus-specific image/audio/video/LLM and a few uncategorized files. |
| Bundled API workflows | 124 | 56 image, 42 video, 10 3D, 4 audio, 4 use cases, 2 video API, 2 LLM, 2 utility, and 2 uncategorized files. |
| User-local workflows | 11 | Local voices, image templates, and one custom image workflow. |

These counts are files on this installation, not a commercial promise. The official website separately advertises 150+/169+ ready workflows depending on page/date.

## Bundled local category breakdown

| Category | Count |
|---|---:|
| `ComfyUI/Template/Image` | 94 |
| `ComfyUI/Template/Video` | 55 |
| `ComfyUI/Template/Audio` | 13 |
| `Promptus/Cosy/Image` | 9 |
| `ComfyUI/Template/3D Model` | 8 |
| `ComfyUI/Template/LLM` | 4 |
| `Promptus/Cosy/Audio` | 4 |
| `Promptus/Cosy/LLM` | 3 |
| `Promptus/Cosy/Video` | 3 |
| Blank/legacy category | 4 |

## API category breakdown

| Category | Count |
|---|---:|
| `ComfyUI/Template/Image` | 56 |
| `ComfyUI/Template/Video` | 42 |
| `ComfyUI/Template/3D Model` | 10 |
| `ComfyUI/Template/Audio` | 4 |
| `ComfyUI/Template/Use Cases` | 4 |
| `ComfyUI/API/Video` | 2 |
| `ComfyUI/Template/LLM` | 2 |
| `ComfyUI/Template/Utility` | 2 |
| Blank/legacy category | 2 |

## Native CosyFlow shape

Promptus-authored `.cosy` files use these top-level keys:

```json
{
  "title": "(cosy) Promptus: Example",
  "category": "Promptus/Cosy/Image",
  "tags": ["Image", "Text to Image"],
  "description": "One short sentence describing the workflow.",
  "workflow": {},
  "prompt": {},
  "assignments": [],
  "variables": []
}
```

Do not add arbitrary top-level keys to a native flow without verifying the current worker accepts them.

## Naming and metadata conventions

- Title: `(cosy) Promptus: <Name>` with a variant in square brackets when needed.
- Category: `Promptus/Cosy/<Media>` for Promptus-authored simplified tools.
- Tags: normally exactly two, with media first and task second.
- Description: one plain sentence naming the model or task.
- Filename: lowercase ASCII with underscores is the most portable convention.
- Public variable title: `<Node title>: <input name with underscores changed to spaces>`.
- Primary content uses importance 5; important selectors 4; ordinary controls 3; plumbing 1–2.
- Seeds use the `seed` type, allow `-1` for random, and convert with `seed_to_int`.

## Workflow states

The Cosy catalogue reports dependency state:

- `INSTALLED` — required custom nodes and external models are available.
- `INSTALLABLE` — the catalogue knows the dependencies but they are not all installed.

Existence in the catalogue does not mean a workflow can run immediately. New apps must display install state and dependency actions separately from the primary Run action.

## Recommended workflow card fields

A Promptus-aligned browser/card should expose:

- title;
- short description;
- media and task tags;
- bundled/verified/local/imported trust label;
- installed/installable state;
- model/storage requirement;
- local/cloud/API execution badge;
- example output when available;
- primary Run or Install action;
- secondary Details action.

## Voice workflows observed

Promptus ships three main speech paths:

| Workflow | Intended use |
|---|---|
| Promptus Audio F5TTS | Clone a consented voice from a short reference. |
| Promptus Kokoro TTS | Use a clean preset narrator without a reference recording. |
| Promptus Zonos TTS | Emphasize explicit emotion control over exact speaker matching. |

The local user catalogue also contained several F5 Studio voice presets. Some older titles/categories predate current Promptus conventions. New tools should not copy legacy em-dash naming or three-level Local Voice categories unless compatibility requires it.

## Catalogue design guidance

- Query the live Cosy service at runtime; do not compile all workflow titles into an app.
- Keep filters aligned to the media categories users already understand: Image, Video, Audio, 3D, LLM, Utility, and Use Case.
- Preserve the difference between verified CosyTemplates and user-created/imported CosyFlows.
- Surface model size and install requirements before the user commits to a download.
- Show local/API/cloud execution as a trust and cost decision, not just an implementation detail.
