# Engineer investigation pack

Questions raised by the diagnostic pass, each with what is already known, a suggested direction, and a
ready-to-run prompt. Prompts are written to be pasted into an AI coding agent working in this repository.

Ordered by leverage. **Q1 is the only confirmed code defect**; the rest are open questions.

---

## Q1 — Why do the CLI and the portal disagree about the same render?

**Known.** Identical voice, seed, text and controls. The CLI delivered a raw section at 0.0 dBFS and the
signal gate refused it at 0.0138% clipping. The portal normalised the assembled master to −1.01 dBFS and
approved it at 0% clipping. F5 sections routinely arrive at or near full scale, so the gate outcome is
decided by which entry point ran, not by the audio the model produced.

**Suggested direction.** Move master normalisation out of `app.py` into the shared layer both paths use, so
the CLI normalises before it verifies. Decide deliberately whether a single-section CLI render is a
"master" — if it is, it must be normalised; if it is not, the gate threshold for raw sections should differ
and say so.

**Prompt.**
> In this repository, `portal/app.py` normalises the assembled FLAC master to about −1 dBFS
> before running `promptus_audio_quality.verify_audio`, but `promptus-clone-voice/scripts/test_promptus_voice.py`
> verifies raw F5 section output with no normalisation. Show me both code paths side by side. Then propose
> the smallest change that makes an identical render produce an identical verdict from either entry point,
> without weakening the clipping gate. Explain what would break if normalisation were applied to
> per-section output rather than only to the master.

**Follow-ups.**
> Does normalising before the gate hide a genuinely clipped F5 render? Construct a case where the raw
> samples exceed full scale and show whether peak normalisation would mask it.
>
> What peak target should the CLI use so that its output matches the portal's masters bit-for-bit when the
> narration is a single section?

---

## Q2 — Where should render provenance live, given Promptus stores none for audio?

**Known.** `comfy_output.db.media` populates `model`, `prompt`, `seed` and `params` only when
`dataType === 'image'`, read from PNG metadata. All 182 audio rows have those four columns `NULL`. The
file path is the only provenance the gallery retains. The portal's own job history is currently the sole
record of seed, controls, reference hashes and consent basis.

**Suggested direction.** Treat the portal history as the system of record and make it durable and
exportable, rather than trying to enrich Promptus's index. Consider embedding provenance in the FLAC's own
Vorbis comments so the file carries its own history even when separated from the database.

**Prompt.**
> Promptus's media index stores no model, seed or parameters for audio rows — verified across 182 rows.
> Evaluate embedding provenance directly into the delivered FLAC as Vorbis comments (seed, controls,
> reference SHA-256, narration SHA-256, consent basis, verifier version). Check whether SoundFile as
> installed here can write and read those tags without re-encoding, whether Promptus's indexer preserves
> them, and whether any tag could leak private content. Then implement it behind the existing fail-closed
> verifier and add a test proving a delivered master round-trips its own provenance.

**Follow-ups.**
> If a user copies a delivered FLAC out of the output tree, what is the minimum metadata needed to
> reproduce that exact render?
>
> Does writing tags after the quality gate invalidate the recorded SHA-256, and if so should the hash be
> taken before or after tagging?

---

## Q3 — Should rejected takes be distinguishable in Comfy Output?

**Known.** ComfyUI writes the file before any gate runs. A take refused for clipping was indexed one second
later and sits in the gallery beside verified masters with nothing marking it. The index is written only by
the desktop app, enforces `UNIQUE` on path and content hash, and deletes rows whose file disappears —
so the skill must not write to it.

**Suggested direction.** Since the index cannot be annotated safely, separate the files. Rejected takes
could be written to a quarantine subtree that the gallery still lists but whose naming makes the status
obvious, or moved out of the indexed tree entirely once refused.

**Prompt.**
> ComfyUI saves audio before the quality gate runs, so rejected takes are indexed identically to verified
> ones. I must not write to `comfy_output.db` — the desktop app owns it and deletes orphaned rows. Propose
> and compare three approaches: a quarantine subfolder inside the indexed tree, moving refused files out of
> the tree after rejection, and a naming convention that makes status legible in the gallery. For each,
> state what happens on the app's next recursive sync, and whether a moved file leaves a stale row.

**Follow-ups.**
> If a refused file is moved out of the output tree, does the watcher fire `unlink` and clean the row, or
> does it require a restart?
>
> Is deleting a rejected render ever the wrong call for diagnostics, and should retention be time-bounded
> instead?

---

## Q4 — Can the four blocked references be recovered without re-recording?

