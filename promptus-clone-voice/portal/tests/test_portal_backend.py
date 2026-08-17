from __future__ import annotations

import copy
import ast
import importlib.util
import io
import json
import math
import tempfile
import time
from pathlib import Path
from unittest import mock

import numpy as np
import soundfile as sf


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("promptus_f5_portal_app", ROOT / "app.py")
assert SPEC and SPEC.loader
portal = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(portal)
import promptus_audio_quality as quality


def expect_error(callable_, expected: str) -> None:
    try:
        callable_()
    except portal.PromptusVoiceError as exc:
        assert expected.casefold() in str(exc).casefold(), str(exc)
    else:
        raise AssertionError(f"Expected PromptusVoiceError containing {expected!r}")


def test_controls() -> None:
    poetic = portal.generation_controls("poetic", None)
    assert poetic == {
        "speed": 1.07,
        "nfe_step": 32,
        "cfg_strength": 2.0,
        "cross_fade_duration": 0.15,
        "sway_sampling_coef": -1.0,
        "speed_type": "F5TTS",
    }
    expect_error(lambda: portal.generation_controls("natural", {"speed_type": "TDHS"}), "TDHS is disabled")
    expect_error(lambda: portal.generation_controls("natural", {"speed": 2.0}), "between")


def test_segmentation() -> None:
    text = " ".join(f"Sentence {index} carries a complete thought." for index in range(90))
    sections = portal.split_narration(text, maximum=300)
    assert len(sections) > 2
    assert all(0 < len(section) <= 300 for section in sections)
    assert " ".join(sections) == text
    paragraphs = portal.split_narration("First line.\nSecond line.\n\nSecond paragraph.", maximum=300)
    assert paragraphs == ["First line.\nSecond line.\n\nSecond paragraph."]

    formatted = "\n\n".join(
        ["**A spoken title**"] + [f"*Line {index} carries a complete thought.*" for index in range(32)]
    )
    prepared, preflight = portal.prepare_narration(formatted)
    prepared_sections = portal.split_narration(prepared, maximum=300)
    assert "*" not in prepared
    assert portal.speech_words(formatted) == portal.speech_words(prepared)
    assert len(prepared_sections) < 10
    assert preflight["formatting_cleaned"] is True


def test_master_output() -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        rate = 24000
        t = np.arange(rate, dtype=np.float32) / rate
        first = root / "first.flac"
        second = root / "second.flac"
        sf.write(first, 0.3 * np.sin(2 * math.pi * 220 * t), rate)
        sf.write(second, 0.3 * np.sin(2 * math.pi * 330 * t), rate)
        with mock.patch.object(portal, "PROMPTUS_ROOT", root), mock.patch.object(
            portal, "comfy_root", return_value=root
        ):
            detail = portal.master_output("quality-test", [{"path": str(first)}, {"path": str(second)}])
        assert detail["sections"] == 2
        assert detail["duration_seconds"] == 2.22
        assert detail["clipping_percent"] == 0.0
        assert detail["quality_approved"] is True
        assert detail["quality_flags"] == []
        assert Path(detail["path"]).is_file()

        hot = root / "hot.flac"
        sf.write(hot, 0.999 * np.sin(2 * math.pi * 220 * t), rate)
        with mock.patch.object(portal, "PROMPTUS_ROOT", root), mock.patch.object(
            portal, "comfy_root", return_value=root
        ):
            single = portal.master_output("single-master", [{"path": str(hot)}])
        assert single["sections"] == 1
        assert -1.1 <= single["peak_dbfs"] <= -0.9, single
        assert "Portal-Masters" in single["path"]
        assert single["quality_approved"] is True


def test_quality_gate_fails_closed() -> None:
    with tempfile.TemporaryDirectory() as raw:
        path = Path(raw) / "tone.wav"
        sf.write(path, np.full(24000, 0.1, dtype=np.float32), 24000)
        with mock.patch.object(quality, "np", None), mock.patch.object(
            quality, "_NUMPY_ERROR", ImportError("test missing numpy")
        ):
            expect_error(lambda: quality.verify_audio(path), "refusing to approve")

        internal_pause = Path(raw) / "internal-pause.wav"
        tone = 0.2 * np.sin(2 * math.pi * 220 * np.arange(24000, dtype=np.float32) / 24000)
        sf.write(internal_pause, np.concatenate((tone, np.zeros(24000, dtype=np.float32), tone)), 24000)
        expect_error(lambda: quality.verify_audio(internal_pause), "excess_silence")


def post_headers() -> dict[str, str]:
    return {"X-Promptus-Portal-Token": portal.PORTAL_TOKEN}


LOG_SOURCE_IDS = {
    "launcher", "comfyui", "cosyflow", "comfyui_user",
    "cworker", "queue", "debug", "main", "comfyui_prev",
    "comfy_output", "portal_history",
}
LOG_SCAN_SOURCES = {"launcher", "comfyui", "cosyflow", "comfyui_user"}
LOG_METADATA_SOURCES = LOG_SOURCE_IDS - LOG_SCAN_SOURCES
MAX_LOG_SCAN_BYTES = 1024 * 1024


def source_value(source: object, name: str) -> object:
    if isinstance(source, dict):
        return source.get(name)
    return getattr(source, name, None)


def normalized_sources(value: object) -> dict[str, object]:
    """Accept dict or list transport shapes while enforcing the public source IDs."""
    if isinstance(value, dict):
        return {str(key): detail for key, detail in value.items()}
    if isinstance(value, list):
        result: dict[str, object] = {}
        for detail in value:
            source_id = source_value(detail, "id") or source_value(detail, "source")
            assert isinstance(source_id, str) and source_id, detail
            result[source_id] = detail
        return result
    raise AssertionError(f"Expected diagnostic sources, received {type(value).__name__}")


def report_sources(report: dict) -> dict[str, object]:
    diagnostics = report.get("diagnostics", report)
    assert isinstance(diagnostics, dict), report
    return normalized_sources(diagnostics.get("sources"))


def report_findings(report: object) -> list[dict]:
    findings: list[dict] = []

    def walk(value: object) -> None:
        if isinstance(value, dict):
            if isinstance(value.get("code"), str):
                findings.append(value)
            for nested in value.values():
                walk(nested)
        elif isinstance(value, list):
            for nested in value:
                walk(nested)

    walk(report)
    return findings


def report_contains_value(report: object, expected: str) -> bool:
    if isinstance(report, dict):
        return any(report_contains_value(value, expected) for value in report.values())
    if isinstance(report, list):
        return any(report_contains_value(value, expected) for value in report)
    return report == expected


def create_promptus_log_tree(root: Path) -> dict[str, Path]:
    logs = root / "logs"
    user = root / "cosy" / "comfyui" / "ComfyUI" / "user"
    output = root / "cosy" / "comfyui" / "ComfyUI" / "output"
    logs.mkdir(parents=True)
    user.mkdir(parents=True)
    output.mkdir(parents=True)
    paths = {
        "launcher": root / "promptus_launcher.log",
        "comfyui": logs / "ComfyUI_log.txt",
        "cosyflow": logs / "Cosyflow_log.txt",
        "cworker": logs / "CWorker_log.txt",
        "queue": logs / "Queue_log.txt",
        "debug": logs / "Debug_log.txt",
        "main": logs / "main.log",
        "comfyui_user": user / "comfyui_8288.log",
        "comfyui_prev": user / "comfyui_8288.prev.log",
        "comfy_output": output,
    }
    for source_id, path in paths.items():
        if path.is_dir():
            continue
        path.write_text(f"{source_id} fixture\n", encoding="utf-8")
    return paths


def healthy_diagnostic_backend() -> dict:
    return {
        "comfyui": {"reachable": True, "queue_running": 0, "queue_pending": 0},
        "cosy": {
            "reachable": True, "busy_reported": False, "busy": False,
            "stale_completion_flag": False,
        },
        "portal": {"busy": False, "retained_jobs": 0},
        "accepting_jobs": True,
    }


def test_log_source_allowlist_is_exact_nonrecursive_and_portable() -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw) / "Promptus"
        history = Path(raw) / "portal-data" / "history"
        history.mkdir(parents=True)
        expected_paths = create_promptus_log_tree(root)
        unrelated = root / "logs" / "private-account.log"
        unrelated.write_text("PRIVATE SOURCE MUST NOT BE DISCOVERED", encoding="utf-8")
        nested = root / "logs" / "nested" / "ComfyUI_log.txt"
        nested.parent.mkdir()
        nested.write_text("nested decoy", encoding="utf-8")
        evil_rotation = expected_paths["comfyui_user"].parent / "comfyui_8288evil.log"
        evil_rotation.write_text("rotation decoy", encoding="utf-8")

        with mock.patch.object(portal, "HISTORY_ROOT", history), mock.patch.object(
            Path, "rglob", side_effect=AssertionError("log discovery must never recurse")
        ):
            discovered = normalized_sources(portal.discover_log_sources(root))

        assert set(discovered) == LOG_SOURCE_IDS
        assert {
            source_id for source_id, detail in discovered.items()
            if source_value(detail, "mode") == "scan"
        } == LOG_SCAN_SOURCES
        assert {
            source_id for source_id, detail in discovered.items()
            if source_value(detail, "mode") == "metadata"
        } == LOG_METADATA_SOURCES

        selected_paths = {
            Path(str(source_value(detail, "path"))).resolve()
            for detail in discovered.values()
            if source_value(detail, "path") is not None
        }
        assert unrelated.resolve() not in selected_paths
        assert nested.resolve() not in selected_paths
        assert evil_rotation.resolve() not in selected_paths
        assert Path(str(source_value(discovered["comfyui_user"], "path"))).name in {
            "comfyui.log", "comfyui_8288.log"
        }
        assert source_value(discovered["comfyui_prev"], "mode") == "metadata"
        for detail in discovered.values():
            display = str(source_value(detail, "display_path") or "")
            assert display, detail
            assert str(root).casefold() not in display.casefold(), display
            assert not Path(display).is_absolute(), display
            assert ".." not in Path(display).parts, display


