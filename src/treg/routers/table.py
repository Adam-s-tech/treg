"""HTTP adapter for `/table/<tool id>`: the same call as `/call/<tool id>`, answered as rows and columns.

Only the ending differs from `/call/`: the call runs through `run_call_surface` (the same gates, key
injection, hold and settle, audit row and `Idempotency-Key`), then `application.table` reads the
answer and converts it. Behind `TREG_TABLE_ENABLED` (+ `TREG_TABLE_TEAMS` / `TREG_TABLE_USERS`).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

from ..application import table as table_app
from ..domain.identity.access import Caller, require_member
from .call import run_call_surface

app = APIRouter()
router = app


async def _table_answer(request: Request, context, upstream, rest: str) -> Response:
    status, body, headers = await table_app.table_answer(context, upstream, rest)
    response = JSONResponse(body, status_code=status)
    for name, value in headers:
        response.headers[name.decode("latin-1")] = value.decode("latin-1")
    return response


@app.api_route(
    "/table/{rest:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    include_in_schema=False,
)
async def table_tool(
    rest: str,
    request: Request,
    caller: Caller = Depends(require_member),
):
    """One call, answered as `{shape, columns, rows, ...}` (docs/context/architecture/table.md)."""
    if not table_app.enabled_for(caller.org.slug, caller.email):
        # Answered here, not raised: a raised 404 on a call surface is stamped and audited as a
        # refusal, and with the flag off this route must look like it does not exist.
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    return await run_call_surface(rest, request, caller, prefix="/table/", finish=_table_answer,
                                  headers=table_app.plain_headers(tuple(request.headers.raw)))


@app.get("/table-columns/{tool_id:path}", include_in_schema=False)
async def table_columns(tool_id: str, caller: Caller = Depends(require_member)):
    """The columns `/table/<tool id>` will answer with, free: no provider call, no charge, no audit
    row. A separate path, not `/table/...?preview=1`: `/table/` passes every query parameter to the
    provider, as `/call/` does."""
    if not table_app.enabled_for(caller.org.slug, caller.email):
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    view = await table_app.preview(tool_id, org_id=caller.org_id, org_slug=caller.org.slug, email=caller.email)
    if view is None:
        return JSONResponse({"error": "no_preview", "tool_id": tool_id,
                             "detail": "treg has no contract, manifest or saved example for this tool"},
                            status_code=404)
    return view

