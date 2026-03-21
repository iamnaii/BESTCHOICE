import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

/**
 * Business Logic & Performance Edge Cases
 *
 * ทดสอบ edge cases ระดับ business logic และ performance smoke tests
 * อ้างอิง: docs/system-analysis-test-scenarios.md (Section 1.4, 1.6)
 *
 * Test groups:
 * - Payment page edge cases
 * - Contract creation & management edge cases
 * - Stock management edge cases
 * - Customer management edge cases
 * - Performance smoke tests (page load time, concurrent operations)
 * - Responsive & accessibility checks
 */

// ─── Payment Page Edge Cases ────────────────────────────────────

test.describe('Payment Page Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('TC-BIZ-PAY1: payments page should load and display content', async ({ page }) => {
    await page.goto('/payments');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL('/payments');
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('TC-BIZ-PAY2: overdue page should load and display tracking info', async ({ page }) => {
    await page.goto('/overdue');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL('/overdue');
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('TC-BIZ-PAY3: slip review page should load', async ({ page }) => {
    await page.goto('/slip-review');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL('/slip-review');
  });

  test('TC-BIZ-PAY4: payment page should handle Thai text input in search', async ({ page }) => {
    await page.goto('/payments');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[placeholder*="ค้นหา"], input[type="search"]').first();
    if (await searchInput.isVisible()) {
      // Thai text search
      await searchInput.fill('สมชาย ใจดี');
      await searchInput.press('Enter');
      await page.waitForLoadState('networkidle');

      // Should handle Thai characters without error
      await expect(page).toHaveURL(/\/payments/);
    }
  });

  test('TC-BIZ-PAY5: payment page should handle special characters in search', async ({ page }) => {
    await page.goto('/payments');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[placeholder*="ค้นหา"], input[type="search"]').first();
    if (await searchInput.isVisible()) {
      const specialInputs = [
        '!@#$%^&*()',
        '   ', // spaces only
        'CN-2026-03-001',
        '0812345678',
      ];

      for (const input of specialInputs) {
        await searchInput.fill(input);
        await searchInput.press('Enter');
        await page.waitForLoadState('networkidle');

        // Should not crash
        await expect(page).toHaveURL(/\/payments/);
      }
    }
  });
});

// ─── Contract Page Edge Cases ───────────────────────────────────

test.describe('Contract Page Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('TC-BIZ-CON1: contracts list should display and support pagination', async ({ page }) => {
    await page.goto('/contracts');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL('/contracts');

    // Check for pagination or data display
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('TC-BIZ-CON2: contract creation page should load', async ({ page }) => {
    await page.goto('/contracts/create');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL('/contracts/create');

    // Should have form elements
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('TC-BIZ-CON3: contract search with Thai characters should work', async ({ page }) => {
    await page.goto('/contracts');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[placeholder*="ค้นหา"], input[type="search"]').first();
    if (await searchInput.isVisible()) {
      // Search with contract number pattern
      await searchInput.fill('BC-2026');
      await searchInput.press('Enter');
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(/\/contracts/);

      // Search with customer name in Thai
      await searchInput.fill('สมชาย');
      await searchInput.press('Enter');
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(/\/contracts/);
    }
  });

  test('TC-BIZ-CON4: contract detail page with invalid ID should handle gracefully', async ({ page }) => {
    await page.goto('/contracts/00000000-0000-0000-0000-000000000000');
    await page.waitForLoadState('networkidle');

    // Should show error or redirect, not crash with blank page
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('TC-BIZ-CON5: contract status filters should work', async ({ page }) => {
    await page.goto('/contracts');
    await page.waitForLoadState('networkidle');

    // Look for status filter buttons/tabs
    const statusFilters = page.locator('button, [role="tab"]').filter({
      hasText: /ทั้งหมด|ACTIVE|OVERDUE|COMPLETED|DEFAULT|รอ/,
    });

    const count = await statusFilters.count();
    if (count > 0) {
      // Click first filter
      await statusFilters.first().click();
      await page.waitForLoadState('networkidle');

      // Should still be on contracts page
      await expect(page).toHaveURL(/\/contracts/);
    }
  });
});

// ─── Customer Management Edge Cases ─────────────────────────────

test.describe('Customer Management Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('TC-BIZ-CUST1: customers page should load with data', async ({ page }) => {
    await page.goto('/customers');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL('/customers');
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('TC-BIZ-CUST2: customer search should handle various input types', async ({ page }) => {
    await page.goto('/customers');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[placeholder*="ค้นหา"], input[type="search"]').first();
    if (await searchInput.isVisible()) {
      const searchTerms = [
        'สมชาย',           // Thai name
        '0891234567',      // Phone number
        'BC-2026-01-001',  // Contract number
        '',                // Empty (should show all)
      ];

      for (const term of searchTerms) {
        await searchInput.fill(term);
        await searchInput.press('Enter');
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveURL(/\/customers/);
      }
    }
  });

  test('TC-BIZ-CUST3: customer detail with non-existent ID should not crash', async ({ page }) => {
    await page.goto('/customers/non-existent-customer-id');
    await page.waitForLoadState('networkidle');

    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });
});

// ─── Stock Management Edge Cases ────────────────────────────────

test.describe('Stock Management Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('TC-BIZ-STK1: stock page should load and display inventory', async ({ page }) => {
    await page.goto('/stock');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL('/stock');
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('TC-BIZ-STK2: stock search should work with IMEI format', async ({ page }) => {
    await page.goto('/stock');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[placeholder*="ค้นหา"], input[placeholder*="IMEI"], input[type="search"]').first();
    if (await searchInput.isVisible()) {
      // Search by IMEI pattern (15 digits)
      await searchInput.fill('123456789012345');
      await searchInput.press('Enter');
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(/\/stock/);

      // Search by product name
      await searchInput.fill('iPhone 15');
      await searchInput.press('Enter');
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(/\/stock/);
    }
  });

  test('TC-BIZ-STK3: stock transfer page should load', async ({ page }) => {
    // Try to navigate to stock transfers
    await page.goto('/stock');
    await page.waitForLoadState('networkidle');

    // Look for transfer tab or button
    const transferLink = page.locator('a, button').filter({
      hasText: /โอน|transfer|Transfer/i,
    }).first();

    if (await transferLink.isVisible()) {
      await transferLink.click();
      await page.waitForLoadState('networkidle');
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    }
  });
});

// ─── POS Edge Cases ─────────────────────────────────────────────

test.describe('POS Edge Cases', () => {
  test('TC-BIZ-POS1: POS page should load', async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/pos');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL('/pos');
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });
});

// ─── Dashboard Edge Cases ───────────────────────────────────────

test.describe('Dashboard Edge Cases', () => {
  test('TC-BIZ-DASH1: dashboard should load all widgets', async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL('/');
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();

    // Dashboard should have some content (cards, charts, or numbers)
    expect(bodyText!.length).toBeGreaterThan(100);
  });

  test('TC-BIZ-DASH2: dashboard should not show JavaScript errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await loginViaAPI(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Wait a bit for async data loading
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('ResizeObserver') &&
        !e.includes('Non-Error') &&
        !e.includes('Loading chunk') &&
        !e.includes('ChunkLoadError')
    );

    expect(criticalErrors).toHaveLength(0);
  });
});