def test_log_diagnostics_is_token_protected_no_store_and_accepts_job_context() -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw) / "Promptus"
        create_promptus_log_tree(root)
        job_id = "a" * 24
        with portal.JOBS_LOCK:
            portal.JOBS[job_id] = {
                "id": job_id,
                "status": "failed",
                "issue": {"code": "backend_execution", "category": "backend"},
            }
        try:
            with mock.patch.object(portal, "promptus_root", return_value=root), mock.patch.object(
                portal, "get_node_info", return_value={"available": True}
            ), mock.patch.object(
                portal, "backend_health", return_value=healthy_diagnostic_backend()
            ), mock.patch.object(portal, "asr_cache_ready", return_value=True):
                client = portal.app.test_client()
                assert client.post("/api/log-diagnostics", json={"job_id": job_id}).status_code == 403
                response = client.post(
                    "/api/log-diagnostics",
                    json={"job_id": job_id},
                    headers=post_headers(),
                )
            assert response.status_code == 200, response.get_json()
            assert "no-store" in response.headers.get("Cache-Control", "").casefold()
            report = response.get_json()
            assert report["ok"] is True
            assert report_contains_value(report, job_id), report
        finally:
            with portal.JOBS_LOCK:
                portal.JOBS.pop(job_id, None)


def test_log_diagnostics_is_bounded_uses_latest_session_and_never_returns_raw_data() -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw) / "Promptus"
        paths = create_promptus_log_tree(root)
        private_sentinel = "PRIVATE_NARRATION_SENTINEL_4dc683"
        secret = "Bearer diagnostic-secret-token"
        old_session = (
            "### ComfyUI Version: v0.29.0\n"
            "Traceback (most recent call last):\n"
            "Cannot import custom_nodes\\comfyui-f5-tts: old failure\n"
        )
        latest_session = (
            "### ComfyUI Version: v0.30.0\n"
            "8.5 seconds: C:\\Promptus\\custom_nodes\\comfyui-f5-tts\n"
            "To see the GUI go to: http://localhost:8288\n"
            "model_loader_inputs: warning: old and new tests disagree about "
            "{'input_value': 'PRIVATE_NARRATION_SENTINEL_4dc683'}\n"
            f"Authorization: {secret}\n"
        )
        paths["comfyui"].write_text(
            ("x" * (MAX_LOG_SCAN_BYTES + 8192)) + "\n" + old_session + latest_session,
            encoding="utf-8",
        )

        with mock.patch.object(portal, "promptus_root", return_value=root), mock.patch.object(
            portal, "get_node_info", return_value={"available": True}
        ), mock.patch.object(
            portal, "backend_health", return_value=healthy_diagnostic_backend()
        ), mock.patch.object(portal, "asr_cache_ready", return_value=True):
            response = portal.app.test_client().post(
                "/api/log-diagnostics", json={}, headers=post_headers()
            )
        assert response.status_code == 200, response.get_json()
        report = response.get_json()
        sources = report_sources(report)
        scanned = int(source_value(sources["comfyui"], "bytes_scanned") or 0)
        assert 0 < scanned <= MAX_LOG_SCAN_BYTES
        assert source_value(sources["comfyui"], "truncated") is True
        findings = report_findings(report)
        codes = {str(value["code"]) for value in findings}
        assert "f5_node_loaded" in codes, findings
        assert "f5_import_failed" not in codes, "an old startup session must not override the latest one"

        serialized = json.dumps(report, ensure_ascii=False).replace("\\\\", "\\")
        assert private_sentinel not in serialized
        assert secret not in serialized
        assert str(root).casefold() not in serialized.casefold()
        forbidden_transport_keys = {"path", "raw", "raw_line", "raw_lines", "line", "lines", "excerpt"}

        def all_keys(value: object) -> set[str]:
            if isinstance(value, dict):
                return set(map(str, value)) | {
                    key for nested in value.values() for key in all_keys(nested)
                }
            if isinstance(value, list):
                return {key for nested in value for key in all_keys(nested)}
            return set()

        assert not (all_keys(report) & forbidden_transport_keys), all_keys(report)


def test_log_classification_separates_benign_actionable_and_live_health() -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw) / "Promptus"
        paths = create_promptus_log_tree(root)
        paths["comfyui"].write_text(
            "### ComfyUI Version: v0.30.0\n"
            "8.5 seconds: C:\\Promptus\\custom_nodes\\comfyui-f5-tts\n"
            "CUDA out of memory\n",
            encoding="utf-8",
        )
        paths["cosyflow"].write_text(
            "worker version: 0.110\n"
            "model_loader_inputs: warning: old and new tests disagree\n"
            "install would exceed maximum models size; returning False\n",
            encoding="utf-8",
        )

        def fake_request(url: str, **_kwargs):
            if url.endswith("/queue"):
                return 200, {"queue_running": [], "queue_pending": []}
            if url.endswith("/is-busy"):
                return 201, {"busy": False}
            raise AssertionError(url)

        with mock.patch.object(portal, "promptus_root", return_value=root), mock.patch.object(
            portal, "json_request", side_effect=fake_request
        ), mock.patch.object(
            portal, "get_node_info", return_value={"available": True}
        ), mock.patch.object(portal, "asr_cache_ready", return_value=True):
            client = portal.app.test_client()
            before = client.get("/api/health").get_json()
            response = client.post("/api/log-diagnostics", json={}, headers=post_headers())
            after = client.get("/api/health").get_json()

        assert response.status_code == 200, response.get_json()
        findings = {value["code"]: value for value in report_findings(response.get_json())}
        benign = findings["advanced_node_loader_warning"]
        assert benign.get("actionable") is False
        assert str(benign.get("severity", "")).casefold() in {"advisory", "info", "benign", "ok"}
        budget = findings["models_budget_exceeded"]
        assert budget.get("actionable") is False
        assert str(budget.get("severity", "")).casefold() in {"advisory", "info", "warning"}
        actionable = findings["cuda_out_of_memory"]
        assert actionable.get("actionable") is True
        assert str(actionable.get("severity", "")).casefold() in {"attention", "blocking"}
        assert before["accepting_jobs"] is True
        assert after["accepting_jobs"] is True
        assert before["comfyui"] == after["comfyui"]
        assert before["cosy"] == after["cosy"]


def test_http_validation_and_concurrency() -> None:
    client = portal.app.test_client()
    payload = {
        "consent_confirmed": True,
        "consent_basis": "self",
        "model_title": "(cosy) Test",
        "narration": "A valid sentence.",
        "style": "natural",
    }
    assert client.post("/api/generate", json=payload).status_code == 403
    missing_basis = client.post(
        "/api/generate",
        json={key: value for key, value in payload.items() if key != "consent_basis"},
        headers=post_headers(),
    )
    assert missing_basis.status_code == 400
    assert "Consent basis" in missing_basis.json["error"]
    invalid_seed = client.post(
        "/api/generate", json={**payload, "seed": "abc"}, headers=post_headers()
    )
    assert invalid_seed.status_code == 400
    assert invalid_seed.is_json and "whole number" in invalid_seed.json["error"]
    punctuation = client.post(
        "/api/generate", json={**payload, "narration": "...!?"}, headers=post_headers()
    )
    assert punctuation.status_code == 400
    assert portal.GENERATION_SLOT.acquire(blocking=False)
    try:
        busy = client.post("/api/generate", json=payload, headers=post_headers())
        assert busy.status_code == 429
        assert busy.is_json and "already running" in busy.json["error"]
    finally:
        portal.GENERATION_SLOT.release()


def test_health_and_job_eviction() -> None:
    def fake_request(url: str, **_kwargs):
        if url.endswith("/queue"):
            return 200, {"queue_running": [], "queue_pending": []}
        if url.endswith("/is-busy"):
            return 201, {"busy": False}
        raise AssertionError(url)

    with mock.patch.object(portal, "json_request", side_effect=fake_request):
        response = portal.app.test_client().get("/api/health")
    assert response.status_code == 200
    assert response.json["accepting_jobs"] is True

    def fake_stale_cosy_request(url: str, **_kwargs):
        if url.endswith("/queue"):
            return 200, {"queue_running": [], "queue_pending": []}
        if url.endswith("/is-busy"):
            return 201, True
        raise AssertionError(url)

    with mock.patch.object(portal, "json_request", side_effect=fake_stale_cosy_request):
        stale_response = portal.app.test_client().get("/api/health")
    assert stale_response.status_code == 200
    assert stale_response.json["accepting_jobs"] is True
    assert stale_response.json["cosy"]["busy_reported"] is True
    assert stale_response.json["cosy"]["stale_completion_flag"] is True

    with tempfile.TemporaryDirectory() as raw, mock.patch.object(portal, "JOB_ROOT", Path(raw)):
        (Path(raw) / "expired").mkdir()
        with portal.JOBS_LOCK:
            portal.JOBS.clear()
            portal.JOBS["expired"] = {
                "status": "complete", "finished": time.time() - portal.JOB_RETENTION_SECONDS - 1
            }
            portal.JOBS["active"] = {"status": "running", "started": time.time()}
        assert portal.prune_jobs() == 1
        with portal.JOBS_LOCK:
            assert set(portal.JOBS) == {"active"}
            portal.JOBS.clear()
        assert not (Path(raw) / "expired").exists()


def test_installed_voice_discovery() -> None:
    flows = [
        {"title": "(cosy) Promptus: Local Voice Native [Studio]", "install_status": "INSTALLED", "tags": ["Audio", "Voice Cloning"], "custom_node_dependencies": ["comfyui-f5-tts"]},
        {"title": "(cosy) voice-c — F5 Studio", "install_status": "INSTALLED", "tags": ["Audio", "Local Voice", "F5-TTS"], "custom_node_dependencies": ["comfyui-f5-tts"]},
        {"title": "(cosy) Personal Narrator [Hero]", "install_status": "INSTALLED", "tags": ["Audio", "Voice Cloning"], "custom_node_dependencies": ["comfyui-f5-tts"]},
        {"title": "(cosy) Promptus: Audio F5TTS", "install_status": "INSTALLED", "tags": ["Audio", "Text to Audio"], "custom_node_dependencies": ["comfyui-f5-tts"]},
        {"title": "(cosy) Promptus: Local Voice Missing", "install_status": "INSTALLABLE", "tags": ["Audio", "Voice Cloning"], "custom_node_dependencies": ["comfyui-f5-tts"]},
        {"title": "(cosy) Other Engine Clone", "install_status": "INSTALLED", "tags": ["Audio", "Voice Cloning"], "custom_node_dependencies": ["another-engine"]},
    ]
    with mock.patch.object(portal, "get_cosyflows", return_value=flows):
        response = portal.app.test_client().get("/api/voices")
    assert response.status_code == 200
    assert response.json["count"] == 3
    assert response.json["voice_count"] == 3
    assert [item["title"] for item in response.json["voices"]] == [
        "(cosy) voice-c — F5 Studio",
        "(cosy) Promptus: Local Voice Native [Studio]",
        "(cosy) Personal Narrator [Hero]",
    ]
    native = response.json["voices"][1]
    assert native == {
        "title": "(cosy) Promptus: Local Voice Native [Studio]",
        "name": "Native",
        "variant": "Studio",
        "engine": "F5-TTS",
        "native": True,
        "legacy": False,
        "health": "unverified",
        "health_label": "Reference not preflighted; output gates still apply",
        "selectable": True,
    }
    assert response.json["voices"][2]["variant"] == "Hero"


