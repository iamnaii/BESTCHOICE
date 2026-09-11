#!/usr/bin/env node
// Documents integration runner helpers — invoked by tools/docs-integration.sh.
//   node tools/docs-integration.mjs chromium      → prints a Chromium executable path
//   node tools/docs-integration.mjs run [jest…]   → writes run.json, runs the documents Jest suite,
//                                                   merges manifests, verifies every PDF artifact of
//                                                   the run, maps document coverage, writes summary.md
//   node tools/docs-integration.mjs verify <dir>  → re-runs the artifact checks + summary on an output dir
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fingerprint, git, repo } from './local-preview.mjs';

const BASELINE = 'fb0659f3ca959f77746f095389294ff2a644e0e1'; // DOC-FINAL-20260911 baseline (tag doc-final-20260911-baseline)
const require = createRequire(import.meta.url);

/**
 * Document groups the acceptance set (DOC-FINAL-20260911, #1570) must map. `keys` are the
 * `documents` values scenarios record; a group is covered when every key was recorded by a
 * passing scenario, partial when some were, missing otherwise. Keys nobody maps are listed too.
 */
export const DOCUMENT_GROUPS = [
  { id: 'DOC-01', title: 'ใบเสร็จรับเงิน / ใบลดหนี้', keys: ['RECEIPT', 'CREDIT_NOTE'] },
  { id: 'DOC-02', title: 'ใบรับของ / ใบรับเครื่องเทิร์น', keys: ['GOODS_RECEIPT', 'TRADE_IN_VOUCHER'] },
  { id: 'DOC-03', title: 'ใบสำคัญจ่าย / เงินสดย่อย / สรุปรายจ่ายรายวัน', keys: ['PAYMENT_VOUCHER', 'PETTY_CASH_REIMBURSEMENT', 'DAILY_EXPENSE_SUMMARY', 'VENDOR_SETTLEMENT'] },
  { id: 'DOC-04', title: 'สลิปเงินเดือน / ภ.ง.ด.1ก / 50 ทวิรายปี', keys: ['PAYROLL_SLIP', 'PAYROLL', 'PND1A', 'WHT_CERTIFICATE_50BIS'] },
  { id: 'DOC-05', title: 'ใบสำคัญรับเงินรายได้อื่น / สรุปรายวัน', keys: ['OTHER_INCOME_RECEIPT', 'DAILY_SHEET'] },
  { id: 'DOC-06', title: 'ใบรับสินทรัพย์ / ทะเบียนสินทรัพย์', keys: ['ASSET_RECEIPT', 'ASSET_REGISTER', 'DEPRECIATION'] },
  { id: 'DOC-07', title: 'ใบกำกับภาษี e-Tax', keys: ['TAX_INVOICE', 'TAX_INVOICE_LIST', 'E_TAX_XML', 'E_TAX_CSV'] },
  { id: 'DOC-08', title: '50 ทวิเงินปันผล / ทะเบียนผู้รับ / ภ.ง.ด.2', keys: ['DIVIDEND_REGISTER', 'PND2', 'EQUITY_DOCUMENT', 'WHT_CERTIFICATE_50BIS'] },
  { id: 'DOC-09', title: 'จดหมายติดตามหนี้', keys: ['COLLECTION_LETTER', 'RETURN_DEVICE_45D', 'CONTRACT_TERMINATION_60D'] },
  { id: 'DOC-10', title: 'Collections Report', keys: ['COLLECTIONS_REPORT'] },
  { id: 'CONTRACT-PDPA', title: 'สัญญา / PDPA (preview HTML + PDF ที่ลงนาม)', keys: ['CONTRACT', 'PDPA_CONSENT'] },
  { id: 'STICKER-50x30', title: 'สติกเกอร์ 50×30 mm (regression)', keys: ['STICKER_50X30'] },
];

/** Page boxes a document artifact may have (PDF points; Chromium reports A4 as 595.92 × 841.92). */
const PAGE_SIZES = [
  { name: 'A4', width: 595.28, height: 841.89 },
  { name: 'A4 landscape', width: 841.89, height: 595.28 },
  { name: 'sticker 50×30 mm', width: 141.73, height: 85.04 },
];
const PAGE_TOLERANCE_PT = 1.5;
const ALLOWED_FONT_PREFIX = 'THSarabunPSK';
const BOUNDS_TOLERANCE_PT = 2;

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

