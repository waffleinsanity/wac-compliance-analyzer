"""OpenAPI contract smoke tests — guard case lifecycle and frontend API paths."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

PROJECT_ROOT = Path(__file__).resolve().parents[2]
API_TS = PROJECT_ROOT / "frontend" / "src" / "api.ts"

CRITICAL_PATH_METHODS: tuple[tuple[str, str], ...] = (
    ("post", "/api/cases/{case_id}/trash"),
    ("post", "/api/cases/{case_id}/restore"),
    ("post", "/api/cases/{case_id}/status"),
    ("delete", "/api/cases/{case_id}"),
    ("post", "/api/investigate"),
)

# Frontend template var -> OpenAPI path param (context-aware by path prefix).
_PARAM_ALIASES: tuple[tuple[str, str, str], ...] = (
    ("/api/cases/", "${id}", "{case_id}"),
    ("/api/cases/", "${caseId}", "{case_id}"),
    ("/api/cases/", "${evidenceId}", "{evidence_id}"),
    ("/api/cases/", "${entryId}", "{entry_id}"),
    ("/api/admin/users/", "${userId}", "{user_id}"),
    ("/api/support/bugs/", "${id}", "{bug_id}"),
    ("/api/support/feedback/", "${id}", "{feedback_id}"),
)


def _openapi_paths() -> dict[str, dict]:
    return app.openapi().get("paths", {})


def _has_path_method(paths: dict[str, dict], path: str, method: str) -> bool:
    entry = paths.get(path)
    return isinstance(entry, dict) and method.lower() in entry


def _normalize_frontend_path(raw: str) -> str | None:
    """Turn api.ts path literals into OpenAPI-style paths; skip unparseable fragments."""
    text = raw.strip()
    if not text.startswith("/api/"):
        return None
    if "${" in text and "?" not in text.split("${", 1)[0]:
        # e.g. `/api/admin/users${qs}` — query-only dynamic suffix, not a REST path.
        base = text.split("${", 1)[0]
        if base.startswith("/api/") and base.count("/") >= 2:
            text = base
        else:
            return None
    path = text.split("?")[0]
    for prefix, token, openapi_param in _PARAM_ALIASES:
        if path.startswith(prefix) or prefix in path:
            path = path.replace(token, openapi_param)
    # Generic fallback: ${camelCase} -> {snake_case}
    def _generic(m: re.Match[str]) -> str:
        name = m.group(1)
        snake = re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()
        return "{" + snake + "}"

    path = re.sub(r"\$\{(\w+)\}", _generic, path)
    if "${" in path or "`" in path:
        return None
    if re.search(r"\{(qs|suffix|encodeURIComponent)\}", path):
        return None
    return path.rstrip("/") or "/"


def _parse_api_ts_paths() -> set[str]:
    if not API_TS.is_file():
        return set()
    source = API_TS.read_text(encoding="utf-8")
    found: set[str] = set()
    for match in re.finditer(r"[`'](\/api\/[^`']+)[`']", source):
        normalized = _normalize_frontend_path(match.group(1))
        if normalized:
            found.add(normalized)
    return found


@pytest.fixture(scope="module")
def openapi_paths():
    return _openapi_paths()


def test_critical_case_lifecycle_paths_in_openapi(openapi_paths):
    missing = [
        f"{method.upper()} {path}"
        for method, path in CRITICAL_PATH_METHODS
        if not _has_path_method(openapi_paths, path, method)
    ]
    assert not missing, f"Missing OpenAPI routes: {', '.join(missing)}"


def test_frontend_api_ts_paths_exist_in_openapi(openapi_paths):
    frontend_paths = _parse_api_ts_paths()
    assert frontend_paths, "Could not parse any /api paths from frontend/src/api.ts"

    missing: list[str] = []
    for path in sorted(frontend_paths):
        if path not in openapi_paths:
            missing.append(path)

    # Always enforce critical lifecycle routes even if parsing fails partially.
    for method, path in CRITICAL_PATH_METHODS:
        if not _has_path_method(openapi_paths, path, method):
            missing.append(f"{method.upper()} {path}")

    assert not missing, "Frontend api.ts paths missing from OpenAPI:\n" + "\n".join(missing)


def test_unauthenticated_trash_returns_401(store_ready):
    with TestClient(app) as client:
        res = client.post("/api/cases/1/trash")
    assert res.status_code == 401, res.text
    assert res.status_code != 404
