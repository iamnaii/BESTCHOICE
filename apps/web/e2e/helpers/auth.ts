import { Page, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { unwrapResponse } from './api-utils';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TEST_USER = {
  email: 'admin@bestchoice.com',
  password: 'admin1234',
};

/**
 * Multi-role test accounts (all seeded with the same password).
 * Used for role-based access testing.
 */
export type TestRole = 'OWNER' | 'BRANCH_MANAGER' | 'FINANCE_MANAGER' | 'SALES' | 'ACCOUNTANT';

export const ROLE_ACCOUNTS: Record<TestRole, { email: string; password: string; name: string }> = {
  OWNER: { email: 'admin@bestchoice.com', password: 'admin1234', name: 'สุรชัย เจ้าของร้าน' },
  BRANCH_MANAGER: {
    email: 'manager.ladprao@bestchoice.com',
    password: 'admin1234',
    name: 'วิภา ผู้จัดการลาดพร้าว',
  },
  FINANCE_MANAGER: {
    email: 'finance@bestchoice.com',
    password: 'admin1234',
    name: 'นภา ผู้จัดการการเงิน',
  },
  SALES: { email: 'sales1@bestchoice.com', password: 'admin1234', name: 'สมศักดิ์ พนักงานขาย' },
  ACCOUNTANT: {
    email: 'accountant@bestchoice.com',
    password: 'admin1234',
    name: 'พิมพ์ใจ ฝ่ายบัญชี',
  },
};

const AUTH_FILE = path.join(__dirname, '../../.playwright-auth.json');
const ROLE_AUTH_FILE = path.join(__dirname, '../../.playwright-roles-auth.json');

// JWT expiry is 15m — treat token as stale after 12 min to be safe
//
// ⚠️ 2026-08-30: เคยตั้งสมมติฐานว่าค่านี้คือเหตุที่ E2E แดงทั้งชุด — shard ที่รันนานกว่า
// 12 นาทีจะ login ใหม่ต่อเทสแล้วชน throttle 10 ครั้ง/นาที (auth.controller.ts) หลักฐาน
// ที่ใช้คือ "อัตราล้มไต่ขึ้นตรงนาที 10-15 ทุก shard ที่รันเกินนั้น ส่วน shard ที่จบใน
// 13 นาทีนิ่งที่ 3-5%"
//
// **ทดลองแล้วผิด** — ยก JWT_EXPIRATION เป็น 2h + ค่านี้เป็น 90 นาทีใน CI
// (run 33294915303) รูปแบบไม่ขยับเลย: shard 1 ยังเป็น 15/62/82/67/23/76/41%
//
// เหตุจริง: Playwright รัน spec **เรียงตามตัวอักษร** และไฟล์ที่ล้มยกไฟล์
// (approval-workflow, assets-*, crm-kanban-stages, …) อยู่ท้าย ๆ ตัวอักษรพอดี
// ⇒ แกน "เวลา" คือแกน "ลำดับไฟล์" การไล่ตามเวลาจึงเป็นทางตัน ให้ไล่ทีละ spec แทน
const TOKEN_MAX_AGE_MS = 12 * 60 * 1000;

/**
 * Read the token saved by global-setup.ts.
 * Falls back to a fresh API login if the file is missing or the token is stale.
 */
async function getToken(page: Page): Promise<string> {
  if (fs.existsSync(AUTH_FILE)) {
    try {
      const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8')) as {
        accessToken: string;
        timestamp: number;
      };
      if (auth.accessToken && Date.now() - auth.timestamp < TOKEN_MAX_AGE_MS) {
        return auth.accessToken;
      }
    } catch {
      // fall through to API login
    }
  }

  // Fallback: login directly (e.g. when running a single spec without globalSetup)
  const apiURL = process.env.API_DIRECT_URL || 'http://localhost:3000';
  const response = await page.request.post(`${apiURL}/api/auth/login`, {
    data: { email: TEST_USER.email, password: TEST_USER.password },
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });

  if (!response.ok()) {
    throw new Error(`loginViaAPI fallback failed: HTTP ${response.status()}`);
  }

  const data = unwrapResponse(await response.json());
  if (!data.accessToken) {
    throw new Error('loginViaAPI fallback: no accessToken in response');
  }

  // Cache the fresh token so subsequent tests in this worker reuse it
  fs.writeFileSync(
    AUTH_FILE,
    JSON.stringify({ accessToken: data.accessToken, timestamp: Date.now() }),
  );

  return data.accessToken;
}

/**
 * Login via the UI and store auth state.
 *
 * WebKit quirk: after a successful login the React Router navigation from
 * /login → / sometimes never fires in WebKit (Playwright). Chromium and
 * Firefox handle it fine with the natural 30 s wait. For WebKit we:
 *  1. Capture the login API response to extract the accessToken.
 *  2. Inject it into localStorage via addInitScript (api.ts reads and clears
 *     it on module init).
 *  3. Navigate to / manually so the app boots with auth already in memory.
 */
