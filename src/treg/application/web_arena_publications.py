"""Versioned benchmark publication and content-free live leaderboard totals."""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import timedelta
from pathlib import Path
from statistics import mean, median

from sqlmodel import select

from ..domain import web_arena_scores as scores
from ..domain.catalog import store as catalog_store
from ..infra.db import session_maker
from ..models import WebArenaPublication, WebArenaRun
from ..timeutil import utcnow_naive as now
from . import arena

EXPECTED_CASES = {"search": 30, "fetch": 20, "sitemap": 10}
FORMULA = {"quality": 0.60, "success": 0.20, "speed": 0.10, "price": 0.10}
CASES_FILE = Path(__file__).parent.parent / "web_arena_cases.json"


async def published(kind: str) -> dict:
    async with session_maker() as db:
        row = (await db.execute(select(WebArenaPublication).where(WebArenaPublication.kind == kind)
             .order_by(WebArenaPublication.created_at.desc()).limit(1))).scalar_one_or_none()
    return row.payload if row else {"status": "warming", "task_results": {}, "formula": FORMULA}


async def ready() -> bool:
    doc = await published("benchmark")
    return doc.get("status") == "published" and all(
        doc.get("task_results", {}).get(task, {}).get("sample_count") == count
        for task, count in EXPECTED_CASES.items())


def _validate_publication(doc: dict) -> dict:
    if not isinstance(doc, dict) or not doc.get("human_reviewed") or not doc.get("version") or not doc.get("test_date"):
        raise ValueError("A version, test date, and completed human review are required.")
    if doc.get("formula") != FORMULA:
        raise ValueError("Use the published 60/20/10/10 formula.")
    results = doc.get("task_results") or {}
    fixed = json.loads(CASES_FILE.read_text())["tasks"]
    if set(results) != set(EXPECTED_CASES):
        raise ValueError("All three task results are required.")
    for task, count in EXPECTED_CASES.items():
        group = results[task]
        if set(group) - {"cases", "sample_count", "rules", "limits", "providers"}:
            raise ValueError("A task result contains unapproved fields.")
        cases = group.get("cases") or []
        if len(cases) != count or len({case.get("id") for case in cases}) != count:
            raise ValueError(f"{task} needs {count} unique public cases.")
        known = {case["id"]: case["input"] for case in fixed[task]}
        for case in cases:
            if set(case) - {"id", "input", "label", "reviewed", "checked_facts", "known_urls"}:
                raise ValueError("A case contains unapproved fields.")
            if case.get("input") != known.get(case.get("id")) or case.get("reviewed") is not True:
                raise ValueError(f"{task} case input or review is incomplete.")
            if task == "fetch" and not case.get("checked_facts"):
                raise ValueError("Fetch cases need checked key facts.")
            if task == "sitemap" and not case.get("known_urls"):
                raise ValueError("Sitemap cases need checked URL lists.")
            for item in case.get("checked_facts", []) + case.get("known_urls", []):
                if not isinstance(item, str) or len(item) > 500:
                    raise ValueError("References must be short public strings.")
        if group.get("sample_count") != count or not group.get("rules") or not group.get("limits"):
            raise ValueError(f"{task} needs rules, limits, and the sample count.")
        if len(group.get("providers") or []) < 2:
            raise ValueError(f"{task} needs measured results from at least two providers.")
        for row in group.get("providers") or []:
            if set(row) - {"provider", "parts", "overall", "rank", "sample_count"}:
                raise ValueError("A provider score contains unapproved fields.")
            parts = row.get("parts") or {}
            if set(parts) - {"relevance", "freshness", "fact_coverage", "token_efficiency",
                             "known_url_coverage", "valid_url_rate", "success", "speed", "price"}:
                raise ValueError("A score has an unknown metric.")
            if any(value is not None and (not isinstance(value, (int, float)) or isinstance(value, bool)
                                          or not 0 <= value <= 100) for value in parts.values()):
                raise ValueError("Each known score must be between 0 and 100.")
            q = scores.quality(task, parts)
            expected = scores.overall(quality_score=q, success=parts.get("success"),
                speed=parts.get("speed"), price=parts.get("price"))
            if row.get("overall") != expected:
                raise ValueError(f"Score does not match the formula for {task}/{row.get('provider')}.")
            if parts.get("price") is None and row.get("rank") is not None:
                raise ValueError("A provider with no known price cannot have an overall rank.")
            if row.get("sample_count") != count:
                raise ValueError("Every ranked provider needs the full fixed case set.")
    # The published object is allowlisted. Raw answers and private queries are not accepted.
    if set(doc) - {"version", "test_date", "human_reviewed", "formula", "task_results", "methodology"}:
        raise ValueError("Unexpected publication fields.")
    return {**doc, "status": "published"}


