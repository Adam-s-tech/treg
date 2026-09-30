<script>
import { useDashboard } from '../state/context'
import ProviderLogo from '../components/ProviderLogo.vue'
import ConnectionCard from '../components/ConnectionCard.vue'

// Every account and key the team holds, then every provider one can be added for. The catalog says
// what an agent can call; this page says whose credential it calls with. A provider key saved as a
// secret named for the provider is listed here too, since the credential ladder treats it the same.
export default {
  components: { ProviderLogo, ConnectionCard },
  setup: useDashboard,
  watch: {
    // "Bring your own key" for one provider can arrive before the provider list has: scroll once it has.
    providerGroups() { this.focusProvider() },
  },
  mounted() { this.focusProvider() },
  methods: {
    focusProvider() {
      if (!this.byokFocus) return
      this.$nextTick(() => document.getElementById('prov-'+this.byokFocus)?.scrollIntoView({block:'center', behavior:'smooth'}))
    },
  },
}
</script>

<template>
<div class="pl cn">
  <header class="pl-hero">
    <p class="pl-eyebrow">{{connAccounts.length + namedKeys.length}} connected<template v-if="connAttention"> · {{connAttention}} need{{connAttention===1?'s':''}} you</template> · {{connectable.length}} providers</p>
    <h1>Connections</h1>
    <p class="pl-lede">Your own accounts and API keys. treg keeps each one server-side and adds it to every call your
      agents make to that provider. Your key always wins over treg's, and those calls are never metered.</p>
  </header>

  <div v-if="connErr" class="banner cn-banner"><span>{{connErr}}</span><button class="btn sm ico" @click="connErr=''" aria-label="Dismiss">✕</button></div>

  <section v-if="connAccounts.length || namedKeys.length" class="pl-sec">
    <h2 class="pl-h"><span>Connected</span><i></i><em>{{connAccounts.length + namedKeys.length}}</em></h2>
    <div class="pl-grid pl-grid-t">
      <ConnectionCard v-for="a in connAccounts" :key="a.c.id" :a="a" manage />
      <div v-for="k in namedKeys" :key="'s'+k.s.id" class="pl-card cn-card" :class="k.shadowed ? 'cn-quiet' : 'cn-ok'">
        <div class="cn-top">
          <ProviderLogo :service="k.p.service" large />
          <span class="cn-id"><b>{{k.p.display_name}}</b><span class="pl-meta">{{k.s.name}}</span></span>
          <span class="cn-st" :title="k.shadowed ? 'The connected '+k.p.display_name+' credential is used instead' : 'Saved. It is checked on its first call.'">
            <i aria-hidden="true"></i>{{k.shadowed ? 'Not in use' : 'Saved'}}</span>
        </div>
        <p class="cn-what">{{authLabel(k.p)}}, saved as a secret<template v-if="k.shadowed">. The connected account above is used instead</template><template v-if="k.s.owner"> · added by {{short(k.s.owner)}}</template></p>
        <div class="cn-acts">
          <button v-if="!k.shadowed" class="pl-btn sm ghost" :disabled="connBusy" @click="startConnect(k.p)"
                  title="Check the key against the provider and connect it like any other">Verify and connect</button>
          <span class="cn-links">
            <button class="cn-del" :class="{armed:confirmDelSecret===k.s.id}" @click="deleteSecret(k.s)">
              {{confirmDelSecret===k.s.id ? 'Click again to remove' : 'Remove'}}</button>
          </span>
        </div>
      </div>
    </div>
  </section>

  <section class="pl-sec">
    <h2 class="pl-h"><span>Add a connection</span><i></i><em>{{connectable.length}}</em></h2>
    <div class="cn-filters">
      <div class="cat-find cn-find">
        <svg class="cat-find-i" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input v-model="connQ" aria-label="Filter providers" placeholder="Filter providers, e.g. Apollo, Google Ads, video">
        <button v-if="connQ" class="cat-find-x" type="button" aria-label="Clear the filter" @click="connQ=''">×</button>
      </div>
      <!-- Logging in with an account you already have and pasting a key are different errands:
           someone holding a Google Ads login is not scanning for API-key vendors. -->
      <div class="cn-kinds" role="radiogroup" aria-label="How you connect">
        <button v-for="k in connKinds" :key="k.key" role="radio" :aria-checked="connKind===k.key"
                :class="{on:connKind===k.key}" :title="k.hint" @click="connKind=k.key">{{k.label}} <span>{{k.n}}</span></button>
      </div>
    </div>
    <div v-for="g in providerGroups" :key="g.category" class="cn-group">
      <h3 class="pl-h pl-h-quiet"><span>{{g.category}}</span><i></i><em>{{g.items.length}}</em></h3>
      <div class="pl-grid pl-grid-t">
        <!-- One line per provider: someone here is looking for an account they already hold, by name.
             The card opens the provider's page (its permissions, its tools); the button connects from here. -->
        <div v-for="p in g.items" :key="p.service" :id="'prov-'+p.service" class="pl-card pl-tool cn-prov" :class="{focus:byokFocus===p.service}"
             role="button" tabindex="0" :aria-label="'Open '+p.display_name" :title="p.summary"
             @click="openProvider(p.service)" @keydown.enter.self="openProvider(p.service)">
          <ProviderLogo :service="p.service" large />
          <span class="pl-tool-b"><b>{{p.display_name}}</b>
            <span class="pl-meta">{{authLabel(p)}}<template v-if="connCount[p.service]"> · {{connCount[p.service]}} connected</template></span></span>
          <span class="cn-prov-a" @click.stop>
            <button class="pl-btn sm ghost" :disabled="connBusy"
                    @click="startConnect(p)" :title="pastedCredential(p) ? 'Paste your own '+p.display_name+' key; treg keeps it server-side' : 'Log in to '+p.display_name+' and approve access'">
              {{pastedCredential(p) ? (connCount[p.service] ? 'Replace key' : 'Add key') : (connCount[p.service] ? 'Add account' : 'Connect account')}}</button>
          </span>
        </div>
      </div>
    </div>
    <p v-if="connQ && !providerGroups.length" class="pl-empty">No provider matches “{{connQ.trim()}}”.
      <button class="pl-link" @click="openToolRequest()">Ask for it</button></p>
    <p v-else-if="!providers.length" class="pl-empty">Loading providers…</p>
  </section>

  <footer class="cn-foot">
    <p>From a terminal, <span class="mono">treg secret add apollo …</span> saves a key under its provider's name, and it
      shows up here. Keys your own tools use live under <a href="#secrets" @click.prevent="go('secrets')">Your own tools → Secrets</a>.</p>
  </footer>
</div>
</template>
