'use strict';
let centerMarker=null,radiusMarker=null,areaTimer=null,choosingCenter=false,lastCityCenter=null,lastSearchArea=null,areaDrag=false;
const radiusValue=()=>+document.getElementById('radius').value;
function areaBusy(busy){
 for(const id of ['radius','radiusNumber','radiusLess','radiusMore','chooseCenter','resetCenter','category'])document.getElementById(id).disabled=busy;
 centerMarker?.setDraggable(!busy);radiusMarker?.setDraggable(!busy);
 if(busy&&choosingCenter)toggleCenterChoice(false);
}
function syncArea(){
 const radius=radiusValue();
 document.getElementById('radiusVal').textContent=radius+' км';
 document.getElementById('radiusNumber').value=radius;
 document.getElementById('radius').setAttribute('aria-valuetext',radius+' километров');
 document.getElementById('centerLabel').textContent=searchCenter.custom?'Выбранная точка: '+searchCenter.lat.toFixed(4)+', '+searchCenter.lng.toFixed(4):'Центр — '+(searchCenter.label||document.getElementById('city').value);
 const source=map?.getSource('search-radius');
 const circle=circleFeature(searchCenter,radius);
 if(source)source.setData({type:'FeatureCollection',features:[circle]});
 if(areaDrag!=='center')centerMarker?.setLngLat([searchCenter.lng,searchCenter.lat]);
 if(areaDrag!=='radius')radiusMarker?.setLngLat(circle.geometry.coordinates[0][18]);
}
function fitSearchArea(){
 if(!map||!mapReady)return;
 const bounds=new maplibregl.LngLatBounds();
 circleFeature(searchCenter,radiusValue()).geometry.coordinates[0].forEach(p=>bounds.extend(p));
 map.fitBounds(bounds,{padding:48,maxZoom:14,duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:250});
}
function previewRadius(value){
 const parsed=Number(value);if(!Number.isFinite(parsed))return;
 document.getElementById('radius').value=Math.max(1,Math.min(50,Math.round(parsed)));
 syncArea();
 if(liveSearch)document.getElementById('areaStatus').textContent='Область изменена. Поиск обновится после отпускания.';
}
function commitArea(){
 clearTimeout(areaTimer);syncArea();fitSearchArea();
 if(!liveSearch&&!searchCenter.custom)return;
 document.getElementById('areaStatus').textContent='Обновляем компании в выбранной области…';
 areaTimer=setTimeout(()=>searchBusinesses({center:{...searchCenter},areaSearch:true}),400);
}
function toggleCenterChoice(force){
 choosingCenter=typeof force==='boolean'?force:!choosingCenter;
 document.getElementById('chooseCenter').setAttribute('aria-pressed',String(choosingCenter));
 document.getElementById('chooseCenter').textContent=choosingCenter?'Отмена выбора точки':'Выбрать центр на карте';
 if(map)map.getCanvas().style.cursor=choosingCenter?'crosshair':'';
 document.getElementById('areaStatus').textContent=choosingCenter?'Нажмите на карту, чтобы перенести центр поиска.':'Центр и радиус можно перетаскивать на карте.';
}
function moveSearchCenter(lat,lng){
 if(document.getElementById('searchBtn').disabled)return;
 searchCenter={lat:Math.max(-85,Math.min(85,lat)),lng:((lng+180)%360+360)%360-180,label:'Выбранная точка на карте',custom:true};
 toggleCenterChoice(false);syncArea();commitArea();
}
function initAreaMarkers(){
 const markerElement=(label,kind)=>{const el=document.createElement('button');el.type='button';el.className='area-marker '+kind;el.setAttribute('aria-label',label);el.title=label;el.textContent=kind==='area-center'?'＋':'↔';el.addEventListener('click',e=>e.stopPropagation());return el;};
 const centerEl=markerElement('Переместить центр поиска. Стрелки — сдвиг на карте.','area-center');
 centerMarker=new maplibregl.Marker({element:centerEl,draggable:true}).setLngLat([searchCenter.lng,searchCenter.lat]).addTo(map);
 centerMarker.on('dragstart',()=>{areaDrag='center';clearTimeout(areaTimer);});
 centerMarker.on('drag',()=>{const p=centerMarker.getLngLat();searchCenter={lat:Math.max(-85,Math.min(85,p.lat)),lng:p.lng,label:'Выбранная точка на карте',custom:true};syncArea();});
 centerMarker.on('dragend',()=>{areaDrag=false;syncArea();commitArea();});
 const radiusEl=markerElement('Изменить радиус поиска. Стрелки — один километр.','area-radius');
 radiusMarker=new maplibregl.Marker({element:radiusEl,draggable:true}).setLngLat([searchCenter.lng,searchCenter.lat]).addTo(map);
 radiusMarker.on('dragstart',()=>{areaDrag='radius';clearTimeout(areaTimer);});
 radiusMarker.on('drag',()=>{const p=radiusMarker.getLngLat();previewRadius(distanceKm(searchCenter.lat,searchCenter.lng,p.lat,p.lng));});
 radiusMarker.on('dragend',()=>{areaDrag=false;syncArea();commitArea();});
 centerEl.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||document.getElementById('searchBtn').disabled)return;e.preventDefault();const step=radiusValue()/100;moveSearchCenter(searchCenter.lat+(e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0),searchCenter.lng+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0));});
 radiusEl.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||document.getElementById('searchBtn').disabled)return;e.preventDefault();previewRadius(radiusValue()+(['ArrowUp','ArrowRight'].includes(e.key)?1:-1));commitArea();});
 map.on('click',e=>{if(choosingCenter)moveSearchCenter(e.lngLat.lat,e.lngLat.lng);});
 syncArea();
}
function bindAreaControls(){
 document.getElementById('category').addEventListener('change',()=>{if(liveSearch)commitArea();});
 document.getElementById('radius').oninput=e=>previewRadius(e.target.value);
 document.getElementById('radius').onchange=commitArea;
 document.getElementById('radiusNumber').onchange=e=>{previewRadius(e.target.value);commitArea();};
 document.getElementById('radiusNumber').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();previewRadius(e.target.value);commitArea();}};
 for(const [id,delta] of [['radiusLess',-1],['radiusMore',1]])document.getElementById(id).onclick=()=>{previewRadius(radiusValue()+delta);commitArea();};
 document.getElementById('chooseCenter').onclick=()=>toggleCenterChoice();
 document.getElementById('resetCenter').onclick=()=>{if(lastCityCenter){searchCenter={...lastCityCenter};syncArea();commitArea();}else searchBusinesses();};
 document.addEventListener('keydown',e=>{if(e.key==='Escape')toggleCenterChoice(false);});
 syncArea();
}

