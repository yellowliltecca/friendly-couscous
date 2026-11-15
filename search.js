'use strict';

// Use global replicas only: regional extracts can return a valid empty response
// outside their coverage (ovp.dresel.systems returned no data for Engels).
const OVERPASS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
const CATEGORY = {
  restaurant: '[amenity="restaurant"]', cafe: '[amenity="cafe"]', bar: '[amenity="bar"]',
  barber: '[shop="hairdresser"]', beauty: '[shop="beauty"]',
  fitness: '[leisure~"^(fitness_centre|sports_centre)$"]',
  auto: '[shop="car_repair"]', medical: '[amenity~"^(clinic|doctors|dentist|pharmacy)$"]',
  florist: '[shop="florist"]', shop: '[shop]', office: '[office]'
};
const BUSINESS_TAGS = ['amenity', 'shop', 'office', 'craft', 'leisure', 'tourism', 'healthcare'];

function makeQuery(lat, lon, radius, category, timeoutSeconds = 22) {
  const dLat = radius / 111.32;
  const dLon = radius / (111.32 * Math.max(0.15, Math.cos(lat * Math.PI / 180)));
  const box = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map(n => n.toFixed(5)).join(',');
  const selectors = CATEGORY[category] ? [CATEGORY[category]] : [
    ...BUSINESS_TAGS.map(tag => `[${tag}]`),
    '[building~"^(commercial|retail|industrial|office|public|warehouse)$"]'
  ];
  return `[out:json][timeout:${timeoutSeconds}];(${selectors.map(tag => `nwr(${box})[name]${tag};`).join('')});out center tags 1500;`;
}
function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = n => n * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
function businessElements(data, lat, lon, radius) {
  // Overpass uses HTTP 200 for runtime errors, often with elements: [].
  if (data?.remark) throw new Error('Overpass: ' + String(data.remark).slice(0, 240));
  if (!Array.isArray(data?.elements)) throw new Error('Ответ без массива elements');
  return data.elements.filter(el => {
    const tags = el.tags || {}, point = el.center || el;
    const business = BUSINESS_TAGS.some(key => !!tags[key]) || ['commercial', 'retail', 'industrial', 'office', 'public', 'warehouse'].includes(tags.building);
    return business && !!tags.name && point.lat != null && point.lon != null &&
      Number.isFinite(+point.lat) && Number.isFinite(+point.lon) && distanceKm(lat, lon, +point.lat, +point.lon) <= radius;
  });
}
function searchError(checks, elapsedMs) {
  const error = new Error('Источники организаций временно недоступны. Повторите поиск. Предыдущие результаты сохранены.');
  error.status = 503;
  error.details = { elapsedMs, checks };
  return error;
}

function createSearch({ endpoints = OVERPASS, fetchImpl = fetch, requestTimeoutMs = 28000, totalTimeoutMs = 52000 } = {}) {
  return async function searchOverpass(lat, lon, radius, category) {
    const started = Date.now(), controller = new AbortController();
    const checks = endpoints.map(endpoint => ({ host: new URL(endpoint).hostname, ok: false, count: 0, status: 'pending' }));
    let deadlineTimer;
    const snapshot = () => checks.map(check => ({ ...check }));
    async function queryEndpoint(endpoint, index) {
      const attemptStarted = Date.now();
      // Retry transient failures once, within the SAME search deadline.
      for (let attempt = 0; attempt < 2; attempt++) {
        const remaining = totalTimeoutMs - (Date.now() - started);
        if (remaining < 2000 || controller.signal.aborted) break;
        const timeout = Math.min(requestTimeoutMs, remaining);
        const attemptController = new AbortController();
        const cancel = () => attemptController.abort();
        controller.signal.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(cancel, timeout);
        try {
          // Leave time for transport AFTER the server-side query timeout.
          const query = makeQuery(lat, lon, radius, category, Math.max(1, Math.min(22, Math.floor((timeout - 2000) / 1000))));
          const options = {
            method: 'POST', signal: attemptController.signal,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: 'application/json', 'User-Agent': 'BIZFINDER/2.1 (business discovery; server-side proxy)' },
            body: new URLSearchParams({ data: query }).toString()
          };
          let response = await fetchImpl(endpoint, options);
          // Some replicas only accept GET; don't prefer it for large queries.
          if ([405, 415].includes(response.status)) {
            await response.body?.cancel();
            response = await fetchImpl(`${endpoint}?data=${encodeURIComponent(query)}`, { ...options, method: 'GET', body: undefined });
          }
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const data = await response.json();
          const elements = businessElements(data, lat, lon, radius);
          Object.assign(checks[index], { ok: true, status: 'complete', count: elements.length, elapsedMs: Date.now() - attemptStarted });
          delete checks[index].error;
          return elements;
        } catch (error) {
          checks[index].error = attemptController.signal.aborted ? 'Превышено время ожидания источника' : error.message;
          if (controller.signal.aborted) break;
          // Invalid requests won't become valid by repeating them.
          if (/HTTP (400|401|403|404)/.test(error.message)) break;
        } finally {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', cancel);
        }
      }
      Object.assign(checks[index], { status: 'failed', elapsedMs: Date.now() - attemptStarted });
      return null;
    }
    try {
      return await new Promise((resolve, reject) => {
        let settled = false, completed = 0;
        const finish = (elements, provider) => {
          if (settled) return;
          settled = true;
          resolve({ elements, provider, providerResults: snapshot(), timestamp: new Date().toISOString(), elapsedMs: Date.now() - started, queryRadiusKm: radius });
        };
        const fail = () => {
          if (settled) return;
          settled = true;
          reject(searchError(snapshot(), Date.now() - started));
        };
        deadlineTimer = setTimeout(fail, totalTimeoutMs);
        if (!endpoints.length) return fail();
        endpoints.forEach((endpoint, index) => {
          queryEndpoint(endpoint, index).then(elements => {
            completed++;
            if (settled) return;
            // Do not wait for slow or broken mirrors once usable data arrives.
            if (elements?.length) return finish(elements, checks[index].host);
            if (completed === endpoints.length) {
              const empty = checks.filter(check => check.ok && check.count === 0);
              // A lone empty response plus failed mirrors isn't evidence that
              // a city has no businesses. Require independent confirmation.
              if (empty.length >= 2) finish([], empty.map(check => check.host).join(', '));
              else fail();
            }
          }, fail);
        });
      });
    } finally {
      clearTimeout(deadlineTimer);
      controller.abort();
    }
  };
}
module.exports = { createSearch, OVERPASS, makeQuery, businessElements };
