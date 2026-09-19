from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

PUBLIC_LEVEL_FIELDS = (
    "level_id",
    "name",
    "creator",
    "difficulty",
    "rating",
    "moons",
)

FORBIDDEN_FIELD_NAMES = {
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


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def assert_public_safe(obj, path="root"):
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key.lower() in FORBIDDEN_FIELD_NAMES:
                raise ValueError(f"Forbidden field {key!r} found at {path}")
            assert_public_safe(value, f"{path}.{key}")
    elif isinstance(obj, list):
        for index, value in enumerate(obj):
            assert_public_safe(value, f"{path}[{index}]")


def clean_int(value):
    if value in (None, ""):
        return None
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def build_public_catalog(source: dict) -> dict:
    source_rows = source.get("levels", []) if isinstance(source, dict) else []
    levels = []

    for raw in source_rows:
        row = {key: raw.get(key) for key in PUBLIC_LEVEL_FIELDS}
        row["level_id"] = str(row.get("level_id") or "").strip()
        row["name"] = str(row.get("name") or "").strip()
        row["creator"] = str(row.get("creator") or "").strip()
        row["difficulty"] = str(row.get("difficulty") or "").strip() or "N/A"
        row["rating"] = str(row.get("rating") or "").strip() or "Rated"
        row["moons"] = clean_int(row.get("moons")) or 0

        # The public site intentionally exposes one estimate only. The desktop
        # export may contain several timing fields, but only the fetched public
        # estimate is used for MoonGrinder's planner.
        estimate = clean_int(raw.get("friends_duration_seconds"))
        row["estimated_duration_seconds"] = estimate

        if not row["level_id"] or not row["name"]:
            continue
        levels.append(row)

    levels.sort(key=lambda item: (0, int(item["level_id"])) if item["level_id"].isdigit() else (1, item["level_id"]))

    ids = [row["level_id"] for row in levels]
    duplicates = [level_id for level_id, count in Counter(ids).items() if count > 1]
    if duplicates:
        raise ValueError(f"Duplicate Level IDs in public catalog: {duplicates[:10]}")

    difficulty_counts = Counter(row["difficulty"] for row in levels)
    rating_counts = Counter(row["rating"] for row in levels)
    moon_counts = Counter(str(row["moons"]) for row in levels)
    timed_count = sum(row["estimated_duration_seconds"] is not None for row in levels)

    output = {
        "schema_version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_generated_at": source.get("generated_at") if isinstance(source, dict) else None,
        "privacy": {
            "contains_authentication_data": False,
            "contains_friend_names": False,
            "contains_personal_progress": False,
        },
        "stats": {
            "total_levels": len(levels),
            "levels_with_estimates": timed_count,
            "difficulty_counts": dict(sorted(difficulty_counts.items())),
            "rating_counts": dict(sorted(rating_counts.items())),
            "moon_counts": dict(sorted(moon_counts.items(), key=lambda pair: int(pair[0]))),
        },
        "levels": levels,
    }
    assert_public_safe(output)
    return output


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build MoonGrinder's public catalog from website_catalog.json."
    )
    parser.add_argument(
        "--source",
        required=True,
        help="Path to the MoonGrinder data/website_catalog.json file.",
    )
    parser.add_argument(
        "--output",
        default=str(Path(__file__).resolve().parents[1] / "data" / "catalog.json"),
        help="Destination public catalog JSON. Defaults to website/data/catalog.json.",
    )
    args = parser.parse_args()

    source_path = Path(args.source).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()

    source = load_json(source_path)
    public = build_public_catalog(source)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(public, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    stats = public["stats"]
    print(f"Wrote: {output_path}")
    print(f"Levels: {stats['total_levels']:,}")
    print(f"Levels with estimates: {stats['levels_with_estimates']:,}")
    print("Safety check passed: no auth data, private leaderboard names, or personal progress fields were written.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
