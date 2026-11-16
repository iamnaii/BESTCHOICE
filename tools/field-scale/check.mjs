// Field-scale check (spec docs/superpowers/specs/2026-11-14-dropdown-search-field-scale-design.md §5).
// Runs the field collector (tools/typography-audit/collect.js → window.__collectFields) and evaluateFields
// (rules F1–F4, tools/typography-audit/rules.mjs) on every screen in tools/field-scale/routes.mjs against
// this checkout's local preview, at each width × theme. On the screens with probes it also opens a menu
// and records whether it is clipped (the account menu S2-01 / S2-02, Round 2's GL / booking / inbox
// menus → rule MENU, P1).
//   node tools/field-scale/check.mjs --label <name> [--routes <id,id>] [--widths 1440,1024,390] [--themes light,dark]
//     → .tmp/field-scale/<name>/{results.json, report.md, <route>-<width>-<theme>.png}
//   node tools/field-scale/check.mjs --compare <baselineLabel> <label>
//     → prints new / fixed findings; exit 1 when a new P1/P2 finding appears, when any MENU probe fails
//       (even one the baseline had), or when a cell rendered at baseline is lost or emptied (lib.mjs compareRuns)
// A report, not a CI gate (spec §3): a measuring run exits 0 even with findings. A cell counts as rendered
// only when it shows the asked-for path, no error fallback and at least one measured field (screenProblem).
// Prerequisite: npm run local:preview before EVERY measuring run — the preview fingerprints apps/, packages/
// and tools/, so any source edit makes it stale and a stale preview is refused (exit 2); local:preview
// restarts it. Read-only: mocks answer GETs (and quote-only POSTs); open steps never save; a route with
// blockWrites aborts every other non-GET request (results.json lists them per cell as blockedWrites).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { previewStatus, repo } from '../local-preview.mjs';
import { evaluateFields } from '../typography-audit/rules.mjs';
import {
  USAGE,
  UsageError,
  applyAllow,
  compareRuns,
  formatCompare,
  menuFinding,
  parseAllow,
  parseArgs,
  renderReport,
  routeRequest,
  screenProblem,
  selectRoutes,
  summarize,
} from './lib.mjs';
import { menuClipVerdict, readMenuGeometry } from './menu-clip.mjs';
import { COLLECT_EXCLUDE, COMMON_MOCKS, MENU_SEARCH_LABEL, ROUTES, viewportFor } from './routes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_ROOT = join(repo, '.tmp', 'field-scale');
const ALLOW_PATH = join(HERE, 'allow.json');
const COLLECT_JS = join(HERE, '..', 'typography-audit', 'collect.js');

const firstLine = (error) => String(error?.message ?? error).split('\n')[0].slice(0, 300);
const loadAllow = () => parseAllow(JSON.parse(readFileSync(ALLOW_PATH, 'utf8')));
const apiPathOf = (url) => url.pathname.replace(/^\/api(?:\/admin)?(?=\/|$)/, '');

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForTimeout(250);
}

// The preview has no login: a fixed OWNER actor answers every request (chat-credit-preview.ts).
async function previewContext(port, info) {
  const base = `http://127.0.0.1:${port}/api/admin`;
  const get = async (path) => {
    const res = await fetch(base + path, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return res.json();
  };
  const me = await get('/auth/me');
  // by name, not the default newest-first: a stable pick across preview restarts
  const customers = await get('/customers?limit=1&sortBy=name&sortOrder=asc');
  return {
    origin: `http://localhost:${port}`,
    me,
    customerId: customers?.data?.[0]?.id ?? null,
    contractPath: info?.documentUrl ? new URL(info.documentUrl).pathname : null,
    // the synthetic SHOP chat room (same one menu-clip-components.mjs opens) — the Round 2 inbox routes
    shopRoomId: info?.chatWorkRooms?.SHOP ?? null,
  };
}

async function installNetwork(page, route, ctx, cell) {
  const mocks = [...COMMON_MOCKS, ...route.mocks];
  const mocked = new Set();
  const blocked = new Set();
  const errors = new Map();
  await page.routeWebSocket('**/socket.io/**', (socket) => socket.close());
  await page.route((url) => url.pathname.startsWith('/api/'), async (r) => {
    const request = r.request();
    const url = new URL(request.url());
    const path = apiPathOf(url);
    const decision = routeRequest(route, mocks, request.method(), path);
    if (decision.action === 'mock') {
      mocked.add(path);
      return r.fulfill({ json: await decision.mock.json(url, ctx) });
    }
    if (decision.action === 'block') {
      blocked.add(`${request.method()} ${path}`);
      return r.abort();
    }
    return r.fallback();
  });
  page.on('response', (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith('/api/') || res.status() < 400) return;
    const entry = { method: res.request().method(), path: apiPathOf(url), status: res.status() };
    errors.set(`${entry.method} ${entry.path} ${entry.status}`, entry);
  });
  return () => {
    cell.mocked = [...mocked].sort();
    cell.blockedWrites = [...blocked].sort();
    cell.apiErrors = [...errors.values()];
  };
}

