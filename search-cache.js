/* Public provider results only. CRM notes and outreach history are not cached here. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BizfinderSearchCache = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const categories = new Set(['all','restaurant','cafe','bar','barber','beauty','fitness','auto','medical','florist','shop','office']);
  const copy = value => JSON.parse(JSON.stringify(value));
  function number(value,min,max) {
    if (!['number','string'].includes(typeof value) || String(value).trim() === '') throw new Error('Invalid search coordinates or radius');
    const n=Number(value); if (!Number.isFinite(n)||n<min||n>max) throw new Error('Invalid search coordinates or radius'); return n;
  }
  function normalize(input) {
    if (!input||typeof input!=='object') throw new Error('Invalid search request');
    const q={lat:number(input.lat,-85,85),lon:number(input.lon,-180,180),radius:number(input.radius,0.1,50),category:input.category||'all'};
    if (!categories.has(q.category)) throw new Error('Unknown business category'); return q;
  }
  function key(input) {const q=normalize(input);return [q.lat,q.lon,q.radius,q.category].join(':');}
  function distance(a,b) {
    const rad=n=>n*Math.PI/180,h=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lon-a.lon)/2)**2;
    return 6371*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
  }
  function matches(el,category) {
    const t=el.tags||{};
    if(category==='all')return true;
    if(['restaurant','cafe','bar'].includes(category))return t.amenity===category;
    if(category==='barber')return t.shop==='hairdresser';
    if(category==='beauty')return t.shop==='beauty';
    if(category==='fitness')return ['fitness_centre','sports_centre'].includes(t.leisure);
    if(category==='auto')return t.shop==='car_repair';
    if(category==='medical')return ['clinic','doctors','dentist','pharmacy'].includes(t.amenity);
    if(category==='florist')return t.shop==='florist';
    return category==='shop'?Boolean(t.shop):category==='office'&&Boolean(t.office);
  }
  function within(el,q) {
    const p=el.center||el;if(!p||p.lat==null||p.lon==null)return false;
    const lat=Number(p.lat),lon=Number(p.lon);
    return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180&&distance(q,{lat,lon})<=q.radius+0.00001&&matches(el,q.category);
  }
  class Cache {
    constructor({now=Date.now,freshMs=600000,staleMs=604800000,emptyMs=30000,maxEntries=30,maxBytes=8000000}={}) {
      Object.assign(this,{now,freshMs,staleMs,emptyMs,maxEntries,maxBytes});this.entries=new Map();
    }
    put(input,result,savedAt=this.now()) {
      const query=normalize(input);
      if(!Array.isArray(result?.elements)||result.error||result.remark)throw new Error('Cannot cache an unsuccessful search');
      const elements=result.elements.filter(el=>el&&typeof el==='object'&&within(el,query));
      const coveragePartial=Boolean(result.coveragePartial||result.partial||result.truncated);
      if(!elements.length&&(coveragePartial||result.stale))return;
      const value=copy({query,savedAt,result:{...result,elements,coveragePartial,cached:false,stale:false,fallback:false}});
      const bytes=JSON.stringify(value).length*2,id=key(query);if(bytes>this.maxBytes)return;
      this.entries.delete(id);this.entries.set(id,{...value,bytes});this.trim();
    }
    trim() {
      const now=this.now();for(const [id,e]of this.entries)if(now-e.savedAt>this.staleMs||e.savedAt>now+60000)this.entries.delete(id);
      let bytes=[...this.entries.values()].reduce((n,e)=>n+e.bytes,0);
      while(this.entries.size>this.maxEntries||bytes>this.maxBytes){const [id,e]=this.entries.entries().next().value;bytes-=e.bytes;this.entries.delete(id);}
    }
    get(input,{allowStale=false,allowPartial=false}={}) {
      const q=normalize(input),id=key(q);this.trim();
      const candidates=[...this.entries.entries()].sort((a,b)=>Number(b[0]===id)-Number(a[0]===id)||b[1].savedAt-a[1].savedAt);
      for(const [storedKey,e]of candidates){
        if(e.query.category!=='all'&&e.query.category!==q.category)continue;
        const exact=storedKey===id,offset=distance(e.query,q),contained=offset+q.radius<=e.query.radius+0.00001;
        if(!exact&&!contained&&!allowPartial)continue;
        if(!exact&&offset>e.query.radius+q.radius)continue;
        const ageMs=Math.max(0,this.now()-e.savedAt),stale=ageMs>(e.result.elements.length?this.freshMs:this.emptyMs);
        if(stale&&(!allowStale||!e.result.elements.length))continue;
        const elements=e.result.elements.filter(el=>within(el,q));if(!elements.length&&!exact)continue;
        return copy({...e.result,elements,cached:true,stale,ageMs,fetchedAt:new Date(e.savedAt).toISOString(),queryRadiusKm:q.radius,coveragePartial:Boolean(e.result.coveragePartial)||(!exact&&!contained),derived:!exact,savedArea:e.query,cacheKind:'snapshot'});
      }
      return null;
    }
    export(){this.trim();return {schema:1,entries:[...this.entries.values()].map(({query,result,savedAt})=>({query,result,savedAt}))};}
    restore(value){
      if(value?.schema!==1||!Array.isArray(value.entries))return;
      for(const e of value.entries.slice(-this.maxEntries))try{if(Number.isFinite(e.savedAt)&&e.savedAt<=this.now()+60000&&this.now()-e.savedAt<=this.staleMs)this.put(e.query,e.result,e.savedAt);}catch(_){/* Skip corrupt entry. */}
    }
  }
  return {Cache,normalize,key,distance,matches,within};
});
