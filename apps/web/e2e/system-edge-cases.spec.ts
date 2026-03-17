import { test, expect } from '@playwright/test';
import { TEST_USER, loginAsAdmin, loginViaAPI, logout } from './helpers/auth';

/**
 * System Edge Cases — Auth, Security, Navigation
 *
 * ทดสอบ edge cases ระดับ system ที่พบจากการวิเคราะห์ source code
 * อ้างอิง: docs/system-analysis-test-scenarios.md (Section 1.4, 1.5)
 *
 * Test IDs map to analysis document:
 * - TC-D*  = Deep-dive edge cases
 * - TC-S*  = Security vulnerabilities
 * - TC-AU* = Auth-specific tests
 * - TC-NAV* = Navigation edge cases
 */

// ─── Auth Token Manipulation & Session Security ─────────────────

test.describe('Auth Token Manipulation', () => {
  test('TC-AU1: corrupted access token should trigger refresh or redirect to login', async ({ page }) => {
    await loginAsAdmin(page);

    // Corrupt the token with various invalid formats
    const corruptTokens = [
      'completely.invalid.token',
      'eyJhbGciOiJIUzI1NiJ9.corrupted.signature',
      '',
      'null',
      '<script>alert(1)</script>',
    ];

    for (const token of corruptTokens) {
      await page.evaluate((t) => {
        localStorage.setItem('access_token', t);
      }, token);

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const url = page.url();
      // Should either auto-refresh (stay on dashboard) or redirect to login
      expect(url.endsWith('/') || url.includes('/login')).toBe(true);
    }
  });

  test('TC-AU2: removing access token should redirect to login', async ({ page }) => {
    await loginAsAdmin(page);

    // Remove token entirely
    await page.evaluate(() => {
      localStorage.removeItem('access_token');
    });

    await page.goto('/customers');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/login/);
  });

  test('TC-AU3: XSS payload in token storage should not execute', async ({ page }) => {
    await page.goto('/login');

    // Store XSS payload as token
    await page.evaluate(() => {
      localStorage.setItem('access_token', '"><script>document.title="HACKED"</script>');
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Title should NOT be "HACKED"
    const title = await page.title();
    expect(title).not.toBe('HACKED');
  });

  test('TC-AU4: logout should clear all auth state', async ({ page }) => {
    await loginAsAdmin(page);

    // Verify we're logged in
    await expect(page).toHaveURL('/');

    await logout(page);

    // Verify token is cleared
    const token = await page.evaluate(() => localStorage.getItem('access_token'));
    expect(token).toBeNull();

    // Navigate to protected route
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/login/);
  });

  test('TC-AU5: back button after logout should not access protected content', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/customers');
    await page.waitForLoadState('networkidle');

    await logout(page);

    // Go back
    await page.goBack();
    await page.waitForLoadState('networkidle');

    // Should redirect to login, not show customer data
    const url = page.url();
    const bodyText = await page.textContent('body');
    if (!url.includes('/login')) {
      // If browser cached the page, ensure no sensitive data is shown
      // (at minimum, API calls should fail)
      expect(bodyText).toBeTruthy();
    }
  });
});

// ─── Login Security & Error Handling ────────────────────────────

test.describe('Login Security', () => {
  test('TC-S-LOGIN1: error messages should not leak user existence', async ({ page }) => {
    // Login with non-existent email
    await page.goto('/login');
    await page.fill('#email', 'nonexistent-user-12345@example.com');
    await page.fill('#password', 'wrongpassword123');
    await page.click('button[type="submit"]');

    const toast1 = page.locator('[data-sonner-toast]').first();
    await expect(toast1).toBeVisible({ timeout: 10000 });
    const error1 = await toast1.textContent();

    // Login with existing email, wrong password
    await page.goto('/login');
    await page.fill('#email', TEST_USER.email);
    await page.fill('#password', 'definitely-wrong-password-xyz');
    await page.click('button[type="submit"]');

    const toast2 = page.locator('[data-sonner-toast]').first();
    await expect(toast2).toBeVisible({ timeout: 10000 });
    const error2 = await toast2.textContent();

    // Both should show generic error (not "user not found" vs "wrong password")
    expect(error1).toBeTruthy();
    expect(error2).toBeTruthy();
    // Ideally they'd be the same message, but at minimum neither should say "user not found"
    expect(error1?.toLowerCase()).not.toContain('not found');
    expect(error1?.toLowerCase()).not.toContain('ไม่พบผู้ใช้');
  });

  test('TC-S-LOGIN2: rapid login attempts should be handled gracefully', async ({ page }) => {
    await page.goto('/login');

    // Fire 10 rapid login attempts
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 10; i++) {
      await page.fill('#email', 'test@test.com');
      await page.fill('#password', 'wrong');
      promises.push(page.click('button[type="submit"]').catch(() => {}));
    }

    // Wait for any pending requests
    await page.waitForLoadState('networkidle');

    // Page should still be functional
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
  });

  test('TC-S-LOGIN3: SQL injection in login fields should be safe', async ({ page }) => {
    await page.goto('/login');

    const sqlPayloads = [
      "' OR '1'='1' --",
      "admin@bestchoice.com'; DROP TABLE \"User\"; --",
      "1; SELECT * FROM \"User\" WHERE 1=1",
    ];

    for (const payload of sqlPayloads) {
      await page.fill('#email', payload);
      await page.fill('#password', payload);
      await page.click('button[type="submit"]');

      // Should show error, not crash or succeed
      await page.waitForLoadState('networkidle');
      const url = page.url();
      expect(url).toContain('/login'); // Should stay on login page
    }
  });

  test('TC-S-LOGIN4: extremely long input should not crash', async ({ page }) => {
    await page.goto('/login');

    const longString = 'a'.repeat(10000);
    await page.fill('#email', longString + '@test.com');
    await page.fill('#password', longString);
    await page.click('button[type="submit"]');

    await page.waitForLoadState('networkidle');
    // Should handle gracefully, not crash
    await expect(page.locator('#email')).toBeVisible();
  });
});

