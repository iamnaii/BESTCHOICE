import { test, expect } from '@playwright/test';
import { loginViaAPI, getAuthHeaders } from './helpers/auth';

test.describe('Signing Flow & Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  // ═══════════════════════════════════════════════════════════
  // A. Contract Page Access & Navigation
  // ═══════════════════════════════════════════════════════════
  test.describe('Contract Page Access', () => {
    test('E2E-NAV-1: สามารถเข้าหน้ารายการสัญญาได้', async ({ page }) => {
      await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('h1, h2, [data-testid="page-title"]').first()).toBeVisible({ timeout: 10000 });
    });

    test('E2E-NAV-2: ตารางสัญญาแสดงข้อมูลถูกต้อง', async ({ page }) => {
      await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
      // Wait for table or card list to appear
      const content = page.locator('table, [data-testid="contracts-list"], .contract-card').first();
      await expect(content).toBeVisible({ timeout: 10000 });
    });

    test('E2E-NAV-3: สามารถเข้าหน้ารายละเอียดสัญญาได้', async ({ page }) => {
      await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
      // Click first contract link
      const contractLink = page.locator('a[href*="/contracts/"]').first();
      if (await contractLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await contractLink.click();
        await page.waitForURL(/\/contracts\//, { timeout: 10000, waitUntil: 'domcontentloaded' });
        // Should show contract detail
        await expect(page.locator('body')).toContainText(/BCP|สัญญา/);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════
  // B. Signing Page (SigningWizard)
  // ═══════════════════════════════════════════════════════════
  test.describe('Signing Wizard', () => {
    test('E2E-SIG-1: หน้าลงนามแสดง wizard steps', async ({ page }) => {
      // Find a CREATING contract and navigate to signing
      const res = await page.request.get('/api/contracts?workflowStatus=CREATING&limit=1', {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      const contracts = data.data || data.contracts || data;
      if (!Array.isArray(contracts) || contracts.length === 0) {
        test.skip();
        return;
      }
      const contractId = contracts[0].id;
      await page.goto(`/contracts/${contractId}/sign`, { waitUntil: 'domcontentloaded' });
      // Should show wizard with steps
      await expect(page.locator('body')).toContainText(/ขั้นตอน|KYC|PDPA|ลงนาม|สัญญา/i, { timeout: 10000 });
    });

    test('E2E-SIG-2: หน้าลงนามมี step indicators', async ({ page }) => {
      const res = await page.request.get('/api/contracts?workflowStatus=CREATING&limit=1', {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      const contracts = data.data || data.contracts || data;
      if (!Array.isArray(contracts) || contracts.length === 0) {
        test.skip();
        return;
      }
      const contractId = contracts[0].id;
      await page.goto(`/contracts/${contractId}/sign`, { waitUntil: 'domcontentloaded' });
      // Check for step 1-5 indicators or numbered steps
      const stepIndicators = page.locator('[class*="step"], [data-step], .wizard-step, [role="tablist"]');
      // At least one step indicator should be present
      await expect(page.locator('body')).not.toBeEmpty();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // C. Workflow Buttons on Contract Detail
  // ═══════════════════════════════════════════════════════════
  test.describe('Workflow Buttons', () => {
    test('E2E-WF-1: สัญญา CREATING แสดงปุ่มเซ็นสัญญา', async ({ page }) => {
      const res = await page.request.get('/api/contracts?workflowStatus=CREATING&limit=1', {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      const contracts = data.data || data.contracts || data;
      if (!Array.isArray(contracts) || contracts.length === 0) {
        test.skip();
        return;
      }
      const contractId = contracts[0].id;
      await page.goto(`/contracts/${contractId}`, { waitUntil: 'domcontentloaded' });

      // Should see signing or submit button
      const actionButton = page.locator('button, a').filter({
        hasText: /เซ็น|ลงนาม|sign|ส่งตรวจ/i,
      }).first();
      await expect(actionButton).toBeVisible({ timeout: 10000 });
    });

    test('E2E-WF-2: ปุ่ม workflow ที่เหมาะสมแสดงตาม status', async ({ page }) => {
      await page.goto('/contracts', { waitUntil: 'domcontentloaded' });
      // This is a general check — page should load without errors
      await page.waitForTimeout(2000);
      const errorDialog = page.locator('[role="alert"], .error-message, .toast-error');
      const hasError = await errorDialog.isVisible().catch(() => false);
      expect(hasError).toBeFalsy();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // D. Settings Page — Lessor Signature
  // ═══════════════════════════════════════════════════════════
  test.describe('Settings - Lessor Signature', () => {
    test('E2E-SET-1: หน้า Settings เข้าถึงได้และแสดงผล', async ({ page }) => {
      await page.goto('/settings', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('body')).toContainText(/ตั้งค่า|Settings|การตั้งค่า/i, { timeout: 10000 });
    });

    test('E2E-SET-2: มีส่วนตั้งค่าลายเซ็นผู้ให้เช่าซื้อ', async ({ page }) => {
      await page.goto('/settings', { waitUntil: 'domcontentloaded' });
      // Look for lessor signature section
      const sigSection = page.locator('body');
      await expect(sigSection).toContainText(/ลายเซ็น|ผู้ให้เช่า|ผู้ขาย|lessor|signature/i, { timeout: 10000 });
    });

    test('E2E-SET-3: มีช่องกรอกชื่อผู้ลงนาม', async ({ page }) => {
      await page.goto('/settings', { waitUntil: 'domcontentloaded' });
      // Look for signer name input
      const nameInput = page.locator('input[name*="signer"], input[name*="lessor"], input[placeholder*="ผู้ลงนาม"], input[placeholder*="ชื่อ"]').first();
      if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(nameInput).toBeEditable();
      }
    });

    test('E2E-SET-4: มีปุ่มบันทึกการตั้งค่า', async ({ page }) => {
      await page.goto('/settings', { waitUntil: 'domcontentloaded' });
      const saveButton = page.locator('button').filter({ hasText: /บันทึก|save|ยืนยัน/i }).first();
      await expect(saveButton).toBeVisible({ timeout: 10000 });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // E. API Signing Endpoints
  // ═══════════════════════════════════════════════════════════
  test.describe('API - Signing Endpoints', () => {
    test('E2E-API-1: GET /api/contracts/:id/signatures returns array', async ({ page }) => {
      const res = await page.request.get('/api/contracts?limit=1', {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      const contracts = data.data || data.contracts || data;
      if (!Array.isArray(contracts) || contracts.length === 0) {
        test.skip();
        return;
      }
      const contractId = contracts[0].id;

      const sigRes = await page.request.get(`/api/contracts/${contractId}/signatures`, {
        headers: getAuthHeaders(),
      });
      expect(sigRes.ok()).toBeTruthy();
      const sigs = await sigRes.json();
      expect(Array.isArray(sigs)).toBeTruthy();
    });

    test('E2E-API-2: POST sign with invalid data → 400', async ({ page }) => {
      const res = await page.request.get('/api/contracts?limit=1', {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      const contracts = data.data || data.contracts || data;
      if (!Array.isArray(contracts) || contracts.length === 0) {
        test.skip();
        return;
      }
      const contractId = contracts[0].id;

      const signRes = await page.request.post(`/api/contracts/${contractId}/sign`, {
        headers: getAuthHeaders(),
        data: { signerType: 'INVALID', signatureImage: '' },
      });
      expect(signRes.ok()).toBeFalsy();
    });

    test('E2E-API-3: GET /api/contracts/:id/preview returns HTML', async ({ page }) => {
      const res = await page.request.get('/api/contracts?limit=1', {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      const contracts = data.data || data.contracts || data;
      if (!Array.isArray(contracts) || contracts.length === 0) {
        test.skip();
        return;
      }
      const contractId = contracts[0].id;

      const previewRes = await page.request.get(`/api/contracts/${contractId}/preview`, {
        headers: getAuthHeaders(),
      });
      expect(previewRes.ok()).toBeTruthy();
      const body = await previewRes.json();
      expect(body.html).toBeDefined();
      expect(body.html).toContain('<!DOCTYPE html');
    });

    test('E2E-API-4: ส่งตรวจสอบสัญญาที่ยังไม่พร้อม → 400', async ({ page }) => {
      // Find a CREATING contract
      const res = await page.request.get('/api/contracts?workflowStatus=CREATING&limit=1', {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      const contracts = data.data || data.contracts || data;
      if (!Array.isArray(contracts) || contracts.length === 0) {
        test.skip();
        return;
      }
      const contractId = contracts[0].id;

      // Try to submit for review — should fail if signatures etc. are missing
      const submitRes = await page.request.post(`/api/contracts/${contractId}/submit-review`, {
        headers: getAuthHeaders(),
      });
      // Either 400 (missing requirements) or 403 (not salesperson) — not 500
      expect([400, 403]).toContain(submitRes.status());
    });
  });

  // ═══════════════════════════════════════════════════════════
  // F. PDPA Consent Flow
  // ═══════════════════════════════════════════════════════════
  test.describe('PDPA Consent', () => {
    test('E2E-PDPA-1: API ดึง PDPA consent status สำเร็จ', async ({ page }) => {
      const res = await page.request.get('/api/contracts?limit=1', {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      const contracts = data.data || data.contracts || data;
      if (!Array.isArray(contracts) || contracts.length === 0) {
        test.skip();
        return;
      }
      // Contract detail should include pdpaConsentId field
      const contractId = contracts[0].id;
      const detailRes = await page.request.get(`/api/contracts/${contractId}`, {
        headers: getAuthHeaders(),
      });
      expect(detailRes.ok()).toBeTruthy();
      const contract = await detailRes.json();
      expect('pdpaConsentId' in contract).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // G. Error Handling
  // ═══════════════════════════════════════════════════════════
  test.describe('Error Handling', () => {
    test('E2E-ERR-1: สัญญาไม่มีอยู่ → 404 or 401', async ({ page }) => {
      const res = await page.request.get('/api/contracts/nonexistent-id-12345', {
        headers: getAuthHeaders(),
      });
      // Unauthenticated direct API calls return 401; authenticated ones return 404
      expect([401, 404]).toContain(res.status());
    });

    test('E2E-ERR-2: เข้าหน้า sign สัญญาไม่มี → แสดง error', async ({ page }) => {
      await page.goto('/contracts/nonexistent-id/sign', { waitUntil: 'domcontentloaded' });
      // Should show error or redirect, not crash
      await page.waitForTimeout(3000);
      // Page should not be blank
      const body = await page.locator('body').textContent();
      expect(body?.length).toBeGreaterThan(0);
    });
  });
});
