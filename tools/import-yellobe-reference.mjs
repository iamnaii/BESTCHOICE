#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://www.yellobe.com/buy';
const CONFIG_KEY = 'sell_reference_pricing_v1';
const GROUPS = {
  182: ['device-origin', 'SINGLE'], 183: ['warranty', 'SINGLE'],
  247: ['body-condition', 'SINGLE'], 248: ['screen-condition', 'SINGLE'],
  249: ['display-condition', 'SINGLE'], 250: ['battery-health', 'SINGLE'],
  257: ['accessories', 'SINGLE'], optional: ['functional-issues', 'MULTI'],
};
const normalizeText = (text) => String(text ?? '').trim().replace(/\s+/g, ' ');
const normalizeStorage = (text) => normalizeText(text).replace(/\s+/g, '').toUpperCase();
const tuple = (row) => `${normalizeText(row.model).toLowerCase()}|${normalizeStorage(row.storage)}`;
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const required = (value, label) => { const text = normalizeText(value); assert.ok(text, `Missing ${label}`); return text; };
function decimal(value, label, positive = false) {
  const text = String(value ?? '');
  assert.match(text, /^\d+(?:\.\d{1,2})?$/, `Invalid ${label}`);
  const [whole, fraction = ''] = text.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  assert.ok(cents <= 999999999999n && (!positive || cents > 0n), `Invalid ${label}`);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
function timestamp(value) {
  assert.ok(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'Invalid source capture timestamp');
  return new Date(value).toISOString();
}
function compileProfile(record) {
  assert.equal(record.questions?.length, 8, `Expected 8 condition groups for detail ${record.detailId}`);
  const byGroup = new Map(record.questions.map((question) => [String(question.sourceGroupId), question]));
  assert.equal(byGroup.size, 8, 'Duplicate condition group');
  const questions = Object.entries(GROUPS).map(([groupId, [key, selectType]]) => {
    const source = byGroup.get(groupId);
    assert.ok(source, `Missing condition group ${groupId}`);
    assert.equal(source.selectType, selectType, `Wrong type for ${key}`);
    assert.ok(Array.isArray(source.choices), `Missing choices for ${key}`);
    const choices = source.choices.filter((choice) => !choice.isNoneChoice).map((choice) => {
      assert.ok(['FIXED', 'PERCENT'].includes(choice.deductType), `Invalid deduction type for ${key}`);
      const value = decimal(choice.deductValue, 'deduction');
      if (choice.deductType === 'PERCENT') assert.ok(Number(value) <= 100, 'Percent exceeds 100');
      return { label: required(choice.label, 'choice label'), deductType: choice.deductType,
        deductValue: value.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1'), helpText: choice.helpText ?? null };
    });
    assert.ok(choices.length > 0, `Empty priced choices for ${key}`);
    return { key, title: required(source.title, 'question title'), helpText: source.helpText ?? null, selectType, choices };
  });
  const eligibility = record.eligibilityRequirements?.filter((entry) => entry.requiredBeforeQuote);
  assert.equal(eligibility?.length, 1, 'Expected one required eligibility confirmation');
  const semantic = { pricingMode: 'MAX_PERCENT_EXACT', eligibilityRequired: true,
    eligibilityText: required(eligibility[0].label, 'eligibility text'), questions };
  const profileId = `yellobe-${digest(semantic)}`;
  return { profileId, profile: { ...semantic, questions: questions.map((question) => {
    const id = `${profileId}-${question.key}`;
    return { ...question, id, choices: question.choices.map((choice, index) => ({ ...choice, id: `${id}-${index + 1}` })) };
  }) } };
}

/** Pure compilation: no filesystem, HTTP, database or environment access. */
export function buildCatalog(prices, conditions) {
  assert.equal(prices.sourcePageUrl, SOURCE, 'Unexpected price source');
  assert.equal(conditions.source?.endpoint, `${SOURCE}/detail`, 'Unexpected condition source');
  assert.ok(Array.isArray(prices.rows) && prices.rows.length > 0, 'Missing prices');
  assert.ok(Array.isArray(conditions.records), 'Missing condition records');
  assert.equal(conditions.records.length, prices.rows.length, 'Price/condition coverage differs');
  const records = new Map(conditions.records.map((record) => [String(record.detailId), record]));
  assert.equal(records.size, conditions.records.length, 'Duplicate condition detail ID');
  const seenDetails = new Set();
  const seenTuples = new Set();
  const dates = [];
  const profiles = {};
  const assignments = [];
  const valuations = [];
  const skipped = [];
  for (const row of prices.rows) {
    const detailId = required(row.detailId, 'detail ID');
    assert.ok(!seenDetails.has(detailId), `Duplicate price detail ${detailId}`);
    seenDetails.add(detailId);
    const record = records.get(detailId);
    assert.ok(record, `Missing condition join for detail ${detailId}`);
    assert.equal(String(record.modelId), String(row.modelId), `Model ID mismatch for ${detailId}`);
    assert.equal(String(record.buyId), String(row.buyId), `Buy ID mismatch for ${detailId}`);
    const basePrice = decimal(row.maxCashPrice, `positive price for ${detailId}`, true);
    assert.equal(decimal(record.maxCashPrice, 'condition price', true), basePrice, `Price changed between captures for ${detailId}`);
    dates.push(timestamp(row.fetchedAt), timestamp(record.source?.fetchedAt));
    const { profileId, profile } = compileProfile(record);
    const model = required(row.model, 'model');
    const storage = normalizeStorage(row.storage);
    assert.ok(/^iPhone Air$/i.test(model) || Number(/^iPhone\s+(\d+)/i.exec(model)?.[1] ?? 0) >= 12, `Out-of-scope model ${model}`);
    assert.match(storage, /^\d+(GB|TB)$/, 'Invalid capacity');
    assert.ok(Array.isArray(row.flags), 'Missing offer review flags');
    const key = tuple({ model, storage });
    assert.ok(!seenTuples.has(key), `Duplicate model/capacity ${key}`);
    seenTuples.add(key);
    if (row.flags.length) { skipped.push({ model, storage, detailId, flags: [...row.flags] }); continue; }
    profiles[profileId] = profile;
    assignments.push({ model, storage, profileId });
    valuations.push({ brand: 'Apple', model, storage, condition: 'A', basePrice,
      note: `Yellobe published maximum before deductions; source=${SOURCE}; detailId=${detailId}; priceCapturedAt=${row.fetchedAt}; conditionsCapturedAt=${record.source.fetchedAt}` });
  }
  dates.sort();
  const capturedAtRange = { earliest: dates[0], latest: dates.at(-1) };
  return { catalog: { version: 1, source: SOURCE, capturedAt: capturedAtRange.latest, profiles, assignments },
    valuations, skipped, capturedAtRange };
}

async function assertManagedLocal(repo) {
  const state = JSON.parse(await readFile(path.join(repo, '.tmp/local-preview/state.json'), 'utf8'));
  assert.equal(state.repo, repo, 'Preview state belongs to another repository');
  assert.equal(state.port, 5195, 'Importer only accepts the managed preview on port 5195');
  assert.ok(typeof state.runId === 'string' && state.runId.length > 0, 'Missing managed run ID');
  assert.match(state.dataDir, /^\/tmp\/bc-chat-credit\.[A-Za-z0-9]+$/, 'Unexpected isolated database directory');
  const actualRoot = await realpath(state.dataDir);
  assert.equal(actualRoot, path.join(await realpath('/tmp'), path.basename(state.dataDir)), 'Database directory must not redirect elsewhere');
  assert.equal(await realpath(path.join(state.dataDir, 'socket')), path.join(actualRoot, 'socket'), 'Database socket must be inside the isolated directory');
  const response = await fetch('http://127.0.0.1:5195/api/admin/preview/info', { signal: AbortSignal.timeout(3000) });
  assert.ok(response.ok, 'Managed preview info unavailable');
  const info = await response.json();
  assert.equal(info.isolated, true, 'Preview must be isolated');
  assert.equal(info.repoRoot, repo, 'Live preview belongs to another repository');
  assert.equal(info.runId, state.runId, 'Live preview does not match the managed run');
  assert.equal(info.ocr, 'mock', 'Preview OCR must be simulated');
  assert.equal(info.storage, 'local-files', 'Preview storage must be local');
  // Explicit constructor override below is the only database source. No inherited URL is read.
  const databaseUrl = new URL('postgresql://credit_test@localhost:55476/bc_chat_credit_test');
  databaseUrl.searchParams.set('host', path.join(state.dataDir, 'socket'));
  databaseUrl.searchParams.set('schema', 'public');
  return { state, databaseUrl: databaseUrl.href };
}

async function snapshot(db) {
  const [valuations, config] = await Promise.all([
    db.tradeInValuation.findMany({ where: { brand: { equals: 'Apple', mode: 'insensitive' }, condition: 'A' }, orderBy: { id: 'asc' } }),
    db.systemConfig.findUnique({ where: { key: CONFIG_KEY } }),
  ]);
  return { valuations, config };
}

async function applyLocal(repo, built, captureDate) {
  const verified = await assertManagedLocal(repo);
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: verified.databaseUrl } } });
  try {
    const [identity] = await db.$queryRaw`SELECT current_database() AS database, current_user AS username`;
    assert.equal(identity.database, 'bc_chat_credit_test');
    assert.equal(identity.username, 'credit_test');
    const before = await snapshot(db);
    const backupDir = path.join(repo, '.tmp', `yellobe-${captureDate}`);
    await mkdir(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `pre-import-${new Date().toISOString().replaceAll(':', '-')}.json`);
    await writeFile(backupPath, `${JSON.stringify({ capturedAt: new Date().toISOString(), runId: verified.state.runId, repo, ...before }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    const fresh = await assertManagedLocal(repo);
    assert.equal(fresh.databaseUrl, verified.databaseUrl, 'Managed database changed');
    assert.equal(fresh.state.runId, verified.state.runId, 'Managed run changed');
    const result = await db.$transaction(async (tx) => {
      const current = await snapshot(tx);
      assert.equal(digest(current), digest(before), 'Reference data changed after backup; retry a fresh import');
      assert.ok(!current.config?.deletedAt, 'Refusing to resurrect a soft-deleted reference configuration');
      const byTuple = new Map();
      for (const entry of current.valuations) {
        const key = tuple(entry);
        const matches = byTuple.get(key) ?? [];
        matches.push(entry);
        byTuple.set(key, matches);
      }
      let created = 0; let updated = 0; let unchanged = 0;
      // Validate every collision before the first write; transaction also rolls back on any failure.
      for (const valuation of built.valuations) {
        const matches = byTuple.get(tuple(valuation)) ?? [];
        assert.ok(matches.length <= 1, `Ambiguous existing valuation for ${tuple(valuation)}`);
        assert.ok(!matches[0]?.deletedAt, `Refusing soft-deleted valuation ${tuple(valuation)}`);
      }
      for (const valuation of built.valuations) {
        const existing = byTuple.get(tuple(valuation))?.[0];
        if (!existing) { await tx.tradeInValuation.create({ data: valuation }); created++; }
        else if (decimal(existing.basePrice, 'stored price') === valuation.basePrice && existing.note === valuation.note) unchanged++;
        else { await tx.tradeInValuation.update({ where: { id: existing.id }, data: { basePrice: valuation.basePrice, note: valuation.note } }); updated++; }
      }
      const value = JSON.stringify(built.catalog);
      const label = 'ราคาและแบบประเมินอ้างอิง Yellobe สำหรับทดสอบ local';
      if (current.config?.value !== value || current.config?.label !== label) {
        await tx.systemConfig.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value, label }, update: { value, label } });
      }
      return { created, updated, unchanged };
    }, { isolationLevel: 'Serializable', timeout: 30000 });
    return { ...result, backupPath };
  } finally { await db.$disconnect(); }
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.every((arg) => arg === '--apply-local' || arg === '--dry-run'), 'Only --dry-run or --apply-local are accepted');
  assert.ok(!(args.includes('--apply-local') && args.includes('--dry-run')), 'Choose one mode');
  const repo = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const captureDate = '2026-09-08';
  const directory = path.join(repo, 'docs/reference', `yellobe-${captureDate}`);
  const [prices, conditions] = await Promise.all(['prices', 'conditions'].map(async (name) => JSON.parse(await readFile(path.join(directory, `${name}.json`), 'utf8'))));
  const built = buildCatalog(prices, conditions);
  const summary = { mode: args.includes('--apply-local') ? 'apply-local' : 'dry-run', source: SOURCE,
    capturedAtRange: built.capturedAtRange, valuations: built.valuations.length,
    profiles: Object.keys(built.catalog.profiles).length, assignments: built.catalog.assignments.length, skipped: built.skipped };
  if (args.includes('--apply-local')) summary.applied = await applyLocal(repo, built, captureDate);
  console.log(JSON.stringify(summary, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
