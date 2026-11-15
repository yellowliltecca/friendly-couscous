'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { createSearch, OVERPASS } = require('./search');
const VERSION = '2.1.0';

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 10 * 60 * 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 28000);
const SEARCH_UPSTREAM_TIMEOUT_MS = Number(process.env.SEARCH_UPSTREAM_TIMEOUT_MS || 28000);
const SEARCH_TOTAL_TIMEOUT_MS = Number(process.env.SEARCH_TOTAL_TIMEOUT_MS || 52000);
const MAX_BODY = 32 * 1024;
const cache = new Map();
const inflight = new Map();
const rate = new Map();
const searchOverpass = createSearch({ requestTimeoutMs: SEARCH_UPSTREAM_TIMEOUT_MS, totalTimeoutMs: SEARCH_TOTAL_TIMEOUT_MS });
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.ico':'image/x-icon', '.txt':'text/plain; charset=utf-8' };
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
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res,200,{ok:true,version:VERSION,service:'BIZFINDER search proxy',cacheEntries:cache.size,upstreams:OVERPASS.length,searchTimeoutMs:SEARCH_TOTAL_TIMEOUT_MS});
  if (req.method === 'GET' && url.pathname === '/api/diagnostics') {
    const lat=cleanNum(url.searchParams.get('lat')||51.48,-85,85);
    const lon=cleanNum(url.searchParams.get('lon')||46.12,-180,180);
    const radius=cleanNum(url.searchParams.get('radius')||5,1,50);
    try {
      const result=await searchOverpass(lat,lon,radius,'all');
      return json(res,200,{ok:true,version:VERSION,center:{lat,lon},radius,count:result.elements.length,provider:result.provider,queryMode:result.queryMode||null,providerResults:result.providerResults||[],elapsedMs:result.elapsedMs,warning:result.warning||null});
    } catch(e) {
      return json(res,e.status||502,{ok:false,version:VERSION,center:{lat,lon},radius,error:e.message,details:e.details||null});
    }
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
      const task=searchOverpass(lat,lon,radius,category).then(value=>{cache.set(key,{value,expires:Date.now()+(value.elements.length ? CACHE_TTL_MS : 30000)});return value;}).finally(()=>inflight.delete(key));
      inflight.set(key,task); const result=await task; return json(res,200,{...result,cached:false});
    } catch(e) { return json(res,e.status||400,{error:e.message,details:e.details||null}); }
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req,res,url);
  return json(res,405,{error:'Method not allowed'});
});
server.listen(PORT,HOST,()=>console.log(`BIZFINDER running at http://localhost:${PORT}`));
