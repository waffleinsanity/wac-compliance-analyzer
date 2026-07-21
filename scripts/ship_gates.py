#!/usr/bin/env python3
"""Lightweight ship gates adapted from Navy EHIP ship-gates.ts."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def ok(msg: str) -> None:
    print(f"  OK  {msg}")


def soft(msg: str) -> None:
    print(f"  WARN  {msg}")


def fail(msg: str) -> None:
    print(f"  FAIL  {msg}")
    raise SystemExit(1)


def main() -> None:
    print("WACMAKR ship gates")
    changelog = ROOT / "frontend" / "src" / "changelog.ts"
    if not changelog.exists():
        fail("frontend/src/changelog.ts missing")
    text = changelog.read_text(encoding="utf-8")
    if "CHANGELOG_ENTRIES" not in text:
        fail("changelog entries missing")
    ok("changelog present")

    # Soft: latest entry date within ~14 days is ideal; do not hard-fail.
    if "2026.07.20" not in text and "2026.07.21" not in text:
        soft("changelog may be stale — append a new entry before intentional ships")
    else:
        ok("changelog has a recent build tag")

    secret = os.environ.get("SECRET_KEY", "")
    if secret in {"", "wac-compliance-dev-secret-change-in-production"} and (
        os.environ.get("RAILWAY_ENVIRONMENT") or (os.environ.get("APP_PUBLIC_URL") or "").startswith("https")
    ):
        fail("production-like host still using default SECRET_KEY")
    ok("secret check (env-dependent)")

    health_url = (os.environ.get("SHIP_HEALTH_URL") or "").rstrip("/")
    if health_url:
        try:
            with urllib.request.urlopen(f"{health_url}/api/health", timeout=20) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            if body.get("status") != "ok":
                fail(f"health not ok: {body}")
            ok(f"health ready={body.get('ready')} version={body.get('version')}")
        except Exception as exc:  # noqa: BLE001
            fail(f"health check failed: {exc}")
    else:
        soft("SHIP_HEALTH_URL unset — skipped live health")

    # Optional local frontend typecheck when node_modules present
    fe = ROOT / "frontend"
    if (fe / "node_modules").exists():
        r = subprocess.run(
            ["npm", "run", "check"],
            cwd=fe,
            capture_output=True,
            text=True,
            shell=os.name == "nt",
        )
        if r.returncode != 0:
            print(r.stdout)
            print(r.stderr)
            fail("frontend check failed")
        ok("frontend check")
    else:
        soft("frontend/node_modules missing — skipped npm check")

    print("All hard gates passed.")


if __name__ == "__main__":
    main()
