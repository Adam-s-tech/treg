---
title: Web Arena — private comparisons and live provider observations
status: gated
sources:
  - src/treg/domain/web_arena.py
  - src/treg/domain/web_arena_scores.py
  - src/treg/application/web_arena.py
  - src/treg/application/web_arena_quality.py
  - src/treg/application/web_arena_publications.py
  - src/treg/application/web_arena_calls.py
  - src/treg/routers/web_arena.py
  - src/treg/models.py
  - src/treg/alembic/versions/0057_web_arena.py
  - src/treg/alembic/versions/0058_web_arena_call_stats.py
  - src/treg/alembic/versions/0059_web_arena_seed_start.py
  - src/treg/alembic/versions/0060_web_arena_seed_progress.py
  - src/treg/config.py
  - src/treg/bootstrap.py
  - src/treg/worker.py
  - src/treg/web/web-arena.html
  - src/treg/web/web-arena/arena.js
  - src/treg/web/web-arena/arena.css
  - tests/test_web_arena.py
  - tests/test_web_arena_calls.py
related:
  - interface/enrich-arena.md
  - architecture/catalog.md
  - architecture/money.md
---

# Web Arena

`/web-arena` and `/web-arena/leaderboard` are one standalone Vue page.
The page uses Enrich Arena's type, light canvas, input card, navigation, and result card styles.
Its header shares Enrich Arena's GitHub, Discord, and X community links beside account controls.
The Arena and Leaderboard tabs use the same icons, and the intro uses its Treg credit.
Both pages share a footer with page-specific result wording and a privacy link. The
Leaderboard footer downloads the existing public `/web-arena/api/leaderboard` JSON aggregate;
it contains the three task summaries, update time, window, filters, and sample counts, not
individual queries or provider responses.
The `branddev` provider keeps its catalog identifier and logo but appears as Context.dev in the UI.
`web_arena_enabled` defaults to false. The page and run API need the flag. Brand is visible but disabled.

`web_arena.quote` takes a task and one input. Search asks for 10 results, Fetch asks for one URL,
and Sitemap asks for a site URL with an optional search phrase and up to 10 URLs. The phrase goes
to adapters that accept it; URL-only adapters continue with the URL, and Olostep joins only when
the phrase is present. Sitemap hides the Jev quality switch and records Jev as off; URL validity
checks always run. Sitemap result cards show the unique valid URL count without a coverage claim.
`route.build_plan` supplies verified, scoped catalog adapters and the team's
current credential tier. A task that needs a limit drops an adapter that cannot send that limit,
except Search1API Sitemap, whose response is compared using only its first ten URLs. Its upstream
request remains unbounded. Context.dev Map sends the selected limit upstream. The ten-URL bound
also permits Tavily Map on the shared key.
Brand.dev's fixed ten-result search can join a Search quote because it enforces that limit in
its adapter. The Web Arena quote checks this after planning the scoped provider candidates.
TinyFish is the one exception without a count request field. A Search quote can include its
first page; Web Arena compares at most the first ten returned links. Every other Search provider
must send the ten-result limit upstream. Spider Search uses listing-only mode so its search
does not fetch the result pages.
The public task response shows verified adapter previews, so the provider lineup and logos appear
before sign-in. The lineup is a catalog preview; a signed-in team quote removes providers it
cannot call. A changed input, mode, Jev choice, or provider selection refreshes the quote after
a short pause. The lineup keeps selected fighters first and has controls to scroll through providers.
The signup and team dialogs use Enrich Arena's layout, OAuth availability from `/meta`, email-code
step, local development code notice, and legal links. The draft survives an OAuth redirect.
Opening a saved run restores its selected fighters from the saved attempts. Failed, empty, and
downvoted attempts use the fallen fighter pose; other available providers stay excluded.
The current quote appears on the Run button without a separate price step.
Before a run, the provider table lists every catalog-preview tool and its catalog price.
When a team quote is ready, the table replaces that price with the input-specific estimate.
It joins content-free live totals by provider: hit rate appears after 20 decided direct
calls and median provider time after 20 successful uncached direct calls. The task-specific
quality estimate appears after 20 checked Web Arena inputs. Search uses Jev intent match,
Fetch uses relative fact coverage, and Sitemap coverage stays unknown without a known URL
list. A provider call made during a Battle or Waterfall enters the direct-call aggregate
once through `CallRecord`; it is not counted again from `WebArenaRun`. Repeat checked Arena
inputs count once per provider for quality, using the latest checked result. The preview gives way to the
actual results during and after a run.
The run form uses one quality switch with Jev and treg details in an info tooltip. A focused query has one outer
border. Results show provider logos, time and cost, thumbs ratings, and plain failure states.
Search result cards show the first three provider links with titles, available dates and descriptions,
and a control to reveal the remaining links. The raw provider response stays in a footer disclosure
opposite the thumbs ratings. The quality check's internal link list is not displayed separately.
Diffbot search rows use `pageUrl` for the link and `content` for the excerpt; both the result card
and Jev's bounded search input read those fields. Earlier runs keep their saved quality state.
The Results heading has an icon toggle for card and compact table views with tooltips. The table
keeps Fastest, Cheapest, Most Relevant, and Token Efficient badges below the provider name. Its
plus action expands the full links
or provider output; thumbs, cost, time, and quality stay in the row.
While a run is live, the lineup shows only its selected providers, uses Enrich Arena's fight and
win animation, and puts Stop beside the fighters.
Completed Battle runs mark the fastest and cheapest successful results when all compared values
are known. Search Battles mark the highest estimated intent match among at least two scored,
successful results; an unscored provider does not suppress that badge. Ties receive the same badge.
These badges appear on result cards, table rows,
and provider fighters. Fetch Battles mark the best token efficiency when all successful, non-downvoted
results have usable efficiency scores. Search results describe freshness from
known source dates in words. A result with no usable dates shows no freshness label. The fighter lineup shows the state of each
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
missed. Web Arena reads plain page text, Olostep's `markdown_content`, and Brand.dev's nested
`markdown.data` before deciding whether a Fetch returned usable text. Fetch cards show text count,
Fact coverage, and token efficiency as compact metrics with explanations. The text count is a
word-and-symbol count, not a model token count. Cards omit the underlying tokens-per-fact ratio
and the shared fact-list generation time. Card and table views both call the fetch metric Fact
coverage and explain its relative scope in a tooltip. Sitemap checks URL syntax, exact host, and duplicates
without Jev. It shows coverage only
when a separate known URL list exists. Results save before checks; a check failure leaves the
provider data visible. `WebArenaJudgeBudget` admits external quality calls under a daily user
and operations cap before network I/O. Treg pays those calls separately from provider charges.
Local development with a SQLite database and loopback public URL skips the quality-call caps
for testing. It still needs an AI gateway key.

