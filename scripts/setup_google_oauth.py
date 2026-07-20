"""
Ensure Google Cloud OAuth accepts our NextAuth-style redirect URI, then verify.

Opens the OAuth client edit page and polls until the URI works.
"""
from __future__ import annotations

import sys
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.auth import GOOGLE_CALLBACK_PATH, google_authorize_url_is_accepted, google_redirect_uri  # noqa: E402
from app.config import settings  # noqa: E402


def _unique(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            out.append(item)
    return out


def main() -> int:
    client_id = settings.google_client_id
    if not client_id or not settings.google_client_secret:
        print("ERROR: Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env")
        return 1

    required = _unique(
        [
            google_redirect_uri(),
            f"http://localhost:5173{GOOGLE_CALLBACK_PATH}",
        ]
    )
    origins = _unique(
        [
            (settings.app_public_url or "http://localhost:5173").rstrip("/"),
            "http://localhost:5173",
        ]
    )

    console = f"https://console.cloud.google.com/apis/credentials/oauthclient/{client_id}"
    print("=" * 60)
    print("Google OAuth setup for WACMAKR (Navy EHIP pattern)")
    print("=" * 60)
    print()
    print("Redirect path: /api/auth/google/callback")
    print()
    print("1) In the browser page that opens, under Authorized redirect URIs, ADD:")
    print()
    for u in required:
        print(f"   {u}")
    print()
    print("2) Under Authorized JavaScript origins, ADD:")
    print()
    for u in origins:
        print(f"   {u}")
    print()
    print("3) Click SAVE. Wait ~30-60 seconds.")
    print()
    print("Opening Google Cloud Console now...")
    webbrowser.open(console)
    print()
    print("Waiting for Google to accept the redirect URI (Ctrl+C to stop)...")

    import app.auth as auth_mod

    for i in range(120):
        auth_mod._google_redirect_probe_cache = None
        ok = {u: google_authorize_url_is_accepted(u) for u in required}
        if all(ok.values()):
            print()
            print("SUCCESS: Google accepted the redirect URI(s).")
            print("Open http://localhost:5173/login and Continue with Google.")
            return 0
        if i % 6 == 0:
            missing = [u for u, accepted in ok.items() if not accepted]
            print(f"  still waiting... ({i * 5}s) missing: {missing}")
        time.sleep(5)

    print()
    print("Timed out. Re-check the URIs were saved on the Web client, then re-run:")
    print("  setup-google-oauth.bat")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
