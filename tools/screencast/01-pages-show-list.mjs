// Screencast helper for FB App Review — clip #1: pages_show_list
//
// Usage:
//   1. Start screen recording: Cmd+Shift+5 → Record Selected Portion
//   2. node tools/screencast/01-pages-show-list.mjs
//   3. Stop recording when "DONE" prints

import { chromium } from '/Users/iamnaii/Desktop/App/BESTCHOICE/node_modules/playwright/index.mjs';

const EMAIL = process.env.EMAIL || 'admin@bestchoice.com';
const PASSWORD = process.env.PASSWORD || 'admin1234';
const BASE = 'https://bestchoicephone.app';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('Launching Chromium with DevTools...');
  const browser = await chromium.launch({
    headless: false,
    devtools: true,
    slowMo: 500,
    args: ['--window-size=1440,900'],
  });

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();

  page.on('request', (req) => {
    if (req.url().includes('graph.facebook.com')) {
      console.log(`[Network] ${req.method()} ${req.url()}`);
    }
  });

  console.log('\n=== START SCREEN RECORDING NOW (Cmd+Shift+5) ===');
  console.log('Waiting 6s for you to start recording...');
  await sleep(6000);

  // Step 1: Login
  console.log('\n--- Step 1: Login ---');
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.fill('input[type="email"]', EMAIL);
  await sleep(600);
  await page.fill('input[type="password"]', PASSWORD);
  await sleep(600);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 20000 });
  await sleep(2500);

  // Step 2: Go to Integrations
  console.log('\n--- Step 2: Open Settings → Integrations ---');
  await page.goto(`${BASE}/settings/integrations`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);

  // Step 3: Click "Facebook Messenger" card
  console.log('\n--- Step 3: Click Facebook Messenger card ---');
  const fbCard = page.getByRole('button', { name: /Facebook Messenger/i }).first();
  await fbCard.scrollIntoViewIfNeeded();
  await sleep(1200);
  await fbCard.click();
  await sleep(2500);

  // Step 4: Wait for dialog and scroll to App Review Panel
  console.log('\n--- Step 4: Scroll to App Review Panel ---');
  const panelHeading = page.getByText('ทดสอบ Permissions (Facebook App Review)').first();
  await panelHeading.waitFor({ timeout: 10000 });
  await panelHeading.scrollIntoViewIfNeeded();
  await sleep(2000);

  // Step 5: Find and expand "ดึงรายการ Pages ที่จัดการ"
  console.log('\n--- Step 5: Expand pages_show_list card ---');
  const cardTitle = page.getByRole('button', { name: /ดึงรายการ Pages ที่จัดการ/ }).first();
  await cardTitle.scrollIntoViewIfNeeded();
  await sleep(1500);
  await cardTitle.click();
  await sleep(2000);

  // Step 6: Click "ยิง API"
  console.log('\n--- Step 6: Fire API ---');
  const fireBtn = page.getByRole('button', { name: /ยิง API/ }).first();
  await fireBtn.scrollIntoViewIfNeeded();
  await sleep(1000);
  await fireBtn.click();

  // Step 7: Wait for success badge or response visible
  console.log('\n--- Step 7: Wait for response ---');
  await page.getByText(/สำเร็จ|ล้มเหลว/).first().waitFor({ timeout: 20000 }).catch(() => {});
  await sleep(3000);

  // Step 8: Try to expand "ดูข้อมูล" if available
  const showDataBtn = page.getByRole('button', { name: /ดูข้อมูล|Show/ }).first();
  if (await showDataBtn.isVisible().catch(() => false)) {
    await showDataBtn.click().catch(() => {});
    await sleep(3000);
  }

  console.log('\n=== DONE — recording can stop ===');
  console.log('Press Ctrl+C in this terminal to close browser.');

  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
