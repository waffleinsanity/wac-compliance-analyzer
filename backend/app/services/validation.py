"""Optional cross-reference against official WA Legislature WAC pages."""

from __future__ import annotations

import re

import httpx

from app.config import settings
from app.rag.store import wac_store
from app.schemas import ValidationResult


async def validate_against_official(chapter: str) -> ValidationResult:
    chapter = chapter.replace("WAC ", "").strip()
    if chapter.startswith("246-341"):
        chapter_key = "246-341"
        url = settings.official_341_url
    elif chapter.startswith("246-337"):
        chapter_key = "246-337"
        url = settings.official_337_url
    else:
        return ValidationResult(
            chapter=chapter,
            official_url="",
            reachable=False,
            local_code_count=0,
            notes="Unsupported chapter. Use 246-341 or 246-337.",
        )

    local_codes = [n for n in wac_store.get_code_nodes() if n.chapter == chapter_key]
    notes = []
    reachable = False
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(url)
            reachable = resp.status_code == 200
            body = resp.text if reachable else ""
            if reachable:
                found = set(re.findall(rf"{chapter_key}-\d{{3,4}}", body))
                local_set = {n.code for n in local_codes}
                overlap = local_set & found
                missing_online = local_set - found
                notes.append(
                    f"Official page reachable. Overlap {len(overlap)}/{len(local_set)} local codes "
                    f"detected in page HTML."
                )
                if missing_online and len(missing_online) < 15:
                    notes.append(
                        "Local codes not detected in HTML scrape (may still exist; page is JS-heavy): "
                        + ", ".join(sorted(missing_online)[:10])
                    )
                elif missing_online:
                    notes.append(
                        f"{len(missing_online)} local codes not detected in HTML scrape "
                        "(official site may render dynamically)."
                    )
            else:
                notes.append(f"Official page returned HTTP {resp.status_code}.")
    except Exception as exc:
        notes.append(f"Could not reach official source: {exc}")

    return ValidationResult(
        chapter=chapter_key,
        official_url=url,
        reachable=reachable,
        local_code_count=len(local_codes),
        notes=" ".join(notes),
        sample_codes=[n.code for n in local_codes[:12]],
    )