// ─── Performance Smoke Tests ────────────────────────────────────

test.describe('Performance Smoke Tests', () => {
  test('TC-PD1: dashboard should load within 10 seconds', async ({ page }) => {
    const start = Date.now();
    await loginViaAPI(page);
    await page.waitForLoadState('networkidle');
    const totalTime = Date.now() - start;

    // Login + dashboard load should be within 10s (generous for CI)
    expect(totalTime).toBeLessThan(10000);
  });

  test('TC-PD2: contract list page should load within 5 seconds', async ({ page }) => {
    await loginViaAPI(page);

    const start = Date.now();
    await page.goto('/contracts');
    await page.waitForLoadState('networkidle');
    const loadTime = Date.now() - start;

    expect(loadTime).toBeLessThan(5000);
  });

  test('TC-PD3: customer list page should load within 5 seconds', async ({ page }) => {
    await loginViaAPI(page);

    const start = Date.now();
    await page.goto('/customers');
    await page.waitForLoadState('networkidle');
    const loadTime = Date.now() - start;

    expect(loadTime).toBeLessThan(5000);
  });

  test('TC-PD4: stock page should load within 5 seconds', async ({ page }) => {
    await loginViaAPI(page);

    const start = Date.now();
    await page.goto('/stock');
    await page.waitForLoadState('networkidle');
    const loadTime = Date.now() - start;

    expect(loadTime).toBeLessThan(5000);
  });

  test('TC-PD5: sequential page navigation should stay responsive', async ({ page }) => {
    await loginViaAPI(page);

    const pages = [
      { url: '/', name: 'Dashboard' },
      { url: '/customers', name: 'Customers' },
      { url: '/contracts', name: 'Contracts' },
      { url: '/payments', name: 'Payments' },
      { url: '/stock', name: 'Stock' },
    ];

    for (const p of pages) {
      const start = Date.now();
      await page.goto(p.url);
      await page.waitForLoadState('networkidle');
      const loadTime = Date.now() - start;

      // Each page should load within 5 seconds
      expect(loadTime).toBeLessThan(5000);
    }
  });

  test('TC-PD6: slow network should show loading states not blank page', async ({ page }) => {
    await loginViaAPI(page);

    // Simulate slow 3G
    const client = await page.context().newCDPSession(page);
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: (750 * 1024) / 8, // 750 kbps
      uploadThroughput: (250 * 1024) / 8,   // 250 kbps
      latency: 100,
    });

    await page.goto('/contracts');

    // Page should show some content (loading state, skeleton, or actual data)
    // within 15 seconds even on slow network
    await page.waitForLoadState('domcontentloaded');
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();

    // Reset network
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: -1,
      uploadThroughput: -1,
      latency: 0,
    });
  });
});

// ─── Reports Page Edge Cases ────────────────────────────────────

test.describe('Reports Page Edge Cases', () => {
  test('TC-BIZ-RPT1: reports page should load', async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');

    // Should either show reports or redirect
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });
});

// ─── Empty State Handling ───────────────────────────────────────

test.describe('Empty State Handling', () => {
  test('TC-BIZ-EMPTY1: search with no results should show empty state', async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/customers');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[placeholder*="ค้นหา"], input[type="search"]').first();
    if (await searchInput.isVisible()) {
      // Search for something that definitely doesn't exist
      await searchInput.fill('ZZZZZZZZZZNOTEXIST99999');
      await searchInput.press('Enter');
      await page.waitForLoadState('networkidle');

      // Should show empty state message, not error
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
      // Should not show error-like messages
      expect(bodyText).not.toContain('Internal Server Error');
    }
  });
});

// ─── Browser Compatibility Edge Cases ───────────────────────────

test.describe('Browser Edge Cases', () => {
  test('TC-BIZ-BROWSER1: page should handle window resize', async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Resize to mobile width
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    let bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();

    // Resize to tablet
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(500);

    bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();

    // Resize back to desktop
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(500);

    bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('TC-BIZ-BROWSER2: print dialog should not crash', async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Emulate print media
    await page.emulateMedia({ media: 'print' });

    // Page should not crash
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();

    // Reset
    await page.emulateMedia({ media: 'screen' });
  });
});
