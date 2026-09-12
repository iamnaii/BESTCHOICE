// Checkout UI with synthetic quote/signature fixtures; all writes intercepted.
// The matching financial create/activate/reversal paths run on disposable PostgreSQL.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { resolveSignatureRequirements } from '@installment/shared';
const origin = process.env.SALES_PREVIEW_URL ?? 'http://localhost:5207';
const output = 'docs/review/2026-09-11-sales/evidence/contracts';
await mkdir(output, { recursive: true });
const actor = await (await fetch(`${origin}/api/admin/auth/me`)).json();
const branch = { id: actor.branchId ?? 'synthetic-branch', name: 'สาขาตัวอย่าง' };
const customer = { id: 'synthetic-quote-customer', name: 'ลูกค้าตัวอย่าง UX', phone: '0800000000', nationalId: '',
  birthDate: '2008-01-01', salaryPayDay: 31, activeContracts: 0, overdueContracts: 0, references: [] };
const product = { id: 'synthetic-quote-product', branchId: branch.id, branch, category: 'PHONE_NEW', name: 'เครื่องตัวอย่าง UX', brand: 'TEST', model: 'PHONE',
  status: 'IN_STOCK', cashPrice: '9000', installmentPrice: '10000', costPrice: '6000', prices: [], imeiSerial: 'SYNTHETIC-QUOTE-001' };
const config = { id: 'synthetic-config', name: 'แผนตัวอย่าง', interestRate: '0.01', minDownPaymentPct: '0.15', storeCommissionPct: '0.1',
  vatPct: '0.07', minInstallmentMonths: 6, maxInstallmentMonths: 12 };
const quote = fingerprint => ({ fingerprint, sellingPrice: '10000.00', downPayment: '2000.00', cashDownPayment: '2000.00', tradeInCreditAmount: '0.00',
  configId: config.id, vatSource: 'BRANCH_COMPANY', effectiveVatPct: '0.0000', interestRate: '0.0100', storeCommissionPct: '0.1000',
  minDownPaymentPct: '0.1500', minInstallmentMonths: 6, maxInstallmentMonths: 12, ratePct: '0.06000000', principal: '8000.00',
  interestTotal: '480.00', storeCommission: '800.00', vatAmount: '0.00', totalPayable: '9280.00', monthlyPayment: '1546.66', lastPayment: '1546.70',
  totalMonths: 6, firstDueDate: '2026-10-30T17:00:00.000Z', schedule: Array.from({ length: 6 }, (_, index) => ({
    installmentNo: index + 1, dueDate: new Date(Date.UTC(2026, 10 + index, 0) - 7 * 3600000).toISOString(),
    amountDue: index === 5 ? '1546.70' : '1546.66', monthlyPrincipal: '0.00', monthlyInterest: '0.00', monthlyCommission: '0.00', vatAmount: '0.00',
  })) });