def test_output_route_is_confined() -> None:
    with tempfile.TemporaryDirectory() as raw:
        comfy = Path(raw) / "comfy"
        approved = comfy / "output" / "promptus_voice"
        approved.mkdir(parents=True)
        allowed = approved / "allowed.wav"
        rejected = approved / "rejected.wav"
        outside = comfy / "output" / "outside.wav"
        sf.write(allowed, np.zeros(2400, dtype=np.float32), 24000)
        sf.write(rejected, np.zeros(2400, dtype=np.float32), 24000)
        sf.write(outside, np.zeros(2400, dtype=np.float32), 24000)
        with mock.patch.object(portal, "promptus_root", return_value=Path(raw)), mock.patch.object(
            portal, "comfy_root", return_value=comfy
        ), mock.patch.object(
            portal, "recent_job_history", return_value=[]
        ):
            client = portal.app.test_client()
            with portal.JOBS_LOCK:
                portal.JOBS["delivery-route"] = {
                    "status": "complete", "qa_status": "passed",
                    "outputs": [{
                        "audio_url": "/api/output/promptus_voice/allowed.wav",
                        "artifact_role": "verified_master", "delivery_approved": True,
                    }],
                    "diagnostic_outputs": [{
                        "audio_url": "/api/output/promptus_voice/rejected.wav",
                        "artifact_role": "unapproved_master", "delivery_approved": False,
                    }],
                }
            try:
                assert client.get("/api/output/promptus_voice/allowed.wav").status_code == 200
                assert client.get("/api/output/promptus_voice/rejected.wav").status_code == 404
                assert client.get("/api/output/outside.wav").status_code == 404
                assert client.get("/api/output/promptus_voice/allowed.txt").status_code == 404
                sanitized = portal.history_snapshot(portal.JOBS["delivery-route"])
                assert "audio_url" not in sanitized["diagnostic_outputs"][0]
            finally:
                with portal.JOBS_LOCK:
                    portal.JOBS.pop("delivery-route", None)


def test_rejected_reference_is_removed() -> None:
    with tempfile.TemporaryDirectory() as raw, mock.patch.object(
        portal, "REFERENCE_ROOT", Path(raw)
    ), mock.patch.object(
        portal, "decode_recording", side_effect=portal.PromptusVoiceError("decode rejected")
    ):
        response = portal.app.test_client().post(
            "/api/reference",
            data={"transcript": "Exact words", "audio": (io.BytesIO(b"not audio"), "take.webm")},
            headers=post_headers(),
        )
        assert response.status_code == 400
        assert list(Path(raw).iterdir()) == []


def test_reference_is_stored_below_node_target_rms() -> None:
    """The stored reference must stay below the F5 node's target_rms (0.1).

    F5 boosts a quieter reference up to target_rms for inference and scales the output down by
    rms/target_rms — the pipeline's only output headroom. A reference normalized to 0.1 removes
    that headroom entirely, and projected voices then clip at exactly 0 dBFS at the int16 write.
    """
    rng = np.random.default_rng(7)
    rate = 24000
    pattern = []
    for _ in range(20):
        # 350 ms of "speech" then 150 ms near-silence: the quiet fraction must exceed the
        # noise-floor percentile (20%) or the analyzer reads the bursts as the floor.
        pattern.append((rng.standard_normal(int(rate * 0.35)) * 0.1).astype(np.float32))
        pattern.append((rng.standard_normal(int(rate * 0.15)) * 0.001).astype(np.float32))
    take = np.concatenate(pattern)
    with tempfile.TemporaryDirectory() as raw:
        source = Path(raw) / "decoded.wav"
        destination = Path(raw) / "reference.wav"
        sf.write(source, take, rate, subtype="PCM_16")
        metrics = portal.trim_and_analyze(source, destination)
        stored, _rate = sf.read(destination, dtype="float32", always_2d=True)
        stored_rms = float(np.sqrt(np.mean(stored.mean(axis=1) ** 2)))
        assert metrics["duration_seconds"] >= 7.0
        assert stored_rms < 0.08, f"stored reference rms {stored_rms:.4f} leaves too little output headroom"
        assert abs(stored_rms - 0.05) < 0.01, f"stored reference rms {stored_rms:.4f} drifted from the 0.05 design level"


def test_reference_stays_below_f5_auto_truncation_limit() -> None:
    """Reject audio before upstream F5 can truncate it against a full transcript."""
    rng = np.random.default_rng(13)
    rate = 24000
    pattern = []
    for _ in range(24):
        pattern.append((rng.standard_normal(int(rate * 0.35)) * 0.08).astype(np.float32))
        pattern.append((rng.standard_normal(int(rate * 0.15)) * 0.001).astype(np.float32))
    with tempfile.TemporaryDirectory() as raw:
        source = Path(raw) / "too-long.wav"
        destination = Path(raw) / "reference.wav"
        sf.write(source, np.concatenate(pattern), rate, subtype="PCM_16")
        expect_error(
            lambda: portal.trim_and_analyze(source, destination),
            "so F5 does not truncate",
        )
        assert not destination.exists()


def test_silence_measurement_is_level_invariant() -> None:
    """Attenuating a render must not change how silent it is measured to be.

    The clipping repair works by storing the reference below the node's target_rms, which makes every
    render quieter. If silence were measured against full scale, that repair would push clean takes
    through the silence gate on level alone — a real 10.2% take measured 21.5% once dropped 6 dB.
    """
    rng = np.random.default_rng(29)
    rate = 24000
    pattern = []
    for _ in range(8):
        pattern.append((rng.standard_normal(int(rate * 0.6)) * 0.09).astype(np.float32))
        pattern.append((rng.standard_normal(int(rate * 0.2)) * 0.0005).astype(np.float32))
    speech = np.concatenate(pattern)

    with tempfile.TemporaryDirectory() as raw:
        loud = Path(raw) / "loud.wav"
        quiet = Path(raw) / "quiet.wav"
        sf.write(loud, speech, rate, subtype="PCM_16")
        sf.write(quiet, speech * (10 ** (-6 / 20)), rate, subtype="PCM_16")

        loud_report = quality.inspect_audio(loud)
        quiet_report = quality.inspect_audio(quiet)

        drift = abs(loud_report["silence_percent"] - quiet_report["silence_percent"])
        assert drift < 1.0, (
            f"silence moved {drift:.2f} points for the same audio 6 dB down "
            f"({loud_report['silence_percent']} vs {quiet_report['silence_percent']}); "
            "the metric is measuring loudness, not pause structure"
        )
        # The gaps here are 0.2s, so neither take may be called a dropout.
        assert loud_report["longest_silence_seconds"] < 2.5
        assert "excess_silence" not in loud_report["quality_flags"]
        assert "excess_silence" not in quiet_report["quality_flags"]


def test_long_continuous_gap_is_flagged() -> None:
    """One long dropout is a defect even when the aggregate quiet fraction passes."""
    rng = np.random.default_rng(31)
    rate = 24000
    speech = (rng.standard_normal(int(rate * 9.0)) * 0.09).astype(np.float32)
    dropout = (rng.standard_normal(int(rate * 3.0)) * 0.0005).astype(np.float32)
    with tempfile.TemporaryDirectory() as raw:
        path = Path(raw) / "dropout.wav"
        sf.write(path, np.concatenate([speech, dropout, speech]), rate, subtype="PCM_16")
        report = quality.inspect_audio(path)
        assert report["longest_silence_seconds"] > 2.5, report["longest_silence_seconds"]
        assert "long_silence_gap" in report["quality_flags"]
        assert report["quality_approved"] is False


def test_skill_package_is_current_and_carries_no_private_data() -> None:
    """The download must reflect the working tree and must never carry a recording.

    The version is a content hash computed per request, so it is the archive's identity rather than a
    number someone has to remember to bump. The allow-list matters more: this directory holds only
    instructions and scripts today, and a stray recording landing here must not be packaged for
    distribution.
    """
    import zipfile

    before = portal.skill_manifest()
    assert before["files"] > 0
    assert before["version"] in before["filename"]

    client = portal.app.test_client()
    info = client.get("/api/skill/info", headers={"Host": "127.0.0.1:8765"})
    assert info.status_code == 200
    assert info.get_json()["version"] == before["version"]

    response = client.get("/api/skill/download", headers={"Host": "127.0.0.1:8765"})
    assert response.status_code == 200
    assert response.headers["Content-Type"] == "application/zip"
    assert before["filename"] in response.headers["Content-Disposition"]

    names = zipfile.ZipFile(io.BytesIO(response.data)).namelist()
    assert f"{portal.SKILL_ROOT.name}/SKILL.md" in names
    assert any(name.endswith("/scripts/promptus_voice_common.py") for name in names)
    forbidden = (".wav", ".flac", ".mp3", ".ogg", ".m4a", ".bak", ".jsonl", ".pt", ".bin", ".safetensors")
    leaked = [n for n in names if n.casefold().endswith(forbidden) or "__pycache__" in n]
    assert not leaked, f"private or generated files would be distributed: {leaked}"

    # A change to any packaged file must change the version, or the download can go stale silently.
    probe = portal.SKILL_ROOT / "references" / "__version_probe__.md"
    try:
        probe.write_text("probe\n", encoding="utf-8")
        assert portal.skill_manifest()["version"] != before["version"]
    finally:
        probe.unlink(missing_ok=True)
    assert portal.skill_manifest()["version"] == before["version"]