async function runMenuProbe(page, probe, screenshotPath) {
  try {
    const trigger = probe.trigger(page);
    await trigger.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    // Held before the click: a modal Radix menu (Select) hides everything else from the accessibility
    // tree once open, so a role-based locator no longer finds its own trigger.
    const handle = await trigger.elementHandle();
    await trigger.click();
    await page.waitForTimeout(300);
    const geometry =
      probe.menu === 'controls'
        ? await handle.evaluate(readMenuGeometry)
        : await page.evaluate(readMenuGeometry, MENU_SEARCH_LABEL);
    await page.screenshot({ path: screenshotPath, animations: 'disabled' });
    await page.keyboard.press('Escape');
    return { id: probe.id, ...menuClipVerdict(geometry), geometry };
  } catch (error) {
    return { id: probe.id, ok: false, error: true, reasons: [`probe error: ${firstLine(error)}`], geometry: null };
  }
}

// In the page: the heading of a visible error fallback — the root ErrorBoundary (ErrorBoundary.tsx:76,
// which replaces .app-shell) or a QueryBoundary error (QueryBoundary.tsx:65-70) — or null.
function readErrorFallback() {
  const shown = (el) => !!el && el.getClientRects().length > 0;
  if (!shown(document.querySelector('.app-shell'))) {
    const h1 = [...document.querySelectorAll('h1')].find(shown);
    return h1?.textContent.trim() || 'the app shell is gone';
  }
  const h2 = [...document.querySelectorAll('[role="alert"] > h2')].find(shown);
  return h2 ? h2.textContent.trim() : null;
}

async function measureCell(browser, route, width, theme, ctx, outDir) {
  const cell = {
    route: route.id, path: null, width, theme, status: 'rendered', finalPath: null, openError: null, error: null,
    factCount: 0, screenshot: null, mocked: [], blockedWrites: [], apiErrors: [], findings: [], probes: [],
  };
  const context = await browser.newContext({ viewport: viewportFor(width), reducedMotion: 'reduce' });
  await context.addInitScript((value) => {
    try {
      localStorage.setItem('theme', value);
    } catch {
      // storage blocked — the page falls back to its default theme
    }
  }, theme);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const flushNetwork = await installNetwork(page, route, ctx, cell);
  try {
    cell.path = typeof route.path === 'function' ? await route.path(ctx) : route.path;
    if (!cell.path) {
      cell.status = 'skipped';
      cell.error = 'preview has no sample record for this screen';
      return cell;
    }
    await page.goto(ctx.origin + cell.path, { waitUntil: 'domcontentloaded' });
    await page.locator('.app-shell').first().waitFor({ state: 'visible', timeout: 20000 });
    await settle(page);
    if (route.open) {
      try {
        await route.open(page);
        await settle(page);
      } catch (error) {
        cell.status = 'open-failed';
        cell.openError = firstLine(error);
      }
    }
    const url = new URL(page.url());
    cell.finalPath = url.pathname + url.search;
    cell.screenshot = `${route.id}-${width}-${theme}.png`;
    await page.screenshot({ path: join(outDir, cell.screenshot), fullPage: true, animations: 'disabled' });
    if (!(await page.evaluate(() => typeof window.__collectFields === 'function'))) {
      await page.addScriptTag({ path: COLLECT_JS });
    }
    const facts = await page.evaluate((exclude) => {
      if (typeof window.__collectFields !== 'function') {
        throw new Error('tools/typography-audit/collect.js has no window.__collectFields — land Task 1 first');
      }
      return window.__collectFields({ exclude, root: 'body' });
    }, COLLECT_EXCLUDE);
    cell.factCount = facts.length;
    const problem = screenProblem({
      requestedPath: cell.path, finalPath: cell.finalPath, factCount: cell.factCount,
      fallbackText: await page.evaluate(readErrorFallback),
    });
    if (problem) throw new Error(problem);
    cell.findings = evaluateFields(facts, { width }).map((f) => ({ ...f, route: route.id, width, theme }));
    for (const probe of route.probes ?? []) {
      if (!probe.widths.includes(width)) continue;
      const result = await runMenuProbe(page, probe, join(outDir, `${route.id}-${width}-${theme}-${probe.id}.png`));
      cell.probes.push(result);
      const finding = menuFinding(result, { route: route.id, width, theme });
      if (finding) cell.findings.push(finding);
    }
  } catch (error) {
    cell.status = 'error';
    cell.error = firstLine(error);
  } finally {
    flushNetwork();
    await context.close();
  }
  return cell;
}

