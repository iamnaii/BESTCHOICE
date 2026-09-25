import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { loginViaAPI, getAuthHeaders } from './helpers/auth';
import { gotoWithRetry, hasErrorBoundary } from './helpers/navigation';

// CI seeds the DB via apps/api/prisma/seed.ts, which never creates a ChatRoom (no
// mock-chat seeders wired in, no global-setup step creates one either) — this spec must
// bring its own fixture room instead of assuming one exists (brief step 2: "ถ้าไม่มีห้อง
// ให้สร้างผ่าน API ก่อนใน test"). DATABASE_URL is already exported at the e2e job's level
// in .github/workflows/e2e-tests.yml (env: block applies to every step, including the
// Playwright run) so a plain `new PrismaClient()` here picks up the same DB the API/seed
// used — no workflow change needed.
const prisma = new PrismaClient();
let fixtureRoomId: string | undefined;

test.describe('GFIN pre-check tab', () => {
  test.beforeAll(async () => {
    const room = await prisma.chatRoom.create({
      data: {
        channel: 'FACEBOOK',
        externalUserId: `E2E-GFIN-${Date.now()}`,
        displayName: `E2E-GFIN-${Date.now()}`,
      },
    });
    fixtureRoomId = room.id;
  });

  test.afterAll(async () => {
    if (fixtureRoomId) {
      // Applications created during the test are cancelled (soft-deleted) by the flow
      // itself, but their event rows + the still-FK-referenced application rows must go
      // before the room can be deleted (external_finance_applications.room_id → chat_rooms).
      const apps = await prisma.externalFinanceApplication.findMany({
        where: { roomId: fixtureRoomId },
        select: { id: true },
      });
      const appIds = apps.map((a) => a.id);
      if (appIds.length) {
        await prisma.externalFinanceApplicationEvent.deleteMany({ where: { applicationId: { in: appIds } } });
        await prisma.externalFinanceApplication.deleteMany({ where: { id: { in: appIds } } });
      }
      await prisma.chatRoom.delete({ where: { id: fixtureRoomId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  test.beforeEach(async ({ page }) => { await loginViaAPI(page); });

  test('inbox room shows a GFIN tab; starting a draft creates BC- number; public link of a fake token is 410', async ({ page, request }) => {
    test.skip(!fixtureRoomId, 'fixture room creation failed');
    const roomId = fixtureRoomId!;
    const ok = await gotoWithRetry(page, `/inbox/${roomId}`);
    expect(ok).toBe(true);
    expect(await hasErrorBoundary(page)).toBe(false);
    if (page.viewportSize()!.width < 1280) await page.getByRole('button', { name: /ข้อมูลลูกค้า/ }).first().click();
    await page.getByRole('tab', { name: /GFIN/ }).click();
    await page.getByRole('button', { name: 'เริ่มใบยื่น' }).click();
    await expect(page.getByText(/ใบยื่น \(ร่าง\)/)).toBeVisible({ timeout: 15000 });
    // page.request is a separate APIRequestContext channel that never sees headers set via
    // page.setExtraHTTPHeaders() (loginViaAPI) — pass getAuthHeaders() explicitly, same
    // convention used by every other spec that calls page.request.* after logging in.
    const apps = await page.request.get(`/api/staff-chat/rooms/${roomId}/finance-applications`, { headers: getAuthHeaders() });
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
