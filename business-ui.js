'use strict';
const socialLabels={telegram:'Telegram',whatsapp:'WhatsApp',vk:'VK',instagram:'Instagram',facebook:'Facebook',youtube:'YouTube',ok:'Одноклассники',twitter:'X / Twitter'};
const detailDrafts=new Map();
function externalLink(url,label,cls='link'){
 const safe=BusinessData.webUrl(url);return safe?`<a class="${cls}" href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(label)} <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 12 12 4M4 4h8v8"/></svg></a>`:'';
}
function reviewCell(b){
 const rating=Number(b.rating),count=Number.isFinite(Number(b.reviews))&&b.reviews!=null?Number(b.reviews):null;
 if(rating>0&&rating<=5)return `<b>★ ${rating.toFixed(1)}</b>${count!=null?` <span class="muted">(${count})</span>`:''}${b.source==='Demo'?'<div class="muted small">Демо</div>':''}`;
 return externalLink(BusinessData.directoryLinks(b)[0].url,'Найти отзывы','link review-shortcut');
}
function businessContacts(b){
 // Arrays are already normalized, don't stringify multiple phones into one link.
 const allPhones=[...new Set([...(b.phones||[]),...BusinessData.values(b.phone)])];
 const allEmails=[...new Set([...(b.emails||[]),...BusinessData.values(b.email)])];
 const phoneRows=allPhones.map(phone=>{const tel=phone.replace(/[^+\d]/g,'');return /^[+\d]{5,20}$/.test(tel)?`<div class="info"><span class="info-label">Телефон</span><a class="link" href="tel:${esc(tel)}">${esc(phone)}</a></div>`:'';}).join('');
 const emailRows=allEmails.filter(email=>/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)).map(email=>`<div class="info"><span class="info-label">Email</span><a class="link" href="mailto:${esc(email)}">${esc(email)}</a></div>`).join('');
 const socialLinks=Object.entries(b.socials||{}).map(([kind,url])=>socialLabels[kind]?externalLink(BusinessData.socialUrl(kind,url),socialLabels[kind],'contact-chip'):'').filter(Boolean);
 return `<div class="detail-section"><h3>КОНТАКТЫ</h3>${phoneRows}${emailRows}${b.website?`<div class="info"><span class="info-label">Сайт</span>${externalLink(b.website,new URL(BusinessData.webUrl(b.website)||'https://example.com').hostname)}</div>`:''}${socialLinks.length?`<div class="contact-links">${socialLinks.join('')}</div>`:''}${!phoneRows&&!emailRows&&!socialLinks.length?'<p class="muted small">В источнике пока нет прямых контактов. Проверьте сайт компании или её карточку на картах.</p>':''}<p class="muted small contact-source">Контакты из OpenStreetMap. У сетевых компаний ссылки могут вести на общие страницы сети.</p></div>`;
}
function businessFacts(b){
 const rows=[{label:'Адрес',value:b.address}];
 if(Number.isFinite(+b.lat)&&Number.isFinite(+b.lng))rows.push({label:'От центра',value:distanceKm(searchCenter.lat,searchCenter.lng,+b.lat,+b.lng).toFixed(1)+' км'});
 if(b.openingHours)rows.push({label:'Часы работы',value:b.openingHours==='24/7'?'Круглосуточно':b.openingHours});
 rows.push(...(b.facts||[]));
 return `<div class="detail-section"><h3>О КОМПАНИИ</h3>${b.description?`<p class="business-description">${esc(b.description)}</p>`:''}<dl class="business-facts">${rows.filter(row=>row.value).map(row=>`<div><dt>${esc(row.label)}</dt><dd>${esc(row.value)}</dd></div>`).join('')}</dl>${b.openingHours&&b.openingHours!=='24/7'?'<p class="small muted">Расписание указано в формате источника: Mo–Fr — пн–пт, Sa — сб, Su — вс.</p>':''}${b.osmUrl?externalLink(b.osmUrl,'Карточка в OpenStreetMap'):''}</div>`;
}
function businessReviews(b){
 const links=BusinessData.directoryLinks(b);
 return `<div class="detail-section review-section"><h3>РЕЙТИНГ И ОТЗЫВЫ</h3>${b.rating>0?`<p>${reviewCell(b)}</p>`:'<p class="muted small">Посмотрите оценки и отзывы на картах. OpenStreetMap их не передаёт.</p>'}<div class="review-links">${links.map(link=>externalLink(link.url,link.label,'contact-chip')).join('')}</div><p class="small muted">Ссылки открывают поиск по названию и адресу. Перед чтением проверьте, что выбран нужный филиал.</p></div>`;
}
function renderBusinessDetail(){
 const b=get(selected),panel=document.getElementById('detailPanel');
 const changed=panel.dataset.businessId!==String(b?.id);
 const oldNote=panel.querySelector('#detailNote');
 if(oldNote)detailDrafts.set(panel.dataset.businessId,oldNote.value);
 if(!b){panel.innerHTML='<div class="empty">Выберите бизнес из списка</div>';delete panel.dataset.businessId;return;}
 panel.dataset.businessId=String(b.id);
 panel.innerHTML=`<div class="business-heading"><span class="tag blue">${esc(b.category)}</span>${b.source==='Demo'?'<span class="tag warn">Демонстрация</span>':''}<h2 class="detail-title">${esc(b.name)}</h2><div class="small muted">${b.socials?.telegram?'Есть Telegram · ':''}${b.source==='Demo'?'Пример карточки':'Данные OpenStreetMap'}</div></div>${businessContacts(b)}${businessFacts(b)}${businessReviews(b)}<div class="detail-section"><h3>НАШ САЙТ ДЛЯ ЭТОГО БИЗНЕСА</h3><div class="info">Статус: <span class="tag ${b.ourState==='ready'?'good':b.ourState==='progress'?'warn':''}">${ourNames[b.ourState]}</span></div>${b.ourUrl?`<div class="info">${externalLink(b.ourUrl,'Открыть демоверсию')}</div>`:'<div class="muted small">Ссылка пока не прикреплена</div>'}<div class="small muted">Тип предложения: ${b.siteState==='yes'?'Улучшение существующего сайта':b.siteState==='no'?'Создание первого сайта':'Уточнить наличие сайта'}</div><button class="btn ghost full smallbtn" style="margin-top:9px" onclick="openDev(${b.id})">Изменить данные нашего сайта</button></div><div class="detail-section"><h3>СТАТУС КОММУНИКАЦИИ</h3><div class="status-grid">${Object.entries(statusNames).map(([k,v])=>`<button class="status-btn ${b.contact===k?'selected':''}" onclick="setStatus(${b.id},'${k}')">${v}</button>`).join('')}</div><div class="field"><label for="detailAssignee">ОТВЕТСТВЕННЫЙ МЕНЕДЖЕР</label><select id="detailAssignee" class="control" onchange="assign(${b.id},this.value)">${['Не назначен','Артём','Мария','Иван'].map(name=>`<option ${b.assignee===name?'selected':''}>${name}</option>`).join('')}</select></div><div class="field"><label for="detailNote">ЗАМЕТКА / РЕЗУЛЬТАТ ЗВОНКА</label><textarea class="note" id="detailNote" placeholder="Что обсудили, следующий шаг…">${esc(detailDrafts.get(String(b.id))??b.note??'')}</textarea><button class="btn secondary full smallbtn" style="margin-top:7px" onclick="saveNote(${b.id})">Сохранить заметку</button></div></div><div class="detail-actions"><button class="btn wide" onclick="callBusiness(${b.id})">Зафиксировать звонок</button><button class="btn secondary" onclick="addToLeads(${b.id})">В мои лиды</button><button class="btn ghost" onclick="openDev(${b.id})">Сайт / разработка</button></div>`;
 if(changed)panel.scrollTop=0;
}

function configureRatingFilters(found){
 const hasRatings=found.some(b=>Number(b.rating)>0);
 ['rating','reviews'].forEach(id=>{const input=document.getElementById(id);input.disabled=!hasRatings;if(!hasRatings)input.value='0';});
 document.getElementById('ratingFilterNote').textContent=hasRatings?'Фильтры применяются к компаниям с известными оценками.':'Оценки доступны на картах — нажмите «Найти отзывы» в списке или откройте карточку бизнеса.';
}
