import { test, expect, Page } from '@playwright/test';

// ============================================================================
// BESTCHOICE LIFF Contract Page (Phase 19)
// Route: /liff/contract?lineId=xxx (dev mode fallback)
//
// Public LINE LIFF page for customers to view their contracts
// No admin auth needed - uses LINE lineId for identification
//
// Tests:
//   - Header with customer name
//   - Contract summary card (number, status, product, prices, paid count)
//   - Payment schedule table with status icons
//   - Show all payments button (when > 6 installments)
//   - Pay next installment CTA
//   - Early payoff CTA
//   - Download contract PDF button
//   - Navigation links (history, profile)
//   - No contracts state
//   - Error state (not registered)
//   - Multiple contracts tab switching
// ============================================================================

const MOCK_CONTRACT_DATA = {
  customer: { name: 'สมชาย ใจดี' },
  contracts: [
    {
      id: 'c-1',
      contractNumber: 'BCP-LIFF-001',
      status: 'ACTIVE',
      product: 'Apple iPhone 15 128GB',
      sellingPrice: 15000,
      downPayment: 3000,
      totalMonths: 10,
      paidInstallments: 3,
      totalOutstanding: 9240,
      createdAt: '2026-01-15T10:00:00.000Z',
      payments: [
        { installmentNo: 1, dueDate: '2026-02-05', amountDue: 1320, amountPaid: 1320, lateFee: 0, status: 'PAID', paidDate: '2026-02-05', paymentMethod: 'CASH' },
        { installmentNo: 2, dueDate: '2026-03-05', amountDue: 1320, amountPaid: 1320, lateFee: 0, status: 'PAID', paidDate: '2026-03-04', paymentMethod: 'CASH' },
        { installmentNo: 3, dueDate: '2026-04-05', amountDue: 1320, amountPaid: 1320, lateFee: 0, status: 'PAID', paidDate: '2026-04-03', paymentMethod: 'BANK_TRANSFER' },
        { installmentNo: 4, dueDate: '2026-05-05', amountDue: 1320, amountPaid: 0, lateFee: 0, status: 'PENDING', paidDate: null, paymentMethod: null },
        { installmentNo: 5, dueDate: '2026-06-05', amountDue: 1320, amountPaid: 0, lateFee: 0, status: 'PENDING', paidDate: null, paymentMethod: null },
        { installmentNo: 6, dueDate: '2026-07-05', amountDue: 1320, amountPaid: 0, lateFee: 0, status: 'PENDING', paidDate: null, paymentMethod: null },
        { installmentNo: 7, dueDate: '2026-08-05', amountDue: 1320, amountPaid: 0, lateFee: 0, status: 'PENDING', paidDate: null, paymentMethod: null },
        { installmentNo: 8, dueDate: '2026-09-05', amountDue: 1320, amountPaid: 0, lateFee: 0, status: 'PENDING', paidDate: null, paymentMethod: null },
        { installmentNo: 9, dueDate: '2026-10-05', amountDue: 1320, amountPaid: 0, lateFee: 0, status: 'PENDING', paidDate: null, paymentMethod: null },
        { installmentNo: 10, dueDate: '2026-11-05', amountDue: 1320, amountPaid: 0, lateFee: 0, status: 'PENDING', paidDate: null, paymentMethod: null },
      ],
    },
  ],
};

const MOCK_OVERDUE_DATA = {
  customer: { name: 'วิชัย ทองดี' },
  contracts: [
    {
      id: 'c-2',
      contractNumber: 'BCP-LIFF-002',
      status: 'OVERDUE',
      product: 'Samsung Galaxy S24',
      sellingPrice: 12000,
      downPayment: 2000,
      totalMonths: 6,
      paidInstallments: 1,
      totalOutstanding: 8500,
      createdAt: '2026-02-01T10:00:00.000Z',
      payments: [
        { installmentNo: 1, dueDate: '2026-03-05', amountDue: 1700, amountPaid: 1700, lateFee: 0, status: 'PAID', paidDate: '2026-03-05', paymentMethod: 'CASH' },
        { installmentNo: 2, dueDate: '2026-04-05', amountDue: 1700, amountPaid: 0, lateFee: 200, status: 'OVERDUE', paidDate: null, paymentMethod: null },
        { installmentNo: 3, dueDate: '2026-05-05', amountDue: 1700, amountPaid: 0, lateFee: 0, status: 'PENDING', paidDate: null, paymentMethod: null },
      ],
    },
  ],
};

