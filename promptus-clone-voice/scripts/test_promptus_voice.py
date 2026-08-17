#!/usr/bin/env python3
"""Submit one consented smoke-test line to an installed Promptus voice cosyflow."""

from __future__ import annotations

import argparse
import json
import sqlite3
import time
import urllib.parse
from pathlib import Path
from typing import Any

from promptus_voice_common import (
    DEFAULT_COMFY_URL,
    DEFAULT_COSY_URL,
    PromptusVoiceError,
    comfy_root,
    discover_install_root,
    json_request,
)
from promptus_audio_quality import inspect_audio, verify_audio


def safe_progress(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {"state": "unknown"}
    allowed = ("complete", "progress", "status", "status_str", "error", "output_ids", "view")
    return {key: value[key] for key in allowed if key in value}


def history_error(status: dict[str, Any]) -> str:
    for message in status.get("messages", []):
        if isinstance(message, list) and len(message) == 2 and message[0] == "execution_error":
            detail = message[1].get("exception_message") if isinstance(message[1], dict) else None
            if detail:
                return str(detail).splitlines()[0]
    return "ComfyUI history reported an unspecified execution error"


def verified_outputs(job: dict[str, Any], output_root: Path) -> list[dict[str, Any]]:
    verified: list[dict[str, Any]] = []
    resolved_root = output_root.resolve()
    for node in job.get("outputs", {}).values():
        if not isinstance(node, dict):
            continue
        for item in node.get("audio", []):
            if not isinstance(item, dict) or item.get("type") != "output" or not item.get("filename"):
                continue
            path = (resolved_root / str(item.get("subfolder", "")) / str(item["filename"])).resolve()
            if resolved_root not in path.parents or not path.is_file():
                raise PromptusVoiceError(f"ComfyUI output metadata did not resolve to a saved file: {path}")
            try:
                verified.append(verify_audio(path))
            except PromptusVoiceError:
                # Still refuse the render, but emit the measurements first. A caller diagnosing
                # why a take was rejected needs the numbers, and a human comparing takes needs the
                # path; neither weakens the gate, which still raises and exits non-zero.
                print(json.dumps({"rejected_output": inspect_audio(path)}, ensure_ascii=False))
                raise
    if not verified:
        raise PromptusVoiceError("ComfyUI reported success but no persistent audio output file was verified")
    return verified


def add_promptus_index_state(outputs: list[dict[str, Any]], root: Path, output_root: Path) -> None:
    database = root / "comfy_output.db"
    if not database.is_file():
        return
    try:
        connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
        for detail in outputs:
            relative = Path(detail["path"]).resolve().relative_to(output_root.resolve()).as_posix()
            detail["promptus_indexed"] = bool(
                connection.execute("SELECT 1 FROM media WHERE name = ? LIMIT 1", (relative,)).fetchone()
            )
        connection.close()
    except (OSError, sqlite3.Error, ValueError):
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-title", required=True)
    narration = parser.add_mutually_exclusive_group(required=True)
    narration.add_argument("--text")
    narration.add_argument("--text-file", type=Path)
    parser.add_argument("--consent-confirmed", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--seed", type=int, default=-1)
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--nfe-step", type=int, default=32)
    parser.add_argument("--cfg-strength", type=float, default=2.0)
    parser.add_argument("--cross-fade-duration", type=float, default=0.15)
    parser.add_argument("--sway-sampling-coef", type=float, default=-1.0)
    parser.add_argument("--speed-type", default="F5TTS")
    parser.add_argument("--f5-model", default="F5")
    parser.add_argument("--f5-model-type", default="F5TTS_v1_Base")
    parser.add_argument("--vocoder", default="vocos")
    parser.add_argument("--cosy-url", default=DEFAULT_COSY_URL)
    parser.add_argument("--comfy-url", default=DEFAULT_COMFY_URL)
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--heartbeat-seconds", type=int, default=15)
    parser.add_argument("--root")
    args = parser.parse_args()

    try:
        text = args.text if args.text is not None else args.text_file.read_text(encoding="utf-8-sig")
    except OSError as exc:
        raise PromptusVoiceError(f"Cannot read narration file: {exc}") from exc
    text = text.strip()
    if not text:
        raise PromptusVoiceError("Smoke-test text is empty")
    if args.heartbeat_seconds < 1:
        raise PromptusVoiceError("--heartbeat-seconds must be at least 1")
    if not 0.75 <= args.speed <= 1.35:
        raise PromptusVoiceError("--speed must be between 0.75 and 1.35; values above 1.0 are slower")
    if not 8 <= args.nfe_step <= 64:
        raise PromptusVoiceError("--nfe-step must be between 8 and 64")
    if args.speed_type not in {"F5TTS", "torch-time-stretch"}:
        raise PromptusVoiceError(
            "Unsafe tempo method. TDHS in ComfyUI-F5-TTS 1.0.26 returns unscaled int16 samples and can clip severely."
        )
    if not args.dry_run and not args.consent_confirmed:
        raise PromptusVoiceError("Refusing to generate without --consent-confirmed")

    encoded_title = urllib.parse.quote(args.model_title, safe="")
    status, variables = json_request(
        f"{args.cosy_url.rstrip('/')}/api/generate/get-cosyflow-variables/{encoded_title}"
    )
    if status not in (200, 201) or not isinstance(variables, dict):
        raise PromptusVoiceError(f"Cosyflow not found or variables unavailable: {args.model_title}")

    supported = set(variables)
    if "sample" in supported:
        raise PromptusVoiceError(
            "This cosyflow still exposes a dynamic sample upload. Promptus worker 0.110 writes that upload "
            "without a file extension or matching transcript sidecar, so F5 cannot load it safely. "
            "Install a fixed-reference preset with install_f5tts_cosyflow.py or install_f5tts_mode_pack.py."
        )
    speech_variable = "speech" if "speech" in supported else "narration" if "narration" in supported else None
    if not speech_variable:
        raise PromptusVoiceError(f"Cosyflow has no narration variable; variables={sorted(supported)}")
    payload: dict[str, Any] = {
        "cosyflow": args.model_title,
        speech_variable: text,
    }
    optional_values = {
        "seed": args.seed,
        "speed": args.speed,
        "nfe_step": args.nfe_step,
        "cfg_strength": args.cfg_strength,
        "cross_fade_duration": args.cross_fade_duration,
        "sway_sampling_coef": args.sway_sampling_coef,
        "speed_type": args.speed_type,
        "f5_model": args.f5_model,
        "f5_model_type": args.f5_model_type,
        "vocoder": args.vocoder,
    }
    payload.update({key: value for key, value in optional_values.items() if key in supported})
    for key, metadata in variables.items():
        if key not in payload and isinstance(metadata, dict) and "default" in metadata:
            payload[key] = metadata["default"]
    print(f"Model: {args.model_title}")
    print("Reference: fixed inside installed local cosyflow")
    print(f"Narration: {len(text)} characters from {'file' if args.text_file else 'command line'}")
    print(f"Payload fields: {', '.join(sorted(payload))}")
    if args.dry_run:
        print("DRY RUN: no generation submitted")
        return 0

    status, response = json_request(
        f"{args.cosy_url.rstrip('/')}/api/generate",
        method="POST",
        payload=payload,
        timeout=60,
    )
    if status not in (200, 201) or not isinstance(response, dict) or not response.get("prompt_id"):
        message = response.get("error") if isinstance(response, dict) else response
        raise PromptusVoiceError(f"Generation submission failed (HTTP {status}): {message}")
    prompt_id = str(response["prompt_id"])
    # A structured identifier lets the portal correlate this section with ComfyUI history
    # without retaining or parsing child-process chatter that may contain private narration.
    print(json.dumps({"comfy_prompt_id": prompt_id}), flush=True)

    deadline = time.monotonic() + args.timeout
    started = time.monotonic()
    next_heartbeat = started + args.heartbeat_seconds
    root = discover_install_root(args.root)
    output_root = comfy_root(root) / "output"
    last: dict[str, Any] = {}
    while time.monotonic() < deadline:
        status, progress = json_request(
            f"{args.cosy_url.rstrip('/')}/api/generate/progress/{urllib.parse.quote(prompt_id, safe='')}"
        )
        if status in (200, 201):
            current = safe_progress(progress)
            if current != last:
                print(json.dumps({"cosy": current}, ensure_ascii=False))
                last = current
            if current.get("error"):
                raise PromptusVoiceError(str(current["error"]))

        history_status, history = json_request(
            f"{args.comfy_url.rstrip('/')}/history/{urllib.parse.quote(prompt_id, safe='')}"
        )
        job = history.get(prompt_id) if history_status == 200 and isinstance(history, dict) else None
        comfy_status = job.get("status", {}) if isinstance(job, dict) else {}
        if comfy_status.get("status_str") == "error":
            raise PromptusVoiceError(f"Authoritative ComfyUI failure: {history_error(comfy_status)}")
        if comfy_status.get("completed") is True and comfy_status.get("status_str") == "success":
            outputs = verified_outputs(job, output_root)
            add_promptus_index_state(outputs, root, output_root)
            print(json.dumps({
                "comfy_status": "success",
                "elapsed_seconds": round(time.monotonic() - started, 1),
                "verified_outputs": outputs,
            }, ensure_ascii=False))
            print("Generation complete and persistent audio verified under Promptus Comfy Output.")
            if any(detail.get("promptus_indexed") is False for detail in outputs):
                print("NOTICE: audio is saved, but Promptus's media index has not ingested it yet; refresh Comfy Output.")
            return 0
        now = time.monotonic()
        if now >= next_heartbeat:
            queue_status, queue = json_request(f"{args.comfy_url.rstrip('/')}/queue")
            heartbeat: dict[str, Any] = {"elapsed_seconds": round(now - started, 1)}
            if queue_status == 200 and isinstance(queue, dict):
                heartbeat.update({
                    "queue_running": len(queue.get("queue_running", [])),
                    "queue_pending": len(queue.get("queue_pending", [])),
                })
            print(json.dumps({"heartbeat": heartbeat}, ensure_ascii=False))
            next_heartbeat = now + args.heartbeat_seconds
        time.sleep(2)
    raise PromptusVoiceError(f"Timed out after {args.timeout} seconds")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PromptusVoiceError as exc:
        print(f"ERROR: {exc}")
        raise SystemExit(2)
