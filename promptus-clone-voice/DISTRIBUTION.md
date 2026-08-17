# Distribution notice

This package contains the **tooling** for consented local voice cloning with F5-TTS inside Promptus.
It contains **no voice data of any kind**.

## The rule that comes before the software

Clone a voice only when it is your own, or when you hold the speaker's explicit permission for that
specific use. Record that basis. Label synthetic speech wherever a listener could mistake it for a real
recording. Every tool here assumes this and several enforce it — the portal will not install a preset or
submit a generation without a recorded consent basis. **Do not remove those gates.** They are the reason
this is safe to distribute.

Voice cloning can be used to impersonate, defraud, harass, or defeat voice authentication. If that is the
intent, this package is not for you and its safety gates are not obstacles to route around.

## Deliberately not included

A voice recording is biometric data, and so is a synthetic render made from it. Neither leaves the machine
that produced it.

| Excluded | Why |
|---|---|
| Reference recordings (`.wav`) and their transcripts | Biometric data belonging to real speakers |
| Generated audio, including the diagnostic narration and video | Synthetic speech of a real person's cloned voice |
| SHA-256 digests of references and renders | Each uniquely identifies a specific biometric recording |
| Job history, consent logs, `data/` in its entirety | Contains narration text, hashes, and consent records |
| The Whisper model cache | Large, and rebuilt automatically on first use |
| Local editor settings | Contains the author's account name and absolute paths |
| The filled-in acceptance record | Describes specific speakers on one installation |
| Promptus logo and background | Promptus trademarks — bundling them is the publisher's call, not the packager's. Re-add with `--keep-brand-assets` if you have the right to redistribute them. **See the note below: omitting them has a visible consequence.** |

Speaker names in the documentation are pseudonymised (`voice-a`, `voice-b`, `voice-c`). The measurements
they describe are real; the identities are not disclosed.

## What is included

- **`promptus-clone-voice/`** — the agent skill: `SKILL.md`, 14 scripts, 5 reference documents.
- **`portal/`** — the companion local web app, source only. Binds to `127.0.0.1`.
- **`references/promptus-knowledge-base/`** — research on Promptus's architecture and design system.
- **`engineer-investigation.md`** — open questions with ready-to-run investigation prompts.

### The brand-asset trade-off, stated plainly

The portal's interface is built on Promptus's visual system and references its logo and contour
background by filename. With the assets omitted — the default — the portal still runs and every backend
gate works, but the interface renders without them and the bundled wiring test reports
`Promptus visual asset is missing: promptus-background.jpg`. That failure is expected in a default
package and is not a defect in the code.

Two ways to resolve it, both legitimate:

- Rebuild with `--keep-brand-assets` if you have the right to redistribute Promptus's marks. The wiring
  test then passes (verified: 130 HTML IDs, 117 JavaScript references).
- Or copy `promptus-logo.png` and `promptus-background.jpg` from your own Promptus installation into
  `portal/static/`. Nothing is redistributed, because you already have them.

## Requirements

Windows with the Promptus desktop app installed. Everything runs against Promptus's own managed Python,
ComfyUI and Cosy worker — do not create a separate environment. The scripts discover the installation
themselves; no path in this package is specific to any machine.

## Verifying a release

`package_for_distribution.py` copies by allow-list, pseudonymises what it keeps, then **re-scans its own
output and refuses to produce a package if anything sensitive survived** — account names, home paths,
full digests, speaker names, or credentials. A clean scan is the release gate.

To confirm the gate is live rather than assumed, plant a test string in the built output and re-run the
scan; it should refuse. That check was performed when this notice was written, and the gate caught all
three planted categories.

## Provenance of the findings

The reference documents describe defects measured on a real installation, including one that is still
open: the CLI and the portal post-process audio differently, so an identical render can pass or fail
depending on which entry point produced it. `engineer-investigation.md` treats that as the first item.
Nothing in this package claims production readiness.