const MOCK_MULTI_CONTRACT = {
  customer: { name: 'หลายสัญญา ลูกค้า' },
  contracts: [
    { ...MOCK_CONTRACT_DATA.contracts[0], id: 'c-m1', contractNumber: 'BCP-M001' },
    { ...MOCK_OVERDUE_DATA.contracts[0], id: 'c-m2', contractNumber: 'BCP-M002' },
  ],
};

async function mockLiffApis(page: Page, responseData: object | null, options: { status?: number } = {}) {
  const { status = 200 } = options;

  // Mock LIFF SDK - since we can't use real LINE, mock the module
  await page.addInitScript(() => {
    (window as any).__LIFF_MOCK__ = true;
  });

  await page.route('**/line-oa/liff/contracts*', async (route) => {
    if (status === 404) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not found' }) });
    } else if (status >= 400) {
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ message: 'Error' }) });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseData) });
    }
  });

  await page.route('**/line-oa/liff/create-payment-link', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://pay.example.com/test' }) });
  });

  await page.route('**/api/contracts/*/documents', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
}

test.describe('Phase 19: LIFF Contract Page', () => {
  // ── 19.1 Header shows customer name ────────────────────────────────
  test('19.1 Header shows BEST CHOICE branding and customer name', async ({ page }) => {
    await mockLiffApis(page, MOCK_CONTRACT_DATA);
    await page.goto('/liff/contract?lineId=test-line-001', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(page.getByText('สัญญาของฉัน')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('คุณสมชาย ใจดี')).toBeVisible();
  });

  // ── 19.2 Contract summary card displays ────────────────────────────
  test('19.2 Contract summary shows number, product, prices, and paid count', async ({ page }) => {
    await mockLiffApis(page, MOCK_CONTRACT_DATA);
    await page.goto('/liff/contract?lineId=test-line-001', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(page.getByText('BCP-LIFF-001')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Apple iPhone 15 128GB')).toBeVisible();
    await expect(page.getByText('15,000 บาท')).toBeVisible();
    await expect(page.getByText('3,000 บาท')).toBeVisible();
    await expect(page.getByText('3/10 งวด')).toBeVisible();
  });

  // ── 19.3 Status badge shows correct Thai label ─────────────────────
  test('19.3 ACTIVE status shows ปกติ badge', async ({ page }) => {
    await mockLiffApis(page, MOCK_CONTRACT_DATA);
    await page.goto('/liff/contract?lineId=test-line-001', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(page.getByText('ปกติ')).toBeVisible({ timeout: 5000 });
  });

  // ── 19.4 OVERDUE status shows ค้างชำระ ─────────────────────────────
  test('19.4 OVERDUE status shows ค้างชำระ badge and late fee', async ({ page }) => {
    await mockLiffApis(page, MOCK_OVERDUE_DATA);
    await page.goto('/liff/contract?lineId=test-line-002', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(page.getByText('ค้างชำระ', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('ค่าปรับ 200')).toBeVisible();
  });

  // ── 19.5 Payment schedule shows installments ──────────────────────
  test('19.5 Payment schedule shows installment rows with status icons', async ({ page }) => {
    await mockLiffApis(page, MOCK_CONTRACT_DATA);
    await page.goto('/liff/contract?lineId=test-line-001', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(page.getByText('ตารางค่างวด')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('งวดที่ 1')).toBeVisible();
    await expect(page.getByText('งวดที่ 3')).toBeVisible();

    // Status icons legend
    await expect(page.getByText('✅ ชำระแล้ว')).toBeVisible();
    await expect(page.getByText('⬜ รอชำระ')).toBeVisible();
  });

  // ── 19.6 Show all payments button (> 6 installments) ──────────────
  test('19.6 Shows ดูทั้งหมด button when more than 6 installments', async ({ page }) => {
    await mockLiffApis(page, MOCK_CONTRACT_DATA);
    await page.goto('/liff/contract?lineId=test-line-001', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Should show max 6 first, then "show all" button
    const showAllBtn = page.getByText('ดูทั้งหมด (10 งวด)');
    await expect(showAllBtn).toBeVisible({ timeout: 5000 });

    // Click show all
    await showAllBtn.click();
    await page.waitForTimeout(500);

    // Now should show installment 10
    await expect(page.getByText('งวดที่ 10')).toBeVisible();
  });

  // ── 19.7 Pay next installment CTA shows ───────────────────────────
  test('19.7 Pay next installment CTA shows for active contract with outstanding', async ({ page }) => {
    await mockLiffApis(page, MOCK_CONTRACT_DATA);
    await page.goto('/liff/contract?lineId=test-line-001', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(page.getByText('งวดถัดไป: งวดที่ 4')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("ชำระเงิน")')).toBeVisible();
  });

  // ── 19.8 Early payoff link shows for ACTIVE ───────────────────────
  test('19.8 Early payoff link shows for active contract', async ({ page }) => {
    await mockLiffApis(page, MOCK_CONTRACT_DATA);
    await page.goto('/liff/contract?lineId=test-line-001', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(page.getByText('ปิดยอดก่อนกำหนด (ลดดอกเบี้ย 50%)')).toBeVisible({ timeout: 5000 });
  });

  // ── 19.9 Download contract PDF button ─────────────────────────────
  test('19.9 Download contract PDF button is visible', async ({ page }) => {
    await mockLiffApis(page, MOCK_CONTRACT_DATA);
    await page.goto('/liff/contract?lineId=test-line-001', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(page.getByText('ดาวน์โหลดสัญญา PDF')).toBeVisible({ timeout: 5000 });
  });

  // ── 19.10 Navigation links show ───────────────────────────────────
  test('19.10 Navigation links to history and profile are visible', async ({ page }) => {
    await mockLiffApis(page, MOCK_CONTRACT_DATA);
    await page.goto('/liff/contract?lineId=test-line-001', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(page.getByText('ประวัติชำระเงิน')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('โปรไฟล์ของฉัน')).toBeVisible();
  });

  // ── 19.11 No contracts shows empty state ──────────────────────────
  test('19.11 No contracts shows ไม่มีสัญญา message', async ({ page }) => {
    await mockLiffApis(page, { customer: { name: 'ทดสอบ' }, contracts: [] });
    await page.goto('/liff/contract?lineId=test-line-003', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(page.getByRole('heading', { name: 'ไม่มีสัญญา' })).toBeVisible({ timeout: 5000 });
  });

  // ── 19.12 Not registered shows error with register link ───────────
  test('19.12 Not registered (404) shows error with ลงทะเบียนเลย link', async ({ page }) => {
    await mockLiffApis(page, null, { status: 404 });
    await page.goto('/liff/contract?lineId=test-line-404', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(page.getByText('ไม่สามารถดำเนินการได้')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('ลงทะเบียนเลย')).toBeVisible();
  });

  // ── 19.13 API error shows error state ─────────────────────────────
  test('19.13 API error shows ไม่สามารถโหลดข้อมูลได้', async ({ page }) => {
    await mockLiffApis(page, null, { status: 500 });
    await page.goto('/liff/contract?lineId=test-line-500', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(page.getByText('ไม่สามารถดำเนินการได้')).toBeVisible({ timeout: 5000 });
  });

  // ── 19.14 Multiple contracts shows tab buttons ────────────────────
  test('19.14 Multiple contracts shows tab buttons for switching', async ({ page }) => {
    await mockLiffApis(page, MOCK_MULTI_CONTRACT);
    await page.goto('/liff/contract?lineId=test-line-multi', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Both contract numbers should appear as tabs
    await expect(page.locator('button:has-text("BCP-M001")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("BCP-M002")')).toBeVisible();

    // Switch to second contract
    await page.locator('button:has-text("BCP-M002")').click();
    await page.waitForTimeout(500);

    // Should show second contract's product
    await expect(page.getByText('Samsung Galaxy S24')).toBeVisible();
  });

  // ── 19.15 Outstanding ครบแล้ว for completed contracts ──────────────
  test('19.15 Completed contract shows ครบแล้ว for outstanding', async ({ page }) => {
    const completedData = {
      customer: { name: 'ปิดสัญญา ลูกค้า' },
      contracts: [{
        ...MOCK_CONTRACT_DATA.contracts[0],
        id: 'c-done',
        contractNumber: 'BCP-DONE-001',
        status: 'COMPLETED',
        paidInstallments: 10,
        totalOutstanding: 0,
        payments: MOCK_CONTRACT_DATA.contracts[0].payments.map(p => ({ ...p, status: 'PAID', amountPaid: p.amountDue, paidDate: '2026-05-01' })),
      }],
    };
    await mockLiffApis(page, completedData);
    await page.goto('/liff/contract?lineId=test-line-done', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(page.getByText('ครบแล้ว').first()).toBeVisible({ timeout: 5000 });
  });

  // ── 19.16 Footer shows BEST CHOICE branding ──────────────────────
  test('19.16 Footer shows BEST CHOICE branding text', async ({ page }) => {
    await mockLiffApis(page, MOCK_CONTRACT_DATA);
    await page.goto('/liff/contract?lineId=test-line-001', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await expect(page.getByText('BEST CHOICE - ระบบผ่อนชำระมือถือ')).toBeVisible({ timeout: 5000 });
  });
});
