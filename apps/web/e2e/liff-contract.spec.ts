import { test, expect } from '@playwright/test';
import { mockLiffSdk, mockLiffApi } from './helpers/liff-mock';

const MOCK_CONTRACT_DATA = {
  customer: { name: 'สมชาย จันทร์ดี' },
  contracts: [
    {
      id: 'con1',
      contractNumber: 'BC-2026-0001',
      status: 'ACTIVE',
      product: 'Apple iPhone 15',
      sellingPrice: 35000,
      downPayment: 5000,
      monthlyPayment: 2500,
      totalMonths: 12,
      paidInstallments: 3,
      totalOutstanding: 22500,
      createdAt: '2026-01-15T00:00:00.000Z',
      payments: [
        { installmentNo: 1, dueDate: '2026-02-15', amountDue: 2500, amountPaid: 2500, lateFee: 0, status: 'PAID', paidDate: '2026-02-14', paymentMethod: 'BANK_TRANSFER' },
        { installmentNo: 2, dueDate: '2026-03-15', amountDue: 2500, amountPaid: 2500, lateFee: 0, status: 'PAID', paidDate: '2026-03-14', paymentMethod: 'PROMPTPAY' },
        { installmentNo: 3, dueDate: '2026-04-15', amountDue: 2500, amountPaid: 2500, lateFee: 0, status: 'PAID', paidDate: '2026-04-13', paymentMethod: 'CASH' },
        { installmentNo: 4, dueDate: '2026-05-15', amountDue: 2500, amountPaid: 0, lateFee: 100, status: 'OVERDUE', paidDate: null, paymentMethod: null },
        { installmentNo: 5, dueDate: '2026-06-15', amountDue: 2500, amountPaid: 0, lateFee: 0, status: 'PENDING', paidDate: null, paymentMethod: null },
      ],
    },
  ],
};

test.describe('LIFF Contract View', () => {
  test.beforeEach(async ({ page }) => {
    await mockLiffSdk(page);
    await mockLiffApi(page, [
      { method: 'GET', path: '/line-oa/liff/contracts', body: MOCK_CONTRACT_DATA },
      { method: 'GET', path: '/line-oa/liff/consent', body: { consent: true, consentAt: '2026-04-01' } },
    ]);
  });

  test('displays customer name and contract summary', async ({ page }) => {
    await page.goto('/liff/contract');
    await expect(page.getByText('คุณสมชาย จันทร์ดี')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('BC-2026-0001')).toBeVisible();
    await expect(page.getByText('Apple iPhone 15')).toBeVisible();
  });

  test('shows payment schedule with status icons', async ({ page }) => {
    await page.goto('/liff/contract');
    await expect(page.getByText('BC-2026-0001')).toBeVisible({ timeout: 10000 });

    // PAID installments should show ✅, OVERDUE should show ❌
    await expect(page.getByText('✅').first()).toBeVisible();
    await expect(page.getByText('❌').first()).toBeVisible();
  });

  test('shows contract stats (paid vs outstanding)', async ({ page }) => {
    await page.goto('/liff/contract');
    await expect(page.getByText('BC-2026-0001')).toBeVisible({ timeout: 10000 });

    // 3/12 paid
    await expect(page.getByText('3')).toBeVisible();
    await expect(page.getByText('12')).toBeVisible();
  });

  test('shows PDPA consent modal when not consented', async ({ page }) => {
    // Override consent to false
    await page.route('**/line-oa/liff/consent*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ consent: false, consentAt: null }),
      });
    });

    await page.goto('/liff/contract');
    await expect(page.getByText('ข้อตกลงการใช้งาน')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'ยินยอม' })).toBeVisible();
  });
});
