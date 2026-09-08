#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Read-only public catalog requests. Existing raw responses are never overwritten.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const captureDate = process.argv[2] ?? new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(captureDate)) throw new Error('Usage: node tools/capture-yellobe-prices.mjs [YYYY-MM-DD]');
const cacheDir = path.join(root, '.tmp', `yellobe-${captureDate}`);
const outputDir = path.join(root, 'docs', 'reference', `yellobe-${captureDate}`);
const sourcePageUrl = 'https://www.yellobe.com/buy';
const modelsUrl = 'https://www.yellobe.com/home/type2';
const capacitiesUrl = 'https://www.yellobe.com/home/type3_v2';
// Manufacturer pages checked on 2026-09-08. These flags preserve conflicting
// source offers for review; they never delete or silently correct source data.
const capacityReferences = {
  'iPhone 17': { capacities: ['256GB', '512GB'], sourceUrl: 'https://www.apple.com/iphone-17/specs/' },
  'iPhone Air': { capacities: ['256GB', '512GB', '1TB'], sourceUrl: 'https://www.apple.com/iphone-air/specs/' },
  'iPhone 17 Pro': { capacities: ['256GB', '512GB', '1TB'], sourceUrl: 'https://www.apple.com/iphone-17-pro/specs/' },
  'iPhone 17 Pro Max': { capacities: ['256GB', '512GB', '1TB', '2TB'], sourceUrl: 'https://www.apple.com/iphone-17-pro/specs/' },
  'iPhone 17e': { capacities: ['256GB', '512GB'], sourceUrl: 'https://www.apple.com/iphone-17e/specs/' },
};
await mkdir(cacheDir, { recursive: true });
await mkdir(outputDir, { recursive: true });

