// ---- the catalog-v2 experiment ----
// A platform page is either the shelf (a comparison per capability, the tool drawer) or, for the
// control arm, the ledger it replaced (LegacyPlatformPage.vue). The PostHog multivariate flag
// `catalog-v2` (control | test) deals the arm, per person, on the first platform page of a load;
// posthog-js records the exposure on that read. Every catalog action is one event set in both arms,
// so the arms compare on the same numbers.
//
// `catalogArm`: '' not dealt yet, 'pending' waiting on the flag, 'control' | 'test' in the
// experiment, 'direct' landed on a comparison page (only v2 has them, so outside the experiment),
// 'off' no flag answer (analytics off, blocked, experiment not running, or too slow): the shelf.
export const CATALOG_FLAG = 'catalog-v2'
const FLAG_WAIT_MS = 1000

export default {
  catalogEnroll(cap){
    if(this.catalogArm && this.catalogArm!=='pending') return Promise.resolve()
    if(this.elements.catalogDealt) return this.elements.catalogDealt
    if(cap){ this.catalogSetArm('direct'); return Promise.resolve() }
    const ph=window.posthog
    if(!ph || !ph.onFeatureFlags){ this.catalogSetArm('off'); return Promise.resolve() }
    this.catalogArm='pending'
    this.elements.catalogDealt=new Promise(resolve=>{
      const deal=read=>{
        if(this.catalogArm!=='pending') return
        // Read the flag only while the page still waits on it: a read is an exposure, and a
        // visitor already shown the shelf must not be counted in either arm.
        let v=null; if(read){ try{ v=ph.getFeatureFlag(CATALOG_FLAG) }catch(e){} }
        this.catalogSetArm(v==='control' || v==='test' ? v : 'off')
        this.elements.catalogDealt=null; resolve()
      }
      try{ ph.onFeatureFlags(()=>deal(true)) }catch(e){ deal(false) }
      setTimeout(()=>deal(false), FLAG_WAIT_MS)
    })
    return this.elements.catalogDealt
  },
  catalogSetArm(arm){
    this.catalogArm=arm
    try{ window.posthog?.register?.({catalog_arm:arm}) }catch(e){}
  },

  // Where a catalog action happened: the ledger (control), the shelf or a comparison (v2), a provider's
  // page, or the Catalog index. null elsewhere, so a Try-it from the team pages is not counted.
  catalogSurface(){
    if(this.view==='platform') return this.catalogLegacy ? 'ledger' : this.platCap ? 'comparison' : 'shelf'
    if(this.view==='provider') return 'provider'
    if(this.view==='connections') return 'catalog'
    return null
  },
  catalogTrack(name, props){
    const surface=this.catalogSurface(); if(!surface) return
    this.track(name, {surface, arm:this.catalogArm||'off', platform:this.view==='platform' ? this.platSlug : undefined,
      signed_in:!!this.authed, ...props})
  },
  catalogToolEvent(name, e, props){
    this.catalogTrack(name, {endpoint:e.id, provider:e.provider, capability:e.capability||undefined, ...props})
  },

  // The actions that say "I found what I came for": the primary metric is any `catalog_action`.
  // A signed-out visitor's Try it and Connect lead to sign-in; they count, with `signed_in:false`.
  catalogTry(e){
    this.catalogToolEvent('catalog_action', e, {action:'try'})
    if(this.publicCatalog) this.openSignin(); else this.openEpTry(e)
  },
  catalogConnect(e){
    this.catalogToolEvent('catalog_action', e, {action:'connect'})
    if(this.publicCatalog) this.openSignin(); else this.openProvider(e.provider)
  },
  catalogByok(service, e){
    this.catalogTrack('catalog_action', {action:'byok', provider:service||undefined, endpoint:e ? e.id : undefined})
    if(this.publicCatalog) this.openSignin(); else this.goByok(service)
  },
  catalogCopy(e){
    this.catalogToolEvent('catalog_action', e, {action:'copy'})
    this.copyCall(e)
  },
  catalogDocs(e){ this.catalogToolEvent('catalog_action', e, {action:'docs'}) },
}