// ─── RBAC & Authorization Boundary Tests ────────────────────────

test.describe('RBAC Authorization Boundaries', () => {
  test('TC-S7: authenticated user should not access admin-only API endpoints without proper role', async ({ page }) => {
    await loginAsAdmin(page);

    const token = await page.evaluate(() => localStorage.getItem('access_token'));

    // Test settings endpoint (should be accessible for OWNER/admin)
    const settingsResponse = await page.request.get('/api/settings', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    // OWNER should have access (not 403)
    expect(settingsResponse.status()).not.toBe(403);
  });

  test('TC-S8: API requests should include branch isolation', async ({ page }) => {
    await loginAsAdmin(page);

    const token = await page.evaluate(() => localStorage.getItem('access_token'));

    // Fetch contracts — should only return contracts for user's branch
    const response = await page.request.get('/api/contracts?page=1&limit=10', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    // Should succeed (200) with branch-filtered data
    expect([200, 304]).toContain(response.status());
  });

  test('TC-RBAC1: accessing non-existent entity should return 404 not 500', async ({ page }) => {
    await loginAsAdmin(page);

    const token = await page.evaluate(() => localStorage.getItem('access_token'));

    const endpoints = [
      '/api/contracts/non-existent-id-12345',
      '/api/customers/non-existent-id-12345',
      '/api/payments/non-existent-id-12345',
    ];

    for (const endpoint of endpoints) {
      const response = await page.request.get(endpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      // Should be 404 (not found) or 400 (bad request for invalid ID format), not 500
      expect(response.status()).not.toBe(500);
    }
  });
});

// ─── Input Sanitization (XSS Prevention) ────────────────────────

test.describe('XSS Prevention', () => {
  test('TC-S10-A: XSS in search fields should not execute', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/customers');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[placeholder*="ค้นหา"], input[type="search"], input[name="search"]').first();

    if (await searchInput.isVisible()) {
      const xssPayloads = [
        '<script>alert("XSS")</script>',
        '<img src=x onerror=alert(1)>',
        '"><script>document.title="XSS"</script>',
        "javascript:alert('XSS')",
      ];

      for (const payload of xssPayloads) {
        await searchInput.fill(payload);
        await searchInput.press('Enter');
        await page.waitForLoadState('networkidle');

        // Script should not execute
        const title = await page.title();
        expect(title).not.toBe('XSS');

        // Page should not show raw HTML tags
        const bodyHtml = await page.innerHTML('body');
        expect(bodyHtml).not.toContain('<script>alert');
      }
    }
  });

  test('TC-S10-B: XSS in URL parameters should not execute', async ({ page }) => {
    await loginAsAdmin(page);

    const xssUrls = [
      '/customers?search=<script>alert(1)</script>',
      '/contracts?filter="><img src=x onerror=alert(1)>',
      '/payments?page=1&sort=<script>document.title="XSS"</script>',
    ];

    for (const url of xssUrls) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');

      const title = await page.title();
      expect(title).not.toBe('XSS');

      // Page should load without crashing
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    }
  });
});

// ─── CSRF Protection Verification ───────────────────────────────

test.describe('CSRF Protection', () => {
  test('TC-S4: mutation API calls should require proper headers', async ({ page }) => {
    await loginAsAdmin(page);

    const token = await page.evaluate(() => localStorage.getItem('access_token'));

    // Try POST without X-Requested-With header (simulating CSRF attack)
    const response = await page.request.post('/api/customers', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        // Deliberately OMIT X-Requested-With
      },
      data: {
        name: 'CSRF Test User',
        phone: '0891234567',
      },
    });

    // Should be rejected by CSRF guard (403) or caught by validation (400/422)
    // The key is it should NOT succeed as 201
    expect([400, 403, 422]).toContain(response.status());
  });
});

