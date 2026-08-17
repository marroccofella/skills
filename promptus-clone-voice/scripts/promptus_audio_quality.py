#!/usr/bin/env python3
"""Fail-closed signal-health verification shared by Promptus voice entry points."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from promptus_voice_common import PromptusVoiceError, sha256


try:
    import numpy as np
except Exception as exc:  # pragma: no cover - exercised by dependency injection in tests
    np = None  # type: ignore[assignment]
    _NUMPY_ERROR: Exception | None = exc
else:
    _NUMPY_ERROR = None

try:
    import soundfile as sf
except Exception as exc:  # pragma: no cover - exercised by dependency injection in tests
    sf = None  # type: ignore[assignment]
    _SOUNDFILE_ERROR: Exception | None = exc
else:
    _SOUNDFILE_ERROR = None


def require_signal_dependencies() -> None:
    """Refuse approval when the verifier itself cannot run."""
    missing: list[str] = []
    if np is None:
        missing.append(f"numpy ({_NUMPY_ERROR or 'unavailable'})")
    if sf is None:
        missing.append(f"soundfile ({_SOUNDFILE_ERROR or 'unavailable'})")
    if missing:
        raise PromptusVoiceError(
            "Signal-health verification is unavailable: " + ", ".join(missing) + ". "
            "Refusing to approve generated audio until the Promptus Cosy environment is repaired."
        )


def _frame_rms(samples, frame_length: int = 2048, hop: int = 256):
    if not samples.size:
        return np.zeros(0, dtype=np.float32)
    frame_length = min(frame_length, int(samples.size))
    hop = min(hop, frame_length)
    if samples.size == frame_length:
        frames = samples.reshape(1, -1)
    else:
        frames = np.lib.stride_tricks.sliding_window_view(samples, frame_length)[::hop]
    return np.sqrt(np.mean(frames * frames, axis=1) + 1e-12)


def _silence_profile(frame_db, hop: int = 256, sample_rate: int = 24000, *, below_db: float = 40.0):
    """Quiet-frame fraction and longest continuous gap, measured against the take's own speech level.

    An absolute dBFS threshold cannot tell dead air apart from a render that is simply quieter, and
    this pipeline deliberately makes renders quieter: the reference is stored below the F5 node's
    target_rms so that `generated_wave * rms / target_rms` leaves clipping headroom. Measuring silence
    against full scale therefore penalises the very attenuation that keeps output clean — a clean take
    measured 10.2% at its native level and 21.5% when dropped 6 dB, crossing the gate without one
    sample changing. Referencing the 95th-percentile frame instead makes the number level-invariant
    (measured drift 0.00 points across 40 renders); the percentile rather than the max keeps a single
    plosive from raising the bar for everything else.
    """
    if not frame_db.size:
        return 100.0, 0.0
    threshold = float(np.percentile(frame_db, 95)) - below_db
    quiet = frame_db < threshold
    percent = float(np.mean(quiet) * 100)

    # Aggregate quiet time says nothing about distribution: natural pauses spread through a take are
    # not the same defect as one long dropout. Report the worst continuous run separately.
    longest = current = 0
    for is_quiet in quiet:
        current = current + 1 if is_quiet else 0
        longest = max(longest, current)
    return percent, float(longest * hop / sample_rate)


def trim_boundary_silence(samples, sample_rate: int, *, top_db: float = 42.0, padding: float = 0.06):
    """Trim only leading/trailing low-energy frames and retain a short natural pad."""
    require_signal_dependencies()
    if not samples.size:
        return samples
    rms = _frame_rms(samples)
    threshold = max(float(np.max(rms)) * 10 ** (-top_db / 20), 1e-8)
    active = np.flatnonzero(rms > threshold)
    if not active.size:
        return samples
    hop = min(256, int(samples.size))
    frame_length = min(2048, int(samples.size))
    pad = max(0, int(sample_rate * padding))
    start = max(0, int(active[0] * hop) - pad)
    end = min(int(samples.size), int(active[-1] * hop + frame_length) + pad)
    return samples[start:end]


def inspect_audio(path: Path) -> dict[str, Any]:
    """Read an audio file and return deterministic metadata plus quality flags.

    Dependency, decoding, non-finite-data, and empty-file failures are never converted into a
    clean result. Callers may display the returned flags, while :func:`verify_audio` enforces them.
    """
    require_signal_dependencies()
    resolved = path.resolve()
    if not resolved.is_file():
        raise PromptusVoiceError(f"Audio output does not exist: {resolved}")
    try:
        info = sf.info(resolved)
        audio, sample_rate = sf.read(resolved, dtype="float32", always_2d=True)
    except Exception as exc:
        raise PromptusVoiceError(
            f"Signal-health verification could not decode {resolved.name}: {exc}"
        ) from exc

    quality_flags: list[str] = []
    channels = int(audio.shape[1]) if getattr(audio, "ndim", 0) == 2 else 0
    if int(sample_rate) <= 0 or channels <= 0:
        quality_flags.append("invalid_audio_metadata")
    if not audio.size:
        quality_flags.append("silent_output")
        mono = np.zeros(0, dtype=np.float32)
    elif not bool(np.all(np.isfinite(audio))):
        quality_flags.append("non_finite_audio")
        mono = np.nan_to_num(audio, copy=True).mean(axis=1)
    else:
        mono = audio.mean(axis=1)

    trimmed = trim_boundary_silence(mono, int(sample_rate)) if mono.size else mono
    peak = float(np.max(np.abs(trimmed))) if trimmed.size else 0.0
    rms = float(np.sqrt(np.mean(trimmed * trimmed))) if trimmed.size else 0.0
    clipping = float(np.mean(np.abs(trimmed) >= 0.985) * 100) if trimmed.size else 0.0
    dc_offset = float(np.mean(trimmed)) if trimmed.size else 0.0
    frame_rms = _frame_rms(trimmed)
    frame_rms_db = 20 * np.log10(np.maximum(frame_rms, 1e-8)) if frame_rms.size else np.array([])
    silence_percent, longest_silence = _silence_profile(frame_rms_db, sample_rate=int(sample_rate))
    differences = np.abs(np.diff(trimmed)) if trimmed.size else np.array([])
    click_threshold = max(0.22, float(np.percentile(differences, 99.9) * 3)) if differences.size else 1.0
    possible_clicks = float(np.mean(differences > click_threshold) * 100) if differences.size else 0.0
    if clipping > 0.01:
        quality_flags.append("clipping")
    if abs(dc_offset) > 0.01:
        quality_flags.append("dc_offset")
    if peak <= 1e-6 or rms <= 1e-7:
        quality_flags.append("silent_output")
    if silence_percent > 20:
        quality_flags.append("excess_silence")
    # A single continuous gap this long is a dropout, not phrasing, even when the aggregate passes.
    if longest_silence > 2.5:
        quality_flags.append("long_silence_gap")
    if possible_clicks > 0.02:
        quality_flags.append("possible_clicks")
    quality_flags = list(dict.fromkeys(quality_flags))

    duration = float(info.duration)
    if not math.isfinite(duration) or duration <= 0:
        quality_flags.append("invalid_duration")
    return {
        "path": str(resolved),
        "bytes": resolved.stat().st_size,
        "sha256": sha256(resolved),
        "format": str(info.format),
        "subtype": str(info.subtype),
        "channels": int(info.channels),
        "sample_rate": int(info.samplerate),
        "duration_seconds": round(duration, 3),
        "trimmed_duration_seconds": round(float(trimmed.size) / max(1, int(sample_rate)), 3),
        "peak_dbfs": round(float(20 * np.log10(max(peak, 1e-8))), 2),
        "rms_dbfs": round(float(20 * np.log10(max(rms, 1e-8))), 2),
        "clipping_percent": round(clipping, 5),
        "dc_offset": round(dc_offset, 6),
        "silence_percent": round(silence_percent, 2),
        "longest_silence_seconds": round(longest_silence, 2),
        "possible_clicks_percent": round(possible_clicks, 5),
        "quality_flags": quality_flags,
        "quality_approved": not quality_flags,
    }


def verify_audio(path: Path) -> dict[str, Any]:
    """Return signal metadata only when every mandatory check passes."""
    detail = inspect_audio(path)
    flags = detail["quality_flags"]
    if flags:
        raise PromptusVoiceError(
            f"Generated audio failed the signal-health gate ({path.name}: {', '.join(flags)}). "
            "Do not deliver it; correct the generation path and render again."
        )
    return detail
