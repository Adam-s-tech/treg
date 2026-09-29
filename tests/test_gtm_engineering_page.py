"""The GTM-engineering hub: a hand-written page that links the seven job pages, the workflows and
the public skills. It is only useful if every link on it resolves, it can be measured, and it
describes treg.to only where treg.to serves it."""

from __future__ import annotations

import json
import re

from httpx import ASGITransport, AsyncClient

from treg.api import app
from treg.config import get_settings

PATH = "/gtm-engineering"


async def test_hub_is_served_canonical_and_measurable(clients: AsyncClient):
    r = await clients.get(PATH)
    assert r.status_code == 200
    html = r.text
    assert '<link rel="canonical" href="' in html and f'{PATH}"/>' in html
    assert "{BASE}" not in html and "{ENDPOINTS}" not in html and "{PROVIDERS}" not in html
    # Hand-written pages are the ones PostHog sees; the hub exists partly to be measured.
    assert '<script src="/sitetrack.js"></script>' in html
    assert '<script src="/adtrack.js"></script>' in html
    kinds = []
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        kinds.append(json.loads(block)["@type"])
    assert kinds == ["BreadcrumbList", "Article", "FAQPage"]


async def test_every_internal_link_on_the_hub_resolves(clients: AsyncClient):
    """The hub is a page of links; a dead one is the failure nobody notices."""
    html = (await clients.get(PATH)).text
    # /app is the signed-in dashboard every Start button points at, not a page of this site.
    links = sorted({h for h in re.findall(r'href="(/[^"#?]*)', html)
                    if not h.startswith("//") and h != "/app"})
    assert "/workflows/find-and-verify-a-lead-list" in links and "/people-search" in links
    for href in links:
        r = await clients.get(href)
        assert r.status_code == 200, href


async def test_hub_is_linked_from_its_pillars_and_listed(clients: AsyncClient):
    for page in ("/resources", "/people-search", "/leads-signals",
                 "/use-cases/lead-enrichment-for-ai-agents", "/workflows"):
        assert f'href="{PATH}"' in (await clients.get(page)).text, page
    assert f"{PATH}<" in (await clients.get("/sitemap.xml")).text


async def test_hub_404s_on_a_self_hosted_registry(monkeypatch):
    monkeypatch.setenv("TREG_PUBLIC_URL", "https://registry.example.internal")
    get_settings.cache_clear()
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://registry") as c:
            assert (await c.get(PATH)).status_code == 404
            assert f"{PATH}<" not in (await c.get("/sitemap.xml")).text
    finally:
        get_settings.cache_clear()
