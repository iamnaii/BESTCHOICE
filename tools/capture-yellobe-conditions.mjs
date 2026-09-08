#!/usr/bin/env node
/** Capture public condition questionnaires only. Never submit a sale or personal information. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const captureDate = '2026-09-08';
const cacheDir = path.join(root, '.tmp', `yellobe-${captureDate}`);
const outputPath = path.join(
  root,
  'docs',
  'reference',
  `yellobe-${captureDate}`,
  'conditions.json',
);
const endpoint = 'https://www.yellobe.com/buy/detail';
const brandId = '104';
const concurrency = 2;
const requestSpacingMs = 300;
const clean = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextRequestAt = 0;

function dom(html) {
  // No scripts, resource loading, browser cookies, analytics or form submission.
  return new JSDOM(html, { url: endpoint, virtualConsole: new VirtualConsole() });
}
function nodeText(node) {
  if (!node) return null;
  const copy = node.cloneNode(true);
  copy.querySelectorAll('br').forEach((br) => br.replaceWith(' '));
  return clean(copy.textContent) || null;
}
function hiddenValue(form, name) {
  return form.querySelector(`input[name="${name}"]`)?.getAttribute('value') ?? null;
}
function amount(value, description) {
  if (!/^\d+(?:\.\d+)?$/.test(value ?? '')) throw new Error(`Invalid ${description}: ${value}`);
  return value;
}
function semanticConditions(questions) {
  return questions.map((question) => ({
    title: question.title,
    selectType: question.selectType,
    helpText: question.helpText,
    choices: question.choices.map((choice) => ({
      label: choice.label,
      deductType: choice.deductType,
      deductValue: choice.deductValue,
      helpText: choice.helpText,
      isNoneChoice: choice.isNoneChoice,
    })),
  }));
}
function parseQuestionnaire(html, expected) {
  const page = dom(html);
  try {
    const doc = page.window.document;
    const form = doc.querySelector('form.form-buy-detail');
    if (!form) throw new Error('Missing public questionnaire form');
    const actual = {
      modelId: hiddenValue(form, 'sub_category_ID'),
      model: hiddenValue(form, 'sub_category_Name_TH'),
      detailId: hiddenValue(form, 'orderdetail'),
      buyId: hiddenValue(form, 'orderbuy'),
      storage: hiddenValue(form, 'detail_memory'),
      maxCashPrice: hiddenValue(form, 'maxprice'),
    };
    for (const field of ['modelId', 'detailId', 'buyId']) {
      if (String(actual[field]) !== String(expected[field])) {
        throw new Error(
          `${field} mismatch: requested ${expected[field]}, received ${actual[field]}`,
        );
      }
    }
    if (clean(actual.storage) !== clean(expected.storage)) throw new Error('Storage mismatch');
    const questions = [...form.querySelectorAll('.form-box')].flatMap((box, index) => {
      const radios = [...box.querySelectorAll('input.slected_val[type="radio"]')];
      const optional = [...box.querySelectorAll('input[type="checkbox"][name="optional"]')];
      if (!radios.length && !optional.length) return [];
      if (radios.length && optional.length) throw new Error('Unexpected mixed selection controls');
      const title = nodeText(box.querySelector('.form-title'));
      const sourceGroupIds = [
        ...new Set(radios.map((radio) => radio.getAttribute('data-idgroup'))),
      ];
      if (radios.length && (sourceGroupIds.length !== 1 || !sourceGroupIds[0])) {
        throw new Error(`Unexpected radio group IDs in ${title}`);
      }
      const choices = (radios.length ? radios : optional).map((input) => {
        const item = input.closest('.checkbox-item');
        const wrapper = input.closest('.checkbox-item-wrap');
        if (!item || !wrapper) throw new Error(`Missing choice wrapper for ${input.id}`);
        const label = nodeText(input.labels?.[0]) ?? clean(input.value);
        const helpText =
          [...item.querySelectorAll('.tooltips-content')]
            .map(nodeText)
            .filter(Boolean)
            .join('\n') || null;
        if (radios.length) {
          const deduction = wrapper.querySelector('input[name^="nav_amt["]');
          const navType = deduction?.name.match(/^nav_amt\[(\d+)\]/)?.[1];
          if (!deduction || !['1', '2'].includes(navType))
            throw new Error(`Unknown deduction type for ${label}`);
          return {
            sourceInputId: input.id,
            sourceChoiceId: deduction.id.replace(/^nav_/, ''),
            sourceInputName: input.name,
            sourceValue: input.getAttribute('value'),
            sourceDeductionInputId: deduction.id,
            sourceDeductionInputName: deduction.name,
            sourceDeductionType: navType,
            label,
            deductType: navType === '1' ? 'PERCENT' : 'FIXED',
            deductValue: amount(deduction.value, label),
            helpText,
            isNoneChoice: false,
          };
        }
        const deduction = wrapper.querySelector('input[name="porp_amt[]"]');
        const isNoneChoice = input.id === 'optional-no' && input.value === '';
        if (!isNoneChoice && (!deduction || deduction.value !== input.value)) {
          throw new Error(`Functional deduction mismatch for ${label}`);
        }
        return {
          sourceInputId: input.id,
          sourceChoiceId: deduction?.id.replace(/^porp_/, '') ?? null,
          sourceInputName: input.name,
          sourceValue: input.getAttribute('value'),
          sourceDeductionInputId: deduction?.id ?? null,
          sourceDeductionInputName: deduction?.name ?? null,
          sourceDeductionType: isNoneChoice ? null : 'optional-percent',
          label,
          deductType: isNoneChoice ? null : 'PERCENT',
          deductValue: isNoneChoice ? null : amount(input.value, label),
          helpText,
          isNoneChoice,
        };
      });
      return [
        {
          order: index + 1,
          title: title?.replace(/^\d+\.\s*/, '') ?? null,
          sourceTitle: title,
          sourceGroupId: sourceGroupIds[0] ?? 'optional',
          selectType: radios.length ? 'SINGLE' : 'MULTI',
          helpText:
            [
              ...box.querySelectorAll(
                '.form-box-header > p, .form-box-body > p, .form-help, .help-text',
              ),
            ]
              .map(nodeText)
              .filter(Boolean)
              .join('\n') || null,
          choices,
        },
      ];
    });
    if (!questions.length) throw new Error('No questionnaire conditions found');
    const rawRadioCount = form.querySelectorAll('input.slected_val[type="radio"]').length;
    const parsedRadioCount = questions
      .filter((q) => q.selectType === 'SINGLE')
      .reduce((sum, q) => sum + q.choices.length, 0);
    const rawOptionalCount = form.querySelectorAll(
      'input[type="checkbox"][name="optional"]',
    ).length;
    const parsedOptionalCount = questions
      .filter((q) => q.selectType === 'MULTI')
      .reduce((sum, q) => sum + q.choices.length, 0);
    if (rawRadioCount !== parsedRadioCount || rawOptionalCount !== parsedOptionalCount)
      throw new Error('Not all choice controls were parsed');
    const pricingScriptUrls = [...doc.querySelectorAll('script[src]')]
      .map((script) => new URL(script.getAttribute('src'), doc.baseURI).href)
      .filter((url) => /page-buy-form-detail\.js(?:\?|$)/.test(url));
    if (!pricingScriptUrls.length) throw new Error('Missing public pricing script URL');
    const eligibilityRequirements = [...form.querySelectorAll('input[type="checkbox"]')]
      .filter((input) => input.name !== 'optional')
      .map((input) => ({
        name: input.name,
        label: nodeText(input.labels?.[0]),
        htmlRequired: input.required,
        requiredBeforeQuote: input.name === 'isDeviceStatusConfirmed' ? true : null,
        requirementEvidence:
          input.name === 'isDeviceStatusConfirmed'
            ? {
                sourceUrl: pricingScriptUrls[0],
                sourceLines: '81-88',
                condition: 'formStep >= currentstep && isChecked',
              }
            : null,
      }));
    return {
      ...actual,
      questions,
      profileId: `sha256:${hash(JSON.stringify({ conditions: semanticConditions(questions), eligibilityRequirements }))}`,
      counts: {
        groups: questions.length,
        radioChoices: rawRadioCount,
        functionalChoices: rawOptionalCount,
        pricedChoices: questions.reduce(
          (sum, question) => sum + question.choices.filter((choice) => !choice.isNoneChoice).length,
          0,
        ),
        noIssuesSentinels: questions.reduce(
          (sum, question) => sum + question.choices.filter((choice) => choice.isNoneChoice).length,
          0,
        ),
      },
      pricingScriptUrls,
      eligibilityRequirements,
    };
  } finally {
    page.window.close();
  }
}

