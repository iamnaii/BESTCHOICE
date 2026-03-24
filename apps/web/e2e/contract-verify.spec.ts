import { test, expect, Page } from '@playwright/test';

// ============================================================================
// BESTCHOICE Contract Verify Page (Phase 17)
// Route: /contracts/:id?hash=xxx
//
// Public page (no auth needed) for verifying contract authenticity via QR code
//
// Tests:
//   - Loading state
//   - Verified (green) state with contract details + signatures
//   - Verification failed (red) state with reason
//   - API error state
//   - Contract details display (all fields)
//   - Hash display
// ============================================================================

const VERIFY_SUCCESS = {
  verified: true,
  reason: 'สัญญานี้ได้รับการยืนยันแล้ว ลายเซ็นครบถ้วน',
  contract: {
    contractNumber: 'BCP-VRF-001',
    status: 'ACTIVE',
    workflowStatus: 'APPROVED',
    customerName: 'สมชาย ใจดี',
    branchName: 'สาขาหลัก',
    createdAt: '2026-01-15T10:00:00.000Z',
    totalMonths: 10,
    monthlyPayment: 1320,
  },
  signatures: [
    { type: 'ผู้ซื้อ', name: 'สมชาย ใจดี', signedAt: '2026-01-15T10:00:00.000Z' },
    { type: 'ผู้ขาย', name: 'Admin', signedAt: '2026-01-15T10:30:00.000Z' },
    { type: 'พยาน 1', name: 'พยาน หนึ่ง', signedAt: '2026-01-15T11:00:00.000Z' },
    { type: 'พยาน 2', name: 'พยาน สอง', signedAt: '2026-01-15T11:30:00.000Z' },
  ],
  hash: 'abc123def456789abcdef0123456789abcdef0123456789abcdef0123456789',
};

const VERIFY_FAILED = {
  verified: false,
  reason: 'ลายเซ็นไม่ตรงกับข้อมูลสัญญา อาจมีการแก้ไขเอกสาร',
  contract: {
    contractNumber: 'BCP-VRF-002',
    status: 'ACTIVE',
    workflowStatus: 'APPROVED',
    customerName: 'ทดสอบ ลูกค้า',
    branchName: 'สาขาย่อย',
    createdAt: '2026-02-01T10:00:00.000Z',
    totalMonths: 6,
    monthlyPayment: 2000,
  },
  signatures: [],
  hash: 'invalid_hash_value_123',
};

async function mockVerifyApi(page: Page, contractId: string, response: object | null, statusCode = 200) {
  await page.route(`**/api/contracts/${contractId}/verify**`, async (route) => {
    if (statusCode >= 400) {
      await route.fulfill({ status: statusCode, contentType: 'application/json', body: JSON.stringify({ message: 'Error' }) });
    } else {
      await route.fulfill({ status: statusCode, contentType: 'application/json', body: JSON.stringify(response) });
    }
  });
}