const signatures = ['CUSTOMER', 'STAFF', 'WITNESS_1', 'WITNESS_2'].map((signerType, index) => ({ id: `sign-${index}`, signerType, signedAt: '2026-09-11T01:00:00Z' }));
const contract = { id: 'synthetic-contract', contractNumber: 'DEMO-QUOTE-001', status: 'DRAFT', workflowStatus: 'APPROVED',
  customerId: customer.id, productId: product.id, branchId: branch.id, salespersonId: actor.id, salesperson: actor, branch, customer, product,
  sellingPrice: '10000', downPayment: '2000', downPaymentMethod: 'BANK_TRANSFER', downPaymentReference: 'SYNTHETIC-TRANSFER',
  financedAmount: '8000', monthlyPayment: '1546.66', interestRate: '0.01', totalMonths: 6, interestTotal: '480', storeCommission: '800', vatAmount: '0',
  paymentDueDay: 31, createdAt: '2026-09-11T01:00:00Z', notes: '', planType: 'STORE_DIRECT', pdpaConsentId: 'synthetic-pdpa',
  signatures, signatureRequirements: resolveSignatureRequirements(signatures, true), eDocuments: [], contractDocuments: [],
  payments: quote('a').schedule.map((row, index) => ({ ...row, id: `payment-${index}`, status: 'PENDING', amountPaid: '0', lateFee: '0' })),
};
const browser = await chromium.launch({ headless: true });
const results = [], submitted = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    await context.routeWebSocket('**/socket.io/**', socket => socket.close());
    await context.addInitScript(({ actorId, customerId, productId }) => {
      localStorage.setItem(`bestchoice-contract-draft:${actorId}`, JSON.stringify({ step: 2, customerId, productId,
        downPayment: 2000, totalMonths: 6, paymentDueDay: 31, notes: '', savedAt: new Date().toISOString() }));
    }, { actorId: actor.id, customerId: customer.id, productId: product.id });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let failed = false, changed = false;
    await page.route('**/api/admin/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname.replace('/api/admin', '');
      if (request.method() !== 'GET') {
        if (path === '/contracts/quote') return route.fulfill(failed ? { status: 503, json: { message: 'โหลดผลคำนวณตัวอย่างไม่สำเร็จ' } }
          : { json: quote((changed ? 'b' : 'a').repeat(64)) });
        if (path === '/contracts') {
          submitted.push({ width, body: request.postDataJSON() }); changed = true;
          return route.fulfill({ status: 409, json: { code: 'CONTRACT_QUOTE_CHANGED', message: 'เงื่อนไขตัวอย่างเปลี่ยน กรุณาทบทวนยอดใหม่', quote: quote('b'.repeat(64)) } });
        }
        return route.fulfill({ status: 501, json: { message: 'Synthetic UI check: other writes disabled' } });
      }
      if (path === `/products/${product.id}`) return route.fulfill({ json: product });
      if (path === `/customers/${customer.id}`) return route.fulfill({ json: customer });
      if (path === '/products') return route.fulfill({ json: { data: [product], total: 1 } });
      if (path === '/customers') return route.fulfill({ json: { data: [customer], total: 1 } });
      if (path.endsWith('/credit-check/latest')) return route.fulfill({ json: { id: 'credit', status: 'APPROVED', checkType: 'FULL',
        approvals: [{ id: 'synthetic-approval', salaryPayDay: 31, approvedMonthlyPayment: '2000', supersededAt: null, usedByContractId: null }] } });
      if (path.startsWith('/interest-configs') || path === '/sales/config') return route.fulfill({ json: config });
      if (path === '/trade-ins/credits/available') return route.fulfill({ json: [] });
      if (path === '/contracts/synthetic-contract') return route.fulfill({ json: contract });
      if (path === '/contracts/synthetic-contract/signatures') return route.fulfill({ json: signatures });
      return route.continue();
    });
    const snap = async name => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, `${name} page overflow ${width}`);
      await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
      results.push({ name, width, overflow });
    };
    await page.goto(`${origin}/contracts/create`);
    const submit = page.getByRole('button', { name: 'สร้างสัญญาและบันทึกรับดาวน์', exact: true });
    await expect(submit).toBeEnabled();
    await expect(page.getByText(/งวดสุดท้าย 1,546.70/)).toBeVisible();
    await snap('quoted-plan');
    await page.getByLabel('วิธีรับเงินดาวน์').selectOption('BANK_TRANSFER');
    await page.getByLabel('เลขอ้างอิงการรับเงิน (ถ้ามี)').fill('SYNTHETIC-TRANSFER');
    await page.getByText('ดูตารางงวดก่อนสร้างสัญญา', { exact: true }).click();
    await snap('transfer-schedule');
    await submit.click();
    await expect(page.getByRole('button', { name: 'ตรวจยอดใหม่แล้ว' })).toBeEnabled();
    await expect(submit).toBeDisabled();
    await snap('changed-quote-review');
    await page.getByRole('button', { name: 'ตรวจยอดใหม่แล้ว' }).click();
    await expect(submit).toBeEnabled();
    failed = true;
    await page.getByLabel(/เงินดาวน์ที่รับเป็นเงินสด\/โอน/).fill('3000');
    await expect(page.getByRole('button', { name: 'คำนวณอีกครั้ง' })).toBeVisible();
    await expect(submit).toBeDisabled();
    await snap('quote-error');
    await page.goto(`${origin}/contracts/synthetic-contract`);
    await expect(page.getByRole('button', { name: 'เปิดใช้งานสัญญา', exact: true })).toBeDisabled();
    await expect(page.getByText(/ผู้ปกครอง/, { exact: false }).first()).toBeVisible();
    await snap('guardian-required');
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeVisible();
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    await context.close();
  }
  assert.equal(submitted.length, 2);
  for (const { body } of submitted) {
    assert.equal(body.quoteFingerprint, 'a'.repeat(64)); assert.equal(body.downPaymentMethod, 'BANK_TRANSFER');
    assert.equal(body.downPaymentReference, 'SYNTHETIC-TRANSFER');
  }
  await writeFile(`${output}/results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), origin,
    mode: 'synthetic UI reads and intercepted writes; separate disposable PostgreSQL financial tests', results, submitted }, null, 2));
  console.log(`PASS: ${results.length} contract states at 1440/390; no overflow or uncaught errors; tender/fingerprint verified`);
} finally { await browser.close(); }
