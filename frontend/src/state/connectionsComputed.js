// Connections: every account and key the team holds, and every provider one can be added for.
const byName = new Intl.Collator()
// Accounts that need a person come first, in the order a person should deal with them.
const RANK = {reconnect:0, second:1, failing:2, setup:3, choose:4, ok:5}

export default {
connCount(){ const m={}; for(const c of this.connections){ if(c.provider) m[c.provider]=(m[c.provider]||0)+1; } return m; },
// A provider key saved as a secret NAMED for the provider (`treg secret add apollo …`, or a
    // Secrets row) rather than connected. The credential ladder uses it
    // all the same, so it belongs beside the connections, not among the team's own-tool secrets.
    // A connected credential for the same provider wins over it, and the card says so.
    namedKeys(){
      const ids=new Set(this.connections.map(c=>c.id));
      const pasted=new Map(this.keyNameSuggestions.map(p=>[p.service,p]));
      return this.secrets.filter(s=>!ids.has(s.id) && pasted.has(s.name))
        .map(s=>({s, p:pasted.get(s.name), shadowed:!!this.connCount[s.name]}));
    },
// What the Secrets page lists: the credentials the team's own tools use, and nothing Connections shows.
    ownSecrets(){
      const shown=new Set([...this.connections.map(c=>c.id), ...this.namedKeys.map(k=>k.s.id)]);
      return this.secrets.filter(s=>!shown.has(s.id));
    },
connAccounts(){
      return this.connections.map(c=>{ const p=this.connProvider(c);
          return {c, p, name:(p&&p.display_name)||c.provider||c.name, st:this.connState(c)}; })
        .sort((a,b)=>RANK[a.st.key]-RANK[b.st.key] || byName.compare(a.name, b.name));
    },
connAttention(){ return this.connAccounts.filter(a=>a.st.key!=='ok').length; },
// The providers this server can connect: one it holds no client credentials for could only show a
    // button that does nothing. An account already connected to one still shows under Connected.
    connectable(){ return this.providers.filter(p=>p.configured); },
// The connectable providers the filter box matches, before the sign-in / key choice.
    connMatches(){
      const q=this.connQ.trim().toLowerCase();
      return q ? this.connectable.filter(p=>[p.display_name, p.service, p.summary, p.category].join(' ').toLowerCase().includes(q))
        : this.connectable;
    },
// The sign-in / key choice, each counting what it would show under the typed filter.
    connKinds(){
      const signIn=this.connMatches.filter(p=>!this.pastedCredential(p)).length;
      return [
        {key:'', label:'All', n:this.connMatches.length, hint:'Every provider you can connect'},
        {key:'signin', label:'Sign in', n:signIn, hint:'Approve access with an account you already have: nothing to copy'},
        {key:'key', label:'API key', n:this.connMatches.length-signIn, hint:'Paste a key from the provider'},
      ];
    },
// Every provider an account or key can be added for, by category. /oauth/providers already
    // returns them grouped then alphabetical, so this walks the list once and starts a shelf
    // whenever the category changes. Within a shelf, the sign-in providers come first: an account
    // the team already holds is the likelier errand than a vendor key, and the sort is stable, so
    // each half keeps the registry's order.
    providerGroups(){
      const kind=this.connKind, pasted=p=>this.pastedCredential(p);
      const out=[];
      for(const p of this.connMatches){
        if(kind && (kind==='key')!==pasted(p)) continue;
        const cat=p.category||'Other';
        if(!out.length || out[out.length-1].category!==cat) out.push({category:cat, items:[]});
        out[out.length-1].items.push(p);
      }
      for(const g of out) g.items.sort((a,b)=>pasted(a)-pasted(b));
      return out;
    },
}
