"""Operator-only fixed-case run. Review file stays outside the public checkout."""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import httpx

from ..domain.identity.access import Caller, _membership_and_key_by_token
from ..infra.db import session_maker
from ..models import Org, User, WebArenaRun
from . import arena, web_arena
from .web_arena_publications import CASES_FILE


async def _caller() -> Caller:
    token = os.environ.get("TREG_WEB_ARENA_BENCHMARK_TOKEN", "")
    if not token:
        raise ValueError("Set TREG_WEB_ARENA_BENCHMARK_TOKEN for the paying test team.")
    async with session_maker() as db:
        member, key = await _membership_and_key_by_token(token, db)
        if member is None:
            raise ValueError("The benchmark token is not an active team token.")
        user, org = await db.get(User, member.user_id), await db.get(Org, member.org_id)
        if not user or not org or user.suspended or org.suspended or org.demo or org.public_demo:
            raise ValueError("The benchmark team is unavailable.")
        return Caller(member, user, org, key)


async def run(output_file: str, *, confirm_spend: bool) -> dict:
    if not confirm_spend:
        raise ValueError("Pass --confirm-spend to start paid provider calls.")
    path = Path(output_file).expanduser().resolve()
    public_root = Path(__file__).resolve().parents[3]
    if path == public_root or public_root in path.parents or path.suffix != ".json":
        raise ValueError("Write the review JSON outside the public treg checkout.")
    cases = json.loads(CASES_FILE.read_text())["tasks"]
    caller = await _caller()
    report = json.loads(path.read_text()) if path.exists() else {"version": "draft-1", "cases": {}}
    report.setdefault("cases", {})
    async with httpx.AsyncClient(timeout=180) as client:
        for task, entries in cases.items():
            for case in entries:
                if case["id"] in report["cases"]:
                    continue  # An interrupted operator run never buys a completed case twice.
                quote = await web_arena.quote(caller, task=task, value=case["input"],
                                             mode="battle", jev=True, _benchmark=True)
                if quote["limit_exceeded"] or not quote["affordable"]:
                    raise ValueError(f"Case {case['id']} needs fewer providers or more team credits.")
                await web_arena.start(caller, quote["id"], client, "127.0.0.1", _benchmark=True)
                owner = web_arena._owners.get(quote["id"])
                if owner:
                    await asyncio.wait_for(asyncio.shield(owner), 230)
                async with session_maker() as db:
                    saved = await db.get(WebArenaRun, quote["id"])
                    payload = arena._unpack(saved.payload)
                    state = saved.state
                report["cases"][case["id"]] = {"task": task, "input": case["input"],
                    "run_id": quote["id"], "state": state, "attempts": payload["attempts"]}
                tmp = path.with_suffix(".tmp")
                tmp.write_text(json.dumps(report, ensure_ascii=True, indent=2))
                tmp.replace(path)
    return {"review_file": str(path), "completed_cases": len(report["cases"])}
