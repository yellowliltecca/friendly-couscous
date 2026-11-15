'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 10 * 60 * 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 14000);
const SEARCH_TOTAL_TIMEOUT_MS = Number(process.env.SEARCH_TOTAL_TIMEOUT_MS || 52000);
const MAX_BODY = 32 * 1024;
const cache = new Map();
const inflight = new Map();
const rate = new Map();
const OVERPASS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://ovp.dresel.systems/api/interpreter'
];

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.ico':'image/x-icon', '.txt':'text/plain; charset=utf-8' };
const CATEGORY = {
  restaurant: '[amenity="restaurant"]', cafe: '[amenity="cafe"]', bar: '[amenity="bar"]',
  barber: '[shop="hairdresser"]', beauty: '[shop="beauty"]', fitness: '[leisure="fitness_centre"]',
  auto: '[shop="car_repair"]', medical: '[amenity~"^(clinic|doctors|dentist|pharmacy)$"]',
  florist: '[shop="florist"]', shop: '[shop]', office: '[office]'
};

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''; req.setEncoding('utf8');
    req.on('data', chunk => { data += chunk; if (data.length > MAX_BODY) { reject(new Error('Слишком большой запрос')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Некорректный JSON')); } });
    req.on('error', reject);
  });
}
function limited(req) {
  const ip = req.socket.remoteAddress || 'unknown'; const now = Date.now();
  const entry = rate.get(ip) || { start: now, count: 0 };
  if (now - entry.start > 60000) { entry.start = now; entry.count = 0; }
  entry.count++; rate.set(ip, entry);
  return entry.count > 30;
}
function cleanNum(v, min, max) { const n = Number(v); if (!Number.isFinite(n)) throw new Error('Некорректные координаты или радиус'); return Math.min(max, Math.max(min, n)); }
function makeQuery(lat, lon, radius, category) {
  const km = Number(radius);
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.max(0.15, Math.cos(lat * Math.PI / 180)));
  const box = `${(lat-dLat).toFixed(5)},${(lon-dLon).toFixed(5)},${(lat+dLat).toFixed(5)},${(lon+dLon).toFixed(5)}`;
  if (CATEGORY[category]) {
    return `[out:json][timeout:18];(nwr(${box})[name]${CATEGORY[category]};);out center tags 250;`;
  }
  // Single regex selector: avoid six separate scans over the same area.
  return `[out:json][timeout:18];(nwr(${box})[name][~"^(amenity|shop|office|craft|leisure|tourism)$"~"."];);out center tags 350;`;
}

