---
name: myrepo
description: Publish a project to GitHub as its own repository with a live, in-browser GitHub Pages site — scaffolding 42.uk-themed docs (README, LICENSE, .nojekyll), running a local-path privacy scan, creating or updating the repo under the authenticated account, enabling Pages, and verifying the live URL actually serves. Use when the user wants to publish, ship, release, or "make a repo" for a project so others can view or run it in a browser. Needs an authenticated gh CLI. Do not trigger for private scratch work the user has not asked to publish.
---

# myrepo — publish a project to GitHub with a live page

Turn a local project into its own public GitHub repository with a browser-runnable Pages site, conforming to the 42.uk theme and spec.

## Hard constraints

- **Publishing is outward-facing and requires the user's explicit go-ahead.** Before creating or pushing anything public, confirm with the user in chat: the exact repo name, public vs. private, and what will be pushed. A `--dry-run` preview is the safe way to show them first.
- **Never leak the local machine.** The publisher runs a privacy scan and refuses if it finds home/workspace paths (e.g. `C:\Users\...`, `/home/...`). Do not pass `--allow-paths` to silence it unless the user confirms those strings are intentional and safe.
- **Never publish secrets.** Do not publish a directory containing credentials, tokens, `.env` files, or private keys. Check before running.
- **Verify, don't assume.** The publisher polls the live Pages URL until it returns 200. Report the *verified* URL; if it did not go green, say so (Pages builds can lag a few minutes) rather than claiming it is live.
- **OAuth only.** Authentication is the user's existing `gh` login. Never request, embed, or suggest a Personal Access Token in code or committed files.

## Run it

1. Confirm the project has a web entry point if it should run in a browser: an `index.html` at the directory root. If there is none, the Pages site gets a themed landing page instead of a runnable app — tell the user which they are getting.
2. Preview first (creates nothing):

   ```text
   node scripts/publish.mjs --name <repo> --desc "<one-line description>" --dry-run
   ```

3. After the user confirms, publish for real:

   ```text
   node scripts/publish.mjs --name <repo> --desc "<one-line description>" --title "<Human Title>"
   ```

   This scaffolds `README.md`, `LICENSE`, and `.nojekyll` (keeping any existing README unless `--force-docs`), commits, creates `‹login›/‹repo›` (public by default; `--private` disables Pages), pushes, enables Pages, and verifies the live URL.

4. Relay the two links the publisher reports to the user: the **repository** and the **live in-browser page**. Both also appear in the JSON on stdout (`repo`, `pages_url`).

## Conforming docs and theme

Scaffolded docs carry the 42.uk identity: the `◆` mark, the project title and description, a **live page link**, a run-in-browser note, the MIT license, the "part of the 42.uk universe" line, and the tagline *RELAX. IT'S ALREADY OVER.* An app's own `index.html` is the page; a doc-only repo gets a themed landing `index.html` so it still has something to serve. Match new visual assets to the terminal palette (bg `#080a0a`, accent `#00ff99`, text `#e6ffe6`, monospace) so every 42.uk repo reads as one family.

## Options

`--dir <path>` project dir · `--private` (no Pages) · `--no-pages` · `--force-docs` overwrite README/LICENSE · `--allow-paths` skip the privacy scan (confirm first) · `--dry-run` · `--version`.

Companion skills: **momm** (review the code before you ship it) and **myvoice** (add a consented local voice). A good flow is *momm → fix → myrepo*.
