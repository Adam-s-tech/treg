"""What agents said about a catalog endpoint after using its result: the aggregate the catalog shows.

One team is one vote per endpoint. A team's several reviews of one endpoint split its vote across
the verdicts it gave, so an agent that rates every call of a batch weighs as much as a team that
rated once; that is what lets volunteered reviews count alongside invited ones. `not_sure` is not
a verdict and is left out. An endpoint below `MIN_TEAMS` teams publishes nothing: a share of three
teams is an anecdote, and the row stays silent rather than saying so.

The score is only comparable between sibling endpoints of one capability (models lean toward
`useful`, and a harder job draws harsher verdicts), which is why it is shown per endpoint and
never rolled up per provider.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from ...models import CallReview

VERDICTS = ("useful", "partly", "not_useful")
WINDOW_DAYS = 90
MIN_TEAMS = 5
SAMPLES = 3
MIN_REASON_CHARS = 40

# A quoted reason must read as a verdict on the endpoint, not as the task it served. Anything that
# can name who or what another team was looking up keeps the reason out of the quotes: an address,
# a link or any domain, a handle, a phone-like run of digits, or two capitalised words in a row (a
# person's name, and a few product names along with them; losing those quotes is the cheap side).
_PRIVATE = tuple(re.compile(p) for p in (
    r"[\w.%+-]+@[\w-]+\.[\w.-]+",                              # email
    r"(?i)https?://|www\.",                                        # link
    r"(?i)\b[a-z0-9][\w-]*(?:\.[\w-]+)*\.[a-z]{2,24}\b",          # any domain, any TLD
    r"(?<![\w.])@\w{2,}",                                          # handle
    r"\+?\d[\d\s().-]{6,}\d",                                     # phone-like digits
    r"\b[A-Z][a-z]{2,}(?: [A-Z]\.)? [A-Z][a-z]{2,}\b",               # a name
))


@dataclass(frozen=True)
class Review:
    endpoint_id: str
    org_id: int
    usefulness: str
    reason: str | None
    client: str
    created_at: datetime


async def since(db: AsyncSession, start: datetime) -> list[Review]:
    rows = await db.execute(select(
        CallReview.endpoint_id, CallReview.org_id, CallReview.usefulness, CallReview.reason,
        CallReview.client, CallReview.created_at,
    ).where(CallReview.created_at >= start, CallReview.usefulness.in_(VERDICTS)))
    return [Review(*row) for row in rows]


def quotable(reason: str | None) -> bool:
    text = (reason or "").strip()
    return len(text) >= MIN_REASON_CHARS and not any(p.search(text) for p in _PRIVATE)


def _quotas(share: dict[str, float], slots: int) -> dict[str, int]:
    """Largest-remainder split of `slots` by verdict share, so the quotes shown are drawn in the
    proportions the teams voted rather than picked for tone."""
    exact = {v: share[v] * slots for v in VERDICTS}
    quota = {v: int(exact[v]) for v in VERDICTS}
    for v in sorted(VERDICTS, key=lambda v: exact[v] - quota[v], reverse=True)[:slots - sum(quota.values())]:
        quota[v] += 1
    return quota


def _samples(candidates: list[Review], share: dict[str, float], slots: int) -> list[Review]:
    slots = min(slots, len(candidates))
    newest = sorted(candidates, key=lambda r: r.created_at, reverse=True)
    picked: list[Review] = []
    for verdict, n in _quotas(share, slots).items():
        picked += [r for r in newest if r.usefulness == verdict][:n]
    # A verdict with too few quotable reasons leaves its slots to the newest of the rest.
    picked += [r for r in newest if r not in picked][:slots - len(picked)]
    return sorted(picked, key=lambda r: r.created_at, reverse=True)


def summarize(reviews: list[Review], *, min_teams: int = MIN_TEAMS, samples: int = SAMPLES) -> dict[str, dict]:
    """Per endpoint id with at least `min_teams` teams: `{teams, share, samples}`."""
    by_endpoint: dict[str, dict[int, list[Review]]] = {}
    for r in reviews:
        by_endpoint.setdefault(r.endpoint_id, {}).setdefault(r.org_id, []).append(r)
    out: dict[str, dict] = {}
    for endpoint_id, teams in by_endpoint.items():
        if len(teams) < min_teams:
            continue
        votes = dict.fromkeys(VERDICTS, 0.0)
        candidates: list[Review] = []
        for rows in teams.values():
            for r in rows:
                votes[r.usefulness] += 1 / len(rows)
            quoted = [r for r in rows if quotable(r.reason)]
            if quoted:  # one quote per team at most: its latest
                candidates.append(max(quoted, key=lambda r: r.created_at))
        share = {v: votes[v] / len(teams) for v in VERDICTS}
        out[endpoint_id] = {
            "teams": len(teams),
            # Two places and a month: enough to read, not enough to reconstruct one team's votes or
            # to date a quote to the day another team ran its task.
            "share": {v: round(s, 2) for v, s in share.items()},
            "samples": [{"usefulness": r.usefulness, "reason": r.reason.strip(), "client": r.client,
                         "month": r.created_at.strftime("%Y-%m")}
                        for r in _samples(candidates, share, samples)],
        }
    return out
