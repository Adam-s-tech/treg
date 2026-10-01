"""Catalog search for agents - the use case behind MCP `catalog_search` on both surfaces.

The page is the shipped ranker: `store.rank_band` over a band wider than the page (so a routed group
can collapse without starving it), the evidence rerank, the listed hub tools merged by score with no
boost (docs/hub-listing-decisions.md), routed parents grouped with their children, cut to the
page. Then the discovery experiment (`search_experiment`) may judge a wider recall and decide what
this caller sees, and the search is recorded. Nothing here touches `store.search` or its scoring;
the MCP layer only shapes the rows this returns.

Session discipline: the hub read opens, uses and closes its own session before any judge request,
so no connection is held while the judge thinks.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from .. import audit
from ..config import get_settings
from ..domain.catalog import store as catalog_store
from ..infra.db import session_maker
from . import hub as hub_app
from . import search_experiment

Rows = list[tuple[dict, float]]
Observed = Callable[[list[str]], Awaitable[dict[str, dict]]]
# (caller key, team id, email) for the experiment's log - resolved only while the experiment is on
Identify = Callable[[], Awaitable[tuple[str | None, int | None, str | None]]]


@dataclass(frozen=True)
class Caller:
    """Who is searching, as far as the hub's lists need to know: the team slug and sign-in email
    that decide which listed hub tools this caller may see (None, None: an unknown reader, no hub)."""
    hub_slug: str | None = None
    hub_email: str | None = None


@dataclass
class Page:
    rows: Rows                                 # the page to serve, in order
    total: int                                 # matches before the page cut (hub rows included)
    tie_truncated: bool                        # the tie group outran what the evidence sort weighs
    stats: dict[str, dict]                     # observed stats for every row on the page
    hidden: dict[str, int]                     # routed parent id -> children the page cut
    steering: bool                             # routed discovery on: parents lead their groups
    lexical_empty: bool = False                # the shipped ranker admitted nothing (the miss log's signal)
    arm: str | None = None                     # the experiment's arm, when it ran
    caller_key: str | None = None              # the experiment's handle on the caller, when it ran
    log: dict = field(default_factory=dict)    # the experiment's SearchLog fields, when it ran


def steering() -> bool:
    return str(get_settings().routed_discovery).strip().lower() not in ("off", "0", "false", "no")


def _group(rows: Rows, limit: int) -> tuple[Rows, dict[str, int]]:
    """A capability with a ROUTED row shows the parent first and its children right under it, so
    an agent sees "let treg choose" before the specific providers; the parent counts the children
    the page did not show."""
    grouped = catalog_store.group_routed(
        [{"ep": ep, "score": score, "capability": ep.get("capability"), "kind": ep.get("kind")} for ep, score in rows],
        max_children=catalog_store.MAX_ROUTED_CHILDREN)
    hidden = {r["ep"]["id"]: r["children_hidden"] for r in grouped if r.get("children_hidden")}
    return [(r["ep"], r["score"]) for r in grouped][:limit], hidden


async def lexical(query: str, cat: catalog_store.Catalog, limit: int, *, observed: Observed,
                  caller: Caller) -> Page:
    """The shipped ranker's page. Score, then let the evidence break the ties: token scoring
    produces ties by the dozen, and with a page of 8 the rows an agent sees would otherwise be
    decided by file order. The band is widened only so routed groups can collapse without
    starving the page; with steering off there is no collapsing, so the page is the band."""
    steer = steering()
    ranked, total, tie_truncated = catalog_store.rank_band(query, cat, min(100, limit * 4) if steer else limit)
    stats = await observed([ep["id"] for ep, _ in ranked])
    ranked = catalog_store.rerank(ranked, stats, cat)
    async with session_maker() as db:
        hub_ranked, hub_stats = await hub_app.search_listed(db, query, cat, org_slug=caller.hub_slug,
                                                            email=caller.hub_email)
    if hub_ranked:
        stats = {**stats, **hub_stats}
        ranked = catalog_store.merge_by_score(ranked, hub_ranked)
        total += len(hub_ranked)
    rows, hidden = _group(ranked, limit)
    return Page(rows, total, tie_truncated, stats, hidden, steer)


async def search(query: str, limit: int, *, cat: catalog_store.Catalog, source: str, caller: Caller,
                 observed: Observed, identify: Identify) -> Page:
    """The page this caller sees, recorded. The lexical page first; while the experiment is on, the
    judge reads a wider recall and the arm decides what is shown - whatever it does, the result is
    a page. The miss log is judged by the LEXICAL page: it measures the shipped ranker's coverage,
    and a judged page that found something is the experiment's result, not a reason to stop
    recording the gap."""
    page = await lexical(query, cat, limit, observed=observed, caller=caller)
    page.lexical_empty = not page.rows and bool(query.strip())
    if query.strip() and search_experiment.mode() != "off":
        async def finish(rows: Rows) -> tuple[Rows, dict[str, dict]]:
            st = await observed([ep["id"] for ep, _ in rows])
            grouped, _ = _group(catalog_store.rerank(rows, st, cat), limit)
            return grouped, st
        key, org_id, email = await identify()
        exp = await search_experiment.run(query, cat, baseline=page.rows, baseline_total=page.total,
                                          limit=limit, caller=key, finish=finish)
        page.stats = {**exp.stats, **page.stats}
        page.rows, page.arm, page.log, page.caller_key = exp.shown, exp.arm, exp.log, key
        audit.record_search(query=query.strip(), source=source, org_id=org_id, user_email=email, **exp.log)
    if page.lexical_empty:
        audit.record_search_miss(query=query.strip(), source=source)
    return page
