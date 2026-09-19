from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "data" / "catalog.json"
REVIEW_DATA = ROOT / "data" / "time_review.json"
ACCEPTED_DATA = ROOT / "data" / "time_review_accepted.json"

PRIVATE_FILENAMES = {
    "friend_leaderboards_private.json",
    "level_times.json",
    "progress.json",
    "sessions.json",
    "settings.json",
    "levels.json",
    "CCGameManager.dat",
    "CCLocalLevels.dat",
}

FORBIDDEN_PUBLIC_SUFFIXES = {".rar", ".7z", ".xlsx", ".xls", ".exe", ".pyc"}

FORBIDDEN_DATA_FIELDS = {
    "gjp2",
    "password",
    "udid",
    "uuid",
    "account_id",
    "username",
    "reference_player",
    "leaderboard",
    "tracked",
    "manual_duration_seconds",
}


def walk_fields(value: Any):
    if isinstance(value, dict):
        for key, child in value.items():
            yield str(key).lower()
            yield from walk_fields(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_fields(child)


def check_json_fields(path: Path, problems: list[str]) -> Any:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        problems.append(f"Invalid JSON: {path.relative_to(ROOT)} ({exc})")
        return None
    found = FORBIDDEN_DATA_FIELDS.intersection(set(walk_fields(data)))
    if found:
        problems.append(
            f"Forbidden fields in {path.relative_to(ROOT)}: " + ", ".join(sorted(found))
        )
    return data


def main() -> int:
    problems: list[str] = []

    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT)
        if path.name in PRIVATE_FILENAMES:
            problems.append(f"Private file present: {rel}")
        if path.suffix.lower() in FORBIDDEN_PUBLIC_SUFFIXES:
            problems.append(f"Generated/binary working file present: {rel}")
        if "__pycache__" in path.parts:
            problems.append(f"Python cache present: {rel}")

    catalog = check_json_fields(CATALOG, problems)
    review = check_json_fields(REVIEW_DATA, problems) if REVIEW_DATA.exists() else None
    if ACCEPTED_DATA.exists():
        check_json_fields(ACCEPTED_DATA, problems)

    if isinstance(catalog, dict):
        levels = catalog.get("levels", [])
        ids = [str(row.get("level_id", "")) for row in levels if isinstance(row, dict)]
        if len(ids) != len(set(ids)):
            problems.append("Duplicate Level IDs in data/catalog.json")
    else:
        levels = []

    if isinstance(review, dict):
        privacy = review.get("privacy", {})
        if privacy.get("contains_friend_names") is not False:
            problems.append("data/time_review.json does not explicitly declare friend names absent")
        if privacy.get("contains_account_ids") is not False:
            problems.append("data/time_review.json does not explicitly declare account IDs absent")
        if privacy.get("contains_authentication_data") is not False:
            problems.append("data/time_review.json does not explicitly declare authentication data absent")

    for path in (ROOT / "contributions" / "time-fixes").glob("*.json"):
        check_json_fields(path, problems)

    if problems:
        print("Public repository check failed:")
        for problem in problems:
            print(" -", problem)
        return 1

    review_count = len(review.get("levels", [])) if isinstance(review, dict) else 0
    print(f"Public repository check passed. {len(levels):,} catalog levels are safe to publish.")
    if review_count:
        print(f"Time Reviewer data: {review_count:,} anonymized levels checked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
