"""Published Web Arena score rules; all parts are on a 0 to 100 scale."""
from __future__ import annotations

from statistics import mean


def quality(task: str, metrics: dict) -> float | None:
    if task == "search":
        match = metrics.get("relevance")
        if match is None:
            return None
        fresh = metrics.get("freshness")
        return round(0.75 * match + 0.25 * fresh, 1) if fresh is not None else round(match, 1)
    if task == "fetch":
        cover, efficient = metrics.get("fact_coverage"), metrics.get("token_efficiency")
        return round((cover + efficient) / 2, 1) if cover is not None and efficient is not None else None
    if task == "sitemap":
        cover, valid = metrics.get("known_url_coverage"), metrics.get("valid_url_rate")
        return round((cover + valid) / 2, 1) if cover is not None and valid is not None else None
    return None


def overall(*, quality_score: float | None, success: float | None,
            speed: float | None, price: float | None) -> float | None:
    parts = (quality_score, success, speed, price)
    if any(v is None or not 0 <= v <= 100 for v in parts):
        return None
    return round(0.60 * quality_score + 0.20 * success + 0.10 * speed + 0.10 * price, 1)


def winner_values(task: str, attempts: list[dict]) -> dict[str, float]:
    values = {}
    for a in attempts:
        if a.get("state") != "hit":
            continue
        q = a.get("quality") or {}
        if task == "search" and q.get("state") == "checked" and q.get("estimated_match") is not None:
            if q.get("recent_data_needed"):
                if q.get("freshness_percent") is None:
                    continue
                values[a["provider"]] = 0.75 * q["estimated_match"] + 0.25 * q["freshness_percent"]
            else:
                values[a["provider"]] = q["estimated_match"]
        elif task == "fetch" and q.get("state") == "checked" and q.get("relative_coverage") is not None and q.get("token_efficiency") is not None:
            values[a["provider"]] = (q["relative_coverage"] + q["token_efficiency"]) / 2
        elif task == "sitemap" and q.get("coverage_percent") is not None:
            values[a["provider"]] = q["coverage_percent"]
    return values if len(values) >= 2 else {}
