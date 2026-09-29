<script>
import { useDashboard } from '../state/context'
import ProviderLogo from './ProviderLogo.vue'

// One connected account or key, on Connections and on its provider's page. The status says whether
// an agent can call it now; when it cannot, the one step that fixes it sits on the card itself.
export default {
  components: { ProviderLogo },
  props: {
    a: { type: Object, required: true },        // a connAccounts row: {c, p, name, st}
    manage: { type: Boolean, default: false },  // link to the provider's page (Connections only)
  },
  setup: useDashboard,
  data: () => ({ fixOpen: false }),  // the second-credential form, opened from its button
}
</script>

<template>
<div class="pl-card cn-card" :class="'cn-'+a.st.tone">
  <div class="cn-top">
    <ProviderLogo :service="a.c.provider" large />
    <span class="cn-id">
      <b>{{manage ? a.name : (a.c.resource_name || a.name)}}</b>
      <!-- The tool name is what an agent calls: several accounts of one provider each get their own.
           Only worth a line once it says more than the provider's own id. -->
      <span v-if="a.c.name!==a.c.provider" class="pl-meta" :title="'treg call '+a.c.name">{{a.c.name}}</span>
    </span>
    <span class="cn-st" :title="a.st.title"><i aria-hidden="true"></i>{{a.st.label}}</span>
  </div>

  <p class="cn-what">
    <template v-if="manage && (a.c.resource_name || a.c.resource_ref)">{{a.c.resource_name || a.c.resource_ref}} · </template>
    <template v-if="pastedCredential(a.p)">{{authLabel(a.p)}}</template>
    <template v-else>{{(a.c.capabilities||[]).map(cap=>capLabel(cap, a.p ? {provider:a.p, conn:a.c} : null)).join(', ') || 'Connected account'}}</template>
    <template v-if="a.c.owner"> · added by {{short(a.c.owner)}}</template>
  </p>

  <div v-if="a.st.key==='second' && fixOpen" class="cn-fix">
    <p>{{a.c.extra_credential_note}}</p>
    <div class="cn-fix-r">
      <input class="bindinput" type="password" :placeholder="a.c.extra_credential_label||'Second credential'"
             :aria-label="a.c.extra_credential_label||'Second credential'"
             v-model="extraCred[a.c.id]" @keyup.enter="saveExtraCred(a.c)"/>
      <button class="pl-btn sm" :disabled="!extraCred[a.c.id] || extraBusy===a.c.id" @click="saveExtraCred(a.c)">
        {{extraBusy===a.c.id?'Saving…':'Save'}}</button>
      <button class="pl-btn sm ghost" @click="fixOpen=false">Cancel</button>
    </div>
  </div>

  <div v-if="!(a.st.key==='second' && fixOpen)" class="cn-acts">
    <button v-if="a.st.key==='second'" class="pl-btn sm" @click="fixOpen=true">Add {{(a.c.extra_credential_label||'second credential').toLowerCase()}}</button>
    <button v-if="a.st.key==='reconnect' || a.st.key==='failing'" class="pl-btn sm" :disabled="connBusy"
            @click="pastedCredential(a.p) ? startConnect(a.p, a.c) : reconnect(a.c)">
      {{pastedCredential(a.p) ? 'Replace key' : 'Reconnect'}}</button>
    <button v-else-if="a.st.key==='choose' || (!manage && a.c.supports_discovery)" class="pl-btn sm" :class="{ghost:a.st.key!=='choose'}"
            @click="openResources(a.c)">Choose {{a.c.resource_label||'account'}}</button>
    <button v-if="!manage && (a.c.missing_capabilities||[]).length && a.p" class="pl-btn sm ghost" :disabled="connBusy"
            @click="startConnect(a.p, a.c)" :title="'Ask for '+a.c.missing_capabilities.join(', ')+' as well'">
      Add {{a.c.missing_capabilities.map(cap=>capLabel(cap, {provider:a.p, conn:a.c})).join(' + ')}}</button>
    <span class="cn-links">
      <a v-if="manage" :href="'/app/marketplace/'+encodeURIComponent(a.c.provider)" @click.prevent="openProvider(a.c.provider)">Manage</a>
      <template v-else>
        <button @click="renameConnection(a.c)" title="Change the tool name an agent calls for this account">Rename</button>
        <button v-if="a.st.key!=='reconnect' && a.st.key!=='failing' && a.p" :disabled="connBusy"
                @click="pastedCredential(a.p) ? startConnect(a.p, a.c) : reconnect(a.c)">{{pastedCredential(a.p) ? 'Replace key' : 'Reconnect'}}</button>
      </template>
      <button class="cn-del" :class="{armed:confirmDisc===a.c.id}" @click="disconnect(a.c)">
        {{confirmDisc===a.c.id ? 'Click again to remove' : (pastedCredential(a.p) ? 'Remove' : 'Disconnect')}}</button>
    </span>
  </div>
</div>
</template>
