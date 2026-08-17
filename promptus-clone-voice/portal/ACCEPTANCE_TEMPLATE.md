# Voice acceptance record — template

Copy this to `ACCEPTANCE_TEMPLATE.md` in your own installation and fill it in. The filled-in record is
**installation-specific and is not distributed**: it names real speakers and carries digests of their
recordings.

A preset is **not** accepted merely because it appears in the picker. Discovery proves nothing. Acceptance
requires all three of:

1. a **comparable generation** — identical narration, seed, mode and controls as every other candidate;
2. a recorded **consent basis** — you are the speaker, or you hold their explicit permission;
3. a recorded **human listening verdict** — no metric can judge cadence or emotion.

## Defensible status

> _One sentence stating what has actually passed. Resist writing more than the evidence supports._

## Live prerequisites

- Promptus, ComfyUI, Cosy, CWorker: _state_
- ComfyUI queue at audit: _running / pending_
- F5 basic, F5 advanced, SaveAudio nodes: _available?_
- Worker version · F5 node version · F5 core version: _…_
- GPU and free VRAM at audit: _…_

## Acceptance matrix

| Voice | Discovery | Comparable generation | Signal gate | Consent basis | Human verdict | Acceptance |
|---|---|---|---|---|---|---|
| _name_ | | | | | | Pending |

## Comparable-run protocol

Every candidate must use and record the same inputs:

- Narration file and the SHA-256 **of the stripped text**, which is what the portal records — not the
  hash of the file's bytes, or every conforming run will appear to mismatch.
- Mode · seed · model · vocoder · speed · NFE · CFG · crossfade · sway · tempo method.

Record per candidate: model title, reference identity and hash, narration hash, all controls, duration,
clipping %, silence %, DC offset, click %, word-error result, output location and hash, consent basis,
listening verdict and notes, timestamp.

Use original text as the fixture. In-copyright material makes acceptance evidence unshareable.

## Reference condition at audit

Run `audit_voice_references.py` and record the result. Level is recoverable arithmetic; **length and
transcript drift are not** — an over-length reference has already been truncated away from its transcript
and must be re-recorded, or the preset retired with `POST /api/cosy/uninstall-local`.

## Still open

List defects and gaps blocking a production-readiness claim. This list is the authority; the evidence
pages, narration and any video derive from it and must not contradict it.

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | | | |

## Authority chain

State it explicitly so documents cannot drift:

1. **This file** — release status and open items.
2. **Live evidence pages** — read from the running portal.
3. **Narration → video → subtitles** — generated from one source so they cannot diverge.

Counts that move with usage (media rows, catalogue totals) are quoted with the date measured. The
invariant findings are the claims; a raw count is illustration.
