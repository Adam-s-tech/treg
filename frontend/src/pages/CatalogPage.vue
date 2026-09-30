<script>
import { useDashboard } from '../state/context'
import FindAnswer from '../components/FindAnswer.vue'
import CatalogSearch from '../components/CatalogSearch.vue'

// The catalog index: every platform, by category. It answers what an agent can call; whose
// credential it calls with is the Connections page's question. The look is the platform shelf's.
export default { components: { FindAnswer, CatalogSearch }, setup: useDashboard }
</script>

<template>
<div class="pl cat">
  <header class="pl-hero">
    <p class="pl-eyebrow"><template v-if="plats.list.length">{{plats.list.length}} platforms<template v-if="toolCountText"> · {{toolCountText}} tools</template></template><template v-else>&nbsp;</template></p>
    <div class="cat-hero-r">
      <h1>Tools for agents</h1>
      <div class="cat-acts">
        <button class="pl-btn sm ghost" @click="openToolRequest()" title="Missing a tool or provider? Tell us. Requests steer what gets added next">Request a tool</button>
        <button class="pl-btn sm ghost" @click="vendorAsk=true" title="Sell an API? Get it listed in this catalog">List as vendor</button>
        <!-- The one header action a paying visitor is looking for: where do I put MY key. -->
        <button class="pl-btn sm" @click="publicCatalog ? openSignin() : goByok()" title="Register your own provider key. Your key wins over treg's and those calls are never metered">Bring your own key</button>
      </div>
    </div>
    <p class="pl-lede">Every platform an agent can read from or act on. Most tools run on treg's key and are priced per
      call; connect your own account or key and treg uses yours instead, unmetered.</p>
    <!-- One box, two questions: a platform name filters the shelves as you type, and the finder
         answers whatever is typed once typing pauses, or at once on Enter (state/find.js).
         Clearing the box is how you leave an answer. -->
    <CatalogSearch v-if="plats.list.length" v-model="q" placeholder="Search a platform, or describe what your agent needs to do" />
  </header>

  <!-- A described job is answered above the shelves rather than instead of them: the shelves
       stay, lit where the answer landed. -->
  <FindAnswer v-if="findActive && !find.scope" class="pl-find" />

  <div class="mk-tabs-wrap" v-if="plats.list.length">
    <div class="mk-tabs" role="tablist" aria-label="Catalog categories">
      <button v-for="t in mkTabs" :key="t.key" role="tab" :aria-selected="mkTab===t.key"
              :class="{on:mkTab===t.key}" @click="mkTab=t.key">{{t.label}} <span>{{t.n}}</span></button>
    </div>
  </div>

  <section class="pl-sec" v-for="g in platCatGroups" :key="g.category">
    <h2 class="pl-h"><span>{{g.category}}</span><i></i><em>{{g.total}}</em></h2>
    <p v-if="g.hint" class="cat-hint">{{g.hint}}</p>
    <div class="pl-grid pl-grid-t">
      <!-- A card is a NAME and two facts: a description made every card tall enough that a shelf of
           twelve became a scroll. The summary survives as the hover title. -->
      <button v-for="pl in g.items" :key="pl.slug" class="pl-card pl-tool cat-card"
              :class="{'find-hit':findHits[pl.slug], 'find-dim':find.phase==='done' && findGroups.length && !findHits[pl.slug]}"
              :title="pl.summary ? pl.label+': '+pl.summary : pl.label"
              :aria-label="'Open '+pl.label" @click="openPlatform(pl.slug)">
        <span v-if="findHits[pl.slug]" class="pt-find">{{findHits[pl.slug]}} match{{findHits[pl.slug]===1?'':'es'}}</span>
        <!-- A platform's OWN mark, not its providers': the card is the platform. Anything we haven't
             drawn falls back to a generated initial tile, not a broken image. -->
        <span class="pl-logo lg" :class="{gen:platLogoBad[pl.slug]}"
              :style="platLogoBad[pl.slug] ? {background:platTileBg(pl.slug)} : null">
          <img v-if="!platLogoBad[pl.slug]" :src="'/logos/platforms/'+pl.slug+'.svg'" alt=""
               aria-hidden="true" @error="platLogoBad[pl.slug]=true">
          <span v-else class="pt-i">{{platInitial(pl)}}</span>
        </span>
        <span class="pl-tool-b">
          <span class="cat-name"><b>{{platShort(pl.label)}}</b>
            <!-- Connection state is a MEMBER fact, and only the positive one earns a mark: "not
                 connected" on every other tile was a wall of red herrings. -->
            <span v-if="!publicCatalog && platConnected(pl)" class="cn-st" :title="'You have a connected account for '+platConnNames(pl)">
              <i aria-hidden="true"></i>Connected</span></span>
          <span class="pl-meta">{{pl.endpoints}} tool{{pl.endpoints===1?'':'s'}}<template v-if="platPrice(pl)"> · <span :title="platPriceTitle(pl)">{{platPrice(pl).free ? platPrice(pl).text : 'from '+platPrice(pl).text}}</span></template></span>
        </span>
      </button>
    </div>
    <!-- The tail of a long shelf, as one row: a stack of the marks plus two names, so it reads as
         "there is more of this kind here" rather than as a bare count. -->
    <button v-if="g.rest.length" class="pt-more" @click="platShelfOpen[g.category]=true"
            :aria-label="'Show the other '+g.rest.length+' '+g.category+' platforms'">
      <span class="pt-stack">
        <span v-for="pl in g.rest.slice(0,7)" :key="pl.slug" class="pt-mini" :title="pl.label"
              :class="{gen:platLogoBad[pl.slug]}"
              :style="platLogoBad[pl.slug] ? {background:platTileBg(pl.slug)} : null">
          <img v-if="!platLogoBad[pl.slug]" :src="'/logos/platforms/'+pl.slug+'.svg'" alt=""
               aria-hidden="true" @error="platLogoBad[pl.slug]=true">
          <span v-else class="pt-i">{{platInitial(pl)}}</span>
        </span>
      </span>
      <span class="pt-more-t">{{moreLabel(g.rest)}}</span>
      <span class="pt-more-a" aria-hidden="true">→</span>
    </button>
  </section>

  <!-- A query that names no platform is usually a JOB, not a typo: say what missed and offer the
       finder, instead of implying the server has no catalog. -->
  <p v-if="!platCatGroups.length && platNameQuery && plats.list.length && !findSoon" class="find-miss">No platform is called that.</p>
  <p v-else-if="plats.settled && !plats.list.length" class="pl-empty">This server has no catalog yet.
    <button v-if="!publicCatalog" class="pl-link" @click="go('connections')">Connect your own accounts</button></p>
</div>
</template>
