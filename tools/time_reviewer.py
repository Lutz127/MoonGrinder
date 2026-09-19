from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import threading
import urllib.parse
import uuid
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

TOOL_VERSION = 1
HOST = "127.0.0.1"
DEFAULT_PORT = 8781


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def atomic_write_json(path: Path, obj: Any, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    if compact:
        text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    else:
        text = json.dumps(obj, ensure_ascii=False, indent=2)
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def backup_file(path: Path, backup_dir: Path) -> None:
    if not path.exists():
        return
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    shutil.copy2(path, backup_dir / f"{path.stem}_{stamp}{path.suffix}")


def clean_ms(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return max(0, int(round(float(value))))
    except (TypeError, ValueError):
        return None


def percentile_value(times: list[int], p: int) -> int | None:
    if not times:
        return None
    values = sorted(max(0, int(x)) for x in times)
    if p <= 0:
        rank = 1
    elif p >= 100:
        rank = len(values)
    else:
        rank = max(1, math.ceil(len(values) * (p / 100)))
    return values[rank - 1]


def stats_for(times: list[int], p30_override_ms: int | None = None) -> dict[str, Any]:
    values = sorted(max(0, int(x)) for x in times)
    computed_p30 = percentile_value(values, 30)
    effective = p30_override_ms if p30_override_ms is not None else computed_p30
    rank30 = max(1, math.ceil(len(values) * 0.30)) if values else None
    next_after_p30 = values[rank30] if rank30 and rank30 < len(values) else None
    return {
        "sample_count": len(values),
        "fastest_ms": percentile_value(values, 0),
        "p10_ms": percentile_value(values, 10),
        "p20_ms": percentile_value(values, 20),
        "computed_p30_ms": computed_p30,
        "effective_p30_ms": effective,
        "p30_next_ms": next_after_p30,
        "p50_ms": percentile_value(values, 50),
        "p90_ms": percentile_value(values, 90),
        "slowest_ms": percentile_value(values, 100),
    }


def flags_for(times: list[int], effective_p30_ms: int | None, published_ms: int | None = None) -> list[dict[str, Any]]:
    s = stats_for(times, effective_p30_ms if effective_p30_ms != s_if_none(times) else None)
    # Use caller's effective value exactly, even if it is an override.
    p30 = effective_p30_ms
    fastest = s["fastest_ms"]
    median = s["p50_ms"]
    nxt = s["p30_next_ms"]
    n = s["sample_count"]
    out: list[dict[str, Any]] = []

    def add(code: str, label: str, severity: int) -> None:
        out.append({"code": code, "label": label, "severity": severity})

    if p30 is None:
        add("missing_p30", "missing P30", 5)
        return out
    if p30 < 15_000:
        add("p30_under_15", "P30 under 15s", 4)
    elif p30 < 30_000:
        add("p30_under_30", "P30 under 30s", 2)
    if fastest is not None and fastest < 1_000:
        add("fastest_under_1", "fastest under 1s", 5)
    if fastest and p30 and fastest < p30 * 0.20:
        add("fastest_outlier", "fastest is <20% of P30", 2)
    if p30 and median and p30 < median * 0.35:
        add("p30_vs_median", "P30 much lower than median", 5)
    if p30 and nxt and nxt > p30 * 5:
        add("jump_after_p30", "huge jump immediately after P30", 5)
    if n < 3:
        add("low_sample", "fewer than 3 scores", 4)
    elif n < 10:
        add("small_sample", "fewer than 10 scores", 1)
    slowest = s["slowest_ms"]
    if median and slowest and slowest > median * 20:
        add("long_tail", "slowest is >20x median", 1)
    if published_ms is not None and abs(int(published_ms) - int(p30)) > 1500:
        add("published_diff", "published estimate differs from review P30", 3)
    return out


def s_if_none(times: list[int]) -> int | None:
    return percentile_value(times, 30)


class ReviewerStore:
    def __init__(self, repo_root: Path, private_data: Path | None = None):
        self.repo_root = repo_root
        self.data_dir = repo_root / "data"
        self.review_path = self.data_dir / "time_review.json"
        self.accepted_path = self.data_dir / "time_review_accepted.json"
        self.catalog_path = self.data_dir / "catalog.json"
        self.contributions_dir = repo_root / "contributions" / "time-fixes"
        self.private_data = private_data or self._auto_private_data()
        self.lock = threading.RLock()
        self.review: dict[str, Any] = {}
        self.levels: dict[str, dict[str, Any]] = {}
        self.catalog: dict[str, dict[str, Any]] = {}
        self.accepted = load_json(self.accepted_path, {"schema_version": 1, "levels": {}, "accepted_contributions": {}})
        if not isinstance(self.accepted, dict):
            self.accepted = {"schema_version": 1, "levels": {}, "accepted_contributions": {}}
        self.accepted.setdefault("levels", {})
        self.accepted.setdefault("accepted_contributions", {})
        self._load_catalog()
        if not self.review_path.exists() and self.private_data:
            self.refresh_public_review_data()
        self.reload_review()

    def _auto_private_data(self) -> Path | None:
        env = os.environ.get("MOONGRINDER_PRIVATE_DATA")
        candidates = []
        if env:
            candidates.append(Path(env).expanduser())
        candidates += [
            self.repo_root.parent / "Moongrinding V2" / "data",
            self.repo_root.parent / "Moongrinding v2" / "data",
            self.repo_root.parent / "Moongrinding V2" / "Data",
        ]
        for p in candidates:
            if (p / "friend_leaderboards_private.json").exists() and (p / "level_times.json").exists():
                return p.resolve()
        return None

    def _load_catalog(self) -> None:
        obj = load_json(self.catalog_path, {})
        rows = obj.get("levels", []) if isinstance(obj, dict) else []
        self.catalog = {str(x.get("level_id")): x for x in rows if isinstance(x, dict) and x.get("level_id")}

    def reload_review(self) -> None:
        with self.lock:
            obj = load_json(self.review_path, {})
            rows = obj.get("levels", []) if isinstance(obj, dict) else []
            self.review = obj if isinstance(obj, dict) else {}
            self.levels = {str(x.get("level_id")): x for x in rows if isinstance(x, dict) and x.get("level_id")}

    def refresh_public_review_data(self) -> dict[str, Any]:
        if not self.private_data:
            raise RuntimeError("Private MoonGrinder data was not found. Only the repo owner needs this action.")
        with self.lock:
            private_path = self.private_data / "friend_leaderboards_private.json"
            times_path = self.private_data / "level_times.json"
            rated_path = self.private_data / "rated_catalog.json"
            prv = load_json(private_path, {})
            tms = load_json(times_path, {})
            rated = load_json(rated_path, {})
            prv_levels = prv.get("levels", {}) if isinstance(prv, dict) else {}
            time_levels = tms.get("levels", {}) if isinstance(tms, dict) else {}
            rated_rows = rated.get("levels", []) if isinstance(rated, dict) else []
            rated_by_id = {str(x.get("level_id")): x for x in rated_rows if isinstance(x, dict) and x.get("level_id")}
            accepted_levels = self.accepted.get("levels", {}) if isinstance(self.accepted, dict) else {}

            ids = sorted(set(self.catalog) | set(rated_by_id) | set(prv_levels), key=lambda s: (not s.isdigit(), int(s) if s.isdigit() else s))
            rows = []
            for lid in ids:
                cat = self.catalog.get(lid, {})
                rr = rated_by_id.get(lid, {})
                pv = prv_levels.get(lid, {}) if isinstance(prv_levels, dict) else {}
                tv = time_levels.get(lid, {}) if isinstance(time_levels, dict) else {}
                board = pv.get("leaderboard", []) if isinstance(pv, dict) else []
                raw_times = []
                if isinstance(board, list):
                    for entry in board:
                        if isinstance(entry, dict):
                            ms = clean_ms(entry.get("time_ms"))
                            if ms is not None:
                                raw_times.append(ms)
                raw_times.sort()

                override = None
                if isinstance(pv, dict):
                    ovs = pv.get("percentile_overrides_ms")
                    if isinstance(ovs, dict):
                        override = clean_ms(ovs.get("p30"))
                effective = clean_ms(tv.get("friends_duration_ms")) if isinstance(tv, dict) else None
                if effective is None:
                    effective = override if override is not None else percentile_value(raw_times, 30)

                accepted = accepted_levels.get(lid, {}) if isinstance(accepted_levels, dict) else {}
                if isinstance(accepted, dict) and accepted:
                    if isinstance(accepted.get("times_ms"), list):
                        raw_times = sorted(clean_ms(x) for x in accepted["times_ms"] if clean_ms(x) is not None)
                    if "effective_p30_ms" in accepted:
                        effective = clean_ms(accepted.get("effective_p30_ms"))
                    source = "accepted community review"
                else:
                    source = str(tv.get("friends_duration_source") or ("manual P30" if override is not None else "leaderboard P30")) if isinstance(tv, dict) else "leaderboard P30"

                meta = rr or cat
                rows.append({
                    "level_id": lid,
                    "name": str(meta.get("name") or pv.get("name") or lid),
                    "creator": str(meta.get("creator") or meta.get("author") or ""),
                    "difficulty": str(meta.get("difficulty") or "N/A"),
                    "rating": str(meta.get("rating") or "Rated"),
                    "moons": int(meta.get("moons") or 0),
                    "times_ms": raw_times,
                    "effective_p30_ms": effective,
                    "source": source,
                })

            output = {
                "schema_version": 1,
                "generated_at": now_iso(),
                "privacy": {
                    "contains_friend_names": False,
                    "contains_account_ids": False,
                    "contains_authentication_data": False,
                    "contains_only_anonymized_times": True,
                },
                "levels": rows,
            }
            atomic_write_json(self.review_path, output, compact=True)
            self.reload_review()
            return {"levels": len(rows), "path": str(self.review_path)}

    def _public_ms(self, lid: str) -> int | None:
        row = self.catalog.get(lid, {})
        sec = row.get("estimated_duration_seconds") if isinstance(row, dict) else None
        try:
            return int(round(float(sec) * 1000)) if sec is not None else None
        except Exception:
            return None

    def summary_row(self, row: dict[str, Any]) -> dict[str, Any]:
        times = [int(x) for x in row.get("times_ms", []) if isinstance(x, (int, float))]
        effective = clean_ms(row.get("effective_p30_ms"))
        s = stats_for(times)
        flags = flags_for(times, effective, self._public_ms(str(row.get("level_id"))))
        return {
            "level_id": str(row.get("level_id")),
            "name": row.get("name"),
            "creator": row.get("creator"),
            "difficulty": row.get("difficulty"),
            "rating": row.get("rating"),
            "moons": row.get("moons"),
            "sample_count": len(times),
            "computed_p30_ms": s["computed_p30_ms"],
            "effective_p30_ms": effective,
            "source": row.get("source"),
            "flags": flags,
            "flag_score": sum(int(x.get("severity", 0)) for x in flags),
        }

    def search(self, query: str = "", difficulty: str = "", flagged: str = "all", sort: str = "severity", limit: int = 250) -> dict[str, Any]:
        q = query.strip().lower()
        items = []
        all_flagged = 0
        for row in self.levels.values():
            s = self.summary_row(row)
            if s["flags"]:
                all_flagged += 1
            if difficulty and difficulty != "All" and s["difficulty"] != difficulty:
                continue
            hay = f"{s['level_id']} {s['name']} {s['creator']}".lower()
            if q and q not in hay:
                continue
            if flagged == "flagged" and not s["flags"]:
                continue
            if flagged == "clean" and s["flags"]:
                continue
            items.append(s)

        if sort == "p30":
            items.sort(key=lambda x: (x["effective_p30_ms"] is None, x["effective_p30_ms"] or 10**30, str(x["name"]).lower()))
        elif sort == "name":
            items.sort(key=lambda x: (str(x["name"]).lower(), x["level_id"]))
        elif sort == "samples":
            items.sort(key=lambda x: (-x["sample_count"], str(x["name"]).lower()))
        else:
            items.sort(key=lambda x: (-x["flag_score"], -len(x["flags"]), str(x["name"]).lower()))

        return {
            "items": items[:limit],
            "matched": len(items),
            "total": len(self.levels),
            "flagged_total": all_flagged,
        }

    def detail(self, lid: str) -> dict[str, Any]:
        row = self.levels.get(str(lid))
        if not row:
            raise KeyError("Level not found")
        times = sorted(int(x) for x in row.get("times_ms", []))
        effective = clean_ms(row.get("effective_p30_ms"))
        s = stats_for(times)
        return {
            **row,
            "times_ms": times,
            "stats": s,
            "flags": flags_for(times, effective, self._public_ms(str(lid))),
            "published_estimate_ms": self._public_ms(str(lid)),
        }

    def create_contribution(self, payload: dict[str, Any]) -> dict[str, Any]:
        changes = payload.get("levels")
        if not isinstance(changes, list) or not changes:
            raise ValueError("No staged level changes were supplied.")
        safe_levels = []
        for change in changes:
            if not isinstance(change, dict):
                continue
            lid = str(change.get("level_id") or "")
            if lid not in self.levels:
                raise ValueError(f"Unknown level ID: {lid}")
            proposed_times = change.get("times_ms")
            if not isinstance(proposed_times, list):
                raise ValueError(f"times_ms must be a list for {lid}")
            clean_times = [clean_ms(x) for x in proposed_times]
            if any(x is None for x in clean_times):
                raise ValueError(f"Invalid time in {lid}")
            clean_times = sorted(int(x) for x in clean_times if x is not None)
            if len(clean_times) > 500:
                raise ValueError("Refusing more than 500 sample times for one level.")
            effective = clean_ms(change.get("effective_p30_ms"))
            if effective is None:
                effective = percentile_value(clean_times, 30)
            original = self.detail(lid)
            safe_levels.append({
                "level_id": lid,
                "name": original["name"],
                "note": str(change.get("note") or "").strip()[:2000],
                "original": {
                    "times_ms": original["times_ms"],
                    "effective_p30_ms": original["effective_p30_ms"],
                },
                "proposed": {
                    "times_ms": clean_times,
                    "effective_p30_ms": effective,
                },
            })
        if not safe_levels:
            raise ValueError("No valid changes were supplied.")

        cid = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
        obj = {
            "schema_version": 1,
            "tool_version": TOOL_VERSION,
            "contribution_id": cid,
            "created_at": now_iso(),
            "author": str(payload.get("author") or "").strip()[:200],
            "levels": safe_levels,
        }
        self.contributions_dir.mkdir(parents=True, exist_ok=True)
        path = self.contributions_dir / f"{cid}.json"
        atomic_write_json(path, obj)
        return {"ok": True, "contribution_id": cid, "path": str(path), "levels": len(safe_levels)}

    def list_contributions(self) -> list[dict[str, Any]]:
        self.contributions_dir.mkdir(parents=True, exist_ok=True)
        accepted_ids = set(self.accepted.get("accepted_contributions", {}))
        out = []
        for path in sorted(self.contributions_dir.glob("*.json"), reverse=True):
            obj = load_json(path, {})
            if not isinstance(obj, dict) or not obj.get("contribution_id"):
                continue
            cid = str(obj.get("contribution_id"))
            out.append({
                "contribution_id": cid,
                "created_at": obj.get("created_at"),
                "author": obj.get("author"),
                "level_count": len(obj.get("levels", [])) if isinstance(obj.get("levels"), list) else 0,
                "accepted": cid in accepted_ids,
                "filename": path.name,
            })
        return out

    def contribution_detail(self, cid: str) -> dict[str, Any]:
        path = self.contributions_dir / f"{cid}.json"
        obj = load_json(path, {})
        if not isinstance(obj, dict) or str(obj.get("contribution_id")) != cid:
            raise KeyError("Contribution not found")
        return obj

    def _update_private_effective_p30(self, proposals: list[dict[str, Any]], contribution_id: str) -> None:
        if not self.private_data:
            return
        friend_path = self.private_data / "friend_leaderboards_private.json"
        times_path = self.private_data / "level_times.json"
        website_path = self.private_data / "website_catalog.json"
        backup_dir = self.private_data / "backups" / "community_time_reviewer"
        for p in (friend_path, times_path, website_path):
            backup_file(p, backup_dir)

        friend = load_json(friend_path, {})
        times = load_json(times_path, {})
        website = load_json(website_path, {})
        friend.setdefault("levels", {})
        times.setdefault("levels", {})
        website_rows = website.get("levels", []) if isinstance(website, dict) else []
        website_by_id = {str(x.get("level_id")): x for x in website_rows if isinstance(x, dict)}

        stamp = now_iso()
        for item in proposals:
            lid = str(item["level_id"])
            ms = clean_ms(item.get("effective_p30_ms"))
            if ms is None:
                continue
            frow = friend["levels"].setdefault(lid, {})
            if not isinstance(frow, dict):
                frow = {}
                friend["levels"][lid] = frow
            ovs = frow.setdefault("percentile_overrides_ms", {})
            if not isinstance(ovs, dict):
                ovs = {}
                frow["percentile_overrides_ms"] = ovs
            ovs["p30"] = ms
            frow["community_review_at"] = stamp
            frow["community_review_id"] = contribution_id

            trow = times["levels"].setdefault(lid, {})
            if not isinstance(trow, dict):
                trow = {}
                times["levels"][lid] = trow
            trow["friends_duration_ms"] = ms
            trow["friends_duration_seconds"] = ms / 1000.0
            trow["friends_duration_source"] = "community_review"
            trow.setdefault("friends_percentile_overrides_ms", {})["p30"] = ms
            trow["friends_fetched_at"] = stamp

            wrow = website_by_id.get(lid)
            if isinstance(wrow, dict):
                wrow["friends_duration_ms"] = ms
                wrow["friends_duration_seconds"] = ms / 1000.0
                wrow["friends_fetched_at"] = stamp

        friend["updated_at"] = stamp
        times["updated_at"] = stamp
        if isinstance(website, dict):
            website["generated_at"] = stamp
        atomic_write_json(friend_path, friend)
        atomic_write_json(times_path, times)
        if isinstance(website, dict) and website_path.exists():
            atomic_write_json(website_path, website)

    def _update_public_catalog(self, proposals: list[dict[str, Any]]) -> None:
        obj = load_json(self.catalog_path, {})
        rows = obj.get("levels", []) if isinstance(obj, dict) else []
        by_id = {str(x.get("level_id")): x for x in rows if isinstance(x, dict)}
        for item in proposals:
            lid = str(item["level_id"])
            ms = clean_ms(item.get("effective_p30_ms"))
            if ms is None or lid not in by_id:
                continue
            by_id[lid]["estimated_duration_seconds"] = int(round(ms / 1000.0))
        if isinstance(obj, dict):
            obj["generated_at"] = now_iso()
            atomic_write_json(self.catalog_path, obj, compact=True)
        self._load_catalog()

    def apply_levels(self, proposals: list[dict[str, Any]], contribution_id: str, notes_by_id: dict[str, str] | None = None) -> dict[str, Any]:
        if not self.private_data:
            raise RuntimeError("Maintainer mode is unavailable because the private Moongrinding V2 data folder was not found.")
        notes_by_id = notes_by_id or {}
        accepted_levels = self.accepted.setdefault("levels", {})
        clean_props = []
        for p in proposals:
            lid = str(p.get("level_id") or "")
            if lid not in self.levels:
                raise ValueError(f"Unknown level ID: {lid}")
            times = p.get("times_ms")
            if not isinstance(times, list):
                raise ValueError(f"Missing times for {lid}")
            vals = [clean_ms(x) for x in times]
            if any(x is None for x in vals):
                raise ValueError(f"Invalid sample time for {lid}")
            vals = sorted(int(x) for x in vals if x is not None)
            ms = clean_ms(p.get("effective_p30_ms"))
            if ms is None:
                ms = percentile_value(vals, 30)
            if ms is None:
                raise ValueError(f"Cannot apply {lid} without a P30.")
            accepted_levels[lid] = {
                "times_ms": vals,
                "effective_p30_ms": ms,
                "note": str(notes_by_id.get(lid) or "").strip()[:2000],
                "accepted_at": now_iso(),
                "contribution_id": contribution_id,
            }
            clean_props.append({"level_id": lid, "times_ms": vals, "effective_p30_ms": ms})

        self.accepted.setdefault("accepted_contributions", {})[contribution_id] = {
            "accepted_at": now_iso(),
            "level_count": len(clean_props),
        }
        atomic_write_json(self.accepted_path, self.accepted)
        self._update_private_effective_p30(clean_props, contribution_id)
        self._update_public_catalog(clean_props)
        self.refresh_public_review_data()
        return {"ok": True, "applied": len(clean_props), "contribution_id": contribution_id}

    def apply_contribution(self, cid: str) -> dict[str, Any]:
        obj = self.contribution_detail(cid)
        proposals = []
        notes = {}
        for item in obj.get("levels", []):
            if not isinstance(item, dict) or not isinstance(item.get("proposed"), dict):
                continue
            lid = str(item.get("level_id"))
            proposals.append({"level_id": lid, **item["proposed"]})
            notes[lid] = str(item.get("note") or "")
        return self.apply_levels(proposals, cid, notes)


HTML = r'''<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MoonGrinder Time Reviewer</title>
<style>
:root{color-scheme:dark;--bg:#080b11;--panel:#101722;--panel2:#0c121b;--border:#263248;--text:#f4f7fb;--muted:#91a4c4;--purple:#7c5cff;--cyan:#48d8f4;--good:#47d69b;--warn:#ffd166;--bad:#ff727d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,Segoe UI,Arial,sans-serif}button,input,select,textarea{font:inherit}.app{display:grid;grid-template-columns:390px 1fr;min-height:100vh}.side{border-right:1px solid var(--border);background:#0b1018;padding:18px;height:100vh;position:sticky;top:0;overflow:auto}.main{padding:22px;min-width:0}.brand{font-size:25px;font-weight:900}.brand span{color:var(--cyan)}.sub{color:var(--muted);font-size:12px;margin-top:2px}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.filters{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.filters .wide{grid-column:1/-1}input,select,textarea{background:#090f17;color:var(--text);border:1px solid var(--border);border-radius:9px;padding:9px 10px;outline:none}input:focus,select:focus,textarea:focus{border-color:var(--purple)}button{background:#182131;color:var(--text);border:1px solid var(--border);border-radius:9px;padding:8px 11px;cursor:pointer}button:hover{border-color:#526581}.primary{background:linear-gradient(135deg,#7050ff,#8b67ff);border-color:#8b67ff;font-weight:800}.good{background:#10261f;border-color:#28664f;color:#baf7df}.danger{background:#28161b;border-color:#68313d;color:#ffd6da}.results{margin-top:12px;display:flex;flex-direction:column;gap:7px}.result{padding:10px 11px;border:1px solid var(--border);border-radius:10px;background:var(--panel);cursor:pointer}.result:hover,.result.active{border-color:var(--purple)}.rname{font-weight:800}.rmeta{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:11px;margin-top:3px}.flagline{margin-top:6px;display:flex;gap:4px;flex-wrap:wrap}.chip{display:inline-flex;align-items:center;padding:3px 7px;border-radius:999px;border:1px solid var(--border);font-size:10px;color:#c7d4e9;background:#101722}.chip.s5{color:#ffd6da;border-color:#68313d;background:#28161b}.chip.s4,.chip.s3{color:#ffe5a3;border-color:#665325;background:#2a2415}.chip.s2,.chip.s1{color:#cbd6e9}.header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.header h1{margin:0;font-size:29px}.meta{color:var(--muted);margin-top:5px}.cards{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:16px 0}.card{background:var(--panel);border:1px solid var(--border);border-radius:11px;padding:12px;min-width:0}.card .label{color:var(--muted);font-size:11px}.card .value{font-size:19px;font-weight:900;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.panel{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:15px;margin-top:12px}.panel h2{font-size:18px;margin:0 0 10px}.notice{padding:10px 12px;border:1px solid #2d5948;background:#0d211a;border-radius:9px;margin:10px 0;color:#c4f1df}.notice.warn{border-color:#665325;background:#2a2415;color:#ffe8ae}.notice.bad{border-color:#68313d;background:#28161b;color:#ffd6da}.tablebox{border:1px solid var(--border);border-radius:10px;overflow:auto;max-height:56vh}table{border-collapse:collapse;width:100%}th,td{padding:8px 9px;border-bottom:1px solid #202b3c;text-align:left;white-space:nowrap}th{position:sticky;top:0;background:#141d2a;color:#c8d5e9;font-size:10px;text-transform:uppercase;z-index:2}.timeinput{width:150px}.rowbtn{padding:5px 8px;font-size:11px}.editgrid{display:grid;grid-template-columns:220px 1fr;gap:10px}.editgrid textarea{min-height:78px;resize:vertical}.empty{padding:38px 18px;text-align:center;color:var(--muted)}.footerbar{position:sticky;bottom:0;margin-top:14px;padding:10px;border:1px solid var(--border);background:rgba(10,15,23,.96);backdrop-filter:blur(10px);border-radius:12px;display:flex;justify-content:space-between;gap:10px;align-items:center}.count{color:var(--muted);font-size:12px}.topstats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:12px}.topstat{padding:8px 9px;background:#0a111a;border:1px solid var(--border);border-radius:9px}.topstat b{display:block;font-size:16px}.pendingcard{border:1px solid var(--border);border-radius:10px;padding:12px;margin:8px 0;background:var(--panel2)}.pendingcard.accepted{opacity:.55}.tabbar{display:flex;gap:7px;margin:14px 0}.tabbar button.active{background:var(--purple);border-color:var(--purple);font-weight:800}.hidden{display:none!important}
@media(max-width:1150px){.cards{grid-template-columns:repeat(3,1fr)}}@media(max-width:800px){.app{grid-template-columns:1fr}.side{position:relative;height:auto;border-right:0;border-bottom:1px solid var(--border)}.cards{grid-template-columns:repeat(2,1fr)}.editgrid{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="app">
  <aside class="side">
    <div class="brand">MoonGrinder <span>Time Reviewer</span></div>
    <div class="sub">Public-safe local tool. Player names and account IDs are never included in review data or contributions.</div>
    <div class="topstats">
      <div class="topstat"><span class="sub">Levels</span><b id="totalLevels">-</b></div>
      <div class="topstat"><span class="sub">Flagged</span><b id="flaggedLevels">-</b></div>
      <div class="topstat"><span class="sub">Staged</span><b id="stagedCount">0</b></div>
    </div>
    <div class="filters">
      <input class="wide" id="search" placeholder="Search level, ID, creator">
      <select id="difficulty"><option>All</option></select>
      <select id="flagged"><option value="flagged">Flagged only</option><option value="all">All levels</option><option value="clean">No flags</option></select>
      <select id="sort"><option value="severity">Most suspicious</option><option value="p30">Shortest P30</option><option value="samples">Most samples</option><option value="name">Name</option></select>
      <button id="refreshSearch">Refresh</button>
    </div>
    <div class="sub" id="matchInfo" style="margin-top:10px"></div>
    <div class="results" id="results"></div>
  </aside>
  <main class="main">
    <div class="tabbar">
      <button class="active" data-tab="review">Review levels</button>
      <button data-tab="pending">Pending contributions</button>
      <button id="refreshDataBtn" class="hidden">Refresh anonymized data</button>
    </div>
    <section id="reviewTab">
      <div id="detail"><div class="empty">Pick a level on the left. Flagged levels are shown first.</div></div>
      <div class="footerbar">
        <div><b id="stageSummary">No staged changes</b><div class="count">Stage as many levels as you want, then save one small contribution file.</div></div>
        <div class="toolbar"><input id="author" placeholder="Your name / GitHub username (optional)" style="width:250px"><button id="saveContribution" class="primary" disabled>Save contribution</button><button id="applyDirect" class="good hidden" disabled>Apply staged directly</button></div>
      </div>
    </section>
    <section id="pendingTab" class="hidden"><div class="panel"><h2>Pending contribution files</h2><div class="sub">Contributors only need to commit the generated JSON file in <code>contributions/time-fixes/</code>. In maintainer mode you can review and apply them here.</div><div id="pendingList"></div></div></section>
  </main>
</div>
<script>
let meta=null,current=null,workingTimes=[],workingEffective=null,workingNote='',drafts={};
const $=id=>document.getElementById(id);
function esc(s){const d=document.createElement('div');d.textContent=String(s??'');return d.innerHTML}
function fmt(ms){if(ms===null||ms===undefined)return '—';ms=Math.round(Number(ms));let h=Math.floor(ms/3600000),r=ms%3600000,m=Math.floor(r/60000),s=Math.floor((r%60000)/1000),z=ms%1000;if(h)return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(z).padStart(3,'0')}`;return `${m}:${String(s).padStart(2,'0')}.${String(z).padStart(3,'0')}`}
function parseTime(v){v=String(v).trim();if(/^\d+$/.test(v))return Number(v);let p=v.split(':').map(Number);if(p.some(x=>!Number.isFinite(x)))throw new Error('Use milliseconds, M:SS.mmm, or H:MM:SS.mmm');if(p.length===2)return Math.round((p[0]*60+p[1])*1000);if(p.length===3)return Math.round((p[0]*3600+p[1]*60+p[2])*1000);throw new Error('Use milliseconds, M:SS.mmm, or H:MM:SS.mmm')}
async function api(path,opts={}){const r=await fetch(path,{headers:{'Content-Type':'application/json'},...opts});const o=await r.json();if(!r.ok)throw new Error(o.error||'Request failed');return o}
function percentile(a,p){if(!a.length)return null;const v=[...a].sort((x,y)=>x-y);let rank=p<=0?1:p>=100?v.length:Math.max(1,Math.ceil(v.length*(p/100)));return v[rank-1]}
function stats(a){const v=[...a].sort((x,y)=>x-y);return {fastest_ms:percentile(v,0),p10_ms:percentile(v,10),computed_p30_ms:percentile(v,30),p50_ms:percentile(v,50),p90_ms:percentile(v,90),slowest_ms:percentile(v,100),sample_count:v.length}}
function chipHtml(f){return `<span class="chip s${f.severity||1}">${esc(f.label)}</span>`}
async function loadMeta(){meta=await api('/api/meta');$('refreshDataBtn').classList.toggle('hidden',!meta.maintainer_mode);$('applyDirect').classList.toggle('hidden',!meta.maintainer_mode);const sel=$('difficulty');for(const d of meta.difficulties){let o=document.createElement('option');o.value=d;o.textContent=d;sel.appendChild(o)}await runSearch();await loadPending()}
async function runSearch(){const q=new URLSearchParams({q:$('search').value,difficulty:$('difficulty').value,flagged:$('flagged').value,sort:$('sort').value});const o=await api('/api/search?'+q);$('totalLevels').textContent=o.total.toLocaleString();$('flaggedLevels').textContent=o.flagged_total.toLocaleString();$('matchInfo').textContent=`${o.matched.toLocaleString()} matching levels${o.matched>o.items.length?` · showing first ${o.items.length}`:''}`;$('results').innerHTML=o.items.map(x=>`<div class="result ${current&&current.level_id===x.level_id?'active':''}" data-id="${x.level_id}"><div class="rname">${esc(x.name)}</div><div class="rmeta"><span>${esc(x.difficulty)} · ${x.level_id}</span><span>${fmt(x.effective_p30_ms)} · ${x.sample_count} scores</span></div>${x.flags.length?`<div class="flagline">${x.flags.slice(0,3).map(chipHtml).join('')}${x.flags.length>3?`<span class="chip">+${x.flags.length-3}</span>`:''}</div>`:''}</div>`).join('')||'<div class="empty">No matches.</div>';$('results').querySelectorAll('.result').forEach(el=>el.onclick=()=>openLevel(el.dataset.id))}
async function openLevel(id){current=await api('/api/level/'+encodeURIComponent(id));const d=drafts[id];workingTimes=d?[...d.times_ms]:[...current.times_ms];workingEffective=d?d.effective_p30_ms:current.effective_p30_ms;workingNote=d?d.note:'';renderDetail();await runSearch()}
function statCard(label,value){return `<div class="card"><div class="label">${label}</div><div class="value">${fmt(value)}</div></div>`}
function renderDetail(){if(!current)return;const s=stats(workingTimes);const isOverride=workingEffective!==s.computed_p30_ms;const flags=current.flags||[];$('detail').innerHTML=`<div class="header"><div><h1>${esc(current.name)}</h1><div class="meta">${current.level_id} · ${esc(current.creator||'')} · ${esc(current.difficulty)} · ${esc(current.rating)} · ${current.moons} moons</div><div class="flagline" style="margin-top:9px">${flags.map(chipHtml).join('')||'<span class="chip">No automatic flags</span>'}</div></div><div class="toolbar"><button id="copyId">Copy ID</button><button id="nextFlag">Next flagged</button></div></div><div class="cards">${statCard('Fastest',s.fastest_ms)}${statCard('P10',s.p10_ms)}${statCard('Computed P30',s.computed_p30_ms)}${statCard('P50',s.p50_ms)}${statCard('P90',s.p90_ms)}${statCard('Slowest',s.slowest_ms)}</div><div class="panel"><h2>Effective estimate</h2><div class="editgrid"><div><label class="sub">P30 used by MoonGrinder</label><input id="effectiveInput" value="${fmt(workingEffective)}"><div class="sub" style="margin-top:5px">${isOverride?'Currently differs from the corrected sample P30.':'Matches the corrected sample P30.'}</div></div><div><label class="sub">Why are you changing this?</label><textarea id="note" placeholder="Example: old impossible records before a level update, obvious hacked score, timing tested in current version...">${esc(workingNote)}</textarea></div></div><div class="toolbar" style="margin-top:10px"><button id="useComputed">Use computed P30 (${fmt(s.computed_p30_ms)})</button><button id="stage" class="primary">Stage this level</button><button id="reset" class="danger">Reset this level</button></div></div><div class="panel"><h2>Anonymized completion times</h2><div class="sub" style="margin-bottom:10px">No usernames or account IDs are published. Edit or remove obviously bad times, or add a missing valid time. Statistics above recalculate from this list.</div><div class="toolbar"><input id="addTime" placeholder="M:SS.mmm" style="width:180px"><button id="addTimeBtn">Add time</button><span class="sub">${workingTimes.length} samples</span></div><div class="tablebox"><table><thead><tr><th>Rank</th><th>Time</th><th>Position</th><th></th></tr></thead><tbody id="timesBody"></tbody></table></div></div>`;renderTimes();$('copyId').onclick=()=>navigator.clipboard.writeText(current.level_id);$('effectiveInput').onchange=()=>{try{workingEffective=parseTime($('effectiveInput').value);renderDetail()}catch(e){alert(e.message)}};$('note').oninput=e=>workingNote=e.target.value;$('useComputed').onclick=()=>{workingEffective=s.computed_p30_ms;renderDetail()};$('stage').onclick=stageCurrent;$('reset').onclick=()=>{delete drafts[current.level_id];workingTimes=[...current.times_ms];workingEffective=current.effective_p30_ms;workingNote='';updateStageCount();renderDetail()};$('addTimeBtn').onclick=()=>{try{workingTimes.push(parseTime($('addTime').value));workingTimes.sort((a,b)=>a-b);workingEffective=percentile(workingTimes,30);renderDetail()}catch(e){alert(e.message)}};$('nextFlag').onclick=nextFlagged}
function renderTimes(){const body=$('timesBody');if(!body)return;const n=workingTimes.length,rank30=n?Math.max(1,Math.ceil(n*.30)):0;body.innerHTML=workingTimes.map((ms,i)=>`<tr><td>#${i+1}</td><td><input class="timeinput tedit" data-i="${i}" value="${fmt(ms)}"></td><td>${i+1===rank30?'<span class="chip s3">P30 rank</span>':''}${i===0?'<span class="chip">fastest</span>':''}${i===n-1?'<span class="chip">slowest</span>':''}</td><td><button class="rowbtn danger remove" data-i="${i}">Remove</button></td></tr>`).join('')||'<tr><td colspan="4" class="empty">No completion times.</td></tr>';body.querySelectorAll('.tedit').forEach(el=>el.onchange=()=>{try{workingTimes[Number(el.dataset.i)]=parseTime(el.value);workingTimes.sort((a,b)=>a-b);workingEffective=percentile(workingTimes,30);renderDetail()}catch(e){alert(e.message)}});body.querySelectorAll('.remove').forEach(el=>el.onclick=()=>{workingTimes.splice(Number(el.dataset.i),1);workingEffective=percentile(workingTimes,30);renderDetail()})}
function stageCurrent(){if(!current)return;workingNote=$('note')?$('note').value:workingNote;drafts[current.level_id]={level_id:current.level_id,times_ms:[...workingTimes].sort((a,b)=>a-b),effective_p30_ms:workingEffective,note:workingNote};updateStageCount();renderDetail()}
function updateStageCount(){const n=Object.keys(drafts).length;$('stagedCount').textContent=n;$('stageSummary').textContent=n?`${n} staged level${n===1?'':'s'}`:'No staged changes';$('saveContribution').disabled=!n;$('applyDirect').disabled=!n}
async function saveContribution(){try{const o=await api('/api/contribute',{method:'POST',body:JSON.stringify({author:$('author').value,levels:Object.values(drafts)})});alert(`Contribution saved.\n\n${o.path}\n\nCommit only that JSON file to GitHub.`);drafts={};updateStageCount();await loadPending()}catch(e){alert(e.message)}}
async function applyDirect(){if(!confirm(`Apply ${Object.keys(drafts).length} staged level(s) to your private MoonGrinder timing data and public catalog?\n\nBackups will be created first.`))return;try{const cid='local-'+new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);const o=await api('/api/apply-direct',{method:'POST',body:JSON.stringify({contribution_id:cid,levels:Object.values(drafts)})});alert(`Applied ${o.applied} level(s).`);drafts={};updateStageCount();current=null;$('detail').innerHTML='<div class="empty">Changes applied. Pick another level.</div>';await runSearch();await loadPending()}catch(e){alert(e.message)}}
async function loadPending(){const rows=await api('/api/contributions');$('pendingList').innerHTML=rows.map(x=>`<div class="pendingcard ${x.accepted?'accepted':''}"><b>${esc(x.filename)}</b><div class="sub">${x.level_count} level${x.level_count===1?'':'s'} · ${esc(x.author||'anonymous')} · ${esc(x.created_at||'')}</div><div class="toolbar" style="margin-top:8px"><button class="viewContrib" data-id="${x.contribution_id}">View JSON</button>${meta&&meta.maintainer_mode&&!x.accepted?`<button class="good applyContrib" data-id="${x.contribution_id}">Apply contribution</button>`:''}${x.accepted?'<span class="chip">accepted</span>':''}</div></div>`).join('')||'<div class="empty">No contribution JSON files yet.</div>';$('pendingList').querySelectorAll('.viewContrib').forEach(b=>b.onclick=async()=>{const o=await api('/api/contribution/'+encodeURIComponent(b.dataset.id));alert(JSON.stringify(o,null,2).slice(0,12000))});$('pendingList').querySelectorAll('.applyContrib').forEach(b=>b.onclick=async()=>{if(!confirm('Apply this contribution to the private timing data? Backups will be made first.'))return;try{await api('/api/apply-contribution',{method:'POST',body:JSON.stringify({contribution_id:b.dataset.id})});alert('Contribution applied.');await loadPending();await runSearch()}catch(e){alert(e.message)}})}
async function nextFlagged(){const els=[...document.querySelectorAll('.result')];if(!els.length)return;let idx=els.findIndex(x=>current&&x.dataset.id===current.level_id);let next=els[(idx+1)%els.length];if(next)await openLevel(next.dataset.id)}
let timer;['search','difficulty','flagged','sort'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',()=>{clearTimeout(timer);timer=setTimeout(runSearch,120)}));$('refreshSearch').onclick=runSearch;$('saveContribution').onclick=saveContribution;$('applyDirect').onclick=applyDirect;$('refreshDataBtn').onclick=async()=>{if(!confirm('Regenerate the anonymized review dataset from your private Moongrinding V2 data? Accepted public corrections are preserved.'))return;try{const o=await api('/api/refresh-data',{method:'POST',body:'{}'});alert(`Refreshed ${o.levels} levels.`);await runSearch()}catch(e){alert(e.message)}};document.querySelectorAll('.tabbar button[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tabbar button[data-tab]').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('reviewTab').classList.toggle('hidden',b.dataset.tab!=='review');$('pendingTab').classList.toggle('hidden',b.dataset.tab!=='pending');if(b.dataset.tab==='pending')loadPending()});loadMeta().catch(e=>document.body.innerHTML=`<pre style="padding:30px;color:#ffb3b3">${esc(e.message)}</pre>`)
</script>
</body>
</html>'''


class Handler(BaseHTTPRequestHandler):
    store: ReviewerStore

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def send_json(self, obj: Any, status: int = 200) -> None:
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def read_json(self) -> dict[str, Any]:
        n = int(self.headers.get("Content-Length") or 0)
        if n > 5_000_000:
            raise ValueError("Request too large")
        raw = self.rfile.read(n) if n else b"{}"
        obj = json.loads(raw.decode("utf-8"))
        if not isinstance(obj, dict):
            raise ValueError("Expected a JSON object")
        return obj

    def do_GET(self) -> None:
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            q = urllib.parse.parse_qs(parsed.query)
            if path == "/":
                data = HTML.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)
                return
            if path == "/api/meta":
                diffs = sorted({str(x.get("difficulty") or "N/A") for x in self.store.levels.values()})
                return self.send_json({
                    "tool_version": TOOL_VERSION,
                    "maintainer_mode": bool(self.store.private_data),
                    "private_data": str(self.store.private_data) if self.store.private_data else None,
                    "review_path": str(self.store.review_path),
                    "difficulties": diffs,
                })
            if path == "/api/search":
                return self.send_json(self.store.search(
                    query=(q.get("q") or [""])[0],
                    difficulty=(q.get("difficulty") or ["All"])[0],
                    flagged=(q.get("flagged") or ["all"])[0],
                    sort=(q.get("sort") or ["severity"])[0],
                ))
            if path.startswith("/api/level/"):
                lid = urllib.parse.unquote(path.split("/api/level/", 1)[1])
                return self.send_json(self.store.detail(lid))
            if path == "/api/contributions":
                return self.send_json(self.store.list_contributions())
            if path.startswith("/api/contribution/"):
                cid = urllib.parse.unquote(path.split("/api/contribution/", 1)[1])
                return self.send_json(self.store.contribution_detail(cid))
            return self.send_json({"error": "Not found"}, 404)
        except KeyError as e:
            return self.send_json({"error": str(e)}, 404)
        except Exception as e:
            return self.send_json({"error": str(e)}, 500)

    def do_POST(self) -> None:
        try:
            path = urllib.parse.urlparse(self.path).path
            body = self.read_json()
            if path == "/api/contribute":
                return self.send_json(self.store.create_contribution(body))
            if path == "/api/refresh-data":
                return self.send_json(self.store.refresh_public_review_data())
            if path == "/api/apply-contribution":
                cid = str(body.get("contribution_id") or "")
                return self.send_json(self.store.apply_contribution(cid))
            if path == "/api/apply-direct":
                cid = str(body.get("contribution_id") or ("local-" + uuid.uuid4().hex[:10]))
                levels = body.get("levels")
                if not isinstance(levels, list):
                    raise ValueError("levels must be a list")
                notes = {str(x.get("level_id")): str(x.get("note") or "") for x in levels if isinstance(x, dict)}
                return self.send_json(self.store.apply_levels(levels, cid, notes))
            return self.send_json({"error": "Not found"}, 404)
        except Exception as e:
            return self.send_json({"error": str(e)}, 400)


def main() -> int:
    script = Path(__file__).resolve()
    repo_root = script.parents[1]
    parser = argparse.ArgumentParser(description="MoonGrinder community time reviewer")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--private-data", help="Optional path to private Moongrinding V2 data folder")
    parser.add_argument("--refresh-data", action="store_true", help="Regenerate anonymized review data from private data before starting")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    private = Path(args.private_data).expanduser().resolve() if args.private_data else None
    store = ReviewerStore(repo_root, private)
    if args.refresh_data:
        store.refresh_public_review_data()
    if not store.review_path.exists():
        print("Missing data/time_review.json.")
        print("The repository owner should run this tool once from a checkout next to Moongrinding V2 so it can publish anonymized review data.")
        return 2

    Handler.store = store
    server = ThreadingHTTPServer((HOST, args.port), Handler)
    url = f"http://{HOST}:{args.port}/"
    print(f"MoonGrinder Time Reviewer: {url}")
    print(f"Review data: {store.review_path}")
    if store.private_data:
        print(f"Maintainer mode: ON ({store.private_data})")
    else:
        print("Maintainer mode: OFF (contribution mode)")
    print("Press Ctrl+C to stop.")
    if not args.no_browser:
        threading.Timer(0.45, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
