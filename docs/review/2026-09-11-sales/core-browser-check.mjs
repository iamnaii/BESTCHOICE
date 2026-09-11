import { resolveSignatureRequirements } from '@installment/shared';
// Run from repository root: node docs/review/2026-09-11-sales/core-browser-check.mjs
// Real UI from this checkout; synthetic API responses for POS/signing, no real writes.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.SALES_PREVIEW_URL ?? 'http://localhost:5207';
const output = 'docs/review/2026-09-11-sales/evidence/core';
await mkdir(output, { recursive: true });
const get = async path => (await fetch(`${origin}/api/admin${path}`)).json();
const actor = await get('/auth/me');
const customer = { id: 'core-customer', name: 'ลูกค้าตัวอย่าง UX', phone: '0800000000', nationalId: '',
  birthDate: '1990-01-01', _count: { contracts: 0 } };
const product = { id: 'core-product', name: 'เครื่องตัวอย่าง UX', brand: 'TEST', model: 'PHONE', category: 'PHONE_NEW',
  imeiSerial: 'SYNTHETIC-CORE-001', branchId: actor.branchId ?? 'core-branch',
  branch: { id: actor.branchId ?? 'core-branch', name: 'สาขาตัวอย่าง' }, status: 'IN_STOCK', costPrice: '6000',
  cashPrice: '9000', installmentPrice: '10000', prices: [
    { id: 'cash', label: 'ราคาเงินสด', amount: '9000', isDefault: true },
    { id: 'loan', label: 'ราคาผ่อน BESTCHOICE', amount: '10000', isDefault: false },
  ] };
const contract = { id: 'core-contract', contractNumber: 'DEMO-CORE-001', status: 'DRAFT', workflowStatus: 'CREATING',
  pdpaConsentId: 'synthetic-consent', customer, product, salesperson: actor, signatures: [], signatureRequirements: resolveSignatureRequirements([], false), totalMonths: 6, monthlyPayment: 1500 };
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    await context.routeWebSocket('**/socket.io/**', socket => socket.close());
    const page = await context.newPage();
    const errors = [], writes = [];
    let previewFails = true, missingCash = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/admin/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname.replace('/api/admin', '');
      if (req.method() !== 'GET') {
        writes.push({ path, method: req.method() });
        return route.fulfill({ status: 501, json: { message: 'Synthetic UI check: writes disabled' } });
      }
      let data;
      if (path === '/products') data = { data: [{ ...product, ...(missingCash ? { cashPrice: null, prices: product.prices.slice(1) } : {}) }], total: 1 };
      if (path === '/sales/top-products') data = [];
      if (path === '/customers') data = { data: [customer], total: 1 };
      if (path === '/external-finance-companies') data = [];
      if (path === '/sales/config') data = { interestRate: 0.01, minDownPaymentPct: 0.15, minInstallmentMonths: 6, maxInstallmentMonths: 12 };
      if (path === '/contracts/core-contract') data = contract;
      if (path === '/contracts/core-contract/kyc/status') data = { status: 'VERIFIED', otpVerified: true, idCardUploaded: true };
      if (path === '/contracts/core-contract/signatures') data = [];
      if (path === '/contracts/core-contract/preview') {
        if (previewFails) return route.fulfill({ status: 503, json: { message: 'Synthetic preview failure' } });
        data = { html: '<!doctype html><html lang="th"><body><h1>เอกสารตัวอย่างสำหรับทดสอบ</h1><p>ข้อมูลสมมติ ไม่ใช่เอกสารลงนามจริง</p></body></html>' };
      }
      return data !== undefined ? route.fulfill({ json: data }) : route.continue();
    });
    const snap = async name => {
      await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      results.push({ name, width, overflow });
    };
    await page.goto(`${origin}/pos`);
    await page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น IMEI, ชื่อ, รุ่น...').fill('TEST');
    await page.getByRole('button').filter({ hasText: 'TEST PHONE' }).first().click();
    await expect(page.getByLabel(/ราคาขาย/)).toHaveValue('9000');
    await expect(page.getByRole('button', { name: /ราคาเงินสด/ })).toHaveAttribute('aria-pressed', 'true');
    await snap('pos-cash');
    await page.getByRole('button', { name: 'ผ่อนไฟแนนซ์', exact: true }).click();
    await expect(page.getByLabel(/ราคาขาย/)).toHaveValue('10000');
    await page.getByRole('button', { name: 'เงินสด', exact: true }).click();
    await expect(page.getByLabel(/ราคาขาย/)).toHaveValue('9000');
    missingCash = true;
    await page.reload();
    await page.getByPlaceholder('พิมพ์อย่างน้อย 2 ตัวอักษร เช่น IMEI, ชื่อ, รุ่น...').fill('TEST');
    await page.getByRole('button').filter({ hasText: 'TEST PHONE' }).first().click();
    await expect(page.getByText(/ยังไม่ได้ตั้งราคาเงินสด/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'บันทึกการขาย' })).toBeDisabled();
    await snap('pos-missing-cash');

    await page.goto(`${origin}/contracts/core-contract/sign`);
    await page.getByRole('button', { name: 'ดำเนินการต่อ', exact: true }).click();
    await page.getByRole('button', { name: 'ดำเนินการต่อ', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('โหลดเอกสารสัญญาไม่สำเร็จ', { timeout: 15000 });
    await expect(page.getByRole('checkbox')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'เซ็นสัญญา', exact: true })).toBeDisabled();
    await snap('sign-preview-error');
    previewFails = false;
    await page.getByRole('button', { name: 'ลองใหม่' }).click();
    await expect(page.getByRole('checkbox')).toBeEnabled();
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'เซ็นสัญญา', exact: true })).toBeDisabled();
    await page.getByRole('checkbox').check();
    await expect(page.getByRole('button', { name: 'เซ็นสัญญา', exact: true })).toBeEnabled();
    await snap('sign-preview-recovered');
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    assert.deepEqual(writes, [], 'No signature or monetary writes during the check');
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(`${output}/result.json`, JSON.stringify({ origin, scope: 'Real rendered UI; synthetic read responses and preview 503; no signatures or monetary writes', results }, null, 2));
console.log(JSON.stringify(results));
