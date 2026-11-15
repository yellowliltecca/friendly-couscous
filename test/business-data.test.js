const {test}=require('node:test');
const assert=require('node:assert/strict');
const {osmDetails,webUrl,socialUrl,directoryLinks}=require('../business-data');

test('normalizes multiple phones, emails and available Telegram/VK/WhatsApp',()=>{
 const d=osmDetails({name:'Кафе',phone:'+7 900 100-20-30; +7 900 111-20-30','contact:phone':'+7 900 100-20-30',email:'hi@example.ru;info@example.ru','contact:telegram':'@examplecafe','contact:vk':'examplecafe','contact:whatsapp':'+7 (900) 100-20-30'},'node',123);
 assert.equal(d.phones.length,2);assert.equal(d.emails.length,2);
 assert.equal(d.socials.telegram,'https://t.me/examplecafe');
 assert.equal(d.socials.vk,'https://vk.com/examplecafe');
 assert.equal(d.socials.whatsapp,'https://wa.me/79001002030');
 assert.equal(d.osmUrl,'https://www.openstreetmap.org/node/123');
});
test('retains operating hours, factual details, full address and description',()=>{
 const d=osmDetails({'addr:full':'Саратов, ул. Пример, 10',opening_hours:'Mo-Fr 09:00-18:00',description:'Ремонт обуви',brand:'Сеть',wheelchair:'yes','payment:cash':'no',website:'example.ru'},'way',22);
 assert.equal(d.openingHours,'Mo-Fr 09:00-18:00');assert.equal(d.description,'Ремонт обуви');
 assert.equal(d.address,'Саратов, ул. Пример, 10');assert.equal(d.website,'https://example.ru/');
 assert.deepEqual(d.facts.find(x=>x.label==='Доступная среда'),{label:'Доступная среда',value:'Да'});
});
test('blocks active URL schemes and deceptive social domains',()=>{
 for(const value of ['javascript:alert(1)','data:text/html,test','https://user:pass@example.com/'])assert.equal(webUrl(value),'');
 assert.equal(socialUrl('telegram','https://t.me.evil.example/user'),'');
 assert.equal(socialUrl('telegram','https://evil.example/user'),'');
 assert.equal(socialUrl('telegram','tg://resolve?domain=examplecafe'),'https://t.me/examplecafe');
});
test('unknown contact and reputation data stays absent',()=>{
 const d=osmDetails({name:'Кафе'},'node',1);
 assert.deepEqual(d.socials,{});assert.deepEqual(d.phones,[]);assert.equal(d.rating,undefined);
});
test('review shortcuts include the company and its address, never synthetic reviews',()=>{
 const b={name:'Кафе & Чай',address:'Энгельс, Тихая, 7'};
 for(const link of directoryLinks(b)){
  assert.ok(link.url.startsWith('https://'));
  assert.ok(decodeURIComponent(link.url).includes(b.name));
  assert.ok(decodeURIComponent(link.url).includes(b.address));
 }
});
