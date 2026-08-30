import { chromium, APIRequestContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, '../.playwright-auth.json');
const ROLE_AUTH_FILE = path.join(__dirname, '../.playwright-roles-auth.json');

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
  return data.accessToken;
}

export default async function globalSetup() {
  const apiURL = process.env.API_DIRECT_URL || 'http://localhost:3000';

  const browser = await chromium.launch();
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

  await browser.close();
}
