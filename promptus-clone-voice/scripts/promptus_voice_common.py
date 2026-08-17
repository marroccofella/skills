#!/usr/bin/env python3
"""Shared, dependency-free helpers for the Promptus voice-cloning scripts."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any


DEFAULT_COMFY_URL = "http://127.0.0.1:8288"
DEFAULT_COSY_URL = "http://127.0.0.1:8190"
DEFAULT_PMANAGER_URL = "http://127.0.0.1:7412"
F5_COSYFLOW_TITLE = "(cosy) Promptus: Audio F5TTS"
SUPPORTED_AUDIO_SUFFIXES = {".wav", ".flac", ".mp3", ".m4a", ".ogg"}


class PromptusVoiceError(RuntimeError):
    """A user-actionable Promptus voice workflow error."""


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def discover_install_root(explicit_root: str | None = None) -> Path:
    """Find the Promptus installation without reading unrelated user data."""
    candidates: list[Path] = []
    if explicit_root:
        candidates.append(Path(explicit_root).expanduser())

    env_root = os.environ.get("PROMPTUS_INSTALL_ROOT")
    if env_root:
        candidates.append(Path(env_root).expanduser())

    user_data = os.environ.get("PROMPTUS_USER_DATA")
    if user_data:
        install_json = Path(user_data).expanduser() / "install.json"
        try:
            if install_json.is_file():
                value = read_json(install_json).get("installRoot")
                if value:
                    candidates.append(Path(value))
        except (OSError, ValueError, AttributeError):
            pass

    appdata = os.environ.get("APPDATA")
    if appdata:
        install_json = Path(appdata) / "promptusai" / "install.json"
        try:
            if install_json.is_file():
                value = read_json(install_json).get("installRoot")
                if value:
                    candidates.append(Path(value))
        except (OSError, ValueError, AttributeError):
            pass

    localappdata = os.environ.get("LOCALAPPDATA")
    if localappdata:
        candidates.append(Path(localappdata) / "PromptusAI")

    for candidate in candidates:
        try:
            resolved = candidate.resolve()
            if (resolved / "promptusai.exe").is_file() and (resolved / "cosy").is_dir():
                return resolved
        except OSError:
            continue

    checked = ", ".join(str(path) for path in candidates) or "no candidates"
    raise PromptusVoiceError(f"Promptus install root not found. Checked: {checked}")


def promptus_python(install_root: Path) -> Path:
    return install_root / "cosy" / "venv" / "Scripts" / "python.exe"


def comfy_root(install_root: Path) -> Path:
    return install_root / "cosy" / "comfyui" / "ComfyUI"


def cosyflow_template_path(install_root: Path) -> Path:
    return install_root / "cosy" / "promptus" / "cosyflow" / "promptus_audio_f5tts.cosy"


def backend_cosy_config(install_root: Path, backend: str = "comfy_models") -> dict[str, Any]:
    """Read only the COSY section of a Promptus backend config.

    The same file holds account numbers and provider API keys in other sections. Never read,
    print, or copy those.
    """
    try:
        data = read_json(install_root / "models" / backend / "cosy.json")
    except (OSError, ValueError):
        return {}
    section = data.get("COSY") if isinstance(data, dict) else None
    return section if isinstance(section, dict) else {}


def local_cosyflow_dir(install_root: Path, backend: str = "comfy_models") -> Path:
    """Resolve the installed-cosyflow directory the way the Cosy worker does.

    Promptus declares it per backend as COSY.COSYFLOW_LOCAL_DIR; `models/cosyflow` is only the
    documented fallback and does not exist on every installation. Cosy prints the directory it
    watched at startup, which is the authoritative check.
    """
    value = backend_cosy_config(install_root, backend).get("COSYFLOW_LOCAL_DIR")
    if isinstance(value, str) and value.strip():
        candidate = Path(value.strip())
        return candidate if candidate.is_absolute() else install_root / candidate
    return install_root / "models" / "cosyflow"


def title_to_filename(title: str) -> str:
    value = title.lower()
    for char in (" ", ":", "/", "\\"):
        value = value.replace(char, "_")
    return value + ".cosy"


def slugify(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-.")
    if not value:
        raise PromptusVoiceError("Voice name must contain at least one letter or number")
    return value[:80]


def native_voice_title(voice_name: str, variant: str | None = None) -> str:
    """Build the ASCII title pattern used by Promptus-authored local cosyflows."""
    label = slugify(voice_name).replace("-", " ").replace("_", " ").strip()
    title = f"(cosy) Promptus: Local Voice {label}"
    return f"{title} [{variant}]" if variant else title


def json_request(
    url: str,
    *,
    method: str = "GET",
    payload: Any | None = None,
    timeout: float = 15,
) -> tuple[int, Any]:
    headers = {"Accept": "application/json"}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
            if not body:
                parsed = None
            else:
                decoded = body.decode("utf-8", errors="replace")
                try:
                    parsed = json.loads(decoded)
                except json.JSONDecodeError:
                    parsed = decoded
            return response.status, parsed
    except urllib.error.HTTPError as exc:
        body = exc.read()
        try:
            parsed = json.loads(body.decode("utf-8")) if body else None
        except (UnicodeDecodeError, json.JSONDecodeError):
            parsed = {"error": f"HTTP {exc.code}"}
        return exc.code, parsed
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise PromptusVoiceError(f"Cannot reach {url}: {exc}") from exc


def get_node_info(comfy_url: str, node_name: str) -> dict[str, Any] | None:
    encoded = urllib.parse.quote(node_name, safe="")
    status, data = json_request(f"{comfy_url.rstrip('/')}/object_info/{encoded}")
    if status != 200 or not isinstance(data, dict):
        return None
    value = data.get(node_name)
    return value if isinstance(value, dict) else None


def get_cosyflows(cosy_url: str) -> list[dict[str, Any]]:
    status, data = json_request(f"{cosy_url.rstrip('/')}/api/generate/get-cosyflows")
    if status not in (200, 201) or not isinstance(data, list):
        raise PromptusVoiceError(f"Cosy returned HTTP {status} for get-cosyflows")
    return [item for item in data if isinstance(item, dict)]


def find_cosyflow(cosyflows: list[dict[str, Any]], title: str) -> dict[str, Any] | None:
    return next((item for item in cosyflows if item.get("title") == title), None)


def install_dependencies(cosy_url: str, title: str, timeout: float = 600) -> Any:
    encoded = urllib.parse.quote(title, safe="")
    status, data = json_request(
        f"{cosy_url.rstrip('/')}/api/cosy/install-dependencies/{encoded}",
        method="POST",
        payload={},
        timeout=timeout,
    )
    if status not in (200, 201):
        message = data.get("error") if isinstance(data, dict) else data
        raise PromptusVoiceError(f"Dependency installation failed (HTTP {status}): {message}")
    return data


def install_local_cosyflow(cosy_url: str, cosyflow: dict[str, Any], timeout: float = 600) -> Any:
    status, data = json_request(
        f"{cosy_url.rstrip('/')}/api/cosy/install-local",
        method="POST",
        payload={"cosyflow": cosyflow},
        timeout=timeout,
    )
    if status not in (200, 201):
        message = data.get("error") if isinstance(data, dict) else data
        raise PromptusVoiceError(f"Local cosyflow installation failed (HTTP {status}): {message}")
    return data


def pmanager_status(pmanager_url: str = DEFAULT_PMANAGER_URL) -> dict[str, str]:
    status, data = json_request(f"{pmanager_url.rstrip('/')}/status")
    if status != 200 or not isinstance(data, list):
        raise PromptusVoiceError(f"PManager returned HTTP {status} for status")
    return {
        str(item.get("name")): str(item.get("status"))
        for item in data
        if isinstance(item, dict) and item.get("name")
    }


def backup_file(path: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = path.with_name(f"{path.name}.{stamp}.bak")
    shutil.copy2(path, backup)
    return backup


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def copy_with_backup(source: Path, destination: Path, *, force: bool) -> Path | None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    backup: Path | None = None
    if destination.exists():
        if sha256(source) == sha256(destination):
            return None
        if not force:
            raise PromptusVoiceError(f"Target already exists and differs: {destination}. Use --force after review.")
        backup = backup_file(destination)
    shutil.copy2(source, destination)
    return backup


def require_reference_files(audio: Path, transcript: Path) -> str:
    if not audio.is_file():
        raise PromptusVoiceError(f"Reference audio not found: {audio}")
    if audio.suffix.lower() not in SUPPORTED_AUDIO_SUFFIXES:
        raise PromptusVoiceError(f"Unsupported reference audio type: {audio.suffix}")
    if not transcript.is_file():
        raise PromptusVoiceError(f"Reference transcript not found: {transcript}")
    text = transcript.read_text(encoding="utf-8-sig").strip()
    if not text:
        raise PromptusVoiceError("Reference transcript is empty")
    return text
