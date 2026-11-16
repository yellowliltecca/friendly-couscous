'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createSearchService}=require('./search-service');
const VERSION='2.3.0';
function setting(name,fallback,min,max){const n=Number(process.env[name]);return Number.isFinite(n)&&n>=min&&n<=max?n:fallback;}
const SEARCH_TIMEOUT=setting('SEARCH_TOTAL_TIMEOUT_MS',52000,5000,60000);
const UPSTREAM_TIMEOUT=setting('SEARCH_UPSTREAM_TIMEOUT_MS',28000,3000,40000);
const STATIC=new Set(['index.html','business-data.js','business-ui.js','area-controls.js','search-cache.js','search-recovery.js','favicon.ico']);
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.ico':'image/x-icon'};
function fault(message,status=400,code='BAD_REQUEST'){return Object.assign(new Error(message),{status,code});}
function json(res,status,value,headers={}){
  if(res.destroyed||res.writableEnded)return;
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(value));
}
async function readBody(req){
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>32768)throw fault('Request body is too large',413);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch(_){throw fault('Invalid JSON');}
}
async function upstreamJson(url,timeoutMs){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json','User-Agent':'BIZFINDER/2.3 (https://github.com/yellowliltecca/friendly-couscous)'}});
    if(!response.ok)throw fault('Geocoder HTTP '+response.status,502,'GEOCODER_UNAVAILABLE');return await response.json();
  }finally{clearTimeout(timer);}
}
function createGeocoder(){
  const cache=new Map(),inflight=new Map();
  return async q=>{
    q=String(q||'').trim();if(!q||q.length>200)throw fault('Enter a city or address');
    const key=q.toLocaleLowerCase(),hit=cache.get(key);if(hit&&Date.now()-hit.at<86400000)return {...hit.value,cached:true};
    if(inflight.has(key))return inflight.get(key);
    const task=(async()=>{
      let value;
      try{
        const data=await upstreamJson('https://photon.komoot.io/api/?limit=5&lang=ru&q='+encodeURIComponent(q),12000);
        const list=data.features||[],f=list.find(x=>['city','town','village','municipality','administrative'].includes(x.properties?.type))||list[0];
        if(f)value={lat:Number(f.geometry.coordinates[1]),lon:Number(f.geometry.coordinates[0]),label:[f.properties.name,f.properties.state,f.properties.country].filter(Boolean).join(', '),provider:'Photon'};
      }catch(_){/* One geocoder fallback only. */}
      if(!value){
        const data=await upstreamJson('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&accept-language=ru&q='+encodeURIComponent(q),15000);
        const f=data.find(x=>['city','town','village','municipality'].includes(x.type))||data[0];
        if(!f)throw fault('City or address not found',404,'CITY_NOT_FOUND');
        value={lat:Number(f.lat),lon:Number(f.lon),label:f.display_name,provider:'Nominatim'};
      }
      if(!Number.isFinite(value.lat)||!Number.isFinite(value.lon))throw fault('Invalid geocoder coordinates',502,'GEOCODER_UNAVAILABLE');
      cache.set(key,{at:Date.now(),value});while(cache.size>200)cache.delete(cache.keys().next().value);return value;
    })();
    inflight.set(key,task);try{return await task;}finally{inflight.delete(key);}
  };
}
function createApp({rawSearch,geocode=createGeocoder(),root=__dirname,now=Date.now,endpointsCount}={}){
  if(!rawSearch){const {createSearch,OVERPASS}=require('./search');rawSearch=createSearch({requestTimeoutMs:UPSTREAM_TIMEOUT,totalTimeoutMs:SEARCH_TIMEOUT});endpointsCount=OVERPASS.length;}
  const service=createSearchService({search:rawSearch,now}),rate=new Map();
  function limited(req){
    const ip=req.socket.remoteAddress||'unknown',at=now();for(const [key,value]of rate)if(at-value.at>60000)rate.delete(key);
    const entry=rate.get(ip)||{at,count:0};entry.count++;rate.set(ip,entry);return entry.count>60;
  }
  const server=http.createServer(async(req,res)=>{
    const requestId=randomUUID();res.setHeader('X-Request-Id',requestId);
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,version:VERSION,service:'BIZFINDER search proxy',commit:process.env.RENDER_GIT_COMMIT||null,cacheEntries:service.stats().snapshots,upstreams:endpointsCount??null,searchTimeoutMs:SEARCH_TIMEOUT,sharedSearchCache:true});
      if(url.pathname.startsWith('/api/')&&limited(req))return json(res,429,{error:'Too many requests',code:'RATE_LIMIT',requestId},{'Retry-After':'60'});
      if(url.pathname==='/api/geocode'&&req.method==='GET')return json(res,200,await geocode(url.searchParams.get('q')));
      if(url.pathname==='/api/search'&&req.method==='POST'){
        const body=await readBody(req),result=await service.run(body,{force:body.refresh===true});return json(res,200,{...result,version:VERSION,requestId});
      }
      if(url.pathname==='/api/diagnostics'&&req.method==='GET'){
        const query={lat:url.searchParams.get('lat')??51.48,lon:url.searchParams.get('lon')??46.12,radius:url.searchParams.get('radius')??5,category:url.searchParams.get('category')||'all'};
        // Both routes share cached results and identical in-flight requests.
        const result=await service.run(query,{force:url.searchParams.get('refresh')==='1'});
        return json(res,200,{ok:true,version:VERSION,requestId,center:{lat:Number(query.lat),lon:Number(query.lon)},radius:Number(query.radius),count:result.elements.length,provider:result.provider,providerResults:result.providerResults||[],elapsedMs:result.elapsedMs,cached:Boolean(result.cached),stale:Boolean(result.stale),fallback:Boolean(result.fallback),coveragePartial:Boolean(result.coveragePartial),fetchedAt:result.fetchedAt,warning:result.warning||null});
      }
      if(url.pathname.startsWith('/api/'))return json(res,404,{error:'API route not found',code:'API_NOT_FOUND',version:VERSION,requestId});
      if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed'});
      const file=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\//,'');
      if(!STATIC.has(file))return json(res,404,{error:'File not found'});
      let body;try{body=await fs.promises.readFile(path.join(root,file));}catch(_){return json(res,404,{error:'File not found'});}
      if(file==='index.html'){
        const scripts=`<script src="/search-cache.js?v=${VERSION}"></script><script src="/search-recovery.js?v=${VERSION}"></script>`;
        body=Buffer.from(body.toString('utf8').replace(/<\/body>/i,scripts+'</body>'));
      }
      res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);
    }catch(e){
      const status=Number.isInteger(e.status)&&e.status>=400&&e.status<=599?e.status:502;
      json(res,status,{ok:false,error:e.message,code:e.code||'REQUEST_FAILED',details:e.details||null,retryAfter:e.retryAfter||null,requestId,version:VERSION},e.retryAfter?{'Retry-After':String(e.retryAfter)}:{});
    }
  });
  server.searchService=service;return server;
}
if(require.main===module){const server=createApp();server.listen(Number(process.env.PORT||8787),process.env.HOST||'0.0.0.0',()=>console.log(`BIZFINDER ${VERSION} listening`));}
module.exports={createApp,VERSION};
