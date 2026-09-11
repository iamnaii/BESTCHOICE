#!/usr/bin/env node
// Documents integration runner helpers — invoked by tools/docs-integration.sh.
//   node tools/docs-integration.mjs chromium      → prints a Chromium executable path
//   node tools/docs-integration.mjs run [jest…]   → writes run.json, runs the documents Jest suite, merges manifests
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fingerprint, git, repo } from './local-preview.mjs';

const BASELINE = 'fb0659f3ca959f77746f095389294ff2a644e0e1'; // DOC-FINAL-20260911 baseline (tag doc-final-20260911-baseline)

function resolveChromium() {
  const explicit = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  const attempts = [
    () => createRequire(join(repo, 'apps/api/package.json'))('puppeteer').executablePath(),
    () => createRequire(join(repo, 'package.json'))('@playwright/test').chromium.executablePath(),
  ];
  for (const attempt of attempts) {
    try { const path = attempt(); if (path && existsSync(path)) return path; } catch { /* next */ }
  }
  for (const path of ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) {
    if (existsSync(path)) return path;
  }
  return null;
}

function databaseName(url) {
  try { return new URL(url).pathname.replace(/^\//, ''); } catch { return null; }
}

function readManifestParts(output) {
  const dir = join(output, 'manifest');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => name.endsWith('.jsonl')).sort().flatMap(name =>
    readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)));
}

function mergeManifest(output, meta) {
  const records = readManifestParts(output);
  const domains = {};
  const documents = {};
  for (const record of records) {
    const domain = domains[record.domain] ??= { scenarios: 0, pass: 0, fail: 0, blocked: 0, documents: new Set(), routes: new Set(), guards: new Set(), renderers: new Set(), artifacts: new Set(), simulated: new Set(), unverified: new Set() };
    domain.scenarios += 1;
    domain[record.status.toLowerCase()] = (domain[record.status.toLowerCase()] ?? 0) + 1;
    for (const doc of record.documents ?? []) { domain.documents.add(doc); (documents[doc] ??= []).push(record.id); }
    for (const route of record.routes ?? []) domain.routes.add(route);
    for (const guard of record.guards ?? []) domain.guards.add(guard);
    domain.renderers.add(record.renderer);
    for (const artifact of record.artifacts ?? []) domain.artifacts.add(artifact);
    for (const item of record.simulated ?? []) domain.simulated.add(item);
    for (const item of record.unverified ?? []) domain.unverified.add(item);
  }
  const plain = Object.fromEntries(Object.entries(domains).map(([name, d]) => [name, Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v instanceof Set ? [...v].sort() : v]))]));
  const manifest = {
    runId: meta.runId, revision: meta.revision, sourceFingerprint: meta.sourceFingerprint, generatedAt: new Date().toISOString(),
    totals: { scenarios: records.length, pass: records.filter(r => r.status === 'PASS').length, fail: records.filter(r => r.status === 'FAIL').length, blocked: records.filter(r => r.status === 'BLOCKED').length },
    evidenceLayers: { automatedApiIntegration: 'this run', browserNative: 'not covered here (web e2e / DOC-11)', printer: 'DOC-12 (HITL)', staging: 'DOC-13 (HITL)' },
    domains: plain, documents, records,
  };
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function jestSummary(output) {
  const file = join(output, 'jest-results.json');
  if (!existsSync(file)) return { available: false };
  const results = JSON.parse(readFileSync(file, 'utf8'));
  const failures = [];
  for (const suite of results.testResults ?? []) {
    if (suite.status === 'failed' && !(suite.assertionResults ?? []).some(a => a.status === 'failed')) failures.push({ suite: suite.name, message: String(suite.message ?? '').slice(0, 2000) });
    for (const assertion of suite.assertionResults ?? []) {
      if (assertion.status === 'failed') failures.push({ suite: suite.name, test: assertion.fullName, message: (assertion.failureMessages ?? []).join('\n').slice(0, 2000) });
    }
  }
  return { available: true, total: results.numTotalTests, passed: results.numPassedTests, failed: results.numFailedTests, pending: results.numPendingTests, suites: results.numTotalTestSuites, failures };
}