async def publish_file(path: str):
    doc = _validate_publication(json.loads(Path(path).read_text()))
    async with session_maker() as db:
        row = WebArenaPublication(id="benchmark:" + doc["version"], kind="benchmark",
                                  version=doc["version"], payload=doc)
        db.add(row)
        await db.commit()
    return {"version": doc["version"], "status": "published"}


async def _live_rows():
    cutoff = now() - timedelta(days=30)
    async with session_maker() as db:
        rows = (await db.execute(select(WebArenaRun).where(WebArenaRun.mode == "battle",
            WebArenaRun.state == "completed", WebArenaRun.created_at >= cutoff,
            WebArenaRun.expires_at > now()).order_by(WebArenaRun.created_at.desc()).limit(10_000))).scalars().all()
    return rows


async def live_now() -> dict:
    """Compute content-free totals directly for local development."""
    return summarize_live(await _live_rows(), catalog_store.load())


async def refresh_live():
    """Worker saves content-free totals for the hosted page to read as one small row."""
    rows = await _live_rows()
    doc = summarize_live(rows, catalog_store.load())
    async with session_maker() as db:
        row = await db.get(WebArenaPublication, "live:current")
        if row:
            row.payload = doc
            row.created_at = now()
        else:
            row = WebArenaPublication(id="live:current", kind="live", version="v1", payload=doc)
        db.add(row)
        await db.commit()
    return {"tasks": list(doc["task_results"]), "battle_runs": len(rows)}


def summarize_live(rows, catalog):
    """Aggregate the latest completed Battle per provider and distinct input."""
    by_task: dict[str, dict[str, dict]] = defaultdict(lambda: defaultdict(lambda: {
        "runs": 0, "success": 0, "times": [], "metric_values": [], "comparable": 0, "wins": 0}))
    seen_inputs = set()
    for row in rows:
        payload = arena._unpack(row.payload)
        attempts = payload.get("attempts") or []
        values = scores.winner_values(row.task, attempts)
        best = max(values.values()) if values else None
        for a in attempts:
            if a.get("state") not in {"hit", "miss", "error", "timeout"}:
                continue
            key = (row.task, a["provider"], payload.get("input"),
                   payload.get("query", "") if row.task == "sitemap" else "")
            if key in seen_inputs:
                continue
            seen_inputs.add(key)
            slot = by_task[row.task][a["provider"]]
            slot["runs"] += 1
            slot["success"] += a["state"] == "hit"
            if isinstance(a.get("duration_ms"), int):
                slot["times"].append(a["duration_ms"])
            quality = a.get("quality") or {}
            metric = (quality.get("estimated_match") if row.task == "search" and quality.get("state") == "checked"
                      else quality.get("relative_coverage") if row.task == "fetch" and quality.get("state") == "checked"
                      else quality.get("coverage_percent") if row.task == "sitemap" else None)
            if isinstance(metric, (int, float)) and not isinstance(metric, bool) and 0 <= metric <= 100:
                slot["metric_values"].append(metric)
            if a["provider"] in values:
                slot["comparable"] += 1
                slot["wins"] += values[a["provider"]] == best
    result = {}
    for task, providers in by_task.items():
        output = []
        for provider, stats in providers.items():
            current = next((ep for ep in catalog.for_capability({"search":"web.search", "fetch":"web.extract", "sitemap":"web.map"}[task])
                            if ep["provider"] == provider and ep["id"] in catalog.adapters), None)
            cv = catalog.cost_view(current.get("cost"), provider) if current else None
            n = stats["runs"]
            comparable = stats["comparable"]
            metric_values = stats["metric_values"]
            output.append({"provider": provider, "runs": n,
                "success_rate": round(100 * stats["success"] / n, 1),
                "average_provider_ms": round(mean(stats["times"])) if stats["times"] else None,
                "median_provider_ms": round(median(stats["times"])) if stats["times"] else None,
                "metric_sample_count": len(metric_values),
                "metric_percent": round(mean(metric_values), 1) if len(metric_values) >= 20 else None,
                "quality_sample_count": comparable,
                "quality_win_rate": round(100 * stats["wins"] / comparable, 1) if comparable >= 20 else None,
                "current_catalog_price_usd": cv.get("usd") if cv else None,
                "price_unit": (current.get("cost") or {}).get("unit") if current else None})
        result[task] = sorted(output, key=lambda x: (-x["runs"], x["provider"]))
    doc = {"status": "live", "source": "Complete Web Arena Battle runs only", "window_days": 30,
           "updated_at": now().isoformat() + "Z", "task_results": result, "minimum_comparable_runs": 20}
    return doc