def test_marginal_clipping_retry_policy() -> None:
    rejected = {"quality_flags": ["clipping"], "clipping_percent": 0.01048}
    assert portal.retryable_marginal_clipping(rejected, {"seed": -1}) is True
    assert portal.retryable_marginal_clipping(rejected, {"seed": 42}) is False
    assert portal.retryable_marginal_clipping(
        {"quality_flags": ["clipping", "possible_clicks"], "clipping_percent": 0.01048},
        {"seed": -1},
    ) is False
    assert portal.retryable_marginal_clipping(
        {"quality_flags": ["clipping"], "clipping_percent": 0.05001},
        {"seed": -1},
    ) is False


def test_word_accuracy_gate() -> None:
    approved = {
        "model": "openai/whisper-small.en",
        "normalized_reference_words": 100,
        "normalized_edit_distance": 5,
        "reference_words": 100,
        "recognized_words": 105,
    }
    with mock.patch.object(portal, "local_asr_report", return_value=approved):
        report = portal.verify_narration_words(Path("audio.flac"), Path("source.txt"))
    assert report["word_accuracy_approved"] is True
    assert report["normalized_word_error_rate_percent"] == 5.0
    assert report["recognized_word_ratio"] == 1.05

    rejected = {
        "model": "openai/whisper-small.en",
        "normalized_reference_words": 10000,
        "normalized_edit_distance": 501,
        "reference_words": 1000,
        "recognized_words": 1000,
    }
    with mock.patch.object(portal, "local_asr_report", return_value=rejected):
        report = portal.verify_narration_words(Path("audio.flac"), Path("source.txt"))
    assert report["word_accuracy_approved"] is False
    assert report["issue"]["code"] == "word_accuracy_marginal"

    rounded_ratio_would_pass = {
        "model": "openai/whisper-small.en",
        "normalized_reference_words": 1000,
        "normalized_edit_distance": 20,
        "reference_words": 1001,
        "recognized_words": 950,
        "recognized_word_ratio": 0.95,
    }
    with mock.patch.object(portal, "local_asr_report", return_value=rounded_ratio_would_pass):
        report = portal.verify_narration_words(Path("audio.flac"), Path("source.txt"))
    assert report["word_accuracy_approved"] is False
    assert report["recognized_word_ratio"] == 0.949

    invalid = {"normalized_word_error_rate_percent": float("nan"), "recognized_word_ratio": 1.0}
    with mock.patch.object(portal, "local_asr_report", return_value=invalid):
        expect_error(
            lambda: portal.verify_narration_words(Path("audio.flac"), Path("source.txt")),
            "invalid accuracy evidence",
        )


def test_whisper_verifier_uses_native_long_form_without_overlap_chunking() -> None:
    """Long narration must use Whisper's decoder, not generic overlapping seq2seq windows."""
    script = ROOT.parent / "promptus-clone-voice" / "scripts" / "transcribe_f5_quality.py"
    tree = ast.parse(script.read_text(encoding="utf-8"))
    calls = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "transcriber"
    ]
    assert len(calls) == 1
    keywords = {item.arg: item.value for item in calls[0].keywords if item.arg}
    assert "chunk_length_s" not in keywords
    assert "batch_size" not in keywords
    assert isinstance(keywords.get("return_timestamps"), ast.Constant)
    assert keywords["return_timestamps"].value is True
    source = script.read_text(encoding="utf-8")
    assert '"word_verifier_strategy": "whisper_native_long_form_v1"' in source


def test_uploaded_reference_is_transcribed_locally() -> None:
    with tempfile.TemporaryDirectory() as raw, mock.patch.object(
        portal, "REFERENCE_ROOT", Path(raw)
    ):
        def fake_decode(_source: Path, destination: Path) -> None:
            sf.write(destination, np.zeros(24000, dtype=np.float32), 24000)

        def fake_trim(_source: Path, destination: Path) -> dict:
            sf.write(destination, np.zeros(8 * 24000, dtype=np.float32), 24000)
            return {
                "duration_seconds": 8.0,
                "score": 100,
                "warnings": [],
                "snr_estimate_db": 30.0,
                "activity_percent": 80.0,
            }

        def fake_transcribe(_audio: Path, destination: Path) -> dict:
            destination.write_text(
                "My voice is clear and steady. I speak with warmth and purpose.\n",
                encoding="utf-8",
            )
            return {"recognized_words": 12}

        with mock.patch.object(portal, "decode_recording", side_effect=fake_decode), mock.patch.object(
            portal, "trim_and_analyze", side_effect=fake_trim
        ), mock.patch.object(
            portal, "transcribe_reference", side_effect=fake_transcribe
        ):
            response = portal.app.test_client().post(
                "/api/reference",
                data={
                    "automatic_transcript": "true",
                    "audio": (io.BytesIO(b"local audio"), "take.wav"),
                },
                headers=post_headers(),
            )
        assert response.status_code == 200
        assert response.json["metrics"]["transcript_source"] == "local_whisper"
        assert response.json["transcript"].startswith("My voice is clear")


def test_generation_retries_one_marginal_random_take() -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        comfy = root / "comfy"
        master = comfy / "output" / "promptus_voice" / "Portal-Masters" / "master.flac"
        master.parent.mkdir(parents=True)
        sf.write(master, np.zeros(2400, dtype=np.float32), 24000)
        job_id = "retry-test"
        controls = {**portal.STYLE_PRESETS["poetic"], "seed": -1}
        rejected = {"quality_flags": ["clipping"], "clipping_percent": 0.01048}
        approved = {"path": str(root / "approved.flac"), "quality_approved": True}
        final = {
            "path": str(master),
            "duration_seconds": 0.1,
            "quality_approved": True,
            "quality_flags": [],
            "clipping_percent": 0.0,
        }
        with portal.JOBS_LOCK:
            portal.JOBS[job_id] = {"id": job_id, "status": "queued", "events": []}
        assert portal.GENERATION_SLOT.acquire(blocking=False)
        try:
            with mock.patch.object(portal, "JOB_ROOT", root / "jobs"), mock.patch.object(
                portal,
                "execute_section_attempt",
                side_effect=[(2, [], rejected), (0, [approved], None)],
            ) as attempt, mock.patch.object(
                portal, "master_output", return_value=final
            ), mock.patch.object(
                portal, "promptus_root", return_value=root
            ), mock.patch.object(
                portal, "comfy_root", return_value=comfy
            ), mock.patch.object(
                portal,
                "verify_narration_words",
                return_value={
                    "model": "openai/whisper-small.en",
                    "normalized_word_error_rate_percent": 0.0,
                    "recognized_word_ratio": 1.0,
                    "word_accuracy_approved": True,
                },
            ), mock.patch.object(
                portal, "record_consent"
            ):
                portal.run_generation(job_id, "(cosy) Test", "A valid sentence.", controls)
            assert attempt.call_count == 2
            with portal.JOBS_LOCK:
                job = dict(portal.JOBS[job_id])
            assert job["status"] == "complete", job
            assert any(
                event.get("status") == "marginal peak detected; rendering one fresh take"
                for event in job["events"]
                if isinstance(event, dict)
            )
            assert portal.GENERATION_SLOT.acquire(blocking=False)
            portal.GENERATION_SLOT.release()
        finally:
            with portal.JOBS_LOCK:
                portal.JOBS.pop(job_id, None)


def test_master_word_rejection_keeps_structured_history() -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        comfy = root / "comfy"
        master = comfy / "output" / "promptus_voice" / "Portal-Masters" / "master.flac"
        master.parent.mkdir(parents=True)
        sf.write(master, np.zeros(2400, dtype=np.float32), 24000)
        job_id = "0123456789abcdef01234567"
        controls = {**portal.STYLE_PRESETS["poetic"], "seed": 7}
        approved_section = {"path": str(root / "section.flac"), "quality_approved": True, "sha256": "section"}
        final = {
            "path": str(master), "sha256": "master", "duration_seconds": 0.1,
            "quality_approved": True, "quality_flags": [], "clipping_percent": 0.0,
            "peak_dbfs": -10.0, "rms_dbfs": -24.0, "silence_percent": 0.0,
            "dc_offset": 0.0, "possible_clicks_percent": 0.0, "sections": 1,
        }
        rejected_words = {
            "model": "openai/whisper-small.en",
            "normalized_word_error_rate_percent": 5.54,
            "recognized_word_ratio": 1.03,
            "normalized_edit_distance": 15,
            "normalized_reference_words": 271,
            "normalized_recognized_words": 281,
            "word_accuracy_approved": False,
            "issue": {
                "code": "word_accuracy_marginal", "category": "quality",
                "stage": "master_word_check", "message": "Audio was not approved.",
                "retryable": True, "recovery": "Prepare another take.",
            },
        }
        with portal.JOBS_LOCK:
            portal.JOBS[job_id] = {
                "id": job_id, "status": "queued", "events": [], "created": time.time(),
                "model_title": "(cosy) Test", "narration_sha256": "text",
            }
        assert portal.GENERATION_SLOT.acquire(blocking=False)
        try:
            with mock.patch.object(portal, "JOB_ROOT", root / "jobs"), mock.patch.object(
                portal, "HISTORY_ROOT", root / "history"
            ), mock.patch.object(
                portal, "execute_section_attempt", return_value=(0, [approved_section], None)
            ), mock.patch.object(
                portal, "master_output", return_value=final
            ), mock.patch.object(
                portal, "promptus_root", return_value=root
            ), mock.patch.object(
                portal, "comfy_root", return_value=comfy
            ), mock.patch.object(
                portal, "verify_narration_words", return_value=rejected_words
            ), mock.patch.object(portal, "record_consent") as record:
                portal.run_generation(job_id, "(cosy) Test", "A valid sentence.", controls)
            with portal.JOBS_LOCK:
                job = dict(portal.JOBS[job_id])
            assert job["status"] == "rejected"
            assert not job.get("outputs")
            assert job["diagnostic_outputs"][0]["sha256"] == "master"
            assert job["diagnostic_outputs"][0]["word_accuracy_approved"] is False
            assert job["issue"]["code"] == "automatic_section_repair_rejected"
            assert job["repair_state"]["status"] == "exhausted"
            assert job["repair_state"]["rounds_used"] == 1
            assert job["repair_state"]["sections_checked"] == [1]
            assert len(job["repair_state"]["attempts"]) == 1
            assert (root / "history" / f"{job_id}.json").is_file()
            result_entry = record.call_args.args[0]
            assert result_entry["outcome"] == "rejected"
            assert result_entry["output_sha256"] == "master"
            assert result_entry["normalized_word_error_rate_percent"] == 5.54
        finally:
            with portal.JOBS_LOCK:
                portal.JOBS.pop(job_id, None)
            assert portal.GENERATION_SLOT.acquire(blocking=False)
            portal.GENERATION_SLOT.release()


