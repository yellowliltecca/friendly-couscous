'use strict';
const {Cache,normalize,key}=require('./search-cache');
function createSearchService({search,now=Date.now,cache=new Cache({now}),cooldownMs=15000}={}){
  if(typeof search!=='function')throw new Error('Search provider is required');
  const inflight=new Map(),failures=new Map();
  function saved(q,fallback,cause){
    const hit=cache.get(q,{allowStale:true,allowPartial:fallback});if(!hit)return null;
    return {...hit,fallback,warning:fallback?'UPSTREAM_UNAVAILABLE_SAVED_RESULTS':hit.stale?'SAVED_RESULTS_NOT_REFRESHED':null,upstreamError:cause?{message:cause.message,details:cause.details||null}:null};
  }
  async function run(input,{force=false}={}){
    let q;try{q=normalize(input);}catch(e){e.status=400;e.code='INVALID_SEARCH';throw e;}
    const id=key(q);
    if(!force){const hit=saved(q,false);if(hit)return hit;}
    if(inflight.has(id))return inflight.get(id);
    const failed=failures.get(id);
    if(failed&&now()-failed.at<cooldownMs){
      const hit=saved(q,true,failed.error);if(hit)return hit;
      const e=new Error(failed.error.message);e.status=503;e.code='SOURCE_COOLDOWN';e.details=failed.error.details;e.retryAfter=Math.ceil((cooldownMs-(now()-failed.at))/1000);throw e;
    }
    const task=(async()=>{
      try{
        const result=await search(q.lat,q.lon,q.radius,q.category);
        if(!Array.isArray(result?.elements)||result.error||result.remark)throw new Error('Invalid search provider response');
        const value={...result,fetchedAt:new Date(now()).toISOString(),cached:false,stale:false,fallback:false};
        cache.put(q,value);failures.delete(id);return value;
      }catch(e){
        failures.set(id,{at:now(),error:e});while(failures.size>100)failures.delete(failures.keys().next().value);
        const hit=saved(q,true,e);if(hit)return hit;
        e.status=e.status||503;e.code=e.code||'UPSTREAM_UNAVAILABLE';throw e;
      }
    })();
    inflight.set(id,task);try{return await task;}finally{inflight.delete(id);}
  }
  return {run,cache,stats:()=>({snapshots:cache.entries.size,inflight:inflight.size})};
}
module.exports={createSearchService};