function coverageOf(records) {
  const recordedBy = {};
  for (const record of records) for (const doc of record.documents ?? []) (recordedBy[doc] ??= []).push({ id: record.id, status: record.status, domain: record.domain });
  const groups = DOCUMENT_GROUPS.map(group => {
    const keys = group.keys.map(key => {
      const scenarios = recordedBy[key] ?? [];
      const passing = scenarios.filter(s => s.status === 'PASS');
      return { key, scenarios: scenarios.length, passing: passing.length, ids: scenarios.map(s => s.id) };
    });
    const covered = keys.filter(k => k.passing > 0).length;
    return { ...group, keys, status: covered === keys.length ? 'covered' : covered > 0 ? 'partial' : 'missing' };
  });
  const mapped = new Set(DOCUMENT_GROUPS.flatMap(g => g.keys));
  const unmapped = Object.keys(recordedBy).filter(key => !mapped.has(key)).sort();
  return { groups, unmapped, totals: { covered: groups.filter(g => g.status === 'covered').length, partial: groups.filter(g => g.status === 'partial').length, missing: groups.filter(g => g.status === 'missing').length } };
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
    evidenceLayers: {
      automatedLayout: 'this run — API integration (real login, guards, renderer, storage) plus *.browser.docs-spec scenarios driving the real web app in headless Chromium (Playwright); every PDF artifact is parsed and checked (artifact-checks.json)',
      browserNativePdf: 'NOT covered here: rendering inside a native PDF viewer / iframe preview and the OS print dialog — headless Chromium print-to-PDF stands in for it (see each domain\'s `unverified`)',
      printerUat: 'DOC-12 (#1571, HITL) — physical printer, paper, sticker stock',
      staging: 'DOC-13 (#1572, HITL) — GCS/S3 storage, real LINE/SMS/e-mail, deployed environment',
    },
    coverage: coverageOf(records),
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

// ---------------------------------------------------------------------------
// Artifact verification — every PDF the run produced, parsed with pdfjs (same library the specs use).
// ---------------------------------------------------------------------------

function loadPdfjs() {
  // pdfjs probes for `canvas` at require time and logs "Warning: Cannot polyfill DOMMatrix".
  const log = console.log;
  console.log = (...args) => { if (!String(args[0]).startsWith('Warning: Cannot polyfill')) log(...args); };
  try { return require('pdfjs-dist/legacy/build/pdf.js'); } finally { console.log = log; }
}

function listPdfs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) { if (!['manifest', 'web', 'node_modules'].includes(name)) listPdfs(path, out); }
    else if (name.toLowerCase().endsWith('.pdf')) out.push(path);
  }
  return out;
}

function pageSizeName(width, height) {
  return PAGE_SIZES.find(size => Math.abs(size.width - width) <= PAGE_TOLERANCE_PT && Math.abs(size.height - height) <= PAGE_TOLERANCE_PT)?.name ?? null;
}