test.describe('Phase 17: Contract Verify Page', () => {
  // ── 17.1 Logo and branding displays ─────────────────────────────────
  test('17.1 Verify page shows BESTCHOICE logo and branding', async ({ page }) => {
    await mockVerifyApi(page, 'vrf-001', VERIFY_SUCCESS);
    await page.goto('/verify/vrf-001?hash=abc123', { waitUntil: 'networkidle' });

    await expect(page.getByText('BESTCHOICE')).toBeVisible({ timeout: 5000 });
  });

  // ── 17.2 Verified contract shows green success ──────────────────────
  test('17.2 Verified contract shows สัญญาถูกต้อง with green indicator', async ({ page }) => {
    await mockVerifyApi(page, 'vrf-002', VERIFY_SUCCESS);
    await page.goto('/verify/vrf-002?hash=abc123', { waitUntil: 'networkidle' });

    await expect(page.getByText('สัญญาถูกต้อง')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('สัญญานี้ได้รับการยืนยันแล้ว ลายเซ็นครบถ้วน')).toBeVisible();
  });

  // ── 17.3 Contract details show all fields ───────────────────────────
  test('17.3 Contract details show all fields correctly', async ({ page }) => {
    await mockVerifyApi(page, 'vrf-003', VERIFY_SUCCESS);
    await page.goto('/verify/vrf-003?hash=abc123', { waitUntil: 'networkidle' });

    await expect(page.getByText('รายละเอียดสัญญา')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('BCP-VRF-001')).toBeVisible();
    await expect(page.getByText('สมชาย ใจดี').first()).toBeVisible();
    await expect(page.getByText('สาขาหลัก').first()).toBeVisible();
    await expect(page.getByText('10 เดือน')).toBeVisible();
  });

  // ── 17.4 Signatures section shows all signers ──────────────────────
  test('17.4 Signatures section shows all 4 signers', async ({ page }) => {
    await mockVerifyApi(page, 'vrf-004', VERIFY_SUCCESS);
    await page.goto('/verify/vrf-004?hash=abc123', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'ลายเซ็น' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('ผู้ซื้อ')).toBeVisible();
    await expect(page.getByText('ผู้ขาย')).toBeVisible();
    await expect(page.getByText('พยาน 1')).toBeVisible();
    await expect(page.getByText('พยาน 2')).toBeVisible();
  });

  // ── 17.5 Hash displays in monospace ────────────────────────────────
  test('17.5 Verification hash displays correctly', async ({ page }) => {
    await mockVerifyApi(page, 'vrf-005', VERIFY_SUCCESS);
    await page.goto('/verify/vrf-005?hash=abc123', { waitUntil: 'networkidle' });

    await expect(page.getByText('Hash')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.font-mono').filter({ hasText: 'abc123def456789' })).toBeVisible();
  });

  // ── 17.6 Failed verification shows red indicator ───────────────────
  test('17.6 Failed verification shows ไม่สามารถยืนยันสัญญา', async ({ page }) => {
    await mockVerifyApi(page, 'vrf-006', VERIFY_FAILED);
    await page.goto('/verify/vrf-006?hash=badhash', { waitUntil: 'networkidle' });

    await expect(page.getByText('ไม่สามารถยืนยันสัญญา')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('ลายเซ็นไม่ตรงกับข้อมูลสัญญา')).toBeVisible();
  });

  // ── 17.7 API error shows error state ───────────────────────────────
  test('17.7 API error shows เกิดข้อผิดพลาด message', async ({ page }) => {
    await mockVerifyApi(page, 'vrf-007', null, 500);
    await page.goto('/verify/vrf-007?hash=abc', { waitUntil: 'networkidle' });

    await expect(page.getByText('เกิดข้อผิดพลาด')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('ไม่สามารถตรวจสอบสัญญาได้ กรุณาลองใหม่')).toBeVisible();
  });

  // ── 17.8 Loading state shows spinner ───────────────────────────────
  test('17.8 Loading state shows กำลังตรวจสอบสัญญา spinner', async ({ page }) => {
    // Delay response to capture loading state
    await page.route('**/api/contracts/vrf-008/verify**', async (route) => {
      await new Promise(r => setTimeout(r, 3000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VERIFY_SUCCESS) });
    });

    await page.goto('/verify/vrf-008?hash=abc', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('กำลังตรวจสอบสัญญา...')).toBeVisible({ timeout: 3000 });
  });

  // ── 17.9 Failed verify still shows contract details ────────────────
  test('17.9 Failed verify still shows contract details section', async ({ page }) => {
    await mockVerifyApi(page, 'vrf-009', VERIFY_FAILED);
    await page.goto('/verify/vrf-009?hash=bad', { waitUntil: 'networkidle' });

    await expect(page.getByText('BCP-VRF-002')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('ทดสอบ ลูกค้า')).toBeVisible();
    await expect(page.getByText('6 เดือน')).toBeVisible();
  });
});
