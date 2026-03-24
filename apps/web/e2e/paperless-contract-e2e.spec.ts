import { test, expect } from '@playwright/test';
import { loginViaAPI, getAuthHeaders } from './helpers/auth';

/**
 * Paperless Contract System — Comprehensive E2E Audit Tests
 *
 * ครอบคลุม: Contract Creation → Workflow → Signing Wizard → Customer Access → Security → Documents
 */

// Helper: ดึงสัญญาตัวแรกตาม filter
async function getFirstContract(page: import('@playwright/test').Page, filter = '') {
  const res = await page.request.get(`/api/contracts?limit=1${filter ? '&' + filter : ''}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok()) return null;
  const data = await res.json();
  const contracts = data.data || data.contracts || data;
  if (!Array.isArray(contracts) || contracts.length === 0) return null;
  return contracts[0];
}

test.describe('Paperless Contract — Full E2E Audit', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  // ═══════════════════════════════════════════════════════════════
  // A. Contract Creation Flow
  // ═══════════════════════════════════════════════════════════════
  test.describe('A. Contract Creation Flow', () => {
    test('A1: เข้าหน้าสร้างสัญญาได้', async ({ page }) => {
      await page.goto('/contracts/create', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('body')).toContainText(/สร้างสัญญา|สัญญาใหม่|create/i, { timeout: 10000 });
    });

    test('A2: หน้าสร้างมี steps หรือ form sections', async ({ page }) => {
      await page.goto('/contracts/create', { waitUntil: 'domcontentloaded' });
      // Should show multi-step form (product, customer, plan)
      await expect(page.locator('body')).toContainText(/สินค้า|ลูกค้า|แผนผ่อน|product|customer|plan/i, { timeout: 10000 });
    });

    test('A3: API contracts endpoint ทำงาน', async ({ page }) => {
      const res = await page.request.get('/api/contracts?limit=1', {
        headers: getAuthHeaders(),
      });
      expect(res.ok()).toBeTruthy();
      const data = await res.json();
      expect(data).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // B. Contract Workflow (State Transitions)
  // ═══════════════════════════════════════════════════════════════
  test.describe('B. Contract Workflow', () => {
    test('B1: สัญญา CREATING แสดงปุ่ม workflow', async ({ page }) => {
      const contract = await getFirstContract(page, 'workflowStatus=CREATING');
      if (!contract) { test.skip(); return; }

      await page.goto(`/contracts/${contract.id}`, { waitUntil: 'domcontentloaded' });
      // Should see signing or submit-review button
      const actionButton = page.locator('button, a').filter({
        hasText: /เซ็น|ลงนาม|ส่งตรวจ|sign|submit/i,
      }).first();
      await expect(actionButton).toBeVisible({ timeout: 10000 });
    });

    test('B2: สัญญา PENDING_REVIEW แสดงปุ่ม approve/reject', async ({ page }) => {
      const contract = await getFirstContract(page, 'workflowStatus=PENDING_REVIEW');
      if (!contract) { test.skip(); return; }

      await page.goto(`/contracts/${contract.id}`, { waitUntil: 'domcontentloaded' });
      const approveButton = page.locator('button').filter({
        hasText: /อนุมัติ|approve/i,
      }).first();
      await expect(approveButton).toBeVisible({ timeout: 10000 });
    });

    test('B3: API submit-review validates ก่อนส่ง', async ({ page }) => {
      const contract = await getFirstContract(page, 'workflowStatus=CREATING');
      if (!contract) { test.skip(); return; }

      const res = await page.request.post(`/api/contracts/${contract.id}/submit-review`, {
        headers: getAuthHeaders(),
      });
      // Should be 400 (incomplete) or 200 (complete) — not 500
      expect([200, 400, 403]).toContain(res.status());
    });

    test('B4: Activate สัญญาที่ไม่ APPROVED → 400', async ({ page }) => {
      const contract = await getFirstContract(page, 'workflowStatus=CREATING');
      if (!contract) { test.skip(); return; }

      const res = await page.request.post(`/api/contracts/${contract.id}/activate`, {
        headers: getAuthHeaders(),
      });
      // CREATING cannot be activated → should fail
      expect([400, 403]).toContain(res.status());
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // C. Signing Wizard — Full Flow
  // ═══════════════════════════════════════════════════════════════
  test.describe('C. Signing Wizard', () => {
    test('C1: เข้าหน้า sign แสดง wizard steps', async ({ page }) => {
      const contract = await getFirstContract(page, 'workflowStatus=CREATING');
      if (!contract) { test.skip(); return; }

      await page.goto(`/contracts/${contract.id}/sign`, { waitUntil: 'domcontentloaded' });
      // Should show step labels (ยืนยันตัวตน, PDPA, อ่านสัญญา, เซ็นสัญญา, สำเร็จ)
      await expect(page.locator('body')).toContainText(/ยืนยันตัวตน|KYC/i, { timeout: 10000 });
    });

    test('C2: Step 1 KYC — แสดง OTP form หรือ verification UI', async ({ page }) => {
      const contract = await getFirstContract(page, 'workflowStatus=CREATING');
      if (!contract) { test.skip(); return; }

      await page.goto(`/contracts/${contract.id}/sign`, { waitUntil: 'domcontentloaded' });
      // KYC step should show OTP or verification elements
      await expect(page.locator('body')).toContainText(/OTP|ยืนยัน|ตัวตน|SMS|LINE/i, { timeout: 10000 });
    });

    test('C3: KYC status API ทำงาน', async ({ page }) => {
      const contract = await getFirstContract(page);
      if (!contract) { test.skip(); return; }

      const res = await page.request.get(`/api/contracts/${contract.id}/kyc/status`, {
        headers: getAuthHeaders(),
      });
      expect(res.ok()).toBeTruthy();
      const data = await res.json();
      expect(data).toBeDefined();
    });

    test('C4: Signatures API returns array', async ({ page }) => {
      const contract = await getFirstContract(page);
      if (!contract) { test.skip(); return; }

      const res = await page.request.get(`/api/contracts/${contract.id}/signatures`, {
        headers: getAuthHeaders(),
      });
      expect(res.ok()).toBeTruthy();
      const sigs = await res.json();
      expect(Array.isArray(sigs)).toBeTruthy();
    });

    test('C5: Contract preview returns HTML', async ({ page }) => {
      const contract = await getFirstContract(page);
      if (!contract) { test.skip(); return; }

      const res = await page.request.get(`/api/contracts/${contract.id}/preview`, {
        headers: getAuthHeaders(),
      });
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.html).toBeDefined();
      expect(body.html).toContain('<');
    });

    test('C6: PDPA consent status อยู่ใน contract detail', async ({ page }) => {
      const contract = await getFirstContract(page);
      if (!contract) { test.skip(); return; }

      const res = await page.request.get(`/api/contracts/${contract.id}`, {
        headers: getAuthHeaders(),
      });
      expect(res.ok()).toBeTruthy();
      const data = await res.json();
      expect('pdpaConsentId' in data).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // D. Customer Access Portal
  // ═══════════════════════════════════════════════════════════════
  test.describe('D. Customer Access Portal', () => {
    test('D1: customer-link API สร้าง token ได้', async ({ page }) => {
      const contract = await getFirstContract(page);
      if (!contract) { test.skip(); return; }

      const res = await page.request.post(`/api/contracts/${contract.id}/customer-link`, {
        headers: getAuthHeaders(),
      });
      expect(res.ok()).toBeTruthy();
      const data = await res.json();
      expect(data.token).toBeDefined();
      expect(data.expiresAt).toBeDefined();
      expect(data.token.length).toBeGreaterThanOrEqual(32);
    });

    test('D2: valid token เข้าถึง customer-access ได้', async ({ page }) => {
      const contract = await getFirstContract(page);
      if (!contract) { test.skip(); return; }

      // Generate token
      const tokenRes = await page.request.post(`/api/contracts/${contract.id}/customer-link`, {
        headers: getAuthHeaders(),
      });
      if (!tokenRes.ok()) { test.skip(); return; }
      const { token } = await tokenRes.json();

      // Access documents
      const docRes = await page.request.get(`/api/customer-access/${token}`, {
        headers: getAuthHeaders(),
      });
      expect(docRes.ok()).toBeTruthy();
      const data = await docRes.json();
      expect(data.contractNumber).toBeDefined();
      expect(data.customerName).toBeDefined();
      expect(data.payments).toBeDefined();
    });

    test('D3: invalid token → 404', async ({ page }) => {
      const res = await page.request.get('/api/customer-access/invalid-token-abc123', {
        headers: getAuthHeaders(),
      });
      expect(res.status()).toBe(404);
    });

    test('D4: Customer Portal page loads with token', async ({ page }) => {
      const contract = await getFirstContract(page);
      if (!contract) { test.skip(); return; }

      // Generate token
      const tokenRes = await page.request.post(`/api/contracts/${contract.id}/customer-link`, {
        headers: getAuthHeaders(),
      });
      if (!tokenRes.ok()) { test.skip(); return; }
      const { token } = await tokenRes.json();

      // Navigate to customer portal
      await page.goto(`/customer-access/${token}`, { waitUntil: 'networkidle' });
      // Should display contract info (not blank or error)
      const body = await page.locator('body').textContent();
      expect(body?.length).toBeGreaterThan(10);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // E. Security Edge Cases
  // ═══════════════════════════════════════════════════════════════
  test.describe('E. Security Edge Cases', () => {
    test('E1: Duplicate signing → 400', async ({ page }) => {
      const contract = await getFirstContract(page, 'workflowStatus=CREATING');
      if (!contract) { test.skip(); return; }

      // Get existing signatures
      const sigRes = await page.request.get(`/api/contracts/${contract.id}/signatures`, {
        headers: getAuthHeaders(),
      });
      const sigs = await sigRes.json();
      if (!Array.isArray(sigs) || sigs.length === 0) { test.skip(); return; }

      // Try to sign again with same type → should fail
      const existingType = sigs[0].signerType;
      const res = await page.request.post(`/api/contracts/${contract.id}/sign`, {
        headers: getAuthHeaders(),
        data: {
          signatureImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
          signerType: existingType,
          signerName: 'Test Duplicate',
        },
      });
      expect(res.status()).toBe(400);
    });

    test('E2: Sign with invalid signer type → 400', async ({ page }) => {
      const contract = await getFirstContract(page);
      if (!contract) { test.skip(); return; }

      const res = await page.request.post(`/api/contracts/${contract.id}/sign`, {
        headers: getAuthHeaders(),
        data: {
          signatureImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
          signerType: 'INVALID_TYPE',
        },
      });
      expect(res.ok()).toBeFalsy();
    });

    test('E3: Delete signed contract → 400', async ({ page }) => {
      // Find an ACTIVE contract (should not be deletable)
      const contract = await getFirstContract(page, 'status=ACTIVE');
      if (!contract) { test.skip(); return; }

      const res = await page.request.delete(`/api/contracts/${contract.id}`, {
        headers: getAuthHeaders(),
      });
      expect([400, 403]).toContain(res.status());
    });

    test('E4: Sign on non-existent contract → 404', async ({ page }) => {
      const res = await page.request.post('/api/contracts/nonexistent-id-999/sign', {
        headers: getAuthHeaders(),
        data: {
          signatureImage: 'data:image/png;base64,test',
          signerType: 'CUSTOMER',
        },
      });
      expect([404, 400, 401]).toContain(res.status());
    });

    test('E5: Unauthenticated API access → 401', async ({ page }) => {
      // Clear auth
      await page.evaluate(() => localStorage.removeItem('access_token'));

      const res = await page.request.get('/api/contracts', {
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Authorization': '' },
      });
      expect(res.status()).toBe(401);
    });

    test('E6: PDPA consent ไม่มี signature → 400', async ({ page }) => {
      const contract = await getFirstContract(page, 'workflowStatus=CREATING');
      if (!contract) { test.skip(); return; }

      const res = await page.request.post(`/api/contracts/${contract.id}/pdpa-consent`, {
        headers: getAuthHeaders(),
        data: { signatureImage: '' },
      });
      expect(res.ok()).toBeFalsy();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // F. Document Generation & Preview
  // ═══════════════════════════════════════════════════════════════
  test.describe('F. Document Generation', () => {
    test('F1: Contract documents API ทำงาน', async ({ page }) => {
      const contract = await getFirstContract(page);
      if (!contract) { test.skip(); return; }

      const res = await page.request.get(`/api/contracts/${contract.id}/documents`, {
        headers: getAuthHeaders(),
      });
      expect(res.ok()).toBeTruthy();
      const docs = await res.json();
      expect(Array.isArray(docs)).toBeTruthy();
    });

    test('F2: PDPA consent GET endpoint ทำงาน', async ({ page }) => {
      const contract = await getFirstContract(page);
      if (!contract) { test.skip(); return; }

      const res = await page.request.get(`/api/contracts/${contract.id}/pdpa-consent`, {
        headers: getAuthHeaders(),
      });
      // 200 (has consent) or 404 (no consent yet) — not 500
      expect([200, 404]).toContain(res.status());
    });

    test('F3: Contract templates API ทำงาน', async ({ page }) => {
      const res = await page.request.get('/api/contract-templates', {
        headers: getAuthHeaders(),
      });
      expect(res.ok()).toBeTruthy();
      const templates = await res.json();
      expect(Array.isArray(templates)).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // G. Missing Feature Gaps Verification
  // ═══════════════════════════════════════════════════════════════
  test.describe('G. Missing Feature Gap Verification', () => {
    test('G1: validate endpoint ทำงาน', async ({ page }) => {
      const contract = await getFirstContract(page);
      if (!contract) { test.skip(); return; }

      const res = await page.request.get(`/api/contracts/${contract.id}/validate`, {
        headers: getAuthHeaders(),
      });
      expect(res.ok()).toBeTruthy();
      const data = await res.json();
      expect(data).toBeDefined();
    });

    test('G2: schedule endpoint ทำงาน', async ({ page }) => {
      const contract = await getFirstContract(page);
      if (!contract) { test.skip(); return; }

      const res = await page.request.get(`/api/contracts/${contract.id}/schedule`, {
        headers: getAuthHeaders(),
      });
      expect(res.ok()).toBeTruthy();
    });

    test('G3: qr-data endpoint ทำงาน', async ({ page }) => {
      const contract = await getFirstContract(page);
      if (!contract) { test.skip(); return; }

      const res = await page.request.get(`/api/contracts/${contract.id}/qr-data`, {
        headers: getAuthHeaders(),
      });
      expect(res.ok()).toBeTruthy();
      const data = await res.json();
      expect(data).toBeDefined();
    });

    test('G4: delete signature endpoint ทำงาน (validation check)', async ({ page }) => {
      // Should reject invalid signer type
      const contract = await getFirstContract(page);
      if (!contract) { test.skip(); return; }

      const res = await page.request.delete(`/api/contracts/${contract.id}/signatures/NONEXISTENT`, {
        headers: getAuthHeaders(),
      });
      // 404 (signature not found) or 400 (not DRAFT) — not 500
      expect([400, 404]).toContain(res.status());
    });

    test('G5: early-payoff-quote endpoint ทำงาน', async ({ page }) => {
      const contract = await getFirstContract(page, 'status=ACTIVE');
      if (!contract) { test.skip(); return; }

      const res = await page.request.get(`/api/contracts/${contract.id}/early-payoff-quote`, {
        headers: getAuthHeaders(),
      });
      // 200 or 400 (if not eligible) — not 500
      expect([200, 400]).toContain(res.status());
    });

    test('G6: document-dashboard endpoint ทำงาน', async ({ page }) => {
      const res = await page.request.get('/api/contracts/document-dashboard', {
        headers: getAuthHeaders(),
      });
      expect(res.ok()).toBeTruthy();
    });
  });
});
