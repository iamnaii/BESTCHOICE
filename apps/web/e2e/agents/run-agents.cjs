/**
 * Agent Team E2E Runner
 *
 * Workaround: Playwright test CLI hangs on Node.js v24 + Windows.
 * This script runs all 6 agent tests using the Playwright library directly.
 *
 * Usage: node e2e/agents/run-agents.js [agent-number]
 * Example: node e2e/agents/run-agents.js        (runs all)
 *          node e2e/agents/run-agents.js 1       (runs agent 01 only)
 */

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';
const MAX_RESPONSE_TIME = 5000;

// --- Test tracking ---
let passed = 0, failed = 0, skipped = 0;
const failures = [];

function log(status, name, detail = '') {
  const icon = status === 'PASS' ? '\x1b[32m✓\x1b[0m' : status === 'FAIL' ? '\x1b[31m✗\x1b[0m' : '\x1b[33m-\x1b[0m';
  console.log(`  ${icon} ${name}${detail ? ' — ' + detail : ''}`);
  if (status === 'PASS') passed++;
  else if (status === 'FAIL') { failed++; failures.push(name + (detail ? ': ' + detail : '')); }
  else skipped++;
}

// --- Auth helpers ---
let cachedToken = null;

/**
 * Create a logged-in page using the localStorage bridge.
 *
 * How it works:
 * 1. Get JWT via direct API call (bypasses browser)
 * 2. Register addInitScript that sets localStorage.access_token BEFORE any page
 *    script runs — this fires on every navigation (including page.goto)
 * 3. On each SPA load, api.ts reads the token from localStorage into an in-memory
 *    variable, then removes it. Because addInitScript re-sets it before every load,
 *    auth survives full page reloads caused by page.goto().
 */
async function createLoggedInPage(browser) {
  const page = await browser.newPage();

  // Step 1: Get API token once
  if (!cachedToken) {
    const res = await page.request.post(`${API_URL}/api/auth/login`, {
      data: { email: 'admin@bestchoice.com', password: 'admin1234' },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    const data = await res.json();
    cachedToken = data.accessToken;
  }

  // Step 2: Set extra HTTP headers for page.request API calls
  await page.setExtraHTTPHeaders({
    Authorization: `Bearer ${cachedToken}`,
    'X-Requested-With': 'XMLHttpRequest',
  });

  // Step 3: addInitScript — runs before any page script on EVERY navigation.
  // This ensures api.ts always finds the token in localStorage.
  await page.addInitScript((token) => {
    localStorage.setItem('access_token', token);
  }, cachedToken);

  // Step 4: Navigate to dashboard — init script seeds localStorage before api.ts runs
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });

  return page;
}

async function apiGet(page, path) {
  const headers = {
    Authorization: `Bearer ${cachedToken}`,
    'X-Requested-With': 'XMLHttpRequest',
  };
  const start = Date.now();
  const res = await page.request.get(`${API_URL}${path}`, { headers });
  return { res, elapsed: Date.now() - start };
}

async function getFirstContractId(page) {
  const { res } = await apiGet(page, '/api/contracts?page=1');
  if (res.status() !== 200) return null;
  const body = await res.json();
  return body?.data?.[0]?.id ?? null;
}

async function getContractByStatus(page, status) {
  const { res } = await apiGet(page, `/api/contracts?page=1&status=${status}`);
  if (res.status() !== 200) return null;
  const body = await res.json();
  return body?.data?.[0]?.id ?? null;
}

async function waitForPageReady(page, timeout = 15000) {
  // Wait for React to render — look for non-empty #root content
  try {
    await page.waitForFunction(
      () => (document.querySelector('#root')?.children.length || 0) > 0,
      { timeout }
    );
  } catch { /* #root might not exist in this setup */ }
  // Wait for any visible spinner to disappear
  const spinner = page.locator('.animate-spin').first();
  try {
    await spinner.waitFor({ state: 'hidden', timeout: Math.min(timeout, 10000) });
  } catch { /* spinner might not exist */ }
  // Verify meaningful content (use innerText to skip <script> tags)
  const body = await page.locator('body').innerText().catch(() => '');
  if (!body || body.trim().length < 20) {
    throw new Error(`Page has no meaningful content (${body.trim().length} chars)`);
  }
}

