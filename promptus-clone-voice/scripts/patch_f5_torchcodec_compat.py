#!/usr/bin/env python3
"""Patch the installed F5 inference loader with a safe SoundFile WAV fallback."""

from __future__ import annotations

import argparse
from pathlib import Path

from promptus_voice_common import PromptusVoiceError, backup_file, comfy_root, discover_install_root


IMPORT_MARKER = "import numpy as np\nimport torch\n"
CACHE_MARKER = "_ref_audio_cache = {}\n_ref_text_cache = {}\n"
LOAD_MARKER = "    audio, sr = torchaudio.load(ref_audio)\n"
HELPER = '''

def load_audio_compat(path):
    """Use SoundFile when TorchAudio 2.9+ cannot load TorchCodec's FFmpeg DLLs."""
    try:
        return torchaudio.load(path)
    except RuntimeError as exc:
        if "Could not load libtorchcodec" not in str(exc):
            raise
        audio, sample_rate = sf.read(path, dtype="float32", always_2d=True)
        return torch.from_numpy(audio.T.copy()), sample_rate
'''


def target_path(root: Path) -> Path:
    return (
        comfy_root(root)
        / "custom_nodes"
        / "comfyui-f5-tts"
        / "F5-TTS"
        / "src"
        / "f5_tts"
        / "infer"
        / "utils_infer.py"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    target = target_path(discover_install_root(args.root))
    if not target.is_file():
        raise PromptusVoiceError(f"F5 inference loader not found: {target}")
    source = target.read_text(encoding="utf-8")
    if "def load_audio_compat(path):" in source:
        print(f"Already patched: {target}")
        return 0
    missing = [marker.strip() for marker in (IMPORT_MARKER, CACHE_MARKER, LOAD_MARKER) if marker not in source]
    if missing:
        raise PromptusVoiceError(
            "Installed F5 source differs from the tested package; refusing an unsafe patch. "
            f"Missing markers: {missing}"
        )

    patched = source.replace(IMPORT_MARKER, "import numpy as np\nimport soundfile as sf\nimport torch\n", 1)
    patched = patched.replace(CACHE_MARKER, CACHE_MARKER + HELPER, 1)
    patched = patched.replace(LOAD_MARKER, "    audio, sr = load_audio_compat(ref_audio)\n", 1)
    compile(patched, str(target), "exec")
    print(f"Target: {target}")
    print("Change: preserve TorchAudio normally; fall back to installed SoundFile only when libtorchcodec cannot load")
    if args.dry_run:
        print("DRY RUN: no files changed")
        return 0

    backup = backup_file(target)
    target.write_text(patched, encoding="utf-8")
    print(f"Backup: {backup}")
    print("Patched. Restart ComfyUI through Promptus PManager before testing.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PromptusVoiceError as exc:
        print(f"ERROR: {exc}")
        raise SystemExit(2)
