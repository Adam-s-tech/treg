"""Web Arena safety and score rules that do not need paid provider calls."""
import asyncio
from types import SimpleNamespace
import pytest

from treg.domain import web_arena, web_arena_scores
from treg.application import web_arena as app, web_arena_quality, web_arena_publications
from treg.application.call import service
from treg.config import get_settings
from test_routing import _relay_by_provider


def test_web_input_enforces_task_limits_and_public_urls():
    assert web_arena.input_for("search", "open data") == {"q": "open data", "limit": 10}
    assert web_arena.input_for("sitemap", "https://example.com") == {"url": "https://example.com", "limit": 100}
    for value in ("file:///etc/passwd", "http://localhost", "http://127.0.0.1", "https://user:pass@example.com"):
        with pytest.raises(web_arena.WebArenaError):
            web_arena.input_for("fetch", value)
    with pytest.raises(web_arena.WebArenaError):
        web_arena.input_for("brand", "example.com")


def test_sitemap_counts_only_unique_same_host_urls_without_claiming_coverage():
    result = web_arena.url_rows(["https://example.com/a#one", "https://example.com/a#two",
        "https://other.com/a", "bad", {"url": "https://example.com/b"}], "https://example.com")
    assert result["unique_valid_urls"] == 2
    assert result["invalid_urls"] == 2
    assert result["coverage_percent"] is None


def test_search_dates_stay_unknown_when_sources_have_no_dates():
    assert web_arena_quality._recent_share([{"source_date": None}])["freshness_percent"] is None


async def test_local_web_arena_quality_skips_daily_caps(monkeypatch):
    monkeypatch.setattr(web_arena_quality, "get_settings", lambda: SimpleNamespace(
        ai_gateway_api_key="test", local_dev=True))
    assert await web_arena_quality._take_budget(user_id=1)


def test_scores_need_all_parts_and_known_price():
    assert web_arena_scores.overall(quality_score=80, success=90, speed=70, price=60) == 79.0
    assert web_arena_scores.overall(quality_score=80, success=90, speed=70, price=None) is None
    assert web_arena_scores.quality("sitemap", {"valid_url_rate": 100}) is None
    assert web_arena_scores.winner_values("sitemap", [{"provider": "a", "state": "hit",
        "quality": {"unique_valid_urls": 5}}, {"provider": "b", "state": "hit",
        "quality": {"unique_valid_urls": 6}}]) == {}


def test_publication_refuses_unreviewed_or_incomplete_tests():
    with pytest.raises(ValueError):
        web_arena_publications._validate_publication({"version": "v1", "human_reviewed": False})


def test_public_task_previews_show_verified_search_providers(monkeypatch):
    monkeypatch.setenv("TREG_WEB_ARENA_ENABLED", "true")
    get_settings.cache_clear()
    try:
        tasks = {row["id"]: row for row in app.tasks()}
        search = {row["provider"] for row in tasks["search"]["provider_previews"]}
        assert {"exa", "firecrawl", "tavily"} <= search
        assert "valyu" not in search
        assert not tasks["brand"]["enabled"]
        assert tasks["brand"]["provider_previews"] == []
    finally:
        get_settings.cache_clear()


async def test_battle_quotes_and_settles_direct_search_with_jev_off(clients, monkeypatch):
    monkeypatch.setenv("TREG_WEB_ARENA_ENABLED", "true")
    monkeypatch.setenv("TREG_PLATFORM_KEY_FIRECRAWL", "TEST-FIRECRAWL")
    monkeypatch.setenv("TREG_PLATFORM_PROVIDERS", "firecrawl")
    get_settings.cache_clear()
    async def reviewed():
        return True
    monkeypatch.setattr(web_arena_publications, "ready", reviewed)
    async def no_jev(*args, **kwargs):
        raise AssertionError("Jev must stay off")
    monkeypatch.setattr(web_arena_quality, "search", no_jev)
    seen = []
    monkeypatch.setattr(service, "relay", _relay_by_provider({"firecrawl": [(200, {
        "data": {"web": [{"url": "https://example.com/a", "title": "A"}]}, "creditsUsed": 1})]}, seen))
    try:
        response = await clients.post("/web-arena/api/quotes", json={
            "task": "search", "value": "example query", "mode": "battle", "providers": ["firecrawl"], "jev": False})
        assert response.status_code == 200, response.text
        quote = response.json()
        assert quote["providers"][0]["endpoint_id"] == "firecrawl.web.search"
        assert seen == []
        started = await clients.post(f"/web-arena/api/runs/{quote['id']}/start")
        assert started.status_code == 200, started.text
        worker = app._owners.get(quote["id"])
        if worker:
            await asyncio.wait_for(asyncio.shield(worker), 15)
        finished = await clients.get(f"/web-arena/api/runs/{quote['id']}")
        assert finished.status_code == 200, finished.text
        run = finished.json()
        assert run["state"] == "completed"
        assert run["attempts"][0]["state"] == "hit"
        assert run["attempts"][0]["charged_micro"] is not None
        assert len(seen) == 1 and seen[0][3]["limit"] == 10
    finally:
        get_settings.cache_clear()


async def test_fixed_ten_result_search_can_join_quote(clients, monkeypatch):
    monkeypatch.setenv("TREG_WEB_ARENA_ENABLED", "true")
    monkeypatch.setenv("TREG_PLATFORM_KEY_BRANDDEV", "TEST-BRANDDEV")
    monkeypatch.setenv("TREG_PLATFORM_PROVIDERS", "branddev")
    get_settings.cache_clear()
    async def reviewed():
        return True
    monkeypatch.setattr(web_arena_publications, "ready", reviewed)
    try:
        response = await clients.post("/web-arena/api/quotes", json={
            "task": "search", "value": "example query", "mode": "battle",
            "providers": ["branddev"], "jev": False})
        assert response.status_code == 200, response.text
        assert response.json()["providers"][0]["endpoint_id"] == "branddev.web.search"
    finally:
        get_settings.cache_clear()
