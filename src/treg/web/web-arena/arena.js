/* Web Arena keeps its query in session storage until sign-in. Results stay server-side. */
(() => {
  'use strict';
  if (!window.Vue) return;
  const draftKey='treg.web-arena.draft.v1';
  const page=location.pathname.endsWith('/leaderboard')?'leaderboard':location.pathname.endsWith('/benchmark')?'benchmark':'arena';
  const saveDraft=d=>{try{sessionStorage.setItem(draftKey,JSON.stringify(d));}catch{}};
  const readDraft=()=>{try{return JSON.parse(sessionStorage.getItem(draftKey)||'null');}catch{return null;}};
  Vue.createApp({
    data:()=>({page,tasks:[{id:'search',label:'Web Search',enabled:true},{id:'fetch',label:'Web Fetch',enabled:true},{id:'sitemap',label:'Sitemap',enabled:true},{id:'brand',label:'Brand',enabled:false}],task:'search',value:'',mode:'battle',jev:true,
      user:null,teams:[],team:'',balance:null,quote:null,availableProviders:[],selected:[],run:null,history:[],live:null,bench:null,
      busy:false,pricing:false,running:false,error:'',authError:'',email:'',code:'',authStep:'email',devCode:'',newTeamName:'',poller:null,
      quoteTimer:null,quoteSequence:0,quotedKey:'',selectionTouched:false,rosterLeft:false,rosterRight:false,rosterObserver:null}),
    computed:{
      liveRows(){return this.live?.task_results?.[this.task]||[];},
      benchmarkGroup(){return this.bench?.task_results?.[this.task]||null;},
      quoteKey(){return JSON.stringify([this.task,this.value.trim(),this.mode,this.jev,this.team,[...this.selected].sort()]);},
      readyQuote(){return this.quote&&this.quotedKey===this.quoteKey?this.quote:null;},
      displayProviders(){
        const available=new Map(this.availableProviders.map(p=>[p.provider,p]));
        const attempts=this.run?.attempts||[];
        if(this.running){
          if(attempts.length)return attempts.map(a=>available.get(a.provider)||{provider:a.provider,estimate_micro:a.estimate_micro});
          return this.selected.map(provider=>available.get(provider)).filter(Boolean);
        }
        if(this.run&&attempts.length){
          const used=new Set(attempts.map(a=>a.provider));
          return [...attempts.map(a=>available.get(a.provider)||{provider:a.provider,estimate_micro:a.estimate_micro}),
            ...this.availableProviders.filter(p=>!used.has(p.provider))]
            .sort((a,b)=>Number(this.selected.includes(b.provider))-Number(this.selected.includes(a.provider)));
        }
        return [...this.availableProviders].sort((a,b)=>Number(this.selected.includes(b.provider))-Number(this.selected.includes(a.provider)));
      },
      battleAwards(){
        const awards={};
        if(this.run?.state!=='completed'||this.run.mode!=='battle')return awards;
        const results=(this.run.attempts||[]).filter(a=>a.state==='hit'&&a.rating!=='down');
        if(results.length<2)return awards;
        for(const [field,label] of [['duration_ms','Fastest'],['charged_micro','Cheapest']]){
          if(!results.every(a=>Number.isFinite(a[field])&&a[field]>=0))continue;
          const best=Math.min(...results.map(a=>a[field]));
          for(const a of results)if(a[field]===best)(awards[a.id]||=[]).push(label);
        }
        return awards;
      },
      runButtonLabel(){if(this.running)return 'Running…';if(this.busy)return 'Starting…';if(!this.user)return 'Sign up to run';if(this.pricing)return 'Updating price…';
        const q=this.readyQuote;if(!q)return this.mode==='battle'?'Run battle':'Run waterfall';
        if(!q.affordable)return q.limit_exceeded?'Select fewer providers':'Add team credits · '+this.usd(q.required_micro);
        return this.mode==='battle'?'Run battle · ~'+this.usd(q.required_micro):'Run waterfall from '+this.usd(q.required_micro);}
    },
    methods:{
      usd(n){return n===null||n===undefined?'—':'$'+(Number(n)/1e6).toFixed(4);},
      percent(n){return n===null||n===undefined?'—':Number(n).toFixed(1)+'%';},
      date(s){return s?new Date(s).toLocaleDateString():'';},
      providerName(provider){return ({branddev:'Brand.dev',firecrawl:'Firecrawl',scrapegraphai:'ScrapeGraphAI',search1api:'Search1API',tinyfish:'TinyFish',you:'You.com',anyapi:'AnyAPI'})[provider]||provider.charAt(0).toUpperCase()+provider.slice(1);},
      taskIcon(task){return ({search:'M20 20l-4.3-4.3M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z',fetch:'M8 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9l-5-5h-4M16 4v5h5M8 14h8m-8 3h5',sitemap:'M12 3v5m-7 6v-3h14v3M12 8v3M3 14h4v5H3zm7 0h4v5h-4zm7 0h4v5h-4z',brand:'M4 5h16v14H4zM8 14l3-3 3 3 2-2 4 4M8 8h.01'})[task]||'';},
      attemptFor(provider){return this.run?.attempts?.find(a=>a.provider===provider);},
      fighterIncluded(provider){return this.selected.includes(provider)||(this.running&&!!this.attemptFor(provider));},
      fighterAwards(provider){return this.battleAwards[this.attemptFor(provider)?.id]||[];},
      fighterState(provider){
        if(!this.fighterIncluded(provider))return 'excluded';
        const attempt=this.attemptFor(provider);
        if(attempt?.rating==='down'||['miss','error','timeout'].includes(attempt?.state))return 'defeated';
        return ({hit:'won',running:'fighting',queued:'waiting',not_attempted:'benched',cancelled:'paused',interrupted:'paused'})[attempt?.state]||'ready';
      },
      fighterVerdict(provider,price){
        const attempt=this.attemptFor(provider),state=attempt?.state;
        if(attempt?.rating==='down')return 'Thumbs down';
        return ({hit:'Hit!',miss:'No result',error:'Error',timeout:'Timed out',running:'Running…',queued:'Waiting',not_attempted:'Not called',cancelled:'Stopped',interrupted:'Interrupted'})[state]||(price==null?'Catalog tool':this.usd(price));
      },
      attemptLabel(a){return ({hit:'Hit',miss:'No result',error:'Error',timeout:'Timed out',running:'Running',queued:'Waiting',not_attempted:'Not called',cancelled:'Stopped',interrupted:'Interrupted'})[a.state]||a.state;},
      attemptMessage(a){if(a.state==='miss')return ({search:'No matching results returned.',fetch:'No usable page text returned.',sitemap:'No valid site URLs returned.'})[this.run?.task]||'No usable result returned.';return ({error:'This service could not complete the request.',timeout:'This service did not finish within the deadline.',running:'Waiting for the provider response…',queued:'Waiting for its turn.',not_attempted:'This provider was not called.',cancelled:'The attempt was stopped.',interrupted:'No complete result was recorded.'})[a.state]||'';},
      freshnessLabel(quality){
        const value=quality?.freshness_percent;
        if(value==null||!quality?.known_dates)return 'Freshness unknown';
        if(value>=80)return 'Mostly recent links';
        if(value>=30)return 'Some recent links';
        if(value>0)return 'Few recent links';
        return 'No recent dated links';
      },
      freshnessTone(quality){return quality?.freshness_percent>=80?'recent':quality?.freshness_percent>=30?'mixed':'stale';},
      qualityPart(row){const p=row.parts||{};let value=null;
        if(this.task==='search'&&p.relevance!=null)value=p.freshness==null?p.relevance:0.75*p.relevance+0.25*p.freshness;
        if(this.task==='fetch'&&p.fact_coverage!=null&&p.token_efficiency!=null)value=(p.fact_coverage+p.token_efficiency)/2;
        if(this.task==='sitemap'&&p.known_url_coverage!=null&&p.valid_url_rate!=null)value=(p.known_url_coverage+p.valid_url_rate)/2;
        return this.percent(value);},
      async api(path,options={},teamOverride){
        const headers={'Content-Type':'application/json',...(options.headers||{})};
        const active=teamOverride===undefined?this.team:teamOverride;
        if(active)headers['X-Treg-Org']=active;
        const response=await fetch(path,{credentials:'same-origin',...options,headers});
        let body;try{body=await response.json();}catch{body={detail:'The server sent an unreadable response.'};}
        if(!response.ok){const d=body.detail;const e=new Error(typeof d==='string'?d:d?.message||'Request failed.');e.status=response.status;throw e;}
        return body;
      },
      remember(){saveDraft({task:this.task,value:this.value,mode:this.mode,jev:this.jev,selected:this.selected,at:Date.now()});},
      previewFor(task){return this.tasks.find(t=>t.id===task)?.provider_previews||[];},
      showPreview(){this.availableProviders=this.previewFor(this.task);this.selected=this.availableProviders.map(p=>p.provider);this.selectionTouched=false;this.resetRoster();},
      updateRoster(){const host=this.$refs.fighterRoster;if(!host)return;this.rosterLeft=host.scrollLeft>1;this.rosterRight=host.scrollWidth-host.clientWidth-host.scrollLeft>1;},
      scrollRoster(direction){const host=this.$refs.fighterRoster;if(!host)return;host.scrollBy({left:direction*Math.max(180,host.clientWidth*.7),behavior:'smooth'});},
      resetRoster(){this.$nextTick(()=>{const host=this.$refs.fighterRoster;if(host)host.scrollLeft=0;this.updateRoster();});},
      scheduleQuote(delay=650){clearTimeout(this.quoteTimer);this.quoteSequence++;this.quote=null;this.quotedKey='';this.pricing=false;
        if(page!=='arena'||!this.user||!this.team||this.running||!this.value.trim()||!this.selected.length)return;
        this.quoteTimer=setTimeout(()=>this.prepare(true),delay);},
      invalidate(){this.remember();this.scheduleQuote();},
      chooseTask(task){this.task=task;this.value='';this.run=null;this.showPreview();this.invalidate();},
      setMode(mode){if(this.mode===mode)return;this.mode=mode;this.invalidate();},
      toggleProvider(provider){if(this.running)return;this.selectionTouched=true;
        this.selected=this.selected.includes(provider)?this.selected.filter(p=>p!==provider):[...this.selected,provider];
        this.error=this.selected.length?'':'Select at least one provider.';this.invalidate();this.resetRoster();},
      async loadIdentity(){
        try{this.user=await this.api('/auth/me',{},'');}
        catch(e){if(e.status!==401)throw e;this.user=null;this.teams=[];this.team='';this.balance=null;return;}
        this.teams=(await this.api('/orgs',{},'')).filter(t=>!t.demo);
        this.team=this.teams.find(t=>t.slug===this.team)?.slug||this.teams[0]?.slug||'';
        if(this.team)await this.loadBalance();
        this.scheduleQuote(0);
      },
      async loadBalance(){const team=this.teams.find(t=>t.slug===this.team);if(team)this.balance=(await this.api('/orgs/'+team.org_id+'/balance?limit=1')).balance_micro;},
      async reloadTeam(){this.run=null;this.showPreview();this.scheduleQuote(0);await this.loadBalance();await this.loadHistory();},
      async loadHistory(){if(this.user&&this.team)this.history=await this.api('/web-arena/api/runs');},
      openLogin(){this.remember();this.$refs.login.showModal();},
      closeLogin(){this.$refs.login.close();},
      async sendCode(){this.busy=true;this.authError='';try{const r=await this.api('/auth/email/start',{method:'POST',body:JSON.stringify({email:this.email})},'');this.authStep='code';this.devCode=r.dev_code||'';}catch(e){this.authError=e.message;}finally{this.busy=false;}},
      async verifyCode(){this.busy=true;this.authError='';try{await this.api('/auth/email/verify',{method:'POST',body:JSON.stringify({email:this.email,code:this.code})},'');this.closeLogin();await this.loadIdentity();if(!this.teams.length)this.$refs.teamDialog.showModal();}catch(e){this.authError=e.message;}finally{this.busy=false;}},
      async createTeam(){this.busy=true;try{await this.api('/orgs',{method:'POST',body:JSON.stringify({name:this.newTeamName})},'');this.$refs.teamDialog.close();await this.loadIdentity();}catch(e){this.error=e.message;}finally{this.busy=false;}},
      async logout(){try{await this.api('/auth/logout',{method:'POST'});this.user=null;this.teams=[];this.team='';this.balance=null;this.quote=null;this.run=null;this.history=[];this.showPreview();this.scheduleQuote();}catch(e){this.error=e.message;}},
      async prepare(quiet=false){
        clearTimeout(this.quoteTimer);
        if(!this.user||!this.team||this.running||!this.value.trim()||!this.selected.length)return;
        const sequence=++this.quoteSequence,team=this.team,task=this.task,value=this.value.trim(),mode=this.mode,jev=this.jev;
        const selection=[...this.selected],touched=this.selectionTouched;
        this.pricing=true;this.quote=null;this.quotedKey='';this.error='';this.remember();
        try{
          const request=providers=>this.api('/web-arena/api/quotes',{method:'POST',body:JSON.stringify({task,value,mode,jev,providers})},team);
          const full=await request(null);
          if(sequence!==this.quoteSequence||team!==this.team||task!==this.task||value!==this.value.trim()||mode!==this.mode||jev!==this.jev)return;
          this.availableProviders=full.providers;
          this.$nextTick(()=>this.updateRoster());
          const eligible=new Set(full.providers.map(p=>p.provider));
        this.selected=touched?selection.filter(p=>eligible.has(p)):full.providers.map(p=>p.provider);
          if(!this.selected.length){this.error='None of the selected providers can use this input. Choose another provider.';return;}
          const allSelected=this.selected.length===full.providers.length;
          const q=allSelected?full:await request(this.selected);
          if(sequence!==this.quoteSequence||team!==this.team||task!==this.task||value!==this.value.trim()||mode!==this.mode||jev!==this.jev)return;
          this.quote=q;this.quotedKey=this.quoteKey;this.balance=q.balance_micro;
        }catch(e){if(sequence===this.quoteSequence){this.error=e.message;this.quote=null;if(e.status===401)this.user=null;}}
        finally{if(sequence===this.quoteSequence)this.pricing=false;}
      },
      async submit(){
        if(this.busy||this.running||this.pricing)return;
        if(!this.value.trim()){this.error='Enter a query or URL.';return;}
        if(!this.selected.length){this.error='Select at least one provider.';return;}
        if(!this.user){this.openLogin();return;}
        if(!this.team){this.$refs.teamDialog.showModal();return;}
        if(!this.readyQuote||Date.parse(this.readyQuote.expires_at)<=Date.now())await this.prepare(false);
        const q=this.readyQuote;if(!q)return;
        if(!q.affordable){this.error=q.limit_exceeded?'Select fewer providers to stay within the $10 run limit.':'Add team credits to run this quote.';return;}
        await this.start();
      },
      async start(){
        const quote=this.readyQuote;if(!quote||!this.selected.length)return;
        this.busy=true;this.error='';
        try{const r=await this.api('/web-arena/api/runs/'+quote.id+'/start',{method:'POST'});this.quote=null;this.quotedKey='';this.running=true;this.run={id:r.id,state:'running',attempts:[]};await this.poll();this.poller=setInterval(()=>this.poll(),1500);}
        catch(e){this.error=e.message;}finally{this.busy=false;}
      },
      async poll(){if(!this.run)return;try{this.run=await this.api('/web-arena/api/runs/'+this.run.id);if(this.run.state!=='running'){clearInterval(this.poller);this.poller=null;this.running=false;await this.loadHistory();await this.loadBalance();this.scheduleQuote(0);}}catch(e){clearInterval(this.poller);this.poller=null;this.running=false;this.error=e.message;}},
      async loadRun(id){this.error='';try{const run=await this.api('/web-arena/api/runs/'+id);clearInterval(this.poller);this.poller=null;this.running=run.state==='running';this.run=run;this.task=run.task;this.value=run.input;this.mode=run.mode;this.jev=run.jev;this.showPreview();this.selected=run.attempts.map(a=>a.provider);this.selectionTouched=true;this.resetRoster();this.scheduleQuote();if(this.running)this.poller=setInterval(()=>this.poll(),1500);}catch(e){this.error=e.message;}},
      newRun(){clearInterval(this.poller);this.poller=null;this.running=false;this.run=null;this.value='';this.showPreview();this.scheduleQuote();this.remember();},
      async cancel(){try{await this.api('/web-arena/api/runs/'+this.run.id+'/cancel',{method:'POST'});await this.poll();}catch(e){this.error=e.message;}},
      async rate(a,value){try{await this.api('/web-arena/api/runs/'+this.run.id+'/attempts/'+a.id+'/rating',{method:'POST',body:JSON.stringify({value})});a.rating=value;}catch(e){this.error=e.message;}}
    },
    async mounted(){
      if(page==='arena'&&this.$refs.fighterRoster){this.rosterObserver=new ResizeObserver(()=>this.updateRoster());this.rosterObserver.observe(this.$refs.fighterRoster);}
      const draft=readDraft();if(draft&&Date.now()-draft.at<600000){this.task=draft.task||'search';this.value=draft.value||'';this.mode=draft.mode==='waterfall'?'waterfall':'battle';this.jev=draft.jev!==false;}
      try{
        this.tasks=await this.api('/web-arena/api/tasks',{},'');
        this.showPreview();
        if(draft&&Date.now()-draft.at<600000&&Array.isArray(draft.selected)&&draft.selected.length){
          const visible=new Set(this.availableProviders.map(p=>p.provider));
          this.selected=draft.selected.filter(p=>visible.has(p));
          this.selectionTouched=this.selected.length!==this.availableProviders.length;
        }
        if(page==='leaderboard')this.live=await this.api('/web-arena/api/leaderboard',{},'');
        if(page==='benchmark')this.bench=await this.api('/web-arena/api/benchmark',{},'');
        await this.loadIdentity();await this.loadHistory();
        const id=new URLSearchParams(location.search).get('run');if(id&&this.user)await this.loadRun(id);
      }catch(e){this.error=e.message;}
    },
    unmounted(){clearInterval(this.poller);clearTimeout(this.quoteTimer);this.quoteSequence++;this.rosterObserver?.disconnect();}
  }).mount('#web-arena');
})();
