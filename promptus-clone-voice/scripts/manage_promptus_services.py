#!/usr/bin/env python3
"""Read PManager service state or restart idle ComfyUI through PManager itself."""

from __future__ import annotations

import argparse
import json
import time

from promptus_voice_common import (
    DEFAULT_COMFY_URL,
    DEFAULT_PMANAGER_URL,
    PromptusVoiceError,
    get_node_info,
    json_request,
    pmanager_status,
)


def wait_for(predicate, timeout: int, description: str) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if predicate():
                return
        except PromptusVoiceError:
            pass
        time.sleep(1)
    raise PromptusVoiceError(f"Timed out waiting for {description}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--restart-comfyui", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--pmanager-url", default=DEFAULT_PMANAGER_URL)
    parser.add_argument("--comfy-url", default=DEFAULT_COMFY_URL)
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()

    if not args.status and not args.restart_comfyui:
        parser.error("choose --status or --restart-comfyui")
    before = pmanager_status(args.pmanager_url)
    print(json.dumps({"pmanager": before}, ensure_ascii=False))
    if args.status:
        return 0 if before.get("comfyui") == "ready" and before.get("cosy") == "ready" else 2

    status, queue = json_request(f"{args.comfy_url.rstrip('/')}/queue")
    if status != 200 or not isinstance(queue, dict):
        raise PromptusVoiceError("Cannot verify the ComfyUI queue before restart")
    running = len(queue.get("queue_running", []))
    pending = len(queue.get("queue_pending", []))
    if running or pending:
        raise PromptusVoiceError(f"Refusing to restart a busy ComfyUI queue: running={running}, pending={pending}")
    print("PLAN: PManager stop-pmanager-comfyui-server, then run-pmanager-comfyui-server")
    if args.dry_run:
        print("DRY RUN: no service state changed")
        return 0

    base = args.pmanager_url.rstrip("/")
    stop_status, _ = json_request(f"{base}/stop-pmanager-comfyui-server")
    if stop_status != 200:
        raise PromptusVoiceError(f"PManager ComfyUI stop failed: HTTP {stop_status}")
    wait_for(lambda: pmanager_status(base).get("comfyui") != "ready", args.timeout, "ComfyUI to stop")
    start_status, _ = json_request(f"{base}/run-pmanager-comfyui-server")
    if start_status != 200:
        raise PromptusVoiceError(f"PManager ComfyUI start failed: HTTP {start_status}")
    wait_for(
        lambda: pmanager_status(base).get("comfyui") == "ready"
        and get_node_info(args.comfy_url, "F5TTSAudio") is not None,
        args.timeout,
        "PManager ComfyUI and F5TTSAudio",
    )
    after = pmanager_status(base)
    print(json.dumps({"pmanager": after}, ensure_ascii=False))
    print("PManager-native ComfyUI restart complete")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PromptusVoiceError as exc:
        print(f"ERROR: {exc}")
        raise SystemExit(2)