`web_arena_calls.collect` walks `CallRecord` by a locked cursor with a commit lag and folds
eligible Web task endpoint calls into content-free daily buckets. Only actual, uncached,
unrefused provider attempts enter the buckets. Adapter hit/miss verdicts and provider faults
decide hit rate; unknown outcomes and caller 4xx do not. Only successful direct calls provide
response-time samples. The collector processes backlog incrementally and never reads a provider
answer body. `WebArenaCallDayStat` and `WebArenaCallCursor` are owned by this module.
For an initial release with a large audit backlog, `treg-worker web-arena seed` scans only
listed Web task endpoints from the most recent ten days. It builds bounded, content-free
daily buckets in separate staging tables. Each invocation saves a bounded batch and reports
whether another invocation is needed. The endpoint list, time range, and scan position are
frozen on the first pass, so interrupted runs resume without double counting. Only after
all listed endpoints are scanned does one transaction replace partial live totals, advance
the call cursor to the high-water mark, and record the actual observation start. The command
requires Web Arena to be off and refuses to run after a successful seed. An incomplete or
failed pass leaves the existing live totals in place. The ordinary collector then handles later calls
and ages observations into the rolling 30-day window; it does not backfill the preceding
20 days. The page displays the shorter observation coverage while that window fills.
`web_arena_publications.refresh_live` joins those call observations with quality from completed
Battle and Waterfall runs and saves content-free totals in `WebArenaPublication`. Quality wins
remain Battle-only because they require simultaneous checked comparisons. The Arena preview and
public leaderboard read that one publication. The scheduled `treg-worker arena insights` command
collects new call observations on each tick and refreshes the publication
after the one-time seed or when Web Arena is enabled, at most once every 30
minutes. The cron can run more often; `refresh_live_if_due` skips the full
rolling-window read while the saved totals are fresh and retries on the next run after a
failed refresh. The standalone
`treg-worker web-arena totals` command remains available for manual refresh. Local development
reads recent direct calls and Arena quality on the leaderboard request so new test runs appear
without a cron worker. If older local runs cannot be decrypted after a key change, the local
quality summary uses readable recent runs for each task and labels that data as partial. A task with
no readable runs keeps its last saved quality totals with a stale-data label. If no run is readable
and no saved publication exists, the read fails visibly. The hosted worker still fails on an
unreadable payload.
`summarize_live` uses completed Web Arena Battle and Waterfall runs from the most recent 30
days, capped at the 10,000 newest runs, for checked quality. The direct-call buckets include
eligible dashboard, CLI, agent, Battle, and attempted Waterfall calls to the Web Arena's
listed endpoints. A skipped Waterfall provider has no call to count. The source, window,
filters, and sample floors travel with each saved publication.
The live leaderboard uses Enrich Arena's task pills, comparison rail, provider logos, and hover or
selection details. Search offers hit rate, Jev relevance, catalog price, and price vs hit rate;
Fetch adds fact coverage, token efficiency, and fact coverage vs token efficiency; Sitemap uses
hit rate and price. Single metrics can appear as vertical or horizontal bars. Comparison plots
show both axes and scroll horizontally inside the chart when needed. Price values retain their
catalog unit, and the UI warns when units differ. Hit rate is visible with its decided-call
count; quality metrics appear after 20 checked inputs per provider. Hovering or focusing a
quality option shows an Arena-style tooltip explaining the score and its checked Web Arena
source. Fetch live publications
aggregate token efficiency separately from fact coverage, using the same checked-input threshold.
Quality win rate stays unknown until 20 comparable checked runs. Sitemap needs a known reference
URL list before any live quality win can exist. There is no Benchmark tab or fixed-case runner.

The worker entry point `treg-worker web-arena totals` manually refreshes live totals. Production settings belong in the paired
private repository after public code merges.
