#!/usr/bin/env python3
"""Measure F5 reference/output signal health and a rough timbre-similarity proxy."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import librosa
import numpy as np
import soundfile as sf

from promptus_audio_quality import inspect_audio


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    denominator = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(np.dot(a, b) / denominator) if denominator else 0.0


def analyze(path: Path) -> tuple[dict[str, Any], np.ndarray]:
    gate = inspect_audio(path)
    audio, sample_rate = sf.read(path, dtype="float32", always_2d=True)
    mono = audio.mean(axis=1)
    if not mono.size:
        raise ValueError(f"Empty audio: {path}")
    trimmed, _ = librosa.effects.trim(mono, top_db=42)
    if not trimmed.size:
        trimmed = mono

    hop = 256
    rms = librosa.feature.rms(y=trimmed, frame_length=2048, hop_length=hop)[0]
    rms_db = librosa.amplitude_to_db(np.maximum(rms, 1e-8), ref=1.0)
    centroid = librosa.feature.spectral_centroid(y=trimmed, sr=sample_rate, hop_length=hop)[0]
    flatness = librosa.feature.spectral_flatness(y=trimmed, hop_length=hop)[0]
    rolloff = librosa.feature.spectral_rolloff(y=trimmed, sr=sample_rate, roll_percent=0.95, hop_length=hop)[0]
    f0, voiced, _ = librosa.pyin(
        trimmed, fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C6"),
        sr=sample_rate, frame_length=2048, hop_length=hop,
    )
    voiced_f0 = f0[np.isfinite(f0)] if f0 is not None else np.array([])
    mfcc = librosa.feature.mfcc(y=trimmed, sr=sample_rate, n_mfcc=20, hop_length=hop)
    timbre = np.median(mfcc[1:], axis=1)
    flags = list(gate["quality_flags"])
    return ({
        "path": str(path.resolve()),
        "duration_seconds": gate["duration_seconds"],
        "trimmed_duration_seconds": gate["trimmed_duration_seconds"],
        "sample_rate": gate["sample_rate"],
        "channels": gate["channels"],
        "peak_dbfs": gate["peak_dbfs"],
        "rms_dbfs_median": round(float(np.median(rms_db)), 2),
        "clipping_percent": gate["clipping_percent"],
        "silence_percent": gate["silence_percent"],
        "dc_offset": gate["dc_offset"],
        "spectral_centroid_hz": round(float(np.median(centroid)), 1),
        "spectral_flatness": round(float(np.median(flatness)), 5),
        "spectral_rolloff_95_hz": round(float(np.median(rolloff)), 1),
        "voiced_percent": round(float(np.mean(voiced) * 100), 2) if voiced is not None else 0.0,
        "pitch_median_hz": round(float(np.median(voiced_f0)), 1) if voiced_f0.size else None,
        "pitch_range_semitones_90": round(float(12 * np.log2(np.percentile(voiced_f0, 95) / np.percentile(voiced_f0, 5))), 2) if voiced_f0.size else None,
        "possible_clicks_percent": gate["possible_clicks_percent"],
        "flags": flags,
    }, timbre)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", nargs="+", type=Path)
    parser.add_argument("--reference", type=Path)
    args = parser.parse_args()
    reference_vector = analyze(args.reference)[1] if args.reference else None
    results: list[dict[str, Any]] = []
    for path in args.audio:
        metrics, vector = analyze(path)
        if reference_vector is not None:
            metrics["timbre_similarity_proxy"] = round(cosine(reference_vector, vector), 4)
        results.append(metrics)
    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
