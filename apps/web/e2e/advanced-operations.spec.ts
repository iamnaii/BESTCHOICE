import { test, expect } from '@playwright/test';
import { loginAsRole } from './helpers/auth';
import { gotoWithRetry } from './helpers/navigation';

/**
 * Advanced Operations E2E Tests (P2 Priority)
 *
 * Covers: Inspections, Exchange, Repossession, Reports Export,
 * and Phase 6 pages (Trade-In, Promotions, Tax Reports, Commissions).
 *
 * Note: Basic smoke tests for /exchange, /repossessions, /inspections already
 * exist in page-smoke.spec.ts. Role access for /exchange, /repossessions,
 * /financial-audit already exists in role-access.spec.ts. Reports are covered
 * in reports-notifications.spec.ts. This file adds content assertions and
 * covers Phase 6 pages that have no test coverage.
 */

test.describe('Advanced Operations', () => {
  // ─── Inspection ───────────────────────────────────────────────────
  test('BRANCH_MANAGER can access inspections page', async ({ page }) => {
    await loginAsRole(page, 'BRANCH_MANAGER');
    await gotoWithRetry(page, '/inspections');
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/inspections');
  });

  // ─── Exchange ─────────────────────────────────────────────────────
  test('OWNER can access exchange page', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await gotoWithRetry(page, '/exchange');
    await page.waitForTimeout(2000);
    const pageContent = await page.textContent('body');
    expect(pageContent).toMatch(/เปลี่ยนเครื่อง|exchange/i);
  });

  test('FINANCE_MANAGER can access exchange page', async ({ page }) => {
    await loginAsRole(page, 'FINANCE_MANAGER');
    await gotoWithRetry(page, '/exchange');
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/exchange');
  });

  // ─── Repossession ─────────────────────────────────────────────────
  test('OWNER can access repossessions page', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await gotoWithRetry(page, '/repossessions');
    await page.waitForTimeout(2000);
    const pageContent = await page.textContent('body');
    expect(pageContent).toMatch(/ยึดคืน|repossess/i);
  });

  // ─── Reports ──────────────────────────────────────────────────────
  test('OWNER can access reports page', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await gotoWithRetry(page, '/reports');
    await page.waitForTimeout(2000);
    const pageContent = await page.textContent('body');
    expect(pageContent).toMatch(/รายงาน|report/i);
  });

  test('ACCOUNTANT can access financial audit', async ({ page }) => {
    await loginAsRole(page, 'ACCOUNTANT');
    await gotoWithRetry(page, '/financial-audit');
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/financial-audit');
  });

  // ─── Phase 6 Pages ────────────────────────────────────────────────
  test('OWNER can access trade-in page', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await gotoWithRetry(page, '/trade-in');
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/trade-in');
  });

  test('OWNER can access promotions page', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await gotoWithRetry(page, '/promotions');
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/promotions');
  });

  test('OWNER can access tax reports page', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await gotoWithRetry(page, '/tax-reports');
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/tax-reports');
  });

  test('OWNER can access commissions page', async ({ page }) => {
    await loginAsRole(page, 'OWNER');
    await gotoWithRetry(page, '/commissions');
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/commissions');
  });

  test('SALES can access their commissions', async ({ page }) => {
    await loginAsRole(page, 'SALES');
    await gotoWithRetry(page, '/commissions');
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/commissions');
  });
});