async function run(args) {
  const routes = selectRoutes(args.routes, ROUTES);
  const allow = loadAllow();
  const status = await previewStatus();
  if (!status.running || !status.current) {
    console.error(
      'Local preview is not running for this checkout, or is older than the source (any edit under apps/, packages/ ' +
        'or tools/ makes it stale). Run: npm run local:preview — it restarts a stale preview — then run this command again.',
    );
    process.exitCode = 2;
    return;
  }
  const ctx = await previewContext(status.state.port, status.info);
  const outDir = join(OUTPUT_ROOT, args.label);
  mkdirSync(outDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const cells = [];
  const browser = await chromium.launch();
  try {
    for (const route of routes) {
      for (const width of args.widths) {
        for (const theme of args.themes) {
          const cell = await measureCell(browser, route, width, theme, ctx, outDir);
          cell.findings = applyAllow(cell.findings, allow);
          cells.push(cell);
          const probes = cell.probes.map((p) => ` · ${p.id} ${p.ok ? 'PASS' : 'FAIL'}`).join('');
          const open = cell.findings.filter((f) => !f.allowed).length;
          const why = cell.error ?? cell.openError;
          console.log(
            `${route.id} ${width} ${theme}: ${cell.status}${why ? ` (${why})` : ''} · facts ${cell.factCount} · findings ${open}${probes}`,
          );
        }
      }
    }
  } finally {
    await browser.close();
  }
  const results = {
    label: args.label,
    startedAt,
    finishedAt: new Date().toISOString(),
    origin: ctx.origin,
    sourceRevision: status.info.sourceRevision ?? null,
    widths: args.widths,
    themes: args.themes,
    routes: routes.map((r) => r.id),
    routeMeta: routes.map((r) => ({
      id: r.id, path: typeof r.path === 'string' ? r.path : '(from preview data)', appendix: r.appendix,
    })),
    cells,
  };
  writeFileSync(join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  writeFileSync(join(outDir, 'report.md'), renderReport(results));
  const s = summarize(results);
  console.log(`\nopen findings: ${s.total} (P1 ${s.bySeverity.P1} · P2 ${s.bySeverity.P2} · P3 ${s.bySeverity.P3}) · allowed ${s.allowed}`);
  console.log(`menu probes: ${s.probes.filter((p) => p.ok).length} pass · ${s.probes.filter((p) => !p.ok).length} fail`);
  console.log(`cells not fully measured: ${s.problems.length} · API errors without a mock: ${s.apiErrors.length}`);
  console.log(`wrote ${join(outDir, 'results.json')} and report.md`);
}

function readRun(label) {
  const file = join(OUTPUT_ROOT, label, 'results.json');
  if (!existsSync(file)) {
    throw new UsageError(`no results for "${label}" — run: node tools/field-scale/check.mjs --label ${label}`);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

// The current allow.json is applied to both runs, so an entry added in a PR covers its own compare.
function compare(args) {
  const baseline = readRun(args.baseline);
  const current = readRun(args.label);
  const allow = loadAllow();
  const reapply = (r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, findings: applyAllow(c.findings, allow) })) });
  const result = compareRuns(reapply(baseline), reapply(current));
  console.log(formatCompare(result, args.baseline, args.label));
  process.exitCode = result.failed ? 1 : 0;
}

async function main(argv) {
  try {
    const args = parseArgs(argv);
    if (args.mode === 'compare') compare(args);
    else await run(args);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`${error.message}\n${USAGE}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
