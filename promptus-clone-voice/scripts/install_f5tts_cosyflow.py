#!/usr/bin/env python3
"""Install F5 dependencies and a reusable basic voice cosyflow through Promptus."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

from promptus_voice_common import (
    DEFAULT_COMFY_URL,
    DEFAULT_COSY_URL,
    F5_COSYFLOW_TITLE,
    PromptusVoiceError,
    backup_file,
    comfy_root,
    copy_with_backup,
    cosyflow_template_path,
    discover_install_root,
    find_cosyflow,
    get_cosyflows,
    get_node_info,
    install_dependencies,
    install_local_cosyflow,
    local_cosyflow_dir,
    native_voice_title,
    read_json,
    require_reference_files,
    slugify,
    title_to_filename,
)


def default_for(spec: object) -> object | None:
    if isinstance(spec, list) and len(spec) > 1 and isinstance(spec[1], dict) and "default" in spec[1]:
        return spec[1]["default"]
    if isinstance(spec, list) and spec and isinstance(spec[0], list) and spec[0]:
        return spec[0][0]
    return None


def build_voice_flow(template: dict, voice_name: str, node_info: dict, reference_filename: str) -> dict:
    flow = copy.deepcopy(template)
    slug = slugify(voice_name)
    title = native_voice_title(voice_name)
    flow["title"] = title
    flow["category"] = "Promptus/Cosy/Audio"
    flow["tags"] = ["Audio", "Voice Cloning"]
    flow["description"] = "Clone a consented local voice using F5TTS_v1_Base."

    f5_prompt_ids = [
        str(node_id)
        for node_id, node in flow.get("prompt", {}).items()
        if isinstance(node, dict) and node.get("class_type") == "F5TTSAudio"
    ]
    if len(f5_prompt_ids) != 1:
        raise PromptusVoiceError(
            f"Bundled F5 template must contain one F5TTSAudio prompt node; found {len(f5_prompt_ids)}"
        )
    f5_node_id = f5_prompt_ids[0]

    variables = flow.get("variables", {})
    variables.pop("sample", None)
    if "model" in variables:
        variables["f5_model"] = variables.pop("model")
        variables["f5_model"]["title"] = "F5-TTS Audio: model"
    if "speech" in variables:
        variables["speech"]["title"] = "F5-TTS Audio: speech"
        variables["speech"]["default"] = "Enter the consented narration here."
    if "speed" in variables:
        variables["speed"]["title"] = "F5-TTS Audio: speed"

    flow["assignments"] = [
        assignment for assignment in flow.get("assignments", []) if assignment.get("variable") != "sample"
    ]
    for assignment in flow["assignments"]:
        if assignment.get("variable") == "model":
            assignment["variable"] = "f5_model"

    required = node_info.get("input", {}).get("required", {})
    if not isinstance(required, dict):
        raise PromptusVoiceError("F5TTSAudio has an invalid input schema")
    model_type_spec = required.get("model_type")
    if model_type_spec is not None:
        model_type_default = default_for(model_type_spec) or "F5TTS_v1_Base"
        options = model_type_spec[0] if isinstance(model_type_spec, list) and model_type_spec else []
        variables["f5_model_type"] = {
            "node_title": "F5-TTS Audio", "input_title": "model_type", "title": "F5-TTS Audio: model type",
            "default": model_type_default, "type": "enum", "importance": 3, "required": True,
            "options": options if isinstance(options, list) else [],
        }
        flow["assignments"].append(
            {"node_id": f5_node_id, "input_name": "model_type", "variable": "f5_model_type"}
        )

    save_prefix = f"promptus_voice/{slug}"
    preview_ids: set[str] = set()
    for node in flow.get("workflow", {}).get("nodes", []):
        if node.get("type") == "PreviewAudio":
            preview_ids.add(str(node.get("id")))
            node["type"] = "SaveAudio"
            node["widgets_values"] = [save_prefix]
            properties = node.setdefault("properties", {})
            properties["cnr_id"] = "comfy-core"
            properties["Node name for S&R"] = "SaveAudio"

    f5_prompt_inputs: dict[str, object] | None = None
    for node_id, node in flow.get("prompt", {}).items():
        if node.get("class_type") == "F5TTSAudio":
            inputs = node.setdefault("inputs", {})
            inputs["sample"] = reference_filename
            if model_type_spec is not None:
                inputs["model_type"] = variables["f5_model_type"]["default"]
            f5_prompt_inputs = inputs
        if str(node_id) in preview_ids or node.get("class_type") == "PreviewAudio":
            node["class_type"] = "SaveAudio"
            node.setdefault("inputs", {})["filename_prefix"] = save_prefix
            node.setdefault("_meta", {})["title"] = "SaveAudio"

    all_specs = {
        **required,
        **(node_info.get("input", {}).get("optional", {}) or {}),
    }
    if f5_prompt_inputs is None:
        raise PromptusVoiceError("Bundled F5 template prompt is missing F5TTSAudio inputs")
    for node in flow.get("workflow", {}).get("nodes", []):
        if node.get("type") == "F5TTSAudio":
            node["widgets_values"] = [
                f5_prompt_inputs[name]
                for name in all_specs
                if name in f5_prompt_inputs and not isinstance(f5_prompt_inputs[name], list)
            ]

    if not preview_ids:
        raise PromptusVoiceError("Bundled F5 template has no PreviewAudio node to convert")
    return flow


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voice-name", required=True)
    parser.add_argument("--reference-audio", type=Path)
    parser.add_argument("--reference-text-file", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--consent-confirmed", action="store_true")
    parser.add_argument("--install-dependencies", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--root")
    parser.add_argument("--comfy-url", default=DEFAULT_COMFY_URL)
    parser.add_argument("--cosy-url", default=DEFAULT_COSY_URL)
    args = parser.parse_args()

    if not args.dry_run and not args.consent_confirmed:
        raise PromptusVoiceError("Refusing to install a voice preset without --consent-confirmed")

    root = discover_install_root(args.root)
    template_path = cosyflow_template_path(root)
    if not template_path.is_file():
        raise PromptusVoiceError(f"Promptus F5 template not found: {template_path}")

    flows = get_cosyflows(args.cosy_url)
    package = find_cosyflow(flows, F5_COSYFLOW_TITLE)
    if not package:
        raise PromptusVoiceError(f"Promptus does not catalogue {F5_COSYFLOW_TITLE}")

    node_info = get_node_info(args.comfy_url, "F5TTSAudio")
    node_present = node_info is not None
    package_status = package.get("install_status", "unknown")
    print(f"Promptus root: {root}")
    print(f"F5 package: {F5_COSYFLOW_TITLE} ({package_status})")
    print(f"F5TTSAudio active: {'yes' if node_present else 'no'}")

    if not node_present:
        if args.dry_run:
            print("PLAN: install dependency 'comfyui-f5-tts' through the Promptus Cosy worker")
            print("PLAN: restart ComfyUI from Promptus Server, then rerun this installer")
            return 2
        if not args.install_dependencies:
            raise PromptusVoiceError(
                "F5TTSAudio is missing. Rerun with --install-dependencies, restart ComfyUI from Promptus Server, then rerun."
            )
        print("Installing F5 dependencies through Promptus. This can take several minutes...")
        response = install_dependencies(args.cosy_url, F5_COSYFLOW_TITLE)
        print(f"Dependency installer response: {json.dumps(response, ensure_ascii=False)}")
        print("RESTART REQUIRED: restart ComfyUI from Promptus Server, then rerun without --install-dependencies.")
        return 3

    if args.reference_audio is None or args.reference_text_file is None:
        raise PromptusVoiceError(
            "The active F5 node requires a fixed reference pair. Supply --reference-audio and --reference-text-file."
        )
    require_reference_files(args.reference_audio, args.reference_text_file)
    slug = slugify(args.voice_name)
    reference_name = f"{slug}-reference{args.reference_audio.suffix.lower()}"
    reference_relative = str(Path("F5-TTS") / reference_name)
    input_audio = comfy_root(root) / "input" / "F5-TTS" / reference_name
    input_text = input_audio.with_suffix(".txt")

    flow = build_voice_flow(read_json(template_path), args.voice_name, node_info, reference_relative)
    title = flow["title"]
    target = local_cosyflow_dir(root) / title_to_filename(title)
    existing = find_cosyflow(flows, title)
    print(f"Voice cosyflow: {title}")
    print(f"Target: {target}")
    print(f"Fixed reference copy: {input_audio}")

    if existing or target.exists():
        if not args.force:
            raise PromptusVoiceError("Voice cosyflow already exists. Use --force only after reviewing the target.")
        if target.exists() and not args.dry_run:
            print(f"Backup: {backup_file(target)}")

    if args.dry_run:
        print("PLAN: copy the audio and matching UTF-8 transcript into ComfyUI input/F5-TTS")
        print("PLAN: convert PreviewAudio to SaveAudio for persistent output")
        print("PLAN: expose narration and supported generation controls; keep the reference fixed")
        print("PLAN: POST the generated cosyflow to Promptus /api/cosy/install-local")
        return 0

    backup = copy_with_backup(args.reference_audio.resolve(), input_audio, force=args.force)
    if backup:
        print(f"Backup: {backup}")
    backup = copy_with_backup(args.reference_text_file.resolve(), input_text, force=args.force)
    if backup:
        print(f"Backup: {backup}")

    response = install_local_cosyflow(args.cosy_url, flow)
    print(f"Installed: {title}")
    print(f"Response: {json.dumps(response, ensure_ascii=False)}")
    print("Restart Cosy from Promptus Server before selecting the new model in Playground.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PromptusVoiceError as exc:
        print(f"ERROR: {exc}")
        raise SystemExit(2)
