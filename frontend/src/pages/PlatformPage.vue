<script>
import { useDashboard } from '../state/context'
import ToolDrawer from '../components/ToolDrawer.vue'
import FindAnswer from '../components/FindAnswer.vue'
import CatalogSearch from '../components/CatalogSearch.vue'

// A platform shelf, read at two levels: the shelf (the jobs several providers do, then every other
// tool) and one job (let treg pick, or compare the providers). A tool opens in a drawer over either,
// so a comparison never loses its table. The look is the landing page's: surfaces, not boxes.
export default {
  components: { ToolDrawer, FindAnswer, CatalogSearch },
  setup: useDashboard,
}
</script>

<template>
<div class="pl" :class="{dopen:!!drawerEp}">
  <div v-if="platLoading" class="pl-empty">Loading the catalog…</div>
  <div v-else-if="platErr" class="pl-empty">{{platErr}}</div>

  <!-- THE SHELF -->
  <template v-else-if="platData && !platJob">
    <header class="pl-hero">
      <nav class="pl-crumbs" aria-label="Breadcrumb"><a href="/catalog" @click.prevent="go('connections')">Catalog</a><span>/</span>{{platLabel}}</nav>
      <p class="pl-eyebrow">{{platJobIndex.length}} jobs compared · {{platToolTotal}} more tools · {{platProvLine.length}} providers</p>
      <h1>{{platLabel}}</h1>
      <p v-if="platRow && platRow.summary" class="pl-lede">{{platRow.summary}}</p>
      <CatalogSearch v-model="platQ" :scope="platSlug" :scope-label="platLabel"
                     :placeholder="'Search '+platLabel+', or describe what your agent needs to do'" />
    </header>

    <FindAnswer v-if="findActive && find.scope===platSlug" class="pl-find" />

    <section v-if="platJobList.length" class="pl-sec">
      <h2 class="pl-h"><span>Jobs several providers do</span><i></i><em>{{platJobList.length}}</em></h2>
      <div class="pl-grid">
        <a v-for="j in platJobList" :key="j.key" class="pl-card pl-job" :href="platUrl(platSlug, platJobSlug(j.key))" @click.prevent="openJob(j.key)">
          <span class="pl-job-h"><b>{{j.title}}</b><span v-if="j.routed" class="pl-auto" title="One call: treg picks the provider for you">Autopilot</span></span>
          <span class="pl-job-f">
            <span class="pl-stack" aria-hidden="true"><span v-for="s in j.logos" :key="s" class="pl-logo"><img :src="'/logos/'+s+'.svg'" alt="" @error="$event.target.style.visibility='hidden'"></span></span>
            <span class="pl-meta">{{j.provN}} providers<template v-if="j.range"> · {{j.range}}</template></span>
          </span>
        </a>
      </div>
    </section>

    <section v-if="platTools.length" class="pl-sec">
      <h2 class="pl-h"><span>{{platJobList.length ? 'More tools' : 'Tools'}}</span><i></i><em>{{platTools.length}}</em></h2>
      <div class="pl-grid pl-grid-t">
        <button v-for="t in platTools" :key="t.id" class="pl-card pl-tool" :class="{on:drawerTool===t.id}" @click="openTool(t.id)">
          <span class="pl-logo lg"><img :src="'/logos/'+t.e.provider+'.svg'" alt="" aria-hidden="true" @error="$event.target.style.visibility='hidden'"></span>
          <span class="pl-tool-b"><b>{{t.title}}</b><span class="pl-meta">{{t.e.provider_display||t.e.provider}} · {{t.e.platform_eligible===false ? 'your key' : costShort(t.e.cost)}}</span></span>
        </button>
      </div>
    </section>

    <p v-if="platFilterQ && !platJobList.length && !platTools.length && !platPlumbing.length && !findActive && !findSoon" class="pl-empty">
      Nothing in {{platLabel}} matches “{{platQ.trim()}}”. <button class="pl-link" @click="platQ=''">Clear the search</button></p>

    <section v-if="platPlumbing.length" class="pl-sec">
      <h2 class="pl-h pl-h-quiet"><span>Account and setup</span><i></i><em>{{platPlumbing.length}}</em></h2>
      <div class="pl-grid pl-grid-t">
        <button v-for="t in platPlumbing" :key="t.id" class="pl-card pl-tool quiet" :class="{on:drawerTool===t.id}" @click="openTool(t.id)">
          <span class="pl-logo lg"><img :src="'/logos/'+t.e.provider+'.svg'" alt="" aria-hidden="true" @error="$event.target.style.visibility='hidden'"></span>
          <span class="pl-tool-b"><b>{{t.title}}</b><span class="pl-meta">{{t.e.provider_display||t.e.provider}} · {{t.e.platform_eligible===false ? 'your key' : costShort(t.e.cost)}}</span></span>
        </button>
      </div>
    </section>

    <footer v-if="platProvLine.length" class="pl-provs">
      <span class="pl-eyebrow">Served by</span>
      <div class="pl-provs-l">
        <a v-for="p in platProvLine" :key="p.s" class="pl-prov" :href="provUrl(p.s)" @click.prevent="goProvider(p.s)">
          <span class="pl-logo"><img :src="'/logos/'+p.s+'.svg'" alt="" aria-hidden="true" @error="$event.target.style.visibility='hidden'"></span>{{p.name}}</a>
      </div>
    </footer>
  </template>

  <!-- ONE JOB -->
  <template v-else-if="platData && platJob">
    <div v-if="!platJobRow" class="pl-empty">{{platLabel}} has no job called “{{platJob}}”.
      <button class="pl-link" @click="closeJob">See every job on {{platLabel}}</button></div>
    <template v-else>
      <header class="pl-hero">
        <nav class="pl-crumbs" aria-label="Breadcrumb"><a href="/catalog" @click.prevent="go('connections')">Catalog</a><span>/</span><a
          :href="platUrl(platSlug)" @click.prevent="closeJob">{{platLabel}}</a></nav>
        <p class="pl-eyebrow">{{platJobMeta.provN}} providers<template v-if="platJobMeta.range"> · {{platJobMeta.range}}</template></p>
        <h1 class="pl-h1-job">{{platJobRow.description}}</h1>
      </header>

      <!-- treg's own answer first when there is one: one call, and nobody has to choose. -->
      <section v-if="platJobMeta.routed" class="pl-autocard">
        <div class="pl-auto-t">
          <p class="pl-eyebrow inv">Autopilot</p>
          <h2>{{platJobMeta.provN}} providers, one call.</h2>
          <p>treg picks the best match for what you send and tries the next if one comes back empty.
            Your own keys always go first.</p>
          <ul class="pl-auto-f">
            <li><b>{{costShort(platJobMeta.routed.cost)}}</b>starting price</li>
            <li><b>$1</b>cap per call</li>
          </ul>
        </div>
        <div class="pl-auto-r">
          <div class="pl-code"><code>{{platJobMeta.routed.call_template}}</code>
            <button @click="copyCall(platJobMeta.routed)">{{platCopied===platJobMeta.routed.id ? 'Copied' : 'Copy'}}</button></div>
          <div class="pl-auto-a">
            <button class="pl-btn inv" @click="publicCatalog ? openSignin() : openEpTry(platJobMeta.routed)">Try it</button>
            <button class="pl-link inv" @click="openTool(platJobMeta.routed.id)">How it picks →</button>
          </div>
        </div>
      </section>

      <section class="pl-sec">
        <h2 class="pl-h"><span>{{platJobMeta.routed ? 'Or choose a provider' : 'Choose a provider'}}</span><i></i><em>{{platJobChoices.length}}</em></h2>
        <div class="pl-table">
          <table class="pl-cmp">
            <thead><tr>
              <th class="c-prov">Provider</th>
              <th class="c-takes"><span class="pl-tip" tabindex="0" :data-tip="colTips.takes">Takes</span></th>
              <th v-for="c in [['price','Price'],['works','Works'],['useful','Useful']]" :key="c[0]" :class="'c-'+c[0]"
                  :aria-sort="platJobSort===c[0] ? (c[0]==='price' ? 'ascending' : 'descending') : 'none'">
                <button class="pl-sort pl-tip" :class="{on:platJobSort===c[0]}" :data-tip="colTips[c[0]]" @click="platSortBy(c[0])">{{c[1]}}</button></th>
            </tr></thead>
            <tbody>
              <tr v-for="r in platJobChoices" :key="r.id" :class="{on:drawerTool===r.id}" tabindex="0"
                  @click="openTool(r.id)" @keydown.enter="openTool(r.id)">
                <td class="c-prov"><div class="c-prov-i">
                  <span class="pl-logo lg"><img :src="'/logos/'+r.e.provider+'.svg'" alt="" aria-hidden="true" @error="$event.target.style.visibility='hidden'"></span>
                  <span class="c-name"><b>{{r.e.provider_display||r.e.provider}}<span v-if="!r.e.verified" class="c-unv" title="Documented, but treg has not called it with a live key yet">unverified</span></b>
                    <span v-if="r.twin" class="c-sub">{{clip(r.e.name||r.e.summary, 52)}}</span></span>
                </div></td>
                <td class="c-takes"><span v-for="t in r.takes" :key="t" class="pl-tag">{{t}}</span><span v-if="!r.takes.length" class="c-none">—</span></td>
                <td class="c-price">{{r.e.platform_eligible===false ? 'your key only' : costShort(r.e.cost)}}</td>
                <td class="c-works" :title="worksTitle(r)"><template v-if="r.works"><span class="c-v">{{r.works.pct}}%</span><span class="c-n">{{approxCalls(r.works.n)}}</span></template><span v-else class="c-none">—</span></td>
                <td class="c-useful" :title="usefulTitle(r)"><template v-if="r.useful"><span class="c-v" :class="{low:r.useful.pct<50}">{{r.useful.pct}}%</span><span class="c-n">{{approxTeams(r.useful.n)}}</span></template><span v-else class="c-none">—</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="pl-note"><b>Works</b> share of the last 30 days' calls that did not end in a provider error, past 20 calls.
          <b>Useful</b> what teams' agents said after using the result, one vote per team, past 5 teams; compare it within this table only.</p>
      </section>

      <section v-if="platOtherJobs.length" class="pl-sec">
        <h2 class="pl-h"><span>Other jobs on {{platLabel}}</span><i></i></h2>
        <div class="pl-grid">
          <a v-for="j in platOtherJobs" :key="j.key" class="pl-card pl-job sm" :href="platUrl(platSlug, platJobSlug(j.key))" @click.prevent="openJob(j.key)">
            <b>{{j.title}}</b><span class="pl-meta">{{j.provN}} providers<template v-if="j.range"> · {{j.range}}</template></span>
          </a>
        </div>
      </section>
    </template>
  </template>

  <ToolDrawer v-if="drawerEp" />
</div>
</template>
