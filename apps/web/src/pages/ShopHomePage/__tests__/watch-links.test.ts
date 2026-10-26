import { describe, it, expect } from 'vitest';
import { watchHref } from '../watch-links';

/** แถวงานค้างเป็นลิงก์เฉพาะเมื่อบทบาทนั้นเปิดหน้าปลายทางได้ (ตาม ProtectedRoute ใน App.tsx) */
describe('watchHref', () => {
  it.each([
    ['LOW_STOCK', 'OWNER', '/stock/alerts'],
    ['LOW_STOCK', 'BRANCH_MANAGER', '/stock/alerts'],
    ['LOW_STOCK', 'SALES', null],
    ['LOW_STOCK', 'ACCOUNTANT', null],
    ['AGING_90', 'SALES', '/stock/products?sortBy=stockInDate&sortDirection=asc'],
    ['QC_PHOTO', 'OWNER', '/purchase-orders/qc'],
    ['QC_PHOTO', 'FINANCE_MANAGER', null],
    ['TRANSFER_PENDING', 'BRANCH_MANAGER', '/stock/transfers'],
    ['TRANSFER_PENDING', 'SALES', null],
    ['REPOSSESSED', 'SALES', '/stock/products?view=all&status=REPOSSESSED'],
    ['PO_APPROVAL', 'SALES', null],
    ['PO_APPROVAL', 'ACCOUNTANT', '/purchase-orders'],
  ] as const)('%s + %s → %s', (key, role, expected) => {
    expect(watchHref(key, role)).toBe(expected);
  });
});
