---
title: Web Arena — private comparisons and published web tests
status: gated
sources:
  - src/treg/domain/web_arena.py
  - src/treg/domain/web_arena_scores.py
  - src/treg/application/web_arena.py
  - src/treg/application/web_arena_quality.py
  - src/treg/application/web_arena_publications.py
  - src/treg/application/web_arena_benchmark.py
  - src/treg/web_arena_cases.json
  - src/treg/routers/web_arena.py
  - src/treg/models.py
  - src/treg/alembic/versions/0057_web_arena.py
  - src/treg/config.py
  - src/treg/bootstrap.py
  - src/treg/worker.py
  - src/treg/web/web-arena.html
  - src/treg/web/web-arena/arena.js
  - src/treg/web/web-arena/arena.css
  - tests/test_web_arena.py
related:
  - interface/enrich-arena.md
  - architecture/catalog.md
  - architecture/money.md
---

# Web Arena

`/web-arena`, `/web-arena/leaderboard`, and `/web-arena/benchmark` are one standalone Vue page.
The page uses Enrich Arena's type, light canvas, input card, navigation, and result card styles.
`web_arena_enabled` defaults to false. The page and run API need both the flag and one reviewed
benchmark publication with 30 search, 20 fetch, and 10 sitemap cases. Brand is visible but disabled.

`web_arena.quote` takes a task and one input. Search asks for 10 results, Fetch asks for one URL,
and Sitemap asks for up to 100 URLs. `route.build_plan` supplies verified, scoped catalog
adapters and the team's current credential tier. A task that needs a limit drops an adapter that
cannot send that limit. Sitemap also drops shared-key Tavily Map, whose limit is below 100.
Brand.dev's fixed ten-result search can join a Search quote because it enforces that limit in
its adapter. The Web Arena quote checks this after planning the scoped provider candidates.
The public task response shows verified adapter previews, so the provider lineup and logos appear
before sign-in. The lineup is a catalog preview; a signed-in team quote removes providers it
cannot call. A changed input, mode, Jev choice, or provider selection refreshes the quote after
a short pause. The lineup keeps selected fighters first and has controls to scroll through providers.
Opening a saved run restores its selected fighters from the saved attempts. Failed, empty, and
downvoted attempts use the fallen fighter pose; other available providers stay excluded.
The current quote appears on the Run button without a separate price step.
The run form uses one quality switch with Jev and treg details in an info tooltip. A focused query has one outer
border. Results show provider logos, time and cost, thumbs ratings, and plain failure states.
While a run is live, the lineup shows only its selected providers, uses Enrich Arena's fight and
win animation, and puts Stop beside the fighters.
Completed Battle runs mark the fastest and cheapest successful results when all compared values
are known, both on result cards and on provider fighters. Search results describe freshness from
known source dates in words. A result with no usable dates shows no freshness label; a completed
check can say that recent sources are not needed. The fighter lineup shows the state of each
attempted provider after a run.
An unavailable search match check leaves the score line empty.
One endpoint per provider joins the quote. Battle selects all by default, with a fresh quote
after a provider switch. Waterfall sorts by quoted cost and stops before its quoted spend exceeds
$10. Providers without direct capacity do not join a comparison. A quote freezes endpoint and adapter
hashes; `start` checks them again, locks the user for admission, and checks team credits.
Valyu is excluded from the Web Search lineup and quote until its web search price cap is verified.

Every leg in `_run` creates a direct `CallInput` for `service.execute_call`. Each child uses the
ordinary credential, hold, settle, and cancellation path. The run reads and closes the full
provider stream before it saves a bounded display result. No database session stays open
during the provider request. Own credentials still take priority in the call runtime. Web
Arena requests disable overflow for a direct provider comparison. A Battle runs at most four
legs at once. Waterfall runs one leg at a time. With Jev off, Search stops at the first valid
result list. With Jev on, Search stops only after a checked estimated match of at least 60%; an
unknown check does not become a score of zero. Fetch stops at the first useful text. Sitemap
stops at the first valid same-host URL list and does not claim full site coverage.

`WebArenaRun` holds an encrypted input, quote, attempt state, quality data, and results. Only the
creator in the same team can read it. It expires after 30 days. A process interruption does not
retry an ambiguous provider call. Ratings live in the private run payload and do not change the
automatic check.

`web_arena_quality.search` sends the first five links, titles, and snippets to Jev and shows the
answer as an Intent match estimate, with the scoring scope in help text. It reads dates only when present. Freshness uses a disclosed 30-day
window over dated links when the query needs recent information; missing dates remain unknown.
Fetch counts words and symbols with the fixed `word-or-symbol-v1` tokenizer. For at least two
provider texts, a bounded LLM request lists up to 12 facts from their union. Jev tests retention
of each fact in each text. This is relative coverage and cannot detect facts every provider
missed. Sitemap checks URL syntax, exact host, and duplicates without Jev. It shows coverage only
when a separate known URL list exists. Results save before checks; a check failure leaves the
provider data visible. `WebArenaJudgeBudget` admits external quality calls under a daily user
and operations cap before network I/O. Treg pays those calls separately from provider charges.
Local development with a SQLite database and loopback public URL skips the quality-call caps
for testing. It still needs an AI gateway key.

`web_arena_publications.refresh_live` is worker work. It reads completed Battle runs only, then
saves content-free totals in `WebArenaPublication`. The public page reads that one publication.
Quality win rate stays unknown until 20 comparable checked runs. Sitemap needs a known reference
URL list before any live quality win can exist. `publish_file` accepts a reviewed, versioned
benchmark with the fixed sample counts and formula. The benchmark page only reads that saved
document and makes no provider calls. The score weights are 60% task quality, 20% success,
10% speed, and 10% price; an unknown price leaves the overall rank unknown. The publication
must keep its fixed cases, rules, limits, date, and human review status.

The worker entry points are `treg-worker web-arena test --output PRIVATE.json --confirm-spend`,
`treg-worker web-arena totals`, and `treg-worker web-arena publish FILE`. The fixed case file is a
draft. Fetch facts and sitemap known URL lists need human checks before publication. The test
runner uses an operator team token from `TREG_WEB_ARENA_BENCHMARK_TOKEN`, buys each case through
the same direct call path, and writes its private review file outside this public checkout. It
skips cases already in that file after an interruption. Production settings belong in the paired
private repository after public code merges.