function saveAreaState(){
 localStorage.setItem('bizfinder_search_area',JSON.stringify({center:searchCenter,radius:radiusValue(),city:document.getElementById('city').value,cityCenter:lastCityCenter,ids:[...(currentSearchIds||[])],selected}));
}
function restoreAreaState(){
 try{
  const state=JSON.parse(localStorage.getItem('bizfinder_search_area')||'null');
  if(!state||!Number.isFinite(state.center?.lat)||!Number.isFinite(state.center?.lng)||Math.abs(state.center.lat)>85||Math.abs(state.center.lng)>180||!Number.isFinite(state.radius)||state.radius<1||state.radius>50||!Array.isArray(state.ids))return;
  const known=new Set(businesses.map(b=>String(b.id)));
  currentSearchIds=new Set(state.ids.map(String).filter(id=>known.has(id)));
  searchCenter={...state.center};lastSearchArea={center:{...searchCenter},radius:state.radius};
  lastCityCenter=state.cityCenter;liveSearch=true;
  document.getElementById('radius').value=state.radius;
  if(typeof state.city==='string')document.getElementById('city').value=state.city;
  selected=known.has(String(state.selected))?state.selected:[...currentSearchIds][0]||null;
  configureRatingFilters(businesses.filter(b=>currentSearchIds.has(String(b.id))));
 }catch(_){/* Invalid or old stored state does not block opening the app. */}
}
