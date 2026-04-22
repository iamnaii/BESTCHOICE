import { test, expect, Route } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';
import { gotoWithRetry } from './helpers/navigation';

// Smallest valid PDF (~250 bytes) — "%PDF-1.1" + empty catalog
const MINIMAL_PDF_BYTES = Buffer.from(
  `%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000052 00000 n
0000000099 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
148
%%EOF`,
  'utf-8',
);

// 1x1 transparent PNG
const TINY_PNG_BYTES = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C626000000000050001A5F645400000000049454E44AE426082',
  'hex',
);

test.describe('Customer Intake — PDF/image upload fix verification', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('uploading PDF triggers OCR with filesBase64 array (not imageBase64)', async ({ page }) => {
    let capturedRequestBody: Record<string, unknown> | null = null;

    // Intercept OCR endpoint — capture request body and return fake success
    await page.route('**/ocr/bank-statement', async (route: Route) => {
      const postData = route.request().postDataJSON();
      capturedRequestBody = postData;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accountName: 'Test User',
          bankName: 'กสิกรไทย',
          totalIncome: 50000,
          totalExpense: 30000,
          balance: 20000,
          transactionCount: 50,
          dateRange: '01/01/2026 - 31/03/2026',
          confidence: 0.95,
        }),
      });
    });

    const ok = await gotoWithRetry(page, '/customer-intake');
    if (!ok) test.skip();

    // Step 1: fill quick intake form
    await page.getByText(/ข้อมูลเบื้องต้น/).first().waitFor({ timeout: 15000 });
    const inputs = page.locator('input');
    // Based on QuickIntakeStep.tsx field order: firstName, lastName, nationalId, phone
    await inputs.nth(0).fill('ทดสอบ');
    await inputs.nth(1).fill('ทดสอบสกุล');
    await inputs.nth(2).fill('1234567890123');
    await inputs.nth(3).fill('0812345678');

    await page.getByRole('button', { name: /ถัดไป.*เช็คเครดิต/ }).click();

    // Step 2: upload a PDF file
    await page.getByText(/Statement ธนาคาร/).waitFor({ timeout: 10000 });

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'statement.pdf',
      mimeType: 'application/pdf',
      buffer: MINIMAL_PDF_BYTES,
    });

    // Wait for OCR request to complete
    await page.waitForResponse('**/ocr/bank-statement', { timeout: 10000 });

    // VERIFY 1: Request body shape — must be filesBase64 array
    expect(capturedRequestBody).not.toBeNull();
    expect(capturedRequestBody).toHaveProperty('filesBase64');
    expect(capturedRequestBody).not.toHaveProperty('imageBase64');
    const body = capturedRequestBody as { filesBase64: string[] };
    expect(Array.isArray(body.filesBase64)).toBe(true);
    expect(body.filesBase64.length).toBe(1);

    // VERIFY 2: PDF data URL prefix (not image — proves PDF is sent as-is)
    expect(body.filesBase64[0]).toMatch(/^data:application\/pdf;base64,/);

    // VERIFY 3: UI shows bankName from OCR result
    const bankInput = page.getByPlaceholder(/จะแสดง|กำลังอ่าน|อ่านไม่ได้/);
    await expect(bankInput).toHaveValue('กสิกรไทย', { timeout: 5000 });

    // VERIFY 4: submit button is enabled
    const submitBtn = page.getByRole('button', { name: /เริ่มเช็คเครดิต/ });
    await expect(submitBtn).toBeEnabled();
  });

  test('uploading image triggers OCR with filesBase64 array (compressed JPEG)', async ({ page }) => {
    let capturedRequestBody: Record<string, unknown> | null = null;

    await page.route('**/ocr/bank-statement', async (route: Route) => {
      capturedRequestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accountName: null,
          bankName: 'ไทยพาณิชย์',
          totalIncome: null,
          totalExpense: null,
          balance: null,
          transactionCount: null,
          dateRange: null,
          confidence: 0.85,
        }),
      });
    });

    const ok = await gotoWithRetry(page, '/customer-intake');
    if (!ok) test.skip();

    await page.getByText(/ข้อมูลเบื้องต้น/).first().waitFor({ timeout: 15000 });
    const inputs = page.locator('input');
    await inputs.nth(0).fill('ทดสอบ');
    await inputs.nth(1).fill('ทดสอบสกุล');
    await inputs.nth(2).fill('1234567890123');
    await inputs.nth(3).fill('0812345678');
    await page.getByRole('button', { name: /ถัดไป.*เช็คเครดิต/ }).click();

    await page.getByText(/Statement ธนาคาร/).waitFor({ timeout: 10000 });

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'statement.png',
      mimeType: 'image/png',
      buffer: TINY_PNG_BYTES,
    });

    await page.waitForResponse('**/ocr/bank-statement', { timeout: 10000 });

    expect(capturedRequestBody).toHaveProperty('filesBase64');
    const body = capturedRequestBody as { filesBase64: string[] };
    expect(Array.isArray(body.filesBase64)).toBe(true);
    // Image goes through compressImageForOcr → output is JPEG
    expect(body.filesBase64[0]).toMatch(/^data:image\/(jpeg|png);base64,/);

    const bankInput = page.getByPlaceholder(/จะแสดง|กำลังอ่าน|อ่านไม่ได้/);
    await expect(bankInput).toHaveValue('ไทยพาณิชย์', { timeout: 5000 });
  });

  test('when OCR returns no bankName, input is editable so user can type', async ({ page }) => {
    await page.route('**/ocr/bank-statement', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          accountName: null,
          bankName: null, // OCR failed to detect bank
          totalIncome: null,
          totalExpense: null,
          balance: null,
          transactionCount: null,
          dateRange: null,
          confidence: 0.3,
        }),
      });
    });

    const ok = await gotoWithRetry(page, '/customer-intake');
    if (!ok) test.skip();

    await page.getByText(/ข้อมูลเบื้องต้น/).first().waitFor({ timeout: 15000 });
    const inputs = page.locator('input');
    await inputs.nth(0).fill('ทดสอบ');
    await inputs.nth(1).fill('ทดสอบสกุล');
    await inputs.nth(2).fill('1234567890123');
    await inputs.nth(3).fill('0812345678');
    await page.getByRole('button', { name: /ถัดไป.*เช็คเครดิต/ }).click();

    await page.getByText(/Statement ธนาคาร/).waitFor({ timeout: 10000 });

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'statement.pdf',
      mimeType: 'application/pdf',
      buffer: MINIMAL_PDF_BYTES,
    });

    await page.waitForResponse('**/ocr/bank-statement', { timeout: 10000 });

    // Bank input should NOT be readOnly — user must be able to type
    const bankInput = page.getByPlaceholder(/อ่านไม่ได้.*พิมพ์ชื่อธนาคาร/);
    await expect(bankInput).toBeVisible({ timeout: 5000 });
    await expect(bankInput).toBeEditable();

    // Type manually
    await bankInput.fill('กรุงเทพ');
    await expect(bankInput).toHaveValue('กรุงเทพ');

    // Submit should now be enabled
    const submitBtn = page.getByRole('button', { name: /เริ่มเช็คเครดิต/ });
    await expect(submitBtn).toBeEnabled();
  });
});
