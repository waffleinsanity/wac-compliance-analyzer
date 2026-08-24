"""Hard-delete investigation cases owned by pytest harness users from the LIVE DB.

Safe for local cleanup after older test runs wrote into data/wac_app.db.
Does not delete demo cases owned by real admin accounts.

Usage (from repo root or backend/):
  backend\\.venv\\Scripts\\python.exe scripts\\purge_test_harness_cases.py
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.database import SessionLocal, init_db  # noqa: E402
from app.services.case_store import (  # noqa: E402
    TEST_HARNESS_USERNAMES,
    purge_cases_owned_by_usernames,
)


def main() -> int:
    init_db()
    db = SessionLocal()
    try:
        n = purge_cases_owned_by_usernames(db, TEST_HARNESS_USERNAMES)
    finally:
        db.close()
    print(f"Purged {n} harness-owned case(s) for users: {', '.join(sorted(TEST_HARNESS_USERNAMES))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
