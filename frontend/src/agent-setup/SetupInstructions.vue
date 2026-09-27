<script lang="ts">
import { defineComponent, type PropType } from 'vue'
import { iconUrl, setupText, hideBrokenImage, type Agent, type IconUrl } from './data'

export default defineComponent({
  props: {
    agent: { type: Object as PropType<Agent>, required: true },
    icon: { type: Function as PropType<IconUrl>, default: iconUrl },
    command: { type: String, required: true },
    team: String, token: String, showToken: Boolean, copied: Boolean, copyDisabled: Boolean,
  },
  emits: ['copy', 'toggle-token', 'plugin'],
  computed: {
    full() { return setupText(this.command, this.team, this.token) },
    masked() { return setupText(this.command, this.team, this.token, !this.showToken) },
  },
  methods: { hideBrokenImage },
})
</script>

<template>
<div class="agent-setup-instructions">
  <p class="sub" style="display:flex;align-items:center;gap:8px;margin:0 0 16px"><img v-if="agent.icon" :src="icon(agent.icon)" alt="" style="width:18px;height:18px" @error="hideBrokenImage">Setting up treg for <b style="color:var(--ink)">{{agent.name}}</b></p>
  <template v-if="agent.plugin"><h2 style="margin:0 0 10px;font-size:19px">1. Install the treg plugin</h2><a class="btn" :href="agent.plugin" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;margin-bottom:18px" @click="$emit('plugin')"><img :src="icon(agent.icon)" alt="" style="width:16px;height:16px">Install plugin in {{agent.name}} ↗</a></template>
  <h2 style="margin:0 0 14px;font-size:19px">{{agent.plugin ? "2. In your Bot's chat, send:" : "In your agent's chat, send:"}}</h2>
  <div class="lc-codewrap"><button class="lc-cp" type="button" :disabled="copyDisabled" @click="$emit('copy',full)">{{copied?'✓ copied':'Copy'}}</button><pre style="white-space:pre-wrap;overflow-wrap:anywhere">{{masked}}</pre></div>
  <button v-if="token" class="text-button" type="button" style="font-size:12px;margin-top:6px" @click="$emit('toggle-token')">{{showToken?'Hide':'Show'}} key</button>
  <p class="sub" style="font-size:12px;margin:12px 0 0">{{team&&token ? (agent.plugin?'Your Bot reads that file and signs in with your team & token \u2014 then it can call every tool in the catalog.':'Your agent reads that file and signs in with your team & token \u2014 it installs the CLI and starts calling tools.') : 'Your agent reads that file, installs the CLI and guides you through signing in.'}}</p>
</div>
</template>
