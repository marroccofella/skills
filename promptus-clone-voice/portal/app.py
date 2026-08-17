#!/usr/bin/env python3
"""Local microphone-to-Promptus F5 Studio portal. Binds to localhost only."""

from __future__ import annotations

import io
import json
import hashlib
import math
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import tomllib
import urllib.parse
import uuid
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
from flask import Flask, jsonify, render_template, request, send_file


PROJECT_ROOT = Path(__file__).resolve().parent
WORKSPACE_ROOT = PROJECT_ROOT.parent
SKILL_ROOT = WORKSPACE_ROOT / "promptus-clone-voice"
SCRIPTS = SKILL_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from install_f5tts_studio import install_studio  # noqa: E402
from promptus_audio_quality import inspect_audio, trim_boundary_silence, verify_audio  # noqa: E402
from promptus_voice_common import (  # noqa: E402
    DEFAULT_COMFY_URL,
    DEFAULT_COSY_URL,
    DEFAULT_PMANAGER_URL,
    PromptusVoiceError,
    comfy_root,
    discover_install_root,
    get_cosyflows,
    get_node_info,
    json_request,
    local_cosyflow_dir,
    pmanager_status,
    title_to_filename,
)


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024
DATA_ROOT = PROJECT_ROOT / "data"
REFERENCE_ROOT = DATA_ROOT / "references"
JOB_ROOT = DATA_ROOT / "jobs"
HISTORY_ROOT = DATA_ROOT / "history"
REFERENCE_AUDIT_CACHE = DATA_ROOT / "reference-word-audit.json"
for directory in (REFERENCE_ROOT, JOB_ROOT, HISTORY_ROOT):
    directory.mkdir(parents=True, exist_ok=True)

PROMPTUS_ROOT: Path | None = None
PORTAL_TOKEN = secrets.token_urlsafe(32)
JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()
HISTORY_LOCK = threading.Lock()
REFERENCE_AUDIT_LOCK = threading.Lock()
PORTAL_RUN_ID = secrets.token_hex(8)
EXPRESSION_LOG = DATA_ROOT / "expression-log.jsonl"
EXPRESSION_LOCK = threading.Lock()
EXPRESSION_VERDICTS = ("approved", "revise", "rejected")
CONSENT_LOG = DATA_ROOT / "consent-log.jsonl"
CONSENT_LOCK = threading.Lock()
CONSENT_BASES = ("self", "explicit_permission")
GENERATION_SLOT = threading.BoundedSemaphore(1)
JOB_RETENTION_SECONDS = 6 * 60 * 60
MAX_RETAINED_JOBS = 100
HISTORY_RETENTION_SECONDS = 30 * 24 * 60 * 60
MAX_RETAINED_HISTORY = 100
TERMINAL_JOB_STATUSES = {"complete", "rejected", "failed", "stopped", "error"}
MAX_REFERENCE_SECONDS = 11.8
MARGINAL_CLIPPING_RETRY_MAX_PERCENT = 0.05
MAX_NORMALIZED_WORD_ERROR_PERCENT = 5.0
MAX_REFERENCE_WORD_ERROR_PERCENT = 25.0
MAX_AUTOMATIC_SECTION_REPAIRS = 3
MAX_AUTOMATIC_REPAIR_ROUNDS = 1
MAX_LOG_TAIL_BYTES = 1024 * 1024
MAX_LOG_TAIL_LINES = 4000
MAX_LOG_LINE_CHARS = 4096
ASR_CACHE = DATA_ROOT / "models" / "huggingface"
REFERENCE_PROMPT = (
    "My voice is clear and steady. I speak warmly, giving each word natural rhythm, "
    "feeling, purpose, and expression."
)

SPEECH_WORD_RE = re.compile(r"[a-z0-9]+(?:'[a-z0-9]+)?", re.IGNORECASE)

STYLE_PRESETS = {
    "natural": {"speed": 1.0, "nfe_step": 32, "cfg_strength": 2.0, "cross_fade_duration": 0.15, "sway_sampling_coef": -1.0, "speed_type": "F5TTS"},
    "poetic": {"speed": 1.07, "nfe_step": 32, "cfg_strength": 2.0, "cross_fade_duration": 0.15, "sway_sampling_coef": -1.0, "speed_type": "F5TTS"},
    "intense": {"speed": 1.04, "nfe_step": 32, "cfg_strength": 2.2, "cross_fade_duration": 0.15, "sway_sampling_coef": -1.0, "speed_type": "F5TTS"},
    "intimate": {"speed": 1.1, "nfe_step": 32, "cfg_strength": 1.9, "cross_fade_duration": 0.15, "sway_sampling_coef": -1.0, "speed_type": "F5TTS"},
}


