/**
 * Full Flow Load Test: 20 Employees + 100 Customers Concurrent
 *
 * จำลองสถานการณ์จริง:
 * - พนักงาน 20 คน (แต่ละแผนก) ทำงานพร้อมกัน ใน Chrome
 * - ลูกค้า 100 คน เข้าชำระเงินผ่าน LIFF/Web พร้อมกัน
 *
 * Employee Groups (20 คน, ใช้ user ตาม role จริง):
 *   OWNER (2 คน)      : Dashboard, Reports, Settings, Approve contracts
 *   BRANCH_MANAGER (4) : Dashboard, Customers, Contracts approve, Overdue
 *   SALES (8 คน)       : POS, Contracts create, Customers, Payments record
 *   ACCOUNTANT (6 คน)  : Payments, Reports, Slip review, Daily summary
 *
 * Customer Simulation (100 คน):
 *   - 100 concurrent API calls simulating LIFF payment link resolution
 *   - Mixed: view contract, check balance, load payment page
 */
import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';

// ============================================================
// Configuration
// ============================================================
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const API_URL = `${BASE_URL}/api`;

// All 8 seed users with their roles
const EMPLOYEES = [
  { email: 'admin@bestchoice.com', password: 'admin1234', role: 'OWNER', name: 'สุรชัย' },
  { email: 'manager.ladprao@bestchoice.com', password: 'admin1234', role: 'BRANCH_MANAGER', name: 'วิภา' },
  { email: 'manager.ramkham@bestchoice.com', password: 'admin1234', role: 'BRANCH_MANAGER', name: 'ธนา' },
  { email: 'manager.bangkhae@bestchoice.com', password: 'admin1234', role: 'BRANCH_MANAGER', name: 'ประภา' },
  { email: 'sales1@bestchoice.com', password: 'admin1234', role: 'SALES', name: 'สมศักดิ์' },
  { email: 'sales2@bestchoice.com', password: 'admin1234', role: 'SALES', name: 'อารียา' },
  { email: 'sales3@bestchoice.com', password: 'admin1234', role: 'SALES', name: 'กิตติ' },
  { email: 'accountant@bestchoice.com', password: 'admin1234', role: 'ACCOUNTANT', name: 'พิมพ์ใจ' },
];

// Assign 20 employee slots to the 8 users (some users appear multiple times)
const EMPLOYEE_SLOTS = [
  // OWNER x2
  { ...EMPLOYEES[0], group: 'OWNER' },
  { ...EMPLOYEES[0], group: 'OWNER' },
  // BRANCH_MANAGER x4
  { ...EMPLOYEES[1], group: 'BRANCH_MANAGER' },
  { ...EMPLOYEES[2], group: 'BRANCH_MANAGER' },
  { ...EMPLOYEES[3], group: 'BRANCH_MANAGER' },
  { ...EMPLOYEES[1], group: 'BRANCH_MANAGER' },
  // SALES x8
  { ...EMPLOYEES[4], group: 'SALES' },
  { ...EMPLOYEES[5], group: 'SALES' },
  { ...EMPLOYEES[6], group: 'SALES' },
  { ...EMPLOYEES[4], group: 'SALES' },
  { ...EMPLOYEES[5], group: 'SALES' },
  { ...EMPLOYEES[6], group: 'SALES' },
  { ...EMPLOYEES[4], group: 'SALES' },
  { ...EMPLOYEES[5], group: 'SALES' },
  // ACCOUNTANT x6
  { ...EMPLOYEES[7], group: 'ACCOUNTANT' },
  { ...EMPLOYEES[7], group: 'ACCOUNTANT' },
  { ...EMPLOYEES[7], group: 'ACCOUNTANT' },
  { ...EMPLOYEES[7], group: 'ACCOUNTANT' },
  { ...EMPLOYEES[7], group: 'ACCOUNTANT' },
  { ...EMPLOYEES[7], group: 'ACCOUNTANT' },
];

// Known contract IDs from seed data
const CONTRACT_IDS = [
  'cont-001', 'cont-002', 'cont-003', 'cont-004', 'cont-005',
  'cont-006', 'cont-007', 'cont-008', 'cont-009', 'cont-010',
  'cont-demo-001', 'cont-demo-002', 'cont-demo-003', 'cont-demo-004', 'cont-demo-005',
];

// ============================================================
// Types
// ============================================================
interface StepResult {
  name: string;
  duration: number;
  success: boolean;
  error?: string;
  statusCode?: number;
}

interface UserResult {
  userId: number;
  role: string;
  userName: string;
  steps: StepResult[];
  totalTime: number;
  success: boolean;
}

interface BugReport {
  id: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  description: string;
  context: string;
  reproSteps?: string;
}