def fixed_seed_recovery_record(job_id: str = "111111111111111111111111") -> dict:
    return {
        "id": job_id,
        "status": "running",
        "qa_status": "running",
        "model_title": "(cosy) Promptus: Local Voice Test [Studio]",
        "style": "poetic",
        "controls": {
            "speed": 1.07,
            "nfe_step": 32,
            "cfg_strength": 2.0,
            "cross_fade_duration": 0.15,
            "sway_sampling_coef": -1.0,
            "speed_type": "F5TTS",
            "seed": 2147483647,
        },
        "narration_sha256": "a" * 64,
        "reference_sha256": "b" * 64,
        "reference_transcript_sha256": "c" * 64,
        "section_count": 2,
        "preflight": {"render_sections": 2},
    }


def approved_word_report(
    *, reference_words: int = 100, recognized_words: int = 100,
    normalized_reference_words: int = 100, normalized_edit_distance: int = 0,
) -> dict:
    return {
        "model": "openai/whisper-small.en",
        "reference_words": reference_words,
        "recognized_words": recognized_words,
        "normalized_reference_words": normalized_reference_words,
        "normalized_recognized_words": recognized_words,
        "normalized_edit_distance": normalized_edit_distance,
        "normalized_substitutions": normalized_edit_distance,
        "normalized_deletions": 0,
        "normalized_insertions": 0,
        "normalized_word_error_rate_percent": round(
            normalized_edit_distance / normalized_reference_words * 100, 2
        ),
        "recognized_word_ratio": round(recognized_words / reference_words, 3),
        "word_accuracy_approved": (
            normalized_edit_distance / normalized_reference_words * 100
            <= portal.MAX_NORMALIZED_WORD_ERROR_PERCENT
            and 0.95 <= recognized_words / reference_words <= 1.05
        ),
    }


def test_prior_fixed_seed_recovery_requires_exact_current_revalidation() -> None:
    """A prior take is a cache candidate, never inherited approval evidence."""
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        comfy = root / "comfy"
        source = root / "narration-master.txt"
        source.write_text("The exact words remain unchanged.\n", encoding="utf-8")
        prior_file = (
            comfy / "output" / "promptus_voice" / "Portal-Masters" / "prior.flac"
        )
        prior_file.parent.mkdir(parents=True)
        sf.write(prior_file, np.zeros(2400, dtype=np.float32), 24000)
        prior_sha = portal.file_sha256(prior_file)

        current = fixed_seed_recovery_record()
        prior = copy.deepcopy(current)
        prior.update({
            "id": "222222222222222222222222",
            "status": "complete",
            "qa_status": "passed",
            "outputs": [{
                "audio_url": "/api/output/promptus_voice/Portal-Masters/prior.flac",
                "artifact_role": "verified_master",
                "delivery_approved": True,
                "sha256": prior_sha,
            }],
        })
        assert portal.generation_fingerprint(current)
        assert portal.generation_fingerprint(current) == portal.generation_fingerprint(prior)

        # Every synthesis-affecting field belongs to the exact-match fingerprint.
        mutations = []
        for key, value in (
            ("model_title", "(cosy) Different"),
            ("style", "natural"),
            ("narration_sha256", "d" * 64),
            ("reference_sha256", "e" * 64),
            ("reference_transcript_sha256", "f" * 64),
            ("section_count", 3),
        ):
            changed = copy.deepcopy(prior)
            changed[key] = value
            mutations.append(changed)
        changed_control = copy.deepcopy(prior)
        changed_control["controls"]["speed"] = 1.0
        mutations.append(changed_control)
        changed_seed = copy.deepcopy(prior)
        changed_seed["controls"]["seed"] = 7
        mutations.append(changed_seed)
        for changed in mutations:
            assert portal.generation_fingerprint(current) != portal.generation_fingerprint(changed)

        inspected = {
            "path": str(prior_file),
            "sha256": prior_sha,
            "quality_approved": True,
            "quality_flags": [],
            "duration_seconds": 0.1,
        }
        words = approved_word_report()
        with mock.patch.object(portal, "recent_job_history", return_value=[prior]), mock.patch.object(
            portal, "promptus_root", return_value=root
        ), mock.patch.object(portal, "comfy_root", return_value=comfy), mock.patch.object(
            portal, "inspect_audio", return_value=inspected
        ) as inspect, mock.patch.object(
            portal, "verify_narration_words", return_value=words
        ) as verify:
            recovered = portal.recover_prior_verified_output(current, source)
        assert recovered is not None
        assert recovered["sha256"] == prior_sha
        assert recovered["delivery_approved"] is True
        assert recovered["artifact_role"] == "verified_master"
        inspect.assert_called_once_with(prior_file)
        verify.assert_called_once_with(prior_file, source)

        # A fingerprint mismatch falls through without trusting or even opening the old media.
        mismatch = copy.deepcopy(prior)
        mismatch["controls"]["cfg_strength"] = 2.2
        with mock.patch.object(portal, "recent_job_history", return_value=[mismatch]), mock.patch.object(
            portal, "promptus_root", return_value=root
        ), mock.patch.object(portal, "comfy_root", return_value=comfy), mock.patch.object(
            portal, "inspect_audio"
        ) as inspect:
            assert portal.recover_prior_verified_output(current, source) is None
        inspect.assert_not_called()

        # Random-seed jobs deliberately request a new take and must never reuse a prior one.
        random_current = copy.deepcopy(current)
        random_current["controls"]["seed"] = -1
        random_prior = copy.deepcopy(prior)
        random_prior["controls"]["seed"] = -1
        with mock.patch.object(
            portal, "recent_job_history", return_value=[random_prior]
        ), mock.patch.object(portal, "inspect_audio") as inspect:
            assert portal.recover_prior_verified_output(random_current, source) is None
        inspect.assert_not_called()

        # Hash, fresh signal health, and the current word gate are all mandatory.
        wrong_hash = copy.deepcopy(prior)
        wrong_hash["outputs"][0]["sha256"] = "0" * 64
        with mock.patch.object(portal, "recent_job_history", return_value=[wrong_hash]), mock.patch.object(
            portal, "promptus_root", return_value=root
        ), mock.patch.object(portal, "comfy_root", return_value=comfy), mock.patch.object(
            portal, "inspect_audio"
        ) as inspect:
            assert portal.recover_prior_verified_output(current, source) is None
        inspect.assert_not_called()

        clipped = {**inspected, "quality_approved": False, "quality_flags": ["clipping"]}
        with mock.patch.object(portal, "recent_job_history", return_value=[prior]), mock.patch.object(
            portal, "promptus_root", return_value=root
        ), mock.patch.object(portal, "comfy_root", return_value=comfy), mock.patch.object(
            portal, "inspect_audio", return_value=clipped
        ), mock.patch.object(portal, "verify_narration_words") as verify:
            assert portal.recover_prior_verified_output(current, source) is None
        verify.assert_not_called()

        rejected_words = {
            **approved_word_report(
                reference_words=40, recognized_words=95,
                normalized_reference_words=40, normalized_edit_distance=58,
            ),
            "word_accuracy_approved": False,
        }
        with mock.patch.object(portal, "recent_job_history", return_value=[prior]), mock.patch.object(
            portal, "promptus_root", return_value=root
        ), mock.patch.object(portal, "comfy_root", return_value=comfy), mock.patch.object(
            portal, "inspect_audio", return_value=inspected
        ), mock.patch.object(
            portal, "verify_narration_words", return_value=rejected_words
        ):
            assert portal.recover_prior_verified_output(current, source) is None


def test_section_word_ledger_aggregates_exact_counts_without_weakening_gate() -> None:
    reports = [
        {
            **approved_word_report(
                reference_words=40, recognized_words=42,
                normalized_reference_words=40, normalized_edit_distance=2,
            ),
            "normalized_substitutions": 1,
            "normalized_deletions": 1,
            "normalized_insertions": 0,
        },
        {
            **approved_word_report(
                reference_words=60, recognized_words=63,
                normalized_reference_words=60, normalized_edit_distance=3,
            ),
            "normalized_substitutions": 2,
            "normalized_deletions": 0,
            "normalized_insertions": 1,
        },
    ]
    aggregate = portal.aggregate_section_word_reports(reports)
    assert aggregate["normalized_reference_words"] == 100
    assert aggregate["normalized_recognized_words"] == 105
    assert aggregate["normalized_edit_distance"] == 5
    assert aggregate["normalized_substitutions"] == 3
    assert aggregate["normalized_deletions"] == 1
    assert aggregate["normalized_insertions"] == 1
    assert aggregate["normalized_word_error_rate_percent"] == 5.0
    assert aggregate["recognized_word_ratio"] == 1.05
    assert aggregate["word_accuracy_approved"] is True

    # This reproduces the class of catastrophic long-master failure from the browser evidence.
    bad_section = {
        **approved_word_report(
            reference_words=40, recognized_words=95,
            normalized_reference_words=40, normalized_edit_distance=58,
        ),
        "normalized_recognized_words": 95,
        "normalized_substitutions": 3,
        "normalized_deletions": 0,
        "normalized_insertions": 55,
        "word_accuracy_approved": False,
    }
    rejected = portal.aggregate_section_word_reports([bad_section])
    assert rejected["normalized_word_error_rate_percent"] == 145.0
    assert rejected["recognized_word_ratio"] == 2.375
    assert rejected["word_accuracy_approved"] is False
    assert rejected["issue"]["code"] in {
        "word_accuracy_rejected", "section_word_accuracy_rejected"
    }

    # Raw counts, rather than rounded display values, remain authoritative at the boundary.
    rounded_ratio_would_pass = approved_word_report(
        reference_words=1001, recognized_words=950,
        normalized_reference_words=1001, normalized_edit_distance=20,
    )
    rounded = portal.aggregate_section_word_reports([rounded_ratio_would_pass])
    assert rounded["recognized_word_ratio"] == 0.949
    assert rounded["word_accuracy_approved"] is False


