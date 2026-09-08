import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildCatalog } from './import-yellobe-reference.mjs';

const directory = new URL('../docs/reference/yellobe-2026-09-08/', import.meta.url);
const prices = JSON.parse(await readFile(new URL('prices.json', directory), 'utf8'));
const conditions = JSON.parse(await readFile(new URL('conditions.json', directory), 'utf8'));

test('compiles 82 reviewed offers with deterministic profiles, eight groups and no synthetic none choices', () => {
  const built = buildCatalog(prices, conditions);
  assert.equal(built.valuations.length, 82);
  assert.equal(built.catalog.assignments.length, 82);
  assert.equal(built.skipped.length, 3);
  assert.ok(!built.valuations.some((row) => row.model === 'iPhone 13 Pro' && row.storage === '1TB'));
  assert.deepEqual(buildCatalog(prices, conditions), built);
  for (const profile of Object.values(built.catalog.profiles)) {
    assert.equal(profile.pricingMode, 'MAX_PERCENT_EXACT');
    assert.equal(profile.eligibilityRequired, true);
    assert.equal(profile.questions.length, 8);
    assert.equal(new Set(profile.questions.map((question) => question.key)).size, 8);
    const choices = profile.questions.flatMap((question) => question.choices);
    assert.equal(new Set(choices.map((choice) => choice.id)).size, choices.length);
    assert.ok(choices.every((choice) => choice.id.startsWith('yellobe-') && !choice.isNoneChoice));
    assert.ok(choices.some((choice) => choice.helpText));
    assert.equal(profile.questions.find((question) => question.selectType === 'MULTI').choices.length, 10);
  }
});

test('keeps capacity-specific deductions and joins by detail ID despite source label whitespace', () => {
  const input = structuredClone(conditions);
  input.records.forEach((row) => { row.model = ` ${row.model} `; row.storage = ` ${row.storage} `; });
  const { catalog } = buildCatalog(prices, input);
  const profileFor = (storage) => catalog.profiles[catalog.assignments.find((row) => row.model === 'iPhone 12' && row.storage === storage).profileId];
  const lightBody = (storage) => profileFor(storage).questions.find((question) => question.key === 'body-condition').choices[1].deductValue;
  assert.equal(lightBody('64GB'), '15');
  assert.equal(lightBody('128GB'), '10');
});

test('rejects missing joins and incomplete condition groups', () => {
  const missing = structuredClone(conditions);
  missing.records[0].detailId = 'not-in-prices';
  assert.throws(() => buildCatalog(prices, missing), /Missing condition join/);
  const incomplete = structuredClone(conditions);
  incomplete.records[0].questions.pop();
  assert.throws(() => buildCatalog(prices, incomplete), /8 condition groups/);
});

test('rejects zero, negative, nonfinite and out-of-range prices before import', () => {
  for (const value of ['0', '-1', 'Infinity', 'NaN', Infinity, '10000000000']) {
    const invalid = structuredClone(prices);
    invalid.rows[0].maxCashPrice = value;
    assert.throws(() => buildCatalog(invalid, conditions), /Invalid/);
  }
});
