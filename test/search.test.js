'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSearch, businessElements } = require('../search');
const endpoints = ['https://one.example/api/interpreter', 'https://two.example/api/interpreter'];
const center = [51.5013775, 46.1233093, 5, 'all'];
const shop = { type: 'node', id: 1, lat: center[0], lon: center[1], tags: { name: 'Магнит', shop: 'supermarket' } };
const response = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const run = fetchImpl => createSearch({ endpoints, fetchImpl, totalTimeoutMs: 5000 });

test('a valid empty answer never hides a nonempty global source', async () => {
  const search = run(async (url, options) => {
    assert.equal(options.method, 'POST');
    const query = new URLSearchParams(options.body).get('data');
    const queryTimeout = Number(query.match(/\[timeout:(\d+)\]/)[1]);
    assert.ok(queryTimeout > 0 && queryTimeout < 5, 'query timeout leaves a transport budget');
    assert.doesNotMatch(query, /\[name\]\[building\];/);
    return response({ elements: url === endpoints[0] ? [] : [shop] });
  });
  const result = await search(...center);
  assert.equal(result.elements.length, 1);
  assert.equal(result.provider, 'two.example');
});

test('HTTP 200 with Overpass runtime error is a failure, including partial elements', async () => {
  assert.throws(() => businessElements({ elements: [shop], remark: 'runtime error: Query timed out' }, ...center.slice(0, 3)), /timed out/);
  await assert.rejects(run(async () => response({ elements: [], remark: 'runtime error: out of memory' }))(...center), { status: 503 });
});

test('a single empty response plus failed mirrors is unavailable, not zero results', async () => {
  const search = run(async url => url === endpoints[0] ? response({ elements: [] }) : new Response('down', { status: 504 }));
  await assert.rejects(search(...center), error => error.status === 503 && error.details.checks.some(check => check.ok));
});

test('two complete global empty responses confirm an empty result', async () => {
  const result = await run(async () => response({ elements: [] }))(...center);
  assert.deepEqual(result.elements, []);
});

test('returns the first usable response and aborts remaining requests', async () => {
  let cancelled = false;
  const search = run(async (url, { signal }) => {
    if (url === endpoints[0]) return response({ elements: [shop] });
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => { cancelled = true; reject(new Error('cancelled')); }, { once: true }));
  });
  const result = await search(...center);
  assert.equal(result.elements.length, 1);
  assert.equal(cancelled, true);
});

test('a transient HTTP 504 is retried within the same deadline', async () => {
  let calls = 0;
  const search = createSearch({ endpoints: [endpoints[0]], totalTimeoutMs: 5000, fetchImpl: async () => ++calls === 1 ? new Response('', { status: 504 }) : response({ elements: [shop] }) });
  assert.equal((await search(...center)).elements.length, 1);
  assert.equal(calls, 2);
});

test('overall deadline bounds even a transport which ignores abort', async () => {
  const search = createSearch({ endpoints, totalTimeoutMs: 2050, fetchImpl: () => new Promise(() => {}) });
  const started = Date.now();
  await assert.rejects(search(...center), { status: 503 });
  assert.ok(Date.now() - started < 3000);
});

test('invalid JSON and missing elements are not accepted as empty', async () => {
  for (const payload of [null, { ok: true }]) await assert.rejects(run(async () => response(payload))(...center), { status: 503 });
});

test('normalizes nodes and area centers, excluding unnamed or out-of-radius objects', () => {
  const area = { type: 'way', id: 2, center: { lat: center[0], lon: center[1] }, tags: { name: 'Кафе', amenity: 'cafe' } };
  const data = { elements: [shop, area, { ...shop, lat: 55 }, { ...shop, lat: null }, { ...shop, tags: { shop: 'yes' } }, { ...shop, tags: { name: 'Road', highway: 'residential' } }] };
  assert.deepEqual(businessElements(data, ...center.slice(0, 3)), [shop, area]);
});
