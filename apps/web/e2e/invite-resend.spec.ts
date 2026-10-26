import { test, expect } from '@playwright/test';
import { loginViaAPI, getAuthHeaders } from './helpers/auth';
import { unwrapResponse } from './helpers/api-utils';

import { backlogFixtures } from './helpers/backlog-fixtures';

const API_URL = process.env.API_DIRECT_URL || 'http://localhost:3000';

test.describe('Invite Resend Feature', () => {

  test('should display invites tab on /users page', async ({ page }) => {
    await loginViaAPI(page);
    await page.goto('/users', { waitUntil: 'domcontentloaded' });

    // Tab "คำเชิญ" should be visible
    await expect(
      page.getByRole('tab', { name: /คำเชิญ/ }).or(page.getByText('คำเชิญ').first()),
    ).toBeVisible({
      timeout: 15000,
    });
  });

  test('should create invite and show it in invites tab', async ({ page }) => {
    await loginViaAPI(page);
    // POST /api/invite triggers email sending — hangs without SMTP config.
    // Use a short timeout to detect if the email service is available.
    const uniqueEmail = `test-invite-${Date.now()}@example.invalid`;
    let createRes;
    try {
      createRes = await page.request.post(`${API_URL}/api/invite`, {
        data: { email: uniqueEmail, role: 'SALES' },
        headers: getAuthHeaders(),
        timeout: 8000,
      });
    } catch {
      // Email service unavailable — invite API hangs
      test.skip();
      return;
    }
    if (!createRes.ok()) {
      test.skip();
      return;
    }

    // Navigate to /users → Invites tab and verify the invite appears
    await page.goto('/users', { waitUntil: 'domcontentloaded' });
    const inviteTab = page.getByText('คำเชิญ').first();
    await expect(inviteTab).toBeVisible({ timeout: 15000 });
    await inviteTab.click();

    // The invite should now appear in the list
    await expect(page.getByText(uniqueEmail)).toBeVisible({ timeout: 15000 });
  });

  test('should resend invite via API and verify new invite created', async ({ page }) => {
    await loginViaAPI(page);
    // Step 1: Create an invite via API (may hang if email service unavailable)
    const uniqueEmail = `resend-test-${Date.now()}@example.invalid`;

    let createRes;
    try {
      createRes = await page.request.post(`${API_URL}/api/invite`, {
        data: { email: uniqueEmail, role: 'SALES' },
        headers: getAuthHeaders(),
        timeout: 8000,
      });
    } catch {
      test.skip();
      return;
    }
    if (!createRes.ok()) {
      test.skip();
      return;
    }
    const invite = unwrapResponse(await createRes.json());
    const inviteId = invite.id;
    expect(inviteId).toBeTruthy();

    // Step 2: Go to /users → Invites tab
    await page.goto('/users', { waitUntil: 'domcontentloaded' });
    const inviteTab = page.getByText('คำเชิญ').first();
    await expect(inviteTab).toBeVisible({ timeout: 15000 });
    await inviteTab.click();

    // Step 3: Wait for the invite to appear
    await expect(page.getByText(uniqueEmail)).toBeVisible({ timeout: 15000 });

    // Step 4: Click "ส่งซ้ำ" button for this invite.
    // The explainer box above the table (UserTable.tsx, prod 2026-08-24) also
    // contains the words "ส่งซ้ำ", so an unscoped `.or(page.getByText('ส่งซ้ำ'))`
    // fallback pulls that <p> in → strict mode violation. Scope to the real row.
    const inviteRow = page.getByRole('row').filter({ hasText: uniqueEmail }).first();
    const resendBtn = inviteRow.getByRole('button', { name: 'ส่งซ้ำ' });
    await expect(resendBtn).toBeVisible({ timeout: 5000 });
    await resendBtn.click();

    // Step 5: Confirm dialog should appear (ConfirmDialog → Radix role="dialog",
    // default confirmLabel 'ยืนยัน'). Scope to the dialog so we never hit another
    // row's "ส่งซ้ำ" button.
    const confirmBtn = page
      .getByRole('dialog')
      .last()
      .getByRole('button', { name: /ยืนยัน|ตกลง|ใช่/ })
      .last();
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    // Step 6: Success toast or page update
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible({ timeout: 15000 });

    // Step 7: Verify via API that old invite is expired and a new one exists
    await page.waitForTimeout(1000); // let API propagate
    const listRes = await page.request.get(`${API_URL}/api/invite?limit=50`, {
      headers: getAuthHeaders(),
    });
    expect(listRes.ok()).toBeTruthy();
    const listData = unwrapResponse(await listRes.json());
    const invites = Array.isArray(listData) ? listData : (listData.data ?? []);
    const invitesForEmail: Array<{ id: string; expiresAt: string; usedAt: string | null }> =
      invites.filter((i: { email: string }) => i.email === uniqueEmail);

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
    const used = backlogFixtures().usedInvite;
    await loginViaAPI(page);
    await page.goto('/users'); await page.getByRole('button', { name: /^คำเชิญ/ }).click();
    await page.getByRole('button', { name: /^ใช้แล้ว/ }).click();
    const row = page.getByRole('row').filter({ hasText: used.email });
    await expect(row).toHaveCount(1); await expect(row).toContainText('ใช้แล้ว');
    await expect(row.getByRole('button', { name: 'ส่งซ้ำ' })).toHaveCount(0);
  });

  test('should resend API endpoint reject used invites', async ({ page }) => {
    const used = backlogFixtures().usedInvite;
    await loginViaAPI(page);
    const list = async () => {
      const response = await page.request.get(`${API_URL}/api/invite?limit=100`, { headers: getAuthHeaders() });
      expect(response.status()).toBe(200);
      const body = unwrapResponse(await response.json());
      return (Array.isArray(body) ? body : body.data).filter((row: { email: string }) => row.email === used.email);
    };
    const before = await list(); expect(before).toHaveLength(1); expect(before[0].usedAt).toBeTruthy();
    const response = await page.request.post(`${API_URL}/api/invite/${used.id}/resend`, { headers: getAuthHeaders() });
    expect(response.status()).toBe(400); expect(unwrapResponse(await response.json()).message).toContain('ถูกใช้แล้ว');
    expect(await list()).toEqual(before);
  });
});