async function cachedResponse(name, sourceUrl, requestBody) {
  const file = path.join(cacheDir, name);
  try {
    const [body, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
    let metadata;
    try { metadata = JSON.parse(await readFile(`${file}.meta.json`, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { body, fetchedAt: metadata?.fetchedAt ?? info.mtime.toISOString(),
      fetchedAtSource: metadata ? 'http-response' : 'existing-cache-file-mtime' };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const response = await fetch(sourceUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', Referer: sourcePageUrl },
    body: new URLSearchParams(requestBody),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${sourceUrl}: HTTP ${response.status}`);
  const body = await response.text();
  if (!body.trim()) throw new Error(`${sourceUrl}: empty response`);
  const fetchedAt = new Date().toISOString();
  const metadata = { sourceUrl, method: 'POST', requestBody, fetchedAt, status: response.status };
  try {
    await writeFile(file, body, { flag: 'wx' });
    await writeFile(`${file}.meta.json`, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return cachedResponse(name, sourceUrl, requestBody);
  }
  await delay(500);
  return { body, fetchedAt, fetchedAtSource: 'http-response' };
}

function cashAmount(raw) {
  const amount = String(raw).replaceAll(',', '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) throw new Error(`Invalid published price: ${raw}`);
  const [whole, fraction = ''] = amount.split('.');
  return `${BigInt(whole)}.${fraction.padEnd(2, '0')}`;
}

const modelResponse = await cachedResponse('iphone-models.html', modelsUrl, { id: '104' });
const models = [...modelResponse.body.matchAll(/<option\s+value="(\d+)"[^>]*>([^<]+)<\/option>/g)]
  .map((match) => ({ modelId: match[1], model: match[2].trim().replace(/\s+/g, ' ') }))
  .filter(({ model }) => /^iPhone Air$/i.test(model) || Number(/^iPhone\s+(\d+)/i.exec(model)?.[1] ?? 0) >= 12);
if (!models.length) throw new Error('No iPhone 12-or-newer model options found');
if (new Set(models.map(({ modelId }) => modelId)).size !== models.length) throw new Error('Duplicate source model IDs');

const rows = [];
const captures = [];
for (const { modelId, model } of models) {
  const response = await cachedResponse(`capacities-${modelId}.json`, capacitiesUrl, { id: modelId });
  const capacities = JSON.parse(response.body);
  if (!Array.isArray(capacities)) throw new Error(`Expected capacity array for ${model}`);
  captures.push({ modelId, model, fetchedAt: response.fetchedAt, fetchedAtSource: response.fetchedAtSource,
    capacityCount: capacities.length, rawCache: path.relative(root, path.join(cacheDir, `capacities-${modelId}.json`)) });
  for (const capacity of capacities) {
    if (!/^\d+$/.test(capacity.detail_ID) || !/^\d+$/.test(capacity.buy_ID)) throw new Error(`Missing source identifiers for ${model}`);
    const storage = String(capacity.detail_memory).trim().replace(/\s+/g, '').toUpperCase();
    const maxCashPrice = cashAmount(capacity.detail_price);
    const flags = [];
    if (!/^\d+(?:GB|TB)$/.test(storage)) flags.push('UNRECOGNIZED_CAPACITY_LABEL');
    if (maxCashPrice === '0.00') flags.push('ZERO_PUBLISHED_PRICE');
    const capacityReference = capacityReferences[model];
    if (capacityReference && !capacityReference.capacities.includes(storage)) flags.push('CAPACITY_NOT_LISTED_BY_MANUFACTURER');
    rows.push({ modelId, detailId: String(capacity.detail_ID), buyId: String(capacity.buy_ID), model, storage,
      sourceStorage: capacity.detail_memory, maxCashPrice, sourcePrice: capacity.detail_price, currency: 'THB',
      sourceUrl: capacitiesUrl, sourcePageUrl, sourceRequest: { method: 'POST', body: { id: modelId } },
      fetchedAt: response.fetchedAt, fetchedAtSource: response.fetchedAtSource, flags });
  }
  console.log(`${model}: ${capacities.length} published capacity offers`);
}
const identities = rows.map(({ modelId, detailId }) => `${modelId}:${detailId}`);
if (new Set(identities).size !== identities.length) throw new Error('Duplicate model/detail source identities');
const data = {
  schemaVersion: 1,
  source: 'Yellobe public buyback catalog',
  sourcePageUrl,
  captureDate,
  generatedAt: new Date().toISOString(),
  priceMeaning: 'Published maximum buyback cash price before condition deductions; no condition grade inferred.',
  scope: 'Numbered iPhone models 12 and later, plus iPhone Air; excludes SE and numbered models 11 and earlier.',
  modelCatalog: { sourceUrl: modelsUrl, method: 'POST', body: { id: '104' }, fetchedAt: modelResponse.fetchedAt,
    fetchedAtSource: modelResponse.fetchedAtSource },
  modelCount: models.length,
  offerCount: rows.length,
  flaggedOfferCount: rows.filter(({ flags }) => flags.length).length,
  manufacturerCapacityReview: { verifiedOn: '2026-09-08', scope: 'Only the models explicitly listed below were checked against Apple in this capture.', models: capacityReferences },
  captures,
  rows,
};
await writeFile(path.join(outputDir, 'prices.json'), `${JSON.stringify(data, null, 2)}\n`);
const columns = ['modelId', 'detailId', 'buyId', 'model', 'storage', 'sourceStorage', 'maxCashPrice', 'currency', 'sourceUrl', 'fetchedAt', 'fetchedAtSource', 'flags'];
const csvCell = (value) => `"${String(Array.isArray(value) ? value.join(';') : value ?? '').replaceAll('"', '""')}"`;
await writeFile(path.join(outputDir, 'prices.csv'), `${[columns, ...rows.map((row) => columns.map((key) => row[key]))].map((row) => row.map(csvCell).join(',')).join('\n')}\n`);
console.log(JSON.stringify({ outputDir: path.relative(root, outputDir), modelCount: data.modelCount, offerCount: data.offerCount,
  flaggedOffers: rows.filter(({ flags }) => flags.length).map(({ model, storage, maxCashPrice, flags }) => ({ model, storage, maxCashPrice, flags })) }));
