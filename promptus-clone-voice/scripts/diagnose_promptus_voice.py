#!/usr/bin/env python3
"""Read-only Promptus, ComfyUI, Cosy, and F5-TTS diagnostic for Windows."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from promptus_voice_common import (
    DEFAULT_COMFY_URL,
    DEFAULT_COSY_URL,
    DEFAULT_PMANAGER_URL,
    F5_COSYFLOW_TITLE,
    PromptusVoiceError,
    comfy_root,
    discover_install_root,
    find_cosyflow,
    get_cosyflows,
    get_node_info,
    json_request,
    pmanager_status,
    promptus_python,
)


def check(name: str, state: str, detail: str, *, required: bool = True) -> dict[str, Any]:
    return {"name": name, "state": state, "detail": detail, "required": required}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", help="Confirmed Promptus install root override")
    parser.add_argument("--comfy-url", default=DEFAULT_COMFY_URL)
    parser.add_argument("--cosy-url", default=DEFAULT_COSY_URL)
    parser.add_argument("--pmanager-url", default=DEFAULT_PMANAGER_URL)
    parser.add_argument("--require-advanced", action="store_true")
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    checks: list[dict[str, Any]] = []
    try:
        root = discover_install_root(args.root)
        checks.append(check("Promptus install", "ok", str(root)))
    except PromptusVoiceError as exc:
        checks.append(check("Promptus install", "fail", str(exc)))
        return finish(checks, args.as_json)

    expected_python = promptus_python(root)
    checks.append(check(
        "Promptus Python",
        "ok" if expected_python.is_file() else "fail",
        str(expected_python),
    ))
    current = Path(sys.executable).resolve()
    checks.append(check(
        "Active Python",
        "ok" if current == expected_python.resolve() else "warn",
        f"{current} (expected {expected_python})",
        required=False,
    ))

    croot = comfy_root(root)
    for label, path in (
        ("ComfyUI input", croot / "input"),
        ("ComfyUI output", croot / "output"),
        ("ComfyUI custom nodes", croot / "custom_nodes"),
    ):
        checks.append(check(label, "ok" if path.is_dir() else "fail", str(path)))

    try:
        status, queue = json_request(f"{args.comfy_url.rstrip('/')}/queue")
        running = len(queue.get("queue_running", [])) if isinstance(queue, dict) else -1
        pending = len(queue.get("queue_pending", [])) if isinstance(queue, dict) else -1
        checks.append(check(
            "ComfyUI service",
            "ok" if status == 200 else "fail",
            f"HTTP {status}; running={running}; pending={pending}",
        ))
    except PromptusVoiceError as exc:
        checks.append(check("ComfyUI service", "fail", str(exc)))

    basic_present = False
    for node_name, required in (
        ("F5TTSAudio", True),
        ("F5TTSAudioAdvanced", args.require_advanced),
        ("SaveAudio", True),
    ):
        try:
            present = get_node_info(args.comfy_url, node_name) is not None
            if node_name == "F5TTSAudio":
                basic_present = present
            checks.append(check(
                node_name,
                "ok" if present else ("fail" if required else "warn"),
                "available" if present else "not exposed by active ComfyUI",
                required=required,
            ))
        except PromptusVoiceError as exc:
            checks.append(check(node_name, "fail" if required else "warn", str(exc), required=required))

    if basic_present:
        inference_loader = (
            croot / "custom_nodes" / "comfyui-f5-tts" / "F5-TTS" / "src"
            / "f5_tts" / "infer" / "utils_infer.py"
        )
        try:
            source = inference_loader.read_text(encoding="utf-8")
            if "def load_audio_compat(path):" in source:
                checks.append(check("F5 audio decoder", "ok", "SoundFile fallback installed"))
            else:
                try:
                    from torchcodec.decoders import AudioDecoder  # noqa: F401
                    checks.append(check("F5 audio decoder", "ok", "TorchCodec shared libraries load"))
                except Exception as exc:
                    detail = str(exc).splitlines()[0] or type(exc).__name__
                    checks.append(check(
                        "F5 audio decoder", "fail",
                        f"TorchCodec cannot load ({detail}); run patch_f5_torchcodec_compat.py and restart ComfyUI",
                    ))
        except OSError as exc:
            checks.append(check("F5 audio decoder", "fail", str(exc)))

    try:
        status, stats = json_request(f"{args.comfy_url.rstrip('/')}/system_stats")
        devices = stats.get("devices", []) if isinstance(stats, dict) else []
        if devices:
            device = devices[0]
            total = int(device.get("vram_total", 0)) // (1024 * 1024)
            free = int(device.get("vram_free", 0)) // (1024 * 1024)
            detail = f"{device.get('name', 'unknown')}; VRAM {free} MiB free / {total} MiB total"
        else:
            detail = f"HTTP {status}; no GPU record"
        checks.append(check("Compute device", "ok" if status == 200 else "warn", detail, required=False))
    except PromptusVoiceError as exc:
        checks.append(check("Compute device", "warn", str(exc), required=False))

    try:
        status, info = json_request(f"{args.cosy_url.rstrip('/')}/api/generate/get-info")
        version = info.get("version", "unknown") if isinstance(info, dict) else "unknown"
        checks.append(check("Cosy service", "ok" if status in (200, 201) else "fail", f"HTTP {status}; {version}"))
        flows = get_cosyflows(args.cosy_url)
        f5 = find_cosyflow(flows, F5_COSYFLOW_TITLE)
        if f5:
            checks.append(check(
                "Promptus F5 package",
                "ok" if f5.get("install_status") == "INSTALLED" else "warn",
                f"catalogued; status={f5.get('install_status', 'unknown')}; dependency=comfyui-f5-tts",
                required=False,
            ))
        else:
            checks.append(check("Promptus F5 package", "fail", f"catalog entry missing: {F5_COSYFLOW_TITLE}"))
    except PromptusVoiceError as exc:
        checks.append(check("Cosy service", "fail", str(exc)))

    try:
        services = pmanager_status(args.pmanager_url)
        ready = services.get("comfyui") == "ready" and services.get("cosy") == "ready"
        checks.append(check(
            "PManager native state",
            "ok" if ready else "fail",
            ", ".join(f"{name}={state}" for name, state in sorted(services.items())),
        ))
    except PromptusVoiceError as exc:
        checks.append(check("PManager native state", "fail", str(exc)))

    return finish(checks, args.as_json)


def finish(checks: list[dict[str, Any]], as_json: bool) -> int:
    ready = not any(item["required"] and item["state"] == "fail" for item in checks)
    if as_json:
        print(json.dumps({"ready": ready, "checks": checks}, indent=2))
    else:
        icons = {"ok": "OK", "warn": "WARN", "fail": "FAIL"}
        for item in checks:
            print(f"[{icons[item['state']]}] {item['name']}: {item['detail']}")
        print(f"\nReady for {'advanced' if any(c['name'] == 'F5TTSAudioAdvanced' and c['required'] for c in checks) else 'basic'} F5 cloning: {'yes' if ready else 'no'}")
    return 0 if ready else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
