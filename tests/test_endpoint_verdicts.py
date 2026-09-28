"""Agent verdicts on catalog endpoints: one vote per team, a threshold, quotes in proportion."""
from datetime import datetime, timedelta

from treg.application import feedback
from treg.domain.feedback.verdicts import Review, quotable, summarize
from treg.infra.db import session_maker
from treg.models import CallReview

T0 = datetime(2026, 9, 1)
LONG = "Returned the requested records with the fields the task needed, nothing missing."


def review(org, usefulness="useful", reason=LONG, endpoint="a.b.c", day=0):
    return Review(endpoint, org, usefulness, reason, "codex", T0 + timedelta(days=day))


def test_endpoint_below_threshold_publishes_nothing():
    assert summarize([review(org) for org in range(4)]) == {}
    assert summarize([review(org) for org in range(5)])["a.b.c"]["teams"] == 5


def test_a_team_is_one_vote_however_many_times_its_agent_rated():
    flood = [review(1, "not_useful", day=d) for d in range(40)]
    out = summarize(flood + [review(org) for org in range(2, 6)])["a.b.c"]
    assert out["teams"] == 5
    assert out["share"] == {"useful": 0.8, "partly": 0.0, "not_useful": 0.2}
    # A team's mixed verdicts split its single vote.
    split = [review(1, "useful"), review(1, "not_useful")] + [review(org) for org in range(2, 6)]
    assert summarize(split)["a.b.c"]["share"] == {"useful": 0.9, "partly": 0.0, "not_useful": 0.1}


def test_quotes_follow_the_vote_and_skip_what_names_a_lookup():
    rows = ([review(org, "not_useful", day=org) for org in range(6)]
            + [review(org, "useful", day=org) for org in range(6, 9)]
            + [review(9, "useful", reason="Found jane@acme.io at the company, as asked for here.")]
            + [review(10, "useful", reason="Short.")])
    out = summarize(rows)["a.b.c"]
    kinds = [q["usefulness"] for q in out["samples"]]
    assert sorted(kinds) == ["not_useful", "not_useful", "useful"]
    assert [q["date"] for q in out["samples"]] == sorted((q["date"] for q in out["samples"]), reverse=True)
    assert all("@" not in q["reason"] for q in out["samples"])
    assert out["samples"][0] == {"usefulness": "useful", "reason": LONG, "client": "codex", "date": "2026-09-09"}


def test_one_quote_per_team_its_latest():
    rows = [review(1, day=d, reason=f"{LONG} Run {d}.") for d in range(5)] + [review(org, reason=None) for org in range(2, 6)]
    samples = summarize(rows)["a.b.c"]["samples"]
    assert [q["reason"] for q in samples] == [f"{LONG} Run 4."]


def test_quotable():
    assert quotable(LONG)
    assert not quotable("   too short   ")
    assert not quotable(None)
    assert not quotable(LONG + " See https://example.org/page")
    assert not quotable(LONG + " The site acme-widgets.com had it.")


async def test_platform_payload_carries_verdicts_past_the_threshold(clients):
    body = (await clients.get("/catalog/platforms/tiktok")).json()
    target, other = [e["id"] for cap in body["capabilities"] for e in cap["endpoints"]][:2]
    assert all("reviews" not in e for cap in body["capabilities"] for e in cap["endpoints"])

    orgs = [(await clients.post("/orgs", json={"name": f"Verdicts {i}"})).json()["org_id"] for i in range(5)]
    async with session_maker() as db:
        for i, org in enumerate(orgs):
            db.add(CallReview(org_id=org, user_email="agent@example.dev", call_id=f"v-{i}",
                              endpoint_id=target, client="claude-code",
                              usefulness="useful" if i else "not_useful", reason=LONG))
        for i, org in enumerate(orgs[:4]):
            db.add(CallReview(org_id=org, user_email="agent@example.dev", call_id=f"w-{i}",
                              endpoint_id=other, usefulness="useful", reason=LONG))
        db.add(CallReview(org_id=orgs[4], user_email="agent@example.dev", call_id="w-4",
                          endpoint_id=other, usefulness="not_sure", reason=LONG))
        await db.commit()
    feedback.forget_endpoint_verdicts()

    body = (await clients.get("/catalog/platforms/tiktok")).json()
    views = {e["id"]: e for cap in body["capabilities"] for e in cap["endpoints"]}
    assert views[target]["reviews"]["teams"] == 5
    assert views[target]["reviews"]["share"]["useful"] == 0.8
    assert {q["client"] for q in views[target]["reviews"]["samples"]} == {"claude-code"}
    assert "reviews" not in views[other]   # four verdicts and a `not_sure` are not five teams
    ledger = [e for d in body["domains"] for r in d["rows"] for e in r["endpoints"]]
    assert next(e for e in ledger if e["id"] == target)["reviews"]["teams"] == 5


async def test_a_failed_fold_never_takes_the_catalog_down(clients, monkeypatch):
    async def broken():
        raise RuntimeError("replica unavailable")
    monkeypatch.setattr(feedback, "endpoint_verdicts", broken)
    assert (await clients.get("/catalog/platforms/tiktok")).status_code == 200
