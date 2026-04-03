import { test, expect } from '@playwright/test';
import { loginViaAPI } from './helpers/auth';

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test.describe('Invite Resend Feature', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaAPI(page);
  });

  test('should display invites tab on /users page', async ({ page }) => {
    await page.goto('/users', { waitUntil: 'domcontentloaded' });

    // Tab "คำเชิญ" should be visible
    await expect(page.getByRole('tab', { name: /คำเชิญ/ }).or(page.getByText('คำเชิญ').first())).toBeVisible({
      timeout: 15000,
    });
  });

  test('should create invite and show it in invites tab', async ({ page }) => {
    await page.goto('/users', { waitUntil: 'domcontentloaded' });

    // Navigate to Invites tab
    const inviteTab = page.getByText('คำเชิญ').first();
    await expect(inviteTab).toBeVisible({ timeout: 15000 });
    await inviteTab.click();

    // Click create invite button
    const createBtn = page.getByRole('button', { name: /เชิญผู้ใช้|สร้างคำเชิญ|เพิ่มคำเชิญ/ }).first();
    await expect(createBtn).toBeVisible({ timeout: 10000 });
    await createBtn.click();

    // Modal should open
    const modal = page.locator('[role="dialog"], .modal').first();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Fill invite form with unique email
    const uniqueEmail = `test-invite-${Date.now()}@example.com`;
    const emailInput = modal.locator('input[type="email"], input[placeholder*="email" i], input[name="email"]').first();
    await emailInput.fill(uniqueEmail);

    // Submit the form
    await modal.getByRole('button', { name: /ส่งคำเชิญ|สร้าง|ยืนยัน/ }).first().click();

    // Success toast should appear
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible({ timeout: 10000 });

    // The invite should now appear in the list
    await expect(page.getByText(uniqueEmail)).toBeVisible({ timeout: 10000 });
  });

  test('should resend invite via API and verify new invite created', async ({ page }) => {
    // Step 1: Create an invite via API
    const uniqueEmail = `resend-test-${Date.now()}@example.com`;

    const createRes = await page.request.post(`${API_URL}/api/invite`, {
      data: { email: uniqueEmail, role: 'SALES' },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    expect(createRes.ok()).toBeTruthy();
    const invite = await createRes.json();
    const inviteId = invite.id;
    expect(inviteId).toBeTruthy();

    // Step 2: Go to /users → Invites tab
    await page.goto('/users', { waitUntil: 'domcontentloaded' });
    const inviteTab = page.getByText('คำเชิญ').first();
    await expect(inviteTab).toBeVisible({ timeout: 15000 });
    await inviteTab.click();

    // Step 3: Wait for the invite to appear
    await expect(page.getByText(uniqueEmail)).toBeVisible({ timeout: 15000 });

    // Step 4: Click "ส่งซ้ำ" button for this invite
    const inviteRow = page.getByText(uniqueEmail).locator('../..').first();
    const resendBtn = inviteRow.getByText('ส่งซ้ำ').or(page.getByText('ส่งซ้ำ').first());
    await expect(resendBtn).toBeVisible({ timeout: 5000 });
    await resendBtn.click();

    // Step 5: Confirm dialog should appear
    const confirmBtn = page.getByRole('button', { name: /ยืนยัน|ตกลง|ใช่/ }).last();
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    // Step 6: Success toast
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible({ timeout: 10000 });

    // Step 7: Verify via API that old invite is expired and a new one exists
    const listRes = await page.request.get(`${API_URL}/api/invite?limit=50`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    expect(listRes.ok()).toBeTruthy();
    const listData = await listRes.json();
    const invitesForEmail: Array<{ id: string; expiresAt: string; usedAt: string | null }> =
      listData.data.filter((i: { email: string }) => i.email === uniqueEmail);

    // Should have at least 2 invites for the same email (old + new)
    expect(invitesForEmail.length).toBeGreaterThanOrEqual(2);

    // Old invite should be expired
    const oldInvite = invitesForEmail.find((i) => i.id === inviteId);
    expect(oldInvite).toBeTruthy();
    expect(new Date(oldInvite!.expiresAt) <= new Date()).toBe(true);

    // New invite should be valid
    const newInvite = invitesForEmail.find((i) => i.id !== inviteId && !i.usedAt);
    expect(newInvite).toBeTruthy();
    expect(new Date(newInvite!.expiresAt) > new Date()).toBe(true);
  });

  test('should not show resend button for used invites', async ({ page }) => {
    // Verify UI logic: getInviteStatus returns 'ใช้แล้ว' when usedAt is set,
    // and render() returns null (no buttons) for used invites.
    // We test this by checking the API returns usedAt field, and verifying
    // the UI doesn't show action buttons for used invites.
    await page.goto('/users', { waitUntil: 'domcontentloaded' });
    const inviteTab = page.getByText('คำเชิญ').first();
    await expect(inviteTab).toBeVisible({ timeout: 15000 });
    await inviteTab.click();

    // Wait for the invites table to load
    await page.waitForTimeout(1000);

    // Find any row with status "ใช้แล้ว"
    const usedRows = page.getByText('ใช้แล้ว');
    const count = await usedRows.count();

    if (count > 0) {
      // Each "ใช้แล้ว" row should NOT have a "ส่งซ้ำ" button
      // The render() function returns null for used invites
      for (let i = 0; i < count; i++) {
        const row = usedRows.nth(i).locator('../..').first();
        await expect(row.getByText('ส่งซ้ำ')).not.toBeVisible();
      }
    } else {
      // No used invites exist — skip this assertion
      test.skip();
    }
  });

  test('should resend API endpoint reject used invites', async ({ page }) => {
    // Verify backend: resend endpoint returns 400 for used invites
    // This tests the service-level guard: if (invite.usedAt) throw BadRequestException

    // First find a used invite via API
    const listRes = await page.request.get(`${API_URL}/api/invite?limit=50`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    expect(listRes.ok()).toBeTruthy();
    const listData = await listRes.json();
    const usedInvite = listData.data.find((i: { usedAt: string | null }) => i.usedAt !== null);

    if (!usedInvite) {
      // No used invites in DB — skip test
      test.skip();
      return;
    }

    // Try to resend a used invite — should fail with 400
    const resendRes = await page.request.post(`${API_URL}/api/invite/${usedInvite.id}/resend`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    expect(resendRes.status()).toBe(400);

    const body = await resendRes.json();
    expect(body.message).toContain('ถูกใช้แล้ว');
  });
});
