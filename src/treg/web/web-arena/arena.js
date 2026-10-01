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
      busy:false,running:false,error:'',authError:'',email:'',code:'',authStep:'email',devCode:'',newTeamName:'',poller:null}),
    computed:{
      liveRows(){return this.live?.task_results?.[this.task]||[];},
      benchmarkGroup(){return this.bench?.task_results?.[this.task]||null;}
    },
    methods:{
      usd(n){return n===null||n===undefined?'—':'$'+(Number(n)/1e6).toFixed(4);},
      percent(n){return n===null||n===undefined?'—':Number(n).toFixed(1)+'%';},
      date(s){return s?new Date(s).toLocaleDateString():'';},
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
      invalidate(){this.quote=null;this.remember();},
      chooseTask(task){this.task=task;this.value='';this.quote=null;this.run=null;this.remember();},
      async loadIdentity(){
        try{this.user=await this.api('/auth/me',{},'');}
        catch(e){if(e.status!==401)throw e;this.user=null;this.teams=[];this.team='';this.balance=null;return;}
        this.teams=(await this.api('/orgs',{},'')).filter(t=>!t.demo);
        this.team=this.teams.find(t=>t.slug===this.team)?.slug||this.teams[0]?.slug||'';
        if(this.team)await this.loadBalance();
      },
      async loadBalance(){const team=this.teams.find(t=>t.slug===this.team);if(team)this.balance=(await this.api('/orgs/'+team.org_id+'/balance?limit=1')).balance_micro;},
      async reloadTeam(){this.quote=null;this.run=null;await this.loadBalance();await this.loadHistory();},
      async loadHistory(){if(this.user&&this.team)this.history=await this.api('/web-arena/api/runs');},
      openLogin(){this.remember();this.$refs.login.showModal();},
      closeLogin(){this.$refs.login.close();},
      async sendCode(){this.busy=true;this.authError='';try{const r=await this.api('/auth/email/start',{method:'POST',body:JSON.stringify({email:this.email})},'');this.authStep='code';this.devCode=r.dev_code||'';}catch(e){this.authError=e.message;}finally{this.busy=false;}},
      async verifyCode(){this.busy=true;this.authError='';try{await this.api('/auth/email/verify',{method:'POST',body:JSON.stringify({email:this.email,code:this.code})},'');this.closeLogin();await this.loadIdentity();if(!this.teams.length)this.$refs.teamDialog.showModal();else await this.prepare();}catch(e){this.authError=e.message;}finally{this.busy=false;}},
      async createTeam(){this.busy=true;try{await this.api('/orgs',{method:'POST',body:JSON.stringify({name:this.newTeamName})},'');this.$refs.teamDialog.close();await this.loadIdentity();await this.prepare();}catch(e){this.error=e.message;}finally{this.busy=false;}},
      async logout(){try{await this.api('/auth/logout',{method:'POST'});this.user=null;this.teams=[];this.team='';this.balance=null;this.quote=null;this.run=null;this.history=[];}catch(e){this.error=e.message;}},
      async prepare(){
        this.error='';this.remember();
        if(!this.value.trim()){this.error='Enter a query or URL.';return;}
        if(!this.user){this.openLogin();return;}
        if(!this.team){this.$refs.teamDialog.showModal();return;}
        this.busy=true;
        try{
          const providers=this.selected.length&&this.quote?this.selected:null;
          this.quote=await this.api('/web-arena/api/quotes',{method:'POST',body:JSON.stringify({task:this.task,value:this.value,mode:this.mode,jev:this.jev,providers})});
          if(!providers)this.availableProviders=this.quote.providers;
          this.selected=this.quote.providers.map(p=>p.provider);
          this.balance=this.quote.balance_micro;
        }catch(e){this.error=e.message;this.quote=null;}finally{this.busy=false;}
      },
      async selectionChanged(){
        this.remember();
        if(!this.selected.length){this.error='Select at least one provider.';return;}
        const providers=[...this.selected];this.busy=true;this.error='';
        try{this.quote=await this.api('/web-arena/api/quotes',{method:'POST',body:JSON.stringify({task:this.task,value:this.value,mode:this.mode,jev:this.jev,providers})});}
        catch(e){this.error=e.message;this.quote=null;}finally{this.busy=false;}
      },
      async start(){
        if(!this.quote||!this.selected.length)return;
        this.busy=true;this.error='';
        try{const r=await this.api('/web-arena/api/runs/'+this.quote.id+'/start',{method:'POST'});this.running=true;this.run={id:r.id,state:'running',attempts:[]};await this.poll();this.poller=setInterval(()=>this.poll(),1500);}
        catch(e){this.error=e.message;}finally{this.busy=false;}
      },
      async poll(){if(!this.run)return;try{this.run=await this.api('/web-arena/api/runs/'+this.run.id);if(this.run.state!=='running'){clearInterval(this.poller);this.poller=null;this.running=false;await this.loadHistory();await this.loadBalance();}}catch(e){clearInterval(this.poller);this.poller=null;this.running=false;this.error=e.message;}},
      async loadRun(id){this.error='';try{this.run=await this.api('/web-arena/api/runs/'+id);this.task=this.run.task;this.value=this.run.input;this.mode=this.run.mode;this.jev=this.run.jev;this.quote=null;if(this.run.state==='running'){this.running=true;clearInterval(this.poller);this.poller=setInterval(()=>this.poll(),1500);}}catch(e){this.error=e.message;}},
      newRun(){clearInterval(this.poller);this.poller=null;this.running=false;this.run=null;this.quote=null;this.value='';this.remember();},
      async cancel(){try{await this.api('/web-arena/api/runs/'+this.run.id+'/cancel',{method:'POST'});await this.poll();}catch(e){this.error=e.message;}},
      async rate(a,value){try{await this.api('/web-arena/api/runs/'+this.run.id+'/attempts/'+a.id+'/rating',{method:'POST',body:JSON.stringify({value})});a.rating=value;}catch(e){this.error=e.message;}}
    },
    async mounted(){
      const draft=readDraft();if(draft&&Date.now()-draft.at<600000){this.task=draft.task||'search';this.value=draft.value||'';this.mode=draft.mode==='waterfall'?'waterfall':'battle';this.jev=draft.jev!==false;}
      try{
        if(page==='leaderboard')this.live=await this.api('/web-arena/api/leaderboard',{},'');
        if(page==='benchmark')this.bench=await this.api('/web-arena/api/benchmark',{},'');
        await this.loadIdentity();await this.loadHistory();
        const id=new URLSearchParams(location.search).get('run');if(id&&this.user)await this.loadRun(id);
      }catch(e){this.error=e.message;}
    },
    unmounted(){clearInterval(this.poller);}
  }).mount('#web-arena');
})();
