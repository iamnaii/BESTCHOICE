#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const date = process.argv[2] ?? '2026-09-08';
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Expected YYYY-MM-DD');
const cache = path.join(root, '.tmp', `yellobe-${date}`);
const output = path.join(root, 'docs/reference', `yellobe-${date}`, 'pricing-observations.json');
const endpoint = 'https://www.yellobe.com/buy/posescion_price';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const catalog = await readJson(path.join(root, 'docs/reference', `yellobe-${date}`, 'prices.json'));
let oldObservations = [];
try { oldObservations = await readJson(path.join(cache, 'formula-observations.json')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const scenarios = [
  { name: 'baseline', choices: {} },
  { name: 'expired-body-light', choices: { 183: 2, 247: 1 } },
  { name: 'two-percent', choices: { 247: 1, 248: 1 } },
  { name: 'fixed-and-two-percent', choices: { 183: 2, 247: 1, 248: 1 } },
  { name: 'three-percent', choices: { 247: 1, 248: 1, 249: 1 } },
  { name: 'body-and-vibration', choices: { 247: 1 }, optional: ['optional-3'] },
  { name: 'two-functional', choices: {}, optional: ['optional-3', 'optional-7'] },
  { name: 'two-equal-fixed', choices: { 183: 2, 257: 2 } },
  { name: 'two-different-fixed', choices: { 182: 2, 183: 2 } },
  { name: 'all-fixed-and-mixed-percent', choices: { 182: 2, 183: 2, 247: 1, 248: 2, 250: 1, 257: 2 }, optional: ['optional-3', 'optional-7'] },
  { name: 'body-higher-than-functional', choices: { 247: 4 }, optional: ['optional-3'] },
  { name: 'mini-256-unit-baht', detailId: '1127', choices: { 247: 4 } },
  { name: 'iphone12-128-unit-baht', detailId: '1141', choices: { 247: 4 } },
];
const observations = [];
for (const scenario of scenarios) {
  const detailId = scenario.detailId ?? '1140';
  const offer = catalog.rows.find((row) => row.detailId === detailId);
  if (!offer || offer.flags.length) throw new Error(`Missing valid catalog offer ${detailId}`);
  const formHtml = await readFile(path.join(cache, `detail-${detailId}.html`), 'utf8');
  const document = new JSDOM(formHtml).window.document;
  const form = document.querySelector('.form-buy-detail');
  if (form?.action !== endpoint) throw new Error('Only the anonymous quote form is allowed');
  const params = new URLSearchParams();
  const selected = [];
  const sourceGroups = new Set([...form.querySelectorAll('input[type=radio]')].map((input) => input.dataset.idgroup));
  if (Object.keys(scenario.choices).some((id) => !sourceGroups.has(id))) throw new Error(`Source question changed for ${scenario.name}`);
  for (const field of form.querySelectorAll('input[type=hidden]:not([disabled])')) params.append(field.name, field.value);
  if (Number(params.get('maxprice')) !== Number(offer.maxCashPrice)) throw new Error('Catalog/form base price mismatch');
  function select(input, groupId) {
    params.append(input.name, input.value);
    const hidden = [...input.parentElement.querySelectorAll('input[type=hidden]')];
    for (const field of hidden) params.append(field.name, field.value);
    const deduction = hidden.find((field) => field.name.startsWith('nav_amt[') || field.name === 'porp_amt[]');
    selected.push({ groupId, inputId: input.id, label: input.type === 'radio' ? input.value.trim() : input.parentElement.textContent.trim().replace(/\s+/g, ' '),
      deductType: deduction && (deduction.name.includes('[1]') || deduction.name === 'porp_amt[]') ? 'PERCENT' : deduction ? 'FIXED' : null,
      deductValue: deduction?.value ?? null });
  }
  for (const group of form.querySelectorAll('.form-box')) {
    const radios = [...group.querySelectorAll('input[type=radio]')];
    if (!radios.length) continue;
    const groupId = radios[0].dataset.idgroup;
    const input = radios[scenario.choices[groupId] ?? 0];
    if (!input) throw new Error(`Choice absent from source group ${groupId}`);
    select(input, groupId);
  }
  for (const id of scenario.optional?.length ? scenario.optional : ['optional-no']) {
    const input = form.querySelector(`#${id}`);
    if (!input || input.type !== 'checkbox' || input.name !== 'optional') throw new Error(`Invalid optional input ${id}`);
    select(input, 'functional');
  }
  const eligibility = form.querySelector('#isDeviceStatusConfirmed');
  if (!eligibility || eligibility.value !== '1') throw new Error('Missing eligibility confirmation');
  params.append(eligibility.name, eligibility.value);
  if ([...params.keys()].some((name) => /email|phone|address|seller/i.test(name))) throw new Error('Unexpected personal-information input');
  let rawPath = path.join(cache, `quote-${scenario.name}.html`);
  let html;
  let metadata;
  try {
    html = await readFile(rawPath, 'utf8');
    if (scenario.name === 'baseline') metadata = await readJson(path.join(cache, 'quote-baseline-request.json'));
    else metadata = oldObservations.find((entry) => entry.name === scenario.name);
    if (!metadata) throw new Error(`No capture provenance for ${scenario.name}`);
    metadata = { requestedAt: metadata.startedAt, status: metadata.status,
      ...(metadata.body ? { requestBody: metadata.body } : {}), requestReconstructedFromSourceForm: scenario.name !== 'baseline' };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    rawPath = path.join(cache, `verified-quote-${scenario.name}.html`);
    try {
      html = await readFile(rawPath, 'utf8');
      metadata = await readJson(`${rawPath}.meta.json`);
    } catch (missing) {
      if (missing.code !== 'ENOENT') throw missing;
      const requestedAt = new Date().toISOString();
      const response = await fetch(endpoint, { method: 'POST', body: params, redirect: 'error', signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Quote HTTP ${response.status}`);
      html = await response.text();
      metadata = { requestedAt, fetchedAt: new Date().toISOString(), status: response.status, url: response.url, requestBody: [...params] };
      await writeFile(rawPath, html, { flag: 'wx' });
      await writeFile(`${rawPath}.meta.json`, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
      await delay(500);
    }
  }
  const result = new JSDOM(html).window.document;
  const net = result.querySelector('input[name=maxprice_net]')?.value;
  if (!net || !/^\d+(?:\.\d+)?$/.test(net)) throw new Error(`Missing quote result ${scenario.name}`);
  const fixedSum = selected.filter((choice) => choice.deductType === 'FIXED').reduce((sum, choice) => sum + Number(choice.deductValue), 0);
  const percentages = selected.filter((choice) => choice.deductType === 'PERCENT').map((choice) => Number(choice.deductValue));
  const maxPercent = Math.max(0, ...percentages);
  const afterFixed = Number(offer.maxCashPrice) - fixedSum;
  const expected = afterFixed * (100 - maxPercent) / 100;
  observations.push({ name: scenario.name, model: offer.model, storage: offer.storage, detailId,
    sourceUrl: endpoint, basePrice: offer.maxCashPrice, selected, eligibilityConfirmed: true,
    requestBody: metadata.requestBody ?? [...params], ...metadata, resultPrice: net, fixedSum, maxPercent,
    percentSum: percentages.reduce((sum, value) => sum + value, 0), expectedFromSumFixedThenMaxPercent: expected,
    matchesObservedRule: Number(net) === expected, rawResponsePath: path.relative(root, rawPath), rawResponseSha256: sha256(html),
    sourceFormSha256: sha256(formHtml), nextFormActions: [...result.forms].map((next) => next.action) });
  console.log(`${scenario.name}: ${offer.maxCashPrice} - fixed ${fixedSum}, max ${maxPercent}% => ${net}`);
}
await writeFile(output, `${JSON.stringify({ schemaVersion: 1, capturedAt: new Date().toISOString(), sourceUrl: endpoint,
  capturePolicy: { submittedOnlyAnonymousQuote: true, submittedTradingChannel: false, submittedContactOrLead: false, changedPublishedBasePrice: false, usedOnlyPublishedChoices: true },
  observedRule: { formula: '(publishedBasePrice - sum(selectedFixedDeductions)) * (1 - max(selectedPercentDeductions) / 100)',
    fixedAggregation: 'SUM', percentageAggregation: 'GLOBAL_MAX_ACROSS_SINGLE_AND_MULTI', roundDownToTen: false,
    fractionalBahtRounding: 'UNDETERMINED: all captured base prices/fixed deductions are multiples of 100 and percent deductions are integers.',
    negativeResultFloor: 'NOT_TESTED' }, observations }, null, 2)}\n`);
if (observations.some((entry) => !entry.matchesObservedRule)) throw new Error('Observed quote disagrees with candidate formula; inspect artifact before implementation');
