"""Is a new user's email their company's own? The first-run experiment is for work addresses only.

Two steps, cheapest first. A domain on the catalog's free-mail list (`paths.email_domain`: free
mailboxes, ISPs, disposable addresses) is personal, at once and for free. Any other domain is put to
Jev once, as a house call, and the verdict is kept per domain: the first sign-up from a domain pays a
judgment, the rest read it. When Jev cannot answer, the domain counts as personal for ten minutes,
then is asked again. The verdict only decides who may enter the experiment; it never blocks a
sign-up.
"""
from __future__ import annotations

import asyncio
import logging

import httpx

from ... import ratestore
from ...config import get_settings
from ...domain.catalog.routing.paths import email_domain
from ...infra.db import session_maker
from ..house_calls import HouseCalls
from .lookup import JEV_ENDPOINT, JEV_MODEL

log = logging.getLogger("treg.onboarding")

NS = "onboarding_domain"
TTL_S = 30 * 86400
UNKNOWN_TTL_S = 600      # a domain Jev could not judge is treated as personal this long, then asked again
JUDGE_TIMEOUT_S = 6
WORK = 0.6        # Jev's yes probability at which a domain counts as a company's own


QUESTION = ("Is {domain} the email domain of a company or organisation that its people work for, as "
            "opposed to a free, personal, ISP, school or disposable mailbox?")
CRITERIA = {"true": "A business's own domain: the address belongs to someone at that company.",
            "false": "Anyone can get an address there, or it is a school, an ISP or a throwaway service."}


async def cached(email: str) -> bool | None:
    """The kept verdict for this address's domain: True, False, or None when none is kept yet."""
    d = email_domain(email)
    if not d:
        return False
    async with session_maker() as db:
        row = await ratestore.kv_get(db, NS, d)
    return bool(row["work"]) if row and "work" in row else None


async def is_work(email: str, http: httpx.AsyncClient) -> bool:
    """Whether this is a work address, asking Jev once per domain. Never raises. Callers asking about
    the same domain at once (the sign-up warm-up and the first /auth/me) share one judgment."""
    known = await cached(email)
    if known is not None:
        return known
    d = email_domain(email) or ""
    task = _judging.get(d)
    if task is None:
        task = _judging[d] = asyncio.create_task(_judge(d, http))
        task.add_done_callback(lambda _t: _judging.pop(d, None))
    return await asyncio.shield(task)


_judging: dict[str, asyncio.Task[bool]] = {}


async def _judge(d: str, http: httpx.AsyncClient) -> bool:
    s = get_settings()
    if not s.onboarding_treg_token:
        return False
    house = HouseCalls(http, s.onboarding_treg_token, "onboarding", s.onboarding_treg_url)
    try:
        a = await asyncio.wait_for(house.request("POST", JEV_ENDPOINT, "judge", json={
            "model": JEV_MODEL, "state": f"# An email domain\n\n<domain>{d}</domain>",
            "questions": {"work": {"type": "noul", "instructions": QUESTION.format(domain=d), "criteria": CRITERIA}}},
            headers={"X-Treg-Route-Max-Cost": "0.02"}, timeout=JUDGE_TIMEOUT_S), JUDGE_TIMEOUT_S + 1)
        p = float(a.body["answers"]["work"]["noul"]) if a.status == 200 else None
    except Exception as exc:  # noqa: BLE001 - an unanswered domain is treated as personal, briefly
        log.info("onboarding: no work-email verdict for %s: %s", d, type(exc).__name__)
        p = None
    work = p is not None and p >= WORK
    keep = {"work": work, "p": round(p, 3)} if p is not None else {"work": False, "unknown": True}
    try:
        async with session_maker() as db:
            await ratestore.kv_put(db, NS, d, keep, TTL_S if p is not None else UNKNOWN_TTL_S)
            await db.commit()
    except Exception as exc:  # noqa: BLE001 - an unkept verdict is asked again next time
        log.info("onboarding: work-email verdict for %s not kept: %s", d, type(exc).__name__)
    return work
