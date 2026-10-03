"""Traffic observations must count provider work once and preserve unknown outcomes."""
from datetime import timedelta

import pytest
from sqlmodel import select

from treg.application import web_arena_calls, web_arena_publications
from treg.infra.db import session_maker
from treg.models import CallRecord, WebArenaCallCursor, WebArenaCallDayStat, WebArenaPublication
from treg.timeutil import utcnow_naive


async def _call(*, org=1, hit=None, status=200, cached=False, refused_by=None, ms=120,
                endpoint="exa.web.search", age=timedelta(minutes=5)):
    async with session_maker() as db:
        db.add(CallRecord(org_id=org, user_email="web@example.com", tool_name="web search",
                          method="POST", path="/search", status_code=status,
                          endpoint_id=endpoint, provider="exa", kind="call",
                          hit=hit, cached=cached, refused_by=refused_by,
                          duration_ms=ms, created_at=utcnow_naive() - age))
        await db.commit()


async def test_direct_call_buckets_exclude_cache_refusals_and_unknowns(clients):
    for _ in range(18):
        await _call(hit=True)
    for _ in range(2):
        await _call(hit=False)
    await _call(hit=True, cached=True, ms=1)
    await _call(hit=True, refused_by="balance", ms=1)
    await _call(status=422, ms=1)
    await _call(status=500, ms=900)
    result = await web_arena_calls.collect()
    assert result["caught_up"]
    row = (await web_arena_calls.snapshot())["search"]["exa"]
    assert row["runs"] == 22
    assert row["hit_samples"] == 21
    assert row["success_rate"] == 85.7
    assert row["time_samples"] == 20
    assert row["median_provider_ms"] == 120
    assert (await web_arena_calls.collect())["rows"] == 0


async def test_thin_direct_call_rate_is_unknown_not_zero(clients):
    for _ in range(4):
        await _call(hit=False)
    await web_arena_calls.collect()
    row = (await web_arena_calls.snapshot())["search"]["exa"]
    assert row["hit_samples"] == 4
    assert row["success_rate"] is None


async def test_traffic_rollup_includes_calls_from_multiple_teams(clients):
    for _ in range(10):
        await _call(org=1, hit=True)
        await _call(org=2, hit=False)
    await web_arena_calls.collect()
    row = (await web_arena_calls.snapshot())["search"]["exa"]
    assert row["runs"] == 20
    assert row["hit_samples"] == 20
    assert row["success_rate"] == 50


async def test_recent_seed_replaces_partial_totals_and_continues_once(clients):
    await _call(hit=True, age=timedelta(days=20))
    await web_arena_calls.collect()
    await _call(hit=True, age=timedelta(days=9))
    await _call(hit=False, age=timedelta(days=2))
    await _call(hit=True, cached=True)
    await _call(hit=True, refused_by="balance")
    await _call(hit=True, endpoint="other.search")

    result = await web_arena_publications.seed_recent()
    assert result["eligible_calls"] == 2
    assert result["publication"]["caught_up"]
    async with session_maker() as db:
        cursor = await db.get(WebArenaCallCursor, web_arena_calls.CURSOR_ID)
        rows = (await db.execute(select(WebArenaCallDayStat))).scalars().all()
        publication = await db.get(WebArenaPublication, "live:current")
    assert cursor.observed_since is not None
    assert sum(row.calls for row in rows) == 2
    assert publication.payload["window_days"] == 30
    assert publication.payload["observed_since"] is not None
    assert (await web_arena_calls.snapshot())["search"]["exa"]["runs"] == 2

    await _call(hit=True)
    await web_arena_calls.collect()
    assert (await web_arena_calls.snapshot())["search"]["exa"]["runs"] == 3
    with pytest.raises(ValueError, match="already been seeded"):
        await web_arena_publications.seed_recent()
    assert (await web_arena_calls.snapshot())["search"]["exa"]["runs"] == 3


async def test_recent_seed_pages_listed_endpoints_only(clients):
    for _ in range(5):
        await _call(hit=True)
    await _call(hit=True, endpoint="other.search")
    await _call(hit=True, age=timedelta(seconds=10))
    seed = await web_arena_calls.build_recent_seed(page_rows=2)
    assert seed["scanned"] == 5
    assert seed["eligible_calls"] == 5


async def test_seed_limit_leaves_existing_totals_untouched(clients, monkeypatch):
    await _call(hit=True)
    await _call(hit=True)
    await web_arena_calls.collect()
    before = (await web_arena_calls.snapshot())["search"]["exa"]["runs"]
    monkeypatch.setattr(web_arena_calls, "SEED_MAX_ROWS", 1)
    with pytest.raises(ValueError, match="row limit"):
        await web_arena_publications.seed_recent()
    assert (await web_arena_calls.snapshot())["search"]["exa"]["runs"] == before
    assert await web_arena_calls.coverage_start() is None
