import { test, expect } from '@playwright/test';
import { TEST_USER, loginAsAdmin } from '../helpers/auth';
import { StepScreenshot } from '../helpers/screenshot';

/**
 * 01 - Login Flow (Human-Like Interaction)
 *
 * ทดสอบ flow การ login ทั้ง success และ failure
 * Selectors จาก: src/pages/LoginPage.tsx
 * - #email, #password, button[type="submit"]
 * - h2 → "เข้าสู่ระบบ"
 * - [data-sonner-toast] → toast notifications
 * - a[href="/forgot-password"], a[href="/landing"]
 */
test.describe('01 - Login Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test('should display login page correctly', async ({ page }) => {
    const ss = new StepScreenshot(page, '01-login-display');

    // Step 1: เปิดหน้า Login
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await ss.capture('login-page-loaded');

    // Step 2: ตรวจสอบ heading "เข้าสู่ระบบ"
    await expect(page.locator('h2')).toContainText('เข้าสู่ระบบ');
    await ss.capture('heading-verified');

    // Step 3: ตรวจสอบ subtitle
    await expect(page.locator('text=ยินดีต้อนรับกลับมา')).toBeVisible();
    await ss.capture('subtitle-verified');

    // Step 4: ตรวจสอบ form fields ทุกตัว
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    await ss.capture('form-fields-verified');

    // Step 5: ตรวจสอบ links
    await expect(page.locator('a[href="/forgot-password"]')).toBeVisible();
    await expect(page.locator('a[href="/landing"]').first()).toBeVisible();
    await ss.capture('links-verified');

    // Step 6: ตรวจสอบ placeholder text
    await expect(page.locator('#email')).toHaveAttribute('placeholder', 'email@example.com');
    await expect(page.locator('#password')).toHaveAttribute('placeholder', 'รหัสผ่าน');
    await ss.capture('placeholders-verified');
  });

  test('should show validation for empty form submit', async ({ page }) => {
    const ss = new StepScreenshot(page, '01-login-empty-submit');

    // Step 1: เปิดหน้า Login
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await ss.capture('login-page-loaded');

    // Step 2: กดปุ่ม submit โดยไม่กรอกอะไร
    await page.click('button[type="submit"]');
    await ss.capture('after-empty-submit');

    // Step 3: ตรวจสอบ HTML5 validation (email field required)
    const emailInput = page.locator('#email');
    const isInvalid = await emailInput.evaluate(
      (el: HTMLInputElement) => !el.validity.valid
    );
    expect(isInvalid).toBe(true);
    await ss.capture('validation-error-shown');
  });

  test('should show error toast for wrong credentials', async ({ page }) => {
    const ss = new StepScreenshot(page, '01-login-wrong-credentials');

    // Step 1: เปิดหน้า Login
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await ss.capture('login-page-loaded');

    // Step 2: พิมพ์ email ผิด (human-like, ทีละตัว)
    await page.type('#email', 'wrong@email.com', { delay: 30 });
    await ss.capture('typed-wrong-email');

    // Step 3: พิมพ์ password ผิด
    await page.type('#password', 'wrongpassword', { delay: 30 });
    await ss.capture('typed-wrong-password');

    // Step 4: กดปุ่ม "เข้าสู่ระบบ"
    await page.click('button[type="submit"]');
    await ss.capture('clicked-submit');

    // Step 5: รอ toast error แสดง "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({ timeout: 10000 });
    await ss.capture('error-toast-shown');

    // Step 6: ตรวจสอบว่ายังอยู่หน้า login (ไม่ redirect)
    await expect(page).toHaveURL(/\/login/);
    await ss.capture('still-on-login-page');
  });

  test('should login successfully with valid credentials', async ({ page }) => {
    const ss = new StepScreenshot(page, '01-login-success');

    // Step 1: เปิดหน้า Login
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await ss.capture('login-page-loaded');

    // Step 2: พิมพ์ email ที่ถูกต้อง (human-like)
    await page.type('#email', TEST_USER.email, { delay: 30 });
    await ss.capture('typed-correct-email');

    // Step 3: พิมพ์ password ที่ถูกต้อง
    await page.type('#password', TEST_USER.password, { delay: 30 });
    await ss.capture('typed-correct-password');

    // Step 4: กดปุ่ม "เข้าสู่ระบบ"
    await page.click('button[type="submit"]');
    await ss.capture('clicked-submit');

    // Step 5: รอ redirect ไป Dashboard (/)
    await page.waitForURL('/', { timeout: 15000, waitUntil: 'domcontentloaded' });
    await ss.capture('redirected-to-dashboard');

    // Step 6: ตรวจสอบว่าอยู่หน้า Dashboard แล้ว
    await expect(page).toHaveURL('/');
    await ss.capture('dashboard-confirmed');
  });

  test('should redirect to dashboard if already logged in', async ({ page }) => {
    const ss = new StepScreenshot(page, '01-login-already-authenticated');

    // Step 1: Login ก่อน
    await loginAsAdmin(page);
    await ss.capture('logged-in-successfully');

    // Step 2: พยายามไปหน้า /login อีกครั้ง
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await ss.capture('navigated-to-login-again');

    // Step 3: ตรวจสอบว่า redirect กลับไป Dashboard
    await expect(page).toHaveURL('/');
    await ss.capture('redirected-back-to-dashboard');
  });

  test('should have forgot password link that navigates correctly', async ({ page }) => {
    const ss = new StepScreenshot(page, '01-login-forgot-password');

    // Step 1: เปิดหน้า Login
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await ss.capture('login-page-loaded');

    // Step 2: คลิก "ลืมรหัสผ่าน?"
    await page.click('a[href="/forgot-password"]');
    await ss.capture('clicked-forgot-password');

    // Step 3: ตรวจสอบว่าไปหน้า forgot-password
    await expect(page).toHaveURL('/forgot-password');
    await ss.capture('on-forgot-password-page');
  });
});
