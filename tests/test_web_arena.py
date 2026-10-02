"""Web Arena safety and score rules that do not need paid provider calls."""
import asyncio
from types import SimpleNamespace
import pytest
from cryptography.fernet import InvalidToken

from treg.domain import web_arena, web_arena_scores
from treg.application import web_arena as app, web_arena_quality, web_arena_publications
from treg.application.call import service
from treg.config import get_settings
from treg.domain.catalog import store as catalog_store
from test_routing import _relay_by_provider


def test_web_input_enforces_task_limits_and_public_urls():
    assert web_arena.input_for("search", "open data") == {"q": "open data", "limit": 10}
    assert web_arena.input_for("sitemap", "https://example.com") == {"url": "https://example.com", "limit": 10}
    assert web_arena.input_for("sitemap", "https://example.com", "  pricing  ") == {
        "url": "https://example.com", "limit": 10, "q": "pricing"}
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


def test_diffbot_page_url_is_available_to_search_quality_check():
    output = {"results": [{"pageUrl": "https://example.com/article", "title": "An article",
                           "content": "Article summary"}]}
    assert web_arena_quality._search_links(output) == [{
        "url": "https://example.com/article", "title": "An article",
        "snippet": "Article summary", "source_date": None}]


def test_fetch_reads_nested_markdown_and_markdown_content_from_catalog_adapters():
    adapters = catalog_store.load().adapters
    examples = (
        ("branddev.web.scrape", {"url": "https://example.com", "markdown": {
            "requested": True, "success": True, "data": "# Example Domain"}}),
        ("olostep.web.scrape", {"result": {"markdown_content": "# Example Domain"}}),
    )
    for endpoint, response in examples:
        output = adapters[endpoint].from_upstream(response)
        assert web_arena.fetch_text(output) == "# Example Domain"
        assert web_arena.valid_result("fetch", output, "https://example.com")


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


def test_live_provider_stats_need_distinct_checked_inputs(monkeypatch):
    monkeypatch.setattr(web_arena_publications.arena, "_unpack", lambda payload: payload)
    rows = [SimpleNamespace(task="search", payload={"input": f"query {i}", "attempts": [{
        "provider": "exa", "state": "miss" if i == 0 else "hit", "duration_ms": 100 + i,
        "quality": {} if i == 0 else {"state": "checked", "estimated_match": 80},
    }]}) for i in range(21)]
    rows.append(SimpleNamespace(task="search", payload={"input": "query 1", "attempts": [{
        "provider": "exa", "state": "miss", "duration_ms": 900, "quality": {},
    }]}))  # An older repeat must not outweigh the latest result.
    doc = web_arena_publications.summarize_live(rows, catalog_store.load())
    row = doc["task_results"]["search"][0]
    assert row["runs"] == 21
    assert row["success_rate"] == 95.2
    assert row["median_provider_ms"] == 110
    assert row["metric_sample_count"] == 20
    assert row["metric_percent"] == 80
    assert "query 1" not in str(doc)


def test_fetch_live_totals_keep_fact_coverage_and_token_efficiency_separate(monkeypatch):
    monkeypatch.setattr(web_arena_publications.arena, "_unpack", lambda payload: payload)
    rows = [SimpleNamespace(task="fetch", payload={"input": f"https://example.com/{i}", "attempts": [{
        "provider": "exa", "state": "hit", "duration_ms": 100,
        "quality": {"state": "checked", "relative_coverage": 60, "token_efficiency": 80},
    }]}) for i in range(20)]
    row = web_arena_publications.summarize_live(rows, catalog_store.load())["task_results"]["fetch"][0]
    assert row["metric_percent"] == 60
    assert row["token_efficiency_percent"] == 80
    assert row["token_efficiency_sample_count"] == 20


