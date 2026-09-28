<script>
import { useDashboard } from '../state/context'
import ToolDrawer from '../components/ToolDrawer.vue'
import FindAnswer from '../components/FindAnswer.vue'
import CatalogSearch from '../components/CatalogSearch.vue'
import ProviderLogo from '../components/ProviderLogo.vue'
import { DataTable } from '../components/ui/table'

// A platform shelf, read at two levels: the shelf (the capabilities several providers serve, then
// every other tool) and one comparison (let treg pick, or compare the providers). A tool opens in a drawer over either,
// so a comparison never loses its table. The look is the landing page's: surfaces, not boxes.
export default {
  components: { ToolDrawer, FindAnswer, CatalogSearch, DataTable, ProviderLogo },
  setup: useDashboard,
}
</script>

<template>
<div class="pl" :class="{dopen:!!drawerEp}">
  <div v-if="platLoading || catalogArm==='pending'" class="pl-empty">Loading the catalog…</div>
  <div v-else-if="platErr" class="pl-empty">{{platErr}}</div>

  <!-- THE SHELF -->
  <template v-else-if="platData && !platCap">
    <header class="pl-hero">
      <nav class="pl-crumbs" aria-label="Breadcrumb"><a href="/catalog" @click.prevent="go('connections')">Catalog</a><span>/</span>{{platLabel}}</nav>
      <p class="pl-eyebrow">{{platComparisons.length}} jobs compared · {{platToolTotal}} more tools · {{platProvLine.length}} providers</p>
      <h1>{{platLabel}}</h1>
      <p v-if="platRow && platRow.summary" class="pl-lede">{{platRow.summary}}</p>
      <CatalogSearch v-model="platQ" :scope="platSlug" :scope-label="platLabel"
                     :placeholder="'Search '+platLabel+', or describe what your agent needs to do'" />
    </header>

    <FindAnswer v-if="findActive && find.scope===platSlug" class="pl-find" />

    <section v-if="platComparisonsShown.length" class="pl-sec">
      <h2 class="pl-h"><span>Jobs several providers do</span><i></i><em>{{platComparisonsShown.length}}</em></h2>
      <div class="pl-grid">
        <a v-for="j in platComparisonsShown" :key="j.key" class="pl-card pl-cmp" :href="platUrl(platSlug, j.slug)" @click.prevent="openComparison(j.slug)">
          <span class="pl-cmp-h"><b>{{j.title}}</b><span v-if="j.routed" class="pl-auto" title="One call: treg picks the provider for you">Autopilot</span></span>
          <span class="pl-cmp-f">
            <span class="pl-stack" aria-hidden="true"><ProviderLogo v-for="s in j.logos" :key="s" :service="s" /></span>
            <span class="pl-meta">{{j.meta}}</span>
          </span>
        </a>
      </div>
    </section>

    <!-- Every other tool, then the account and setup plumbing: one card each, the same card. -->
    <section v-for="sec in [{key:'tools', label:platComparisonsShown.length ? 'More tools' : 'Tools', items:platTools},
                            {key:'setup', label:'Account and setup', items:platPlumbing, quiet:true}].filter(s=>s.items.length)"
             :key="sec.key" class="pl-sec">
      <h2 class="pl-h" :class="{'pl-h-quiet':sec.quiet}"><span>{{sec.label}}</span><i></i><em>{{sec.items.length}}</em></h2>
      <div class="pl-grid pl-grid-t">
        <button v-for="t in sec.items" :key="t.id" class="pl-card pl-tool" :class="{on:drawerTool===t.id, quiet:sec.quiet}" @click="openTool(t.id)">
          <ProviderLogo :service="t.e.provider" large />
          <span class="pl-tool-b"><b>{{t.title}}</b><span class="pl-meta">{{t.e.provider_display||t.e.provider}} · {{toolPrice(t.e)}}</span></span>
        </button>
      </div>
    </section>

    <p v-if="platFilterQ && !platComparisonsShown.length && !platTools.length && !platPlumbing.length && !findActive && !findSoon" class="pl-empty">
      Nothing in {{platLabel}} matches “{{platQ.trim()}}”. <button class="pl-link" @click="platQ=''">Clear the search</button></p>

    <footer v-if="platProvLine.length" class="pl-provs">
      <span class="pl-eyebrow">Served by</span>
      <div class="pl-provs-l">
        <a v-for="p in platProvLine" :key="p.s" class="pl-prov" :href="provUrl(p.s)" @click.prevent="goProvider(p.s)">
          <ProviderLogo :service="p.s" />{{p.name}}</a>
      </div>
    </footer>
  </template>

  <!-- ONE JOB -->
  <template v-else-if="platData && platCap">
    <div v-if="!platCapRow" class="pl-empty">{{platLabel}} has no job called “{{platCap}}”.
      <button class="pl-link" @click="closeComparison">See every job on {{platLabel}}</button></div>
    <template v-else>
      <header class="pl-hero">
        <nav class="pl-crumbs" aria-label="Breadcrumb"><a href="/catalog" @click.prevent="go('connections')">Catalog</a><span>/</span><a
          :href="platUrl(platSlug)" @click.prevent="closeComparison">{{platLabel}}</a></nav>
        <p class="pl-eyebrow">{{platComparison.meta}}</p>
        <h1 class="pl-h1-cmp">{{platCapRow.description}}</h1>
      </header>

      <!-- treg's own answer first when there is one: one call, and nobody has to choose. -->
      <section v-if="platComparison.routed" class="pl-autocard">
        <div class="pl-auto-t">
          <p class="pl-eyebrow">Autopilot</p>
          <h2>{{platComparison.provN}} providers, one call.</h2>
          <p>treg picks the best match for what you send and tries the next if one comes back empty.
            Your own keys always go first.</p>
          <ul class="pl-auto-f">
            <li><b>{{costShort(platComparison.routed.cost)}}</b>starting price</li>
            <li><b>$1</b>cap per call</li>
          </ul>
        </div>
        <div class="pl-auto-r">
          <!-- The page's one primary action is handing this line to your agent: copying needs no
               account and costs nothing. Trying it here is the optional step beside it. -->
          <div class="pl-code"><code>{{platComparison.routed.call_template}}</code></div>
          <div class="pl-auto-a">
            <button class="pl-btn pl-copy" @click="catalogCopy(platComparison.routed)">{{platCopied===platComparison.routed.id ? 'Copied' : 'Copy for your agent'}}</button>
            <button class="pl-btn ghost" @click="catalogTry(platComparison.routed)">Try it</button>
            <button class="pl-link" @click="openTool(platComparison.routed.id)">How it picks →</button>
          </div>
        </div>
      </section>

      <section class="pl-sec">
        <h2 class="pl-h"><span>{{platComparison.routed ? 'Or choose a provider' : 'Choose a provider'}}</span><i></i><em>{{platComparisonRows.length}}</em></h2>
        <DataTable :columns="comparisonColumns" :rows="platComparisonRows" :row-key="r => r.id" v-model:sort="platComparisonSort"
                   :selected="drawerTool" interactive variant="plain" surface @row-click="r => openTool(r.id)">
          <template #cell-provider="{ row: r }"><div class="c-prov-i">
            <ProviderLogo :service="r.e.provider" large />
            <span class="c-name"><b>{{r.e.provider_display||r.e.provider}}<span v-if="!r.e.verified" class="c-unv" title="Documented, but treg has not called it with a live key yet">unverified</span></b>
              <span v-if="r.twin" class="c-sub">{{clip(r.e.name||r.e.summary, 52)}}</span></span>
          </div></template>
          <template #cell-takes="{ row: r }"><span v-for="t in r.takes" :key="t" class="pl-tag">{{t}}</span><span v-if="!r.takes.length" class="c-none">—</span></template>
          <template #cell-price="{ row: r }"><span class="c-price">{{toolPrice(r.e)}}</span></template>
          <template #cell-works="{ row: r }"><span :title="worksTitle(r)"><template v-if="r.works"><span class="c-v">{{r.works.pct}}%</span><span class="c-n">{{approxCalls(r.works.n)}}</span></template><span v-else class="c-none">—</span></span></template>
          <template #cell-useful="{ row: r }"><span :title="usefulTitle(r)"><template v-if="r.useful"><span class="c-rev" :class="r.useful.tone">{{r.useful.label}}</span><span class="c-n">{{approxTeams(r.useful.n)}}</span></template><template v-else-if="r.e.reviews"><span class="c-rev early">Early</span><span class="c-n">{{approxTeams(r.e.reviews.teams)}}</span></template><span v-else class="c-none">—</span></span></template>
        </DataTable>
        <p class="pl-note"><b>Works</b> share of the last 30 days' calls that did not end in a provider error, past 20 calls.
          <b>Reviews</b> what teams' agents said after using the result, from Positive to Negative, one vote per team, scored once 5 teams have rated it; before that, Early, with their reasons quoted in the tool.</p>
      </section>

      <section v-if="platOtherComparisons.length" class="pl-sec">
        <h2 class="pl-h"><span>Other jobs on {{platLabel}}</span><i></i></h2>
        <div class="pl-grid">
          <a v-for="j in platOtherComparisons" :key="j.key" class="pl-card pl-cmp sm" :href="platUrl(platSlug, j.slug)" @click.prevent="openComparison(j.slug)">
            <b>{{j.title}}</b><span class="pl-meta">{{j.meta}}</span>
          </a>
        </div>
      </section>
    </template>
  </template>

  <ToolDrawer v-if="drawerEp" />
</div>
</template>
