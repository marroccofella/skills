#!/usr/bin/env python3
"""Install fixed-reference Fast, Production, and Hero F5-TTS Advanced cosyflows."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

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
    native_voice_title,
    require_reference_files,
    slugify,
    title_to_filename,
)


MODES = (
    ("Fast Preview", 16, 2.0, "Script and pronunciation review"),
    ("Production", 24, 2.0, "Normal finished narration"),
    ("Hero Quality", 32, 2.0, "Hooks and important passages"),
)


def first_present(names: list[str], candidates: tuple[str, ...]) -> str | None:
    return next((candidate for candidate in candidates if candidate in names), None)


def default_for(spec: Any) -> Any:
    if isinstance(spec, list) and len(spec) > 1 and isinstance(spec[1], dict) and "default" in spec[1]:
        return spec[1]["default"]
    if isinstance(spec, list) and spec and isinstance(spec[0], list) and spec[0]:
        return spec[0][0]
    return None


def build_mode_flow(
    *,
    voice_name: str,
    mode_name: str,
    nfe: int,
    guidance: float,
    usage: str,
    node_info: dict[str, Any],
    reference_filename: str,
    reference_text: str,
) -> dict[str, Any]:
    required = node_info.get("input", {}).get("required", {})
    if not isinstance(required, dict):
        raise PromptusVoiceError("F5TTSAudioAdvanced has an invalid input schema")
    optional = node_info.get("input", {}).get("optional", {})
    if not isinstance(optional, dict):
        optional = {}
    all_specs = {**required, **optional}
    names = list(all_specs)
    mapping = {
        "sample": first_present(names, ("sample", "ref_audio", "reference_audio", "audio")),
        "speech": first_present(names, ("speech", "text", "gen_text", "target_text")),
        "sample_text": first_present(names, ("sample_text", "ref_text", "reference_text", "transcript")),
        "seed": first_present(names, ("seed",)),
        "model": first_present(names, ("model", "model_type")),
        "vocoder": first_present(names, ("vocoder",)),
        "speed": first_present(names, ("speed",)),
        "nfe": first_present(names, ("nfe_step", "nfe_steps", "nfe", "steps", "steps_count")),
        "guidance": first_present(names, ("cfg_strength", "guidance", "guidance_scale", "cfg")),
    }
    missing = [key for key in ("sample", "speech", "seed", "speed", "nfe", "guidance") if not mapping[key]]
    if missing:
        raise PromptusVoiceError(
            f"Unsupported F5TTSAudioAdvanced schema; missing semantic inputs {missing}. Actual inputs: {names}"
        )

    values = {name: default_for(spec) for name, spec in all_specs.items()}
    values[mapping["sample"]] = reference_filename
    values[mapping["speech"]] = "Enter the consented narration here."
    values[mapping["seed"]] = -1
    values[mapping["speed"]] = 1.0
    values[mapping["nfe"]] = nfe
    values[mapping["guidance"]] = guidance
    if mapping["sample_text"]:
        values[mapping["sample_text"]] = reference_text
    if mapping["model"] and values[mapping["model"]] is None:
        values[mapping["model"]] = "F5"
    if mapping["vocoder"] and values[mapping["vocoder"]] is None:
        values[mapping["vocoder"]] = "vocos"
    values = {name: value for name, value in values.items() if value is not None}
    unresolved = [name for name in required if name not in values]
    if unresolved:
        raise PromptusVoiceError(
            f"Advanced schema has required inputs without usable defaults: {unresolved}"
        )

    sample_spec = all_specs[mapping["sample"]]
    graph_audio = isinstance(sample_spec, list) and sample_spec and sample_spec[0] == "AUDIO"
    prompt: dict[str, Any] = {}
    workflow_nodes: list[dict[str, Any]] = []
    workflow_links: list[list[Any]] = []
    advanced_inputs = dict(values)
    advanced_workflow_inputs: list[dict[str, Any]] = []
    if graph_audio:
        prompt["1"] = {"class_type": "LoadAudio", "inputs": {"audio": reference_filename}, "_meta": {"title": "Reference audio"}}
        advanced_inputs[mapping["sample"]] = ["1", 0]
        advanced_workflow_inputs.append({"name": mapping["sample"], "type": "AUDIO", "link": 1})
        workflow_nodes.append({
            "id": 1, "type": "LoadAudio", "pos": [0, 0], "size": [320, 120], "order": 0, "mode": 0,
            "widgets_values": [reference_filename], "flags": {},
            "properties": {"cnr_id": "comfy-core", "Node name for S&R": "LoadAudio"},
            "inputs": [], "outputs": [{"name": "AUDIO", "type": "AUDIO", "links": [1], "slot_index": 0}],
        })
        workflow_links.append([1, 1, 0, 2, 0, "AUDIO"])

    prompt["2"] = {"class_type": "F5TTSAudioAdvanced", "inputs": advanced_inputs, "_meta": {"title": "F5-TTS Advanced"}}
    prompt["3"] = {
        "class_type": "SaveAudio",
        "inputs": {"audio": ["2", 0], "filename_prefix": f"promptus_voice/{slugify(voice_name)}/{slugify(mode_name)}"},
        "_meta": {"title": "SaveAudio"},
    }
    widget_values = [
        values[name] for name in names
        if name in values and not (graph_audio and name == mapping["sample"])
    ]
    workflow_nodes.extend([
        {
            "id": 2, "type": "F5TTSAudioAdvanced", "pos": [380, 0], "size": [430, 360], "order": 1 if graph_audio else 0,
            "mode": 0, "widgets_values": widget_values, "flags": {},
            "properties": {"cnr_id": "comfyui-f5-tts", "Node name for S&R": "F5TTSAudioAdvanced"},
            "inputs": advanced_workflow_inputs,
            "outputs": [{"name": "AUDIO", "type": "AUDIO", "links": [2], "slot_index": 0}],
        },
        {
            "id": 3, "type": "SaveAudio", "pos": [880, 0], "size": [320, 100], "order": 2 if graph_audio else 1,
            "mode": 0, "widgets_values": [f"promptus_voice/{slugify(voice_name)}/{slugify(mode_name)}"], "flags": {},
            "properties": {"cnr_id": "comfy-core", "Node name for S&R": "SaveAudio"},
            "inputs": [{"name": "audio", "type": "AUDIO", "link": 2}], "outputs": [],
        },
    ])
    workflow_links.append([2, 2, 0, 3, 0, "AUDIO"])

    variables = {
        "narration": {"node_title": "F5-TTS Advanced", "input_title": mapping["speech"], "title": f"F5-TTS Advanced: {mapping['speech'].replace('_', ' ')}", "default": values[mapping["speech"]], "type": "STRING", "importance": 5, "required": True, "multiline": True},
        "seed": {"node_title": "F5-TTS Advanced", "input_title": mapping["seed"], "title": f"F5-TTS Advanced: {mapping['seed'].replace('_', ' ')}", "default": -1, "type": "seed", "importance": 3, "required": True, "min": -1, "step": 1, "display": "number", "tooltip": "Seed. -1 = random"},
        "speed": {"node_title": "F5-TTS Advanced", "input_title": mapping["speed"], "title": f"F5-TTS Advanced: {mapping['speed'].replace('_', ' ')}", "default": 1.0, "type": "FLOAT", "importance": 3, "required": True},
    }
    assignments = [
        {"node_id": "2", "input_name": mapping["speech"], "variable": "narration"},
        {"node_id": "2", "input_name": mapping["seed"], "variable": "seed", "convert": "seed_to_int"},
        {"node_id": "2", "input_name": mapping["speed"], "variable": "speed"},
    ]
    title = native_voice_title(voice_name, mode_name)
    return {
        "title": title,
        "category": "Promptus/Cosy/Audio",
        "tags": ["Audio", "Voice Cloning"],
        "description": f"Clone a consented local voice using F5TTS_v1_Base in {mode_name} mode.",
        "workflow": {"last_node_id": 3, "last_link_id": 2, "version": 0.4, "links": workflow_links, "config": {}, "extra": {}, "nodes": workflow_nodes, "groups": []},
        "prompt": prompt,
        "assignments": assignments,
        "variables": variables,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voice-name", required=True)
    parser.add_argument("--reference-audio", required=True, type=Path)
    parser.add_argument("--reference-text-file", required=True, type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--consent-confirmed", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--root")
    parser.add_argument("--comfy-url", default=DEFAULT_COMFY_URL)
    parser.add_argument("--cosy-url", default=DEFAULT_COSY_URL)
    args = parser.parse_args()

    if not args.dry_run and not args.consent_confirmed:
        raise PromptusVoiceError("Refusing to install fixed-reference presets without --consent-confirmed")
    reference_text = require_reference_files(args.reference_audio, args.reference_text_file)
    root = discover_install_root(args.root)
    advanced = get_node_info(args.comfy_url, "F5TTSAudioAdvanced")
    if not advanced:
        raise PromptusVoiceError(
            "F5TTSAudioAdvanced is not exposed by this ComfyUI build. Use the basic reusable cosyflow; do not label simple-node presets as NFE/guidance modes."
        )
    if not get_node_info(args.comfy_url, "SaveAudio"):
        raise PromptusVoiceError("SaveAudio is not available")

    flows = get_cosyflows(args.cosy_url)
    audio_name = f"{slugify(args.voice_name)}-reference{args.reference_audio.suffix.lower()}"
    input_audio = comfy_root(root) / "input" / "F5-TTS" / audio_name
    input_text = input_audio.with_suffix(".txt")
    reference_relative = str(Path("F5-TTS") / audio_name)
    mode_flows = [
        build_mode_flow(
            voice_name=args.voice_name, mode_name=name, nfe=nfe, guidance=guidance, usage=usage,
            node_info=advanced, reference_filename=reference_relative, reference_text=reference_text,
        )
        for name, nfe, guidance, usage in MODES
    ]

    for flow in mode_flows:
        target = local_cosyflow_dir(root) / title_to_filename(flow["title"])
        if (find_cosyflow(flows, flow["title"]) or target.exists()) and not args.force:
            raise PromptusVoiceError(f"Preset already exists: {flow['title']}. Use --force only after review.")

    print(f"Promptus root: {root}")
    print(f"Reference copy: {input_audio}")
    for flow in mode_flows:
        print(f"Preset: {flow['title']} — {flow['description']}")
    if args.dry_run:
        print("PLAN: copy the audio and UTF-8 transcript sidecar into the active ComfyUI input directory")
        print("PLAN: install three fixed-reference cosyflows through /api/cosy/install-local")
        return 0

    backup = copy_with_backup(args.reference_audio.resolve(), input_audio, force=args.force)
    if backup:
        print(f"Backup: {backup}")
    transcript_source = args.reference_text_file.resolve()
    backup = copy_with_backup(transcript_source, input_text, force=args.force)
    if backup:
        print(f"Backup: {backup}")

    for flow in mode_flows:
        target = local_cosyflow_dir(root) / title_to_filename(flow["title"])
        if target.exists() and args.force:
            print(f"Backup: {backup_file(target)}")
        response = install_local_cosyflow(args.cosy_url, flow)
        print(f"Installed {flow['title']}: {json.dumps(response, ensure_ascii=False)}")
    print("Restart Cosy from Promptus Server before using the modes.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PromptusVoiceError as exc:
        print(f"ERROR: {exc}")
        raise SystemExit(2)