async function run(jestArgs) {
  const output = process.env.DOCS_QA_OUTPUT;
  if (!output) throw new Error('DOCS_QA_OUTPUT is required (set by tools/docs-integration.sh)');
  mkdirSync(join(output, 'manifest'), { recursive: true });
  const meta = {
    runId: process.env.DOCS_QA_RUN_ID ?? null,
    status: 'RUNNING',
    startedAt: new Date().toISOString(),
    repo,
    branch: git('branch', '--show-current') || '(detached)',
    revision: git('rev-parse', 'HEAD'),
    baseline: BASELINE,
    sourceFingerprint: fingerprint(),
    node: process.version,
    output,
    api: { mode: 'in-process AppModule + configureApp() (identical to main.ts)', listen: '127.0.0.1:<random port per spec>; every scenario records the routes it hit', prefix: '/api' },
    chromium: process.env.PUPPETEER_EXECUTABLE_PATH ?? null,
    storage: { backend: 'local', directory: process.env.STORAGE_LOCAL_DIR ?? null, signedUrls: '501 Not Implemented' },
    databases: { shop: databaseName(process.env.DATABASE_URL ?? ''), finance: databaseName(process.env.DATABASE_URL_FINANCE ?? ''), engine: 'disposable PostgreSQL 16 on a private unix socket, dropped after the run' },
    scope: 'API integration with real JWT login, real guards/interceptors, real renderer and real storage adapter on synthetic data. Not covered: browser UI (web e2e), native PDF viewers, physical printers, staging/GCS.',
    simulated: [
      'Outbound LINE / SMS / e-mail transports are recorded by the harness and never sent',
      'Storage is a private local directory (signed URLs answer 501)',
      'All company / branch / user / customer / contract rows are synthetic and marked as test data',
      'Outbound provider credentials are pinned to empty strings for the process',
    ],
    unsupported: [
      'GET /api/documents/:id/signed-url (501 under local storage)',
      'Presigned uploads (501 under local storage)',
      'Customer-facing OTP / LINE delivery',
    ],
    jestArgs,
  };
  const runFile = join(output, 'run.json');
  const save = () => writeFileSync(runFile, JSON.stringify(meta, null, 2) + '\n');
  save();

  const jest = join(repo, 'node_modules/jest/bin/jest.js');
  const args = [jest, '--config', 'e2e/jest-documents.json', '--runInBand', '--forceExit', '--json', `--outputFile=${join(output, 'jest-results.json')}`, ...jestArgs];
  console.log(`\nDocuments integration run ${meta.runId ?? ''}\n  revision ${meta.revision.slice(0, 9)} (${meta.branch})\n  output   ${output}\n  chromium ${meta.chromium}\n`);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: join(repo, 'apps/api'), stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('exit', (exitCode, signal) => resolve(signal ? 1 : exitCode ?? 1));
  });

  meta.jest = jestSummary(output);
  const manifest = mergeManifest(output, meta);
  meta.manifest = { file: join(output, 'manifest.json'), ...manifest.totals, domains: Object.keys(manifest.domains) };
  meta.finishedAt = new Date().toISOString();
  meta.status = code === 0 && (meta.jest.failed ?? 0) === 0 && manifest.totals.fail === 0 ? 'PASS' : 'FAIL';
  save();
  console.log(`\nDocuments integration ${meta.status}: ${meta.jest.passed ?? '?'}/${meta.jest.total ?? '?'} tests, ${manifest.totals.scenarios} scenarios in ${Object.keys(manifest.domains).length} domain(s)\n  run.json      ${runFile}\n  manifest.json ${meta.manifest.file}`);
  for (const failure of meta.jest.failures ?? []) console.log(`  FAILED ${failure.test ?? failure.suite}`);
  process.exitCode = meta.status === 'PASS' ? 0 : 1;
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'chromium') {
  const path = resolveChromium();
  if (!path) { console.error('No Chromium found — set PUPPETEER_EXECUTABLE_PATH or run `npx playwright install chromium`'); process.exit(1); }
  console.log(path);
} else if (command === 'run') {
  await run(rest);
} else {
  console.error('Usage: node tools/docs-integration.mjs <chromium|run> [jest args]');
  process.exit(2);
}
