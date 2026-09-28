import { isJobQuery } from './find.js'

// What each comparison column means, on hover or focus of its heading (jobColumns).
const COL_TIPS = {
  takes:'What you can send it. Each tag is one input it accepts; — means the catalog has not mapped it yet.',
  price:"What one call costs on treg's key, in the provider's own unit: per call, per result or per success. With your own key the provider bills you, and treg adds nothing.",
  works:'Share of the last 30 days of calls that ended without a provider error. Shown once there are 20 or more.',
  useful:"Share of teams whose agents found the result useful after using it, one vote per team, last 90 days. Shown once 5 teams have rated it; compare it within this table only.",
}

export default {
// The catalog-v2 control arm (state/catalogExperiment.js): the ledger, and no job pages anywhere.
    catalogLegacy(){ return this.catalogArm==='control'; },
mkProvider(){ return this.providers.find(p=>p.service===this.mkService)||null; },
mkConns(){ return this.connections.filter(c=>c.provider===this.mkService); },
mkNeedsCred(){ return this.mkConns.filter(c=>c.extra_credential_note); },
// Which capabilities ANY account here already holds — a page-level "you have this" summary,
    // since the permission list describes the integration, not one account.
    mkGranted(){ const s=new Set(); for(const c of this.mkConns) for(const cap of (c.capabilities||[])) s.add(cap); return s; },
// ---- endpoint catalog ----
    // Platform tiles grouped by the category the catalog assigns each platform. "Other" (the
    // taxonomy's bucket for things like `account`) gets no tile — those capabilities are only
    // meaningful inside a platform page, not as a destination of their own.
    // The canonical reading order. It is only an ORDER, not the list: the categories themselves come
    // from the data, so a category the catalog invents tomorrow still gets a shelf and a tab (sorted
    // to the end) instead of vanishing. A hint is optional for the same reason.
    platCategories(){
      // The founder's reading order. The answer engines (ChatGPT, Perplexity, Gemini…) used to be
      // their own shelf; they are SEO now, unfeatured, so they surface inside its "see more" row
      // rather than as a category of six. The list is a lookup, not a schema — a category the
      // catalog invents tomorrow still gets a shelf, sorted to the end.
      const order=['Enrichment','SEO/AEO','Social','Advertising','E-commerce','Reviews & Apps','AI generation','Community'];
      const hints={
        'AI generation':'video, image and voice models, the same model over several routes priced side by side',
        'SEO/AEO':'rankings, keywords and backlinks — what search engines know, and what the answer engines say',
        'Social':'posts, profiles and comments, straight from the feeds',
        'Enrichment':'people and company records, resolved from an email or a domain',
        'Advertising':'ad libraries and creator marketplaces — what is being promoted, and for how much',
        'E-commerce':'listings, prices and sellers across the marketplaces',
        'Reviews & Apps':'app stores and review sites — what people rate, and what they say',
        'Community':'forums and chat, where people answer each other',
      };
      const by={};
      for(const pl of this.plats.list){ const c=pl.category||'Other'; if(c==='Other') continue; (by[c]=by[c]||[]).push(pl); }
      const known=order.filter(c=>by[c]);
      const rest=Object.keys(by).filter(c=>!order.includes(c)).sort();
      return known.concat(rest).map(c=>({category:c, hint:hints[c]||'', items:by[c]}));
    },
// The catalog's size as a headline ("3,300+"), from the platform shelves already loaded: rounded
    // down to the hundred so it never overstates, and empty until the list arrives so no stale
    // number is ever shown.
    toolCountText(){
      const n=this.plats.list.reduce((a,p)=>a+(p.endpoints||0),0);
      return n>=100 ? (Math.floor(n/100)*100).toLocaleString('en-US')+'+' : '';
    },
// The platform-name filter the Catalog search box applies, lowercased; '' for none. A sentence is
    // a job, not a name (the finder answers it), and a find answer lights shelves instead of
    // filtering them, so neither filters anything.
    platNameQuery(){ return this.findActive || isJobQuery(this.q) ? '' : this.q.trim().toLowerCase(); },
mkTabs(){
      // With a name filter typed, each tab counts what it would SHOW; a tab reading "Social 33" over
      // an empty result made the filter look broken.
      const q=this.platNameQuery;
      const n=g=>q ? g.items.filter(p=>this.platNameHit(p, q)).length : g.items.length;
      const out=[{key:'all', label:'All', n:this.platCategories.reduce((a,g)=>a+n(g),0)}];
      for(const g of this.platCategories) out.push({key:g.category, label:g.category, n:n(g)});
      out.push({key:'platform', label:'Platform', n:this.providers.length});
      return out;
    },
// A build without /catalog has no tiles to show, so it falls back to the integration shelves
    // rather than opening on an empty tab. Only once the shelves have answered: falling back while
    // they load flashed the integration list on every visit before the tiles replaced it.
    mkTabActive(){ return this.platCategories.length || !this.plats.settled ? this.mkTab : 'platform'; },
// Shelves, with the long ones cut down to their featured tiles. A category of 14 platforms is a
    // wall you scroll past rather than read, so past PLAT_SHELF_MAX only the catalog's `featured`
    // ranks get a full tile and the tail collapses into one "See X, Y, and N more" row. Rank first,
    // then endpoint count — the tail sorts by size alone, which is the only signal it has left.
    platCatGroups(){
      const groups = this.mkTabActive==='all' ? this.platCategories
        : this.platCategories.filter(g=>g.category===this.mkTabActive);
      // The top-nav search reaches here too: with a query, every match shows (no featured collapse —
      // a hit hidden behind "N more" reads as no hit) and empty shelves drop away.
      // A find answer (state/find.js) owns the box while it is showing: the sentence is not a name
      // to filter by, so every shelf stays, platforms the answer landed on first and uncollapsed.
      if(this.findActive){
        const hits=this.findHits;
        if(!Object.keys(hits).length) return groups.map(g=>({...g, rest:[], total:g.items.length}));
        return groups.map(g=>{ const items=[...g.items].sort((a,b)=>(hits[b.slug]||0)-(hits[a.slug]||0) || (b.endpoints||0)-(a.endpoints||0));
          return {...g, items, rest:[], total:items.length, hits:items.filter(p=>hits[p.slug]).length}; })
          .sort((a,b)=>b.hits-a.hits);
      }
      const q=this.platNameQuery;
      if(q){
        const hit=p=>this.platNameHit(p, q);
        return groups.map(g=>{ const items=g.items.filter(hit)
            .sort((a,b)=>(b.endpoints||0)-(a.endpoints||0));
          return {...g, items, rest:[], total:items.length}; }).filter(g=>g.items.length);
      }
      return groups.map(g=>{
        const items=[...g.items].sort((a,b)=>
          (a.featured==null?1e9:a.featured)-(b.featured==null?1e9:b.featured) || (b.endpoints||0)-(a.endpoints||0));
        const feat=items.filter(p=>p.featured!=null);
        // Nothing ranked means nothing to feature — showing an empty shelf over a "more" row would
        // hide the whole category behind a click.
        // `total` stays the whole category so the shelf's count matches its tab — a header reading
        // "SEO 5" under a tab reading "SEO 10" looks like tiles went missing.
        if(items.length<=8 || !feat.length || this.platShelfOpen[g.category]) return {...g, items, rest:[], total:items.length};
        return {...g, items:feat, rest:items.filter(p=>p.featured==null), total:items.length};
      });
    },
mkPlatforms(){ return this.plats.list.filter(pl=>(pl.providers||[]).includes(this.mkService)); },
platRow(){ return this.plats.list.find(pl=>pl.slug===this.platSlug)||null; },
platLabel(){ return (this.platData&&this.platData.platform&&this.platData.platform.label)
      || (this.platRow&&this.platRow.label)
      // The raw slug ("google-ads") only once nothing better can arrive: shown while loading, it
      // read as a broken title that then corrected itself.
      || (this.plats.settled && !this.platLoading ? this.platSlug || 'Platform' : ''); },
platProviders(){  // providers with endpoints here, in catalog order
      const seen=[]; for(const g of (this.platData&&this.platData.capabilities||[])) for(const e of (g.endpoints||[])) if(!seen.includes(e.provider)) seen.push(e.provider);
      for(const e of (this.platData&&this.platData.extended||[])) if(!seen.includes(e.provider)) seen.push(e.provider);
      // Navigation is a fact of THIS platform response, not of the separately-loaded connection
      // registry. Depending on that async registry made the entire row flicker away locally. `treg`
      // is the synthetic router, not a provider page a person can open.
      return seen.filter(s=>s!=='treg'); },
// ---- the shelf's rows ----
    // Which endpoints file together (a job several providers do, or one endpoint alone) is decided by
    // the server (catalog_store.domain_rows), so the CLI, the API and this page cannot disagree about
    // what a platform contains. What is added here is presentation: the title a row shows, whether it
    // is account/utility plumbing, and the haystack the search box filters.
    platRowsAll(){
      if(!this.platData) return [];
      const out=[];
      for(const sec of (this.platData.domains||[])) for(const r of (sec.rows||[])){
        const eps=r.endpoints||[]; if(!eps.length) continue;
        out.push({...r, domain:sec.domain, endpoints:eps,
          // The server picks `name` over `summary` where a curated name exists; the clip guards the
          // rows where one does not yet, whose summary is documentation prose.
          title:this.clip(r.description, 90),
          mgmt: eps.every(e=>e.kind==='account'||e.kind==='utility'),
          hay: (r.description+' '+r.domain+' '+(r.capability||'')+' '+eps.map(e=>
                 e.provider+' '+(e.provider_display||'')+' '+(e.name||'')+' '+e.path+' '+e.summary).join(' ')).toLowerCase()});
      }
      return out; },
// ---- the shelf, read as jobs and tools ----
    // A JOB is a capability at least two providers serve on the shelf: the one place a comparison
    // means something, so it gets a card and a page of its own. The server marks those rows (`job`,
    // the key its URL uses; `Catalog.jobs`). Everything else is a TOOL, listed once, opened in the
    // drawer. Plumbing (account/utility) stays folded at the foot.
    platJobIndex(){
      return this.platRowsAll.filter(r=>r.job).map(r=>{
        const direct=r.endpoints.filter(e=>e.kind!=='routed'), provs=[...new Set(direct.map(e=>e.provider))];
        const range=this.priceRange(direct);
        return {key:r.capability, slug:r.job, row:r, title:r.description, hay:r.hay, logos:provs.slice(0,5),
                routed:r.endpoints.find(e=>e.kind==='routed')||null, provN:provs.length,
                meta:provs.length+' providers'+(range ? ' · '+range : '')}; }); },
// What the shelf's lists filter by as you type: a name or a word. A described job is not a filter
    // (no row contains a sentence); the finder answers it above the lists, which stay whole.
    platFilterQ(){ return isJobQuery(this.platQ) ? '' : this.platQ.trim().toLowerCase(); },
platJobList(){ const q=this.platFilterQ;
      return this.platJobIndex.filter(j=>!q || j.hay.includes(q)); },
// Every endpoint on the shelf that is not part of a job card, one line each, alphabetical, built
    // once per shelf; the search box only filters it.
    platToolIndex(){
      const out=[];
      for(const r of this.platRowsAll){
        if(r.job) continue;
        for(const e of r.endpoints){
          if(e.kind==='routed') continue;
          const title=r.endpoints.length===1 ? r.title : this.clip(e.name||e.summary||r.description, 90);
          out.push({id:e.id, title, e, mgmt:r.mgmt,
                    hay:(title+' '+e.provider+' '+(e.provider_display||'')+' '+(e.summary||'')+' '+e.id).toLowerCase()}); } }
      const by=new Intl.Collator(); return out.sort((a,b)=>by.compare(a.title, b.title)); },
platTools(){ const q=this.platFilterQ; return this.platToolIndex.filter(t=>!t.mgmt && (!q || t.hay.includes(q))); },
platToolTotal(){ return this.platToolIndex.filter(t=>!t.mgmt).length; },
platPlumbing(){ const q=this.platFilterQ; return this.platToolIndex.filter(t=>t.mgmt && (!q || t.hay.includes(q))); },
platEpById(){ const m={}; for(const r of this.platRowsAll) for(const e of r.endpoints) m[e.id]=e; return m; },
// The drawer reads from the list of the view it was opened on.
    drawerEp(){ if(!this.drawerTool) return null;
      return (this.view==='provider' ? this.mkToolById : this.platEpById)[this.drawerTool]||null; },
drawerInfo(){ const i=this.drawerTool && this.epInfo[this.drawerTool]; return i&&i.data||null; },
// The job a URL names, by its key (`enrich` on the companies shelf is `companies.enrich`).
    platJobMeta(){ return this.platJob ? this.platJobIndex.find(j=>j.slug===this.platJob)||null : null; },
platJobRow(){ return this.platJobMeta ? this.platJobMeta.row : null; },
platJobData(){ const i=this.platJobLead && this.epInfo[this.platJobLead]; return i&&i.data||null; },
// Measured reliability by endpoint id, from the lead's detail: the endpoint itself and its siblings.
    platObserved(){ const d=this.platJobData, m={}; if(!d) return m;
      if(d.endpoint) m[d.endpoint.id]=d.endpoint.observed;
      for(const s of d.siblings||[]) m[s.id]=s.observed; return m; },
platAccepts(){ const m={}; for(const p of (((this.platJobData||{}).routing)||{}).plan||[]) m[p.endpoint_id]=p.accepts; return m; },
platJobChoices(){
      const row=this.platJobRow; if(!row) return [];
      const eps=row.endpoints.filter(e=>e.kind!=='routed');
      const perProv={}; for(const e of eps) perProv[e.provider]=(perProv[e.provider]||0)+1;
      const rows=eps.map(e=>{ const o=this.platObserved[e.id];
        return {e, id:e.id, twin:perProv[e.provider]>1, takes:this.takesLabel(this.platAccepts[e.id]),
                usd:e.platform_eligible===false ? null : this.costUsd(e.cost), works:this.worksOf(o), useful:this.usefulOf(e)}; });
      const k=this.platJobSort.key, val=r=>k==='price' ? r.usd : k==='works' ? (r.works&&r.works.pct) : (r.useful&&r.useful.pct);
      const dir=this.platJobSort.dir==='asc' ? 1 : -1;   // unmeasured rows stay last either way
      return rows.sort((a,b)=>{ const x=val(a), y=val(b);
        if(x==null && y==null) return (a.e.provider_display||a.e.provider).localeCompare(b.e.provider_display||b.e.provider);
        if(x==null) return 1; if(y==null) return -1; return (x-y)*dir || (b.e.verified?1:0)-(a.e.verified?1:0); }); },
// The comparison's columns (components/ui/table DataTable). Price sorts cheapest first, the two
    // measured columns best first; every heading explains its number.
    jobColumns(){ const t=COL_TIPS; return [
      {key:'provider', header:'Provider', mobile:'primary', minWidth:'240px', wrap:true},
      {key:'takes', header:'Takes', tip:t.takes, minWidth:'150px', wrap:true, mobile:'wide'},
      {key:'price', header:'Price', tip:t.price, align:'right', sortable:true, sortFirst:'asc'},
      {key:'works', header:'Works', tip:t.works, align:'right', sortable:true, sortFirst:'desc'},
      {key:'useful', header:'Useful', tip:t.useful, align:'right', sortable:true, sortFirst:'desc'}]; },
platOtherJobs(){ return this.platJobIndex.filter(j=>j!==this.platJobMeta).slice(0,6); },
drawerIds(){
      if(this.view==='provider') return [...this.mkToolShelves.flatMap(p=>p.tools), ...this.mkToolShelves.flatMap(p=>p.plumbing)].map(t=>t.id);
      if(this.platJobRow) return [...(this.platJobMeta&&this.platJobMeta.routed ? [this.platJobMeta.routed.id] : []), ...this.platJobChoices.map(r=>r.id)];
      return [...this.platTools, ...this.platPlumbing].map(t=>t.id); },
// The drawer's three numbers: measured success (the tool's own detail, else the job's), agents' verdict.
    drawerStats(){ const e=this.drawerEp; if(!e) return {};
      const d=this.drawerInfo;
      return {works:this.worksOf(d && d.endpoint && d.endpoint.observed) || this.worksOf(this.platObserved[e.id]), useful:this.usefulOf(e)}; },
// Everything else worth knowing, as one quiet line instead of a row of chips.
    drawerFacts(){ const e=this.drawerEp; if(!e) return '';
      const access={'Platform + BYOK':"treg's key or yours", 'Platform access':"treg's key", 'BYOK only':'your own key only'}[this.endpointAccessLabel(e)] || this.endpointAccessLabel(e);
      return [access, e.verified ? 'verified live '+this.verdictDate(e.verified) : 'not yet verified live',
              e.scope==='own_account' ? 'reads the account you connect' : e.scope==='any_account' ? 'any public account' : ''].filter(Boolean).join(' · '); },
// A provider's tools by platform (GET /catalog/providers/<service>), for its provider page.
    mkToolData(){ const t=this.mkTools; return t && t.service===this.mkService ? t.data : null; },
mkToolShelves(){ const d=this.mkToolData; if(!d) return [];
      return d.platforms.map(p=>{ const hidden=t=>t.kind==='account'||t.kind==='utility';
        const item=t=>({id:t.id, e:t, job:t.job||null, title:this.clip(t.name||t.summary||t.id, 90)});
        return {slug:p.slug, label:p.label, tools:p.tools.filter(t=>!hidden(t)).map(item), plumbing:p.tools.filter(hidden).map(item)}; })
        .filter(p=>p.tools.length || p.plumbing.length); },
mkToolById(){ const m={}; for(const p of (this.mkToolData||{platforms:[]}).platforms) for(const t of p.tools) m[t.id]=t; return m; },
mkToolCount(){ return this.mkToolShelves.reduce((n,p)=>n+p.tools.length, 0); },
mkPlumbCount(){ return this.mkToolShelves.reduce((n,p)=>n+p.plumbing.length, 0); },
platProvLine(){ return this.platProviders.map(s=>({s, name:this.provName(s)})).sort((a,b)=>a.name.localeCompare(b.name)); },
catalogDeny(){ const c=this.tForm.cli; return (c && this.catalogClis && this.catalogClis[c.bin]) || []; },
catalogExtra(){  // catalog patterns not already in the own list — the union dedupes at run time, so showing both would double up
      const own=new Set((this.tForm.cli&&this.tForm.cli.deny||[]).map(p=>p.trim())); return this.catalogDeny.filter(p=>!own.has(p)); },
sortedInvites(){  // the clicked email link's team first, then newest-first (the API's order)
      return [...this.pendingInvites].sort((a,b)=>(b.org_id===this.inviteLinkOrg?1:0)-(a.org_id===this.inviteLinkOrg?1:0)); },
selectedInvites(){ return this.sortedInvites.filter(i=>this.inviteSel[i.id]); },
inviteFirstRun(){ return !this.myOrgs.some(o=>!this.isPersonal(o)); },
// no real team yet → decline offers create-team
    activityRows(){  // proxy calls + server CLI runs, one time-sorted feed (ISO strings compare fine)
      // Local runs now arrive via /runs (where:'local'); drop them from the calls feed so they aren't double-counted.
      // Cost precedence: what was CHARGED (settle amount; 0 on a release — the estimate alone would
      // over-report a refunded call as spend), else observed, else the estimate (old rows / own-key).
      // A metered async task (video/image generation) is the one row whose charge is decided AFTER
      // the call returned: the server nulls the charge while the task is pending, so show the hold.
      const calls=(this.calls||[]).filter(c=>c.kind!=='local_run').map(c=>({kind:'call', id:c.id, created_at:c.created_at, user_email:c.user_email, client:c.client, tool:c.tool_name, action:c.method, status:c.status_code, ok:c.status_code<400,
        task:c.async_task||null, held:!!(c.async_task&&c.async_task.status==='pending'),
        cost:(c.async_task&&c.async_task.status==='pending')?c.async_task.reserved_micro:(c.cost_charged_micro!=null?c.cost_charged_micro:(c.cost_observed_micro!=null?c.cost_observed_micro:c.cost_estimated_micro)), tier:c.credential_tier, tags:c.tags,
        has_result:!!c.has_result, endpoint_id:c.endpoint_id, call_ref:c.call_ref, path:c.path, cached:c.cached, api_key_id:c.api_key_id, api_key_name:c.api_key_name, api_key_prefix:c.api_key_prefix}));
      const runs=(this.runs||[]).map(r=>({kind:'run', where:r.where, id:r.id, created_at:r.created_at, user_email:r.user_email, client:r.client, tool:r.tool, action:(r.argv||[]).join(' ').slice(0,48)||'-', status:(r.where==='local'?'local run':'exit '+r.exit_code), ok:(r.where==='local'?true:r.exit_code===0), api_key_id:r.api_key_id, api_key_name:r.api_key_name, api_key_prefix:r.api_key_prefix}));
      return calls.concat(runs).sort((a,b)=>a.created_at<b.created_at?1:-1);
    },
activityCallCount(){ return this.activityRows.filter(a=>a.kind==='call').length; },
activityCachedCount(){ return this.activityRows.filter(a=>a.kind==='call' && a.cached).length; },
apiKeyGroups(){
      const groups=[], humanByIdentity={}, standaloneAgents={};
      for(const row of this.apiKeys||[]){
        if(row.assigned_type!=='human') continue;
        const identity=(row.identity||'').toLowerCase();
        let group=humanByIdentity[identity];
        if(!group){ group={identity:row.identity,name:row.assigned_name||row.identity,type:'human',rows:[]}; humanByIdentity[identity]=group; groups.push(group); }
        group.rows.push(row);
      }
      for(const row of this.apiKeys||[]){
        if(row.assigned_type!=='agent') continue;
        const owner=humanByIdentity[(row.created_by||'').toLowerCase()];
        if(owner){ owner.rows.push(row); continue; }
        let group=standaloneAgents[row.identity];
        if(!group){ group={identity:row.identity,name:row.assigned_name||row.identity,type:'agent',rows:[]}; standaloneAgents[row.identity]=group; groups.push(group); }
        group.rows.push(row);
      }
      return groups;
    },
activityShown(){ return this.actOkOnly ? this.activityRows.filter(a=>a.ok) : this.activityRows; },
callBodyPretty(){ const t=this.callView&&this.callView.response&&this.callView.response.body_text; return t?this.pretty(t):''; },
// JSON pretty-printed when it parses (a 2 MB parse is ~20 ms)
    callBodyTruncated(){ return !this.callViewFull && this.callBodyPretty.length>262144; },
// cap the RENDERED text at 256 KB unless asked for all of it
    callBodyShown(){ const t=this.callBodyPretty; return this.callBodyTruncated ? t.slice(0,262144)+'\n… (truncated)' : t; },
anyTagged(){  // hide the column entirely for teams that never send X-Treg-Meta
      return (this.calls||[]).some(c=>c.tags && Object.keys(c.tags).length);
    },
// Try-it drawer: the filled query string + the three "how to run it" recipes (agent / CLI / API)
    epTryAuthMethods(){ if(!this.epTry) return [];
      return [...new Set([this.epTry.authorization_method, ...(this.epTry.authorization_methods||[]),
        ...Object.keys(this.epTry.authorization_paths||{})].filter(Boolean))]; },
epTryConnectedMethods(){ return this.epTryAuthMethods.filter(m=>{
      const a=this.epTryAccessByMethod[m]; return a && (a.tier==='tool'||a.tier==='credential'); }); },
epTryShowAuthSelector(){ return this.epTryAuthMethods.length>1 && this.epTryConnectedMethods.length>1; },
epTryDisplayPath(){ if(!this.epTry) return '';
      if(this.epTry.id==='fishaudio.voices.list') return '/orgs/{org_id}/provider-resources?provider=fishaudio&kind=voice';
      return (this.epTry.authorization_paths||{})[this.epTryAuthMethod]||this.epTry.path; },
epTryVisibleParams(){
      if(this.epTry&&this.epTry.id==='fishaudio.voices.list') return [];
      return (this.epTryParams||[]).filter(p=>this.epTryParamAllowed(p));
    },
epTryQuery(){ return this.epTryVisibleParams.filter(p=>['query','path'].includes(p.location) && p.value!=='' && p.value!=null)
      .map(p=>encodeURIComponent(p.name)+'='+encodeURIComponent(p.value)).join('&'); },
epTryShellBody(){ return "'"+String(this.epTryBody).replace(/'/g,"'\"'\"'")+"'"; },
epTryCliCall(){ if(!this.epTry) return '';
      if(this.epTry.id==='fishaudio.voices.list') return 'treg resources list --provider fishaudio --kind voice';
      const args=this.epTryVisibleParams.filter(p=>['query','path'].includes(p.location) && p.value!=='' && p.value!=null)
        .map(p=>`--query ${p.name}=${/\s/.test(String(p.value))?JSON.stringify(String(p.value)):p.value}`).join(' ');
      const method=(this.epTry.method||'GET').toUpperCase();
      let s=`treg call ${this.epTry.id}${args?' '+args:''}`;
      if(method!=='GET') s+=` --method ${method}`;
      if(this.epTryAuthMethod) s+=` --authorization-method ${this.epTryAuthMethod}`;
      for(const p of this.epTryVisibleParams.filter(p=>p.location==='header'&&String(p.value)!==''))
        s+=` --header ${p.name}=${JSON.stringify(String(p.value))}`;
      if(this.epTryBodyType==='multipart'){
        for(const p of this.epTryMultipart.filter(p=>!String(p.type).includes('file')&&String(p.value)!==''))
          s+=` --form ${p.name}=${JSON.stringify(String(p.value))}`;
        for(const p of this.epTryMultipart.filter(p=>String(p.type).includes('file')))
          s+=` --upload ${p.name}=@${p.name==='voices'?'<reference-audio>':'<file>'}`;
      }else if(method!=='GET' && this.epTryBody.trim()) s+=` --data ${this.epTryShellBody}`;
      if(this.epTry.id==='fishaudio.tts.s2-1-pro') s+=' > speech.mp3';
      return s; },
epTryCurl(){ if(!this.epTry) return '';
      if(this.epTry.id==='fishaudio.voices.list'){
        const tok=this.myToken||'$TREG_TOKEN', org=this.activeOrgId||'$TREG_ORG_ID';
        let s=`curl "${this.proxy}/orgs/${org}/provider-resources?provider=fishaudio&kind=voice" \\\n+  -H "X-Treg-Token: ${tok}"`;
        if(this.sessionMode && this.activeSlugNow) s+=` \\\n+  -H "X-Treg-Org: ${this.activeSlugNow}"`;
        return s;
      }
      const q=this.epTryQuery; const url=`${this.proxy}/call/${this.epTry.id}${q?'?'+q:''}`;
      const tok=this.myToken||'$TREG_TOKEN', method=(this.epTry.method||'GET').toUpperCase();
      let s=`curl -X ${method} "${url}" \\\n  -H "X-Treg-Token: ${tok}"`;
      if(this.sessionMode && this.activeSlugNow) s+=` \\\n  -H "X-Treg-Org: ${this.activeSlugNow}"`;  // minted identity token needs the org header
      if(this.epTryAuthMethod) s+=` \\\n  -H "X-Treg-Authorization-Method: ${this.epTryAuthMethod}"`;
      for(const p of this.epTryVisibleParams.filter(p=>p.location==='header'&&String(p.value)!=='')) s+=` \\\n  -H "${p.name}: ${String(p.value).replace(/"/g,'\\"')}"`;
      if(this.epTryBodyType==='multipart'){
        for(const p of this.epTryMultipart.filter(p=>!String(p.type).includes('file')&&String(p.value)!=='')) s+=` \\\n  -F "${p.name}=${String(p.value).replace(/"/g,'\\"')}"`;
        for(const p of this.epTryMultipart.filter(p=>String(p.type).includes('file'))) s+=` \\\n  -F "${p.name}=@${p.name==='voices'?'<reference-audio>':'<file>'}"`;
      }else if(method!=='GET' && this.epTryBody.trim()) s+=` \\\n  -H "Content-Type: application/json" \\\n  --data ${this.epTryShellBody}`;
      if(this.epTry.id==='fishaudio.tts.s2-1-pro') s+=' \\\n  --output speech.mp3';
      return s; },
// token + team embedded HERE ONLY (a copy-and-run-now context) — the setup line elsewhere stays clean
    epTrySetupLine(){ const S=this.activeSlugNow||'<team-slug>', T=this.myToken||'<YOUR_TOKEN>';
      return `set up treg — ${this.proxy}/llms.txt with team ${S} token: ${T}`; },
epTryAgentUse(){ if(!this.epTry) return '';
      if(this.epTry.id==='fishaudio.voices.list') return 'Use treg resources_list with provider=fishaudio and kind=voice. It returns the connected Fish account when BYOK exists, otherwise this team’s platform-created voices.';
      const what=this.epTry.summary ? this.epTry.summary.replace(/\.$/,'') : this.epTry.id;
      const auth=this.epTryAuthMethod ? ` Use authorization_method=${this.epTryAuthMethod}.` : '';
      return `Use treg to call ${this.epTry.id} — ${what}.${auth}`; }
}
