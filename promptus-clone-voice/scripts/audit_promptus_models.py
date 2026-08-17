#!/usr/bin/env python3
"""Read-only audit of Promptus model storage: what is loaded, what is orphaned, what is duplicated.

Promptus's own `external_model_dependencies` is not a complete usage index — it does not resolve
models referenced inside subgraph nodes, which the worker itself reports as `custom_nodes.dependencies:
need special handling for WorkflowNode(type=workflow>...)`. Deleting on that basis destroys files that
active cosyflows load. This audit walks every node instead, and ignores documentation notes, which
mention filenames without loading them.

This script never deletes anything.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

from promptus_voice_common import (
    PromptusVoiceError,
    backend_cosy_config,
    comfy_root,
    discover_install_root,
    local_cosyflow_dir,
)


MODEL_SUFFIXES = {".safetensors", ".ckpt", ".gguf", ".pt", ".pth", ".bin", ".onnx", ".sft"}
NOTE_TYPES = {"Note", "MarkdownNote"}
SIZE_UNITS = {"B": 1, "KB": 2**10, "MB": 2**20, "GB": 2**30, "TB": 2**40}


def parse_size(value: Any) -> int | None:
    match = re.fullmatch(r"\s*([0-9.]+)\s*([KMGT]?B)\s*", str(value), re.IGNORECASE)
    if not match:
        return None
    return int(float(match.group(1)) * SIZE_UNITS[match.group(2).upper()])


def model_names(value: Any) -> set[str]:
    """Collect model-looking filenames from any nested JSON value."""
    found: set[str] = set()
    if isinstance(value, str):
        name = value.replace("\\", "/").rsplit("/", 1)[-1]
        if Path(name).suffix.casefold() in MODEL_SUFFIXES:
            found.add(name)
    elif isinstance(value, dict):
        for item in value.values():
            found |= model_names(item)
    elif isinstance(value, list):
        for item in value:
            found |= model_names(item)
    return found


def loaded_by(document: Any) -> set[str]:
    """Model filenames an executable node would actually load.

    Reads API-format `prompt` inputs and editor-format `widgets_values`, skipping note nodes.
    """
    referenced: set[str] = set()
    if not isinstance(document, dict):
        return referenced
    prompt = document.get("prompt")
    if isinstance(prompt, dict):
        for node in prompt.values():
            if isinstance(node, dict):
                referenced |= model_names(node.get("inputs"))
    graphs = [document] if isinstance(document.get("nodes"), list) else []
    workflow = document.get("workflow")
    if isinstance(workflow, dict) and isinstance(workflow.get("nodes"), list):
        graphs.append(workflow)
    for graph in graphs:
        for node in graph.get("nodes", []):
            if isinstance(node, dict) and node.get("type") not in NOTE_TYPES:
                referenced |= model_names(node.get("widgets_values"))
    return referenced


def graph_sources(root: Path, backend: str) -> list[Path]:
    directories = [
        root / "cosy" / "promptus" / "cosyflow",
        local_cosyflow_dir(root, backend),
        comfy_root(root) / "user" / "default" / "workflows",
    ]
    paths: list[Path] = []
    for directory in directories:
        if not directory.is_dir():
            continue
        for current, _dirs, files in os.walk(directory):
            paths.extend(Path(current) / name for name in files)
    return paths


def models_dir(root: Path, backend: str) -> Path:
    value = backend_cosy_config(root, backend).get("MODELS_DIR")
    if isinstance(value, str) and value.strip():
        candidate = Path(value.strip())
        return candidate if candidate.is_absolute() else root / candidate
    return root / "models"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(8 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", help="Confirmed Promptus install root override")
    parser.add_argument("--backend", default="comfy_models", help="Promptus generation backend")
    parser.add_argument("--hash-duplicates", action="store_true",
                        help="Hash same-size files to prove byte-identical duplicates (slow)")
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    root = discover_install_root(args.root)
    store = models_dir(root, args.backend)
    if not store.is_dir():
        raise PromptusVoiceError(f"Models directory not found: {store}")

    sources = graph_sources(root, args.backend)
    referenced: dict[str, list[str]] = defaultdict(list)
    for path in sources:
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        for name in loaded_by(document):
            referenced[name].append(path.name)

    inventory: list[tuple[int, Path]] = []
    stubs: list[tuple[int, Path]] = []
    for current, _dirs, files in os.walk(store):
        if "cosyflow" in Path(current).parts:
            continue
        for name in files:
            path = Path(current) / name
            try:
                size = path.stat().st_size
            except OSError:
                continue
            if name.endswith(".error"):
                stubs.append((size, path))
            elif path.suffix.casefold() in MODEL_SUFFIXES:
                inventory.append((size, path))

    orphans = sorted(((s, p) for s, p in inventory if p.name not in referenced), reverse=True)
    duplicates: list[list[str]] = []
    by_size: dict[int, list[Path]] = defaultdict(list)
    for size, path in inventory:
        by_size[size].append(path)
    for size, paths in by_size.items():
        if len(paths) < 2:
            continue
        if not args.hash_duplicates:
            duplicates.append([str(p) for p in paths])
            continue
        groups: dict[str, list[Path]] = defaultdict(list)
        for path in paths:
            groups[sha256(path)].append(path)
        duplicates.extend([str(p) for p in group] for group in groups.values() if len(group) > 1)

    total = sum(size for size, _ in inventory)
    budget = parse_size(backend_cosy_config(root, args.backend).get("MAXIMUM_MODELS_SIZE"))
    report: dict[str, Any] = {
        "backend": args.backend,
        "models_dir": str(store),
        "graphs_scanned": len(sources),
        "model_files": len(inventory),
        "models_size_gb": round(total / 2**30, 2),
        "budget_gb": round(budget / 2**30, 2) if budget else None,
        "headroom_gb": round((budget - total) / 2**30, 2) if budget else None,
        "orphans": [{"gb": round(s / 2**30, 2), "path": str(p)} for s, p in orphans],
        "orphan_total_gb": round(sum(s for s, _ in orphans) / 2**30, 2),
        "error_stubs": [str(p) for _s, p in stubs],
        "same_size_groups" if not args.hash_duplicates else "identical_groups": duplicates,
    }

    if args.as_json:
        print(json.dumps(report, indent=2))
    else:
        print(f"Backend      : {args.backend}")
        print(f"Models dir   : {store}")
        print(f"Graphs read  : {len(sources)} cosyflows and published workflows")
        print(f"Model files  : {len(inventory)}  ({total / 2**30:.2f} GB)")
        if budget:
            print(f"Budget       : {budget / 2**30:.2f} GB  (headroom {(budget - total) / 2**30:.2f} GB)")
        print(f"\nLoaded by at least one executable node: {len(referenced)} distinct filenames")
        print(f"Orphaned (loaded by nothing): {len(orphans)} files, {report['orphan_total_gb']} GB")
        for size, path in orphans:
            print(f"  {size / 2**30:8.2f} GB  {path.relative_to(store)}")
        if stubs:
            print(f"\nFailed-download stubs: {len(stubs)}")
            for _size, path in stubs:
                print(f"  {path.relative_to(store)}")
        if duplicates:
            label = "Byte-identical" if args.hash_duplicates else "Same size (rerun with --hash-duplicates to confirm)"
            print(f"\n{label} groups: {len(duplicates)}")
            for group in duplicates:
                for item in group:
                    print(f"  {Path(item).relative_to(store)}")
                print()
        print("\nNothing was deleted. Review each orphan before removing it: a file can also be")
        print("selected manually in Playground or ComfyUI without appearing in any saved graph.")

    if budget and total > budget:
        return 2
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PromptusVoiceError as exc:
        print(f"ERROR: {exc}")
        raise SystemExit(2)
