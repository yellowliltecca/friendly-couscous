'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {Cache,normalize,distance}=require('../search-cache');
const {createSearchService}=require('../search-service');
const {createApp}=require('../server');
const q={lat:51.48,lon:46.12,radius:5,category:'all'};
const shop={type:'node',id:1,lat:q.lat,lon:q.lon,tags:{name:'Test shop',shop:'supermarket'}};
const cafe={type:'way',id:2,center:{lat:q.lat+0.001,lon:q.lon},tags:{name:'Test cafe',amenity:'cafe'}};
const good=()=>({elements:[shop,cafe],provider:'test-provider',elapsedMs:5});
const down=()=>Object.assign(new Error('upstream down'),{status:503,details:{checks:[{host:'test-provider',status:'failed'}]}});
test('invalid search input cannot become a valid zero coordinate',()=>{
  for(const x of [{...q,lat:null},{...q,lon:''},{...q,radius:0},{...q,lat:100},{...q,category:'invalid'},{...q,lon:NaN}])assert.throws(()=>normalize(x));
  assert.deepEqual(normalize({...q,lat:String(q.lat)}),q);
});
test('distance and coordinates keep only records inside requested radius',()=>{
  assert.equal(distance(q,q),0);assert.ok(distance(q,{lat:52.48,lon:46.12})>110);
  const c=new Cache();c.put(q,{elements:[shop,{...shop,lat:null},{...shop,lat:55}],provider:'test'});assert.equal(c.get(q).elements.length,1);
});
test('cache returns defensive copies',()=>{const c=new Cache();c.put(q,good());c.get(q).elements.length=0;assert.equal(c.get(q).elements.length,2);});
test('success is reused without repeating upstream requests',async()=>{
  let calls=0;const s=createSearchService({search:async()=>{calls++;return good();}});await s.run(q);assert.equal((await s.run(q)).cached,true);assert.equal(calls,1);
});
test('identical concurrent requests are coalesced',async()=>{
  let calls=0,release;const s=createSearchService({search:()=>{calls++;return new Promise(r=>release=r);}});
  const a=s.run(q),b=s.run(q);release(good());assert.equal((await Promise.all([a,b]))[1].elements.length,2);assert.equal(calls,1);
});
test('stale results carry original timestamp, not a false refresh date',async()=>{
  let time=0,calls=0;const s=createSearchService({now:()=>time,search:async()=>{calls++;return good();}});await s.run(q);time=700000;const r=await s.run(q);
  assert.equal(r.stale,true);assert.equal(r.fetchedAt,'1970-01-01T00:00:00.000Z');assert.equal(calls,1);
});
test('explicit refresh calls upstream',async()=>{
  let calls=0;const s=createSearchService({search:async()=>{calls++;return good();}});await s.run(q);assert.equal((await s.run(q,{force:true})).cached,false);assert.equal(calls,2);
});
test('refresh outage returns actual stored records and provider diagnostics',async()=>{
  let calls=0;const s=createSearchService({search:async()=>{if(calls++)throw down();return good();}});await s.run(q);const r=await s.run(q,{force:true});
  assert.equal(r.fallback,true);assert.equal(r.elements.length,2);assert.equal(r.upstreamError.details.checks[0].status,'failed');
});
test('first-ever outage remains 503, never a successful empty list',async()=>{
  const s=createSearchService({search:async()=>{throw down();}});await assert.rejects(s.run(q),{status:503});assert.equal(s.stats().snapshots,0);
});
test('cooldown prevents repeated clicks hammering providers',async()=>{
  let calls=0;const s=createSearchService({search:async()=>{calls++;throw down();}});await assert.rejects(s.run(q));await assert.rejects(s.run(q),e=>e.code==='SOURCE_COOLDOWN'&&e.retryAfter>0);assert.equal(calls,1);
});
test('empty result expires quickly and cannot be served stale',()=>{
  let time=0;const c=new Cache({now:()=>time});c.put(q,{elements:[],provider:'test'});assert.deepEqual(c.get(q).elements,[]);time=31000;assert.equal(c.get(q,{allowStale:true}),null);
});
test('category filtering can reuse all-business results',()=>{const c=new Cache();c.put(q,good());const r=c.get({...q,category:'cafe'});assert.equal(r.elements.length,1);assert.equal(r.derived,true);});
test('category-only data cannot answer an all-business search',()=>{const c=new Cache();c.put({...q,category:'cafe'},{elements:[cafe]});assert.equal(c.get(q),null);});
test('data from different cities never mixes',()=>{const c=new Cache();c.put(q,good());assert.equal(c.get({...q,lat:55.75,lon:37.62},{allowPartial:true,allowStale:true}),null);});
test('contained smaller circle uses cached data',()=>{const c=new Cache();c.put(q,good());const r=c.get({...q,radius:1});assert.equal(r.elements.length,2);assert.equal(r.coveragePartial,false);});
test('overlapping circle requires explicit partial fallback',()=>{
  const c=new Cache();c.put(q,good());const other={...q,lat:q.lat+0.01};assert.equal(c.get(other),null);assert.equal(c.get(other,{allowPartial:true}).coveragePartial,true);
});
test('empty subset is not confused with confirmed no businesses',()=>{const c=new Cache();c.put(q,good());assert.equal(c.get({...q,category:'bar'}),null);});
test('Overpass runtime errors cannot enter cache',()=>{const c=new Cache();assert.throws(()=>c.put(q,{elements:[],remark:'runtime error'}));assert.throws(()=>c.put(q,{ok:true}));});
test('persistence restores results and skips corrupt records',()=>{
  const c=new Cache();c.put(q,good());const saved=c.export();saved.entries.push({query:{lat:'bad'},result:{},savedAt:Date.now()});const next=new Cache();next.restore(saved);assert.equal(next.get(q).elements.length,2);
});
test('cache bounds memory and ignores oversized entries',()=>{
  const c=new Cache({maxEntries:1});c.put(q,good());c.put({...q,radius:4},good());assert.equal(c.entries.size,1);const tiny=new Cache({maxBytes:5});tiny.put(q,good());assert.equal(tiny.entries.size,0);
});
test('partial source metadata survives persistence',()=>{const c=new Cache();c.put(q,{...good(),partial:true});assert.equal(c.get(q).coveragePartial,true);});
async function withServer(fn,search){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bizfinder-test-'));fs.writeFileSync(path.join(root,'index.html'),'<html><body><main>Test</main></body></html>');
  const server=createApp({rawSearch:search||(async()=>good()),root,geocode:async()=>({lat:q.lat,lon:q.lon,label:'Test city'})});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{await fn('http://127.0.0.1:'+server.address().port,server);}finally{await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
}
test('HTTP diagnostics warms POST search cache',async()=>{
  let calls=0;await withServer(async base=>{
    const d=await(await fetch(base+'/api/diagnostics?lat=51.48&lon=46.12&radius=5')).json();assert.equal(d.count,2);
    const response=await fetch(base+'/api/search',{method:'POST',body:JSON.stringify(q)}),data=await response.json();
    assert.equal(response.status,200);assert.equal(data.elements.length,2);assert.equal(data.cached,true);assert.equal(data.version,'2.3.0');assert.ok(data.requestId);assert.equal(calls,1);
  },async()=>{if(calls++)throw down();return good();});
});
test('HTTP failure includes details and request id, not invented elements',async()=>{
  await withServer(async base=>{const r=await fetch(base+'/api/search',{method:'POST',body:JSON.stringify(q)}),d=await r.json();assert.equal(r.status,503);assert.ok(d.details.checks);assert.ok(d.requestId);assert.equal(d.elements,undefined);},async()=>{throw down();});
});
test('HTTP validates input and identifies missing API route',async()=>{await withServer(async base=>{
  assert.equal((await fetch(base+'/api/search',{method:'POST',body:JSON.stringify({...q,lat:null})})).status,400);
  assert.equal((await(await fetch(base+'/api/no-route')).json()).code,'API_NOT_FOUND');
});});
test('HTML receives recovery scripts in order; server source is not public',async()=>{await withServer(async base=>{
  const r=await fetch(base+'/'),html=await r.text();assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((html.match(/search-recovery\.js/g)||[]).length,1);assert.ok(html.indexOf('search-cache.js')<html.indexOf('search-recovery.js'));assert.equal((await fetch(base+'/server.js')).status,404);
});});
function harness(fetchImpl,initial={}){
  const storage=new Map(Object.entries(initial)),nodes={};
  function node(){return {children:[],textContent:'',disabled:false,hidden:false,events:{},append(...xs){this.children.push(...xs);},after(x){this.children.push(x);},setAttribute(){},addEventListener(name,fn){this.events[name]=fn;}};}
  nodes.cityStatus=node();nodes.searchBtn=node();nodes.city={value:'Test city'};
  const c={console,Date,Map,Set,JSON,Math,Promise,URL,AbortController,setTimeout,clearTimeout,fetch:fetchImpl,
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},document:{createElement:node,getElementById:id=>nodes[id]||null,head:node()},
    fetchBusinesses:()=>{},geocodeCity:()=>{},overpassCategory:()=>'all',normalizeOsmElements:els=>els.map(el=>({id:el.id,name:el.tags.name})),searchBusinesses:()=>Promise.resolve()};
  c.window=c;c.globalThis=c;vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../search-cache.js'),'utf8'),c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../search-recovery.js'),'utf8'),c);
  return {c,storage,panel:nodes.cityStatus.children[0]};
}
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
test('browser restores a successful search after page reload and upstream outage',async()=>{
  let calls=0;const a=harness(async()=>{calls++;return response({...good(),fetchedAt:new Date().toISOString()});});await a.c.fetchBusinesses({lat:q.lat,lng:q.lon},5);
  const b=harness(async()=>{throw new Error('network unavailable');},Object.fromEntries(a.storage));const r=await b.c.fetchBusinesses({lat:q.lat,lng:q.lon},5);assert.equal(r.businesses.length,2);assert.equal(r.cached,true);assert.equal(calls,1);
});
test('browser refresh outage preserves CRM and marks stale fallback',async()=>{
  let online=true;const h=harness(async()=>online?response({...good(),fetchedAt:new Date().toISOString()}):response({error:'down',requestId:'test-id',details:{checks:[]}},503),{bizfinder_data:'keep-crm'});
  await h.c.fetchBusinesses({lat:q.lat,lng:q.lon},5);online=false;h.c.searchBusinesses=()=>h.c.fetchBusinesses({lat:q.lat,lng:q.lon},5);h.panel.children[2].events.click();await new Promise(r=>setTimeout(r,10));
  assert.match(h.panel.children[1].textContent,/\u043d\u0435 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u044b/);assert.equal(h.storage.get('bizfinder_data'),'keep-crm');assert.equal(h.panel.children[3].hidden,false);
});
test('browser first-ever outage remains an error with its request id',async()=>{
  const h=harness(async()=>response({error:'down',requestId:'abc'},503));await assert.rejects(h.c.fetchBusinesses({lat:q.lat,lng:q.lon},5));assert.match(h.panel.children[3].children[1].textContent,/abc/);
});
test('browser shows stale date instead of presenting saved data as new',async()=>{
  const c=new Cache();c.put(q,good(),Date.now()-700000);const h=harness(async()=>{throw new Error('should not fetch');},{bizfinder_search_snapshots_v1:JSON.stringify(c.export())});const r=await h.c.fetchBusinesses({lat:q.lat,lng:q.lon},5);assert.equal(r.stale,true);assert.match(h.panel.children[1].textContent,/\u043d\u0435 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u044b/);
});
test('browser caches geocodes for each city separately',async()=>{
  let calls=0;const h=harness(async()=>{calls++;return response({lat:q.lat,lon:q.lon,label:'City'});});await h.c.geocodeCity('City A');await h.c.geocodeCity('city a');await h.c.geocodeCity('City B');assert.equal(calls,2);
});
test('refresh retains the last explicitly selected map center',async()=>{
  let options;const h=harness(async()=>response({...good(),fetchedAt:new Date().toISOString()}));await h.c.fetchBusinesses({lat:q.lat,lng:q.lon,custom:true},5);h.c.searchBusinesses=x=>{options=x;return Promise.resolve();};h.panel.children[2].events.click();assert.equal(options.center.lat,q.lat);assert.equal(options.center.custom,true);
});