export async function loginAsAdmin(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#email');
  await page.fill('#email', TEST_USER.email);
  await page.fill('#password', TEST_USER.password);

  const isWebkit = page.context().browser()?.browserType().name() === 'webkit';

  if (isWebkit) {
    // Capture login response alongside click so we can extract the token
    const [response] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/api/auth/login') && resp.request().method() === 'POST',
        { timeout: 15000 },
      ),
      page.click('button[type="submit"]'),
    ]);

    if (response.ok()) {
      const rawData = await response.json().catch(() => ({}));
      const data = unwrapResponse(rawData);
      const token = (data as { accessToken?: string }).accessToken;
      if (token) {
        // addInitScript runs before any script on every subsequent page load
        await page.addInitScript((t: string) => {
          localStorage.setItem('access_token', t);
        }, token);
        await page.goto('/', { waitUntil: 'domcontentloaded' });
      }
    }
  } else {
    await page.click('button[type="submit"]');
  }

  // Wait for redirect to dashboard — use toHaveURL which polls the URL
  await expect(page).toHaveURL('/', { timeout: 30000 });
  await page.waitForSelector('.sidebar', { timeout: 15000 });
}

/**
 * Login via cached token from global-setup (fast, no rate-limit risk).
 * Uses addInitScript so the token survives full page reloads — the app's
 * api.ts reads localStorage('access_token') on module init then deletes it,
 * so we must re-inject it before every page load.
 */
export async function loginViaAPI(page: Page) {
  const token = await getToken(page);

  // Set Authorization header for page.request API calls
  await page.setExtraHTTPHeaders({
    Authorization: `Bearer ${token}`,
    'X-Requested-With': 'XMLHttpRequest',
  });

  // addInitScript runs before ANY script on every page load (including navigations).
  // This ensures api.ts always finds the token in localStorage on module init.
  await page.addInitScript((t: string) => {
    localStorage.setItem('access_token', t);
  }, token);

  // Navigate to dashboard — token is injected before the SPA boots
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Wait for auth to resolve — use toHaveURL (polls) instead of waitForURL
  await expect(page).toHaveURL('/', { timeout: 30000 });
}

/**
 * Per-worker token cache for role-based logins.
 * Avoids hitting the login API for every test in the same worker,
 * which would trigger ThrottlerGuard rate limiting.
 */
const roleTokenCache: Partial<Record<TestRole, { token: string; timestamp: number }>> = {};
const ROLE_TOKEN_MAX_AGE_MS = 10 * 60 * 1000; // 10 min (JWT expires at 15 min)

/**
 * เขียน token ที่เพิ่ง login ได้กลับเข้าไฟล์ร่วม (ไฟล์เดียวกับที่ global-setup.ts สร้าง)
 *
 * ทำไมต้องเขียนกลับ: `roleTokenCache` อยู่ในหน่วยความจำของ worker process และ Playwright
 * **ทิ้ง worker ทุกครั้งที่เทสตกแล้ว retry** ⇒ cache หายทุกครั้งที่มีเทสตก ส่วนไฟล์จาก
 * global-setup ก็ถือว่าหมดอายุที่ 10 นาที ขณะที่ shard หนึ่งรัน 24-42 นาที (CI 2026-08-25)
 * ⇒ ตั้งแต่นาทีที่ 10 เป็นต้นไป แทบทุกเทสยิง /auth/login ใหม่ ซึ่งถูก throttle ที่ 10 ครั้ง/นาที
 * → HTTP 429 (125 ครั้งจาก 208 ที่ตกในรอบนั้น) เขียนกลับแล้ว worker ที่เกิดใหม่ใช้ต่อได้เลย
 *
 * ไฟล์นี้อยู่บน runner ของ shard ตัวเอง (แต่ละ shard คนละเครื่อง) จึงไม่มีการแย่งเขียนข้าม shard
 */
function persistRoleToken(role: TestRole, token: string): void {
  try {
    let tokens: Record<string, string> = {};
    if (fs.existsSync(ROLE_AUTH_FILE)) {
      const existing = JSON.parse(fs.readFileSync(ROLE_AUTH_FILE, 'utf-8')) as {
        tokens?: Record<string, string>;
      };
      tokens = existing.tokens ?? {};
    }
    tokens[role] = token;
    fs.writeFileSync(ROLE_AUTH_FILE, JSON.stringify({ tokens, timestamp: Date.now() }));
  } catch {
    // เขียนไม่ได้ก็ไม่เป็นไร — cache ในหน่วยความจำยังใช้ได้ ห้ามทำให้เทสล้มเพราะเรื่องนี้
  }
}