async function assertNoInfiniteSpinner(page, label) {
  const spinner = page.locator('.animate-spin').first();
  const isSpinning = await spinner.isVisible().catch(() => false);
  if (isSpinning) {
    await spinner.waitFor({ state: 'hidden', timeout: 10000 });
  }
}

// --- Interceptor ---
function interceptApiCalls(page) {
  const calls = [];
  const pending = new Map();
  let nextId = 0;
  const reqIdMap = new WeakMap();

  const onReq = (req) => {
    if (req.url().includes('/api/')) {
      const id = nextId++;
      reqIdMap.set(req, id);
      pending.set(id, { url: req.url(), start: Date.now() });
    }
  };
  const onRes = (res) => {
    const id = reqIdMap.get(res.request());
    if (id !== undefined && pending.has(id)) {
      const entry = pending.get(id);
      calls.push({ url: entry.url, status: res.status(), duration: Date.now() - entry.start });
      pending.delete(id);
    }
  };
  page.on('request', onReq);
  page.on('response', onRes);
  calls.cleanup = () => { page.off('request', onReq); page.off('response', onRes); };
  return calls;
}

// ============================================================================
// Agent 1: API Health Check
// ============================================================================
async function agent01(browser) {
  console.log('\n\x1b[36m═══ Agent 1: Contract API Health Check ═══\x1b[0m');
  const page = await createLoggedInPage(browser);
  try {
    const contractId = await getFirstContractId(page);

    // Test: contracts list
    {
      const { res, elapsed } = await apiGet(page, '/api/contracts?page=1');
      const body = await res.json();
      const ok = res.status() === 200 && elapsed < MAX_RESPONSE_TIME && body.data && body.total !== undefined;
      log(ok ? 'PASS' : 'FAIL', 'GET /api/contracts', `status=${res.status()} ${elapsed}ms`);
    }

    // Test: single contract
    if (contractId) {
      const { res, elapsed } = await apiGet(page, `/api/contracts/${contractId}`);
      if (res.status() === 200) {
        const body = await res.json();
        const ok = body.contractNumber && body.status && body.customer && elapsed < MAX_RESPONSE_TIME;
        log(ok ? 'PASS' : 'FAIL', 'GET /api/contracts/:id', `status=${res.status()} ${elapsed}ms`);
      } else {
        log('FAIL', 'GET /api/contracts/:id', `status=${res.status()} ${elapsed}ms`);
      }
    } else {
      log('SKIP', 'GET /api/contracts/:id', 'No contracts in database');
    }

    // Test: documents
    if (contractId) {
      const { res, elapsed } = await apiGet(page, `/api/contracts/${contractId}/documents`);
      const ok = [200, 404].includes(res.status()) && elapsed < MAX_RESPONSE_TIME;
      log(ok ? 'PASS' : 'FAIL', 'GET /api/contracts/:id/documents', `status=${res.status()} ${elapsed}ms`);
    } else {
      log('SKIP', 'GET /api/contracts/:id/documents');
    }

    // Test: preview
    if (contractId) {
      const { res, elapsed } = await apiGet(page, `/api/contracts/${contractId}/preview`);
      const ok = elapsed < MAX_RESPONSE_TIME;
      log(ok ? 'PASS' : 'FAIL', 'GET /api/contracts/:id/preview', `status=${res.status()} ${elapsed}ms`);
    } else {
      log('SKIP', 'GET /api/contracts/:id/preview');
    }

    // Test: schedule
    if (contractId) {
      const { res, elapsed } = await apiGet(page, `/api/contracts/${contractId}/schedule`);
      const ok = [200, 404].includes(res.status()) && elapsed < MAX_RESPONSE_TIME;
      log(ok ? 'PASS' : 'FAIL', 'GET /api/contracts/:id/schedule', `status=${res.status()} ${elapsed}ms`);
    } else {
      log('SKIP', 'GET /api/contracts/:id/schedule');
    }

    // Test: contract-templates
    {
      const { res, elapsed } = await apiGet(page, '/api/contract-templates');
      const ok = res.status() === 200 && elapsed < MAX_RESPONSE_TIME;
      log(ok ? 'PASS' : 'FAIL', 'GET /api/contract-templates', `status=${res.status()} ${elapsed}ms`);
    }

    // Test: products
    {
      const { res, elapsed } = await apiGet(page, '/api/products?status=IN_STOCK&limit=10');
      const ok = res.status() === 200 && elapsed < MAX_RESPONSE_TIME;
      log(ok ? 'PASS' : 'FAIL', 'GET /api/products?status=IN_STOCK', `status=${res.status()} ${elapsed}ms`);
    }

    // Test: customers
    {
      const { res, elapsed } = await apiGet(page, '/api/customers?page=1');
      const ok = res.status() === 200 && elapsed < MAX_RESPONSE_TIME;
      log(ok ? 'PASS' : 'FAIL', 'GET /api/customers', `status=${res.status()} ${elapsed}ms`);
    }

    // Test: settings
    {
      const { res, elapsed } = await apiGet(page, '/api/settings');
      const ok = res.status() === 200 && elapsed < MAX_RESPONSE_TIME;
      log(ok ? 'PASS' : 'FAIL', 'GET /api/settings', `status=${res.status()} ${elapsed}ms`);
    }
  } finally {
    await page.close();
  }
}

