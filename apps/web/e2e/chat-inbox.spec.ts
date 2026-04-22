import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

test.describe('Chat Inbox (/chat)', () => {
  test.beforeEach(async ({ page }) => {
    // Use cached API login — avoids rate-limiting the /auth/login endpoint
    // when running alongside other specs in the same worker.
    await loginViaAPI(page);
  });

  test('loads /chat page with header', async ({ page }) => {
    await page.goto('/chat', { waitUntil: 'domcontentloaded' });

    // Page header renders
    await expect(page.getByRole('heading', { name: 'รวมแชท' })).toBeVisible({
      timeout: 10000,
    });
  });

  test('renders room filter tabs', async ({ page }) => {
    await page.goto('/chat', { waitUntil: 'domcontentloaded' });

    // Filter tabs (Radix TabsTrigger has role="tab")
    await expect(page.getByRole('tab', { name: 'ทั้งหมด' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('tab', { name: 'LINE' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Facebook' })).toBeVisible();
  });

  test('shows empty conversation panel when no room selected', async ({ page }) => {
    await page.goto('/chat', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByText('เลือกห้องจากด้านซ้ายเพื่อดูการสนทนา'),
    ).toBeVisible({ timeout: 10000 });
  });

  // Happy-path AI draft approval flow.
  //
  // Intentionally skipped for Week 1 smoke suite — seeding an inbound chat
  // message + an AI-generated draft deterministically requires:
  //   1. A chat room with a customer + channel config (LINE/FB)
  //   2. A fresh inbound ChatMessage from the customer
  //   3. The AI draft worker to process the inbound and produce an AiDraft
  //
  // That seed infra is planned for Week 2 (shadow-mode smoke seed). This
  // skipped test pins the expected shape so we can re-enable it by simply
  // removing `.skip` once seeding is in place.
  test.skip('staff approves AI draft (requires seed infra — re-enable Week 2)', async ({
    page,
  }) => {
    await page.goto('/chat', { waitUntil: 'domcontentloaded' });

    // Pick the first room in the list
    await page.locator('[data-testid="room-list-item"]').first().click({ timeout: 10000 });

    // AI draft card should surface on the right sidebar
    const draftCard = page.getByText('AI แนะนำคำตอบ');
    await draftCard.waitFor({ state: 'visible', timeout: 30000 });

    // Approve & send
    await page.getByRole('button', { name: /ส่ง/ }).click();

    // Toast confirms send
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({
      timeout: 10000,
    });
  });
});
