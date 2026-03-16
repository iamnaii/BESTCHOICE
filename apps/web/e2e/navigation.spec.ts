import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

const protectedPages = [
  { path: '/', name: 'Dashboard' },
  { path: '/customers', name: 'Customers' },
  { path: '/contracts', name: 'Contracts' },
  { path: '/payments', name: 'Payments' },
  { path: '/stock', name: 'Stock' },
  { path: '/pos', name: 'POS' },
  { path: '/sales', name: 'Sales' },
  { path: '/overdue', name: 'Overdue' },
  { path: '/reports', name: 'Reports' },
  { path: '/users', name: 'Users' },
  { path: '/settings', name: 'Settings' },
];

test.describe('Navigation - Protected Routes', () => {
  test('should redirect unauthenticated user to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/login');
  });

  test('should redirect unauthenticated from protected pages', async ({ page }) => {
    await page.goto('/customers');
    await expect(page).toHaveURL('/login');
  });

  for (const { path, name } of protectedPages) {
    test(`should load ${name} page (${path}) when authenticated`, async ({ page }) => {
      await loginAsAdmin(page);
      await page.goto(path);
      // Page should load without error (no crash, no blank page)
      await page.waitForLoadState('networkidle');
      const bodyText = await page.textContent('body');
      expect(bodyText?.length).toBeGreaterThan(0);
    });
  }
});

test.describe('Navigation - Public Routes', () => {
  test('should access landing page without auth', async ({ page }) => {
    await page.goto('/landing');
    await expect(page).toHaveURL('/landing');
  });

  test('should access login page without auth', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL('/login');
  });
});
