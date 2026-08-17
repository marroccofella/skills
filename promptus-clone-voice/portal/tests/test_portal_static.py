from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def javascript_function(source: str, name: str) -> str:
    """Return one function body so unsafe rendering can be checked in isolation."""
    match = re.search(rf"(?:async\s+)?function\s+{re.escape(name)}\s*\([^)]*\)\s*\{{", source)
    if not match:
        raise SystemExit(f"JavaScript function is missing: {name}")
    start = match.end()
    depth = 1
    quote = ""
    escaped = False
    for index in range(start, len(source)):
        character = source[index]
        if quote:
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == quote:
                quote = ""
            continue
        if character in {"'", '"', "`"}:
            quote = character
        elif character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return source[start:index]
    raise SystemExit(f"JavaScript function is not closed: {name}")


def main() -> None:
    html = (ROOT / "templates" / "index.html").read_text(encoding="utf-8")
    javascript = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
    id_values = re.findall(r'id="([^"]+)"', html)
    ids = set(id_values)
    duplicates = sorted(value for value in ids if id_values.count(value) > 1)
    if duplicates:
        raise SystemExit(f"Duplicate HTML IDs: {', '.join(duplicates)}")
    references = set(re.findall(r"\$\('([^']+)'\)", javascript))
    missing = sorted(references - ids)
    if missing:
        raise SystemExit(f"JavaScript references missing HTML IDs: {', '.join(missing)}")
    required_routes = {"/api/status", "/api/voices", "/api/reference", "/api/install", "/api/generate", "/api/history", "/api/log-diagnostics"}
    missing_routes = sorted(route for route in required_routes if route not in javascript)
    if missing_routes:
        raise SystemExit(f"Frontend does not call required routes: {', '.join(missing_routes)}")
    if "X-Promptus-Portal-Token" not in javascript or "promptus-portal-token" not in html:
        raise SystemExit("Portal write requests are missing their local anti-CSRF token")
    for marker in ('id="voiceSearch"', 'id="voiceList"', 'role="list"', "renderVoiceList", "selectVoice"):
        if marker not in html and marker not in javascript:
            raise SystemExit(f"Cloned-voice picker is missing {marker}")
    for marker in (
        'id="globalProgress"',
        'id="jobProgressBar"',
        'id="jobTimeline"',
        'id="qualitySummary"',
        'id="toastRegion"',
        "setGlobalProgress",
        "renderJobProgress",
        "notify",
        'id="jobRecovery"',
        'id="jobTechnical"',
        'id="jobHistoryList"',
        "finishTerminalJob",
        "finishSubmissionError",
        "showConnectionLost",
        "loadHistory",
        'id="logDiagnostics"',
        "loadLogDiagnostics",
        "renderLogDiagnostics",
    ):
        if marker not in html and marker not in javascript:
            raise SystemExit(f"Release feedback system is missing {marker}")
    diagnostic_loader = javascript_function(javascript, "loadLogDiagnostics")
    if "/api/log-diagnostics" not in diagnostic_loader or not re.search(
        r"method\s*:\s*['\"]POST['\"]", diagnostic_loader
    ):
        raise SystemExit("Log diagnostics must use the token-protected POST route")
    diagnostic_renderer = javascript_function(javascript, "renderLogDiagnostics")
    if ".textContent" not in diagnostic_renderer:
        raise SystemExit("Log diagnostics must render untrusted values through textContent")
    if ".innerHTML" in diagnostic_renderer or "insertAdjacentHTML" in diagnostic_renderer:
        raise SystemExit("Log diagnostics must not inject log-derived HTML")
    for private_field in ("raw_line", "raw_lines", "absolute_path", "excerpt", "traceback"):
        if private_field in diagnostic_renderer:
            raise SystemExit(f"Log diagnostics renderer must not consume private field: {private_field}")
    for marker in (
        'data-theme-toggle',
        'data-theme="light"',
        "THEME_KEY",
        "applyTheme",
        "prefers-color-scheme: light",
        'class="panel stage-panel locked" aria-disabled="true" inert',
        'aria-pressed="true"',
        'id="mobileReadiness"',
        'class="mobile-workflow"',
    ):
        sources = html + javascript + (ROOT / "static" / "style.css").read_text(encoding="utf-8")
        if marker not in sources:
            raise SystemExit(f"Theme/accessibility wiring is missing {marker}")
    for asset in ("promptus-background.jpg", "promptus-logo.png"):
        if asset not in html and asset not in (ROOT / "static" / "style.css").read_text(encoding="utf-8"):
            raise SystemExit(f"Promptus visual asset is not wired: {asset}")
        if not (ROOT / "static" / asset).is_file():
            raise SystemExit(f"Promptus visual asset is missing: {asset}")
    if "Do not go gentle" in html or "Rage, rage" in html:
        raise SystemExit("Portal template still ships in-copyright poem text")
    print(f"Portal wiring valid: {len(ids)} HTML IDs, {len(references)} JavaScript references")


if __name__ == "__main__":
    main()
