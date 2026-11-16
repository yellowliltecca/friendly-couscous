/* Loaded after the app; existing CRM and map handlers are preserved. */
(function(){
  'use strict';
  if(!window.BizfinderSearchCache||typeof window.fetchBusinesses!=='function')return;
  const {Cache,normalize}=window.BizfinderSearchCache;
  const cache=new Cache({maxEntries:8,maxBytes:1800000});
  const CACHE_KEY='bizfinder_search_snapshots_v1',GEO_KEY='bizfinder_geocodes_v1';
  const M={
    title:'\u0414\u0430\u043d\u043d\u044b\u0435 \u043f\u043e\u0438\u0441\u043a\u0430',
    ready:'\u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u044b \u0441\u043e\u0445\u0440\u0430\u043d\u044f\u044e\u0442\u0441\u044f \u0432 \u044d\u0442\u043e\u043c \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435.',
    refresh:'\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u0438\u0437 \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u0430',
    retry:'\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c \u043f\u043e\u0438\u0441\u043a',
    loading:'\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043c \u0434\u0430\u043d\u043d\u044b\u0435\u2026',
    live:'\u041f\u043e\u043b\u0443\u0447\u0435\u043d\u043e \u0438\u0437 \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u0430',
    cached:'\u0418\u0437 \u043a\u044d\u0448\u0430',
    saved:'\u0421\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435; \u043d\u0435 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u044b',
    partial:'\u041f\u043e\u043a\u0430\u0437\u0430\u043d\u0430 \u0442\u043e\u043b\u044c\u043a\u043e \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u0430\u044f \u0447\u0430\u0441\u0442\u044c \u043e\u0431\u043b\u0430\u0441\u0442\u0438.',
    unavailable:'\u0418\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u0438 \u0441\u0435\u0439\u0447\u0430\u0441 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b. \u0414\u043b\u044f \u044d\u0442\u043e\u0439 \u043e\u0431\u043b\u0430\u0441\u0442\u0438 \u0435\u0449\u0451 \u043d\u0435\u0442 \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0445 \u0434\u0430\u043d\u043d\u044b\u0445.',
    details:'\u041f\u043e\u0434\u0440\u043e\u0431\u043d\u043e\u0441\u0442\u0438 \u043e\u0448\u0438\u0431\u043a\u0438',
    invalid:'\u041d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 \u043e\u0442\u0432\u0435\u0442 \u0441\u0435\u0440\u0432\u0435\u0440\u0430',
    geo:'\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0438\u0442\u044c \u0433\u043e\u0440\u043e\u0434. \u0423\u0442\u043e\u0447\u043d\u0438\u0442\u0435 \u0433\u043e\u0440\u043e\u0434 \u0438 \u0441\u0442\u0440\u0430\u043d\u0443.'
  };
  let geocodes={},forceNext=false,lastCenter=null,lastCity=null;
  try{cache.restore(JSON.parse(localStorage.getItem(CACHE_KEY)||'null'));}catch(_){}
  try{geocodes=JSON.parse(localStorage.getItem(GEO_KEY)||'{}')||{};}catch(_){}
  if(typeof geocodes!=='object'||Array.isArray(geocodes))geocodes={};
  const panel=document.createElement('div');panel.className='search-data-state';panel.id='searchDataState';
  const heading=document.createElement('strong');heading.textContent=M.title+' \u00b7 2.3.0';
  const text=document.createElement('p');text.setAttribute('role','status');text.setAttribute('aria-live','polite');text.textContent=M.ready;
  const refresh=document.createElement('button');refresh.type='button';refresh.className='btn secondary full smallbtn';refresh.textContent=M.refresh;
  const details=document.createElement('details'),summary=document.createElement('summary'),debug=document.createElement('pre');
  summary.textContent=M.details;details.append(summary,debug);details.hidden=true;panel.append(heading,text,refresh,details);
  document.getElementById('cityStatus')?.after(panel);
  const style=document.createElement('style');
  style.textContent='.search-data-state{margin-top:12px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--ice);font-size:12px;line-height:1.5}.search-data-state p{margin:8px 0;overflow-wrap:anywhere}.search-data-state button{min-height:44px}.search-data-state pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}.search-data-state summary{cursor:pointer;padding:10px 0}';document.head.append(style);
  refresh.addEventListener('click',()=>{
    if(document.getElementById('searchBtn').disabled)return;
    forceNext=true;
    const sameCity=document.getElementById('city')?.value===lastCity;
    Promise.resolve(window.searchBusinesses(lastCenter&&sameCity?{center:{...lastCenter}}:{})).finally(()=>{forceNext=false;});
  });
  function store(){try{localStorage.setItem(CACHE_KEY,JSON.stringify(cache.export()));}catch(_){/* Quota errors must not break successful searches. */}}
  function show(data,error){
    const saved=data&&(data.stale||data.fallback),date=data?.fetchedAt?new Date(data.fetchedAt):null;
    text.textContent=data?[saved?M.saved:data.cached?M.cached:M.live,date&&Number.isFinite(date.getTime())?date.toLocaleString('ru-RU'):'',data.coveragePartial?M.partial:''].filter(Boolean).join('. '):M.unavailable;
    refresh.textContent=data?M.refresh:M.retry;
    const failure=error||data?.upstreamError;details.hidden=!failure;
    if(failure)debug.textContent=JSON.stringify({requestId:failure.requestId||null,code:failure.code||null,details:failure.details||null},null,2);
  }
  async function request(url,options={},timeout=65000){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const response=await fetch(url,{...options,cache:'no-store',signal:controller.signal,headers:{Accept:'application/json',...(options.headers||{})}});
      let data;try{data=await response.json();}catch(_){throw Object.assign(new Error(M.invalid),{status:response.status,code:'NON_JSON'});}
      if(!response.ok||data?.ok===false)throw Object.assign(new Error(data?.error||M.unavailable),{status:response.status,details:data?.details,requestId:data?.requestId,code:data?.code});return data;
    }finally{clearTimeout(timer);}
  }
  window.geocodeCity=async function(query){
    const key=String(query||'').trim().toLocaleLowerCase(),hit=Object.prototype.hasOwnProperty.call(geocodes,key)?geocodes[key]:null;
    if(hit&&Date.now()-hit.at<86400000&&Number.isFinite(hit.value?.lat)&&Number.isFinite(hit.value?.lng))return hit.value;
    try{
      const data=await request('/api/geocode?q='+encodeURIComponent(query),{},35000);
      const value={lat:Number(data.lat),lng:Number(data.lon??data.lng),label:data.label,provider:data.provider};
      if(!Number.isFinite(value.lat)||!Number.isFinite(value.lng))throw new Error(M.geo);
      geocodes[key]={at:Date.now(),value};geocodes=Object.fromEntries(Object.entries(geocodes).sort((a,b)=>b[1].at-a[1].at).slice(0,50));
      try{localStorage.setItem(GEO_KEY,JSON.stringify(geocodes));}catch(_){}return value;
    }catch(e){e.message=M.geo;throw e;}
  };
  window.fetchBusinesses=async function(center,radius){
    const q=normalize({lat:center.lat,lon:center.lng,radius:Number(radius),category:window.overpassCategory()});
    lastCenter={...center};lastCity=document.getElementById('city')?.value;
    const force=forceNext;forceNext=false;refresh.disabled=true;text.textContent=M.loading;details.hidden=true;
    let data=!force?cache.get(q,{allowStale:true}):null;
    try{
      if(!data){
        try{
          data=await request('/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...q,refresh:force})});
          if(!Array.isArray(data?.elements))throw new Error(M.invalid);
          const at=Date.parse(data.fetchedAt||data.timestamp||'');cache.put(q,data,Number.isFinite(at)?at:Date.now());store();
        }catch(e){
          data=cache.get(q,{allowStale:true,allowPartial:true});
          if(!data){show(null,e);e.message=M.unavailable;throw e;}
          data.fallback=true;data.upstreamError={message:e.message,details:e.details,requestId:e.requestId,code:e.code};
        }
      }
      show(data);
      const saved=data.stale||data.fallback,provider=(data.provider||'OpenStreetMap')+(saved?' \u00b7 '+M.saved:data.cached?' \u00b7 '+M.cached:'');
      return {businesses:window.normalizeOsmElements(data.elements,center),provider,elapsedMs:data.cached?0:data.elapsedMs||0,serverVersion:data.version||'2.3.0',cached:Boolean(data.cached),stale:Boolean(saved),fetchedAt:data.fetchedAt};
    }finally{refresh.disabled=false;}
  };
})();