async function apiLoginRole(page: Page, role: TestRole): Promise<string> {
  const account = ROLE_ACCOUNTS[role];
  const apiURL = process.env.API_DIRECT_URL || 'http://localhost:3000';

  // /auth/login ถูก throttle ที่ 10 ครั้ง/นาที/IP — ใน CI ทุกเทสมาจาก IP เดียวกัน
  // ถ้าบังเอิญชนกันให้รอแล้วลองใหม่ ดีกว่าให้เทสตกทั้งใบด้วยเหตุผลที่ไม่เกี่ยวกับสิ่งที่มันทดสอบ
  const RETRY_DELAYS_MS = [6000, 12000, 20000];
  let lastStatus = 0;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const response = await page.request.post(`${apiURL}/api/auth/login`, {
      data: { email: account.email, password: account.password },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });

    if (response.ok()) {
      const data = unwrapResponse(await response.json());
      if (!data.accessToken) {
        throw new Error(`loginAsRole(${role}): no accessToken in response`);
      }

      const token = data.accessToken as string;
      roleTokenCache[role] = { token, timestamp: Date.now() };
      persistRoleToken(role, token);
      return token;
    }

    lastStatus = response.status();
    // ลองใหม่เฉพาะ 429 เท่านั้น — 401/500 ลองกี่ครั้งก็ได้ผลเดิม และการรอเปล่า ๆ
    // ทำให้เห็นสาเหตุจริงช้าลง
    if (lastStatus !== 429 || attempt === RETRY_DELAYS_MS.length) break;
    await page.waitForTimeout(RETRY_DELAYS_MS[attempt]);
  }

  throw new Error(`loginAsRole(${role}) failed: HTTP ${lastStatus}`);
}

/**
 * Login as a specific role via API (cached per worker to avoid rate limiting).
 * Use this for role-based access tests where you need non-OWNER accounts.
 */
export async function loginAsRole(page: Page, role: TestRole) {
  let token: string;

  const cached = roleTokenCache[role];
  if (cached && Date.now() - cached.timestamp < ROLE_TOKEN_MAX_AGE_MS) {
    token = cached.token;
  } else if (fs.existsSync(ROLE_AUTH_FILE)) {
    // Reuse tokens pre-fetched by global-setup.ts. Sharing tokens across workers
    // avoids hammering /auth/login (throttled at 10/min) when sharded CI runs
    // many workers in parallel.
    try {
      const cache = JSON.parse(fs.readFileSync(ROLE_AUTH_FILE, 'utf-8')) as {
        tokens: Record<string, string>;
        timestamp: number;
      };
      if (cache.tokens?.[role] && Date.now() - cache.timestamp < ROLE_TOKEN_MAX_AGE_MS) {
        token = cache.tokens[role];
        roleTokenCache[role] = { token, timestamp: cache.timestamp };
      } else {
        token = await apiLoginRole(page, role);
      }
    } catch {
      token = await apiLoginRole(page, role);
    }
  } else {
    token = await apiLoginRole(page, role);
  }

  await page.setExtraHTTPHeaders({
    Authorization: `Bearer ${token}`,
    'X-Requested-With': 'XMLHttpRequest',
  });

  await page.addInitScript((t: string) => {
    localStorage.setItem('access_token', t);
  }, token);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL('/', { timeout: 30000 });
}

/**
 * Get auth headers for page.request API calls
 */
export function getAuthHeaders(): Record<string, string> {
  if (fs.existsSync(AUTH_FILE)) {
    try {
      const auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8')) as { accessToken: string };
      if (auth.accessToken) {
        return {
          'X-Requested-With': 'XMLHttpRequest',
          Authorization: `Bearer ${auth.accessToken}`,
        };
      }
    } catch {
      // fall through
    }
  }
  return { 'X-Requested-With': 'XMLHttpRequest' };
}

/**
 * Auth headers for `page.request` calls made as a specific role.
 *
 * `loginAsRole` sets these headers via `page.setExtraHTTPHeaders`, but that only
 * covers requests the PAGE makes. `page.request` is the browser context's
 * APIRequestContext — a separate channel that never sees those headers, so a
 * direct `page.request.post(...)` arrives with no `X-Requested-With` and
 * `CsrfGuard` rejects it with 403. Pass this explicitly on every such call.
 *
 * Must be called AFTER `loginAsRole(page, role)` in the same worker — that's
 * what populates the token cache this reads.
 */
export function getRoleAuthHeaders(role: TestRole): Record<string, string> {
  const token = roleTokenCache[role]?.token;
  if (!token) {
    throw new Error(
      `getRoleAuthHeaders(${role}): no cached token — call loginAsRole(page, '${role}') first`,
    );
  }
  return {
    'X-Requested-With': 'XMLHttpRequest',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Logout and clear state
 */
export async function logout(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem('access_token');
  });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
}
