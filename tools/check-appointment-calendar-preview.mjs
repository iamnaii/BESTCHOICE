import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
const origin = process.env.APPOINTMENT_PREVIEW_URL || 'http://localhost:5198';
const output = '.tmp/local-preview/appointments';
mkdirSync(output, { recursive: true });
const api = async (path, body) => {
  const r = await fetch(`${origin}/api/admin${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await r.json();
  assert.equal(r.ok, true, `${path}: ${JSON.stringify(result)}`);
  return result.data ?? result;
};
const info = await api('/preview/info');
assert.equal(info.isolated, true);
assert.equal(info.repoRoot, process.cwd());
await api('/preview/actor/owner', {});
const { branchId, customers } = info.appointmentFixture;
const day = new Date(Date.now() + 3 * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
for (const c of customers)
  for (const a of await api(`/store-appointments?customerId=${c.id}&open=true`))
    await api(`/store-appointments/${a.id}/status`, {
      status: 'CANCELED',
      version: a.version,
      requestId: crypto.randomUUID(),
      reason: 'Reset synthetic calendar acceptance',
    });
const visits = [];
for (const [i, c] of customers.entries())
  visits.push(
    await api('/store-appointments', {
      branchId,
      customerId: c.id,
      sourceRoomId: c.roomId,
      startsAt: `${day}T${['10:00', '10:45', '18:30'][i]}:00+07:00`,
      requestId: crypto.randomUUID(),
    }),
  );
const calendarUrl = `${origin}/appointments?view=calendar&branchId=${branchId}&day=${day}`;
const chatUrl = `${origin}/inbox/${customers[0].roomId}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(calendarUrl);
  const calendar = page.getByRole('region', { name: 'ปฏิทินนัดเข้าร้าน', exact: true });
  const daily = page.getByRole('region', { name: 'รายชื่อนัดในวันที่เลือก', exact: true });
  await expect(daily.getByText('3 คน · 3 นัด', { exact: true })).toBeVisible();
  for (const c of customers)
    await expect(daily.getByRole('link', { name: new RegExp(c.name) }).first()).toBeVisible();
  await page.screenshot({ path: `${output}/calendar-desktop.png`, fullPage: true });
  await calendar.getByRole('button', { name: 'เดือนถัดไป' }).click();
  await expect(daily.getByText('วันนี้ยังไม่มีนัดหมาย')).toBeVisible();
  await calendar.getByRole('button', { name: 'เดือนก่อนหน้า' }).click();
  await calendar.getByRole('button', { name: /: 3 คน, 3 นัด/ }).click();
  await daily
    .getByRole('link', { name: new RegExp(visits[0].reference) })
    .first()
    .click();
  const active = page.locator('article').filter({ hasText: visits[0].reference });
  await active.getByRole('button', { name: 'เลื่อนนัด', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'เลื่อนนัดหมาย', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ปฏิทิน', exact: true }).click();
  await calendar.getByRole('button', { name: /: 3 คน, 3 นัด/ }).click();
  await daily
    .getByRole('link', { name: new RegExp(visits[1].reference) })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'นัดให้ลูกค้า', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'ลูกค้า', exact: true })).toContainText(
    customers[1].name,
  );
  await expect(page.getByRole('heading', { name: 'เลื่อนนัดหมาย', exact: true })).toHaveCount(0);
  await page.goto(chatUrl);
  const card = page.getByRole('region', { name: 'นัดเข้าร้าน', exact: true });
  await expect(card).toBeVisible();
  await expect(card.getByText('10:00–10:45', { exact: true })).toBeVisible();
  await expect(card.getByText('ส่งข้อความยืนยันเข้าแชทแล้ว', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${output}/inbox-appointment.png`, fullPage: true });
  const received = await api(`/staff-chat/rooms/${customers[0].roomId}/messages`);
  assert.ok(
    received.some(
      (m) =>
        m.intent === 'APPOINTMENT_CONFIRMATION' &&
        m.text?.includes(visits[0].reference) &&
        m.outboundSentAt,
    ),
  );
  await card.getByRole('link', { name: 'ดูปฏิทินสาขา', exact: true }).click();
  await expect(daily.getByText('3 คน · 3 นัด', { exact: true })).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await expect(calendar).toBeVisible();
    await page.screenshot({ path: `${output}/calendar-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  writeFileSync(
    `${output}/calendar-check.json`,
    JSON.stringify(
      {
        status: 'PASS',
        at: new Date().toISOString(),
        calendarUrl,
        chatUrl,
        checks: [
          'daily customer counts and list',
          'month navigation',
          'rescheduling customer A -> calendar customer B clears form state',
          'Inbox appointment card and actual synthetic confirmation',
          'chat to branch/day calendar link',
          '320/390px no overflow',
        ],
        browserErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log('Calendar and Inbox browser acceptance: PASS');
} finally {
  await browser.close();
}