def fail(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status


def consent_basis(data: dict[str, Any]) -> str:
    basis = str(data.get("consent_basis", "")).strip().casefold()
    if basis not in CONSENT_BASES:
        raise PromptusVoiceError(
            "Consent basis must state that you are the speaker or have explicit permission"
        )
    return basis


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def record_consent(entry: dict[str, Any]) -> None:
    with CONSENT_LOCK, CONSENT_LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"recorded": time.time(), **entry}, ensure_ascii=False) + "\n")


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    """Replace one local JSON record without leaving a half-written history file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    temporary.replace(path)


def _safe_output(value: Any) -> dict[str, Any]:
    """Keep useful local QA evidence without publishing absolute machine paths."""
    if not isinstance(value, dict):
        return {}
    allowed = {
        "audio_url", "artifact_role", "bytes", "channels", "clipping_percent",
        "dc_offset", "delivery_approved", "duration_seconds", "format",
        "longest_silence_seconds", "normalized_edit_distance",
        "normalized_reference_words", "normalized_recognized_words",
        "normalized_word_error_rate_percent", "peak_dbfs", "possible_clicks_percent",
        "promptus_indexed", "quality_approved", "quality_flags", "recognized_word_ratio",
        "rms_dbfs", "sample_rate", "sections", "sha256", "silence_percent", "subtype",
        "trimmed_duration_seconds", "word_accuracy_approved", "word_verifier_model",
        "long_form_mode", "word_verifier_strategy", "word_verification_mode",
        "recovered_from_sha256", "repair_round",
    }
    result = {key: value[key] for key in allowed if key in value}
    # A quarantined artifact may retain its hash and QA metrics, but never a routable media URL.
    if result.get("delivery_approved") is not True:
        result.pop("audio_url", None)
    return result


def _safe_repair_state(value: Any) -> dict[str, Any]:
    """Persist useful repair evidence without speech, paths, or correlation IDs."""
    if not isinstance(value, dict):
        return {}
    allowed = {
        "status", "strategy", "trigger_code", "rounds_used", "max_rounds",
        "sections_checked", "sections_repaired", "prior_output_sha256",
        "fingerprint", "word_verifier_strategy", "master_disagreement",
    }
    result = {key: value[key] for key in allowed if key in value}
    attempt_allowed = {
        "section", "attempt", "reason", "original_seed", "effective_seed",
        "source_sha256", "original_output_sha256", "output_sha256",
        "rejected_output_sha256", "replacement_output_sha256",
        "normalized_reference_words", "normalized_recognized_words",
        "normalized_edit_distance", "normalized_word_error_rate_percent",
        "recognized_word_ratio", "word_accuracy_approved", "outcome",
    }
    result["attempts"] = [
        {key: item[key] for key in attempt_allowed if key in item}
        for item in value.get("attempts", [])
        if isinstance(item, dict)
    ][:20]
    return result


def history_snapshot(value: dict[str, Any]) -> dict[str, Any]:
    """Create the durable, narration-free record shown in Recent local jobs."""
    allowed = {
        "id", "status", "created", "started", "finished", "portal_run_id",
        "model_title", "voice_name", "style", "controls", "controls_modified",
        "consent_basis", "narration_sha256", "source_narration_sha256",
        "narration_characters", "source_narration_characters", "section",
        "section_count", "preflight", "timeline", "issue", "error",
        "listening_verdict", "listening_notes", "listening_recorded",
        "reference_sha256", "reference_transcript_sha256",
        "reference_duration_seconds", "qa_status",
        "comfy_prompt_ids",
    }
    snapshot = {key: value[key] for key in allowed if key in value}
    snapshot["comfy_prompt_ids"] = [
        item
        for item in value.get("comfy_prompt_ids", [])
        if isinstance(item, str) and re.fullmatch(r"[A-Za-z0-9_-]{8,128}", item)
    ][-100:]
    snapshot["outputs"] = [_safe_output(item) for item in value.get("outputs", [])]
    snapshot["diagnostic_outputs"] = [
        _safe_output(item) for item in value.get("diagnostic_outputs", [])
    ]
    snapshot["section_outputs"] = [
        _safe_output(item) for item in value.get("section_outputs", [])
    ]
    snapshot["repair_state"] = _safe_repair_state(value.get("repair_state"))
    # Raw child-process chatter is intentionally not durable. The structured timeline and issue are.
    return snapshot


def public_job_snapshot(value: dict[str, Any]) -> dict[str, Any]:
    """Remove internal correlation identifiers from the browser-facing history record."""
    snapshot = history_snapshot(value)
    snapshot.pop("comfy_prompt_ids", None)
    return snapshot


def persist_job_history(value: dict[str, Any]) -> None:
    job_id = str(value.get("id", ""))
    if not re.fullmatch(r"[0-9a-f]{24}", job_id):
        return
    with HISTORY_LOCK:
        _atomic_json(HISTORY_ROOT / f"{job_id}.json", history_snapshot(value))


def read_job_history(job_id: str) -> dict[str, Any] | None:
    if not re.fullmatch(r"[0-9a-f]{24}", job_id):
        return None
    path = HISTORY_ROOT / f"{job_id}.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict):
        return None
    if value.get("status") in {"queued", "running"} and value.get("portal_run_id") != PORTAL_RUN_ID:
        value = dict(value)
        value.update({
            "status": "stopped",
            "finished": path.stat().st_mtime,
            "qa_status": "not_completed",
            "issue": {
                "code": "portal_restart",
                "category": "control",
                "stage": "portal",
                "message": "The portal restarted before it recorded a terminal result.",
                "retryable": True,
                "recovery": "Run Local diagnostics, confirm Promptus's queue and history, then start a new render only if no complete output exists.",
            },
        })
    return history_snapshot(value)


def output_delivery_is_approved(audio_url: str) -> bool:
    """Authorize media from an explicit verified-master decision, not directory membership."""
    with JOBS_LOCK:
        live_records = [dict(value) for value in JOBS.values()]
    for record in [*live_records, *recent_job_history(MAX_RETAINED_HISTORY)]:
        if record.get("status") != "complete" or record.get("qa_status") != "passed":
            continue
        for output in record.get("outputs", []):
            if (
                output.get("audio_url") == audio_url
                and output.get("delivery_approved") is True
                and output.get("artifact_role") == "verified_master"
            ):
                return True
    return False


def recent_job_history(limit: int = 5) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for path in HISTORY_ROOT.glob("*.json"):
        value = read_job_history(path.stem)
        if value:
            records.append(value)
    records.sort(
        key=lambda item: float(item.get("finished", item.get("started", item.get("created", 0))) or 0),
        reverse=True,
    )
    return records[: max(1, min(limit, 25))]


def backfill_legacy_history() -> int:
    """Convert prior consent result rows into minimal sanitized lifecycle records once."""
    if not CONSENT_LOG.is_file():
        return 0
    submissions: dict[str, dict[str, Any]] = {}
    results: list[dict[str, Any]] = []
    try:
        with CONSENT_LOG.open("r", encoding="utf-8") as handle:
            for line in handle:
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                job_id = str(entry.get("job_id", ""))
                if not re.fullmatch(r"[0-9a-f]{24}", job_id):
                    continue
                if entry.get("action") == "generate_voice":
                    submissions[job_id] = entry
                elif entry.get("action") == "generate_voice_result":
                    results.append(entry)
    except OSError:
        return 0
    created = 0
    output_root: Path | None = None
    for result in results:
        job_id = str(result["job_id"])
        target = HISTORY_ROOT / f"{job_id}.json"
        if target.is_file():
            continue
        submission = submissions.get(job_id, {})
        raw_outcome = str(result.get("outcome", "error"))
        error = str(result.get("error") or "")
        lower_error = error.casefold()
        rejected = "word-accuracy gate" in lower_error or "signal-health gate" in lower_error
        status = "complete" if raw_outcome == "complete" else ("rejected" if rejected else "failed")
        issue: dict[str, Any] | None = None
        if status != "complete":
            issue = {
                "code": "legacy_quality_rejected" if rejected else "legacy_generation_failed",
                "category": "quality" if rejected else "system",
                "stage": "master_word_check" if "word-accuracy" in lower_error else "unknown",
                "message": error or "The earlier portal run did not record a complete result.",
                "retryable": True,
                "recovery": "Review the retained evidence and start a new render with a verified reference.",
            }
        record: dict[str, Any] = {
            "id": job_id,
            "status": status,
            "qa_status": "passed" if status == "complete" else (
                "rejected" if status == "rejected" else "not_completed"
            ),
            "created": submission.get("recorded", result.get("recorded")),
            "finished": result.get("recorded"),
            "portal_run_id": "legacy",
            "model_title": result.get("model_title", submission.get("model_title")),
            "style": result.get("style", submission.get("style")),
            "controls_modified": result.get(
                "controls_modified", submission.get("controls_modified", False)
            ),
            "controls": result.get("controls", submission.get("controls")),
            "consent_basis": result.get("consent_basis", submission.get("consent_basis")),
            "narration_sha256": result.get(
                "narration_sha256", submission.get("narration_sha256")
            ),
            "error": error or None,
            "issue": issue,
            "timeline": [{
                "stage": "Imported earlier result",
                "status": "approved" if status == "complete" else status,
            }],
        }
        word_match = re.search(
            r"\((?P<wer>\d+(?:\.\d+)?)% normalized word error; (?P<ratio>\d+(?:\.\d+)?) word ratio\)",
            error,
        )
        try:
            if output_root is None:
                output_root = comfy_root(promptus_root()) / "output"
            master = output_root / "promptus_voice" / "Portal-Masters" / f"{job_id}.flac"
            if master.is_file():
                detail = inspect_audio(master)
                detail["audio_url"] = "/api/output/" + master.relative_to(output_root).as_posix()
                detail["sections"] = len(list((JOB_ROOT / job_id).glob("narration-[0-9][0-9][0-9].txt")))
                if word_match:
                    detail["normalized_word_error_rate_percent"] = float(word_match.group("wer"))
                    detail["recognized_word_ratio"] = float(word_match.group("ratio"))
                    detail["word_accuracy_approved"] = False
                detail["delivery_approved"] = status == "complete"
                detail["artifact_role"] = (
                    "verified_master" if status == "complete" else "unapproved_master"
                )
                record["section_count"] = detail["sections"]
                record["outputs" if status == "complete" else "diagnostic_outputs"] = [detail]
        except (OSError, PromptusVoiceError, sf.LibsndfileError):
            pass
        try:
            persist_job_history(record)
            created += 1
        except OSError:
            continue
    return created


def speech_words(value: str) -> list[str]:
    return SPEECH_WORD_RE.findall(value.casefold())


def word_accuracy_values(report: dict[str, Any]) -> tuple[float, float]:
    """Return unrounded WER and word ratio, failing closed on malformed evidence."""
    try:
        normalized_reference = int(report["normalized_reference_words"])
        normalized_distance = int(report["normalized_edit_distance"])
        reference_words = int(report["reference_words"])
        recognized_words = int(report["recognized_words"])
        if normalized_reference <= 0 or reference_words <= 0:
            raise ValueError
        error_rate = normalized_distance / normalized_reference * 100.0
        word_ratio = recognized_words / reference_words
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        try:
            error_rate = float(report["normalized_word_error_rate_percent"])
            word_ratio = float(report["recognized_word_ratio"])
        except (KeyError, TypeError, ValueError) as exc:
            raise PromptusVoiceError(
                "The local word verifier omitted required accuracy evidence; refusing approval."
            ) from exc
    if (
        not math.isfinite(error_rate)
        or not math.isfinite(word_ratio)
        or error_rate < 0
        or word_ratio < 0
    ):
        raise PromptusVoiceError(
            "The local word verifier returned invalid accuracy evidence; refusing approval."
        )
    return error_rate, word_ratio


def promptus_root() -> Path:
    """Discover Promptus only when a route needs it, so offline tests can import the portal."""
    global PROMPTUS_ROOT
    if PROMPTUS_ROOT is None:
        PROMPTUS_ROOT = discover_install_root()
    return PROMPTUS_ROOT


def ffmpeg_path() -> Path:
    return (
        promptus_root()
        / "resources"
        / "app.asar.unpacked"
        / "node_modules"
        / "ffmpeg-static"
        / "ffmpeg.exe"
    )


@app.before_request
def enforce_local_request():
    host = request.host.partition(":")[0].strip("[]").casefold()
    if host not in {"127.0.0.1", "localhost", "::1"}:
        return fail("This portal accepts localhost requests only", 403)
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        supplied = request.headers.get("X-Promptus-Portal-Token", "")
        if not secrets.compare_digest(supplied, PORTAL_TOKEN):
            return fail("Invalid local portal token", 403)
    return None


@app.after_request
def protect_diagnostic_response(response):
    if request.path == "/api/log-diagnostics":
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
    return response


@app.errorhandler(413)
def upload_too_large(_error):
    return fail("The recording exceeds the 32 MB local upload limit", 413)


def safe_reference(reference_id: str) -> Path:
    if not reference_id or any(char not in "0123456789abcdef-" for char in reference_id.lower()):
        raise PromptusVoiceError("Invalid reference identifier")
    path = (REFERENCE_ROOT / reference_id).resolve()
    if REFERENCE_ROOT.resolve() not in path.parents:
        raise PromptusVoiceError("Reference path escaped local storage")
    return path


def decode_recording(source: Path, destination: Path) -> None:
    ffmpeg = ffmpeg_path()
    if not ffmpeg.is_file():
        raise PromptusVoiceError(f"Promptus FFmpeg not found: {ffmpeg}")
    result = subprocess.run(
        [str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
         "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", str(destination)],
        capture_output=True, text=True, timeout=90,
    )
    if result.returncode != 0 or not destination.is_file():
        raise PromptusVoiceError(f"Promptus FFmpeg could not decode the recording: {result.stderr.strip()[:300]}")


def trim_and_analyze(source: Path, destination: Path) -> dict[str, Any]:
    audio, sample_rate = sf.read(source, dtype="float32", always_2d=True)
    mono = audio.mean(axis=1)
    if mono.size < sample_rate:
        raise PromptusVoiceError("Recording is too short; read the complete prompt")
    frame = max(1, int(sample_rate * 0.02))
    usable = mono[: mono.size - mono.size % frame]
    frames = usable.reshape(-1, frame)
    rms = np.sqrt(np.mean(frames * frames, axis=1) + 1e-12)
    peak_rms = float(np.max(rms))
    noise = float(np.percentile(rms, 20))
    threshold = max(noise * 3.0, peak_rms * 0.045, 10 ** (-46 / 20))
    active = np.flatnonzero(rms > threshold)
    if active.size == 0:
        raise PromptusVoiceError("No clear speech was detected")
    padding = int(0.16 * sample_rate)
    start = max(0, int(active[0] * frame) - padding)
    end = min(mono.size, int((active[-1] + 1) * frame) + padding)
    trimmed = mono[start:end]
    duration = trimmed.size / sample_rate
    if duration < 7.0:
        raise PromptusVoiceError(
            f"Usable speech is {duration:.1f}s; read the full prompt and aim for 8–11 seconds "
            f"(the hard limit is {MAX_REFERENCE_SECONDS:.1f})"
        )
    if duration > MAX_REFERENCE_SECONDS:
        raise PromptusVoiceError(
            f"Usable speech is {duration:.1f}s; repeat slightly faster and stay under "
            f"{MAX_REFERENCE_SECONDS:.1f} seconds so F5 does not truncate the reference"
        )
    peak = float(np.max(np.abs(trimmed)))
    rms_value = float(np.sqrt(np.mean(trimmed * trimmed) + 1e-12))
    rms_db = 20 * np.log10(max(rms_value, 1e-8))
    clipping = float(np.mean(np.abs(trimmed) >= 0.985) * 100)
    active_ratio = float(np.mean(rms > threshold) * 100)
    snr_estimate = 20 * np.log10(max(float(np.median(rms[rms > threshold])), 1e-8) / max(noise, 1e-8))
    score = 100
    warnings: list[str] = []
    if clipping > 0.05:
        raise PromptusVoiceError("Clipping was detected; move slightly away from the microphone and record again")
    if rms_db < -32:
        score -= 15; warnings.append("Recording is quiet; move closer or raise microphone gain")
    if rms_db < -38:
        raise PromptusVoiceError("Recording is too quiet for a reliable clone; move closer and record again")
    if snr_estimate < 12:
        raise PromptusVoiceError("Background noise is too high; use a quieter room and record again")
    if snr_estimate < 18:
        score -= 15; warnings.append("Some room noise is present")
    if active_ratio < 45:
        raise PromptusVoiceError("Too much silence was detected; read the prompt continuously")
    if active_ratio < 60:
        score -= 10; warnings.append("There is substantial silence between words")
    # Store the reference WELL BELOW the F5 node's target_rms (0.1). The node boosts a quieter
    # reference up to 0.1 before inference (utils_infer.py: `audio * target_rms / rms`) and then
    # scales the OUTPUT down by rms/target_rms — the only headroom the pipeline has. A reference
    # stored at 0.1 leaves zero headroom, and a projected voice then clips at exactly 0 dBFS at
    # the int16 write (measured on two installed voices). 0.05 gives about 6 dB of output
    # headroom; a live voice-a repair then passed both section gates and the final word check. Levels
    # are only approximately voice-neutral because F5's pydub edge trim uses absolute thresholds.
    reference_rms = 0.05
    gain = min(reference_rms / max(rms_value, 1e-8), 0.85 / max(peak, 1e-8), 4.0)
    normalized = np.clip(trimmed * gain, -0.95, 0.95)
    sf.write(destination, normalized, sample_rate, subtype="PCM_16")
    return {
        "duration_seconds": round(duration, 3), "sample_rate": sample_rate,
        "channels": 1, "rms_dbfs": round(float(rms_db), 1),
        "peak": round(peak, 4), "clipping_percent": round(clipping, 3),
        "activity_percent": round(active_ratio, 1), "snr_estimate_db": round(float(snr_estimate), 1),
        "score": max(0, score), "warnings": warnings,
    }


def version_from(path: Path) -> str | None:
    try:
        return str(tomllib.loads(path.read_text(encoding="utf-8"))["project"]["version"])
    except (OSError, KeyError, tomllib.TOMLDecodeError):
        return None


def asr_cache_ready() -> bool:
    model_root = ASR_CACHE / "models--openai--whisper-small.en"
    return model_root.is_dir() and any(model_root.rglob("model.safetensors"))


def local_asr_report(
    audio: Path,
    *,
    source: Path | None = None,
    write_transcript: Path | None = None,
) -> dict[str, Any]:
    """Run the bundled local word verifier without permitting a model download."""
    if not asr_cache_ready():
        raise PromptusVoiceError(
            "The local Whisper word verifier is not cached. Refusing to approve speech from "
            "signal checks alone."
        )
    command = [
        sys.executable,
        str(SCRIPTS / "transcribe_f5_quality.py"),
        str(audio),
    ]
    if source is not None:
        command.append(str(source))
    command.extend(["--cache-dir", str(ASR_CACHE)])
    if write_transcript is not None:
        command.extend(["--write-transcript", str(write_transcript)])
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired as exc:
        raise PromptusVoiceError(
            "The local Whisper word verifier timed out; refusing approval. "
            "The evidence is incomplete, so restart the portal and try the check again."
        ) from exc
    except OSError as exc:
        raise PromptusVoiceError(
            "The local Whisper word verifier could not start; refusing approval. "
            "Repair the Promptus Cosy environment before generating."
        ) from exc
    if result.returncode != 0:
        raise PromptusVoiceError(
            "The local Whisper word verifier failed; refusing to approve this audio. "
            + result.stderr.strip().splitlines()[-1][:240]
            if result.stderr.strip()
            else "The local Whisper word verifier failed; refusing to approve this audio."
        )
    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise PromptusVoiceError(
            "The local Whisper word verifier returned invalid evidence; refusing approval."
        ) from exc
    if not isinstance(report, dict):
        raise PromptusVoiceError("The local Whisper word verifier returned invalid evidence.")
    return report


def transcribe_reference(audio: Path, transcript_path: Path) -> dict[str, Any]:
    report = local_asr_report(audio, write_transcript=transcript_path)
    if not transcript_path.is_file() or not transcript_path.read_text(
        encoding="utf-8-sig"
    ).strip():
        raise PromptusVoiceError("No clear words were recognized in the uploaded reference")
    return report


def verify_narration_words(audio: Path, source: Path) -> dict[str, Any]:
    report = local_asr_report(audio, source=source)
    error_rate, word_ratio = word_accuracy_values(report)
    approved = error_rate <= MAX_NORMALIZED_WORD_ERROR_PERCENT and 0.95 <= word_ratio <= 1.05
    report.update({
        "normalized_word_error_rate_percent": round(error_rate, 2),
        "recognized_word_ratio": round(word_ratio, 3),
        "word_accuracy_approved": approved,
    })
    if not approved:
        marginal = (
            error_rate <= MAX_NORMALIZED_WORD_ERROR_PERCENT + 2.5
            and 0.95 <= word_ratio <= 1.05
        )
        report["issue"] = {
            "code": "word_accuracy_marginal" if marginal else "word_accuracy_rejected",
            "category": "quality",
            "stage": "master_word_check",
            "message": (
                "Audio was created, but the local word check did not approve it "
                f"({error_rate:.2f}% word error; {word_ratio:.3f} word ratio)."
            ),
            "retryable": True,
            "recovery": (
                "Remove speech formatting, use coherent paragraphs, and try a fresh take. "
                "If this voice fails again, re-record its reference with the exact transcript."
            ),
        }
    return report


def generation_fingerprint(record: dict[str, Any]) -> str | None:
    """Identify an exactly repeatable fixed-seed render without retaining its words."""
    controls = record.get("controls")
    if not isinstance(controls, dict) or not isinstance(controls.get("seed"), int):
        return None
    if controls["seed"] < 0:
        return None
    required = (
        "model_title", "narration_sha256", "reference_sha256",
        "reference_transcript_sha256", "style",
    )
    if any(not isinstance(record.get(key), str) or not record.get(key) for key in required):
        return None
    if not isinstance(record.get("section_count"), int) or record["section_count"] <= 0:
        return None
    payload = {
        "model_title": record["model_title"],
        "narration_sha256": record["narration_sha256"],
        "reference_sha256": record["reference_sha256"],
        "reference_transcript_sha256": record["reference_transcript_sha256"],
        "style": record["style"],
        "section_count": record["section_count"],
        "controls": controls,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _apply_word_evidence(
    detail: dict[str, Any], report: dict[str, Any], *, mode: str
) -> dict[str, Any]:
    detail.update({
        "word_accuracy_approved": report.get("word_accuracy_approved") is True,
        "normalized_word_error_rate_percent": report.get(
            "normalized_word_error_rate_percent"
        ),
        "recognized_word_ratio": report.get("recognized_word_ratio"),
        "word_verifier_model": report.get("model"),
        "normalized_edit_distance": report.get("normalized_edit_distance"),
        "normalized_reference_words": report.get("normalized_reference_words"),
        "normalized_recognized_words": report.get("normalized_recognized_words"),
        "long_form_mode": report.get("long_form_mode"),
        "word_verifier_strategy": report.get("word_verifier_strategy"),
        "word_verification_mode": mode,
    })
    return detail


def aggregate_section_word_reports(reports: list[dict[str, Any]]) -> dict[str, Any]:
    """Combine privacy-safe section evidence without letting one bad section hide in an average."""
    if not reports:
        raise PromptusVoiceError("No section word evidence was available")
    reference_words = sum(int(item.get("normalized_reference_words", 0) or 0) for item in reports)
    recognized_words = sum(int(item.get("normalized_recognized_words", 0) or 0) for item in reports)
    edit_distance = sum(int(item.get("normalized_edit_distance", 0) or 0) for item in reports)
    error_rate = edit_distance / max(1, reference_words) * 100
    word_ratio = recognized_words / max(1, reference_words)
    every_section_approved = all(item.get("word_accuracy_approved") is True for item in reports)
    approved = (
        every_section_approved
        and error_rate <= MAX_NORMALIZED_WORD_ERROR_PERCENT
        and 0.95 <= word_ratio <= 1.05
    )
    strategies = {
        str(item.get("word_verifier_strategy"))
        for item in reports if item.get("word_verifier_strategy")
    }
    result: dict[str, Any] = {
        "model": reports[0].get("model"),
        "normalized_reference_words": reference_words,
        "normalized_recognized_words": recognized_words,
        "normalized_edit_distance": edit_distance,
        "normalized_substitutions": sum(int(item.get("normalized_substitutions", 0) or 0) for item in reports),
        "normalized_deletions": sum(int(item.get("normalized_deletions", 0) or 0) for item in reports),
        "normalized_insertions": sum(int(item.get("normalized_insertions", 0) or 0) for item in reports),
        "normalized_word_error_rate_percent": round(error_rate, 2),
        "recognized_word_ratio": round(word_ratio, 3),
        "word_accuracy_approved": approved,
        "word_verifier_strategy": next(iter(strategies)) if len(strategies) == 1 else "mixed",
        "long_form_mode": "section_ledger",
    }
    if not approved:
        result["issue"] = {
            "code": "section_word_accuracy_rejected",
            "category": "quality",
            "stage": "section_word_check",
            "message": (
                "One or more generated sections did not pass the local word check "
                f"({error_rate:.2f}% word error; {word_ratio:.3f} word ratio)."
            ),
            "retryable": True,
            "recovery": "The studio will repair only the failed section once, then rerun every unchanged gate.",
        }
    return result


def derive_repair_seed(
    original_seed: int, narration_sha256: str, section_index: int, repair_round: int
) -> int:
    """Create a reproducible alternate take while retaining the submitted settings."""
    material = f"{original_seed}:{narration_sha256}:{section_index}:{repair_round}".encode("ascii")
    candidate = int.from_bytes(hashlib.sha256(material).digest()[:8], "big") & (2**63 - 1)
    if candidate == original_seed:
        candidate = (candidate + 1) & (2**63 - 1)
    return candidate


def _approved_history_output_path(audio_url: str) -> Path | None:
    prefix = "/api/output/"
    if not isinstance(audio_url, str) or not audio_url.startswith(prefix):
        return None
    relative = Path(urllib.parse.unquote(audio_url[len(prefix):]).replace("/", "\\"))
    if relative.is_absolute() or ".." in relative.parts:
        return None
    output_root = (comfy_root(promptus_root()) / "output").resolve()
    approved_root = (output_root / "promptus_voice").resolve()
    path = (output_root / relative).resolve()
    if approved_root not in path.parents or not path.is_file():
        return None
    return path


def recover_prior_verified_output(
    current_job: dict[str, Any], master_source: Path
) -> dict[str, Any] | None:
    """Revalidate and reuse an exact fixed-seed master before spending another GPU render."""
    fingerprint = generation_fingerprint(current_job)
    if fingerprint is None:
        return None
    candidates = recent_job_history(MAX_RETAINED_HISTORY)
    for candidate in candidates:
        if candidate.get("id") == current_job.get("id"):
            continue
        if candidate.get("status") != "complete" or candidate.get("qa_status") != "passed":
            continue
        if candidate.get("listening_verdict") in {"revise", "rejected"}:
            continue
        if generation_fingerprint(candidate) != fingerprint:
            continue
        for recorded in candidate.get("outputs", []):
            if not isinstance(recorded, dict):
                continue
            if recorded.get("delivery_approved") is not True or recorded.get("artifact_role") != "verified_master":
                continue
            path = _approved_history_output_path(recorded.get("audio_url", ""))
            if path is None:
                continue
            try:
                if file_sha256(path) != recorded.get("sha256"):
                    continue
                detail = inspect_audio(path)
                if detail.get("quality_approved") is not True or detail.get("quality_flags"):
                    continue
                report = verify_narration_words(path, master_source)
            except (OSError, PromptusVoiceError):
                continue
            if report.get("word_accuracy_approved") is not True:
                continue
            _apply_word_evidence(detail, report, mode="revalidated_exact_fixed_seed_master")
            detail.update({
                "audio_url": recorded["audio_url"],
                "delivery_approved": True,
                "artifact_role": "verified_master",
                "sections": recorded.get("sections"),
                "recovered_from_sha256": recorded.get("sha256"),
            })
            return detail
    return None


def _cosy_busy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, dict):
        for key in ("busy", "is_busy", "isBusy"):
            if key in value:
                return bool(value[key])
        state = str(value.get("status", value.get("state", ""))).casefold()
        return state in {"busy", "running", "processing"}
    if isinstance(value, str):
        return value.strip().casefold() in {"true", "busy", "running", "processing"}
    return False


def backend_health(*, include_portal_slot: bool = True) -> dict[str, Any]:
    """Return authoritative queue state from the Promptus-owned services.

    Cosy worker 0.110's ``Job.is_running`` is inverted: completed jobs remain in
    ``running_jobs`` while in-flight jobs can report false. Keep its endpoint as
    a reachability/diagnostic signal, but use ComfyUI's queue plus this portal's
    process lock for admission control.
    """
    queue_status, queue = json_request(f"{DEFAULT_COMFY_URL}/queue")
    cosy_status, cosy = json_request(f"{DEFAULT_COSY_URL}/api/generate/is-busy")
    if queue_status != 200 or not isinstance(queue, dict):
        raise PromptusVoiceError(f"ComfyUI queue health returned HTTP {queue_status}")
    if cosy_status not in (200, 201):
        raise PromptusVoiceError(f"Cosy health returned HTTP {cosy_status}")
    queue_running = len(queue.get("queue_running", []))
    queue_pending = len(queue.get("queue_pending", []))
    queue_busy = queue_running > 0 or queue_pending > 0
    cosy_busy_reported = _cosy_busy(cosy)
    slot_free = True
    if include_portal_slot:
        slot_free = GENERATION_SLOT.acquire(blocking=False)
        if slot_free:
            GENERATION_SLOT.release()
    with JOBS_LOCK:
        retained_jobs = len(JOBS)
    return {
        "comfyui": {
            "reachable": True,
            "queue_running": queue_running,
            "queue_pending": queue_pending,
        },
        "cosy": {
            "reachable": True,
            "busy_reported": cosy_busy_reported,
            "busy": queue_busy,
            "stale_completion_flag": cosy_busy_reported and not queue_busy,
        },
        "portal": {"busy": not slot_free, "retained_jobs": retained_jobs},
        "accepting_jobs": slot_free and not queue_busy,
    }


def _portable_diagnostic_path(path: Path, install_root: Path) -> str:
    """Describe an allow-listed path without disclosing the Windows user profile."""
    resolved = path.resolve(strict=False)
    install = install_root.resolve(strict=False)
    portal_data = DATA_ROOT.resolve(strict=False)
    if resolved == install or install in resolved.parents:
        relative = resolved.relative_to(install)
        return "<installRoot>" + ("\\" + str(relative).replace("/", "\\") if relative.parts else "")
    if resolved == portal_data or portal_data in resolved.parents:
        relative = resolved.relative_to(portal_data)
        return "<portalData>" + ("\\" + str(relative).replace("/", "\\") if relative.parts else "")
    return "<unavailable>"


def _diagnostic_path_is_confined(path: Path, install_root: Path) -> bool:
    """Reject a junction or symlink that escapes either verified local evidence root."""
    try:
        resolved = path.resolve(strict=False)
        roots = (install_root.resolve(strict=False), DATA_ROOT.resolve(strict=False))
        return any(resolved == root or root in resolved.parents for root in roots)
    except OSError:
        return False


def discover_log_sources(root: Path | None = None) -> dict[str, dict[str, Any]]:
    """Return the exact, non-recursive Promptus evidence allow-list.

    Paths remain server-side. The browser receives only their portable ``<installRoot>`` form.
    Broad desktop logs and rotated logs are metadata-only because they can contain credentials,
    narration, reference filenames, or stale failures.
    """
    install = (root or promptus_root()).resolve(strict=False)
    logs = install / "logs"
    user_logs = comfy_root(install) / "user"

    current_candidates = (user_logs / "comfyui_8288.log", user_logs / "comfyui.log")
    current_user_log = next((item for item in current_candidates if item.is_file()), current_candidates[0])
    previous_candidates = (
        user_logs / "comfyui_8288.prev.log",
        user_logs / "comfyui_8288.prev2.log",
        user_logs / "comfyui_8288.prev3.log",
        user_logs / "comfyui_8288.prev4.log",
        user_logs / "comfyui_8288.prev5.log",
    )
    existing_previous = [item for item in previous_candidates if item.is_file()]
    previous_user_log = (
        max(existing_previous, key=lambda item: item.stat().st_mtime)
        if existing_previous
        else previous_candidates[0]
    )

    specifications = {
        "launcher": ("Managed hardware launcher", install / "promptus_launcher.log", "scan"),
        "comfyui": ("Promptus ComfyUI stream", logs / "ComfyUI_log.txt", "scan"),
        "cosyflow": ("Promptus Cosy worker stream", logs / "Cosyflow_log.txt", "scan"),
        "comfyui_user": ("ComfyUI native session log", current_user_log, "scan"),
        "cworker": ("Promptus GPU worker log", logs / "CWorker_log.txt", "metadata"),
        "queue": ("Promptus queue log", logs / "Queue_log.txt", "metadata"),
        "debug": ("Promptus debug log", logs / "Debug_log.txt", "metadata"),
        "main": ("Promptus desktop log", logs / "main.log", "metadata"),
        "comfyui_prev": ("Previous ComfyUI session log", previous_user_log, "metadata"),
        "comfy_output": ("Promptus media index", install / "comfy_output.db", "metadata"),
        "portal_history": ("Voice Studio result history", HISTORY_ROOT, "metadata"),
    }
    return {
        source_id: {
            "id": source_id,
            "label": label,
            "path": path,
            "mode": mode,
            "display_path": _portable_diagnostic_path(path, install),
            "confined": _diagnostic_path_is_confined(path, install),
        }
        for source_id, (label, path, mode) in specifications.items()
    }


def _diagnostic_source_metadata(source: dict[str, Any], install_root: Path) -> dict[str, Any]:
    path = source["path"]
    confined = bool(source.get("confined")) and _diagnostic_path_is_confined(path, install_root)
    result = {
        "id": source["id"],
        "label": source["label"],
        "display_path": source["display_path"],
        "mode": source["mode"],
        "available": False,
        "bytes": 0,
        "modified": None,
        "age_seconds": None,
        "summary": "Not available in this Promptus installation",
    }
    if not confined:
        result["display_path"] = "<unavailable>"
        result["summary"] = "Rejected because the path left the verified local roots"
        return result
    try:
        stat = path.stat()
    except OSError:
        return result
    result.update({
        "available": path.is_file() or path.is_dir(),
        "bytes": int(stat.st_size) if path.is_file() else 0,
        "modified": round(float(stat.st_mtime), 3),
        "age_seconds": max(0, round(time.time() - float(stat.st_mtime), 1)),
        "summary": "Available locally; contents are not exposed",
    })
    if path.is_dir() and source["id"] == "portal_history":
        try:
            result["entries"] = sum(1 for item in path.glob("*.json") if item.is_file())
            result["summary"] = f"{result['entries']} sanitized result records"
        except OSError:
            result["entries"] = 0
    return result


_ANSI_ESCAPE_RE = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")
_UNSAFE_LOG_CONTROLS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]")


def _bounded_log_lines(path: Path) -> tuple[list[str], dict[str, Any]]:
    """Read at most one MiB and never transport the decoded text beyond this process."""
    size = path.stat().st_size
    with path.open("rb") as handle:
        start = max(0, size - MAX_LOG_TAIL_BYTES)
        handle.seek(start)
        payload = handle.read(MAX_LOG_TAIL_BYTES)
    if start and b"\n" in payload:
        payload = payload.split(b"\n", 1)[1]
    decoded = payload.decode("utf-8", errors="replace")
    lines: list[str] = []
    for raw_line in decoded.splitlines()[-MAX_LOG_TAIL_LINES:]:
        cleaned = _UNSAFE_LOG_CONTROLS_RE.sub("", _ANSI_ESCAPE_RE.sub("", raw_line))
        lines.append(cleaned[:MAX_LOG_LINE_CHARS])
    return lines, {
        "bytes_scanned": len(payload),
        "truncated": start > 0,
        "lines_scanned": len(lines),
    }


def _latest_log_session(source_id: str, lines: list[str]) -> list[str]:
    marker_patterns = {
        "launcher": (re.compile(r"^PromptusAI Managed Hardware Init", re.I),),
        "comfyui": (
            re.compile(r"^Prestartup times for custom nodes:", re.I),
            re.compile(r"^\*\* ComfyUI startup time:", re.I),
            re.compile(r"^### ComfyUI Version:", re.I),
        ),
        "comfyui_user": (
            re.compile(r"^Prestartup times for custom nodes:", re.I),
            re.compile(r"^\*\* ComfyUI startup time:", re.I),
            re.compile(r"^### ComfyUI Version:", re.I),
        ),
        "cosyflow": (re.compile(r"^worker version:\s*[0-9.]+\s*$", re.I),),
    }
    patterns = marker_patterns.get(source_id, ())
    indices = [index for index, line in enumerate(lines) if any(pattern.search(line) for pattern in patterns)]
    return lines[indices[-1]:] if indices else lines


def classify_log_signatures(source_id: str, lines: list[str]) -> dict[str, Any]:
    """Map anchored, source-specific signatures to safe values; raw lines never leave here."""
    current = _latest_log_session(source_id, lines)
    signals: dict[str, Any] = {
        "source": source_id,
        "session_lines": len(current),
        "codes": [],
    }

    def add(code: str) -> None:
        if code not in signals["codes"]:
            signals["codes"].append(code)

    sensitive_markers = (
        "input_value", "ref_text", "reference text", "narration", "authorization",
        "bearer ", "api_key", "api-key", "password", "server message:", "data:audio",
    )
    for line in current:
        folded = line.casefold()
        if any(marker in folded for marker in sensitive_markers):
            continue
        if source_id in {"comfyui", "comfyui_user"}:
            match = re.match(r"^(?:### )?ComfyUI [Vv]ersion:\s*v?([0-9]+(?:\.[0-9]+){1,3})\s*$", line)
            if match:
                signals["version"] = match.group(1)
            match = re.match(r"^Total VRAM\s+(\d+)\s+MB(?:,|\s|$)", line, re.I)
            if match:
                signals["vram_mb"] = int(match.group(1))
            if re.match(r"^\s*\d+(?:\.\d+)? seconds:\s+.*[\\/]custom_nodes[\\/]comfyui-f5-tts\s*$", line, re.I):
                signals["f5_loaded"] = True
                add("f5_node_loaded")
            if re.match(r"^To see the GUI go to:\s*http://localhost:8288/?\s*$", line, re.I):
                signals["server_ready"] = True
            if re.match(r"^Prompt executed in\s+[0-9.]+\s+seconds\s*$", line, re.I):
                signals["completed_prompts"] = int(signals.get("completed_prompts", 0)) + 1
            if re.match(r"^WARNING: F5TTSAudioAdvanced\.IS_CHANGED\(\) missing .*sample_audio", line, re.I):
                signals["advanced_loader_warnings"] = int(signals.get("advanced_loader_warnings", 0)) + 1
                add("advanced_node_loader_warning")
            if re.search(r"Audio is over 12s, clipping short", line, re.I):
                signals["overlength_references"] = int(signals.get("overlength_references", 0)) + 1
                add("reference_over_12_seconds")
            if re.match(r"^(?:CUDA out of memory|OutOfMemoryError|.*allocation on device)", line, re.I):
                signals["oom_events"] = int(signals.get("oom_events", 0)) + 1
                add("cuda_out_of_memory")
            if re.match(r"^(?:!!! Exception during processing !!!|Prompt outputs failed validation|invalid prompt)", line, re.I):
                signals["execution_errors"] = int(signals.get("execution_errors", 0)) + 1
                add("comfy_execution_error")
            if re.match(r"^(?:Failed to import|Cannot import|ModuleNotFoundError|No module named).*f5", line, re.I):
                signals["f5_import_failed"] = True
                add("f5_import_failed")
            if re.search(r"(?:Could not load libtorchcodec|FFmpeg.*not found)", line, re.I):
                signals["decoder_errors"] = int(signals.get("decoder_errors", 0)) + 1
                add("decoder_dependency_error")
        elif source_id == "cosyflow":
            match = re.match(r"^worker version:\s*([0-9]+(?:\.[0-9]+){1,3})\s*$", line, re.I)
            if match:
                signals["worker_version"] = match.group(1)
            match = re.match(r"^Got\s+(\d+)\s+from local cosyflow directory\s+.+$", line, re.I)
            if match:
                signals["local_cosyflows"] = int(match.group(1))
            if re.match(r"^\* Running on\s+http://localhost:8190/?\s*$", line, re.I):
                signals["server_ready"] = True
            if re.search(r"model_loader_inputs: warning: old and new tests disagree", line, re.I):
                signals["model_loader_notices"] = int(signals.get("model_loader_notices", 0)) + 1
                add("advanced_node_loader_warning")
            if re.search(r"install would exceed maximum models size; returning False", line, re.I):
                signals["model_budget_warnings"] = int(signals.get("model_budget_warnings", 0)) + 1
                add("models_budget_exceeded")
            if re.match(r"^(?:Traceback|.*ConnectionRefused|.*Cannot reach.*8288|.*timed out)", line, re.I):
                signals["connection_errors"] = int(signals.get("connection_errors", 0)) + 1
                add("cosy_comfy_connection_error")
        elif source_id == "launcher":
            if re.match(r"^\s*Environment matches policy\. No changes needed\.\s*$", line, re.I):
                signals["environment_ready"] = True
            if re.match(r"^\s*Environment repair completed", line, re.I):
                signals["environment_repaired"] = True
                add("managed_environment_repaired")
    return signals


def _constant_finding(
    code: str,
    severity: str,
    title: str,
    evidence: str,
    resolution: str,
    source: str,
    *,
    actionable: bool = True,
) -> dict[str, Any]:
    return {
        "code": code,
        "severity": severity,
        "title": title,
        "evidence": evidence,
        "resolution": resolution,
        "source": source,
        "actionable": actionable,
    }


def _comfy_prompt_history_summary(prompt_ids: list[str]) -> dict[str, int]:
    result = {"checked": 0, "complete": 0, "error": 0, "active": 0}
    for prompt_id in prompt_ids[-10:]:
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,128}", prompt_id):
            continue
        try:
            status, payload = json_request(
                f"{DEFAULT_COMFY_URL}/history/{urllib.parse.quote(prompt_id, safe='')}", timeout=3
            )
        except PromptusVoiceError:
            continue
        if status != 200 or not isinstance(payload, dict):
            continue
        record = payload.get(prompt_id)
        if not isinstance(record, dict):
            continue
        result["checked"] += 1
        state = record.get("status") if isinstance(record.get("status"), dict) else {}
        if state.get("completed") is True and str(state.get("status_str", "")).casefold() == "success":
            result["complete"] += 1
        elif str(state.get("status_str", "")).casefold() in {"error", "failed"}:
            result["error"] += 1
        else:
            result["active"] += 1
    return result


def build_log_diagnostics(job_value: dict[str, Any] | None = None) -> dict[str, Any]:
    """Combine live Promptus truth with advisory, signature-only on-disk evidence."""
    install = promptus_root().resolve(strict=False)
    sources = discover_log_sources(install)
    public_sources: list[dict[str, Any]] = []
    signals: dict[str, dict[str, Any]] = {}
    for source_id, source in sources.items():
        metadata = _diagnostic_source_metadata(source, install)
        if metadata["available"] and source["mode"] == "scan" and source["path"].is_file():
            try:
                lines, scan = _bounded_log_lines(source["path"])
                classified = classify_log_signatures(source_id, lines)
                signals[source_id] = classified
                metadata.update(scan)
                if source_id in {"comfyui", "comfyui_user"}:
                    details = []
                    if classified.get("version"):
                        details.append(f"ComfyUI {classified['version']}")
                    if classified.get("completed_prompts"):
                        details.append(f"{classified['completed_prompts']} completed prompts in the current log session")
                    metadata["summary"] = " · ".join(details) or "Current session signatures checked"
                elif source_id == "cosyflow":
                    details = []
                    if classified.get("worker_version"):
                        details.append(f"worker {classified['worker_version']}")
                    if classified.get("local_cosyflows") is not None:
                        details.append(f"{classified['local_cosyflows']} local cosyflows")
                    metadata["summary"] = " · ".join(details) or "Current worker signatures checked"
                elif source_id == "launcher":
                    metadata["summary"] = (
                        "Managed environment matches policy"
                        if classified.get("environment_ready")
                        else "Managed launcher signatures checked"
                    )
            except (OSError, ValueError):
                metadata["summary"] = "Present but not readable during this check"
        elif source_id == "cworker" and metadata["available"]:
            age = metadata.get("age_seconds")
            metadata["summary"] = (
                "Recent Promptus worker activity"
                if isinstance(age, (int, float)) and age <= 60
                else "No recent worker-log activity; confirm its state in Promptus Server"
            )
        public_sources.append(metadata)

    findings: list[dict[str, Any]] = []
    live_nodes: tuple[bool, bool] | None = None
    live_health: dict[str, Any] | None = None
    try:
        live_nodes = (
            bool(get_node_info(DEFAULT_COMFY_URL, "F5TTSAudio")),
            bool(get_node_info(DEFAULT_COMFY_URL, "F5TTSAudioAdvanced")),
        )
    except PromptusVoiceError:
        live_nodes = None
    try:
        live_health = backend_health()
    except PromptusVoiceError:
        live_health = None

    if live_health is None:
        findings.append(_constant_finding(
            "promptus_services_unreachable", "blocking", "Promptus services are not reachable",
            "The live ComfyUI queue or Cosy worker did not answer this local check.",
            "Open Promptus → Server and start or restart ComfyUI and Cosy there. Then check again.",
            "Live Promptus APIs",
        ))
    elif not live_health.get("accepting_jobs"):
        queue = live_health.get("comfyui", {})
        findings.append(_constant_finding(
            "promptus_queue_busy", "busy", "Promptus is working on a job",
            f"The live queue reports {int(queue.get('queue_running', 0))} running and {int(queue.get('queue_pending', 0))} pending.",
            "Wait for the current Promptus job. Do not restart services while the queue is active.",
            "Live ComfyUI queue",
        ))
    elif live_health.get("cosy", {}).get("stale_completion_flag"):
        findings.append(_constant_finding(
            "cosy_stale_completion_flag", "advisory", "Cosy reports an old busy flag",
            "ComfyUI's queue is empty, so the portal correctly treats the worker as available.",
            "No action is needed. The queue and portal lock remain the admission authority.",
            "Live Cosy and ComfyUI APIs", actionable=False,
        ))

    if live_nodes is None:
        if live_health is not None:
            findings.append(_constant_finding(
                "f5_node_check_unavailable", "attention", "F5 node state could not be confirmed",
                "ComfyUI responded, but its F5 node information could not be read.",
                "Refresh Promptus Server. If F5 is still absent, repair it through PManager.",
                "Live ComfyUI node registry",
            ))
    elif not all(live_nodes):
        findings.append(_constant_finding(
            "f5_import_failed", "blocking", "F5 nodes are not loaded",
            "ComfyUI does not currently expose both the Basic and Advanced F5 nodes.",
            "Restart ComfyUI from Promptus → Server. If the nodes remain missing, repair the F5 package through PManager.",
            "Live ComfyUI node registry",
        ))
    else:
        findings.append(_constant_finding(
            "f5_node_loaded", "ready", "F5 is loaded in Promptus",
            "The live ComfyUI registry exposes both F5 audio nodes.",
            "No action is needed.", "Live ComfyUI node registry", actionable=False,
        ))

    if not asr_cache_ready():
        findings.append(_constant_finding(
            "word_verifier_missing", "blocking", "Local word verification is unavailable",
            "The required local Whisper model is not ready, so output cannot be approved.",
            "Start Voice Studio with Promptus's Cosy environment and restore its local verifier cache before generating.",
            "Voice Studio verifier preflight",
        ))

    comfy = signals.get("comfyui") or signals.get("comfyui_user") or {}
    if comfy.get("oom_events"):
        findings.append(_constant_finding(
            "cuda_out_of_memory", "attention", "A current-session GPU memory fault was recorded",
            "The Promptus ComfyUI stream contains a recognized CUDA memory-exhaustion signature.",
            "Wait for the queue to empty, close other GPU work, then restart ComfyUI from Promptus Server and retry.",
            "Promptus ComfyUI stream",
        ))
    if comfy.get("execution_errors"):
        findings.append(_constant_finding(
            "comfy_execution_error", "attention", "ComfyUI recorded an execution failure",
            "A recognized current-session execution-error signature is present.",
            "Use the job's saved stage and Comfy prompt history below; retry only the failed operation.",
            "Promptus ComfyUI stream",
        ))
    if comfy.get("decoder_errors"):
        findings.append(_constant_finding(
            "decoder_dependency_error", "blocking", "Promptus audio decoding needs repair",
            "A recognized TorchCodec or FFmpeg dependency failure is present in the current session.",
            "Restart through Promptus Server so the managed environment can validate itself; do not patch the system Python.",
            "Promptus ComfyUI stream",
        ))
    if comfy.get("overlength_references"):
        findings.append(_constant_finding(
            "reference_over_12_seconds", "attention", "A reference reached F5 above its safe limit",
            "The current ComfyUI session recorded F5 truncating a reference above 12 seconds.",
            "Re-record or retire the affected legacy voice. New Studio captures already stop at 11.8 seconds.",
            "Promptus ComfyUI stream",
        ))
    if comfy.get("advanced_loader_warnings"):
        findings.append(_constant_finding(
            "advanced_node_loader_warning", "advisory", "Known F5 cache warning detected",
            "The installed Advanced node emitted its known IS_CHANGED signature warning; completed renders remain valid.",
            "No audio repair is needed. Update the node through PManager when an upstream fix is available.",
            "Promptus ComfyUI stream", actionable=False,
        ))

    cosy = signals.get("cosyflow", {})
    if cosy.get("model_budget_warnings"):
        findings.append(_constant_finding(
            "models_budget_exceeded", "advisory", "Promptus model storage reached its budget",
            "Cosy recorded a model-install budget warning. Existing F5 voice generation does not require another model download.",
            "No F5 action is needed. Review unused models in Promptus only before installing another large cosyflow.",
            "Promptus Cosy worker stream", actionable=False,
        ))
    if cosy.get("model_loader_notices") and not any(item["code"] == "advanced_node_loader_warning" for item in findings):
        findings.append(_constant_finding(
            "advanced_node_loader_warning", "advisory", "Known Promptus flow-parser notice detected",
            "Cosy compared its old and new Advanced-node input tests; the effective media test remains correct.",
            "No action is needed. This notice does not affect dependency resolution or audio.",
            "Promptus Cosy worker stream", actionable=False,
        ))

    cworker = next((item for item in public_sources if item["id"] == "cworker"), None)
    if cworker and cworker.get("available") and isinstance(cworker.get("age_seconds"), (int, float)) and cworker["age_seconds"] > 60:
        findings.append(_constant_finding(
            "cworker_activity_stale", "attention", "Promptus worker activity is stale",
            "The allow-listed CWorker log has not changed for more than a minute.",
            "Confirm CWorker in Promptus → Server. Restart it there only if the app does not show it ready.",
            "Promptus CWorker metadata",
        ))

    if job_value:
        issue = job_value.get("issue") if isinstance(job_value.get("issue"), dict) else {}
        category = str(issue.get("category", "")).casefold()
        code = str(issue.get("code", "job_issue"))
        if category == "quality":
            output = (job_value.get("diagnostic_outputs") or job_value.get("outputs") or [{}])[0]
            error_rate = output.get("normalized_word_error_rate_percent") if isinstance(output, dict) else None
            ratio = output.get("recognized_word_ratio") if isinstance(output, dict) else None
            measured = (
                f"The saved master measured {float(error_rate):.2f}% normalized word error and {float(ratio):.3f} word ratio."
                if isinstance(error_rate, (int, float)) and isinstance(ratio, (int, float))
                else "The saved quality evidence rejected this take; this is not a service crash."
            )
            findings.append(_constant_finding(
                code if re.fullmatch(r"[a-z0-9_]{3,80}", code) else "audio_quality_rejected",
                "quality", "Audio was created but not approved", measured,
                "Use the measured recovery shown with the job. System logs should not be used to overrule the audio gate.",
                "Sanitized Voice Studio history",
            ))
        elif category in {"backend", "system", "verification", "control"}:
            findings.append(_constant_finding(
                code if re.fullmatch(r"[a-z0-9_]{3,80}", code) else "local_job_failed",
                "attention", "The saved job needs local system diagnosis",
                "Voice Studio retained the failure stage and non-private result evidence across the portal session.",
                "Follow the live finding above. Retry only after Promptus reports the affected service ready.",
                "Sanitized Voice Studio history",
            ))
        prompt_summary = _comfy_prompt_history_summary(list(job_value.get("comfy_prompt_ids", [])))
        if prompt_summary["error"]:
            findings.append(_constant_finding(
                "comfy_history_execution_error", "attention", "ComfyUI confirms a section execution error",
                f"Authoritative ComfyUI history reports {prompt_summary['error']} failed correlated section prompt(s).",
                "Retry the failed operation after the live Promptus finding is resolved.",
                "Correlated ComfyUI history",
            ))

    severity_order = {"blocking": 0, "busy": 1, "attention": 2, "quality": 3, "advisory": 4, "ready": 5}
    findings.sort(key=lambda item: severity_order.get(item["severity"], 9))
    if any(item["severity"] == "blocking" for item in findings):
        status = "action_needed"
        summary = "Promptus needs attention before another voice job."
    elif any(item["severity"] == "busy" for item in findings):
        status = "busy"
        summary = "Promptus is healthy and currently working."
    elif any(item["severity"] in {"attention", "quality"} for item in findings):
        status = "attention"
        summary = "A specific issue was found with a Promptus-native next step."
    else:
        status = "ready"
        summary = "No related local system fault was found."
    return {
        "status": status,
        "summary": summary,
        "checked_at": round(time.time(), 3),
        "findings": findings,
        "sources": public_sources,
        "privacy": "Signature-only, read-only scan. Raw logs, narration, transcripts, tokens, prompt IDs, and absolute user paths never leave the server.",
        "read_only": True,
    }


@app.get("/")
def index():
    return render_template(
        "index.html", reference_prompt=REFERENCE_PROMPT, portal_token=PORTAL_TOKEN
    )


@app.get("/api/status")
def status():
    try:
        basic = get_node_info(DEFAULT_COMFY_URL, "F5TTSAudio")
        advanced = get_node_info(DEFAULT_COMFY_URL, "F5TTSAudioAdvanced")
        stats_status, stats = json_request(f"{DEFAULT_COMFY_URL}/system_stats")
        device = stats.get("devices", [{}])[0] if stats_status == 200 and isinstance(stats, dict) else {}
        node_root = comfy_root(promptus_root()) / "custom_nodes" / "comfyui-f5-tts"
        return jsonify({
            "ok": True, "pmanager": pmanager_status(DEFAULT_PMANAGER_URL),
            "f5_basic": bool(basic), "f5_advanced": bool(advanced),
            "f5_node_version": version_from(node_root / "pyproject.toml"),
            "f5_core_version": version_from(node_root / "F5-TTS" / "pyproject.toml"),
            "recommended_model": "F5TTS_v1_Base",
            "word_verifier": asr_cache_ready(),
            "gpu": device.get("name", "unknown"),
            "vram_free_gb": round(int(device.get("vram_free", 0)) / 1024 ** 3, 2),
            "reference_prompt": REFERENCE_PROMPT,
            "backend": backend_health(),
        })
    except PromptusVoiceError as exc:
        return fail(str(exc), 503)


@app.get("/api/health")
def health():
    try:
        return jsonify({"ok": True, **backend_health()})
    except PromptusVoiceError as exc:
        return fail(str(exc), 503)


def _no_store_json(payload: dict[str, Any], status_code: int = 200):
    response = jsonify(payload)
    response.status_code = status_code
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return response


@app.post("/api/log-diagnostics")
def log_diagnostics():
    """Discover local Promptus evidence without transporting any raw log content."""
    data = request.get_json(silent=True) or {}
    job_id = str(data.get("job_id", "")).strip()
    job_value: dict[str, Any] | None = None
    if job_id:
        if not re.fullmatch(r"[0-9a-f]{24}", job_id):
            return _no_store_json(
                {"ok": False, "error": "The local job identifier is invalid."}, 400
            )
        with JOBS_LOCK:
            value = JOBS.get(job_id)
            job_value = dict(value) if value else None
        if job_value is None:
            job_value = read_job_history(job_id)
        if job_value is None:
            return _no_store_json(
                {"ok": False, "error": "The sanitized local job history was not found."}, 404
            )
    try:
        report = build_log_diagnostics(job_value)
    except (PromptusVoiceError, OSError, ValueError):
        report = {
            "status": "unavailable",
            "summary": "Promptus log discovery is unavailable; live service checks remain authoritative.",
            "checked_at": round(time.time(), 3),
            "findings": [_constant_finding(
                "log_discovery_unavailable", "attention", "Local evidence could not be discovered",
                "The verified Promptus installation could not be opened during this read-only check.",
                "Open Promptus → Server and use its live service status. Then check diagnostics again.",
                "Verified Promptus install discovery",
            )],
            "sources": [],
            "privacy": "No raw logs, paths, narration, transcripts, tokens, or prompt IDs were returned.",
            "read_only": True,
        }
    payload = {"ok": True, **report, "diagnostics": report}
    if job_id:
        # The portal already exposes this random local identifier in its sanitized history.
        payload["job_id"] = job_id
    return _no_store_json(payload)


def _audio_strings(value: Any, *, key: str = "") -> list[str]:
    """Return fixed audio filenames embedded in a local cosyflow prompt."""
    found: list[str] = []
    if isinstance(value, dict):
        for child_key, child in value.items():
            found.extend(_audio_strings(child, key=str(child_key)))
    elif isinstance(value, list):
        for child in value:
            found.extend(_audio_strings(child, key=key))
    elif isinstance(value, str) and key.casefold() in {
        "audio", "sample", "ref_audio", "reference_audio"
    } and Path(value).suffix.casefold() in {".wav", ".flac", ".mp3", ".ogg", ".m4a"}:
        found.append(value)
    return found


def installed_reference_files(title: str) -> tuple[Path, Path]:
    root = promptus_root()
    flow_path = local_cosyflow_dir(root) / title_to_filename(title)
    if not flow_path.is_file():
        raise PromptusVoiceError("The installed voice definition could not be read")
    flow = json.loads(flow_path.read_text(encoding="utf-8-sig"))
    candidates = _audio_strings(flow.get("prompt", {}))
    if not candidates:
        raise PromptusVoiceError("The installed voice does not expose a fixed reference")
    relative = Path(candidates[0].replace("/", "\\"))
    if relative.is_absolute() or ".." in relative.parts:
        raise PromptusVoiceError("The installed voice uses an unsafe reference path")
    input_root = (comfy_root(root) / "input").resolve()
    reference = (input_root / relative).resolve()
    if input_root not in reference.parents or not reference.is_file():
        raise PromptusVoiceError("The installed reference audio is missing")
    transcript = reference.with_suffix(".txt")
    if not transcript.is_file() or not transcript.read_text(encoding="utf-8-sig").strip():
        raise PromptusVoiceError("The matching reference transcript is missing")
    return reference, transcript


def _reference_audit_key(reference: Path, transcript: Path) -> str:
    return hashlib.sha256(
        f"{file_sha256(reference)}:{file_sha256(transcript)}".encode("ascii")
    ).hexdigest()


def _read_reference_audit_cache() -> dict[str, Any]:
    try:
        value = json.loads(REFERENCE_AUDIT_CACHE.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def cached_reference_word_audit(reference: Path, transcript: Path) -> dict[str, Any] | None:
    key = _reference_audit_key(reference, transcript)
    with REFERENCE_AUDIT_LOCK:
        value = _read_reference_audit_cache().get(key)
    return value if isinstance(value, dict) else None


def ensure_reference_word_audit(title: str) -> dict[str, Any]:
    """Verify one selected fixed reference once, then reuse evidence by content hash."""
    reference, transcript = installed_reference_files(title)
    key = _reference_audit_key(reference, transcript)
    with REFERENCE_AUDIT_LOCK:
        cache = _read_reference_audit_cache()
        cached = cache.get(key)
    if isinstance(cached, dict):
        return cached
    report = local_asr_report(reference, source=transcript)
    error_rate, word_ratio = word_accuracy_values(report)
    approved = error_rate <= MAX_REFERENCE_WORD_ERROR_PERCENT and 0.75 <= word_ratio <= 1.25
    value = {
        "verified": time.time(),
        "reference_sha256": file_sha256(reference),
        "transcript_sha256": file_sha256(transcript),
        "normalized_word_error_rate_percent": round(error_rate, 2),
        "recognized_word_ratio": round(word_ratio, 3),
        "approved": approved,
    }
    with REFERENCE_AUDIT_LOCK:
        cache = _read_reference_audit_cache()
        cache[key] = value
        _atomic_json(REFERENCE_AUDIT_CACHE, cache)
    return value


def installed_voice_health(title: str) -> dict[str, Any]:
    """Fail closed only for a reference defect we can prove from the installed flow.

    Some legacy Cosy entries do not expose a readable fixed reference. Those remain selectable but are
    labelled unverified; every render still has to pass the signal and word-accuracy gates.
    """
    unverified = {
        "health": "unverified",
        "health_label": "Reference not preflighted; output gates still apply",
        "selectable": True,
    }
    try:
        reference, transcript = installed_reference_files(title)
        info = sf.info(reference)
        duration = float(info.duration)
        issues: list[str] = []
        if duration < 7.0:
            issues.append(f"reference is only {duration:.1f}s")
        if duration > MAX_REFERENCE_SECONDS:
            issues.append(f"reference is {duration:.1f}s and exceeds the {MAX_REFERENCE_SECONDS:.1f}s limit")
        words = len(transcript.read_text(encoding="utf-8-sig").split())
        words_per_minute = words / duration * 60 if duration else 0
        if words_per_minute < 80 or words_per_minute > 200:
            issues.append(f"transcript timing is implausible ({words_per_minute:.0f} words/minute)")
        audit = cached_reference_word_audit(reference, transcript)
        if audit and not audit.get("approved"):
            issues.append(
                "reference speech does not match its transcript "
                f"({float(audit.get('normalized_word_error_rate_percent', 0)):.1f}% word error)"
            )
        if issues:
            return {
                "health": "needs_attention",
                "health_label": "; ".join(issues) + "; re-record this voice",
                "selectable": False,
                "reference_duration_seconds": round(duration, 2),
                "reference_sha256": file_sha256(reference),
                "reference_transcript_sha256": file_sha256(transcript),
            }
        return {
            "health": "ready" if audit and audit.get("approved") else "unverified",
            "health_label": (
                "Reference duration and local transcript check passed"
                if audit and audit.get("approved")
                else "Reference structure passed; local transcript check runs before generation"
            ),
            "selectable": True,
            "reference_duration_seconds": round(duration, 2),
            "reference_sha256": file_sha256(reference),
            "reference_transcript_sha256": file_sha256(transcript),
        }
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError, PromptusVoiceError, sf.LibsndfileError):
        return unverified


def cloned_voice_metadata(flow: dict[str, Any]) -> dict[str, Any] | None:
    """Describe one installed fixed-reference F5 preset for the portal picker."""
    title = str(flow.get("title", "")).strip()
    if not title or str(flow.get("install_status", "")).upper() != "INSTALLED":
        return None
    tags = {str(tag).strip().casefold() for tag in flow.get("tags", [])}
    dependencies = {
        str(item).strip().casefold()
        for item in flow.get("custom_node_dependencies", [])
    }
    native_match = re.fullmatch(
        r"\(cosy\) Promptus: Local Voice (?P<name>.+?)(?: \[(?P<variant>[^\]]+)\])?",
        title,
    )
    legacy_f5 = (
        "comfyui-f5-tts" in dependencies
        and ("local voice" in tags or "f5-tts" in tags)
    )
    tagged_clone = "voice cloning" in tags and "comfyui-f5-tts" in dependencies
    if not native_match and not legacy_f5 and not tagged_clone:
        return None
    if title == "(cosy) Promptus: Audio F5TTS":
        return None

    native = native_match is not None
    if native_match:
        name = native_match.group("name").strip()
        variant = (native_match.group("variant") or "Basic").strip()
    else:
        name = re.sub(r"^\(cosy\)\s*", "", title).strip()
        bracket_suffix = re.search(r"\s+\[(?P<variant>[^\]]+)\]$", name)
        studio_suffix = re.search(r"\s+[—-]\s+F5 Studio$", name, flags=re.IGNORECASE)
        if bracket_suffix:
            variant = bracket_suffix.group("variant").strip()
            name = name[: bracket_suffix.start()].strip()
        elif studio_suffix:
            name = name[: studio_suffix.start()].strip()
            variant = "Studio"
        elif re.search(r"\s+-\s+Promptus F5-TTS$", name, flags=re.IGNORECASE):
            name = re.sub(r"\s+-\s+Promptus F5-TTS$", "", name, flags=re.IGNORECASE).strip()
            variant = "Basic"
        else:
            variant = "F5 preset"
    return {
        "title": title,
        "name": name,
        "variant": variant,
        "engine": "F5-TTS",
        "native": native,
        "legacy": not native,
        **installed_voice_health(title),
    }


@app.get("/api/voices")
def voices():
    """List reusable fixed-reference F5 voices already installed in Promptus."""
    try:
        values = [
            metadata
            for flow in get_cosyflows(DEFAULT_COSY_URL)
            if (metadata := cloned_voice_metadata(flow)) is not None
        ]
        values = list({value["title"]: value for value in values}.values())
        values.sort(
            key=lambda item: (
                item["name"].casefold(),
                item["variant"].casefold(),
                item["title"].casefold(),
            )
        )
        voice_count = len({value["name"].casefold() for value in values})
        return jsonify({
            "ok": True,
            "count": len(values),
            "voice_count": voice_count,
            "voices": values,
        })
    except PromptusVoiceError as exc:
        return fail(str(exc), 503)


@app.post("/api/reference")
def reference_upload():
    if "audio" not in request.files:
        return fail("No microphone recording received")
    automatic_transcript = request.form.get("automatic_transcript", "").casefold() == "true"
    transcript = request.form.get("transcript", "").strip()
    if not transcript and not automatic_transcript:
        return fail("The exact spoken transcript is required")
    if len(transcript) > 500:
        return fail("The reference transcript is too long")
    reference_id = str(uuid.uuid4())
    folder = safe_reference(reference_id)
    folder.mkdir(parents=True)
    original = folder / "recording.webm"
    decoded = folder / "decoded.wav"
    processed = folder / "reference.wav"
    request.files["audio"].save(original)
    try:
        decode_recording(original, decoded)
        metrics = trim_and_analyze(decoded, processed)
        transcript_path = folder / "reference.txt"
        if automatic_transcript:
            asr_report = transcribe_reference(processed, transcript_path)
            transcript = transcript_path.read_text(encoding="utf-8-sig").strip()
            if len(transcript) > 500:
                raise PromptusVoiceError("The automatically recognized reference is too long")
            metrics["transcript_source"] = "local_whisper"
            metrics["recognized_words"] = asr_report.get("recognized_words", 0)
        else:
            transcript_path.write_text(transcript + "\n", encoding="utf-8")
            asr_report = local_asr_report(processed, source=transcript_path)
            error_rate, word_ratio = word_accuracy_values(asr_report)
            if error_rate > MAX_REFERENCE_WORD_ERROR_PERCENT or not 0.75 <= word_ratio <= 1.25:
                raise PromptusVoiceError(
                    "The spoken reference does not match the displayed words closely enough "
                    f"({error_rate:.2f}% normalized word error; {word_ratio:.3f} word ratio). "
                    "Read the prompt exactly and record again."
                )
            metrics["transcript_source"] = "exact_user_text_verified_locally"
            metrics["normalized_word_error_rate_percent"] = round(error_rate, 2)
            metrics["recognized_word_ratio"] = round(word_ratio, 3)
        word_count = len(transcript.split())
        words_per_minute = word_count / metrics["duration_seconds"] * 60
        if words_per_minute < 80 or words_per_minute > 200:
            raise PromptusVoiceError(
                f"The transcript and audio timing do not agree ({words_per_minute:.0f} words/minute). "
                "Enter the exact words spoken or record the displayed prompt again."
            )
        metrics["words"] = word_count
        metrics["words_per_minute"] = round(words_per_minute, 1)
        metrics["accepted"] = True
        (folder / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
        original.unlink(missing_ok=True)
        decoded.unlink(missing_ok=True)
        return jsonify({"ok": True, "reference_id": reference_id, "metrics": metrics,
                        "transcript": transcript,
                        "audio_url": f"/api/reference/{reference_id}/audio"})
    except (PromptusVoiceError, OSError) as exc:
        shutil.rmtree(folder, ignore_errors=True)
        return fail(str(exc))


@app.get("/api/reference/<reference_id>/audio")
def reference_audio(reference_id: str):
    try:
        path = safe_reference(reference_id) / "reference.wav"
        if not path.is_file():
            return fail("Reference not found", 404)
        return send_file(path, mimetype="audio/wav", conditional=True)
    except PromptusVoiceError as exc:
        return fail(str(exc), 404)


@app.post("/api/install")
def install():
    data = request.get_json(silent=True) or {}
    if data.get("consent_confirmed") is not True:
        return fail("Confirm that this is your voice or you have explicit permission")
    voice_name = str(data.get("voice_name", "")).strip()
    if not voice_name:
        return fail("Voice name is required")
    if not GENERATION_SLOT.acquire(blocking=False):
        return fail("Promptus is busy with a voice job; wait before installing a preset", 429)
    try:
        basis = consent_basis(data)
        health_state = backend_health(include_portal_slot=False)
        if not health_state["accepting_jobs"]:
            return fail("Promptus is busy with another ComfyUI job; wait for the queue to clear", 429)
        folder = safe_reference(str(data.get("reference_id", "")))
        reference_audio = folder / "reference.wav"
        title, target = install_studio(
            voice_name=voice_name, reference_audio=reference_audio,
            reference_text_file=folder / "reference.txt", force=bool(data.get("replace")),
        )
        record_consent({
            "action": "install_voice",
            "outcome": "installed",
            "consent_basis": basis,
            "voice_name": voice_name,
            "model_title": title,
            "reference_sha256": file_sha256(reference_audio),
        })
        return jsonify({"ok": True, "model_title": title, "target": str(target), "consent_basis": basis})
    except (PromptusVoiceError, OSError) as exc:
        return fail(str(exc))
    finally:
        GENERATION_SLOT.release()


def update_job(job_id: str, **values: Any) -> None:
    snapshot: dict[str, Any] | None = None
    with JOBS_LOCK:
        if job_id in JOBS:
            JOBS[job_id].update(values)
            if set(values) != {"events"}:
                snapshot = dict(JOBS[job_id])
    if snapshot is not None:
        try:
            persist_job_history(snapshot)
        except OSError:
            # A history write must never conceal the authoritative live job state.
            pass


def prune_jobs(now: float | None = None) -> int:
    """Evict old completed jobs while preserving every active job."""
    timestamp = time.time() if now is None else now
    removed = 0
    removed_ids: list[str] = []
    with JOBS_LOCK:
        expired = [
            job_id
            for job_id, value in JOBS.items()
            if value.get("status") in TERMINAL_JOB_STATUSES
            and float(value.get("finished", timestamp)) < timestamp - JOB_RETENTION_SECONDS
        ]
        for job_id in expired:
            JOBS.pop(job_id, None)
            removed += 1
            removed_ids.append(job_id)
        if len(JOBS) > MAX_RETAINED_JOBS:
            finished = sorted(
                (
                    (float(value.get("finished", timestamp)), job_id)
                    for job_id, value in JOBS.items()
                    if value.get("status") in TERMINAL_JOB_STATUSES
                )
            )
            for _finished, job_id in finished[: max(0, len(JOBS) - MAX_RETAINED_JOBS)]:
                JOBS.pop(job_id, None)
                removed += 1
                removed_ids.append(job_id)
        active_ids = set(JOBS)
    cutoff = timestamp - JOB_RETENTION_SECONDS
    for folder in JOB_ROOT.iterdir():
        if not folder.is_dir() or folder.name in active_ids:
            continue
        try:
            expired_on_disk = folder.stat().st_mtime < cutoff
        except OSError:
            continue
        if folder.name in removed_ids or expired_on_disk:
            shutil.rmtree(folder, ignore_errors=True)
    history_cutoff = timestamp - HISTORY_RETENTION_SECONDS
    history_files = sorted(
        HISTORY_ROOT.glob("*.json"),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )
    for index, path in enumerate(history_files):
        try:
            if index >= MAX_RETAINED_HISTORY or path.stat().st_mtime < history_cutoff:
                path.unlink(missing_ok=True)
        except OSError:
            continue
    return removed


def prepare_narration(text: str) -> tuple[str, dict[str, Any]]:
    """Remove non-spoken Markdown and describe every automatic, word-preserving fix."""
    source = text.replace("\r\n", "\n").replace("\r", "\n")
    source = source.replace("\u200b", "").replace("\ufeff", "")
    prepared = source
    prepared = re.sub(r"(?m)^\s*```[^\n]*$", "", prepared)
    prepared = re.sub(r"(?m)^\s{0,3}#{1,6}\s+", "", prepared)
    prepared = re.sub(r"(?m)^\s{0,3}>\s?", "", prepared)
    prepared = re.sub(r"(?m)^\s{0,3}[-+*]\s+", "", prepared)
    prepared = prepared.replace("`", "")
    prepared = re.sub(r"(?<!\w)[*_]{1,3}(?=\S)", "", prepared)
    prepared = re.sub(r"(?<=\S)[*_]{1,3}(?!\w)", "", prepared)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in prepared.splitlines()]
    prepared = "\n".join(lines)
    prepared = re.sub(r"\n{3,}", "\n\n", prepared).strip()
    if speech_words(source) != speech_words(prepared):
        raise PromptusVoiceError(
            "Narration formatting could not be cleaned without changing its words. "
            "Paste plain speech text and try again."
        )
    source_fragments = len(
        [value for value in re.split(r"\n\s*\n+", source) if value.strip()]
    )
    fixes: list[str] = []
    if prepared != source.strip():
        fixes.append("Removed non-spoken Markdown and normalized pasted spacing")
    preflight = {
        "source_characters": len(source.strip()),
        "prepared_characters": len(prepared),
        "source_fragments": source_fragments,
        "formatting_cleaned": prepared != source.strip(),
        "auto_fixes": fixes,
    }
    return prepared, preflight


def split_narration(text: str, maximum: int = 900) -> list[str]:
    """Pack adjacent lines/paragraphs coherently, splitting only at the size ceiling."""
    if maximum < 20:
        raise ValueError("maximum narration chunk size is too small")
    blocks = [value.strip() for value in re.split(r"\n\s*\n+", text) if value.strip()]
    chunks: list[str] = []
    current = ""

    def append_piece(piece: str, separator: str) -> None:
        nonlocal current
        piece = piece.strip()
        if not piece:
            return
        if len(piece) > maximum:
            words = piece.split()
            if len(words) == 1:
                if current:
                    chunks.append(current)
                    current = ""
                chunks.extend(piece[index:index + maximum] for index in range(0, len(piece), maximum))
                return
            for word in words:
                append_piece(word, " ")
            return
        candidate = f"{current}{separator if current else ''}{piece}"
        if current and len(candidate) > maximum:
            chunks.append(current)
            current = piece
        else:
            current = candidate

    for block in blocks:
        if len(block) <= maximum:
            append_piece(block, "\n\n")
            continue
        units = [
            value.strip()
            for value in re.split(r"(?<=\n)|(?<=[.!?])(?=[ \t]+)", block)
            if value.strip()
        ]
        for unit in units:
            append_piece(unit, "\n" if "\n" in block else " ")
    if current:
        chunks.append(current)
    return chunks


def master_output(
    job_id: str, outputs: list[dict[str, Any]], *, revision: int | None = None
) -> dict[str, Any]:
    audio_parts: list[np.ndarray] = []
    sample_rate: int | None = None
    for detail in outputs:
        audio, rate = sf.read(detail["path"], dtype="float32", always_2d=True)
        mono = audio.mean(axis=1)
        if sample_rate is None:
            sample_rate = int(rate)
        if rate != sample_rate:
            raise PromptusVoiceError("Generated sections did not share one sample rate")
        audio_parts.append(trim_boundary_silence(mono, int(rate)))
    assert sample_rate is not None
    gap = np.zeros(int(sample_rate * 0.22), dtype=np.float32)
    master = np.concatenate([value for index, part in enumerate(audio_parts) for value in ((gap,) if index else ()) + (part,)])
    master -= float(np.mean(master))
    peak = float(np.max(np.abs(master)))
    if peak > 0.89:
        master *= 0.89 / peak
    root = comfy_root(promptus_root()) / "output" / "promptus_voice" / "Portal-Masters"
    root.mkdir(parents=True, exist_ok=True)
    suffix = f"-repair-{revision}" if revision is not None else ""
    path = root / f"{job_id}{suffix}.flac"
    sf.write(path, master, sample_rate, format="FLAC", subtype="PCM_16")
    detail = inspect_audio(path)
    detail["sections"] = len(outputs)
    return detail


def retryable_marginal_clipping(rejected: Any, controls: dict[str, Any]) -> bool:
    """Allow one fresh random take for a tiny, clipping-only signal rejection.

    F5 is stochastic when seed is -1. A new take can remove a handful of saturated samples, but
    retrying a fixed seed would reproduce the same file. Other quality failures and substantial
    clipping remain hard failures, and every retried output must still pass the unchanged gate.
    """
    if controls.get("seed", -1) != -1 or not isinstance(rejected, dict):
        return False
    if rejected.get("quality_flags") != ["clipping"]:
        return False
    try:
        clipping = float(rejected["clipping_percent"])
    except (KeyError, TypeError, ValueError):
        return False
    return 0.01 < clipping <= MARGINAL_CLIPPING_RETRY_MAX_PERCENT


def execute_section_attempt(
    command: list[str], events: list[Any], job_id: str
) -> tuple[int, list[dict[str, Any]], dict[str, Any] | None]:
    """Run one Promptus generation attempt and retain structured verifier evidence."""
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    section_outputs: list[dict[str, Any]] = []
    rejected_output: dict[str, Any] | None = None
    assert process.stdout is not None
    for line in process.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
            events.append(event)
            if isinstance(event, dict) and isinstance(event.get("comfy_prompt_id"), str):
                prompt_id = event["comfy_prompt_id"]
                if re.fullmatch(r"[A-Za-z0-9_-]{8,128}", prompt_id):
                    with JOBS_LOCK:
                        prompt_ids = list(JOBS.get(job_id, {}).get("comfy_prompt_ids", []))
                    if prompt_id not in prompt_ids:
                        prompt_ids.append(prompt_id)
                        update_job(job_id, comfy_prompt_ids=prompt_ids[-100:])
            if isinstance(event, dict) and event.get("verified_outputs"):
                section_outputs = event["verified_outputs"]
            if isinstance(event, dict) and isinstance(event.get("rejected_output"), dict):
                rejected_output = event["rejected_output"]
        except json.JSONDecodeError:
            events.append({"message": line})
        update_job(job_id, events=events[-30:])
    return process.wait(), section_outputs, rejected_output


def run_generation(job_id: str, model_title: str, narration: str, controls: dict[str, Any]) -> None:
    current_stage = "preflight"
    try:
        job_dir = JOB_ROOT / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        sections = split_narration(narration)
        if not sections:
            update_job(
                job_id,
                status="failed",
                qa_status="not_run",
                issue={
                    "code": "empty_narration",
                    "category": "input",
                    "stage": "preflight",
                    "message": "Narration was empty after speech-text preparation.",
                    "retryable": True,
                    "recovery": "Enter the words to speak and try again.",
                },
                error="Narration was empty after speech-text preparation.",
                finished=time.time(),
            )
            return
        with JOBS_LOCK:
            existing = dict(JOBS.get(job_id, {}))
        preflight = dict(existing.get("preflight") or {})
        preflight["render_sections"] = len(sections)
        fixes = list(preflight.get("auto_fixes") or [])
        source_fragments = int(preflight.get("source_fragments", len(sections)) or 0)
        if source_fragments > len(sections):
            fixes.append(
                f"Grouped {source_fragments} short pasted fragments into {len(sections)} coherent render sections"
            )
        preflight["auto_fixes"] = list(dict.fromkeys(fixes))
        timeline: list[dict[str, Any]] = [{
            "stage": "Narration preflight",
            "status": "approved",
            "sections": len(sections),
            "auto_fixes": preflight["auto_fixes"],
        }]
        update_job(
            job_id,
            status="running",
            qa_status="running",
            started=time.time(),
            section_count=len(sections),
            preflight=preflight,
            timeline=timeline,
            events=[],
        )
        events: list[Any] = []
        master_source = job_dir / "narration-master.txt"
        master_source.write_text(narration, encoding="utf-8")
        with JOBS_LOCK:
            current_job = dict(JOBS.get(job_id, {}))
        fingerprint = generation_fingerprint(current_job)
        if fingerprint is not None:
            current_stage = "prior_master_revalidation"
            checking_prior = {
                "stage": "Automatic recovery",
                "status": "checking an exact prior fixed-seed master",
            }
            events.append(checking_prior)
            timeline.append(checking_prior)
            update_job(
                job_id,
                events=events[-30:],
                timeline=timeline,
                repair_state={
                    "status": "checking",
                    "strategy": "revalidate_exact_fixed_seed_master",
                    "trigger_code": "exact_render_fingerprint",
                    "rounds_used": 0,
                    "max_rounds": MAX_AUTOMATIC_REPAIR_ROUNDS,
                    "sections_checked": 0,
                    "sections_repaired": 0,
                    "fingerprint": fingerprint,
                    "attempts": [],
                },
            )
            recovered = recover_prior_verified_output(current_job, master_source)
            if recovered is not None:
                resolved = {
                    "stage": "Automatic recovery",
                    "status": "reused a revalidated exact fixed-seed master",
                }
                events.append(resolved)
                timeline.append(resolved)
                update_job(
                    job_id,
                    status="complete",
                    qa_status="passed",
                    outputs=[recovered],
                    diagnostic_outputs=[],
                    section_outputs=[],
                    events=events[-30:],
                    timeline=timeline,
                    repair_state={
                        "status": "resolved",
                        "strategy": "revalidate_exact_fixed_seed_master",
                        "trigger_code": "exact_render_fingerprint",
                        "rounds_used": 0,
                        "max_rounds": MAX_AUTOMATIC_REPAIR_ROUNDS,
                        "sections_checked": 0,
                        "sections_repaired": 0,
                        "prior_output_sha256": recovered.get("recovered_from_sha256"),
                        "fingerprint": fingerprint,
                        "word_verifier_strategy": recovered.get("word_verifier_strategy"),
                        "attempts": [],
                    },
                    finished=time.time(),
                )
                return
            timeline.append({
                "stage": "Automatic recovery",
                "status": "no exact prior master passed revalidation; rendering a new take",
            })
            update_job(
                job_id,
                events=events[-30:],
                timeline=timeline,
                repair_state={
                    "status": "not_reused",
                    "strategy": "revalidate_exact_fixed_seed_master",
                    "trigger_code": "exact_render_fingerprint",
                    "rounds_used": 0,
                    "max_rounds": MAX_AUTOMATIC_REPAIR_ROUNDS,
                    "sections_checked": [],
                    "sections_repaired": [],
                    "fingerprint": fingerprint,
                    "attempts": [],
                },
            )
        outputs: list[dict[str, Any]] = []
        section_records: list[dict[str, Any]] = []
        for index, section in enumerate(sections, start=1):
            current_stage = f"section_{index}"
            text_file = job_dir / f"narration-{index:03d}.txt"
            text_file.write_text(section, encoding="utf-8")
            command = [
                sys.executable, "-u", str(SCRIPTS / "test_promptus_voice.py"),
                "--model-title", model_title, "--text-file", str(text_file),
                "--consent-confirmed", "--timeout", "1800", "--heartbeat-seconds", "5",
                "--speed", str(controls["speed"]), "--seed", str(controls.get("seed", -1)),
            ]
            for name in ("nfe_step", "cfg_strength", "cross_fade_duration", "sway_sampling_coef", "speed_type"):
                command.extend(["--" + name.replace("_", "-"), str(controls[name])])
            section_outputs: list[dict[str, Any]] = []
            for attempt in (1, 2):
                submitted = {
                    "stage": f"Section {index} of {len(sections)}",
                    "status": "submitted" if attempt == 1 else "fresh take submitted",
                    "attempt": attempt,
                }
                events.append(submitted)
                timeline.append(submitted)
                update_job(
                    job_id,
                    events=events[-30:],
                    timeline=timeline,
                    section=index,
                    section_count=len(sections),
                )
                code, section_outputs, rejected_output = execute_section_attempt(
                    command, events, job_id
                )
                if code == 0 and section_outputs:
                    if attempt == 2:
                        approved_after_retry = {
                            "stage": f"Section {index} of {len(sections)}",
                            "status": "approved after fresh take",
                            "attempt": attempt,
                        }
                        events.append(approved_after_retry)
                        timeline.append(approved_after_retry)
                    else:
                        timeline.append({
                            "stage": f"Section {index} of {len(sections)}",
                            "status": "signal checks passed",
                            "attempt": attempt,
                        })
                    update_job(job_id, events=events[-30:], timeline=timeline)
                    break
                if attempt == 1 and retryable_marginal_clipping(rejected_output, controls):
                    retry_event = {
                        "stage": f"Section {index} of {len(sections)}",
                        "status": "marginal peak detected; rendering one fresh take",
                        "attempt": 2,
                        "rejected_output": rejected_output,
                    }
                    events.append(retry_event)
                    timeline.append({key: value for key, value in retry_event.items() if key != "rejected_output"})
                    update_job(job_id, events=events[-30:], timeline=timeline)
                    continue
                message = next(
                    (
                        e.get("message")
                        for e in reversed(events)
                        if isinstance(e, dict) and e.get("message", "").startswith("ERROR:")
                    ),
                    f"Section {index} failed",
                )
                signal_rejection = isinstance(rejected_output, dict)
                flags = list(rejected_output.get("quality_flags", [])) if signal_rejection else []
                issue = {
                    "code": "signal_quality_rejected" if signal_rejection else "backend_execution",
                    "category": "quality" if signal_rejection else "backend",
                    "stage": current_stage,
                    "message": (
                        f"Section {index} was rejected by the signal checks ({', '.join(flags)})."
                        if signal_rejection
                        else message.removeprefix("ERROR: ")
                    ),
                    "retryable": True,
                    "recovery": (
                        "Try one fresh take. If the same signal issue returns, repair the reference or settings."
                        if signal_rejection
                        else "Run Local diagnostics, resolve the live Promptus finding, then retry this section."
                    ),
                }
                timeline.append({
                    "stage": f"Section {index} of {len(sections)}",
                    "status": "rejected" if signal_rejection else "failed",
                    "issue_code": issue["code"],
                })
                update_job(
                    job_id,
                    status="rejected" if signal_rejection else "failed",
                    qa_status="rejected" if signal_rejection else "not_completed",
                    issue=issue,
                    error=issue["message"],
                    timeline=timeline,
                    diagnostic_outputs=[rejected_output] if signal_rejection else [],
                    section_outputs=outputs,
                    finished=time.time(),
                )
                return
            outputs.extend(section_outputs)
            section_records.append({
                "section": index,
                "source": text_file,
                "outputs": list(section_outputs),
                "command": list(command),
            })
        current_stage = "master_signal_check"
        final_output = master_output(job_id, outputs)
        path = Path(final_output["path"]).resolve()
        relative = path.relative_to((comfy_root(promptus_root()) / "output").resolve()).as_posix()
        final_output["audio_url"] = "/api/output/" + relative
        final_output["delivery_approved"] = False
        final_output["artifact_role"] = "unapproved_master"
        if final_output.get("quality_flags"):
            issue = {
                "code": "master_signal_quality_rejected",
                "category": "quality",
                "stage": current_stage,
                "message": "The assembled master failed the signal checks ("
                + ", ".join(final_output["quality_flags"])
                + ").",
                "retryable": True,
                "recovery": "Repair the flagged section or reference, then rebuild the master.",
            }
            timeline.append({
                "stage": "Master signal check",
                "status": "rejected",
                "quality_flags": final_output["quality_flags"],
            })
            update_job(
                job_id,
                status="rejected",
                qa_status="rejected",
                issue=issue,
                error=issue["message"],
                timeline=timeline,
                diagnostic_outputs=[final_output],
                section_outputs=outputs,
                finished=time.time(),
            )
            return
        current_stage = "master_word_check"
        checking = {"stage": "Master word check", "status": "checking intended words locally"}
        events.append(checking)
        timeline.append(checking)
        update_job(job_id, events=events[-30:], timeline=timeline)
        word_report = verify_narration_words(path, master_source)
        _apply_word_evidence(final_output, word_report, mode="master_native_long_form")
        if not word_report["word_accuracy_approved"]:
            timeline.append({
                "stage": "Master word check",
                "status": "needs localization; checking saved sections automatically",
                "normalized_word_error_rate_percent": word_report[
                    "normalized_word_error_rate_percent"
                ],
                "recognized_word_ratio": word_report["recognized_word_ratio"],
            })
            repair_state: dict[str, Any] = {
                "status": "checking",
                "strategy": "localized_section_word_repair",
                "trigger_code": str(word_report.get("issue", {}).get("code", "word_accuracy_rejected")),
                "rounds_used": 0,
                "max_rounds": MAX_AUTOMATIC_REPAIR_ROUNDS,
                "sections_checked": [],
                "sections_repaired": [],
                "word_verifier_strategy": word_report.get("word_verifier_strategy"),
                "master_disagreement": False,
                "attempts": [],
            }
            update_job(job_id, timeline=timeline, repair_state=repair_state)
            section_reports: list[dict[str, Any]] = []
            failed_records: list[dict[str, Any]] = []
            localization_issue: dict[str, Any] | None = None
            for record in section_records:
                section_number = int(record["section"])
                repair_state["sections_checked"].append(section_number)
                if len(record["outputs"]) != 1:
                    localization_issue = {
                        "code": "section_output_ambiguous",
                        "category": "verification",
                        "stage": "section_word_check",
                        "message": f"Section {section_number} produced an unexpected number of audio files.",
                        "retryable": True,
                        "recovery": "Keep the output quarantined and run Local diagnostics before trying again.",
                    }
                    break
                report = verify_narration_words(
                    Path(record["outputs"][0]["path"]), Path(record["source"])
                )
                record["word_report"] = report
                section_reports.append(report)
                timeline.append({
                    "stage": f"Section {section_number} word check",
                    "status": "approved" if report.get("word_accuracy_approved") else "needs one repair take",
                    "normalized_word_error_rate_percent": report.get(
                        "normalized_word_error_rate_percent"
                    ),
                    "recognized_word_ratio": report.get("recognized_word_ratio"),
                })
                if report.get("word_accuracy_approved") is not True:
                    failed_records.append(record)

            aggregate_report: dict[str, Any] | None = None
            if localization_issue is None:
                aggregate_report = aggregate_section_word_reports(section_reports)
            if aggregate_report is not None and aggregate_report.get("word_accuracy_approved") is True:
                repair_state.update({
                    "status": "resolved",
                    "strategy": "verified_section_ledger",
                    "master_disagreement": True,
                })
                word_report = aggregate_report
                _apply_word_evidence(
                    final_output, word_report, mode="verified_section_ledger_after_master_disagreement"
                )
                timeline.append({
                    "stage": "Automatic recovery",
                    "status": "approved from independently verified sections",
                    "normalized_word_error_rate_percent": word_report[
                        "normalized_word_error_rate_percent"
                    ],
                })
            elif (
                localization_issue is None
                and 0 < len(failed_records) <= MAX_AUTOMATIC_SECTION_REPAIRS
            ):
                repair_state["status"] = "repairing"
                repair_state["rounds_used"] = 1
                repair_failed_issue: dict[str, Any] | None = None
                with JOBS_LOCK:
                    narration_hash = str(JOBS.get(job_id, {}).get("narration_sha256", ""))
                for record in failed_records:
                    section_number = int(record["section"])
                    original_output = record["outputs"][0]
                    effective_seed = derive_repair_seed(
                        int(controls.get("seed", -1)), narration_hash, section_number, 1
                    )
                    repair_command = list(record["command"])
                    repair_command[repair_command.index("--seed") + 1] = str(effective_seed)
                    repairing = {
                        "stage": f"Section {section_number} automatic repair",
                        "status": "rendering one alternate take with unchanged direction",
                        "attempt": 1,
                    }
                    events.append(repairing)
                    timeline.append(repairing)
                    update_job(
                        job_id,
                        events=events[-30:],
                        timeline=timeline,
                        repair_state=repair_state,
                    )
                    code, replacement_outputs, rejected_output = execute_section_attempt(
                        repair_command, events, job_id
                    )
                    attempt: dict[str, Any] = {
                        "section": section_number,
                        "attempt": 1,
                        "reason": "word_accuracy",
                        "original_seed": int(controls.get("seed", -1)),
                        "effective_seed": effective_seed,
                        "source_sha256": file_sha256(Path(record["source"])),
                        "rejected_output_sha256": original_output.get("sha256"),
                    }
                    if code != 0 or len(replacement_outputs) != 1:
                        attempt["outcome"] = "backend_failed"
                        repair_state["attempts"].append(attempt)
                        repair_failed_issue = {
                            "code": "automatic_section_repair_failed",
                            "category": "backend" if rejected_output is None else "quality",
                            "stage": f"section_{section_number}_repair",
                            "message": f"The one automatic repair take for section {section_number} did not complete cleanly.",
                            "retryable": True,
                            "recovery": "The original and repair candidates remain quarantined. Run Local diagnostics, then retry unchanged.",
                        }
                        break
                    replacement = replacement_outputs[0]
                    replacement_report = verify_narration_words(
                        Path(replacement["path"]), Path(record["source"])
                    )
                    attempt.update({
                        "replacement_output_sha256": replacement.get("sha256"),
                        "normalized_reference_words": replacement_report.get(
                            "normalized_reference_words"
                        ),
                        "normalized_recognized_words": replacement_report.get(
                            "normalized_recognized_words"
                        ),
                        "normalized_edit_distance": replacement_report.get(
                            "normalized_edit_distance"
                        ),
                        "normalized_word_error_rate_percent": replacement_report.get(
                            "normalized_word_error_rate_percent"
                        ),
                        "recognized_word_ratio": replacement_report.get("recognized_word_ratio"),
                        "word_accuracy_approved": replacement_report.get(
                            "word_accuracy_approved"
                        ) is True,
                        "outcome": "approved" if replacement_report.get("word_accuracy_approved") else "rejected",
                    })
                    repair_state["attempts"].append(attempt)
                    if replacement_report.get("word_accuracy_approved") is not True:
                        repair_failed_issue = dict(replacement_report.get("issue") or {})
                        repair_failed_issue.update({
                            "code": "automatic_section_repair_rejected",
                            "stage": f"section_{section_number}_repair",
                            "message": f"Section {section_number} still failed the word check after its one automatic repair take.",
                            "retryable": True,
                            "recovery": "The candidates remain quarantined. Retry unchanged once, then audit this voice only if a short control sentence also fails.",
                        })
                        break
                    record["outputs"] = [replacement]
                    record["word_report"] = replacement_report
                    repair_state["sections_repaired"].append(section_number)
                    timeline.append({
                        "stage": f"Section {section_number} automatic repair",
                        "status": "approved",
                        "normalized_word_error_rate_percent": replacement_report.get(
                            "normalized_word_error_rate_percent"
                        ),
                    })

                if repair_failed_issue is None:
                    repaired_outputs = [
                        detail for record in section_records for detail in record["outputs"]
                    ]
                    current_stage = "repaired_master_signal_check"
                    repaired_master = master_output(job_id, repaired_outputs, revision=1)
                    repaired_path = Path(repaired_master["path"]).resolve()
                    repaired_relative = repaired_path.relative_to(
                        (comfy_root(promptus_root()) / "output").resolve()
                    ).as_posix()
                    repaired_master.update({
                        "audio_url": "/api/output/" + repaired_relative,
                        "delivery_approved": False,
                        "artifact_role": "unapproved_master",
                        "repair_round": 1,
                    })
                    if repaired_master.get("quality_flags"):
                        repair_failed_issue = {
                            "code": "repaired_master_signal_quality_rejected",
                            "category": "quality",
                            "stage": current_stage,
                            "message": "The repaired master failed the unchanged signal checks ("
                            + ", ".join(repaired_master["quality_flags"])
                            + ").",
                            "retryable": True,
                            "recovery": "The repaired master remains quarantined. Review its section evidence before retrying.",
                        }
                    else:
                        current_stage = "repaired_master_word_check"
                        repaired_word_report = verify_narration_words(repaired_path, master_source)
                        _apply_word_evidence(
                            repaired_master,
                            repaired_word_report,
                            mode="repaired_master_native_long_form",
                        )
                        if repaired_word_report.get("word_accuracy_approved") is True:
                            final_output = repaired_master
                            outputs = repaired_outputs
                            word_report = repaired_word_report
                            path = repaired_path
                            repair_state["status"] = "resolved"
                            timeline.append({
                                "stage": "Automatic recovery",
                                "status": "repaired master approved",
                                "normalized_word_error_rate_percent": word_report[
                                    "normalized_word_error_rate_percent"
                                ],
                            })
                        else:
                            repair_failed_issue = dict(repaired_word_report.get("issue") or {})
                            repair_failed_issue.update({
                                "code": "repaired_master_word_accuracy_rejected",
                                "stage": current_stage,
                                "message": "The rebuilt master still failed the unchanged local word gate after one bounded repair round.",
                                "retryable": True,
                                "recovery": "All candidates remain quarantined. Retry unchanged or inspect the localized section evidence.",
                            })
                    if repair_failed_issue is not None:
                        final_output = repaired_master
                if repair_failed_issue is not None:
                    localization_issue = repair_failed_issue
            elif localization_issue is None:
                localization_issue = dict((aggregate_report or {}).get("issue") or word_report["issue"])
                localization_issue["message"] = (
                    "More sections failed the word check than the studio can repair safely in one bounded round."
                )
                localization_issue["recovery"] = (
                    "Keep this job quarantined and retry unchanged; do not lower the word-accuracy gate."
                )

            if repair_state.get("status") != "resolved":
                repair_state["status"] = "exhausted"
                issue = localization_issue or dict(word_report["issue"])
                timeline.append({
                    "stage": "Automatic recovery",
                    "status": "stopped after one bounded repair round",
                    "issue_code": issue.get("code"),
                })
                update_job(
                    job_id,
                    status="rejected",
                    qa_status="rejected",
                    issue=issue,
                    error=issue["message"],
                    timeline=timeline,
                    repair_state=repair_state,
                    diagnostic_outputs=[final_output],
                    section_outputs=outputs,
                    finished=time.time(),
                )
                return
        final_output["delivery_approved"] = True
        final_output["artifact_role"] = "verified_master"
        events.append({
            "stage": "Master word check",
            "status": "approved",
            "normalized_word_error_rate_percent": word_report[
                "normalized_word_error_rate_percent"
            ],
        })
        timeline.append({
            "stage": "Master word check",
            "status": "approved",
            "normalized_word_error_rate_percent": word_report[
                "normalized_word_error_rate_percent"
            ],
        })
        update_job(
            job_id,
            status="complete",
            qa_status="passed",
            outputs=[final_output],
            diagnostic_outputs=[],
            section_outputs=outputs,
            events=events[-30:],
            timeline=timeline,
            finished=time.time(),
        )
    except Exception as exc:
        message = str(exc) or type(exc).__name__
        issue_code = "verifier_failure" if "verifier" in message.casefold() else "unexpected_failure"
        update_job(
            job_id,
            status="failed",
            qa_status="not_completed",
            issue={
                "code": issue_code,
                "category": "verification" if issue_code == "verifier_failure" else "system",
                "stage": current_stage,
                "message": message,
                "retryable": True,
                "recovery": "Review Recent local jobs, run Local diagnostics, and retry only after Promptus reports the affected service ready.",
            },
            error=message,
            finished=time.time(),
        )
    finally:
        with JOBS_LOCK:
            audit_job = dict(JOBS.get(job_id, {}))
        if audit_job.get("status") in TERMINAL_JOB_STATUSES:
            output = (
                audit_job.get("outputs")
                or audit_job.get("diagnostic_outputs")
                or [{}]
            )[0]
            try:
                record_consent({
                    "action": "generate_voice_result",
                    "outcome": audit_job.get("status"),
                    "job_id": job_id,
                    "consent_basis": audit_job.get("consent_basis"),
                    "model_title": audit_job.get("model_title"),
                    "narration_sha256": audit_job.get("narration_sha256"),
                    "style": audit_job.get("style"),
                    "controls_modified": audit_job.get("controls_modified", False),
                    "controls": audit_job.get("controls"),
                    "reference_sha256": audit_job.get("reference_sha256"),
                    "reference_transcript_sha256": audit_job.get("reference_transcript_sha256"),
                    "output_sha256": output.get("sha256"),
                    "quality_flags": output.get("quality_flags"),
                    "duration_seconds": output.get("duration_seconds"),
                    "peak_dbfs": output.get("peak_dbfs"),
                    "rms_dbfs": output.get("rms_dbfs"),
                    "clipping_percent": output.get("clipping_percent"),
                    "silence_percent": output.get("silence_percent"),
                    "dc_offset": output.get("dc_offset"),
                    "possible_clicks_percent": output.get("possible_clicks_percent"),
                    "normalized_word_error_rate_percent": output.get(
                        "normalized_word_error_rate_percent"
                    ),
                    "recognized_word_ratio": output.get("recognized_word_ratio"),
                    "word_verifier_strategy": output.get("word_verifier_strategy"),
                    "word_verification_mode": output.get("word_verification_mode"),
                    "repair_state": _safe_repair_state(audit_job.get("repair_state")),
                    "section_count": audit_job.get("section_count"),
                    "started": audit_job.get("started"),
                    "finished": audit_job.get("finished"),
                    "issue": audit_job.get("issue"),
                    "error": audit_job.get("error"),
                })
            except OSError:
                pass
        GENERATION_SLOT.release()
        prune_jobs()


def generation_controls(style: str, supplied: Any) -> dict[str, Any]:
    if style not in STYLE_PRESETS:
        raise PromptusVoiceError(
            f"Unknown performance style {style!r}; choose {', '.join(STYLE_PRESETS)}"
        )
    controls = dict(STYLE_PRESETS[style])
    if supplied is not None and not isinstance(supplied, dict):
        raise PromptusVoiceError("Advanced controls must be an object")
    supplied = supplied or {}
    numeric_ranges = {
        "speed": (0.75, 1.35),
        "nfe_step": (8, 64),
        "cfg_strength": (1.0, 3.0),
        "cross_fade_duration": (0.0, 0.35),
        "sway_sampling_coef": (-3.0, 1.0),
    }
    for name, (minimum, maximum) in numeric_ranges.items():
        if name not in supplied:
            continue
        try:
            value = float(supplied[name])
        except (TypeError, ValueError) as exc:
            raise PromptusVoiceError(f"{name} must be numeric") from exc
        if not minimum <= value <= maximum:
            raise PromptusVoiceError(f"{name} must be between {minimum} and {maximum}")
        controls[name] = int(value) if name == "nfe_step" else value
    speed_type = str(supplied.get("speed_type", controls["speed_type"]))
    if speed_type == "TDHS":
        raise PromptusVoiceError(
            "TDHS is disabled: ComfyUI-F5-TTS 1.0.26 can return unscaled samples and severely clip the output."
        )
    if speed_type not in {"F5TTS", "torch-time-stretch"}:
        raise PromptusVoiceError(
            "Unsupported tempo method; choose native F5 timing or torch time stretch"
        )
    controls["speed_type"] = speed_type
    return controls


def parse_seed(value: Any) -> int:
    if isinstance(value, bool):
        raise PromptusVoiceError("Seed must be a whole number from -1 upward")
    if isinstance(value, int):
        seed = value
    elif isinstance(value, str) and re.fullmatch(r"-?\d+", value.strip()):
        seed = int(value)
    else:
        raise PromptusVoiceError("Seed must be a whole number from -1 upward")
    if not -1 <= seed <= 2**63 - 1:
        raise PromptusVoiceError("Seed must be between -1 and 9223372036854775807")
    return seed


def reverify_quarantined_master(job_id: str) -> None:
    """Re-evaluate one legacy word rejection with the current verifier, never by heuristic."""
    try:
        with JOBS_LOCK:
            record = dict(JOBS.get(job_id, {}))
        source = JOB_ROOT / job_id / "narration-master.txt"
        if not source.is_file():
            raise PromptusVoiceError(
                "The private source text has expired, so this saved render cannot be reverified safely."
            )
        source_text = source.read_text(encoding="utf-8-sig")
        normalized_source_hash = hashlib.sha256(source_text.encode("utf-8")).hexdigest()
        if normalized_source_hash != record.get("narration_sha256"):
            raise PromptusVoiceError("The saved narration no longer matches its recorded hash.")
        diagnostic = next(
            (
                item for item in record.get("diagnostic_outputs", [])
                if isinstance(item, dict) and isinstance(item.get("sha256"), str)
            ),
            None,
        )
        if diagnostic is None:
            raise PromptusVoiceError("No quarantined master evidence is available for rechecking.")
        output_root = (comfy_root(promptus_root()) / "output").resolve()
        path = (
            output_root / "promptus_voice" / "Portal-Masters" / f"{job_id}.flac"
        ).resolve()
        approved_root = (output_root / "promptus_voice").resolve()
        if approved_root not in path.parents or not path.is_file():
            raise PromptusVoiceError("The quarantined master is no longer available.")
        if file_sha256(path) != diagnostic.get("sha256"):
            raise PromptusVoiceError("The quarantined master no longer matches its recorded hash.")

        timeline = list(record.get("timeline") or [])
        timeline.append({
            "stage": "Automatic recovery",
            "status": "rechecking saved signal and words with the current native verifier",
        })
        repair_state = {
            "status": "checking",
            "strategy": "historical_native_master_reverification",
            "trigger_code": str(record.get("issue", {}).get("code", "legacy_word_rejection")),
            "rounds_used": 0,
            "max_rounds": 0,
            "sections_checked": [],
            "sections_repaired": [],
            "attempts": [],
        }
        update_job(job_id, timeline=timeline, repair_state=repair_state)
        detail = verify_audio(path)
        report = verify_narration_words(path, source)
        _apply_word_evidence(detail, report, mode="historical_master_native_reverification")
        relative = path.relative_to(output_root).as_posix()
        if report.get("word_accuracy_approved") is not True:
            issue = dict(report.get("issue") or {})
            issue.update({
                "code": "historical_master_still_rejected",
                "stage": "historical_master_word_check",
                "message": "The saved master still failed the unchanged word gate under the current verifier.",
                "retryable": True,
                "recovery": "Keep it quarantined and use Retry unchanged; do not lower the gate.",
            })
            repair_state.update({
                "status": "exhausted",
                "word_verifier_strategy": report.get("word_verifier_strategy"),
            })
            timeline.append({
                "stage": "Automatic recovery",
                "status": "saved master remains quarantined",
                "normalized_word_error_rate_percent": report.get(
                    "normalized_word_error_rate_percent"
                ),
            })
            detail.update({
                "delivery_approved": False,
                "artifact_role": "unapproved_master",
            })
            update_job(
                job_id,
                status="rejected",
                qa_status="rejected",
                issue=issue,
                error=issue["message"],
                timeline=timeline,
                repair_state=repair_state,
                outputs=[],
                diagnostic_outputs=[detail],
                finished=time.time(),
            )
            return

        detail.update({
            "audio_url": "/api/output/" + relative,
            "delivery_approved": True,
            "artifact_role": "verified_master",
            "sections": diagnostic.get("sections"),
            "recovered_from_sha256": diagnostic.get("sha256"),
        })
        repair_state.update({
            "status": "resolved",
            "prior_output_sha256": diagnostic.get("sha256"),
            "word_verifier_strategy": report.get("word_verifier_strategy"),
        })
        timeline.append({
            "stage": "Automatic recovery",
            "status": "saved master approved by the current native verifier",
            "normalized_word_error_rate_percent": report.get(
                "normalized_word_error_rate_percent"
            ),
        })
        update_job(
            job_id,
            status="complete",
            qa_status="passed",
            issue={},
            error=None,
            timeline=timeline,
            repair_state=repair_state,
            outputs=[detail],
            diagnostic_outputs=[],
            finished=time.time(),
        )
        try:
            record_consent({
                "action": "reverify_quarantined_voice_result",
                "outcome": "complete",
                "job_id": job_id,
                "consent_basis": record.get("consent_basis"),
                "model_title": record.get("model_title"),
                "narration_sha256": record.get("narration_sha256"),
                "reference_sha256": record.get("reference_sha256"),
                "reference_transcript_sha256": record.get("reference_transcript_sha256"),
                "output_sha256": detail.get("sha256"),
                "normalized_word_error_rate_percent": detail.get(
                    "normalized_word_error_rate_percent"
                ),
                "word_verifier_strategy": detail.get("word_verifier_strategy"),
            })
        except OSError:
            pass
    except (OSError, PromptusVoiceError) as exc:
        with JOBS_LOCK:
            record = dict(JOBS.get(job_id, {}))
        timeline = list(record.get("timeline") or [])
        issue = {
            "code": "historical_reverification_unavailable",
            "category": "verification",
            "stage": "historical_master_reverification",
            "message": str(exc),
            "retryable": True,
            "recovery": "Use Retry unchanged to create a new fully verified job.",
        }
        timeline.append({
            "stage": "Automatic recovery",
            "status": "saved master could not be reverified safely",
            "issue_code": issue["code"],
        })
        update_job(
            job_id,
            status="rejected",
            qa_status="rejected",
            issue=issue,
            error=issue["message"],
            timeline=timeline,
            repair_state={
                "status": "exhausted",
                "strategy": "historical_native_master_reverification",
                "trigger_code": issue["code"],
                "rounds_used": 0,
                "max_rounds": 0,
                "sections_checked": [],
                "sections_repaired": [],
                "attempts": [],
            },
            finished=time.time(),
        )
    finally:
        GENERATION_SLOT.release()


@app.post("/api/generate")
def generate():
    prune_jobs()
    data = request.get_json(silent=True) or {}
    if data.get("consent_confirmed") is not True:
        return fail("Consent confirmation is required")
    model_title = str(data.get("model_title", "")).strip()
    source_narration = str(data.get("narration", "")).strip()
    if not model_title or not source_narration:
        return fail("Model and narration are required")
    if not any(character.isalnum() for character in source_narration):
        return fail("Narration must contain words, not punctuation alone")
    if len(source_narration) > 12000:
        return fail("Narration is too long for one local job; split it into chapters")
    style = str(data.get("style", "poetic"))
    try:
        basis = consent_basis(data)
        controls = generation_controls(style, data.get("controls"))
        controls["seed"] = parse_seed(data.get("seed", -1))
        narration, preflight = prepare_narration(source_narration)
    except PromptusVoiceError as exc:
        return fail(str(exc))
    if not GENERATION_SLOT.acquire(blocking=False):
        return fail("A Promptus voice generation is already running; wait for it to finish", 429)
    try:
        health_state = backend_health(include_portal_slot=False)
        if not health_state["accepting_jobs"]:
            GENERATION_SLOT.release()
            return fail(
                "Promptus is busy with another ComfyUI job; wait for the queue to clear",
                429,
            )
    except PromptusVoiceError as exc:
        GENERATION_SLOT.release()
        return fail(str(exc), 503)
    try:
        selected = next(
            (flow for flow in get_cosyflows(DEFAULT_COSY_URL) if str(flow.get("title", "")).strip() == model_title),
            None,
        )
        if selected is None:
            GENERATION_SLOT.release()
            return fail("The selected installed voice is no longer available; refresh voices", 404)
        selected_metadata = cloned_voice_metadata(selected)
        if selected_metadata is None:
            GENERATION_SLOT.release()
            return fail("The selected model is not a fixed-reference F5 voice", 409)
        if selected_metadata.get("selectable") is False:
            GENERATION_SLOT.release()
            return fail(
                f"This voice needs attention before generation: {selected_metadata.get('health_label')}",
                409,
            )
        reference_audit = ensure_reference_word_audit(model_title)
        if not reference_audit.get("approved"):
            GENERATION_SLOT.release()
            return fail(
                "This voice needs re-recording: its installed reference speech does not match "
                "the sidecar transcript "
                f"({float(reference_audit.get('normalized_word_error_rate_percent', 0)):.2f}% word error; "
                f"{float(reference_audit.get('recognized_word_ratio', 0)):.3f} word ratio).",
                409,
            )
    except PromptusVoiceError as exc:
        GENERATION_SLOT.release()
        return fail(str(exc), 503)
    job_id = secrets.token_hex(12)
    narration_sha256 = hashlib.sha256(narration.encode("utf-8")).hexdigest()
    source_narration_sha256 = hashlib.sha256(source_narration.encode("utf-8")).hexdigest()
    controls_modified = bool(data.get("controls_modified"))
    created = time.time()
    with JOBS_LOCK:
        JOBS[job_id] = {
            "id": job_id,
            "status": "queued",
            "qa_status": "not_run",
            "created": created,
            "portal_run_id": PORTAL_RUN_ID,
            "events": [],
            "timeline": [{"stage": "Submission", "status": "accepted"}],
            "controls": controls,
            "model_title": model_title,
            "voice_name": selected_metadata.get("name"),
            "style": style,
            "controls_modified": controls_modified,
            "consent_basis": basis,
            "narration_sha256": narration_sha256,
            "source_narration_sha256": source_narration_sha256,
            "narration_characters": len(narration),
            "source_narration_characters": len(source_narration),
            "preflight": preflight,
            "reference_sha256": reference_audit.get("reference_sha256"),
            "reference_transcript_sha256": reference_audit.get("transcript_sha256"),
            "reference_duration_seconds": selected_metadata.get("reference_duration_seconds"),
        }
        initial_job = dict(JOBS[job_id])
    try:
        persist_job_history(initial_job)
        record_consent({
            "action": "generate_voice",
            "outcome": "accepted_for_submission",
            "job_id": job_id,
            "consent_basis": basis,
            "model_title": model_title,
            "narration_sha256": narration_sha256,
            "source_narration_sha256": source_narration_sha256,
            "style": style,
            "controls_modified": controls_modified,
            "controls": controls,
            "preflight": preflight,
            "reference_sha256": reference_audit.get("reference_sha256"),
            "reference_transcript_sha256": reference_audit.get("transcript_sha256"),
        })
        threading.Thread(
            target=run_generation,
            args=(job_id, model_title, narration, controls),
            daemon=True,
        ).start()
    except Exception as exc:
        with JOBS_LOCK:
            JOBS.pop(job_id, None)
        GENERATION_SLOT.release()
        return fail(f"Could not record or start the local voice job: {exc}", 500)
    return jsonify({"ok": True, "job_id": job_id, "controls": controls, "preflight": preflight})


@app.get("/api/jobs/<job_id>")
def job(job_id: str):
    prune_jobs()
    with JOBS_LOCK:
        value = JOBS.get(job_id)
        live = dict(value) if value else None
    if live:
        return jsonify({"ok": True, "job": public_job_snapshot(live), "source": "live"})
    backfill_legacy_history()
    historic = read_job_history(job_id)
    return (
        jsonify({"ok": True, "job": public_job_snapshot(historic), "source": "history"})
        if historic
        else fail("Job not found", 404)
    )


@app.post("/api/jobs/<job_id>/reverify")
def reverify_job(job_id: str):
    """Repair only legacy master-word decisions that can still be proven from local evidence."""
    if not re.fullmatch(r"[0-9a-f]{24}", job_id):
        return fail("Job not found", 404)
    with JOBS_LOCK:
        value = dict(JOBS.get(job_id, {}))
    if not value:
        value = read_job_history(job_id) or {}
    if value.get("status") != "rejected":
        return fail("Only a quarantined rejected job can be reverified", 409)
    issue = value.get("issue") if isinstance(value.get("issue"), dict) else {}
    diagnostic = next(
        (item for item in value.get("diagnostic_outputs", []) if isinstance(item, dict)),
        {},
    )
    repair = value.get("repair_state") if isinstance(value.get("repair_state"), dict) else {}
    legacy_word_decision = (
        issue.get("stage") == "master_word_check"
        or repair.get("strategy") == "historical_native_master_reverification"
    )
    if not legacy_word_decision or diagnostic.get("word_verifier_strategy"):
        return fail(
            "This job was not rejected by the retired long-form verifier; use Retry unchanged instead",
            409,
        )
    if value.get("consent_basis") not in CONSENT_BASES:
        return fail("The job has no valid recorded consent basis", 409)
    if not GENERATION_SLOT.acquire(blocking=False):
        return fail("Promptus is busy with another voice job; wait before rechecking", 429)
    try:
        health_state = backend_health(include_portal_slot=False)
        if not health_state["accepting_jobs"]:
            GENERATION_SLOT.release()
            return fail("Promptus is busy; wait for the live queue to clear", 429)
        reference_audit = ensure_reference_word_audit(str(value.get("model_title", "")))
        if (
            reference_audit.get("approved") is not True
            or reference_audit.get("reference_sha256") != value.get("reference_sha256")
            or reference_audit.get("transcript_sha256")
            != value.get("reference_transcript_sha256")
        ):
            GENERATION_SLOT.release()
            return fail(
                "The installed reference no longer matches this job's approved reference evidence; "
                "use Retry unchanged after repairing the voice",
                409,
            )
    except PromptusVoiceError as exc:
        GENERATION_SLOT.release()
        return fail(str(exc), 503)
    previous_value = dict(value)
    value.update({
        "status": "running",
        "qa_status": "running",
        "portal_run_id": PORTAL_RUN_ID,
    })
    with JOBS_LOCK:
        JOBS[job_id] = value
    try:
        persist_job_history(value)
        threading.Thread(
            target=reverify_quarantined_master,
            args=(job_id,),
            daemon=True,
        ).start()
    except Exception:
        previous_value.update({
            "status": "rejected",
            "qa_status": "rejected",
        })
        with JOBS_LOCK:
            JOBS[job_id] = previous_value
        try:
            persist_job_history(previous_value)
        except OSError:
            pass
        GENERATION_SLOT.release()
        return fail("The saved-master recheck could not start; the job remains quarantined", 500)
    return jsonify({
        "ok": True,
        "job_id": job_id,
        "recovery": "historical_native_master_reverification",
    }), 202


@app.get("/api/history")
def job_history():
    """Recent sanitized lifecycle records that survive browser and portal restarts."""
    prune_jobs()
    backfill_legacy_history()
    try:
        limit = int(request.args.get("limit", 5))
    except (TypeError, ValueError):
        return fail("limit must be a whole number")
    entries = [public_job_snapshot(item) for item in recent_job_history(limit)]
    return jsonify({"ok": True, "count": len(entries), "entries": entries})


@app.post("/api/jobs/<job_id>/expression")
def job_expression(job_id: str):
    """Record the human listening verdict beside the automatic signal verdict.

    The verifier can prove a render is clean; it cannot prove the cadence is right. This keeps the
    listening judgement with the render's hash, in a log that outlives the job retention window.
    """
    data = request.get_json(silent=True) or {}
    verdict = str(data.get("verdict", "")).strip().casefold()
    if verdict not in EXPRESSION_VERDICTS:
        return fail(f"Verdict must be one of: {', '.join(EXPRESSION_VERDICTS)}")
    notes = str(data.get("notes", "")).strip()
    if len(notes) > 2000:
        return fail("Expression notes are limited to 2000 characters")
    recorded = time.time()
    live = False
    with JOBS_LOCK:
        value = JOBS.get(job_id)
        if value:
            value = dict(value)
            live = True
    if not value:
        value = read_job_history(job_id)
    if not value:
        return fail("Job not found", 404)
    if value.get("status") != "complete":
        return fail("Add the listening verdict once the render has completed")
    output = (value.get("outputs") or [{}])[0]
    entry = {
        "recorded": recorded,
        "job_id": job_id,
        "model_title": value.get("model_title"),
        "style": value.get("style"),
        "controls_modified": value.get("controls_modified", False),
        "controls": value.get("controls"),
        "consent_basis": value.get("consent_basis"),
        "narration_sha256": value.get("narration_sha256"),
        "sections": output.get("sections"),
        "duration_seconds": output.get("duration_seconds"),
        "sha256": output.get("sha256"),
        "clipping_percent": output.get("clipping_percent"),
        "silence_percent": output.get("silence_percent"),
        "dc_offset": output.get("dc_offset"),
        "possible_clicks_percent": output.get("possible_clicks_percent"),
        "output_location": output.get("audio_url"),
        "word_accuracy_approved": output.get("word_accuracy_approved"),
        "normalized_word_error_rate_percent": output.get(
            "normalized_word_error_rate_percent"
        ),
        "verdict": verdict,
        "notes": notes,
    }
    value.update({
        "listening_verdict": verdict,
        "listening_notes": notes,
        "listening_recorded": recorded,
    })
    if live:
        with JOBS_LOCK:
            if job_id in JOBS:
                JOBS[job_id].update({
                    "listening_verdict": verdict,
                    "listening_notes": notes,
                    "listening_recorded": recorded,
                })
                value = dict(JOBS[job_id])
    try:
        persist_job_history(value)
    except OSError as exc:
        return fail(f"Could not update the local job history: {exc}", 500)
    try:
        with EXPRESSION_LOCK, EXPRESSION_LOG.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError as exc:
        return fail(f"Could not record the listening verdict: {exc}", 500)
    return jsonify({"ok": True, "expression": entry})


@app.get("/api/expression")
def expression_log():
    """Recent listening verdicts, newest first, for comparing takes of the same text."""
    try:
        limit = max(1, min(200, int(request.args.get("limit", 25))))
    except (TypeError, ValueError):
        return fail("limit must be a whole number")
    entries: list[dict[str, Any]] = []
    if EXPRESSION_LOG.is_file():
        try:
            with EXPRESSION_LOG.open("r", encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        except OSError as exc:
            return fail(f"Could not read the listening log: {exc}", 500)
    return jsonify({"ok": True, "entries": list(reversed(entries))[:limit]})


def skill_files() -> list[Path]:
    """Every file that belongs in a distributable copy of the skill.

    Allow-list by suffix rather than exclude-by-pattern: the skill directory holds only instructions,
    scripts and metadata today, and an allow-list keeps it that way if a recording or a cache ever
    lands there by accident.
    """
    allowed = {".md", ".py", ".yaml", ".yml", ".json", ".toml", ".txt"}
    return sorted(
        path
        for path in SKILL_ROOT.rglob("*")
        if path.is_file()
        and path.suffix.casefold() in allowed
        and "__pycache__" not in path.parts
        and not path.name.endswith(".bak")
    )


def skill_manifest() -> dict[str, Any]:
    """Identify the skill by the content of its files, so the version cannot drift from the source.

    The version is a hash of every packaged path and its bytes, computed per request. There is no
    number to remember to bump: edit a script and the version changes; change nothing and the same
    bytes always produce the same version, on any machine.
    """
    digest = hashlib.sha256()
    files = skill_files()
    newest = 0.0
    total = 0
    for path in files:
        relative = path.relative_to(SKILL_ROOT).as_posix()
        payload = path.read_bytes()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(payload)
        digest.update(b"\0")
        total += len(payload)
        newest = max(newest, path.stat().st_mtime)
    version = digest.hexdigest()[:12]
    updated = time.strftime("%Y-%m-%d", time.localtime(newest)) if newest else "unknown"
    return {
        "name": SKILL_ROOT.name,
        "version": version,
        "updated": updated,
        "files": len(files),
        "bytes": total,
        "filename": f"{SKILL_ROOT.name}-{updated}-{version}.zip",
    }


F5_RELEASES_API = "https://api.github.com/repos/SWivid/F5-TTS/releases/latest"
F5_RELEASES_PAGE = "https://github.com/SWivid/F5-TTS/releases"
UPSTREAM_CACHE: dict[str, Any] = {}
UPSTREAM_CACHE_LOCK = threading.Lock()
UPSTREAM_CACHE_SECONDS = 6 * 60 * 60


@app.get("/api/upstream/f5")
def upstream_f5_release():
    """Report the latest public F5-TTS release beside the installed one.

    This is the only outbound request the portal makes. It is anonymous and unauthenticated, sends
    nothing about the user or their installation, and is cached so that opening the panel repeatedly
    does not repeat the call. Failure is reported as unavailable rather than raised: a version check
    must never be able to block local voice work, and the machine may simply be offline.
    """
    import urllib.error
    import urllib.request

    now = time.time()
    with UPSTREAM_CACHE_LOCK:
        cached = UPSTREAM_CACHE.get("f5")
        if cached and now - cached["checked"] < UPSTREAM_CACHE_SECONDS:
            return jsonify({"ok": True, **cached["payload"], "cached": True})

    payload: dict[str, Any] = {"releases_url": F5_RELEASES_PAGE}
    try:
        request_obj = urllib.request.Request(
            F5_RELEASES_API,
            headers={"Accept": "application/vnd.github+json", "User-Agent": "portal"},
        )
        with urllib.request.urlopen(request_obj, timeout=8) as response:
            data = json.loads(response.read().decode("utf-8"))
        payload["latest"] = data.get("tag_name") or data.get("name")
        payload["published"] = (data.get("published_at") or "")[:10]
        payload["url"] = data.get("html_url") or F5_RELEASES_PAGE
        payload["available"] = bool(payload["latest"])
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        payload["available"] = False
        payload["reason"] = f"{type(exc).__name__}: {exc}"[:160]

    with UPSTREAM_CACHE_LOCK:
        UPSTREAM_CACHE["f5"] = {"checked": now, "payload": payload}
    return jsonify({"ok": True, **payload, "cached": False})


@app.get("/api/skill/info")
def skill_info():
    try:
        if not SKILL_ROOT.is_dir():
            return fail("The skill directory is not beside this portal", 404)
        return jsonify({"ok": True, **skill_manifest()})
    except OSError as exc:
        return fail(f"Could not read the skill directory: {exc}", 500)


@app.get("/api/skill/download")
def skill_download():
    """Build the archive from the working tree at request time.

    Packaging on demand rather than serving a stored artefact is what keeps the download current:
    there is no build step that can be forgotten and no stale zip to invalidate.
    """
    try:
        if not SKILL_ROOT.is_dir():
            return fail("The skill directory is not beside this portal", 404)
        manifest = skill_manifest()
        buffer = io.BytesIO()
        # Deterministic timestamps so identical content yields a byte-identical archive.
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in skill_files():
                relative = path.relative_to(SKILL_ROOT).as_posix()
                info = zipfile.ZipInfo(f"{SKILL_ROOT.name}/{relative}", date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                archive.writestr(info, path.read_bytes())
            readme = (
                f"{manifest['name']} {manifest['version']} (source updated {manifest['updated']})\n\n"
                "Install by copying the folder in this archive into your agent skills directory,\n"
                "then open SKILL.md. Requires the Promptus desktop app on Windows and its managed\n"
                "Cosy Python; the scripts discover the install root themselves.\n\n"
                "Clone only a voice you own or have the speaker's explicit permission to use.\n"
            )
            info = zipfile.ZipInfo(f"{SKILL_ROOT.name}/INSTALL.txt", date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, readme)
        buffer.seek(0)
        return send_file(
            buffer,
            mimetype="application/zip",
            as_attachment=True,
            download_name=manifest["filename"],
        )
    except OSError as exc:
        return fail(f"Could not package the skill: {exc}", 500)


@app.get("/api/output/<path:relative>")
def output_audio(relative: str):
    root = (comfy_root(promptus_root()) / "output").resolve()
    approved_root = (root / "promptus_voice").resolve()
    path = (root / relative).resolve()
    audio_url = "/api/output/" + relative.replace("\\", "/")
    if (
        approved_root not in path.parents
        or path.suffix.casefold() not in {".wav", ".flac", ".mp3", ".ogg", ".m4a"}
        or not path.is_file()
        or not output_delivery_is_approved(audio_url)
    ):
        return fail("Output not found", 404)
    return send_file(path, conditional=True)


if __name__ == "__main__":
    print("Promptus F5 Studio Portal: http://127.0.0.1:8765")
    app.run(host="127.0.0.1", port=8765, debug=False, threaded=True)
