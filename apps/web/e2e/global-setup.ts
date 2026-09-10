import { chromium, APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, '../.playwright-auth.json');
const ROLE_AUTH_FILE = path.join(__dirname, '../.playwright-roles-auth.json');
// สองตารางนี้คือ "กระจก" ของ ROLE_COMPANY_ACCESS ใน packages/shared/src/company-access.ts
// ซึ่งเป็น source of truth เดียวของ role → บริษัท (apps/api/prisma/seed.ts derive จากที่นั่น)
// ที่ต้อง hardcode ซ้ำเพราะ Playwright โหลดไฟล์ใน e2e/ เป็น ESM แต่ @installment/shared
// ถูก transpile เป็น CJS → named import พังตั้งแต่ขั้น --list (ลองแล้วทั้งผ่าน alias และ
// path ตรงไป packages/shared/src) ⇒ แก้ค่าที่ packages/shared เมื่อไร ต้องตามมาแก้ที่นี่ด้วย
const EXPECTED_COMPANIES: Record<string, string[]> = {
  OWNER: ['SHOP', 'FINANCE'], BRANCH_MANAGER: ['SHOP'], SALES: ['SHOP'],
  FINANCE_MANAGER: ['SHOP', 'FINANCE'], ACCOUNTANT: ['SHOP', 'FINANCE'],
};
// เดิมเช็ค primaryCompany ด้วย expression `role === 'FINANCE_MANAGER' ? 'FINANCE' : 'SHOP'`
// ซึ่งพังทันทีที่มี role ที่สองที่ลงโซน fin (ACCOUNTANT) — ใช้ตารางแทนเพื่อให้เพิ่ม role
// ใหม่แล้วไม่ต้องแก้ตรรกะ
const EXPECTED_PRIMARY: Record<string, string> = {
  OWNER: 'SHOP', BRANCH_MANAGER: 'SHOP', SALES: 'SHOP',
  FINANCE_MANAGER: 'FINANCE', ACCOUNTANT: 'FINANCE',
};
function assertGrants(user: { role?: string; accessibleCompanies?: string[]; primaryCompany?: string } | undefined, role: string, source: string) {
  const expected = [...EXPECTED_COMPANIES[role]].sort();
  const actual = Array.isArray(user?.accessibleCompanies) ? [...user.accessibleCompanies].sort() : [];
  if (user?.role !== role || JSON.stringify(actual) !== JSON.stringify(expected)
    || user?.primaryCompany !== EXPECTED_PRIMARY[role]) {
    throw new Error(
      `Global setup: ${role} company grants are incorrect in ${source} — ` +
      `expected [${expected.join(', ')}] / primary ${EXPECTED_PRIMARY[role]}, ` +
      `got [${actual.join(', ')}] / primary ${user?.primaryCompany ?? 'undefined'}. ` +
      'ค่าที่คาดหวังมาจาก packages/shared/src/company-access.ts — ตรวจ seed (apps/api/prisma/seed.ts) ' +
      'และการ serialize ใน auth.service.ts ว่าส่งค่าที่ผ่าน resolveCompanyAccess แล้ว',
    );
  }
}

const ROLE_ACCOUNTS: Record<string, { email: string; password: string }> = {
  OWNER: { email: 'admin@bestchoice.com', password: 'admin1234' },
  BRANCH_MANAGER: { email: 'manager.ladprao@bestchoice.com', password: 'admin1234' },
  FINANCE_MANAGER: { email: 'finance@bestchoice.com', password: 'admin1234' },
  SALES: { email: 'sales1@bestchoice.com', password: 'admin1234' },
  ACCOUNTANT: { email: 'accountant@bestchoice.com', password: 'admin1234' },
};

async function loginRole(
  request: APIRequestContext,
  apiURL: string,
  role: string,
  creds: { email: string; password: string },
): Promise<string> {
  const response = await request.post(`${apiURL}/api/auth/login`, {
    data: creds,
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!response.ok()) {
    throw new Error(`Global setup login failed for ${role}: HTTP ${response.status()}`);
  }
  const raw = await response.json();
  const data = raw.success && raw.data ? raw.data : raw;
  if (!data.accessToken) {
    throw new Error(`Global setup: accessToken missing for ${role}`);
  }
  assertGrants(data.user, role, 'login');
  const me = await request.get(`${apiURL}/api/auth/me`, { headers: { Authorization: `Bearer ${data.accessToken}` } });
  if (!me.ok()) throw new Error(`Global setup /auth/me failed for ${role}: HTTP ${me.status()}`);
  const meRaw = await me.json();
  assertGrants(meRaw.success && meRaw.data ? meRaw.data : meRaw, role, '/auth/me');
  return data.accessToken;
}

export default async function globalSetup() {
  const apiURL = process.env.API_DIRECT_URL || 'http://localhost:3000';

  const browser = await chromium.launch();
  try {
  const context = await browser.newContext();

  const tokens: Record<string, string> = {};
  // เวลาที่ออกโทเคน **รายบทบาท** — ลูปนี้เดินทีละตัวเพื่อเลี่ยง throttle 10 ครั้ง/นาที
  // จึงกินเวลาหลายวินาที และ role ท้าย ๆ ได้โทเคนช้ากว่า role แรกจริง ๆ
  // (คู่กับตัวอ่านใน helpers/auth.ts ที่คิดอายุแยกรายบทบาท — ดูคอมเมนต์บั๊ก 401 ที่นั่น)
  const timestamps: Record<string, number> = {};
  for (const [role, creds] of Object.entries(ROLE_ACCOUNTS)) {
    tokens[role] = await loginRole(context.request, apiURL, role, creds);
    timestamps[role] = Date.now();
  }

  fs.writeFileSync(
    AUTH_FILE,
    JSON.stringify({ accessToken: tokens.OWNER, timestamp: timestamps.OWNER }),
  );

  fs.writeFileSync(ROLE_AUTH_FILE, JSON.stringify({ tokens, timestamps, timestamp: Date.now() }));

  } finally {
    await browser.close();
  }
}
