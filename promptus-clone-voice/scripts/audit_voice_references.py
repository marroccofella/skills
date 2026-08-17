#!/usr/bin/env python3
"""Audit — and optionally re-level — the installed F5 reference recordings.

Two independent defects in a stored reference produce bad renders, and neither is visible from the
cosyflow or from Promptus's catalogue. Both were found the expensive way, by measuring the files after
renders had already failed:

Level. `infer_process` in ComfyUI-F5-TTS boosts the reference to the node's `target_rms` (0.1) before
inference, then scales the generated wave by `rms / target_rms`. That scaling is the only output
headroom in the pipeline, and it is a no-op for a reference stored at exactly 0.1 and an amplification
for anything louder. Projected voices then reach full scale and clamp at the int16 write, while quiet
voices pass by luck. Storing at 0.05 buys a predictable 6 dB.

Length and transcript agreement. F5 truncates a reference past roughly 12 seconds, so a longer
recording is silently cut while its stored transcript still describes the whole take. The model is then
asked to imitate audio whose text does not match it. The `voice-a` failure was exactly this: 12.96 seconds
with a transcript that disagreed with the audio by 95%. Speaking rate is a cheap proxy for that
disagreement — an implausible words-per-minute means the pair has drifted apart.

Read-only by default. `--repair` re-levels only, always behind a timestamped backup, because level is
recoverable arithmetic. Length is not: a truncated reference needs re-recording, so this script reports
it and refuses to guess.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

from promptus_voice_common import (
    PromptusVoiceError,
    backup_file,
    comfy_root,
    discover_install_root,
)

# The node's own target. A reference at or above this gets no output attenuation at all.
NODE_TARGET_RMS = 0.1
# What the portal stores. 20*log10(0.05/0.1) = -6.02 dB of headroom inside F5.
DESIGN_RMS = 0.05
# Portal capture cap, set below F5's truncation point.
MAX_SECONDS = 11.8
# Below this, the reference is too quiet to characterise the voice well.
MIN_SECONDS = 7.0
# Conversational speech. Outside this band, audio and transcript have probably drifted apart.
MIN_WPM, MAX_WPM = 90, 220
# Peak ceiling after re-levelling, so a re-level can never introduce clipping.
PEAK_CEILING = 0.95


def reference_dir(install_root: Path) -> Path:
    return comfy_root(install_root) / "input" / "F5-TTS"


def measure(wav: Path) -> dict[str, Any]:
    """Level, duration and transcript agreement for one reference."""
    import numpy as np
    import soundfile as sf

    data, rate = sf.read(str(wav), dtype="float64", always_2d=True)
    mono = data.mean(axis=1)
    if mono.size == 0:
        raise PromptusVoiceError(f"{wav.name} decodes to zero samples")
    rms = float(np.sqrt(np.mean(np.square(mono))))
    peak = float(np.max(np.abs(mono)))
    duration = mono.size / float(rate)

    transcript = wav.with_suffix(".txt")
    words = len(transcript.read_text(encoding="utf-8-sig").split()) if transcript.is_file() else 0
    wpm = (words / duration * 60) if duration and words else 0.0

    return {
        "name": wav.name,
        "path": str(wav),
        "rms": round(rms, 4),
        "peak": round(peak, 3),
        "duration_seconds": round(duration, 2),
        "sample_rate": rate,
        "attenuation_db": round(20 * math.log10(rms / NODE_TARGET_RMS), 2) if rms > 0 else None,
        "transcript_words": words,
        "words_per_minute": round(wpm),
        "has_transcript": transcript.is_file(),
    }


def findings(entry: dict[str, Any]) -> list[str]:
    """Defects, worst first. An empty list means the reference is safe to render from."""
    found: list[str] = []
    if entry["rms"] >= NODE_TARGET_RMS:
        found.append(f"no output headroom (F5 amplifies by {entry['attenuation_db']:+.2f} dB)")
    elif abs(entry["rms"] - DESIGN_RMS) > 0.012:
        found.append(f"off design level {DESIGN_RMS} (stored {entry['rms']})")
    if entry["duration_seconds"] > MAX_SECONDS:
        found.append(f"longer than {MAX_SECONDS}s — F5 truncates, transcript no longer describes the audio")
    elif entry["duration_seconds"] < MIN_SECONDS:
        found.append(f"shorter than {MIN_SECONDS}s of usable speech")
    if entry["peak"] >= 0.999:
        found.append("reference itself is clipped")
    if not entry["has_transcript"]:
        found.append("no matching .txt transcript — F5's disk loader needs one")
    elif entry["transcript_words"] and not (MIN_WPM <= entry["words_per_minute"] <= MAX_WPM):
        found.append(f"implausible {entry['words_per_minute']} wpm — audio and transcript may disagree")
    return found


def relevel(wav: Path, entry: dict[str, Any]) -> dict[str, Any]:
    """Scale a reference to the design level behind a timestamped backup.

    Near-invariant for the voice, because the node boosts it straight back to target for inference.
    Only near: F5's pydub edge trim uses absolute dB thresholds, so verify with one render.
    """
    import numpy as np
    import soundfile as sf

    data, rate = sf.read(str(wav), dtype="float64", always_2d=True)
    mono = data.mean(axis=1)
    rms = float(np.sqrt(np.mean(np.square(mono))))
    peak = float(np.max(np.abs(mono)))
    if rms <= 0:
        raise PromptusVoiceError(f"{wav.name} is silent; refusing to re-level")

    # Hit the design level, but never let the peak approach full scale.
    gain = min(DESIGN_RMS / rms, PEAK_CEILING / max(peak, 1e-9))
    adjusted = mono * gain

    backup = backup_file(wav)
    sf.write(str(wav), adjusted.astype("float32"), rate, subtype="PCM_16")
    after = measure(wav)
    return {
        "backup": str(backup),
        "gain_db": round(20 * math.log10(gain), 2),
        "rms_before": entry["rms"],
        "rms_after": after["rms"],
        "peak_after": after["peak"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", help="Confirmed Promptus install root override")
    parser.add_argument("--repair", action="store_true",
                        help="Re-level off-level references to the design RMS, keeping a timestamped backup")
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    try:
        import numpy  # noqa: F401
        import soundfile  # noqa: F401
    except ImportError as exc:
        raise PromptusVoiceError(
            f"NumPy and SoundFile are required to measure references ({exc}). "
            "Run this with the Promptus Cosy interpreter."
        ) from exc

    root = discover_install_root(args.root)
    directory = reference_dir(root)
    if not directory.is_dir():
        raise PromptusVoiceError(f"Reference directory not found: {directory}")

    entries: list[dict[str, Any]] = []
    for wav in sorted(directory.glob("*.wav")):
        if wav.name.endswith(".bak"):
            continue
        entry = measure(wav)
        entry["findings"] = findings(entry)
        entries.append(entry)

    if not entries:
        raise PromptusVoiceError(f"No references found in {directory}")

    repaired: list[dict[str, Any]] = []
    if args.repair:
        for entry in entries:
            # Level is recoverable arithmetic; length is not, so it is never "repaired" here.
            if any("headroom" in f or "design level" in f for f in entry["findings"]):
                result = relevel(Path(entry["path"]), entry)
                # Re-measure so the reported row describes the file as it now stands on disk,
                # rather than pairing pre-repair numbers with post-repair findings.
                entry.update(measure(Path(entry["path"])))
                entry["repair"] = result
                entry["findings"] = findings(entry)
                repaired.append(entry)

    clean = [e for e in entries if not e["findings"]]
    if args.as_json:
        print(json.dumps({
            "reference_dir": str(directory),
            "design_rms": DESIGN_RMS,
            "node_target_rms": NODE_TARGET_RMS,
            "max_seconds": MAX_SECONDS,
            "references": entries,
            "clean": len(clean),
            "repaired": len(repaired),
        }, indent=2))
    else:
        print(f"References : {directory}")
        print(f"Design     : {DESIGN_RMS} RMS "
              f"({20 * math.log10(DESIGN_RMS / NODE_TARGET_RMS):.2f} dB of headroom inside F5), "
              f"{MIN_SECONDS}-{MAX_SECONDS}s\n")
        print(f"{'reference':<46}{'rms':>7}{'peak':>7}{'sec':>7}{'atten':>9}{'wpm':>6}  status")
        print("-" * 116)
        for entry in entries:
            atten = f"{entry['attenuation_db']:+.2f}dB" if entry["attenuation_db"] is not None else "—"
            status = "ok" if not entry["findings"] else "; ".join(entry["findings"])
            print(f"{entry['name'][:45]:<46}{entry['rms']:>7.4f}{entry['peak']:>7.3f}"
                  f"{entry['duration_seconds']:>7.2f}{atten:>9}{entry['words_per_minute']:>6.0f}  {status}")

        if repaired:
            print(f"\nRe-levelled {len(repaired)}:")
            for entry in repaired:
                r = entry["repair"]
                print(f"  {entry['name']}: {r['rms_before']} -> {r['rms_after']} "
                      f"({r['gain_db']:+.2f} dB), backup {Path(r['backup']).name}")
            print("\nVerify each re-levelled voice with one render before relying on it: F5's edge trim")
            print("uses absolute dB thresholds, so a level change is near-invariant but not exactly so.")

        unresolved = [e for e in entries if e["findings"]]
        if unresolved:
            print(f"\n{len(unresolved)} reference(s) still need attention.")
            if any("truncates" in f for e in unresolved for f in e["findings"]):
                print("A reference past the length cap cannot be repaired by scaling. Re-record it, or")
                print("retire the preset with POST /api/cosy/uninstall-local rather than deleting the file.")
        else:
            print("\nEvery reference is at the design level and within the length window.")

    return 0 if all(not e["findings"] for e in entries) else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PromptusVoiceError as exc:
        print(f"ERROR: {exc}")
        raise SystemExit(2)
