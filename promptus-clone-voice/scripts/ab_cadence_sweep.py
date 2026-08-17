#!/usr/bin/env python3
"""Render a matched A/B set for a human cadence decision: same text, same seed, one axis at a time.

Signal metrics and word accuracy can prove a render is clean and says the right words. They cannot
decide whether the performance is right. This produces the comparable evidence a listener needs —
identical text and seed across variants, so any difference heard is attributable to the one parameter
that changed — and prints the objective numbers beside each take rather than instead of them.

TDHS is never offered: on ComfyUI-F5-TTS 1.0.26 its stretch path can return unscaled samples and clip.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from promptus_audio_quality import inspect_audio
from promptus_voice_common import PromptusVoiceError


SCRIPTS = Path(__file__).resolve().parent
BASELINE: dict[str, Any] = {
    "speed": 1.0,
    "cfg_strength": 2.0,
    "nfe_step": 32,
    "cross_fade_duration": 0.15,
    "sway_sampling_coef": -1.0,
    "speed_type": "F5TTS",
}
VARIANTS: list[tuple[str, dict[str, Any], str]] = [
    ("baseline", {}, "Upstream-quality reference point"),
    ("slower", {"speed": 1.07}, "Tempo axis: more room between phrases"),
    ("faster", {"speed": 0.95}, "Tempo axis: tighter, more urgent"),
    ("tighter-guidance", {"cfg_strength": 2.3}, "Guidance axis: closer to the reference performance"),
    ("looser-guidance", {"cfg_strength": 1.8}, "Guidance axis: freer, more variable"),
    ("more-steps", {"nfe_step": 48}, "Quality axis: more denoising steps for the same settings"),
]
CHECKLIST = [
    "Sentence endings: does the pitch fall like a statement, or drift up as if unfinished?",
    "Commas and dashes: is the pause the length you would take, or mechanical?",
    "Emphasis: does the stressed word match the meaning of the line?",
    "Breaths: audible in the right places, or missing entirely?",
    "Energy across the take: steady, or does it flatten toward the end?",
    "Identity: does it still sound like the speaker, or like a good generic reader?",
]


def render(model_title: str, text_file: Path, seed: int, controls: dict[str, Any],
           timeout: int) -> list[dict[str, Any]]:
    command = [
        sys.executable, "-u", str(SCRIPTS / "test_promptus_voice.py"),
        "--model-title", model_title, "--text-file", str(text_file),
        "--consent-confirmed", "--seed", str(seed), "--timeout", str(timeout),
        "--heartbeat-seconds", "30",
    ]
    for name in ("speed", "nfe_step", "cfg_strength", "cross_fade_duration",
                 "sway_sampling_coef", "speed_type"):
        command.extend(["--" + name.replace("_", "-"), str(controls[name])])
    process = subprocess.run(command, capture_output=True, text=True,
                             encoding="utf-8", errors="replace", timeout=timeout + 120)
    outputs: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for line in process.stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        if event.get("verified_outputs"):
            outputs = event["verified_outputs"]
        elif event.get("rejected_output"):
            rejected.append(event["rejected_output"])
    if outputs:
        return outputs
    if rejected:
        # A take that fails the delivery gate is still evidence for a listening comparison.
        # It is reported with its flags and never presented as approved.
        return rejected
    tail = (process.stdout or process.stderr).strip().splitlines()[-1:] or ["no output"]
    raise PromptusVoiceError(f"Render failed: {tail[0][:200]}")


def timbre_proxy(reference: Path, candidate: Path) -> float | None:
    """Optional MFCC similarity against the reference. Never fails the sweep."""
    try:
        from analyze_f5_audio import analyze, cosine
    except Exception:
        return None
    try:
        return round(cosine(analyze(reference)[1], analyze(candidate)[1]), 4)
    except Exception:
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-title", required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--text")
    source.add_argument("--text-file", type=Path)
    parser.add_argument("--consent-confirmed", action="store_true")
    parser.add_argument("--seed", type=int, default=424242, help="Fixed across variants; -1 would break comparability")
    parser.add_argument("--reference", type=Path, help="Consented reference WAV, for the timbre proxy")
    parser.add_argument("--only", nargs="*", choices=[name for name, _c, _d in VARIANTS])
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--out", type=Path, default=Path.cwd() / "ab-cadence")
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    if not args.consent_confirmed:
        raise PromptusVoiceError("Refusing to generate without --consent-confirmed")
    if args.seed < 0:
        raise PromptusVoiceError("A fixed non-negative seed is required; a random seed makes takes incomparable")

    text = args.text if args.text is not None else args.text_file.read_text(encoding="utf-8-sig")
    text = text.strip()
    if not text:
        raise PromptusVoiceError("Sweep text is empty")
    args.out.mkdir(parents=True, exist_ok=True)
    text_file = args.out / "sweep-text.txt"
    text_file.write_text(text, encoding="utf-8")

    selected = [v for v in VARIANTS if not args.only or v[0] in args.only]
    print(f"Model : {args.model_title}")
    print(f"Text  : {len(text)} characters, {len(text.split())} words")
    print(f"Seed  : {args.seed} (fixed across all takes)")
    print(f"Takes : {len(selected)}\n")

    results: list[dict[str, Any]] = []
    for index, (name, overrides, rationale) in enumerate(selected, start=1):
        controls = {**BASELINE, **overrides}
        changed = ", ".join(f"{k}={v}" for k, v in overrides.items()) or "none"
        print(f"[{index}/{len(selected)}] {name}: {rationale} (changed: {changed})")
        entry: dict[str, Any] = {"variant": name, "rationale": rationale,
                                 "changed": overrides, "controls": controls}
        try:
            outputs = render(args.model_title, text_file, args.seed, controls, args.timeout)
        except (PromptusVoiceError, subprocess.TimeoutExpired) as exc:
            entry["error"] = str(exc)
            print(f"        FAILED: {exc}")
            results.append(entry)
            continue
        path = Path(outputs[0]["path"])
        detail = inspect_audio(path)
        entry["audio"] = detail
        if args.reference and args.reference.is_file():
            entry["timbre_similarity_proxy"] = timbre_proxy(args.reference, path)
        flags = detail["quality_flags"]
        print(f"        {detail['duration_seconds']:.2f}s  clip {detail['clipping_percent']}%  "
              f"silence {detail['silence_percent']}%  "
              f"{'OK' if not flags else 'FLAGGED: ' + ', '.join(flags)}")
        print(f"        {path}")
        results.append(entry)

    report = {"model_title": args.model_title, "seed": args.seed, "text": text, "takes": results}
    (args.out / "sweep-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    if args.as_json:
        print(json.dumps(report, indent=2))
    else:
        print("\n" + "=" * 78)
        print(f"{'take':<18}{'seconds':>9}{'clip%':>8}{'silence%':>10}{'timbre':>9}  status")
        for entry in results:
            audio = entry.get("audio")
            if not audio:
                print(f"{entry['variant']:<18}{'—':>9}{'—':>8}{'—':>10}{'—':>9}  failed")
                continue
            proxy = entry.get("timbre_similarity_proxy")
            print(f"{entry['variant']:<18}{audio['duration_seconds']:>9.2f}"
                  f"{audio['clipping_percent']:>8}{audio['silence_percent']:>10}"
                  f"{(proxy if proxy is not None else '—'):>9}  "
                  f"{'approved' if audio['quality_approved'] else ', '.join(audio['quality_flags'])}")
        print("=" * 78)
        print("\nThese numbers rank nothing. Play the takes in this order and decide by ear:\n")
        for item in CHECKLIST:
            print(f"  - {item}")
        print("\nPick one take. Record why in the portal's listening verdict so the judgement is")
        print("stored with the render hash and the exact settings that produced it.")
        print(f"\nReport: {args.out / 'sweep-report.json'}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PromptusVoiceError as exc:
        print(f"ERROR: {exc}")
        raise SystemExit(2)