await mkdir(cacheDir, { recursive: true });
await mkdir(path.dirname(outputPath), { recursive: true });
const modelPage = dom(await readFile(path.join(cacheDir, 'iphone-models.html'), 'utf8'));
const models = [...modelPage.window.document.querySelectorAll('option')]
  .map((option) => ({ modelId: option.value, model: clean(option.textContent) }))
  .filter(
    ({ model }) =>
      /^iPhone Air$/i.test(model) || Number(model.match(/^iPhone\s+(\d+)/i)?.[1] ?? 0) >= 12,
  );
modelPage.window.close();
const onlyArgument = process.argv.find((arg) => arg.startsWith('--only-models='));
const selectedModelIds = onlyArgument?.slice('--only-models='.length).split(',');
const selectedModels = selectedModelIds
  ? models.filter((model) => selectedModelIds.includes(model.modelId))
  : models;
const tasks = [];
for (const model of selectedModels) {
  const capacities = JSON.parse(
    await readFile(path.join(cacheDir, `capacities-${model.modelId}.json`), 'utf8'),
  );
  if (!Array.isArray(capacities) || !capacities.length)
    throw new Error(`No capacities for ${model.model}`);
  for (const capacity of capacities) {
    tasks.push({
      ...model,
      detailId: String(capacity.detail_ID),
      buyId: String(capacity.buy_ID),
      storage: capacity.detail_memory,
      maxCashPrice: String(capacity.detail_price),
    });
  }
}
// Give the first iPhone 12 and 17 pages priority for an early comparison.
tasks.sort((a, b) => {
  const priority = (task) => (task.modelId === '368' ? 0 : task.modelId === '1165' ? 1 : 2);
  return priority(a) - priority(b);
});
const records = [];
const failures = [];
let cursor = 0;
function output() {
  const profiles = new Map();
  for (const record of records) {
    if (!profiles.has(record.profileId))
      profiles.set(record.profileId, {
        profileId: record.profileId,
        conditions: semanticConditions(record.questions),
        eligibilityRequirements: record.eligibilityRequirements,
        members: [],
      });
    profiles
      .get(record.profileId)
      .members.push({
        modelId: record.modelId,
        model: record.model,
        detailId: record.detailId,
        storage: record.storage,
      });
  }
  const orderedRecords = [...records].sort(
    (a, b) => Number(a.modelId) - Number(b.modelId) || Number(a.detailId) - Number(b.detailId),
  );
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    source: {
      endpoint,
      brandId,
      pricingScriptUrls: [...new Set(records.flatMap((record) => record.pricingScriptUrls))],
    },
    capturePolicy: {
      concurrency,
      requestSpacingMs,
      executedPageScripts: false,
      submittedSale: false,
      includedPersonalInformation: false,
    },
    coverage: {
      eligibleModels: models.length,
      requestedModels: selectedModels.length,
      requestedCapacities: tasks.length,
      capturedModels: new Set(records.map((r) => r.modelId)).size,
      capturedCapacities: records.length,
      failedCapacities: failures.length,
      complete: records.length === tasks.length && !failures.length,
    },
    distinctProfiles: profiles.size,
    profiles: [...profiles.values()],
    records: orderedRecords,
    failures,
  };
}
let persistQueue = Promise.resolve();
function persist() {
  const content = `${JSON.stringify(output(), null, 2)}\n`;
  persistQueue = persistQueue.then(() => writeFile(outputPath, content));
  return persistQueue;
}
async function capture(task) {
  const cachePath = path.join(cacheDir, `detail-${task.detailId}.html`);
  const metadataPath = path.join(cacheDir, `detail-${task.detailId}.meta.json`);
  const request = {
    brand: brandId,
    seri: task.modelId,
    size_id: task.detailId,
    orderbuy: task.buyId,
    orderdetail: task.detailId,
    maxprice_hid: task.maxCashPrice,
  };
  let html;
  let metadata;
  try {
    html = await readFile(cachePath, 'utf8');
    try {
      metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    } catch {
      metadata = {
        fetchedAt: (await stat(cachePath)).mtime.toISOString(),
        timestampSource: 'existing-cache-mtime',
        request,
      };
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const scheduledAt = Math.max(Date.now(), nextRequestAt);
    nextRequestAt = scheduledAt + requestSpacingMs;
    await delay(Math.max(0, scheduledAt - Date.now()));
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' },
      body: new URLSearchParams(request),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    html = await response.text();
    metadata = {
      fetchedAt: new Date().toISOString(),
      timestampSource: 'http-response',
      status: response.status,
      request,
    };
    await writeFile(cachePath, html);
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  }
  const parsed = parseQuestionnaire(html, task);
  records.push({
    ...parsed,
    source: {
      url: endpoint,
      method: 'POST',
      request,
      fetchedAt: metadata.fetchedAt,
      timestampSource: metadata.timestampSource,
      rawCache: path.relative(root, cachePath),
      sha256: hash(html),
    },
  });
  await persist();
  console.log(
    `${records.length}/${tasks.length} ${task.model} ${task.storage}: ${parsed.counts.groups} groups, ${parsed.profileId.slice(0, 19)}`,
  );
}
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      try {
        await capture(task);
      } catch (error) {
        failures.push({ ...task, error: error.message });
        await persist();
        console.error(`${task.model} ${task.storage}: ${error.message}`);
      }
    }
  }),
);
await persist();
console.log(
  JSON.stringify({
    outputPath: path.relative(root, outputPath),
    ...output().coverage,
    distinctProfiles: output().distinctProfiles,
  }),
);
if (failures.length) process.exitCode = 1;