def test_master_word_failure_repairs_one_section_once_and_preserves_direction() -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        comfy = root / "comfy"
        output_root = comfy / "output" / "promptus_voice" / "Portal-Masters"
        output_root.mkdir(parents=True)
        jobs = root / "jobs"
        history = root / "history"
        history.mkdir()
        job_id = "333333333333333333333333"
        sections = ["First exact section.", "Second exact section."]
        narration = "\n\n".join(sections)
        narration_sha = portal.hashlib.sha256(narration.encode("utf-8")).hexdigest()
        controls = {**portal.STYLE_PRESETS["poetic"], "seed": 2147483647}

        audio_paths = {
            name: root / f"{name}.flac"
            for name in ("section-one", "section-two-bad", "section-two-repaired")
        }
        master_zero = output_root / f"{job_id}-r0.flac"
        master_one = output_root / f"{job_id}-r1.flac"
        for path in [*audio_paths.values(), master_zero, master_one]:
            sf.write(path, np.zeros(2400, dtype=np.float32), 24000)

        initial_one = {
            "path": str(audio_paths["section-one"]), "sha256": "1" * 64,
            "quality_approved": True, "quality_flags": [],
        }
        initial_two = {
            "path": str(audio_paths["section-two-bad"]), "sha256": "2" * 64,
            "quality_approved": True, "quality_flags": [],
        }
        repaired_two = {
            "path": str(audio_paths["section-two-repaired"]), "sha256": "3" * 64,
            "quality_approved": True, "quality_flags": [],
        }
        master_common = {
            "duration_seconds": 0.1, "quality_approved": True,
            "quality_flags": [], "clipping_percent": 0.0,
            "peak_dbfs": -10.0, "rms_dbfs": -24.0, "silence_percent": 0.0,
            "dc_offset": 0.0, "possible_clicks_percent": 0.0, "sections": 2,
        }
        first_master = {
            **master_common, "path": str(master_zero), "sha256": "4" * 64,
        }
        repaired_master = {
            **master_common, "path": str(master_one), "sha256": "5" * 64,
        }
        catastrophic = {
            **approved_word_report(
                reference_words=40, recognized_words=95,
                normalized_reference_words=40, normalized_edit_distance=58,
            ),
            "normalized_recognized_words": 95,
            "word_accuracy_approved": False,
            "issue": {
                "code": "word_accuracy_rejected", "category": "quality",
                "stage": "master_word_check", "message": "Master words were rejected.",
                "retryable": True, "recovery": "Localize the failed section.",
            },
        }
        section_one_words = approved_word_report(
            reference_words=20, recognized_words=20,
            normalized_reference_words=20, normalized_edit_distance=0,
        )
        section_two_bad_words = {
            **approved_word_report(
                reference_words=20, recognized_words=30,
                normalized_reference_words=20, normalized_edit_distance=10,
            ),
            "word_accuracy_approved": False,
            "issue": {
                "code": "word_accuracy_rejected", "category": "quality",
                "stage": "section_word_check", "message": "Section words were rejected.",
                "retryable": True, "recovery": "Render one bounded repair.",
            },
        }
        section_two_repaired_words = approved_word_report(
            reference_words=20, recognized_words=20,
            normalized_reference_words=20, normalized_edit_distance=0,
        )
        final_words = approved_word_report(
            reference_words=40, recognized_words=40,
            normalized_reference_words=40, normalized_edit_distance=0,
        )

        commands: list[list[str]] = []
        submitted_text: list[str] = []

        def fake_attempt(command: list[str], _events: list, _job_id: str):
            commands.append(list(command))
            text_file = Path(command[command.index("--text-file") + 1])
            submitted_text.append(text_file.read_text(encoding="utf-8"))
            return (
                (0, [initial_one], None) if len(commands) == 1 else
                (0, [initial_two], None) if len(commands) == 2 else
                (0, [repaired_two], None)
            )

        word_paths: list[Path] = []

        def fake_words(audio: Path, _source: Path) -> dict:
            word_paths.append(Path(audio))
            lookup = {
                master_zero: catastrophic,
                audio_paths["section-one"]: section_one_words,
                audio_paths["section-two-bad"]: section_two_bad_words,
                audio_paths["section-two-repaired"]: section_two_repaired_words,
                master_one: final_words,
            }
            return copy.deepcopy(lookup[Path(audio)])

        with portal.JOBS_LOCK:
            portal.JOBS[job_id] = {
                **fixed_seed_recovery_record(job_id),
                "created": time.time(),
                "narration_sha256": narration_sha,
                "events": [],
            }
        assert portal.GENERATION_SLOT.acquire(blocking=False)
        try:
            with mock.patch.object(portal, "JOB_ROOT", jobs), mock.patch.object(
                portal, "HISTORY_ROOT", history
            ), mock.patch.object(portal, "split_narration", return_value=sections), mock.patch.object(
                portal, "execute_section_attempt", side_effect=fake_attempt
            ), mock.patch.object(
                portal, "master_output", side_effect=[first_master, repaired_master]
            ) as assemble, mock.patch.object(
                portal, "verify_narration_words", side_effect=fake_words
            ), mock.patch.object(portal, "promptus_root", return_value=root), mock.patch.object(
                portal, "comfy_root", return_value=comfy
            ), mock.patch.object(portal, "record_consent"):
                portal.run_generation(
                    job_id,
                    "(cosy) Promptus: Local Voice Test [Studio]",
                    narration,
                    controls,
                )

            with portal.JOBS_LOCK:
                job = dict(portal.JOBS[job_id])
            assert job["status"] == "complete", job
            assert job["qa_status"] == "passed"
            assert job["style"] == "poetic"
            assert job["controls"] == controls
            assert len(commands) == 3, "only the localized section receives one repair render"
            assert submitted_text == [sections[0], sections[1], sections[1]]
            first_seed = int(commands[0][commands[0].index("--seed") + 1])
            second_seed = int(commands[1][commands[1].index("--seed") + 1])
            repair_seed = int(commands[2][commands[2].index("--seed") + 1])
            expected_seed = portal.derive_repair_seed(
                controls["seed"], narration_sha, 2, 1
            )
            assert first_seed == second_seed == controls["seed"]
            assert repair_seed == expected_seed
            assert repair_seed != controls["seed"]
            for option in (
                "--speed", "--nfe-step", "--cfg-strength", "--cross-fade-duration",
                "--sway-sampling-coef", "--speed-type",
            ):
                assert commands[2][commands[2].index(option) + 1] == commands[1][commands[1].index(option) + 1]
            assert assemble.call_count == 2
            rebuilt_outputs = assemble.call_args_list[1].args[1]
            assert [value["sha256"] for value in rebuilt_outputs] == ["1" * 64, "3" * 64]
            assert word_paths == [
                master_zero,
                audio_paths["section-one"],
                audio_paths["section-two-bad"],
                audio_paths["section-two-repaired"],
                master_one,
            ]

            repair = job["repair_state"]
            assert repair["status"] == "resolved"
            assert repair["rounds_used"] == 1
            assert repair["max_rounds"] == 1
            assert repair["sections_checked"] == [1, 2]
            assert repair["sections_repaired"] == [2]
            assert len(repair["attempts"]) == 1
            assert repair["attempts"][0]["effective_seed"] == expected_seed
            assert job["outputs"][0]["sha256"] == "5" * 64
            assert job["outputs"][0]["delivery_approved"] is True
            assert job["outputs"][0]["artifact_role"] == "verified_master"

            public = portal.public_job_snapshot(job)
            public_json = json.dumps(public)
            assert str(master_zero) not in public_json
            assert first_master.get("audio_url") not in public_json
            assert public["outputs"][0]["audio_url"].endswith(f"{job_id}-r1.flac")
            assert portal.output_delivery_is_approved(
                f"/api/output/promptus_voice/Portal-Masters/{job_id}-r0.flac"
            ) is False
            assert portal.output_delivery_is_approved(
                f"/api/output/promptus_voice/Portal-Masters/{job_id}-r1.flac"
            ) is True
        finally:
            with portal.JOBS_LOCK:
                portal.JOBS.pop(job_id, None)
            assert portal.GENERATION_SLOT.acquire(blocking=False)
            portal.GENERATION_SLOT.release()


def test_repair_history_is_strictly_privacy_safe() -> None:
    raw = {
        "status": "resolved",
        "rounds_used": 1,
        "max_rounds": 1,
        "sections_checked": [1, 2],
        "sections_repaired": [2],
        "prior_source_job_id": "secret-prior-job-id",
        "prior_output_sha256": "a" * 64,
        "fingerprint": "b" * 64,
        "narration": "PRIVATE NARRATION SENTINEL",
        "recognized_text": "PRIVATE RECOGNIZED SENTINEL",
        "path": r"C:\Private\speaker\take.flac",
        "attempts": [{
            "section": 2,
            "attempt": 1,
            "reason": "word_accuracy",
            "original_seed": 2147483647,
            "effective_seed": 12345,
            "source_sha256": "c" * 64,
            "rejected_output_sha256": "d" * 64,
            "replacement_output_sha256": "e" * 64,
            "normalized_reference_words": 40,
            "normalized_recognized_words": 40,
            "normalized_edit_distance": 0,
            "normalized_word_error_rate_percent": 0.0,
            "recognized_word_ratio": 1.0,
            "path": r"C:\Private\speaker\replacement.flac",
            "text": "PRIVATE SECTION SENTINEL",
            "transcript": "PRIVATE TRANSCRIPT SENTINEL",
        }],
    }
    safe = portal._safe_repair_state(raw)
    assert safe["status"] == "resolved"
    assert safe["rounds_used"] == 1
    assert safe["max_rounds"] == 1
    assert safe["sections_checked"] == [1, 2]
    assert safe["sections_repaired"] == [2]
    assert safe["prior_output_sha256"] == "a" * 64
    assert safe["attempts"][0]["effective_seed"] == 12345
    assert safe["attempts"][0]["normalized_edit_distance"] == 0

    snapshot = portal.history_snapshot({
        "id": "444444444444444444444444",
        "status": "complete",
        "qa_status": "passed",
        "repair_state": raw,
        "outputs": [],
    })
    public = portal.public_job_snapshot(snapshot)
    serialized = json.dumps(public)
    for forbidden in (
        "secret-prior-job-id",
        "PRIVATE NARRATION SENTINEL",
        "PRIVATE RECOGNIZED SENTINEL",
        "PRIVATE SECTION SENTINEL",
        "PRIVATE TRANSCRIPT SENTINEL",
        r"C:\\Private",
        "prior_source_job_id",
        '"path"',
        '"text"',
        '"transcript"',
    ):
        assert forbidden not in serialized
    assert public["repair_state"] == safe


