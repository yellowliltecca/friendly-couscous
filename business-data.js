(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BusinessData=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function webUrl(value){
  if(!value)return '';
  let s=String(value).trim();
  if(!/^https?:\/\//i.test(s)){if(/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(s))s='https://'+s;else return '';}
  try{const u=new URL(s);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return '';return u.href;}catch{return '';}
 }
 function values(...items){return [...new Set(items.flat(Infinity).flatMap(v=>String(v||'').split(/\s*;\s*/)).map(v=>v.trim()).filter(Boolean))];}
 function socialUrl(kind,value){
  let s=String(value||'').trim();if(!s)return '';
  const bases={telegram:'https://t.me/',vk:'https://vk.com/',instagram:'https://www.instagram.com/',facebook:'https://www.facebook.com/',youtube:'https://www.youtube.com/',ok:'https://ok.ru/',twitter:'https://x.com/'};
  if(kind==='whatsapp'){
   const digits=s.replace(/\D/g,'');
   if(/^[+\d\s()-]+$/.test(s)&&digits.length>=7&&digits.length<=15)return 'https://wa.me/'+digits;
  }
  if(kind==='telegram')s=s.replace(/^tg:\/\/resolve\?domain=/i,'');
  const url=webUrl(s)||webUrl((bases[kind]||'')+s.replace(/^@/,''));
  if(!url)return '';
  const host=new URL(url).hostname.toLowerCase().replace(/^www\./,'');
  const allowed={telegram:['t.me','telegram.me','telegram.dog'],whatsapp:['wa.me','api.whatsapp.com','whatsapp.com'],vk:['vk.com','vk.ru'],instagram:['instagram.com'],facebook:['facebook.com','fb.com'],youtube:['youtube.com','youtu.be'],ok:['ok.ru'],twitter:['x.com','twitter.com']};
  return allowed[kind]?.includes(host)?url:'';
 }
 function osmDetails(tags,type,id){
  const phones=values(tags.phone,tags['contact:phone'],tags.mobile,tags['contact:mobile']).filter(v=>/^[+\d\s()./#-]{5,60}$/.test(v));
  const emails=values(tags.email,tags['contact:email']).filter(v=>/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v));
  const socials={};
  for(const kind of ['telegram','whatsapp','vk','instagram','facebook','youtube','ok','twitter']){
   const raw=tags['contact:'+kind]||tags[kind];const url=socialUrl(kind,raw);if(url)socials[kind]=url;
  }
  const facts=[];
  const labels={brand:'Сеть / бренд',operator:'Оператор',branch:'Филиал',cuisine:'Кухня',service:'Услуги',speciality:'Специализация',levels:'Этажей',level:'Этаж'};
  for(const [key,label] of Object.entries(labels))if(tags[key])facts.push({label,value:String(tags[key]).replace(/;/g,', ')});
  const yesNo={yes:'Да',no:'Нет',limited:'Частично',designated:'Предусмотрено',customers:'Для клиентов',free:'Бесплатно'};
  for(const [key,label] of Object.entries({wheelchair:'Доступная среда',delivery:'Доставка',takeaway:'Еда навынос','internet_access':'Интернет','payment:cash':'Оплата наличными','payment:credit_cards':'Оплата картой','air_conditioning':'Кондиционер'}))if(tags[key])facts.push({label,value:yesNo[tags[key]]||tags[key]});
  const address=tags['addr:full']||[tags['addr:street'],tags['addr:housenumber'],tags['addr:city'],tags['addr:postcode']].filter(Boolean).join(', ');
  return {phones,emails,socials,facts,address,openingHours:tags.opening_hours||tags['opening_hours:description']||'',description:tags['description:ru']||tags.description||'',website:values(tags.website,tags['contact:website']).map(webUrl).find(Boolean)||'',osmUrl:['node','way','relation'].includes(type)&&/^\d+$/.test(String(id))?'https://www.openstreetmap.org/'+type+'/'+id:''};
 }
 function categoryName(t){
  const amenity={restaurant:'Ресторан',cafe:'Кафе',fast_food:'Быстрое питание',bar:'Бар',pub:'Паб',clinic:'Медицина',doctors:'Медицина',dentist:'Медицина',pharmacy:'Медицина',fuel:'АЗС',bank:'Банк',atm:'Банкомат',car_wash:'Автомойка',school:'Школа',kindergarten:'Детский сад',post_office:'Почта',veterinary:'Ветеринарная клиника'};
  const shop={hairdresser:'Барбершоп',beauty:'Салон красоты',car_repair:'Автосервис',florist:'Магазин цветов',supermarket:'Супермаркет',convenience:'Продуктовый магазин',mall:'Торговый центр',clothes:'Магазин одежды',shoes:'Обувной магазин',bakery:'Пекарня',butcher:'Мясной магазин',electronics:'Магазин электроники',chemist:'Бытовая химия',optician:'Оптика',jewelry:'Ювелирный магазин',furniture:'Мебель',hardware:'Строительный магазин',books:'Книжный магазин',mobile_phone:'Салон связи',alcohol:'Магазин напитков',tobacco:'Табачный магазин',outpost:'Пункт выдачи заказов',tyres:'Шины и диски',sports:'Спортивный магазин',pet:'Зоомагазин'};
  return amenity[t.amenity]||shop[t.shop]||(['fitness_centre','sports_centre'].includes(t.leisure)?'Фитнес-клуб':'')||({hotel:'Гостиница',guest_house:'Гостевой дом',hostel:'Хостел',museum:'Музей'})[t.tourism]||(t.healthcare?'Медицина':'')||(t.office?'Офис / услуги':t.craft?'Мастерская':t.shop?'Магазин':'Организация');
 }
 function directoryLinks(b){
  const q=[b.name,b.address].filter(Boolean).join(' ');
  return [
   {label:'Яндекс Карты',url:'https://yandex.ru/maps/?text='+encodeURIComponent(q)},
   {label:'2ГИС',url:'https://2gis.ru/search/'+encodeURIComponent(q)},
   {label:'Google Карты',url:'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(q)}
  ];
 }
 return {webUrl,socialUrl,osmDetails,directoryLinks,values,categoryName};
});