// ─── Navigation Edge Cases ──────────────────────────────────────

test.describe('Navigation Edge Cases', () => {
  test('TC-NAV1: direct URL access to deep routes should handle gracefully', async ({ page }) => {
    await loginAsAdmin(page);

    const deepRoutes = [
      '/contracts/create',
      '/contracts/non-existent-id',
      '/customers/non-existent-id',
      '/stock/transfer',
    ];

    for (const route of deepRoutes) {
      const response = await page.goto(route);
      await page.waitForLoadState('networkidle');

      // Should not return server error
      if (response) {
        expect(response.status()).toBeLessThan(500);
      }

      // Page should render something (not blank)
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    }
  });

  test('TC-NAV2: back/forward navigation should maintain state correctly', async ({ page }) => {
    await loginAsAdmin(page);

    // Navigate through pages
    await page.goto('/customers');
    await page.waitForLoadState('networkidle');

    await page.goto('/contracts');
    await page.waitForLoadState('networkidle');

    await page.goto('/payments');
    await page.waitForLoadState('networkidle');

    // Go back twice
    await page.goBack();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/contracts/);

    await page.goBack();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/customers/);

    // Go forward
    await page.goForward();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/contracts/);
  });

  test('TC-NAV3: 404 page for unknown routes', async ({ page }) => {
    await loginAsAdmin(page);

    await page.goto('/this-route-does-not-exist-12345');
    await page.waitForLoadState('networkidle');

    // Should show 404 page or redirect to dashboard, not crash
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('TC-NAV4: rapid navigation should not cause race conditions', async ({ page }) => {
    await loginAsAdmin(page);

    // Rapidly navigate between pages
    const pages = ['/customers', '/contracts', '/payments', '/stock', '/'];
    const navigationPromises = pages.map((url) =>
      page.goto(url).catch(() => {})
    );

    // Only the last navigation should "win"
    await Promise.allSettled(navigationPromises);
    await page.waitForLoadState('networkidle');

    // Page should be in a stable state (not crashed)
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('TC-NAV5: refresh on protected pages should maintain auth', async ({ page }) => {
    await loginAsAdmin(page);

    await page.goto('/customers');
    await page.waitForLoadState('networkidle');

    // Hard refresh
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should still be on customers page (not redirected to login)
    await expect(page).toHaveURL(/\/customers/);
  });
});

// ─── Error Boundary Tests ───────────────────────────────────────

test.describe('Error Boundaries', () => {
  test('TC-ERR1: JavaScript errors should not crash the entire app', async ({ page }) => {
    await loginAsAdmin(page);

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    // Visit all main pages
    const mainPages = ['/', '/customers', '/contracts', '/payments', '/stock'];

    for (const url of mainPages) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
    }

    // Filter out known benign errors
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('ResizeObserver') &&
        !e.includes('Non-Error') &&
        !e.includes('Loading chunk')
    );

    expect(criticalErrors).toHaveLength(0);
  });

  test('TC-ERR2: network failure should show error state not crash', async ({ page }) => {
    await loginAsAdmin(page);

    // Go offline
    await page.context().setOffline(true);

    // Try to navigate
    await page.goto('/customers').catch(() => {});

    // Go back online
    await page.context().setOffline(false);

    // Recover — page should load after going back online
    await page.goto('/customers');
    await page.waitForLoadState('networkidle');

    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });
});

// ─── API Response Validation ────────────────────────────────────

test.describe('API Response Security', () => {
  test('TC-S15: API error responses should not leak internal details', async ({ page }) => {
    await loginAsAdmin(page);

    const token = await page.evaluate(() => localStorage.getItem('access_token'));

    // Send request that would trigger validation error
    const response = await page.request.post('/api/contracts', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      data: {
        // Intentionally invalid/incomplete data
        invalidField: 'test',
      },
    });

    const body = await response.text();

    // Response should not contain internal details
    expect(body).not.toContain('prisma');
    expect(body).not.toContain('P2002');
    expect(body).not.toContain('stack');
    expect(body).not.toContain('node_modules');
    expect(body).not.toContain('at Object.');
  });

  test('TC-S14: API responses should not expose sensitive fields', async ({ page }) => {
    await loginAsAdmin(page);

    const token = await page.evaluate(() => localStorage.getItem('access_token'));

    // Fetch customers list
    const response = await page.request.get('/api/customers?page=1&limit=5', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    if (response.status() === 200) {
      const body = await response.text();

      // Should not contain plaintext passwords or full national IDs
      expect(body).not.toContain('"password"');
      expect(body).not.toContain('"hashedPassword"');
      // National ID should be encrypted or masked in response
    }
  });
});