async def test_local_leaderboard_uses_saved_totals_if_old_runs_cannot_decrypt(monkeypatch):
    async def rows():
        return [SimpleNamespace(payload="old ciphertext")]

    async def saved(kind):
        assert kind == "live"
        return {"status": "live", "task_results": {"search": [{"provider": "exa", "runs": 3}]}}

    def cannot_decrypt(rows, catalog):
        raise InvalidToken

    monkeypatch.setattr(web_arena_publications, "_live_rows", rows)
    monkeypatch.setattr(web_arena_publications, "published", saved)
    monkeypatch.setattr(web_arena_publications, "summarize_live", cannot_decrypt)
    result = await web_arena_publications.live_now()
    assert result["task_results"]["search"][0]["runs"] == 3
    assert result["stale"] is True
    assert "Last saved" in result["source"]


def test_public_task_previews_show_verified_search_providers(monkeypatch):
    monkeypatch.setenv("TREG_WEB_ARENA_ENABLED", "true")
    get_settings.cache_clear()
    try:
        tasks = {row["id"]: row for row in app.tasks()}
        search = {row["provider"] for row in tasks["search"]["provider_previews"]}
        assert {"exa", "firecrawl", "tavily", "tinyfish", "serper", "spidercloud", "octen"} <= search
        assert "valyu" not in search
        assert not tasks["brand"]["enabled"]
        assert tasks["brand"]["provider_previews"] == []
    finally:
        get_settings.cache_clear()


async def test_sitemap_quotes_use_optional_query_and_first_ten_urls(clients, monkeypatch):
    providers = ("anyapi", "branddev", "firecrawl", "olostep", "search1api", "tavily")
    monkeypatch.setenv("TREG_WEB_ARENA_ENABLED", "true")
    monkeypatch.setenv("TREG_PLATFORM_PROVIDERS", ",".join(providers))
    for provider in providers:
        monkeypatch.setenv("TREG_PLATFORM_KEY_" + provider.upper(), "TEST-" + provider)
    get_settings.cache_clear()
    async def reviewed():
        return True
    monkeypatch.setattr(web_arena_publications, "ready", reviewed)
    try:
        without = await clients.post("/web-arena/api/quotes", json={
            "task": "sitemap", "value": "https://example.com", "jev": True})
        assert without.status_code == 200, without.text
        assert without.json()["jev"] is False
        plain = {p["provider"] for p in without.json()["providers"]}
        assert plain == set(providers) - {"olostep"}

        with_query = await clients.post("/web-arena/api/quotes", json={
            "task": "sitemap", "value": "https://example.com", "query": "pricing", "jev": False})
        assert with_query.status_code == 200, with_query.text
        assert {p["provider"] for p in with_query.json()["providers"]} == set(providers)
        from treg.application import arena
        from treg.infra.db import session_maker
        from treg.models import WebArenaRun
        async with session_maker() as db:
            row = await db.get(WebArenaRun, with_query.json()["id"])
            attempts = {a["provider"]: a for a in arena._unpack(row.payload)["attempts"]}
        assert attempts["olostep"]["body"]["search_query"] == "pricing"
        assert attempts["tavily"]["body"]["limit"] == 10
        assert attempts["branddev"]["query"]["maxLinks"] == "10"
        assert "pricing" not in str(attempts["branddev"]["query"])
        assert "pricing" not in str(attempts["search1api"]["body"])
    finally:
        get_settings.cache_clear()