async function checkPdf(pdfjs, path) {
  const bytes = readFileSync(path);
  const problems = [];
  const pages = [];
  const fonts = new Set();
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return { problems: ['not a PDF (missing %PDF- header)'], pages, fonts: [] };
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
  } catch (error) {
    return { problems: [`unparseable: ${error?.message ?? error}`], pages, fonts: [] };
  }
  try {
    for (let index = 1; index <= doc.numPages; index += 1) {
      const page = await doc.getPage(index);
      const [x0, y0, x1, y1] = page.view;
      const width = x1 - x0;
      const height = y1 - y0;
      await page.getOperatorList();
      const content = await page.getTextContent();
      let textItems = 0;
      let outOfBounds = 0;
      for (const item of content.items) {
        if (typeof item.str !== 'string' || !item.str.trim() || !item.fontName) continue;
        textItems += 1;
        try { fonts.add(String(page.commonObjs.get(item.fontName)?.name ?? 'unknown').replace(/^[A-Z]{6}\+/, '')); } catch { fonts.add('unknown'); }
        const x = item.transform[4];
        const y = item.transform[5];
        const w = Number(item.width) || 0;
        if (x < -BOUNDS_TOLERANCE_PT || x + w > width + BOUNDS_TOLERANCE_PT || y < -BOUNDS_TOLERANCE_PT || y > height + BOUNDS_TOLERANCE_PT) outOfBounds += 1;
      }
      const size = pageSizeName(width, height);
      pages.push({ index, width: Number(width.toFixed(2)), height: Number(height.toFixed(2)), size, textItems, outOfBounds });
      if (!size) problems.push(`page ${index}: ${width.toFixed(2)} × ${height.toFixed(2)} pt is not A4 / A4 landscape / 50×30 mm`);
      if (textItems === 0) problems.push(`page ${index}: no text (blank render)`);
      if (outOfBounds > 0) problems.push(`page ${index}: ${outOfBounds} text item(s) outside the page box`);
    }
  } finally {
    await doc.destroy();
  }
  const badFonts = [...fonts].filter(font => !font.startsWith(ALLOWED_FONT_PREFIX));
  if (badFonts.length) problems.push(`fonts other than ${ALLOWED_FONT_PREFIX}: ${badFonts.join(', ')}`);
  return { problems, pages, fonts: [...fonts].sort() };
}

async function verifyArtifacts(output) {
  const pdfjs = loadPdfjs();
  const files = [];
  for (const path of listPdfs(output).sort()) {
    const rel = relative(output, path);
    const result = await checkPdf(pdfjs, path);
    files.push({ path: rel, source: rel.startsWith('storage/') ? 'storage' : 'artifact', bytes: statSync(path).size, status: result.problems.length ? 'FAIL' : 'PASS', ...result });
  }
  const totals = { files: files.length, pass: files.filter(f => f.status === 'PASS').length, fail: files.filter(f => f.status === 'FAIL').length, pages: files.reduce((n, f) => n + f.pages.length, 0) };
  const checks = { generatedAt: new Date().toISOString(), rules: { pageSizes: PAGE_SIZES, pageTolerancePt: PAGE_TOLERANCE_PT, fontPrefix: ALLOWED_FONT_PREFIX, boundsTolerancePt: BOUNDS_TOLERANCE_PT, blankPage: 'a page without any text item fails' }, totals, files };
  writeFileSync(join(output, 'artifact-checks.json'), JSON.stringify(checks, null, 2) + '\n');
  return checks;
}

// ---------------------------------------------------------------------------
// summary.md — what a reviewer reads first: status, failures with the page that failed, coverage, evidence layers.
// ---------------------------------------------------------------------------

