<script>
import { useDashboard } from '../state/context'

// The platform page as it was before the shelf (the ledger): the control arm of the catalog-v2
// experiment (state/catalogExperiment.js), restored as it shipped and kept whole in this file, its
// state, rows and styles included, so the experiment ends by deleting it. Its actions go through
// the same tracked methods as the shelf's (`catalogTry`, `catalogCopy`, …), and opening a row is
// `catalog_job_viewed` (a merged row: the comparison) or `catalog_tool_opened` (one endpoint).

// The ledger's section headings stick right under the filter bar, so their offset is the bar's
// live height. Written on the bar's parent, which also holds the table: the redesign shell
// redeclares --lsec-top on its own element, so a value on the document root never reached them.
let barObserver = null
let barHost = null
function stickLedgerBar(el) {
  barObserver?.disconnect()
  barHost?.style.removeProperty('--lsec-top')
  barObserver = barHost = null
  if (!el) return
  barHost = el.parentElement
  barObserver = new ResizeObserver(() => {
    barHost.style.setProperty('--lsec-top', `calc(var(--lbar-top) + ${el.offsetHeight}px)`)
  })
  barObserver.observe(el)
}

export default {
  // Added onto the bindings, never spread: each binding is a live getter onto the shared state.
  setup() { return Object.assign(useDashboard(), { stickLedgerBar }) },
  data() {
    return {
      domain: '', verifiedOnly: false,
      platOpen: {},        // ledger row key → row expanded
      actionsOpen: false,  // the single platform-wide account/utility ("Actions") section is open
      epOpen: {},          // endpoint id → its provider sub-row (level two, merged rows only) is open
    }
  },
  watch: {
    platSlug() { this.domain = ''; this.verifiedOnly = false; this.platOpen = {}; this.epOpen = {}; this.actionsOpen = false },
  },
  computed: {
    // Sections, their order and the merged/single split are all decided by the server (see
    // catalog_store.domain_rows) so the CLI, the API and this page can't disagree about what the
    // platform contains. Everything below is presentation the server has no business knowing:
    // the price label, whether the row is callable TODAY (which depends on who is logged in), and
    // the haystack the filter box searches.
    // The shelf's rows (`platRowsAll`: title, plumbing flag, the filter's haystack, shared with v2 so
    // both arms filter alike), plus what the ledger shows on each.
    rows() {
      return this.platRowsAll.map(r => {
        const eps = r.endpoints
        const cheapest = this.capCheapest(eps)
        const provs = [...new Set(eps.map(e => e.provider_display || e.provider))]
        const pills = this.provPills(eps)
        return { ...r,
          // Three pills and a +N. Never four, never a wrap: the strip is what decides whether a
          // merged row is one line, and one line is the rule.
          pills: pills.slice(0, 3), pillsMore: Math.max(0, pills.length - 3),
          pillsMoreTitle: pills.slice(3).map(x => x.name).join(', '),
          provTitle: provs.length + ' provider' + (provs.length === 1 ? '' : 's') + ' · ' + eps.length +
                     ' endpoint' + (eps.length === 1 ? '' : 's') + ' — ' + provs.join(', '),
          key: (r.capability || '') + '|' + eps[0].id,
          // "from $0.001" on a merged row, the flat label on a single one - and never "from free".
          price: cheapest ? ((r.kind === 'merged' && eps.length > 1 && cheapest.n > 0 ? 'from ' : '') + cheapest.label)
                 : (eps.some(e => e.cost && e.cost.note) ? 'see provider' : '—'),
          priceNative: cheapest ? cheapest.native : '',
          priceTitle: r.kind === 'merged'
            ? 'The cheapest of the ' + eps.length + ' providers on this row — open it for each one'
            : this.costTitle(eps[0].cost),
          verified: eps.some(e => !!e.verified),
          ready: eps.some(e => this.catEndpointConnected(e)) }
      })
    },
    // The text box and the verified checkbox narrow the row list; the domain chips then narrow it
    // again. Splitting it here is what lets each chip carry the count it would actually show.
    preDomain() {
      const q = this.platQ.trim().toLowerCase()
      return this.rows.filter(r => (!this.verifiedOnly || r.verified) && (!q || r.hay.includes(q)))
    },
    domainTabs() {
      const n = {}; for (const r of this.preDomain) if (!r.mgmt) n[r.domain] = (n[r.domain] || 0) + 1
      return (this.platData && this.platData.domains || []).filter(s => n[s.domain]).map(s => ({ domain: s.domain, n: n[s.domain] }))
    },
    ledger() {
      const vis = {}
      for (const r of this.preDomain) {
        if (r.mgmt || (this.domain && r.domain !== this.domain)) continue
        ;(vis[r.domain] = vis[r.domain] || []).push(r)
      }
      const out = (this.platData && this.platData.domains || []).filter(s => vis[s.domain])
        .map(s => ({ domain: s.domain, rows: vis[s.domain] }))
      // Every management endpoint on the platform lands in ONE collapsed section at the bottom.
      const acts = this.actionRows
      if (acts.length) out.push({ domain: 'Actions', actions: true, count: acts.length, rows: this.actionsOpen ? acts : [] })
      return out
    },
    browseCount() { return this.preDomain.filter(r => !r.mgmt).length },
    actionRows() { return this.domain ? [] : this.preDomain.filter(r => r.mgmt) },
    stats() {
      let rows = 0, eps = 0
      for (const r of this.preDomain) {
        if (r.mgmt || (this.domain && r.domain !== this.domain)) continue
        rows++; eps += r.endpoints.length
      }
      return { rows, eps }
    },
  },
  methods: {
    clearFilters() { this.domain = ''; this.platQ = ''; this.verifiedOnly = false },
    toggleRow(r) {
      const open = this.platOpen[r.key] = !this.platOpen[r.key]
      if (!open) return
      if (r.kind === 'merged') this.catalogTrack('catalog_job_viewed', { job: r.job || r.capability, via: 'row' })
      else this.catalogToolEvent('catalog_tool_opened', r.endpoints[0], { via: 'row' })
    },
    // Level two: a provider sub-row under a merged row opens its own instruction.
    toggleEp(e) {
      if ((this.epOpen[e.id] = !this.epOpen[e.id])) this.catalogToolEvent('catalog_tool_opened', e, { via: 'row' })
    },
    // One pill per provider on a merged row, carrying that provider's CHEAPEST priced endpoint -
    // the number a comparison turns on - and a ✓ if any of its endpoints is verified.
    provPills(eps) {
      const by = new Map()
      for (const e of eps) {
        const cur = by.get(e.provider), n = this.costUsd(e.cost)
        if (!cur) by.set(e.provider, { name: e.provider_display || e.provider, cost: e.cost, n, endpoint: e, verified: !!e.verified })
        else {
          cur.verified = cur.verified || !!e.verified
          if (n != null && (cur.n == null || n < cur.n)) { cur.cost = e.cost; cur.n = n; cur.endpoint = e }
        }
      }
      return [...by.values()]
        .sort((a, b) => (a.n == null) - (b.n == null) || (a.n - b.n) || (b.verified - a.verified))
        .map(p => ({ name: p.name, verified: p.verified, price: p.endpoint.platform_eligible ? this.pillPrice(p.cost) : this.endpointAccessLabel(p.endpoint) }))
    },
    // A pill prices an endpoint only when there IS a price: a published number, or "free".
    pillPrice(c) {
      if (!c || !c.type) return ''
      if (c.type === 'free') return 'free'
      if (c.type === 'quota_rows') { const l = this.costLabel(c); return l.length <= 8 ? l : '' }
      return typeof c.usd === 'number' ? this.costLabel(c) : ''
    },
  },
}
</script>

