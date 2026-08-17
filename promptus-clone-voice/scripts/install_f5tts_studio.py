#!/usr/bin/env python3
"""Install one fixed-reference, fully controllable F5 Studio cosyflow in Promptus."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from install_f5tts_mode_pack import build_mode_flow, default_for
from promptus_voice_common import (
    DEFAULT_COMFY_URL,
    DEFAULT_COSY_URL,
    PromptusVoiceError,
    backup_file,
    comfy_root,
    copy_with_backup,
    discover_install_root,
    find_cosyflow,
    get_cosyflows,
    get_node_info,
    install_local_cosyflow,
    local_cosyflow_dir,
    require_reference_files,
    slugify,
    title_to_filename,
)


STUDIO_DEFAULTS: dict[str, Any] = {
    "model": "F5v1",
    "model_type": "F5TTS_v1_Base",
    "vocoder": "vocos",
    "speed": 1.0,
    "target_rms": 0.1,
    "cross_fade_duration": 0.15,
    "nfe_step": 32,
    "cfg_strength": 2.0,
    "sway_sampling_coef": -1.0,
    "speed_type": "F5TTS",
    "fix_duration": -1,
}

PUBLIC_CONTROLS = {
    "nfe_step": "nfe_step",
    "cfg_strength": "cfg_strength",
    "cross_fade_duration": "cross_fade_duration",
    "sway_sampling_coef": "sway_sampling_coef",
}


def variable_from_spec(input_name: str, title: str, spec: Any, default: Any) -> dict[str, Any]:
    options = spec[0] if isinstance(spec, list) and spec and isinstance(spec[0], list) else None
    metadata = spec[1] if isinstance(spec, list) and len(spec) > 1 and isinstance(spec[1], dict) else {}
    value: dict[str, Any] = {
        "node_title": "F5-TTS Advanced",
        "input_title": input_name,
        "title": title,
        "default": default,
        "importance": 3,
        "required": True,
        "type": "enum" if options else str(spec[0]) if isinstance(spec, list) and spec else "STRING",
    }
    if options:
        value["options"] = options
    for key in ("min", "max", "step", "tooltip", "multiline"):
        if key in metadata:
            value[key] = metadata[key]
    return value


def build_studio_flow(
    *, voice_name: str, node_info: dict[str, Any], reference_filename: str, reference_text: str
) -> dict[str, Any]:
    flow = build_mode_flow(
        voice_name=voice_name,
        mode_name="Studio",
        nfe=32,
        guidance=2.0,
        usage="Expressive narration with live cadence and quality controls",
        node_info=node_info,
        reference_filename=reference_filename,
        reference_text=reference_text,
    )
    required = node_info.get("input", {}).get("required", {})
    optional = node_info.get("input", {}).get("optional", {})
    all_specs = {**required, **optional}
    inputs = flow["prompt"]["2"]["inputs"]
    for name, value in STUDIO_DEFAULTS.items():
        if name in all_specs:
            options = all_specs[name][0] if isinstance(all_specs[name], list) and all_specs[name] else None
            if isinstance(options, list) and value not in options:
                value = default_for(all_specs[name])
            inputs[name] = value

    flow["variables"]["speed"]["default"] = inputs["speed"]
    for input_name, variable_name in PUBLIC_CONTROLS.items():
        if input_name not in all_specs or input_name not in inputs:
            continue
        flow["variables"][variable_name] = variable_from_spec(
            input_name,
            f"F5-TTS Advanced: {input_name.replace('_', ' ')}",
            all_specs[input_name],
            inputs[input_name],
        )
        flow["assignments"].append(
            {"node_id": "2", "input_name": input_name, "variable": variable_name}
        )

    widget_node = next(node for node in flow["workflow"]["nodes"] if node.get("id") == 2)
    widget_node["widgets_values"] = [
        inputs[name]
        for name in all_specs
        if name in inputs and not isinstance(inputs[name], list)
    ]
    flow["description"] = "Clone a consented local voice using F5TTS_v1_Base in Studio mode."
    flow["tags"] = ["Audio", "Voice Cloning"]
    return flow


def install_studio(
    *, voice_name: str, reference_audio: Path, reference_text_file: Path,
    root_override: str | None = None, comfy_url: str = DEFAULT_COMFY_URL,
    cosy_url: str = DEFAULT_COSY_URL, force: bool = False, dry_run: bool = False,
) -> tuple[str, Path]:
    reference_text = require_reference_files(reference_audio, reference_text_file)
    root = discover_install_root(root_override)
    advanced = get_node_info(comfy_url, "F5TTSAudioAdvanced")
    if not advanced:
        raise PromptusVoiceError("F5TTSAudioAdvanced is not available")
    slug = slugify(voice_name)
    audio_name = f"{slug}-studio-reference.wav"
    input_audio = comfy_root(root) / "input" / "F5-TTS" / audio_name
    input_text = input_audio.with_suffix(".txt")
    relative = str(Path("F5-TTS") / audio_name)
    flow = build_studio_flow(
        voice_name=voice_name, node_info=advanced,
        reference_filename=relative, reference_text=reference_text,
    )
    title = flow["title"]
    target = local_cosyflow_dir(root) / title_to_filename(title)
    existing = find_cosyflow(get_cosyflows(cosy_url), title)
    if (existing or target.exists()) and not force:
        raise PromptusVoiceError(f"Studio voice already exists: {title}. Confirm replacement to continue.")
    if dry_run:
        return title, target
    copy_with_backup(reference_audio.resolve(), input_audio, force=force)
    copy_with_backup(reference_text_file.resolve(), input_text, force=force)
    if target.exists() and force:
        backup_file(target)
    install_local_cosyflow(cosy_url, flow)
    return title, target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voice-name", required=True)
    parser.add_argument("--reference-audio", required=True, type=Path)
    parser.add_argument("--reference-text-file", required=True, type=Path)
    parser.add_argument("--consent-confirmed", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--root")
    parser.add_argument("--comfy-url", default=DEFAULT_COMFY_URL)
    parser.add_argument("--cosy-url", default=DEFAULT_COSY_URL)
    args = parser.parse_args()
    if not args.dry_run and not args.consent_confirmed:
        raise PromptusVoiceError("Refusing to install a voice without --consent-confirmed")
    title, target = install_studio(
        voice_name=args.voice_name, reference_audio=args.reference_audio,
        reference_text_file=args.reference_text_file, root_override=args.root,
        comfy_url=args.comfy_url, cosy_url=args.cosy_url,
        force=args.force, dry_run=args.dry_run,
    )
    print(json.dumps({"title": title, "target": str(target), "dry_run": args.dry_run}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PromptusVoiceError as exc:
        print(f"ERROR: {exc}")
        raise SystemExit(2)