async def test_search1api_sitemap_compares_only_first_ten_urls(clients, monkeypatch):
    monkeypatch.setenv("TREG_WEB_ARENA_ENABLED", "true")
    monkeypatch.setenv("TREG_PLATFORM_PROVIDERS", "search1api")
    monkeypatch.setenv("TREG_PLATFORM_KEY_SEARCH1API", "TEST-SEARCH1API")
    get_settings.cache_clear()
    async def reviewed():
        return True
    monkeypatch.setattr(web_arena_publications, "ready", reviewed)
    seen = []
    links = [f"https://example.com/{index}" for index in range(12)]
    monkeypatch.setattr(service, "relay", _relay_by_provider({"search1api": [(200, {"links": links})]}, seen))
    try:
        response = await clients.post("/web-arena/api/quotes", json={
            "task": "sitemap", "value": "https://example.com", "query": "pricing",
            "providers": ["search1api"], "jev": False})
        assert response.status_code == 200, response.text
        run_id = response.json()["id"]
        started = await clients.post(f"/web-arena/api/runs/{run_id}/start")
        assert started.status_code == 200, started.text
        worker = app._owners.get(run_id)
        if worker:
            await asyncio.wait_for(asyncio.shield(worker), 15)
        finished = await clients.get(f"/web-arena/api/runs/{run_id}")
        assert finished.status_code == 200, finished.text
        result = finished.json()["attempts"][0]
        assert result["state"] == "hit"
        assert result["output"]["results"] == links[:10]
        assert result["output"]["count"] == 10
        assert len(seen) == 1 and "limit" not in seen[0][3]
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


async def test_tinyfish_first_page_is_capped_for_comparison(clients, monkeypatch):
    monkeypatch.setenv("TREG_WEB_ARENA_ENABLED", "true")
    monkeypatch.setenv("TREG_PLATFORM_KEY_TINYFISH", "TEST-TINYFISH")
    monkeypatch.setenv("TREG_PLATFORM_PROVIDERS", "tinyfish")
    get_settings.cache_clear()
    async def reviewed():
        return True
    monkeypatch.setattr(web_arena_publications, "ready", reviewed)
    seen = []
    rows = [{"url": f"https://example.com/{index}", "title": str(index)} for index in range(11)]
    monkeypatch.setattr(service, "relay", _relay_by_provider({"tinyfish": [(200, {
        "results": rows, "total_results": 11, "page": 0})]}, seen))
    try:
        response = await clients.post("/web-arena/api/quotes", json={
            "task": "search", "value": "example query", "mode": "battle",
            "providers": ["tinyfish"], "jev": False})
        assert response.status_code == 200, response.text
        quote = response.json()
        assert quote["providers"][0]["estimate_micro"] == 0
        started = await clients.post(f"/web-arena/api/runs/{quote['id']}/start")
        assert started.status_code == 200, started.text
        worker = app._owners.get(quote["id"])
        if worker:
            await asyncio.wait_for(asyncio.shield(worker), 15)
        finished = await clients.get(f"/web-arena/api/runs/{quote['id']}")
        assert finished.status_code == 200, finished.text
        output = finished.json()["attempts"][0]["output"]
        assert len(output["results"]) == output["count"] == 10
        assert len(seen) == 1
        assert "limit" not in seen[0][2]
    finally:
        get_settings.cache_clear()


async def test_new_search_providers_join_one_ten_link_quote(clients, monkeypatch):
    monkeypatch.setenv("TREG_WEB_ARENA_ENABLED", "true")
    monkeypatch.setenv("TREG_PLATFORM_PROVIDERS", "tinyfish,serper,spidercloud,octen")
    for provider in ("TINYFISH", "SERPER", "SPIDERCLOUD", "OCTEN"):
        monkeypatch.setenv("TREG_PLATFORM_KEY_" + provider, "TEST-" + provider)
    get_settings.cache_clear()
    async def reviewed():
        return True
    monkeypatch.setattr(web_arena_publications, "ready", reviewed)
    try:
        response = await clients.post("/web-arena/api/quotes", json={
            "task": "search", "value": "IANA example domains", "mode": "battle",
            "providers": ["tinyfish", "serper", "spidercloud", "octen"], "jev": False})
        assert response.status_code == 200, response.text
        quote = response.json()
        assert {p["provider"] for p in quote["providers"]} == {
            "tinyfish", "serper", "spidercloud", "octen"}
        assert next(p for p in quote["providers"] if p["provider"] == "tinyfish")["estimate_micro"] == 0
        assert quote["required_micro"] == quote["estimate_micro"]
    finally:
        get_settings.cache_clear()