**Known.** Live preflight blocks 4 of 8 presets. `My Studio Voice` is 12.96 s (past F5's truncation point);
`Promptus F5 Portal Proof` is 6.08 s and `Promptus F5 Example Local Voice` is 5.33 s (under the usable
minimum); `voice-c` is 8.82 s but its speech disagrees with its stored transcript at 47.6% word error.
Level is recoverable arithmetic; length and transcript drift are not.

**Suggested direction.** `voice-c` is the interesting case — the audio may be fine and only the sidecar
text wrong. Re-transcribing locally and rewriting the transcript could recover it without re-recording.
The over-length and under-length references genuinely need new takes.

**Prompt.**
> Four installed voices are blocked by reference preflight. For `voice-c` (8.82 s, 47.6% reference word
> error), determine whether the audio is sound and only the stored transcript is wrong. Transcribe the
> installed reference with the local Whisper verifier, compare against the sidecar `.txt`, and if the audio
> is intelligible and correctly bounded, rewrite the transcript from the transcription behind a timestamped
> backup and re-run preflight. Do not modify audio. Report whether this is safe to automate for other
> voices or must stay a reviewed, per-voice decision.

**Follow-ups.**
> What word-error threshold separates "wrong transcript" from "wrong audio", and how would you tell them
> apart without listening?
>
> Should a preset whose reference cannot be repaired be retired via `POST /api/cosy/uninstall-local` rather
> than left blocked in the picker?

---

## Q5 — How should the web Studio's dependence on a local probe be surfaced?

**Known.** The web Studio polls `http://localhost:7412/status` (PManager) to discover a local install.
PManager answers `Access-Control-Allow-Origin: *` and returns the ComfyUI and Cosy URLs; Cosy explicitly
allow-lists `https://login.promptus.ai`. This is a designed integration. When the probe is blocked — a
sandboxed frame, a blocking extension, mixed-content policy, or PManager not running — the CosyFlows page
loads indefinitely with no error shown.

**Suggested direction.** This is upstream behaviour, not something this project can fix, but the skill can
diagnose it in one step. Worth confirming whether the infinite spinner is a missing timeout or a swallowed
error, so the report to Promptus is precise.

**Prompt.**
> The Promptus web Studio hangs on "Loading cosyflows…" when its `localhost:7412` probe is blocked. Using
> only local evidence, determine whether the page has no timeout, or has one whose failure path renders
> nothing. Then add a single diagnostic to `diagnose_promptus_voice.py` that reports whether PManager is
> reachable, whether it returns the expected service list, and what a browser would see cross-origin —
> so a user reporting "the web app can't see my workflows" gets an answer in one command.

**Follow-ups.**
> Does the desktop app use the same probe internally, or a privileged path that cannot be blocked?
>
> Is there a supported way to point the web Studio at a non-default PManager port?

---

## Q6 — Is the acceptance protocol reproducible enough to trust?

**Known.** Acceptance requires a comparable run plus consent basis plus a human listening verdict. One
`voice-a` master has passed the automated gates under the fixed-seed protocol. No voice has a recorded
listening verdict, so nothing is accepted. The narration for this video reproduced cleanly at seed
`2147483647` with 2.31% word error.

**Suggested direction.** Prove determinism before scaling the protocol to seven voices — if the same seed
and text do not produce a bit-identical master, the comparable-run design needs revisiting.

**Prompt.**
> Render the acceptance narration twice through the portal with the same fixed seed, voice and controls,
> and compare the resulting masters by SHA-256 and by signal metrics. If they differ, identify the source
> of non-determinism (GPU kernels, section assembly, normalisation, FLAC encoder) and state whether the
> comparable-run protocol in `ACCEPTANCE_TEMPLATE.md` should compare hashes or tolerances. Do not weaken any
> gate to make them match.

**Follow-ups.**
> If output is not bit-reproducible, what is the tightest defensible tolerance for calling two runs
> comparable?
>
> Should the listening verdict be captured per section as well as per master, given repair replaces
> individual sections?

---

## Open items not yet investigated

- **CosyTemplates were inspected, never executed.** All 60 sampled reference remote providers, so running
  one spends account credits. Nobody has confirmed what a template run writes, or whether it appears in
  the local gallery at all.
- **A web-Studio-driven local generation was never completed end to end.** The mechanism is proven (probe,
  CORS allow-list, service URLs) but a real render started from the web UI was not observed, because the
  probe was blocked in the available browser.
- **`momm*` was mapped but not exercised.** It is disjoint from ComfyUI output and untouched by login, and
  the desktop app's live cloud state lives in Electron IndexedDB, which was deliberately not read because
  it holds session material.
