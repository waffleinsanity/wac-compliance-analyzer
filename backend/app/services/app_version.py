"""Stable deploy fingerprint for update banners (Navy EHIP pattern)."""

from __future__ import annotations

import os
from functools import lru_cache


@lru_cache(maxsize=1)
def get_app_version() -> str:
    for key in (
        "RAILWAY_GIT_COMMIT_SHA",
        "RAILWAY_DEPLOYMENT_ID",
        "SOURCE_VERSION",
        "GIT_COMMIT",
        "APP_VERSION",
    ):
        value = (os.environ.get(key) or "").strip()
        if value:
            return value
    return f"dev-{os.environ.get('RAILWAY_ENVIRONMENT_NAME') or os.environ.get('ENV') or 'local'}"