def test_legacy_master_reverification_promotes_only_current_hash_matched_evidence() -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        jobs = root / "jobs"
        history = root / "history"
        comfy = root / "comfy"
        job_id = "555555555555555555555555"
        source = jobs / job_id / "narration-master.txt"
        source.parent.mkdir(parents=True)
        normalized_source = "The saved words remain exact.\nA second line stays exact."
        source.write_bytes(normalized_source.replace("\n", "\r\n").encode("utf-8"))
        master = comfy / "output" / "promptus_voice" / "Portal-Masters" / f"{job_id}.flac"
        master.parent.mkdir(parents=True)
        sf.write(master, np.zeros(2400, dtype=np.float32), 24000)
        master_sha = portal.file_sha256(master)
        record = {
            **fixed_seed_recovery_record(job_id),
            "status": "rejected",
            "qa_status": "rejected",
            "consent_basis": "self",
            "narration_sha256": portal.hashlib.sha256(
                normalized_source.encode("utf-8")
            ).hexdigest(),
            "issue": {
                "code": "word_accuracy_rejected",
                "category": "quality",
                "stage": "master_word_check",
                "message": "Legacy verifier rejected this master.",
            },
            "diagnostic_outputs": [{
                "sha256": master_sha,
                "sections": 2,
                "delivery_approved": False,
                "artifact_role": "unapproved_master",
            }],
            "outputs": [],
            "timeline": [],
            "created": time.time(),
        }
        detail = {
            "path": str(master), "sha256": master_sha, "quality_approved": True,
            "quality_flags": [], "duration_seconds": 0.1,
        }
        words = approved_word_report(
            reference_words=5, recognized_words=5,
            normalized_reference_words=5, normalized_edit_distance=0,
        )
        words.update({
            "long_form_mode": "whisper_native",
            "word_verifier_strategy": "whisper_native_long_form_v1",
        })

        class ImmediateThread:
            def __init__(self, *, target, args, daemon):
                self.target, self.args = target, args

            def start(self):
                self.target(*self.args)

        with portal.JOBS_LOCK:
            portal.JOBS[job_id] = copy.deepcopy(record)
        try:
            with mock.patch.object(portal, "JOB_ROOT", jobs), mock.patch.object(
                portal, "HISTORY_ROOT", history
            ), mock.patch.object(portal, "promptus_root", return_value=root), mock.patch.object(
                portal, "comfy_root", return_value=comfy
            ), mock.patch.object(
                portal, "backend_health", return_value={"accepting_jobs": True}
            ), mock.patch.object(portal, "ensure_reference_word_audit", return_value={
                "approved": True,
                "reference_sha256": record["reference_sha256"],
                "transcript_sha256": record["reference_transcript_sha256"],
            }), mock.patch.object(
                portal, "verify_audio", return_value=detail
            ), mock.patch.object(
                portal, "verify_narration_words", return_value=words
            ), mock.patch.object(portal, "record_consent") as consent, mock.patch.object(
                portal.threading, "Thread", ImmediateThread
            ):
                response = portal.app.test_client().post(
                    f"/api/jobs/{job_id}/reverify", headers=post_headers()
                )
            assert response.status_code == 202, response.get_json()
            with portal.JOBS_LOCK:
                repaired = copy.deepcopy(portal.JOBS[job_id])
            assert repaired["status"] == "complete"
            assert repaired["qa_status"] == "passed"
            assert repaired["repair_state"]["status"] == "resolved"
            assert repaired["outputs"][0]["sha256"] == master_sha
            assert repaired["outputs"][0]["delivery_approved"] is True
            assert repaired["outputs"][0]["word_verifier_strategy"] == "whisper_native_long_form_v1"
            assert repaired["diagnostic_outputs"] == []
            assert consent.call_args.args[0]["action"] == "reverify_quarantined_voice_result"
            assert portal.GENERATION_SLOT.acquire(blocking=False)
            portal.GENERATION_SLOT.release()
        finally:
            with portal.JOBS_LOCK:
                portal.JOBS.pop(job_id, None)


def test_history_survives_eviction_and_accepts_late_verdict() -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        history = root / "history"
        jobs = root / "jobs"
        history.mkdir()
        jobs.mkdir()
        consent = root / "consent.jsonl"
        expression = root / "expression.jsonl"
        job_id = "aaaaaaaaaaaaaaaaaaaaaaaa"
        value = {
            "id": job_id, "status": "complete", "qa_status": "passed",
            "created": time.time() - 10, "finished": time.time(),
            "portal_run_id": portal.PORTAL_RUN_ID, "model_title": "(cosy) Test",
            "style": "natural", "narration_sha256": "hash", "consent_basis": "self",
            "outputs": [{"sha256": "audio", "audio_url": "/api/output/test.flac", "sections": 1,
                         "duration_seconds": 2.0, "word_accuracy_approved": True}],
        }
        with mock.patch.object(portal, "HISTORY_ROOT", history):
            portal.persist_job_history(value)
        with portal.JOBS_LOCK:
            portal.JOBS.pop(job_id, None)
        with mock.patch.object(portal, "HISTORY_ROOT", history), mock.patch.object(
            portal, "JOB_ROOT", jobs
        ), mock.patch.object(portal, "CONSENT_LOG", consent), mock.patch.object(
            portal, "EXPRESSION_LOG", expression
        ):
            client = portal.app.test_client()
            recovered = client.get(f"/api/jobs/{job_id}")
            assert recovered.status_code == 200
            assert recovered.json["source"] == "history"
            verdict = client.post(
                f"/api/jobs/{job_id}/expression",
                json={"verdict": "approved", "notes": "Clean and natural."},
                headers=post_headers(),
            )
            assert verdict.status_code == 200, verdict.get_json()
            refreshed = client.get("/api/history?limit=5")
            assert refreshed.status_code == 200
            assert refreshed.json["entries"][0]["listening_verdict"] == "approved"

            stale_id = "bbbbbbbbbbbbbbbbbbbbbbbb"
            portal.persist_job_history({
                "id": stale_id, "status": "running", "created": time.time(),
                "portal_run_id": "older-process", "model_title": "(cosy) Test",
            })
            stale = client.get(f"/api/jobs/{stale_id}").get_json()["job"]
            assert stale["status"] == "stopped"
            assert stale["issue"]["code"] == "portal_restart"


def test_expression_verdict_is_recorded() -> None:
    """The listening verdict must persist beside the render hash, outliving job retention."""
    with tempfile.TemporaryDirectory() as raw:
        log = Path(raw) / "expression-log.jsonl"
        with mock.patch.object(portal, "EXPRESSION_LOG", log):
            client = portal.app.test_client()
            assert client.post(
                "/api/jobs/missing/expression", json={"verdict": "approved"}, headers=post_headers()
            ).status_code == 404
            with portal.JOBS_LOCK:
                portal.JOBS["listen"] = {
                    "id": "listen", "status": "running", "model_title": "(cosy) Test",
                    "style": "poetic", "controls": {"speed": 1.07, "seed": 2147483647},
                    "consent_basis": "explicit_permission", "narration_sha256": "text123",
                    "outputs": [],
                }
            assert client.post(
                "/api/jobs/listen/expression", json={"verdict": "approved"}, headers=post_headers()
            ).status_code == 400, "a verdict before completion must be refused"
            assert client.post(
                "/api/jobs/listen/expression", json={"verdict": "lovely"}, headers=post_headers()
            ).status_code == 400
            with portal.JOBS_LOCK:
                portal.JOBS["listen"]["status"] = "complete"
                portal.JOBS["listen"]["outputs"] = [{
                    "sha256": "abc123", "duration_seconds": 5.0, "sections": 1,
                    "clipping_percent": 0.0, "silence_percent": 1.2,
                    "dc_offset": 0.00001, "possible_clicks_percent": 0.0,
                    "audio_url": "/api/output/promptus_voice/test.flac",
                    "word_accuracy_approved": True,
                    "normalized_word_error_rate_percent": 0.0,
                }]
            response = client.post(
                "/api/jobs/listen/expression",
                json={"verdict": "revise", "notes": "Line endings rush."},
                headers=post_headers(),
            )
            assert response.status_code == 200
            assert client.post(
                "/api/jobs/listen/expression", json={"verdict": "revise"}
            ).status_code == 403, "the verdict route must require the portal token"
            entries = client.get("/api/expression").get_json()["entries"]
            assert entries[0]["sha256"] == "abc123"
            assert entries[0]["verdict"] == "revise"
            assert entries[0]["controls"]["speed"] == 1.07
            assert entries[0]["consent_basis"] == "explicit_permission"
            assert entries[0]["narration_sha256"] == "text123"
            assert entries[0]["dc_offset"] == 0.00001
            assert entries[0]["output_location"].endswith("test.flac")
            with portal.JOBS_LOCK:
                portal.JOBS.pop("listen", None)
        assert log.is_file(), "the log must survive independently of the job record"


def test_consent_basis_is_persisted() -> None:
    with tempfile.TemporaryDirectory() as raw:
        log = Path(raw) / "consent-log.jsonl"
        with mock.patch.object(portal, "CONSENT_LOG", log):
            assert portal.consent_basis({"consent_basis": "self"}) == "self"
            expect_error(lambda: portal.consent_basis({}), "Consent basis")
            portal.record_consent({
                "action": "install_voice", "consent_basis": "self",
                "voice_name": "Test", "reference_sha256": "abc123",
            })
        entry = json.loads(log.read_text(encoding="utf-8"))
        assert entry["consent_basis"] == "self"
        assert entry["reference_sha256"] == "abc123"