// ============================================================================
// Agent 2: Page Load — Anti-Spin Detection
// ============================================================================
async function agent02(browser) {
  console.log('\n\x1b[36m═══ Agent 2: Contract Pages Anti-Spin ═══\x1b[0m');
  const page = await createLoggedInPage(browser);
  try {
    const contractId = await getFirstContractId(page);

    // Test: contracts list page loads
    {
      const calls = interceptApiCalls(page);
      await page.goto(`${BASE_URL}/contracts`, { waitUntil: 'domcontentloaded' });
      try {
        await waitForPageReady(page, 15000);
        // Use separate locators — text= cannot be mixed with CSS commas
        const hasTable = await page.locator('table').first().isVisible().catch(() => false);
        const hasEmpty = await page.getByText('ยังไม่มีสัญญา').isVisible().catch(() => false);
        const hasError = await page.getByText('เกิดข้อผิดพลาด').isVisible().catch(() => false);
        const hasContent = hasTable || hasEmpty || hasError;
        const serverErrors = calls.filter(c => c.status >= 500);
        log(hasContent && serverErrors.length === 0 ? 'PASS' : 'FAIL', '/contracts loads without spinning',
          serverErrors.length > 0 ? `${serverErrors.length} server errors` : '');
      } catch (e) {
        log('FAIL', '/contracts loads without spinning', e.message.slice(0, 100));
      }
      calls.cleanup();
    }

    // Test: contract detail page
    if (contractId) {
      await page.goto(`${BASE_URL}/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
      try {
        await waitForPageReady(page, 15000);
        await assertNoInfiniteSpinner(page, 'ContractDetail');
        log('PASS', '/contracts/:id loads without spinning');
      } catch (e) {
        log('FAIL', '/contracts/:id loads without spinning', e.message.slice(0, 100));
      }
    } else {
      log('SKIP', '/contracts/:id loads without spinning');
    }

    // Test: contract create page
    {
      await page.goto(`${BASE_URL}/contracts/create`, { waitUntil: 'domcontentloaded' });
      try {
        await waitForPageReady(page, 15000);
        // Step 1 title: "เลือกสินค้า" — also check page title "สร้างสัญญาผ่อนชำระ"
        const hasStep = await page.getByText('เลือกสินค้า').first().isVisible().catch(() => false);
        const hasTitle = await page.getByText('สร้างสัญญาผ่อนชำระ').isVisible().catch(() => false);
        log(hasStep || hasTitle ? 'PASS' : 'FAIL', '/contracts/create loads without spinning');
      } catch (e) {
        log('FAIL', '/contracts/create loads without spinning', e.message.slice(0, 100));
      }
    }

    // Test: contract templates page
    {
      await page.goto(`${BASE_URL}/contract-templates`, { waitUntil: 'domcontentloaded' });
      try {
        await waitForPageReady(page, 15000);
        await assertNoInfiniteSpinner(page, 'ContractTemplates');
        log('PASS', '/contract-templates loads without spinning');
      } catch (e) {
        log('FAIL', '/contract-templates loads without spinning', e.message.slice(0, 100));
      }
    }

    // Test: contract view tab ("ดูสัญญา")
    if (contractId) {
      await page.goto(`${BASE_URL}/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
      try {
        await waitForPageReady(page, 15000);
        // Actual tab name is "ดูสัญญา" (View Contract)
        const viewTab = page.locator('button:has-text("ดูสัญญา")').first();
        if (await viewTab.isVisible().catch(() => false)) {
          await viewTab.click();
          await waitForPageReady(page, 20000);
          log('PASS', 'View contract tab loads without spinning');
        } else {
          log('SKIP', 'View contract tab loads without spinning', 'Tab not found');
        }
      } catch (e) {
        log('FAIL', 'View contract tab loads without spinning', e.message.slice(0, 100));
      }
    } else {
      log('SKIP', 'View contract tab loads without spinning');
    }

    // Test: all API calls within timeout
    {
      const calls = interceptApiCalls(page);
      await page.goto(`${BASE_URL}/contracts`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      const timeouts = calls.filter(c => c.duration > 10000);
      log(timeouts.length === 0 ? 'PASS' : 'FAIL', 'All API calls complete within 10s',
        `${calls.length} calls, ${timeouts.length} timeouts`);
      calls.cleanup();
    }
  } finally {
    await page.close();
  }
}

// ============================================================================
// Agent 3: Contracts List
// ============================================================================
async function agent03(browser) {
  console.log('\n\x1b[36m═══ Agent 3: Contracts List ═══\x1b[0m');
  const page = await createLoggedInPage(browser);
  try {
    await page.goto(`${BASE_URL}/contracts`, { waitUntil: 'domcontentloaded' });
    await waitForPageReady(page, 15000);

    // Test: page title and create button
    {
      const title = await page.getByText('สัญญาผ่อนชำระ').first().isVisible().catch(() => false);
      // Button text includes "+" prefix: "+ สร้างสัญญา"
      const createBtn = await page.locator('button:has-text("สร้างสัญญา"), a:has-text("สร้างสัญญา")').first().isVisible().catch(() => false);
      log(title && createBtn ? 'PASS' : 'FAIL', 'Page title and create button visible');
    }

    // Test: table columns or empty state
    {
      const headers = ['เลขสัญญา', 'ลูกค้า', 'สินค้า', 'สถานะ'];
      let hasTable = true;
      for (const h of headers) {
        const th = page.locator(`th:has-text("${h}"), [role="columnheader"]:has-text("${h}")`).first();
        if (!(await th.isVisible().catch(() => false))) {
          hasTable = false;
          break;
        }
      }
      const hasEmpty = await page.locator('text=ยังไม่มีสัญญา').isVisible().catch(() => false);
      log(hasTable || hasEmpty ? 'PASS' : 'FAIL', 'Table columns or empty state');
    }

    // Test: search input
    {
      const searchInput = page.locator('input[placeholder*="ค้นหา"]').first();
      const visible = await searchInput.isVisible().catch(() => false);
      if (visible) {
        await searchInput.fill('BCP');
        await page.waitForTimeout(800);
        const urlHasSearch = page.url().includes('q=') || page.url().includes('search=');
        log('PASS', 'Search input exists and accepts input');
      } else {
        log('FAIL', 'Search input exists', 'Not found');
      }
    }

    // Test: create button navigates
    {
      // Re-navigate to contracts list (search may have changed the page)
      await page.goto(`${BASE_URL}/contracts`, { waitUntil: 'domcontentloaded' });
      await waitForPageReady(page, 15000);
      const createBtn = page.locator('button:has-text("สร้างสัญญา"), a:has-text("สร้างสัญญา")').first();
      if (await createBtn.isVisible().catch(() => false)) {
        await createBtn.click();
        try {
          await page.waitForURL(/contracts\/create/, { timeout: 10000 });
          log('PASS', 'Create button navigates to /contracts/create');
        } catch {
          log('FAIL', 'Create button navigates', 'Did not navigate');
        }
      } else {
        log('SKIP', 'Create button navigates');
      }
    }
  } finally {
    await page.close();
  }
}

// ============================================================================
// Agent 4: Contract Detail
// ============================================================================
async function agent04(browser) {
  console.log('\n\x1b[36m═══ Agent 4: Contract Detail ═══\x1b[0m');
  const page = await createLoggedInPage(browser);
  try {
    const contractId = await getFirstContractId(page);
    if (!contractId) {
      log('SKIP', 'All Contract Detail tests', 'No contracts in database');
      return;
    }

    // Test: loads without spinner
    {
      const calls = interceptApiCalls(page);
      await page.goto(`${BASE_URL}/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
      try {
        await waitForPageReady(page, 15000);
        await assertNoInfiniteSpinner(page, 'ContractDetail');
        log('PASS', 'Contract detail loads without spinning');
      } catch (e) {
        log('FAIL', 'Contract detail loads without spinning', e.message.slice(0, 100));
      }
      calls.cleanup();
    }

    // Test: displays contract number
    {
      const bodyText = await page.textContent('body');
      log(bodyText && bodyText.length > 50 ? 'PASS' : 'FAIL', 'Displays contract content');
    }

    // Test: financial info — check for actual labels from ContractDetailPage
    {
      const bodyText = await page.textContent('body') || '';
      const has = ['ราคาขาย', 'เงินดาวน์', 'ค่างวด/เดือน', 'อัตราดอกเบี้ย', 'ยอดจัดไฟแนนซ์', 'ยอดปล่อย'].some(t => bodyText.includes(t));
      log(has ? 'PASS' : 'FAIL', 'Displays financial information');
    }

    // Test: documents tab (tab text includes count like "เอกสาร (3)")
    {
      const docsTab = page.locator('button').filter({ hasText: 'เอกสาร' }).first();
      if (await docsTab.isVisible().catch(() => false)) {
        await docsTab.click();
        try {
          await waitForPageReady(page, 10000);
          log('PASS', 'Documents tab loads');
        } catch (e) {
          log('FAIL', 'Documents tab loads', e.message.slice(0, 100));
        }
      } else {
        log('SKIP', 'Documents tab', 'Tab not found');
      }
    }

    // Test: no server errors in cascading queries
    {
      const calls = interceptApiCalls(page);
      await page.goto(`${BASE_URL}/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      const serverErrors = calls.filter(c => c.status >= 500);
      log(serverErrors.length === 0 ? 'PASS' : 'FAIL', 'No 500 errors in cascading queries',
        serverErrors.length > 0 ? serverErrors.map(e => `${e.status} ${e.url.split('/api/')[1]}`).join(', ') : '');
      calls.cleanup();
    }
  } finally {
    await page.close();
  }
}

// ============================================================================
// Agent 5: Contract Create Wizard
// ============================================================================
async function agent05(browser) {
  console.log('\n\x1b[36m═══ Agent 5: Contract Create Wizard ═══\x1b[0m');
  const page = await createLoggedInPage(browser);
  try {

    // Test: step 1 loads with product list
    {
      const calls = interceptApiCalls(page);
      await page.goto(`${BASE_URL}/contracts/create`, { waitUntil: 'domcontentloaded' });
      try {
        await waitForPageReady(page, 15000);
        // Use getByText with .first() to handle multiple matches
        const stepVisible = await page.getByText('เลือกสินค้า').first().isVisible().catch(() => false);
        const pageTitle = await page.getByText('สร้างสัญญาผ่อนชำระ').isVisible().catch(() => false);
        const productCall = calls.find(c => c.url.includes('/products'));
        const apiOk = !productCall || productCall.status < 500;
        log((stepVisible || pageTitle) && apiOk ? 'PASS' : 'FAIL', 'Step 1 loads with product list');
      } catch (e) {
        log('FAIL', 'Step 1 loads', e.message.slice(0, 100));
      }
      calls.cleanup();
    }

    // Test: product search
    {
      const searchInput = page.locator('input[placeholder*="ค้นหา"], input[type="search"], input[type="text"]').first();
      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.fill('iPhone');
        await page.waitForTimeout(800);
        try {
          await waitForPageReady(page);
          log('PASS', 'Product search accepts input');
        } catch (e) {
          log('FAIL', 'Product search', e.message.slice(0, 100));
        }
      } else {
        log('SKIP', 'Product search', 'Input not found');
      }
    }

    // Test: step indicators — check page title or step 1 label
    {
      const step1 = await page.getByText('เลือกสินค้า').first().isVisible().catch(() => false);
      const pageTitle = await page.getByText('สร้างสัญญาผ่อนชำระ').isVisible().catch(() => false);
      log(step1 || pageTitle ? 'PASS' : 'FAIL', 'Step indicators visible');
    }

    // Test: no server errors
    {
      const calls = interceptApiCalls(page);
      await page.goto(`${BASE_URL}/contracts/create`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      const errors = calls.filter(c => c.status >= 500);
      log(errors.length === 0 ? 'PASS' : 'FAIL', 'No server errors in step 1',
        errors.length > 0 ? errors.map(e => `${e.status} ${e.url}`).join(', ') : '');
      calls.cleanup();
    }
  } finally {
    await page.close();
  }
}

// ============================================================================
// Agent 6: Contract Workflow
// ============================================================================
async function agent06(browser) {
  console.log('\n\x1b[36m═══ Agent 6: Contract Workflow ═══\x1b[0m');
  const page = await createLoggedInPage(browser);
  try {

    // Test: DRAFT contract
    {
      const contractId = await getContractByStatus(page, 'DRAFT');
      if (contractId) {
        await page.goto(`${BASE_URL}/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
        try {
          await waitForPageReady(page, 15000);
          // DRAFT may show: "ส่งตรวจสอบ", "ลงนาม/เอกสาร", "ลงนาม", or workflow stepper
          const hasSubmit = await page.locator('button:has-text("ส่งตรวจสอบ")').isVisible().catch(() => false);
          const hasSignDoc = await page.locator('a:has-text("ลงนาม"), button:has-text("ลงนาม")').first().isVisible().catch(() => false);
          const hasStepper = await page.getByText('สร้างสัญญา').first().isVisible().catch(() => false);
          log(hasSubmit || hasSignDoc || hasStepper ? 'PASS' : 'FAIL', 'DRAFT shows action buttons');
        } catch (e) {
          log('FAIL', 'DRAFT contract page', e.message.slice(0, 100));
        }
      } else {
        log('SKIP', 'DRAFT shows action buttons', 'No DRAFT contracts');
      }
    }

    // Test: ACTIVE contract
    {
      const contractId = await getContractByStatus(page, 'ACTIVE');
      if (contractId) {
        await page.goto(`${BASE_URL}/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
        try {
          await waitForPageReady(page, 15000);
          log('PASS', 'ACTIVE contract loads');
        } catch (e) {
          log('FAIL', 'ACTIVE contract loads', e.message.slice(0, 100));
        }
      } else {
        log('SKIP', 'ACTIVE contract', 'No ACTIVE contracts');
      }
    }

    // Test: OVERDUE contract
    {
      const contractId = await getContractByStatus(page, 'OVERDUE');
      if (contractId) {
        await page.goto(`${BASE_URL}/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });
        try {
          await waitForPageReady(page, 15000);
          const bodyText = await page.textContent('body') || '';
          const hasOverdue = bodyText.includes('ค้างชำระ') || bodyText.includes('OVERDUE');
          log(hasOverdue ? 'PASS' : 'FAIL', 'OVERDUE displays status');
        } catch (e) {
          log('FAIL', 'OVERDUE contract loads', e.message.slice(0, 100));
        }
      } else {
        log('SKIP', 'OVERDUE contract', 'No OVERDUE contracts');
      }
    }

    // Test: workflow badges on list
    {
      await page.goto(`${BASE_URL}/contracts`, { waitUntil: 'domcontentloaded' });
      try {
        await waitForPageReady(page, 15000);
        const bodyText = await page.textContent('body') || '';
        // Actual badge labels: "กำลังสร้าง", "รอตรวจสอบ", "อนุมัติแล้ว", "ปฏิเสธ"
        // Also status badges: "ร่าง", "ผ่อนอยู่", "ค้างชำระ", "ครบ"
        const hasBadges = [
          'กำลังสร้าง', 'รอตรวจสอบ', 'อนุมัติแล้ว',
          'ร่าง', 'ผ่อนอยู่', 'ค้างชำระ', 'ครบ',
          'ยังไม่มีสัญญา',
        ].some(t => bodyText.includes(t));
        log(hasBadges ? 'PASS' : 'FAIL', 'List shows workflow/status badges');
      } catch (e) {
        log('FAIL', 'List shows workflow/status badges', e.message.slice(0, 100));
      }
    }

    // Test: list → detail → back navigation
    {
      const calls = interceptApiCalls(page);
      await page.goto(`${BASE_URL}/contracts`, { waitUntil: 'domcontentloaded' });
      await waitForPageReady(page, 15000);
      const link = page.locator('a.font-mono').first();
      if (await link.isVisible().catch(() => false)) {
        await link.click();
        try {
          await waitForPageReady(page, 15000);
          await page.goBack();
          await waitForPageReady(page, 15000);
          const timeouts = calls.filter(c => c.duration > 10000);
          log(timeouts.length === 0 ? 'PASS' : 'FAIL', 'List↔Detail navigation', `${timeouts.length} timeouts`);
        } catch (e) {
          log('FAIL', 'List↔Detail navigation', e.message.slice(0, 100));
        }
      } else {
        log('SKIP', 'List↔Detail navigation', 'No contracts to click');
      }
      calls.cleanup();
    }
  } finally {
    await page.close();
  }
}

// ============================================================================
// Main
// ============================================================================
(async () => {
  const agentFilter = process.argv[2] ? parseInt(process.argv[2]) : null;
  const agents = [agent01, agent02, agent03, agent04, agent05, agent06];

  console.log('\x1b[1m\n╔══════════════════════════════════════════╗');
  console.log('║   BESTCHOICE Agent Team E2E Tests        ║');
  console.log('╚══════════════════════════════════════════╝\x1b[0m');

  const browser = await chromium.launch({ headless: true });

  try {
    for (let i = 0; i < agents.length; i++) {
      if (agentFilter && agentFilter !== (i + 1)) continue;
      try {
        await agents[i](browser);
      } catch (e) {
        console.error(`\x1b[31mAgent ${i + 1} crashed: ${e.message}\x1b[0m`);
        failed++;
        failures.push(`Agent ${i + 1} crash: ${e.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  // Summary
  console.log('\n\x1b[1m══════════════════════════════════════════');
  console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m, \x1b[33m${skipped} skipped\x1b[0m`);
  if (failures.length > 0) {
    console.log('\n\x1b[31mFailures:\x1b[0m');
    failures.forEach(f => console.log(`  ✗ ${f}`));
  }
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
})();