<template>

          <!-- Stacked, not the two-column .tut-head the other pages use: a platform can be served by
               a dozen providers, and as a right-hand column that chip list steals half the width and
               wraps the title into a three-line ribbon ("People & / contact / data"). Full-width
               title, then the intro at a readable measure, then the providers as their own row. -->
          <div class="plat-head">
            <button class="btn sm" style="margin-bottom:12px" @click="go('connections')">← Catalog</button>
            <div class="plat-title">
              <span class="pt-logo" style="width:44px;height:44px;flex:0 0 44px"
                    :class="{gen:platLogoBad[platSlug]}"
                    :style="platLogoBad[platSlug] ? {background:platTileBg(platSlug)} : null">
                <img v-if="!platLogoBad[platSlug]" :src="'/logos/platforms/'+platSlug+'.svg'" alt=""
                     aria-hidden="true" @error="platLogoBad[platSlug]=true">
                <span v-else class="pt-i">{{platInitial({label:platLabel, slug:platSlug})}}</span>
              </span>
              <h1>{{platLabel || '\u00a0'}}</h1>
            </div>
            <p class="sub plat-intro">Every endpoint treg knows for this platform, one ledger, filed by subject — jobs several
              providers do sit on a single row, so you can compare price and coverage before you spend a call.</p>
            <div class="plat-provs" v-if="platProviders.length">
              <span class="plat-provs-l">Providers</span>
              <!-- Signed out, both destinations (a provider's marketplace page, the vault) need an
                   account, so the chips state who supplies the shelf and the last one is the way in. -->
              <button v-for="s in platProviders" :key="s" class="btn sm"
                      @click="publicCatalog ? openSignin() : openProvider(s)">{{provName(s)}}{{publicCatalog?'':' \u2192'}}</button>
              <button class="btn sm" @click="catalogByok(platProviders.length===1 ? platProviders[0] : null)"
                      title="Register your own provider key — your key wins over treg's and those calls are never metered">🔑 Bring your own key</button>
            </div>
          </div>

          <div v-if="platLoading" class="mk-empty" style="margin-top:14px">Loading the catalog…</div>
          <div v-else-if="platErr" class="mk-empty" style="margin-top:14px">{{platErr}}</div>
          <template v-else-if="platData">
            <!-- THE LEDGER. One table for the whole platform, filed into sticky domain sections
                 (user · video · search · shop · …, "other" always last). Within a section the
                 MERGED rows come first - a job several providers do, on one comparable line -
                 then the endpoints only one provider offers, each led by its own summary, because
                 "Get Showcase Product List" says more than the capability id ever could. -->
            <!-- The bar is sticky and its chips WRAP: a scrolling strip with a hidden scrollbar cut the
                 last chip in half and left mouse users no way to reach the rest. Wrapping makes its
                 height vary with the platform and the filter, so the section headings that stick
                 under it read the measured height (`stickLedgerBar`) instead of assuming one row. -->
            <div class="lbar" :ref="stickLedgerBar">
              <div class="lctl">
                <input class="lfind" v-model="platQ" placeholder="Filter, e.g. comments" aria-label="Filter this platform's tools">
                <label class="lchk"><input type="checkbox" v-model="verifiedOnly"> verified only</label>
                <!-- Two numbers only when they differ: a merged row is several endpoints, and that
                     is the one case where the row count understates the catalog. -->
                <span class="lstat">{{stats.rows}} row{{stats.rows===1?'':'s'}}<template
                      v-if="stats.eps!==stats.rows"> · {{stats.eps}} endpoint{{stats.eps===1?'':'s'}}</template><span
                      v-if="domain || platQ || verifiedOnly"> · filtered <button class="lclear" @click="clearFilters">clear</button></span></span>
              </div>
              <div class="lchips">
                <button class="mk-chip" :class="{on:!domain}" @click="domain=''">All <span>{{browseCount}}</span></button>
                <button v-for="d in domainTabs" :key="d.domain" class="mk-chip"
                        :class="{on:domain===d.domain}"
                        @click="domain = domain===d.domain ? '' : d.domain">{{d.domain}} <span>{{d.n}}</span></button>
              </div>
            </div>

            <div class="ttable-wrap lwrap" v-if="ledger.length"><table class="ledger">
              <thead><tr><th class="lth-w">What it does</th><th>Providers / route</th><th class="lth-p">Price</th><th class="lth-v"
                  title="Called for real against the live API, and the response captured">Verified</th></tr></thead>
              <!-- A row, its section heading and its expanded detail are all table rows, so each
                   level rides a wrapper tag - a tbody per group would strip the row separators. -->
              <template v-for="sec in ledger" :key="sec.domain">
                <tr class="lsec" :class="{on:sec.actions}"><td colspan="4">
                  <!-- The one collapsed section: every account/utility endpoint on the platform,
                       whatever domain it nominally belongs to. -->
                  <button v-if="sec.actions" class="lsec-btn" :aria-expanded="actionsOpen"
                          @click="actionsOpen=!actionsOpen"><span class="lcar">▸</span>Actions
                    <span>{{sec.count}}</span></button>
                  <template v-else>{{sec.domain}} <span>{{sec.rows.length}}</span></template>
                </td></tr>
                <template v-for="r in sec.rows" :key="r.key">
                  <!-- EVERY row expands, merged or not: the row says what it does, the expansion
                       says how to call it, and which of the two a visitor needs is not something
                       the row shape can decide for them. -->
                  <tr class="lrow" :class="{open:platOpen[r.key], go:r.ready, merged:r.kind==='merged'}" @click="toggleRow(r)"
                      :aria-expanded="!!platOpen[r.key]">
                    <!-- The flex lives on a wrapper INSIDE the cell, never on the <td>. A td with
                         `display:flex` stops being a table-cell: the browser wraps it in an
                         anonymous cell that stretches to the row height while the flex box sizes to
                         its content and keeps the border - so the row separator under column one
                         landed a pixel above the one under column two, and the hover background
                         split along the same seam. -->
                    <td class="lsum">
                      <div class="lsum-i">
                        <span class="lcar">▸</span>
                        <span style="min-width:0">
                          <b :title="r.description!==r.title ? r.description : null">{{r.title}}</b>
                        </span>
                      </div>
                    </td>
                    <td>
                      <!-- One pill PER PROVIDER - not per endpoint, or TikHub's four takes on the
                           same job repeat four identical pills. A pill is a name, a price only when
                           the price is a real number, and a ✓. THREE of them, then a +N chip: the
                           strip never wraps, so a merged row is exactly as tall as a single one.
                           The full list is one click down, on the provider sub-rows. -->
                      <div v-if="r.kind==='merged'" class="lprovs" :title="r.provTitle">
                        <span v-for="pill in r.pills" :key="pill.name" class="pchip">
                          <b>{{pill.name}}</b><span v-if="pill.price">{{pill.price}}</span><span
                              v-if="pill.verified" class="vmark">✓</span></span>
                        <span v-if="r.pillsMore" class="pchip more" :title="r.pillsMoreTitle">+{{r.pillsMore}}</span>
                      </div>
                      <span v-else class="lpath mono"><b>{{r.endpoints[0].provider_display||r.endpoints[0].provider}}</b>
                        <span class="chip" v-if="r.endpoints[0].platform_eligible===false">{{endpointAccessLabel(r.endpoints[0])}}</span><span class="cat-m">{{r.endpoints[0].method}}</span>{{r.endpoints[0].path}}<!--
                        --><span v-if="r.mgmt" class="chip lkind"
                              :title="r.endpoints[0].kind==='account' ? 'Manages the provider account itself — lists, campaigns, webhooks' : 'A helper route: token exchange, enum lookups, format cleanup'">{{r.endpoints[0].kind}}</span></span>
                    </td>
                    <td class="lprice" :title="r.priceTitle">{{r.price}}<span
                          v-if="r.priceNative" class="cost-nat">({{r.priceNative}})</span></td>
                    <td class="lver"><span v-if="r.verified" class="vmark" title="Called for real against the live API, and the response captured">✓</span></td>
                  </tr>
                  <tr v-if="platOpen[r.key]" :key="r.key+'::d'" class="cat-d">
                    <td colspan="4">
                      <!-- TWO LEVELS on a merged row: it opens to its providers, one collapsed line
                           each, and a provider opens to its own instruction. Dropping six full
                           parameter tables on one click buried the comparison the merge exists to
                           make. A single row has nothing to compare, so it skips the middle level
                           and its detail renders straight away - same block either way, so the two
                           paths can never present the instruction differently. -->
                      <div class="lgrp" v-for="e in r.endpoints" :key="e.id">
                        <button v-if="r.kind==='merged'" class="lsub" :class="{on:epOpen[e.id]}"
                                :aria-expanded="!!epOpen[e.id]" @click.stop="toggleEp(e)">
                          <span class="lcar">▸</span>
                          <span class="plogo-tile"><img class="plogo" :src="'/logos/'+e.provider+'.svg'" alt="" aria-hidden="true" @error="$event.target.style.visibility='hidden'"></span>
                          <span class="lsub-label"><b>{{e.provider_display||e.provider}}</b><span v-if="e.name" class="lsub-name">{{e.name}}</span></span>
                          <span class="chip">{{endpointAccessLabel(e)}}</span>
                          <span class="lsub-price" :title="costTitle(e.cost)">{{costShort(e.cost)}}</span>
                          <span v-if="e.verified" class="vmark" :title="'Called for real on '+e.verified">✓</span>
                          <span v-if="catEndpointConnected(e)" class="chip go" title="You have a connected account with an authorization method that can call this"><span class="godot"></span>connected</span>
                          <span class="lsub-path mono"><span class="cat-m">{{e.method}}</span>{{e.path}}</span>
                        </button>
                        <div class="lep" v-if="r.kind!=='merged' || epOpen[e.id]">
                          <div class="lep-h">
                            <!-- On a merged row the sub-row above already names the provider and the
                                 route, so the detail leads with the chips instead of repeating them. -->
                            <template v-if="r.kind!=='merged'">
                              <span class="plogo-tile"><img class="plogo" :src="'/logos/'+e.provider+'.svg'" alt="" aria-hidden="true" @error="$event.target.style.visibility='hidden'"></span>
                              <b>{{e.provider_display||e.provider}}</b>
                              <span class="mono cat-path"><span class="cat-m">{{e.method}}</span>{{e.path}}</span>
                            </template>
                          <span class="lep-chips">
                            <!-- The short form even here: the chip is a label, and "per result ·
                                 price in provider dashboard" is a sentence. It rides in the facts
                                 list below, where a sentence belongs. -->
                            <span class="chip">{{endpointAccessLabel(e)}}</span>
                            <span class="chip" :title="costTitle(e.cost)">{{costShort(e.cost)}}<span
                                  v-if="costNative(e.cost)" class="cost-nat">({{costNative(e.cost)}})</span></span>
                            <span v-if="e.verified" class="chip ver" :title="'Called for real on '+e.verified+' and the response captured'">verified {{e.verified}}</span>
                            <span v-else class="chip" title="Documented, but treg has not called it with a live key yet">unverified</span>
                            <!-- Scope is the difference between "point this at any handle" and "this
                                 only ever sees the account you connected", which changes what you
                                 can build. -->
                            <span v-if="e.scope==='own_account'" class="chip own"
                                  :title="e.id==='fishaudio.voices.list'?'Uses the connected Fish account under BYOK, otherwise this treg team\'s voices':'Reads the account YOU connect via OAuth, not arbitrary public accounts'">{{e.id==='fishaudio.voices.list'?'team or your account':'your account'}}</span>
                            <span v-else-if="e.scope==='any_account'" class="chip any"
                                  title="Reads any public account, page or query — no OAuth connection to that account needed">any account</span>
                            <span v-if="e.tier && e.tier!=='core'" class="chip">{{e.tier}}</span>
                          </span>
                        </div>
                        <p class="cat-sum">{{e.summary||'No summary in the catalog for this endpoint.'}}</p>
                        <!-- TABS. What you SEND and what comes BACK are two documents, and stacking
                             them made the expansion a page you scrolled rather than read. The bar
                             also carries the two things you want without scrolling at all: the
                             provider's docs, and the Connect button - the one action on this page
                             that unblocks every row, so it gets the strongest treatment the design
                             language has (ink fill), not a ghost button below the fold. -->
                        <div class="ltabs">
                          <button class="ltab" :class="{on:epTabOf(e)==='req'}" @click.stop="setEpTab(e,'req')">Request</button>
                          <!-- No captured response means no tab and no placeholder: a greyed-out tab
                               is a promise the catalog can't keep, and it draws the eye to the one
                               thing that isn't there. Endpoints without an example just have one
                               tab, which reads as a label for the pane under it. -->
                          <button v-if="e.has_example" class="ltab" :class="{on:epTabOf(e)==='res'}"
                                  @click.stop="setEpTab(e,'res')">Example response</button>
                          <span class="ltabs-r">
                            <a v-if="e.docs_url" class="btn sm" :href="e.docs_url" target="_blank" rel="noopener" @click.stop="catalogDocs(e)">Docs ↗</a>
                            <a v-else-if="provFact(e.provider,'pricing_url')" class="btn sm" :href="provFact(e.provider,'pricing_url')" target="_blank" rel="noopener" @click.stop="catalogDocs(e)">Pricing ↗</a>
                            <!-- Always offered: the drawer's access dry-run says how (or whether) THIS
                                 org can call it, and disables Run with the reason when it can't. -->
                            <!-- OAuth providers can't be served on treg's key (they act AS your account),
                                 so Connect is their primary CTA and Try-it is secondary. Key/token
                                 providers are the reverse: Try-it (treg's key) leads, own key is optional. -->
                            <!-- Calling costs money and needs a team, so a public visitor gets the
                                 way in rather than a button that can only 401. Everything else in
                                 the expander - parameters, limits, rate card, the copyable command
                                 - is open, and is the part worth reading before you sign up. -->
                            <button class="btn sm" :class="{primary:!mkOauth(e.provider)}" @click.stop="catalogTry(e)"
                                    :title="publicCatalog ? 'New verified accounts get $1.00 once on an eligible team, no card' : 'Call it now, or copy the agent / CLI / API way to run it'">▶ Try it</button>
                            <span v-if="catEndpointConnected(e)" class="chip go" title="You have a connected account with an authorization method that can call this"><span class="godot"></span>Connected</span>
                            <button v-else-if="mkOauth(e.provider)" class="btn sm primary" @click.stop="catalogConnect(e)"
                                    :title="endpointConnectLabel(e)+' — calls act as your account'">{{endpointConnectLabel(e)}}</button>
                            <!-- Lands on the Catalog's Platform tab focused on this provider - the
                                 whole key shelf in view, not a dead-end detail page - so the user
                                 sees where their key lives among the rest before they paste it. -->
                            <button v-else-if="mkKnown(e.provider)" class="btn sm" @click.stop="catalogByok(e.provider, e)"
                                    :title="'Register your own '+(e.provider_display||e.provider)+' key — your key wins over treg\'s and those calls are never metered'">Bring your own key</button>
                          </span>
                        </div>
                        <div v-show="epTabOf(e)==='req'">
                        <!-- What you have to SEND. The captured response answered "what comes back"
                             while this half was missing, which made every endpoint look uncallable
                             until you left for the provider's docs. Query first, then path, then
                             body: the order you fill them in for the common GET case. -->
                        <div class="prm" v-if="paramSections(e).length || (e.input && e.input.note)">
                          <div class="prm-h">Parameters</div>
                          <p class="prm-note" v-if="e.input && e.input.note">{{e.input.note}}</p>
                          <div class="prm-sec" v-for="s in paramSections(e)" :key="s.key">
                            <div class="prm-loc">{{s.label}}<span v-if="s.type" class="prm-type mono">{{s.type}}</span></div>
                            <table class="prm-t">
                              <tr><th>Name</th><th>Type</th><th>Required</th><th>Notes</th></tr>
                              <tr v-for="p in s.rows" :key="p.name">
                                <td class="prm-n mono">{{p.name}}</td>
                                <td class="prm-ty mono">{{p.type||'—'}}</td>
                                <td><span v-if="p.required" class="prm-req">required</span><span v-else class="prm-opt">optional</span></td>
                                <td class="prm-d">
                                  <span v-if="p.note">{{p.note}}</span>
                                  <span v-if="p.example!=null" class="prm-ex mono">e.g. {{fmtExample(p.example)}}</span>
                                </td>
                              </tr>
                            </table>
                          </div>
                        </div>
                        <p v-else class="prm-none">The catalog has no parameter reference for this endpoint yet — the provider's docs have them.</p>
                        <!-- The provider-wide facts an expanded row needs and a table cell can't
                             hold: how it meters, what it rate-limits, where the rate card lives. -->
                        <ul class="lfacts" v-if="epFacts(e).length"><li v-for="(f,fi) in epFacts(e)" :key="fi">{{f}}</li></ul>
                        <!-- The line that actually runs it. `treg call` proxies the key server-side,
                             so this is paste-ready with no key on the machine that runs it. -->
                        <!-- The line that actually runs it, at the bottom of the Request tab - the
                             last thing you read before you go and run it. -->
                        <div class="lcall" v-if="e.call_template">
                          <code class="mono">{{e.call_template}}</code>
                          <button class="btn sm" @click.stop="catalogCopy(e)">{{platCopied===e.id?'✓ copied':'Copy'}}</button>
                        </div>
                        <div class="lep-id mono">{{e.id}}</div>
                        </div>
                        <!-- Fetched when the tab is first opened, never with the page: a platform can
                             carry hundreds of endpoints and the captured responses are the heaviest
                             thing in the catalog. -->
                        <div class="cat-ex" v-show="epTabOf(e)==='res'">
                          <div v-if="!platEx[e.id] || platEx[e.id].loading" class="mk-quiet" style="font-size:12px">Loading the captured response…</div>
                          <div v-else-if="platEx[e.id].err" class="mk-quiet" style="font-size:12px">{{platEx[e.id].err}}</div>
                          <pre v-else class="code">{{platEx[e.id].text}}</pre>
                        </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                </template>
              </template>
            </table></div>
            <div v-else class="mk-empty" style="margin-top:14px">Nothing on this platform matches that filter — clear it, or
              <button class="lclear" @click="clearFilters">start over</button>.</div>
          </template>

</template>

<style>
/* The ledger's styles as they were in styles/base.css; they leave with this page. */
/* Platform page header: one full-width column. See the template for why it is not .tut-head. */
.plat-head{margin-bottom:4px}
.plat-title{display:flex;align-items:center;gap:13px;min-width:0}
.plat-title h1{margin:0;min-width:0}
.plat-intro{max-width:74ch}   /* its margin is .sub's, as it was in base.css */
.plat-provs{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-top:14px}
.plat-provs-l{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-right:2px}
/* What you have to SEND, one block per location. Dense on purpose: it sits inside an expanded
   table row, and a param list that needs its own scroll is a param list nobody reads. */
.prm{margin:0 0 12px;border:1px solid var(--line);border-radius:var(--rb);
  background:color-mix(in srgb,var(--panel) 55%,transparent);padding:11px 12px}
.prm-h{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:8px}
.prm-note{margin:0 0 9px;font-size:12px;color:var(--muted);line-height:1.5;max-width:82ch}
.prm-sec + .prm-sec{margin-top:11px}
.prm-loc{font-size:11.5px;font-weight:600;color:var(--ink);margin-bottom:5px}
.prm-type{margin-left:7px;font-weight:400;font-size:10.5px;color:var(--muted)}
/* The global `table` rule paints a panel, a border and a radius, and `th` a filled header bar -
   all of which fight the .prm box this already sits inside, and clip the first column against
   the table's own border. This is a bare grid; the box around it is the chrome. */
.prm-t{width:100%;border-collapse:collapse;font-size:11.5px;table-layout:fixed;
  background:none;border:0;border-radius:0}
.prm-t th{background:none;text-align:left;font-weight:500;color:var(--muted);font-size:10.5px;
  text-transform:uppercase;letter-spacing:.06em;padding:0 10px 5px 0;border-bottom:1px solid var(--line)}
.prm-t th:nth-child(1){width:23%} .prm-t th:nth-child(2){width:13%} .prm-t th:nth-child(3){width:13%}
.prm-t td{padding:6px 10px 6px 0;vertical-align:top;border-bottom:1px solid color-mix(in srgb,var(--line) 55%,transparent)}
.prm-t tr:last-child td{border-bottom:0}
.prm-n{color:var(--ink);font-weight:600;word-break:break-word}
.prm-ty{color:var(--muted)}
.prm-req{color:var(--amber);font-size:10.5px}
.prm-opt{color:var(--muted);font-size:10.5px;opacity:.75}
.prm-d{color:var(--muted);line-height:1.5}
.prm-ex{display:block;margin-top:2px;color:var(--teal);word-break:break-word}
.prm-none{margin:0 0 12px;font-size:12px;color:var(--muted);opacity:.8}
/* The path is the fact you came for, so it keeps ink colour where .ttable .th would mute it, and
   wraps rather than widening the table (some provider paths are 70+ chars). */
.cat-path{color:var(--ink);white-space:normal;word-break:break-all}
.cat-m{color:var(--teal);font-weight:600;margin-right:7px}
.cat-d td{background:var(--panel2)}
.cat-sum{margin:0 0 10px;color:var(--muted);line-height:1.5;max-width:78ch;font-size:12.5px}
.cat-ex{margin-top:10px} .cat-ex pre{max-height:340px}
/* ---- 3.7 the platform ledger ----
   ONE table per platform, filed into sticky domain sections. Two sticky layers stack under the
   57px top bar: the filter bar, then the section headings beneath it - so --lsec-top is the top
   bar plus the bar's own height. The chips wrap, so that height is measured (PlatformPage.vue);
   the default here only covers the first paint. */
:root{--lbar-top:57px;--lsec-top:137px}
.lbar{position:sticky;top:var(--lbar-top);z-index:6;background:var(--bg);
  display:flex;flex-direction:column;gap:10px;padding:12px 0 10px;margin-top:8px}
.lctl{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}
.lchips{display:flex;flex-wrap:wrap;gap:6px}
.lbar .mk-chip{padding:3px 11px;font-size:11.5px;white-space:nowrap;cursor:pointer}
.lchk{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted);
  cursor:pointer;user-select:none;white-space:nowrap}
.lfind{flex:0 1 280px;min-width:0;background:var(--surface);border:1px solid var(--line2);
  border-radius:var(--rb);color:var(--ink);font-family:var(--sans);font-size:12.5px;padding:6px 11px}
.lfind::placeholder{color:var(--muted2)}
.lstat{margin-left:auto;font-size:11.5px;color:var(--muted2);font-variant-numeric:tabular-nums;white-space:nowrap}
.lclear{background:none;border:0;padding:0 0 0 6px;color:var(--muted);font:inherit;cursor:pointer;
  text-decoration:underline;text-underline-offset:2px}
.lclear:hover{color:var(--ink)}
/* Both the wrapper and the table drop their overflow clip: an `overflow:hidden` ancestor is a
   scroll container, and a sticky heading inside one never leaves it. */
.lwrap{overflow:visible;border-radius:var(--r)}
/* Fixed layout, so a nowrap path or `treg call` line inside an expanded row scrolls INSIDE its
   cell instead of widening the table past the page. */
.ledger{overflow:visible;table-layout:fixed}
/* The wrapper draws the one rounded frame. A collapsed table cannot round its own border, so a
   second one on the table showed as a square frame inside the rounded one; and with nothing
   clipping (the sticky headings need that), the last row's cells round their own corners so a
   hover fill cannot square them off. */
.lwrap .ledger{border:0;border-radius:0;background:none}
.ledger tr:last-child td:first-child{border-bottom-left-radius:var(--r)}
.ledger tr:last-child td:last-child{border-bottom-right-radius:var(--r)}
.ledger th{padding:9px 12px 7px;font-size:10px;text-transform:uppercase;letter-spacing:.06em;
  white-space:nowrap;color:var(--muted2)}
.lth-w{width:33%} .lth-p{width:220px} .lth-v{width:72px;text-align:center}
.ledger td.lver{text-align:center}
.ledger td{padding:8px 12px;font-size:12.5px;vertical-align:top;border-bottom:1px solid var(--line)}
.ledger tr:last-child td{border-bottom:0}
.lsec td{position:sticky;top:var(--lsec-top);z-index:4;background:var(--panel2);padding:6px 12px;
  font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:var(--muted)}
.lsec td span{margin-left:7px;font-weight:450;letter-spacing:0;color:var(--muted2)}
.lrow{cursor:pointer}
.lrow:hover td{background:var(--hover)}
/* The management-endpoints expander at the foot of a section - the same muted "show more" gesture
   as the platform-tile .pt-more, keeping account/utility plumbing one click out of the browse view. */
/* The one collapsed section at the foot of the ledger. Its heading is a button, so it reads as a
   section that opens rather than a row that does something. */
.lsec-btn{display:inline-flex;align-items:center;gap:7px;padding:0;border:0;background:none;
  font:inherit;color:inherit;letter-spacing:inherit;text-transform:inherit;cursor:pointer}
.lsec-btn:hover{color:var(--ink)}
.lsec-btn .lcar{transition:transform .12s}
.lsec-btn[aria-expanded="true"] .lcar{transform:rotate(90deg)}
/* Same rule down the leading edge the capability list used: the row you can call today is the
   reason to read the table, so it is findable without reading. */
.lrow.go td:first-child{box-shadow:inset 3px 0 0 color-mix(in srgb,var(--green) 75%,transparent)}
.lsum-i{display:flex;align-items:flex-start;gap:7px;max-width:430px}
.lsum b{font-weight:500;color:var(--ink);line-height:1.45}
/* DataForSEO's summaries are paragraphs. Two lines keeps the ledger scannable; the full text is
   one click away, in the expansion. */
.lsum b{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.lcar{flex:0 0 auto;display:inline-block;font-size:10px;line-height:1.8;color:var(--muted);
  transition:transform .15s var(--ease)}
.lrow.open .lcar{transform:rotate(90deg)}
.lrow:hover .lcar,.lrow.open .lcar{color:var(--ink)}
/* A merged row's providers, priced side by side - the comparison the merge exists to make. Short
   pills only (see `pillPrice`), so a six-provider row costs a second line at worst. */
/* Wraps rather than clips: a clipped strip cut the third pill in half and hid the +N chip. */
.lprovs{display:flex;flex-wrap:wrap;gap:4px}
.pchip.more{color:var(--muted2)}
.pchip{display:inline-flex;align-items:center;gap:5px;background:var(--panel2);border-radius:7px;
  padding:2px 8px;font-size:11px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.pchip b{color:var(--ink);font-weight:500}
.lpath{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:11px;line-height:18px;color:var(--muted)}
/* The access chip rides the text line, so it must not make its row taller than a plain one. */
.lpath .chip{margin-right:8px;padding:0 8px;line-height:16px;font-family:var(--sans)}
.lpath b{margin-right:7px;font-family:var(--sans);font-weight:500;color:var(--ink)}
/* What KIND of plumbing an Actions row is - account (the provider's own records) or utility
   (a helper). Only ever rendered inside the Actions section, where the distinction is the only
   thing separating one row from the next. */
.lkind{margin-left:8px;font-family:var(--sans);vertical-align:1px}
.lprice{font-family:var(--mono);font-size:11.5px;color:var(--muted);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.vmark{color:var(--green);font-weight:600}
/* Phone width: the shell turns every table into a horizontal scroller, but the ledger's overflow
   stays visible for its sticky headings, so it pushed the whole page sideways instead. Here each
   row stacks (title, then route, price and mark on one line), and nothing sticks: a wrapped chip
   bar pinned to the top would cover half the screen. */
@media(max-width:760px){
  .lbar{position:static}
  .ledger{display:block;white-space:normal}
  .ledger thead{display:none}
  .ledger tbody{display:block}
  .ledger tr{display:grid;grid-template-columns:minmax(0,1fr) auto auto;border-bottom:1px solid var(--line)}
  .ledger tr:last-child{border-bottom:0}
  .ledger td,.ledger tr:last-child td{border-bottom:0;border-radius:0}
  .ledger tr.lrow td:first-child,.lsec td,.cat-d td{grid-column:1/-1}
  /* A merged row's provider chips take their own line, and its price the next: side by side, the
     price column took its full nowrap width and the chips spilled over it. */
  .ledger tr.lrow.merged td:nth-child(2){grid-column:1/-1}
  .ledger tr.lrow td:not(:first-child){padding-top:0}
  .lsec td{position:static}
  .lsum-i{max-width:none}
}
/* The expansion: one block per endpoint - a merged row shows its providers stacked, a single row
   shows the same block alone, so the two can never present the instruction differently. */
/* Level two: one collapsed line per provider, and the detail under whichever one is opened. */
.lgrp + .lgrp{margin-top:4px}
.lsub{display:flex;align-items:center;gap:8px;width:100%;padding:6px 9px;
  background:var(--surface);border:1px solid var(--line2);border-radius:var(--rb);
  color:var(--ink);font-family:inherit;font-size:12px;text-align:left;cursor:pointer;
  transition:border-color .2s var(--ease),background-color .2s var(--ease)}
.lsub:hover{background:var(--hover)}
.lsub.on{border-color:var(--line2);background:var(--hover)}
.lsub.on .lcar{transform:rotate(90deg)}
.lsub b{font-weight:500;white-space:nowrap}
.lsub-label{min-width:0;text-align:left}
.lsub-name{display:block;font-size:12px;white-space:normal;overflow-wrap:anywhere}
.lsub-price{font-family:var(--mono);font-size:11px;color:var(--muted);white-space:nowrap;
  font-variant-numeric:tabular-nums}
.lsub-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  text-align:right;font-size:11px;color:var(--muted2)}
.lsub .plogo-tile{width:20px;height:20px;flex:0 0 20px;border-radius:6px}
.lsub .plogo{width:13px;height:13px}
.lsub .chip.go{font-size:9.5px;padding:1px 7px}
.lgrp .lep{padding:12px 9px 2px}
/* The detail's tab bar: two panes on the left, and on the right the two things you should never
   have to scroll for - the provider's docs and the Connect button. */
.ltabs{display:flex;align-items:center;gap:4px;margin:0 0 11px;
  border-bottom:1px solid var(--line2);padding-bottom:7px}
.ltab{background:none;border:0;border-radius:var(--rb);padding:5px 11px;
  font-family:inherit;font-size:12px;font-weight:450;color:var(--muted);cursor:pointer;
  transition:background-color .2s var(--ease),color .2s var(--ease)}
.ltab:hover:not(:disabled){background:var(--hover);color:var(--ink)}
.ltab.on{background:var(--inverse);color:var(--inverse-ink);font-weight:500}
.ltab:disabled{color:var(--muted2);opacity:.55;cursor:default}
.ltabs-r{margin-left:auto;display:flex;align-items:center;gap:7px;flex:0 0 auto}
/* Connect is the one action that unblocks every row on the page, so it wears the strongest
   treatment the design language has - the same ink fill as the active tab. */
.ltabs-r .btn.primary{background:var(--inverse);color:var(--inverse-ink);border-color:var(--inverse)}
.lep-id{margin-top:8px;font-size:10.5px;color:var(--muted2)}
.lep + .lep{margin-top:15px;padding-top:15px;border-top:1px solid var(--line2)}
.lep-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:9px}
.lep-h b{font-size:12.5px;font-weight:500}
.lep-chips{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.lfacts{margin:0 0 11px;padding-left:17px;max-width:82ch;font-size:11.5px;line-height:1.6;color:var(--muted)}
/* A DataForSEO body can carry thirty parameters. Capped and scrolled, the expansion stays a card
   you read; uncapped it becomes a page that pushes every row below it off the screen. The captured
   response gets the SAME cap, so the two panes are the same size box. */
.prm{max-height:320px;overflow-y:auto}
.cat-ex pre{max-height:320px}
/* The line that actually runs it - `treg call` proxies the key server-side, so it is paste-ready
   on a machine that holds no credential. */
.lcall{display:flex;align-items:center;gap:9px;margin:0 0 11px;padding:7px 9px;
  background:var(--surface);border:1px solid var(--line2);border-radius:var(--rb)}
.lcall code{flex:1;min-width:0;overflow-x:auto;white-space:nowrap;font-size:11.5px;color:var(--ink)}</style>