def test_installed_voice_health_blocks_overlength_reference() -> None:
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        flow_dir = root / "flows"
        input_dir = root / "comfy" / "input" / "F5-TTS"
        flow_dir.mkdir(parents=True)
        input_dir.mkdir(parents=True)
        reference = input_dir / "too-long.wav"
        sf.write(reference, np.zeros(int(24000 * 12.2), dtype=np.float32), 24000)
        reference.with_suffix(".txt").write_text(" ".join(["word"] * 24), encoding="utf-8")
        (flow_dir / "voice.json").write_text(json.dumps({
            "prompt": {"1": {"inputs": {"audio": "F5-TTS/too-long.wav"}}}
        }), encoding="utf-8")
        with mock.patch.object(portal, "promptus_root", return_value=root), mock.patch.object(
            portal, "local_cosyflow_dir", return_value=flow_dir
        ), mock.patch.object(
            portal, "title_to_filename", return_value="voice.json"
        ), mock.patch.object(
            portal, "comfy_root", return_value=root / "comfy"
        ):
            health = portal.installed_voice_health("(cosy) Test")
        assert health["selectable"] is False
        assert health["health"] == "needs_attention"
        assert "exceeds" in health["health_label"]


def test_microphone_reference_words_are_verified() -> None:
    metrics = {
        "duration_seconds": 8.0,
        "score": 95,
        "snr_estimate_db": 30,
        "activity_percent": 90,
        "warnings": [],
    }

    def fake_decode(_source: Path, destination: Path) -> None:
        destination.write_bytes(b"decoded")

    def fake_trim(_source: Path, destination: Path) -> dict:
        sf.write(destination, np.zeros(24000, dtype=np.float32), 24000)
        return dict(metrics)

    with tempfile.TemporaryDirectory() as raw, mock.patch.object(
        portal, "REFERENCE_ROOT", Path(raw)
    ), mock.patch.object(
        portal, "decode_recording", side_effect=fake_decode
    ), mock.patch.object(
        portal, "trim_and_analyze", side_effect=fake_trim
    ), mock.patch.object(
        portal,
        "local_asr_report",
        return_value={"normalized_word_error_rate_percent": 70.0, "recognized_word_ratio": 0.4},
    ):
        response = portal.app.test_client().post(
            "/api/reference",
            data={
                "audio": (io.BytesIO(b"recording"), "reference.webm"),
                "transcript": "These are the exact words I intended to record today.",
                "automatic_transcript": "false",
            },
            headers=post_headers(),
            content_type="multipart/form-data",
        )
        assert response.status_code == 400
        assert "does not match" in response.json["error"]
        assert not any(Path(raw).iterdir())


def test_install_logs_only_after_success() -> None:
    with tempfile.TemporaryDirectory() as raw:
        reference_root = Path(raw)
        reference_id = "12345678-1234-5678-1234-567812345678"
        folder = reference_root / reference_id
        folder.mkdir()
        sf.write(folder / "reference.wav", np.zeros(2400, dtype=np.float32), 24000)
        (folder / "reference.txt").write_text("A short exact reference.", encoding="utf-8")
        payload = {
            "consent_confirmed": True,
            "consent_basis": "self",
            "voice_name": "Test Voice",
            "reference_id": reference_id,
        }
        ready = {"accepting_jobs": True}
        with mock.patch.object(portal, "REFERENCE_ROOT", reference_root), mock.patch.object(
            portal, "backend_health", return_value=ready
        ), mock.patch.object(
            portal, "install_studio", side_effect=portal.PromptusVoiceError("install failed")
        ), mock.patch.object(portal, "record_consent") as record:
            failed = portal.app.test_client().post(
                "/api/install", json=payload, headers=post_headers()
            )
        assert failed.status_code == 400
        record.assert_not_called()

        with mock.patch.object(portal, "REFERENCE_ROOT", reference_root), mock.patch.object(
            portal, "backend_health", return_value=ready
        ), mock.patch.object(
            portal, "install_studio", return_value=("(cosy) Test", reference_root / "flow.json")
        ), mock.patch.object(portal, "record_consent") as record:
            installed = portal.app.test_client().post(
                "/api/install", json=payload, headers=post_headers()
            )
        assert installed.status_code == 200, installed.get_json()
        assert record.call_args.args[0]["outcome"] == "installed"


def test_generation_submission_persists_consent() -> None:
    payload = {
        "consent_confirmed": True,
        "consent_basis": "self",
        "model_title": "(cosy) Test",
        "narration": "A valid sentence for consent evidence.",
        "style": "natural",
        "seed": 7,
        "controls_modified": True,
    }

    class DormantThread:
        def __init__(self, **_kwargs):
            pass

        def start(self) -> None:
            pass

    response = None
    try:
        with tempfile.TemporaryDirectory() as raw, mock.patch.object(
            portal, "HISTORY_ROOT", Path(raw)
        ), mock.patch.object(
            portal, "backend_health", return_value={"accepting_jobs": True}
        ), mock.patch.object(
            portal, "get_cosyflows", return_value=[{"title": "(cosy) Test"}]
        ), mock.patch.object(
            portal, "cloned_voice_metadata", return_value={
                "title": "(cosy) Test", "name": "Test", "selectable": True,
                "reference_duration_seconds": 8.0,
            }
        ), mock.patch.object(
            portal, "ensure_reference_word_audit", return_value={
                "approved": True, "reference_sha256": "audio", "transcript_sha256": "text",
            }
        ), mock.patch.object(
            portal.threading, "Thread", DormantThread
        ), mock.patch.object(portal, "record_consent") as record:
            response = portal.app.test_client().post(
                "/api/generate", json=payload, headers=post_headers()
            )
        assert response.status_code == 200, response.get_json()
        entry = record.call_args.args[0]
        assert entry["action"] == "generate_voice"
        assert entry["outcome"] == "accepted_for_submission"
        assert entry["consent_basis"] == "self"
        assert entry["controls_modified"] is True
        assert entry["reference_sha256"] == "audio"
    finally:
        if response is not None and response.status_code == 200:
            job_id = response.get_json()["job_id"]
            with portal.JOBS_LOCK:
                portal.JOBS.pop(job_id, None)
            portal.GENERATION_SLOT.release()


def test_generation_blocks_mismatched_installed_reference_before_render() -> None:
    payload = {
        "consent_confirmed": True,
        "consent_basis": "self",
        "model_title": "(cosy) Broken Reference",
        "narration": "A valid sentence that must never reach F5.",
        "style": "natural",
        "seed": 7,
    }
    before = set(portal.JOBS)
    with mock.patch.object(portal, "backend_health", return_value={"accepting_jobs": True}), mock.patch.object(
        portal, "get_cosyflows", return_value=[{"title": "(cosy) Broken Reference"}]
    ), mock.patch.object(
        portal, "cloned_voice_metadata", return_value={
            "title": "(cosy) Broken Reference", "name": "Broken", "selectable": True,
        }
    ), mock.patch.object(
        portal, "ensure_reference_word_audit", return_value={
            "approved": False, "normalized_word_error_rate_percent": 47.62,
            "recognized_word_ratio": 1.048,
        }
    ), mock.patch.object(portal, "record_consent") as record:
        response = portal.app.test_client().post(
            "/api/generate", json=payload, headers=post_headers()
        )
    assert response.status_code == 409
    assert "needs re-recording" in response.get_json()["error"]
    assert set(portal.JOBS) == before
    record.assert_not_called()
    assert portal.GENERATION_SLOT.acquire(blocking=False)
    portal.GENERATION_SLOT.release()


def main() -> None:
    test_controls()
    test_segmentation()
    test_master_output()
    test_quality_gate_fails_closed()
    test_log_source_allowlist_is_exact_nonrecursive_and_portable()
    test_log_diagnostics_is_token_protected_no_store_and_accepts_job_context()
    test_log_diagnostics_is_bounded_uses_latest_session_and_never_returns_raw_data()
    test_log_classification_separates_benign_actionable_and_live_health()
    test_http_validation_and_concurrency()
    test_health_and_job_eviction()
    test_installed_voice_discovery()
    test_output_route_is_confined()
    test_rejected_reference_is_removed()
    test_reference_is_stored_below_node_target_rms()
    test_reference_stays_below_f5_auto_truncation_limit()
    test_skill_package_is_current_and_carries_no_private_data()
    test_silence_measurement_is_level_invariant()
    test_long_continuous_gap_is_flagged()
    test_marginal_clipping_retry_policy()
    test_word_accuracy_gate()
    test_whisper_verifier_uses_native_long_form_without_overlap_chunking()
    test_uploaded_reference_is_transcribed_locally()
    test_generation_retries_one_marginal_random_take()
    test_master_word_rejection_keeps_structured_history()
    test_prior_fixed_seed_recovery_requires_exact_current_revalidation()
    test_section_word_ledger_aggregates_exact_counts_without_weakening_gate()
    test_master_word_failure_repairs_one_section_once_and_preserves_direction()
    test_repair_history_is_strictly_privacy_safe()
    test_legacy_master_reverification_promotes_only_current_hash_matched_evidence()
    test_history_survives_eviction_and_accepts_late_verdict()
    test_expression_verdict_is_recorded()
    test_consent_basis_is_persisted()
    test_installed_voice_health_blocks_overlength_reference()
    test_microphone_reference_words_are_verified()
    test_install_logs_only_after_success()
    test_generation_submission_persists_consent()
    test_generation_blocks_mismatched_installed_reference_before_render()
    print(
        "Portal backend tests passed: controls, fail-closed QA, paragraph segmentation, "
        "master verification, API validation, concurrency, health, confined output, eviction, "
        "cleanup, reference headroom, skill packaging, level-invariant silence, dropout detection, bounded retry, "
        "local transcription, reference word matching, voice preflight, serialized installs, "
        "structured rejections, restart-safe history, safe log diagnostics, generation consent evidence, "
        "and listening verdicts"
    )


if __name__ == "__main__":
    main()
