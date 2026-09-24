import { test, expect } from '@playwright/test';
import { loginViaAPI, getAuthHeaders } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

test.describe('GFIN pre-check tab', () => {
  test.beforeEach(async ({ page }) => { await loginViaAPI(page); });

  test('inbox room shows a GFIN tab; starting a draft creates BC- number; public link of a fake token is 410', async ({ page, request }) => {
    // page.request is a separate APIRequestContext channel that never sees headers set via
    // page.setExtraHTTPHeaders() (loginViaAPI) — pass getAuthHeaders() explicitly, same
    // convention used by every other spec that calls page.request.* after logging in.
    const rooms = await page.request.get('/api/staff-chat/rooms?limit=1', { headers: getAuthHeaders() });
    expect(rooms.ok()).toBeTruthy();
    const roomsBody = await rooms.json();
    // Envelope is { success, data: { data: [...], total, page, limit } } for this paginated
    // endpoint — unwrap both layers (same pattern as e2e/helpers/api-utils.ts getBranches).
    const roomsData = roomsBody.data ?? roomsBody;
    const roomsList = Array.isArray(roomsData) ? roomsData : (roomsData.data ?? []);
    const room = roomsList[0];
    test.skip(!room, 'no chat rooms seeded');
    const ok = await gotoWithRetry(page, `/inbox/${room.id}`);
    expect(ok).toBe(true);
    expect(await hasErrorBoundary(page)).toBe(false);
    if (await page.viewportSize()!.width < 1280) await page.getByRole('button', { name: /ข้อมูลลูกค้า/ }).first().click();
    await page.getByRole('tab', { name: /GFIN/ }).click();
    await page.getByRole('button', { name: 'เริ่มใบยื่น' }).click();
    await expect(page.getByText(/ใบยื่น \(ร่าง\)/)).toBeVisible({ timeout: 15000 });
    const apps = await page.request.get(`/api/staff-chat/rooms/${room.id}/finance-applications`, { headers: getAuthHeaders() });
    const body = await apps.json();
    expect((body.data ?? body).current.number).toMatch(/^BC-\d{6}-\d{3}$/);
    await page.getByRole('button', { name: 'ยกเลิกใบยื่น' }).click();
    await expect(page.getByRole('button', { name: 'เริ่มใบยื่น' })).toBeVisible({ timeout: 15000 });

    const gone = await request.get('/api/g/' + 'A'.repeat(43));
    expect(gone.status()).toBe(410);
    expect(await gone.text()).toContain('ลิงก์นี้หมดอายุหรือถูกยกเลิกแล้ว');
    expect(await gone.text()).not.toContain('BC-');
  });
});
