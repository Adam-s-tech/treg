"""Traffic observations must count provider work once and preserve unknown outcomes."""
from datetime import timedelta

from treg.application import web_arena_calls
from treg.infra.db import session_maker
from treg.models import CallRecord
from treg.timeutil import utcnow_naive


async def _call(*, org=1, hit=None, status=200, cached=False, refused_by=None, ms=120):
    async with session_maker() as db:
        db.add(CallRecord(org_id=org, user_email="web@example.com", tool_name="web search",
                          method="POST", path="/search", status_code=status,
                          endpoint_id="exa.web.search", provider="exa", kind="call",
                          hit=hit, cached=cached, refused_by=refused_by,
                          duration_ms=ms, created_at=utcnow_naive() - timedelta(minutes=5)))
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
