---
name: myvoice
description: Consented local voice cloning with F5-TTS in the Promptus desktop app — microphone capture, reference preflight, fail-closed signal and word-accuracy gates, and a recorded human listening verdict before anything is called accepted. "myvoice" is the short callable name for the promptus-clone-voice skill; use it when the user wants to clone a voice, add narration, or generate speech locally. Do not use for cloud TTS or non-consented impersonation.
---

# myvoice → promptus-clone-voice

`myvoice` is the short, callable name for the **[promptus-clone-voice](../promptus-clone-voice/SKILL.md)** skill. Follow that skill's full protocol — it is the canonical source.

**Safety gate (non-negotiable):** confirm the user owns the voice or has the speaker's explicit permission; require `--consent-confirmed`; pass the fail-closed signal and word-accuracy gates; and record a human listening verdict before calling any clone accepted. Label shared synthetic audio as synthetic. Everything runs locally in Promptus — nothing is uploaded for generation.

See [promptus-clone-voice/SKILL.md](../promptus-clone-voice/SKILL.md) for the complete workflow, Windows paths, and reference-admission rules.