// ============================================================
// Helper: Login via API (fast, no browser needed)
// ============================================================
async function apiLogin(context: BrowserContext, email: string, password: string): Promise<{ token: string; step: StepResult }> {
  const start = Date.now();
  try {
    const response = await context.request.post(`${API_URL}/auth/login`, {
      data: { email, password },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    const status = response.status();
    if (status !== 200 && status !== 201) {
      const body = await response.text();
      return {
        token: '',
        step: { name: 'API Login', duration: Date.now() - start, success: false, statusCode: status, error: `HTTP ${status}: ${body.substring(0, 100)}` },
      };
    }
    const data = await response.json();
    return {
      token: data.accessToken,
      step: { name: 'API Login', duration: Date.now() - start, success: true, statusCode: status },
    };
  } catch (e: any) {
    return {
      token: '',
      step: { name: 'API Login', duration: Date.now() - start, success: false, error: e.message?.substring(0, 150) },
    };
  }
}

// ============================================================
// Helper: Authenticated API GET
// ============================================================
async function apiGet(context: BrowserContext, token: string, path: string, stepName: string): Promise<StepResult> {
  const start = Date.now();
  try {
    const response = await context.request.get(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const status = response.status();
    const body = await response.text();
    if (status >= 400) {
      return { name: stepName, duration: Date.now() - start, success: false, statusCode: status, error: `HTTP ${status}: ${body.substring(0, 100)}` };
    }
    return { name: stepName, duration: Date.now() - start, success: true, statusCode: status };
  } catch (e: any) {
    return { name: stepName, duration: Date.now() - start, success: false, error: e.message?.substring(0, 150) };
  }
}

// ============================================================
// Helper: Authenticated API POST
// ============================================================
async function apiPost(context: BrowserContext, token: string, path: string, data: any, stepName: string): Promise<StepResult & { body?: any }> {
  const start = Date.now();
  try {
    const response = await context.request.post(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Requested-With': 'XMLHttpRequest' },
      data,
    });
    const status = response.status();
    const bodyText = await response.text();
    let body: any;
    try { body = JSON.parse(bodyText); } catch { body = bodyText; }
    if (status >= 400) {
      return { name: stepName, duration: Date.now() - start, success: false, statusCode: status, error: `HTTP ${status}: ${(typeof body === 'string' ? body : JSON.stringify(body)).substring(0, 100)}`, body };
    }
    return { name: stepName, duration: Date.now() - start, success: true, statusCode: status, body };
  } catch (e: any) {
    return { name: stepName, duration: Date.now() - start, success: false, error: e.message?.substring(0, 150) };
  }
}

// ============================================================
// Helper: Navigate page and check content loads
// ============================================================
async function navigatePage(page: Page, path: string, stepName: string): Promise<StepResult> {
  const start = Date.now();
  try {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Check we didn't get redirected to login (session expired)
    if (page.url().includes('/login') && !path.includes('/login')) {
      return { name: stepName, duration: Date.now() - start, success: false, error: 'Redirected to login - session expired' };
    }
    const bodyText = await page.textContent('body', { timeout: 5000 });
    if (!bodyText || bodyText.length < 10) {
      return { name: stepName, duration: Date.now() - start, success: false, error: 'Page body is empty or too short' };
    }
    return { name: stepName, duration: Date.now() - start, success: true };
  } catch (e: any) {
    return { name: stepName, duration: Date.now() - start, success: false, error: e.message?.substring(0, 150) };
  }
}

// ============================================================
// Helper: Login via API + set token in page localStorage (fast, realistic for load test)
// ============================================================
async function loginForPage(page: Page, context: BrowserContext, email: string, password: string): Promise<{ token: string; step: StepResult }> {
  const start = Date.now();
  try {
    // First navigate to the app to establish the origin for localStorage
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Login via API
    const response = await context.request.post(`${API_URL}/auth/login`, {
      data: { email, password },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    const status = response.status();
    if (status >= 400) {
      const body = await response.text();
      return { token: '', step: { name: 'Login (API+Page)', duration: Date.now() - start, success: false, statusCode: status, error: `HTTP ${status}: ${body.substring(0, 100)}` } };
    }
    const data = await response.json();
    const token = data.accessToken;

    // Set token in localStorage and navigate to dashboard
    await page.evaluate((t: string) => {
      localStorage.setItem('access_token', t);
    }, token);
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Verify we're on the dashboard (not redirected to login)
    await page.waitForLoadState('networkidle');
    if (page.url().includes('/login')) {
      return { token: '', step: { name: 'Login (API+Page)', duration: Date.now() - start, success: false, error: 'Redirected to login after setting token' } };
    }

    return { token, step: { name: 'Login (API+Page)', duration: Date.now() - start, success: true } };
  } catch (e: any) {
    return { token: '', step: { name: 'Login (API+Page)', duration: Date.now() - start, success: false, error: e.message?.substring(0, 150) } };
  }
}

// ============================================================
// Employee Flow: OWNER
// ============================================================
async function runOwnerFlow(context: BrowserContext, page: Page, userId: number): Promise<UserResult> {
  const steps: StepResult[] = [];
  const totalStart = Date.now();
  const employee = EMPLOYEE_SLOTS[userId - 1];

  // Login via API + set token in page
  const { token, step: loginStep } = await loginForPage(page, context, employee.email, employee.password);
  steps.push(loginStep);
  if (!loginStep.success) {
    return { userId, role: 'OWNER', userName: employee.name, steps, totalTime: Date.now() - totalStart, success: false };
  }

  // Dashboard
  steps.push(await navigatePage(page, '/', 'View Dashboard'));

  // Reports
  steps.push(await navigatePage(page, '/reports', 'View Reports'));

  // Settings
  steps.push(await navigatePage(page, '/settings', 'View Settings'));

  // Users management
  steps.push(await navigatePage(page, '/users', 'View Users'));

  // Contracts list
  steps.push(await navigatePage(page, '/contracts', 'View All Contracts'));

  // API: Get contract detail
  if (token) {
    steps.push(await apiGet(context, token, '/contracts/cont-001', 'API: Get Contract Detail'));
    steps.push(await apiGet(context, token, '/contracts/cont-001/schedule', 'API: Get Schedule'));
    // API: Approve flow - get document dashboard
    steps.push(await apiGet(context, token, '/contracts/document-dashboard', 'API: Document Dashboard'));
  }

  // Overdue management
  steps.push(await navigatePage(page, '/overdue', 'View Overdue'));

  // Branches
  steps.push(await navigatePage(page, '/branches', 'View Branches'));

  return {
    userId,
    role: 'OWNER',
    userName: employee.name,
    steps,
    totalTime: Date.now() - totalStart,
    success: steps.every(s => s.success),
  };
}

// ============================================================
// Employee Flow: BRANCH_MANAGER
// ============================================================
async function runBranchManagerFlow(context: BrowserContext, page: Page, userId: number): Promise<UserResult> {
  const steps: StepResult[] = [];
  const totalStart = Date.now();
  const employee = EMPLOYEE_SLOTS[userId - 1];

  const { token, step: loginStep } = await loginForPage(page, context, employee.email, employee.password);
  steps.push(loginStep);
  if (!loginStep.success) {
    return { userId, role: 'BRANCH_MANAGER', userName: employee.name, steps, totalTime: Date.now() - totalStart, success: false };
  }

  // Dashboard
  steps.push(await navigatePage(page, '/', 'View Dashboard'));

  // Customers
  steps.push(await navigatePage(page, '/customers', 'View Customers'));

  // Contracts - view list
  steps.push(await navigatePage(page, '/contracts', 'View Contracts'));

  // API: List contracts filtered by branch
  if (token) {
    steps.push(await apiGet(context, token, '/contracts?page=1&limit=20', 'API: List Contracts'));
    steps.push(await apiGet(context, token, '/customers?page=1&limit=20', 'API: List Customers'));
    steps.push(await apiGet(context, token, '/customers/search?q=สมชาย', 'API: Search Customer'));
  }

  // Overdue
  steps.push(await navigatePage(page, '/overdue', 'View Overdue'));

  // Payments
  steps.push(await navigatePage(page, '/payments', 'View Payments'));

  // Slip review
  steps.push(await navigatePage(page, '/slip-review', 'View Slip Review'));

  // Stock overview
  steps.push(await navigatePage(page, '/stock', 'View Stock'));

  return {
    userId,
    role: 'BRANCH_MANAGER',
    userName: employee.name,
    steps,
    totalTime: Date.now() - totalStart,
    success: steps.every(s => s.success),
  };
}

// ============================================================
// Employee Flow: SALES
// ============================================================
async function runSalesFlow(context: BrowserContext, page: Page, userId: number): Promise<UserResult> {
  const steps: StepResult[] = [];
  const totalStart = Date.now();
  const employee = EMPLOYEE_SLOTS[userId - 1];

  const { token, step: loginStep } = await loginForPage(page, context, employee.email, employee.password);
  steps.push(loginStep);
  if (!loginStep.success) {
    return { userId, role: 'SALES', userName: employee.name, steps, totalTime: Date.now() - totalStart, success: false };
  }

  // Dashboard
  steps.push(await navigatePage(page, '/', 'View Dashboard'));

  // POS
  steps.push(await navigatePage(page, '/pos', 'View POS'));

  // Customers
  steps.push(await navigatePage(page, '/customers', 'View Customers'));

  // Contracts list
  steps.push(await navigatePage(page, '/contracts', 'View Contracts'));

  // Create contract page
  steps.push(await navigatePage(page, '/contracts/create', 'Open Create Contract'));

  // API: search customers, list products, record simulated payment
  if (token) {
    steps.push(await apiGet(context, token, '/customers/search?q=081', 'API: Search by Phone'));
    steps.push(await apiGet(context, token, '/products?page=1&limit=20', 'API: List Products'));
    steps.push(await apiGet(context, token, '/payments/pending', 'API: Pending Payments'));

    // Try to view a specific contract's payments
    steps.push(await apiGet(context, token, '/payments/contract/cont-001', 'API: Contract Payments'));

    // Navigate stock (via products endpoint)
    steps.push(await apiGet(context, token, '/products/stock?page=1&limit=20', 'API: View Stock'));
  }

  // Sales history page
  steps.push(await navigatePage(page, '/sales', 'View Sales History'));

  return {
    userId,
    role: 'SALES',
    userName: employee.name,
    steps,
    totalTime: Date.now() - totalStart,
    success: steps.every(s => s.success),
  };
}

// ============================================================
// Employee Flow: ACCOUNTANT
// ============================================================
async function runAccountantFlow(context: BrowserContext, page: Page, userId: number): Promise<UserResult> {
  const steps: StepResult[] = [];
  const totalStart = Date.now();
  const employee = EMPLOYEE_SLOTS[userId - 1];

  const { token, step: loginStep } = await loginForPage(page, context, employee.email, employee.password);
  steps.push(loginStep);
  if (!loginStep.success) {
    return { userId, role: 'ACCOUNTANT', userName: employee.name, steps, totalTime: Date.now() - totalStart, success: false };
  }

  // Dashboard
  steps.push(await navigatePage(page, '/', 'View Dashboard'));

  // Payments
  steps.push(await navigatePage(page, '/payments', 'View Payments'));

  // API: Daily summary
  if (token) {
    const today = new Date().toISOString().split('T')[0];
    steps.push(await apiGet(context, token, `/payments/daily-summary?date=${today}`, 'API: Daily Summary'));
    steps.push(await apiGet(context, token, '/payments/pending', 'API: Pending Payments'));
  }

  // Reports
  steps.push(await navigatePage(page, '/reports', 'View Reports'));

  // Slip review
  steps.push(await navigatePage(page, '/slip-review', 'View Slip Review'));

  // Overdue tracking
  steps.push(await navigatePage(page, '/overdue', 'View Overdue'));

  // Contracts (read-only)
  steps.push(await navigatePage(page, '/contracts', 'View Contracts'));

  // API: Multiple contract payment histories
  if (token) {
    steps.push(await apiGet(context, token, '/payments/contract/cont-004', 'API: Overdue Contract Payments'));
    steps.push(await apiGet(context, token, '/payments/contract/cont-005', 'API: Overdue Contract #5'));
    steps.push(await apiGet(context, token, '/contracts/cont-004', 'API: Contract #4 Detail'));
  }

  return {
    userId,
    role: 'ACCOUNTANT',
    userName: employee.name,
    steps,
    totalTime: Date.now() - totalStart,
    success: steps.every(s => s.success),
  };
}

// ============================================================
// Customer Simulation: 100 concurrent LIFF/API calls
// ============================================================
async function runCustomerBatch(context: BrowserContext, batchId: number, count: number): Promise<{
  results: StepResult[];
  totalTime: number;
}> {
  const totalStart = Date.now();
  const results: StepResult[] = [];

  // Simulate customers making API calls (no auth needed for LIFF public endpoints)
  const promises: Promise<StepResult>[] = [];

  for (let i = 0; i < count; i++) {
    const contractId = CONTRACT_IDS[i % CONTRACT_IDS.length];
    const customerNum = batchId * count + i + 1;

    // Mix of different customer actions:
    if (i % 5 === 0) {
      // 20%: Try to access LIFF contract page (public API)
      promises.push(
        (async (): Promise<StepResult> => {
          const start = Date.now();
          try {
            const res = await context.request.get(`${API_URL}/line-oa/liff/contracts?lineId=line-demo-001`);
            const status = res.status();
            return { name: `Customer #${customerNum}: LIFF Contracts`, duration: Date.now() - start, success: status < 500, statusCode: status };
          } catch (e: any) {
            return { name: `Customer #${customerNum}: LIFF Contracts`, duration: Date.now() - start, success: false, error: e.message?.substring(0, 100) };
          }
        })()
      );
    } else if (i % 5 === 1) {
      // 20%: Try payment link resolution (simulate customer opening payment link)
      promises.push(
        (async (): Promise<StepResult> => {
          const start = Date.now();
          try {
            const res = await context.request.get(`${API_URL}/line-oa/pay/fake-token-${customerNum}`);
            const status = res.status();
            // 404 is expected for fake tokens, that's fine - we're testing the endpoint doesn't crash
            return { name: `Customer #${customerNum}: Payment Link`, duration: Date.now() - start, success: status < 500, statusCode: status };
          } catch (e: any) {
            return { name: `Customer #${customerNum}: Payment Link`, duration: Date.now() - start, success: false, error: e.message?.substring(0, 100) };
          }
        })()
      );
    } else if (i % 5 === 2) {
      // 20%: LIFF register lookup (public)
      promises.push(
        (async (): Promise<StepResult> => {
          const start = Date.now();
          try {
            const res = await context.request.post(`${API_URL}/line-oa/liff/register/lookup`, {
              data: { phone: `08${String(1000000 + customerNum).substring(1)}` },
              headers: { 'X-Requested-With': 'XMLHttpRequest' },
            });
            const status = res.status();
            return { name: `Customer #${customerNum}: Phone Lookup`, duration: Date.now() - start, success: status < 500, statusCode: status };
          } catch (e: any) {
            return { name: `Customer #${customerNum}: Phone Lookup`, duration: Date.now() - start, success: false, error: e.message?.substring(0, 100) };
          }
        })()
      );
    } else if (i % 5 === 3) {
      // 20%: Navigate to LIFF payment page (browser)
      promises.push(
        (async (): Promise<StepResult> => {
          const start = Date.now();
          try {
            const page = await context.newPage();
            await page.goto(`${BASE_URL}/liff/payment/test-token-${customerNum}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const bodyText = await page.textContent('body', { timeout: 5000 });
            await page.close();
            // Even if the payment link is invalid, the page should load without crashing
            return { name: `Customer #${customerNum}: LIFF Page Load`, duration: Date.now() - start, success: !!bodyText && bodyText.length > 0 };
          } catch (e: any) {
            return { name: `Customer #${customerNum}: LIFF Page Load`, duration: Date.now() - start, success: false, error: e.message?.substring(0, 100) };
          }
        })()
      );
    } else {
      // 20%: Check early payoff quote (public LIFF endpoint)
      promises.push(
        (async (): Promise<StepResult> => {
          const start = Date.now();
          try {
            const res = await context.request.get(`${API_URL}/line-oa/liff/early-payoff-quote?contractId=${contractId}&lineId=line-demo-001`);
            const status = res.status();
            return { name: `Customer #${customerNum}: Early Payoff Quote`, duration: Date.now() - start, success: status < 500, statusCode: status };
          } catch (e: any) {
            return { name: `Customer #${customerNum}: Early Payoff Quote`, duration: Date.now() - start, success: false, error: e.message?.substring(0, 100) };
          }
        })()
      );
    }
  }

  const stepResults = await Promise.all(promises);
  results.push(...stepResults);

  return {
    results,
    totalTime: Date.now() - totalStart,
  };
}

// ============================================================
// Bug Detection Logic
// ============================================================
function detectBugs(employeeResults: UserResult[], customerResults: StepResult[]): BugReport[] {
  const bugs: BugReport[] = [];
  let bugId = 0;

  // Check 1: Login failures under load (rate limiting too strict)
  const loginSteps = employeeResults.flatMap(r => r.steps.filter(s => s.name.includes('Login')));
  const loginFailures = loginSteps.filter(s => !s.success);
  if (loginFailures.length > 0) {
    const rateLimited = loginFailures.filter(s => s.statusCode === 429);
    if (rateLimited.length > 0) {
      bugs.push({
        id: ++bugId,
        severity: 'HIGH',
        category: 'Rate Limiting',
        description: `${rateLimited.length}/${loginSteps.length} logins ถูก rate limit (HTTP 429) เมื่อมี 20 users พร้อมกัน`,
        context: `Rate limit: 15 attempts/15min per IP. เมื่อพนักงาน 20 คน login พร้อมกันจาก IP เดียว`,
        reproSteps: '1. 20 users login พร้อมกัน\n2. บาง users ได้ HTTP 429 Too Many Requests',
      });
    }
    const authFails = loginFailures.filter(s => s.statusCode === 401);
    if (authFails.length > 0) {
      bugs.push({
        id: ++bugId,
        severity: 'CRITICAL',
        category: 'Authentication',
        description: `${authFails.length} login failures with HTTP 401 - credentials rejected`,
        context: 'Some seed user credentials are not working',
      });
    }
    const otherFails = loginFailures.filter(s => !s.statusCode || (s.statusCode !== 429 && s.statusCode !== 401));
    if (otherFails.length > 0) {
      bugs.push({
        id: ++bugId,
        severity: 'HIGH',
        category: 'Authentication',
        description: `${otherFails.length} login failures with unexpected errors`,
        context: otherFails.map(s => s.error).join('; '),
      });
    }
  }

  // Check 2: Session expiry / redirect to login during navigation
  const sessionExpired = employeeResults.flatMap(r => r.steps.filter(s => s.error?.includes('Redirected to login')));
  if (sessionExpired.length > 0) {
    bugs.push({
      id: ++bugId,
      severity: 'HIGH',
      category: 'Session Management',
      description: `${sessionExpired.length} pages ถูก redirect ไป login ระหว่างใช้งาน (session expired)`,
      context: 'Token หมดอายุเร็วเกินไป หรือ refresh token ไม่ทำงาน',
      reproSteps: '1. Login สำเร็จ\n2. Navigate หลายหน้า\n3. ถูก redirect กลับไป login',
    });
  }

  // Check 3: 500 errors (server crashes)
  const serverErrors = employeeResults.flatMap(r => r.steps.filter(s => s.statusCode === 500));
  if (serverErrors.length > 0) {
    bugs.push({
      id: ++bugId,
      severity: 'CRITICAL',
      category: 'Server Error',
      description: `${serverErrors.length} API requests returned HTTP 500 (Internal Server Error)`,
      context: serverErrors.map(s => `${s.name}: ${s.error}`).join('\n'),
    });
  }

  // Check 4: Customer-facing 500s
  const customer500s = customerResults.filter(s => s.statusCode === 500);
  if (customer500s.length > 0) {
    bugs.push({
      id: ++bugId,
      severity: 'CRITICAL',
      category: 'Customer-Facing Server Error',
      description: `${customer500s.length}/100 customer requests returned HTTP 500`,
      context: customer500s.slice(0, 5).map(s => `${s.name}: ${s.error}`).join('\n'),
    });
  }

  // Check 5: Slow responses (>10s for a single page)
  const slowPages = employeeResults.flatMap(r => r.steps.filter(s => s.duration > 10000 && s.success));
  if (slowPages.length > 0) {
    bugs.push({
      id: ++bugId,
      severity: 'MEDIUM',
      category: 'Performance',
      description: `${slowPages.length} pages took >10s to load under 20-user concurrent load`,
      context: slowPages.map(s => `${s.name}: ${(s.duration / 1000).toFixed(1)}s`).join('\n'),
    });
  }

  // Check 6: Very slow customer responses (>5s)
  const slowCustomers = customerResults.filter(s => s.duration > 5000);
  if (slowCustomers.length > 0) {
    bugs.push({
      id: ++bugId,
      severity: 'MEDIUM',
      category: 'Customer Performance',
      description: `${slowCustomers.length}/100 customer requests took >5s`,
      context: `Average customer response: ${(customerResults.reduce((sum, s) => sum + s.duration, 0) / customerResults.length / 1000).toFixed(1)}s`,
    });
  }

  // Check 7: Permission errors (wrong role accessing restricted endpoint)
  const forbidden = employeeResults.flatMap(r =>
    r.steps.filter(s => s.statusCode === 403).map(s => ({ ...s, role: r.role }))
  );
  if (forbidden.length > 0) {
    bugs.push({
      id: ++bugId,
      severity: 'MEDIUM',
      category: 'Authorization',
      description: `${forbidden.length} requests returned HTTP 403 (Forbidden)`,
      context: forbidden.map(s => `[${(s as any).role}] ${s.name}: ${s.error}`).join('\n'),
      reproSteps: 'Role-based access may be too restrictive for expected flows',
    });
  }

  // Check 8: Empty pages (rendered but no data)
  const emptyPages = employeeResults.flatMap(r =>
    r.steps.filter(s => s.error?.includes('empty') || s.error?.includes('Empty'))
  );
  if (emptyPages.length > 0) {
    bugs.push({
      id: ++bugId,
      severity: 'LOW',
      category: 'UI',
      description: `${emptyPages.length} pages loaded with empty/no content`,
      context: emptyPages.map(s => s.name).join(', '),
    });
  }

  // Check 9: Customer LIFF page crashes
  const liffCrashes = customerResults.filter(s => s.name.includes('LIFF Page') && !s.success);
  if (liffCrashes.length > 0) {
    bugs.push({
      id: ++bugId,
      severity: 'HIGH',
      category: 'LIFF/Customer Portal',
      description: `${liffCrashes.length} LIFF pages failed to load`,
      context: liffCrashes.slice(0, 3).map(s => s.error).join('\n'),
    });
  }

  // Check 10: Rate limiting on customer endpoints (should be public)
  const customerRateLimited = customerResults.filter(s => s.statusCode === 429);
  if (customerRateLimited.length > 0) {
    bugs.push({
      id: ++bugId,
      severity: 'HIGH',
      category: 'Rate Limiting - Customer',
      description: `${customerRateLimited.length}/100 customer requests ถูก rate limit`,
      context: 'ลูกค้า 100 คนเข้าพร้อมกันจาก IP เดียว (เช่น Wi-Fi ร้าน) ถูก block',
      reproSteps: '1. 100 customers access LIFF endpoints concurrently\n2. Some get HTTP 429',
    });
  }

  return bugs;
}

// ============================================================
// MAIN TEST
// ============================================================
test.describe('Full Flow Load Test: 20 Employees + 100 Customers', () => {
  test.setTimeout(300000); // 5 minutes

  test('should handle 20 employees + 100 customers concurrently', async ({ browser }) => {
    console.log('\n' + '='.repeat(70));
    console.log('  FULL FLOW LOAD TEST');
    console.log('  20 Employees (all departments) + 100 Customers');
    console.log('  Target: ' + BASE_URL);
    console.log('  Time: ' + new Date().toISOString());
    console.log('='.repeat(70) + '\n');

    // ========================================
    // Phase 1: Create browser contexts for employees
    // ========================================
    console.log('Phase 1: Creating 20 employee browser contexts...');
    const employeeContexts: BrowserContext[] = [];
    const employeePages: Page[] = [];

    for (let i = 0; i < 20; i++) {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      employeeContexts.push(ctx);
      employeePages.push(page);
    }
    console.log('  Created 20 employee contexts\n');

    // ========================================
    // Phase 2: Create customer context (shared, API-only mostly)
    // ========================================
    console.log('Phase 2: Creating customer context...');
    const customerContext = await browser.newContext({ ignoreHTTPSErrors: true });
    console.log('  Created 1 shared customer context\n');

    // ========================================
    // Phase 3: Run all 20 employees + 100 customers CONCURRENTLY
    // ========================================
    console.log('Phase 3: Launching all concurrent operations...');
    console.log('  - 2 OWNER users (full admin flow)');
    console.log('  - 4 BRANCH_MANAGER users (branch management flow)');
    console.log('  - 8 SALES users (POS + contract creation flow)');
    console.log('  - 6 ACCOUNTANT users (payment + reporting flow)');
    console.log('  - 100 customers (LIFF payment + contract lookup)');
    console.log('');

    const startTime = Date.now();

    // Helper: add small stagger delay (simulates real-world arrival pattern)
    const stagger = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Launch everything concurrently with slight stagger (200ms between each user)
    const [employeeResults, customerBatch] = await Promise.all([
      // All 20 employees with staggered start
      Promise.all([
        // OWNER (users 1-2)
        stagger(0).then(() => runOwnerFlow(employeeContexts[0], employeePages[0], 1)),
        stagger(200).then(() => runOwnerFlow(employeeContexts[1], employeePages[1], 2)),
        // BRANCH_MANAGER (users 3-6)
        stagger(400).then(() => runBranchManagerFlow(employeeContexts[2], employeePages[2], 3)),
        stagger(600).then(() => runBranchManagerFlow(employeeContexts[3], employeePages[3], 4)),
        stagger(800).then(() => runBranchManagerFlow(employeeContexts[4], employeePages[4], 5)),
        stagger(1000).then(() => runBranchManagerFlow(employeeContexts[5], employeePages[5], 6)),
        // SALES (users 7-14)
        stagger(1200).then(() => runSalesFlow(employeeContexts[6], employeePages[6], 7)),
        stagger(1400).then(() => runSalesFlow(employeeContexts[7], employeePages[7], 8)),
        stagger(1600).then(() => runSalesFlow(employeeContexts[8], employeePages[8], 9)),
        stagger(1800).then(() => runSalesFlow(employeeContexts[9], employeePages[9], 10)),
        stagger(2000).then(() => runSalesFlow(employeeContexts[10], employeePages[10], 11)),
        stagger(2200).then(() => runSalesFlow(employeeContexts[11], employeePages[11], 12)),
        stagger(2400).then(() => runSalesFlow(employeeContexts[12], employeePages[12], 13)),
        stagger(2600).then(() => runSalesFlow(employeeContexts[13], employeePages[13], 14)),
        // ACCOUNTANT (users 15-20)
        stagger(2800).then(() => runAccountantFlow(employeeContexts[14], employeePages[14], 15)),
        stagger(3000).then(() => runAccountantFlow(employeeContexts[15], employeePages[15], 16)),
        stagger(3200).then(() => runAccountantFlow(employeeContexts[16], employeePages[16], 17)),
        stagger(3400).then(() => runAccountantFlow(employeeContexts[17], employeePages[17], 18)),
        stagger(3600).then(() => runAccountantFlow(employeeContexts[18], employeePages[18], 19)),
        stagger(3800).then(() => runAccountantFlow(employeeContexts[19], employeePages[19], 20)),
      ]),
      // 100 customers (in 2 batches of 50 for resource management)
      Promise.all([
        runCustomerBatch(customerContext, 0, 50),
        runCustomerBatch(customerContext, 1, 50),
      ]),
    ]);

    const totalElapsed = Date.now() - startTime;
    const allCustomerResults = customerBatch.flatMap(b => b.results);

    // ========================================
    // Phase 4: Print Results
    // ========================================
    console.log('\n' + '╔' + '═'.repeat(72) + '╗');
    console.log('║' + '  EMPLOYEE RESULTS (20 users)'.padEnd(72) + '║');
    console.log('╚' + '═'.repeat(72) + '╝\n');

    const roleOrder = ['OWNER', 'BRANCH_MANAGER', 'SALES', 'ACCOUNTANT'];
    for (const role of roleOrder) {
      const roleResults = employeeResults.filter(r => r.role === role);
      console.log(`\n── ${role} (${roleResults.length} users) ${'─'.repeat(50 - role.length)}`);
      for (const r of roleResults) {
        const status = r.success ? '✅' : '❌';
        console.log(`  User #${String(r.userId).padStart(2)} [${r.userName}] ${status} (${(r.totalTime / 1000).toFixed(1)}s)`);
        for (const s of r.steps) {
          const icon = s.success ? '  ✓' : '  ✗';
          const timing = `${(s.duration / 1000).toFixed(1)}s`;
          const code = s.statusCode ? ` [${s.statusCode}]` : '';
          console.log(`  ${icon} ${s.name.padEnd(38)} ${timing}${code}${s.error ? ` ERR: ${s.error.substring(0, 60)}` : ''}`);
        }
      }
    }

    // Customer results summary
    console.log('\n' + '╔' + '═'.repeat(72) + '╗');
    console.log('║' + '  CUSTOMER RESULTS (100 concurrent)'.padEnd(72) + '║');
    console.log('╚' + '═'.repeat(72) + '╝\n');

    const customerSuccess = allCustomerResults.filter(s => s.success).length;
    const customerFailed = allCustomerResults.filter(s => !s.success).length;
    const customerAvgTime = allCustomerResults.reduce((sum, s) => sum + s.duration, 0) / allCustomerResults.length;

    // Group by endpoint type
    const endpointGroups: Record<string, StepResult[]> = {};
    for (const r of allCustomerResults) {
      const type = r.name.replace(/Customer #\d+: /, '');
      if (!endpointGroups[type]) endpointGroups[type] = [];
      endpointGroups[type].push(r);
    }

    for (const [type, results] of Object.entries(endpointGroups)) {
      const pass = results.filter(r => r.success).length;
      const avg = results.reduce((s, r) => s + r.duration, 0) / results.length;
      const max = Math.max(...results.map(r => r.duration));
      const statusCodes = [...new Set(results.map(r => r.statusCode).filter(Boolean))].join(',');
      console.log(`  ${type.padEnd(25)} ${pass}/${results.length} pass  avg ${(avg / 1000).toFixed(1)}s  max ${(max / 1000).toFixed(1)}s  codes: [${statusCodes}]`);
    }

    // Failed customer requests detail
    const failedCustomers = allCustomerResults.filter(s => !s.success);
    if (failedCustomers.length > 0) {
      console.log(`\n  Failed customer requests (${failedCustomers.length}):`);
      for (const f of failedCustomers.slice(0, 10)) {
        console.log(`    ✗ ${f.name}: ${f.error?.substring(0, 80)}`);
      }
      if (failedCustomers.length > 10) {
        console.log(`    ... and ${failedCustomers.length - 10} more`);
      }
    }

    // ========================================
    // Phase 5: Summary Statistics
    // ========================================
    const totalEmployees = employeeResults.length;
    const passedEmployees = employeeResults.filter(r => r.success).length;
    const allEmployeeSteps = employeeResults.flatMap(r => r.steps);
    const totalSteps = allEmployeeSteps.length;
    const passedSteps = allEmployeeSteps.filter(s => s.success).length;
    const avgEmployeeTime = employeeResults.reduce((s, r) => s + r.totalTime, 0) / totalEmployees;

    console.log('\n' + '╔' + '═'.repeat(72) + '╗');
    console.log('║' + '  SUMMARY'.padEnd(72) + '║');
    console.log('╠' + '═'.repeat(72) + '╣');
    console.log(`║  Total wall-clock time:      ${(totalElapsed / 1000).toFixed(1)}s`.padEnd(73) + '║');
    console.log(`║  ${'─'.repeat(70)}  ║`);
    console.log(`║  EMPLOYEES (20 concurrent)`.padEnd(73) + '║');
    console.log(`║    Users passed:             ${passedEmployees}/${totalEmployees}`.padEnd(73) + '║');
    console.log(`║    Steps passed:             ${passedSteps}/${totalSteps}`.padEnd(73) + '║');
    console.log(`║    Avg completion time:       ${(avgEmployeeTime / 1000).toFixed(1)}s`.padEnd(73) + '║');
    console.log(`║  ${'─'.repeat(70)}  ║`);
    console.log(`║  CUSTOMERS (100 concurrent)`.padEnd(73) + '║');
    console.log(`║    Requests passed:          ${customerSuccess}/${allCustomerResults.length}`.padEnd(73) + '║');
    console.log(`║    Requests failed:          ${customerFailed}/${allCustomerResults.length}`.padEnd(73) + '║');
    console.log(`║    Avg response time:         ${(customerAvgTime / 1000).toFixed(1)}s`.padEnd(73) + '║');
    console.log(`║  ${'─'.repeat(70)}  ║`);

    // Per role
    console.log(`║  PER ROLE`.padEnd(73) + '║');
    for (const role of roleOrder) {
      const roleResults = employeeResults.filter(r => r.role === role);
      const rolePass = roleResults.filter(r => r.success).length;
      const roleAvg = roleResults.reduce((s, r) => s + r.totalTime, 0) / roleResults.length;
      console.log(`║    ${role.padEnd(20)} ${rolePass}/${roleResults.length} pass  avg ${(roleAvg / 1000).toFixed(1)}s`.padEnd(73) + '║');
    }
    console.log('╚' + '═'.repeat(72) + '╝');

    // ========================================
    // Phase 6: Bug Detection
    // ========================================
    const bugs = detectBugs(employeeResults, allCustomerResults);

    console.log('\n' + '╔' + '═'.repeat(72) + '╗');
    console.log('║' + `  BUG REPORT (${bugs.length} issues found)`.padEnd(72) + '║');
    console.log('╚' + '═'.repeat(72) + '╝\n');

    if (bugs.length === 0) {
      console.log('  ✅ ไม่พบ Bug! ระบบทำงานได้ปกติภายใต้โหลดทดสอบ\n');
    } else {
      const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
      for (const bug of bugs) {
        bySeverity[bug.severity]++;
        const severityIcon = bug.severity === 'CRITICAL' ? '🔴' : bug.severity === 'HIGH' ? '🟠' : bug.severity === 'MEDIUM' ? '🟡' : '🟢';
        console.log(`  ${severityIcon} BUG #${bug.id} [${bug.severity}] ${bug.category}`);
        console.log(`     ${bug.description}`);
        console.log(`     Context: ${bug.context}`);
        if (bug.reproSteps) {
          console.log(`     Repro: ${bug.reproSteps}`);
        }
        console.log('');
      }
      console.log(`  Summary: ${bySeverity.CRITICAL} Critical, ${bySeverity.HIGH} High, ${bySeverity.MEDIUM} Medium, ${bySeverity.LOW} Low`);
    }

    // ========================================
    // Phase 7: Performance Rating
    // ========================================
    console.log('\n📊 Performance Rating:');
    const criticalBugs = bugs.filter(b => b.severity === 'CRITICAL').length;
    if (criticalBugs === 0 && passedEmployees >= 18 && customerSuccess >= 90 && avgEmployeeTime < 30000) {
      console.log('⭐⭐⭐⭐⭐ EXCELLENT');
    } else if (criticalBugs === 0 && passedEmployees >= 15 && customerSuccess >= 75) {
      console.log('⭐⭐⭐⭐ GOOD');
    } else if (passedEmployees >= 10 && customerSuccess >= 50) {
      console.log('⭐⭐⭐ ACCEPTABLE');
    } else if (passedEmployees >= 5) {
      console.log('⭐⭐ NEEDS IMPROVEMENT');
    } else {
      console.log('⭐ POOR');
    }

    // ========================================
    // Cleanup
    // ========================================
    await Promise.all([
      ...employeeContexts.map(ctx => ctx.close()),
      customerContext.close(),
    ]);

    // ========================================
    // Assertions
    // ========================================
    console.log(`\n✓ Load test completed: ${passedEmployees}/${totalEmployees} employees, ${customerSuccess}/${allCustomerResults.length} customers`);

    // At least 75% employees should complete successfully
    expect(passedEmployees).toBeGreaterThanOrEqual(15);
    // At least 70% customer requests should succeed (not 500)
    expect(customerSuccess).toBeGreaterThanOrEqual(70);
    // No critical bugs
    expect(criticalBugs).toBe(0);
  });
});