function writeSummary(output, meta, manifest, checks) {
  const lines = [];
  const status = meta.status ?? 'RUNNING';
  lines.push(`# Documents integration — ${status}`, '');
  lines.push(`- run \`${meta.runId ?? ''}\` · revision \`${(meta.revision ?? '').slice(0, 9)}\` (${meta.branch ?? ''}) · ${meta.startedAt ?? ''} → ${meta.finishedAt ?? ''}`);
  if (meta.jest?.available) lines.push(`- jest: ${meta.jest.passed}/${meta.jest.total} tests passed (${meta.jest.failed} failed, ${meta.jest.suites} suites)`);
  else lines.push('- jest: no results file (the run did not reach the end of the suite)');
  lines.push(`- scenarios: ${manifest.totals.pass} PASS · ${manifest.totals.fail} FAIL · ${manifest.totals.blocked} BLOCKED across ${Object.keys(manifest.domains).length} domain(s)`);
  lines.push(`- PDF artifacts checked: ${checks.totals.pass}/${checks.totals.files} files (${checks.totals.pages} pages) — page box, THSarabunPSK only, text inside the page, no blank page`, '');

  const failedFiles = checks.files.filter(f => f.status === 'FAIL');
  const jestFailures = meta.jest?.failures ?? [];
  const failedScenarios = manifest.records.filter(r => r.status !== 'PASS');
  if (failedFiles.length || jestFailures.length || failedScenarios.length) {
    lines.push('## Failures', '');
    for (const failure of jestFailures) lines.push(`- test: **${failure.test ?? failure.suite}**`, '  ```', ...String(failure.message).split('\n').slice(0, 12).map(l => `  ${l}`), '  ```');
    for (const record of failedScenarios) lines.push(`- scenario ${record.status}: \`${record.id}\` — ${record.title}${record.unverified?.length ? ` (unverified: ${record.unverified.join('; ')})` : ''}`);
    for (const file of failedFiles) lines.push(`- artifact \`${file.path}\`: ${file.problems.join('; ')}`);
    lines.push('');
  } else {
    lines.push('## Failures', '', 'none', '');
  }

  lines.push('## Coverage — document groups', '', '| group | status | keys (passing scenarios) |', '| --- | --- | --- |');
  for (const group of manifest.coverage.groups) {
    lines.push(`| ${group.id} ${group.title} | ${group.status} | ${group.keys.map(k => `${k.key} (${k.passing})`).join(', ')} |`);
  }
  if (manifest.coverage.unmapped.length) lines.push('', `Recorded keys not mapped to a group: ${manifest.coverage.unmapped.join(', ')}`);
  lines.push('');

  lines.push('## Domains', '', '| domain | scenarios | pass | fail | blocked | renderers | documents |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const [name, d] of Object.entries(manifest.domains)) lines.push(`| ${name} | ${d.scenarios} | ${d.pass} | ${d.fail} | ${d.blocked} | ${d.renderers.join(', ')} | ${d.documents.join(', ')} |`);
  lines.push('');

  lines.push('## Artifact checks', '', '| file | pages | sizes | fonts | status |', '| --- | --- | --- | --- | --- |');
  for (const file of checks.files) {
    const sizes = [...new Set(file.pages.map(p => p.size ?? `${p.width}×${p.height}`))].join(', ');
    lines.push(`| ${file.path} | ${file.pages.length} | ${sizes} | ${file.fonts.join(', ') || '-'} | ${file.status}${file.problems.length ? ` — ${file.problems.join('; ')}` : ''} |`);
  }
  lines.push('');

  lines.push('## Evidence layers', '');
  for (const [layer, text] of Object.entries(manifest.evidenceLayers)) lines.push(`- **${layer}**: ${text}`);
  lines.push('', '### Not verified by this run (as declared by each domain)', '');
  for (const [name, d] of Object.entries(manifest.domains)) if (d.unverified.length) for (const item of d.unverified) lines.push(`- ${name}: ${item}`);
  lines.push('', '### Simulated (declared by each domain)', '');
  for (const [name, d] of Object.entries(manifest.domains)) for (const item of d.simulated) lines.push(`- ${name}: ${item}`);
  lines.push('');
  writeFileSync(join(output, 'summary.md'), lines.join('\n'));
}

async function finish(output, meta) {
  meta.jest = jestSummary(output);
  const manifest = mergeManifest(output, meta);
  const checks = await verifyArtifacts(output);
  meta.manifest = { file: join(output, 'manifest.json'), ...manifest.totals, domains: Object.keys(manifest.domains), coverage: manifest.coverage.totals };
  meta.artifactChecks = { file: join(output, 'artifact-checks.json'), ...checks.totals, failures: checks.files.filter(f => f.status === 'FAIL').map(f => ({ path: f.path, problems: f.problems })) };
  return { manifest, checks };
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
    databases: { shop: databaseName(process.env.DATABASE_URL ?? ''), finance: databaseName(process.env.DATABASE_URL_FINANCE ?? ''), engine: 'disposable PostgreSQL 16 on a private unix socket, session timezone UTC (as production Cloud SQL), dropped after the run' },
    scope: 'API integration with real JWT login, real guards/interceptors, real renderer and real storage adapter on synthetic data, plus browser scenarios on the real web app in headless Chromium. Not covered: native PDF viewers / OS print dialog, physical printers, staging/GCS.',
    simulated: [
      'Outbound LINE / SMS / e-mail transports are recorded by the harness and never sent',
      'Storage is a private local directory (signed URLs answer 501)',
      'All company / branch / user / customer / contract rows are synthetic and marked as test data',
      'Outbound provider credentials are pinned to empty strings for the process',
      'Scheduled jobs (cron / interval / timeout registered by AppModule) are stopped at boot; a scenario that needs a job invokes it explicitly',
    ],
    unsupported: [
      'GET /api/documents/:id/signed-url (501 under local storage)',
      'Presigned uploads (501 under local storage)',
      'Customer-facing OTP / LINE delivery',
    ],
    jestRun: { config: 'apps/api/e2e/jest-documents.json', isolation: 'one worker, recycled when its idle heap passes workerIdleMemoryLimit (every suite boots AppModule + Chromium)', nodeOptions: process.env.NODE_OPTIONS ?? null },
    jestArgs,
  };
  const runFile = join(output, 'run.json');
  const save = () => writeFileSync(runFile, JSON.stringify(meta, null, 2) + '\n');
  save();

  const jest = join(repo, 'node_modules/jest/bin/jest.js');
  const args = [jest, '--config', 'e2e/jest-documents.json', '--forceExit', '--json', `--outputFile=${join(output, 'jest-results.json')}`, ...jestArgs];
  console.log(`\nDocuments integration run ${meta.runId ?? ''}\n  revision ${meta.revision.slice(0, 9)} (${meta.branch})\n  output   ${output}\n  chromium ${meta.chromium}\n`);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: join(repo, 'apps/api'), stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('exit', (exitCode, signal) => resolve(signal ? 1 : exitCode ?? 1));
  });

  const { manifest, checks } = await finish(output, meta);
  meta.finishedAt = new Date().toISOString();
  meta.status = code === 0 && (meta.jest.failed ?? 0) === 0 && meta.jest.available && manifest.totals.fail === 0 && checks.totals.fail === 0 ? 'PASS' : 'FAIL';
  save();
  writeSummary(output, meta, manifest, checks);
  console.log(`\nDocuments integration ${meta.status}: ${meta.jest.passed ?? '?'}/${meta.jest.total ?? '?'} tests, ${manifest.totals.scenarios} scenarios in ${Object.keys(manifest.domains).length} domain(s), ${checks.totals.pass}/${checks.totals.files} PDF artifacts pass, coverage ${manifest.coverage.totals.covered}/${manifest.coverage.groups.length} groups\n  summary.md    ${join(output, 'summary.md')}\n  run.json      ${runFile}\n  manifest.json ${meta.manifest.file}`);
  for (const failure of meta.jest.failures ?? []) console.log(`  FAILED ${failure.test ?? failure.suite}`);
  for (const failure of meta.artifactChecks.failures) console.log(`  ARTIFACT ${failure.path}: ${failure.problems.join('; ')}`);
  process.exitCode = meta.status === 'PASS' ? 0 : 1;
}