async function upstream(url, options, timeout = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, redirect:'follow', headers: {
      'User-Agent':'BIZFINDER/1.0 (business discovery; server-side proxy)',
      'Accept':'*/*', 'Accept-Language':'ru,en;q=0.8', ...(options.headers || {})
    }});
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0,160).replace(/\s+/g,' ')}` : ''}`);
    let data; try { data = JSON.parse(text); } catch { throw new Error('Источник вернул ответ не в формате JSON'); }
    return data;
  } catch (e) { if (e.name === 'AbortError') throw new Error('Превышено время ожидания источника'); throw e; }
  finally { clearTimeout(timer); }
}
function distanceKm(lat1,lon1,lat2,lon2){const rad=x=>x*Math.PI/180;const dLat=rad(lat2-lat1),dLon=rad(lon2-lon1);const a=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));}
async function searchOverpass(lat, lon, radius, category) {
  const query=makeQuery(lat,lon,radius,category);
  const started=Date.now();
  const checks=await Promise.all(OVERPASS.map(async endpoint=>{
    const host=new URL(endpoint).hostname, attemptStarted=Date.now();
    try {
      let data;
      try {
        data=await upstream(`${endpoint}?data=${encodeURIComponent(query)}`,{method:'GET'},9000);
      } catch(getError) {
        if(/HTTP (400|405|406|413|414|415|429)/.test(getError.message)){
          const body=new URLSearchParams({data:query}).toString();
          data=await upstream(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},body},6000);
        } else throw getError;
      }
      if(!data||!Array.isArray(data.elements))throw new Error('Источник вернул JSON без массива elements');
      const elements=data.elements.filter(el=>{
        const p=el.center||el;
        return Number.isFinite(+p.lat)&&Number.isFinite(+p.lon)&&distanceKm(lat,lon,+p.lat,+p.lon)<=radius;
      });
      return {ok:true,host,elements,elapsedMs:Date.now()-attemptStarted};
    } catch(e) {
      return {ok:false,host,error:e.message,elapsedMs:Date.now()-attemptStarted};
    }
  }));
  const successful=checks.filter(x=>x.ok);
  const nonEmpty=successful.filter(x=>x.elements.length>0).sort((a,b)=>b.elements.length-a.elements.length);
  if(nonEmpty.length){
    const best=nonEmpty[0];
    return {elements:best.elements,provider:best.host,providerResults:successful.map(x=>({host:x.host,count:x.elements.length,elapsedMs:x.elapsedMs})),timestamp:new Date().toISOString(),elapsedMs:Date.now()-started,queryRadiusKm:radius};
  }
  if(successful.length){
    return {elements:[],provider:successful[0].host,providerResults:successful.map(x=>({host:x.host,count:0,elapsedMs:x.elapsedMs})),warning:'Все ответившие источники вернули 0 объектов. Это не доказывает отсутствие бизнесов: проверьте город, радиус и покрытие OpenStreetMap.',timestamp:new Date().toISOString(),elapsedMs:Date.now()-started,queryRadiusKm:radius};
  }
  const details=checks.map(x=>x.host+': '+x.error).join(' | ');
  const err=new Error('Ни один источник организаций не ответил. '+details);
  err.status=502;
  err.details={elapsedMs:Date.now()-started,attempted:checks.length,checks:checks.map(({host,error,elapsedMs})=>({host,error,elapsedMs}))};
  throw err;
}
async function geocode(q) {
  const key = `geo:${q.toLowerCase()}`; const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return { ...hit.value, cached:true };
  const photonUrl = `https://photon.komoot.io/api/?limit=5&lang=ru&q=${encodeURIComponent(q)}`;
  try {
    const data = await upstream(photonUrl, { method:'GET' }, 12000);
    const features = data.features || [];
    if (features.length) {
      const f = features.find(x => ['city','town','village','municipality','administrative'].includes(x.properties?.type)) || features[0];
      const [lon,lat] = f.geometry.coordinates;
      const value = { lat:+lat, lon:+lon, label:[f.properties.name,f.properties.state,f.properties.country].filter(Boolean).join(', '), provider:'Photon' };
      cache.set(key,{value,expires:Date.now()+CACHE_TTL_MS}); return value;
    }
  } catch (_) { /* Nominatim fallback below */ }
  const nomUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&accept-language=ru&q=${encodeURIComponent(q)}`;
  const data = await upstream(nomUrl,{method:'GET'},15000);
  if (!data.length) { const e = new Error('Город или адрес не найден'); e.status=404; throw e; }
  const f = data.find(x => ['city','town','village','municipality'].includes(x.type)) || data[0];
  const value = { lat:+f.lat, lon:+f.lon, label:f.display_name, provider:'Nominatim' };
  cache.set(key,{value,expires:Date.now()+CACHE_TTL_MS}); return value;
}
async function serveStatic(req,res,url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(ROOT, '.' + pathname);
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT,'index.html')) return json(res,403,{error:'Forbidden'});
  let stat; try { stat = await fs.promises.stat(file); } catch { return json(res,404,{error:'Файл не найден'}); }
  if (!stat.isFile()) return json(res,404,{error:'Файл не найден'});
  res.writeHead(200, { 'Content-Type':MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff' });
  fs.createReadStream(file).pipe(res);
}
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,POST,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type' }); return res.end(); }
  if (url.pathname.startsWith('/api/') && limited(req)) return json(res,429,{error:'Слишком много запросов. Подождите минуту и повторите.'});
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res,200,{ok:true,version:'1.6.0',service:'BIZFINDER search proxy',cacheEntries:cache.size,upstreams:OVERPASS.length,searchTimeoutMs:SEARCH_TOTAL_TIMEOUT_MS});
  if (req.method === 'GET' && url.pathname === '/api/diagnostics') {
    const lat=cleanNum(url.searchParams.get('lat')||51.48,-85,85);
    const lon=cleanNum(url.searchParams.get('lon')||46.12,-180,180);
    const query=makeQuery(lat,lon,2,'restaurant');
    const checks=[];
    for (const endpoint of OVERPASS) {
      const host=new URL(endpoint).hostname, started=Date.now();
      try {
        const data=await upstream(`${endpoint}?data=${encodeURIComponent(query)}`,{method:'GET'},7000);
        if(!data||!Array.isArray(data.elements)) throw new Error('Invalid Overpass JSON');
        checks.push({host,ok:true,status:200,count:data.elements.length,elapsedMs:Date.now()-started});
      } catch(e) {
        checks.push({host,ok:false,error:e.message,elapsedMs:Date.now()-started});
      }
    }
    return json(res,200,{ok:checks.some(x=>x.ok),version:'1.5.1',testedAt:new Date().toISOString(),center:{lat,lon},checks});
  }

  if (req.method === 'GET' && url.pathname === '/api/geocode') {
    try { const q=(url.searchParams.get('q')||'').trim(); if(!q) return json(res,400,{error:'Введите город или адрес'}); return json(res,200,await geocode(q)); }
    catch(e){ return json(res,e.status||502,{error:e.message}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/search') {
    try {
      const body = await readBody(req);
      const lat=cleanNum(body.lat,-85,85), lon=cleanNum(body.lon,-180,180), radius=cleanNum(body.radius,1,50);
      const category=String(body.category||'all');
      const key=`search:${lat.toFixed(4)}:${lon.toFixed(4)}:${radius}:${category}`;
      const hit=cache.get(key); if(hit && hit.expires>Date.now()) return json(res,200,{...hit.value,cached:true});
      if(inflight.has(key)) return json(res,200,{...(await inflight.get(key)),cached:true});
      const task=searchOverpass(lat,lon,radius,category).then(value=>{cache.set(key,{value,expires:Date.now()+CACHE_TTL_MS});return value;}).finally(()=>inflight.delete(key));
      inflight.set(key,task); const result=await task; return json(res,200,{...result,cached:false});
    } catch(e) { return json(res,e.status||400,{error:e.message,details:e.details||null}); }
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req,res,url);
  return json(res,405,{error:'Method not allowed'});
});
server.listen(PORT,HOST,()=>console.log(`BIZFINDER running at http://localhost:${PORT}`));