async function verifyOnly(output) {
  const runFile = join(output, 'run.json');
  const meta = existsSync(runFile) ? JSON.parse(readFileSync(runFile, 'utf8')) : { runId: null, revision: '', branch: '' };
  const { manifest, checks } = await finish(output, meta);
  meta.status = (meta.jest?.failed ?? 0) === 0 && meta.jest?.available && manifest.totals.fail === 0 && checks.totals.fail === 0 ? 'PASS' : 'FAIL';
  writeFileSync(runFile, JSON.stringify(meta, null, 2) + '\n');
  writeSummary(output, meta, manifest, checks);
  console.log(`Documents integration ${meta.status}: ${checks.totals.pass}/${checks.totals.files} PDF artifacts pass, coverage ${manifest.coverage.totals.covered}/${manifest.coverage.groups.length} groups\n  summary.md ${join(output, 'summary.md')}`);
  for (const failure of meta.artifactChecks.failures) console.log(`  ARTIFACT ${failure.path}: ${failure.problems.join('; ')}`);
  process.exitCode = meta.status === 'PASS' ? 0 : 1;
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'chromium') {
  const path = resolveChromium();
  if (!path) { console.error('No Chromium found — set PUPPETEER_EXECUTABLE_PATH, run `npx playwright install chromium`, or set DOCS_QA_INSTALL_CHROMIUM=1 for tools/docs-integration.sh'); process.exit(1); }
  console.log(path);
} else if (command === 'run') {
  await run(rest);
} else if (command === 'verify') {
  await verifyOnly(rest[0] ?? process.env.DOCS_QA_OUTPUT);
} else {
  console.error('Usage: node tools/docs-integration.mjs <chromium|run|verify> [jest args | output dir]');
  process.exit(2);
}
