import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
export async function checkChatTeam(page, origin, output, width) {
  const info = await (await page.request.get(`${origin}/api/preview/info`)).json();
  assert.equal(info.isolated, true);
  const roomId = info.chatWorkRooms.SHOP;
  const roomUrl = `${origin}/inbox/${roomId}?zone=shop`;
  const switchActor = async key => { const response = await page.request.post(`${origin}/api/preview/actor/${key}`); assert.equal(response.status(), 201); };
  const sent = [];
  const collect = req => { if (req.method() === 'POST' && /\/rooms\/[^/]+\/(messages|send|files|stickers)(?:\?|$)/.test(req.url())) sent.push(req.url()); };
  page.on('request', collect);
  try {
    await switchActor('owner');
    await page.goto(roomUrl);
    const chatDraft = page.getByRole('textbox', { name: 'พิมพ์ข้อความ', exact: true });
    await chatDraft.fill('ฉบับร่างถึงลูกค้า');
    await page.getByRole('radio', { name: 'โน้ตภายใน', exact: true }).click();
    const note = page.getByRole('textbox', { name: 'พิมพ์โน้ตภายใน', exact: true });
    await expect(note).toHaveValue('');
    await note.fill(`ฝากตรวจภายใน ${width}`);
    await page.getByRole('combobox', { name: 'แจ้งเตือนเพื่อนร่วมทีม' }).fill('ผู้รับงานจำลอง');
    await page.getByRole('option', { name: /ผู้รับงานจำลอง/ }).click();
    const noteResponse = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes(`/rooms/${roomId}/notes`));
    await page.getByRole('button', { name: 'บันทึกโน้ต', exact: true }).click();
    const savedNote = await noteResponse; assert.equal(savedNote.status(), 201);
    const noteId = (await savedNote.json()).id;
    await expect(note).toHaveValue('');
    await page.getByRole('radio', { name: 'ตอบลูกค้า', exact: true }).click();
    await expect(chatDraft).toHaveValue('ฉบับร่างถึงลูกค้า');
    await chatDraft.fill('');
    if (width < 1280) await page.getByRole('button', { name: 'ข้อมูลลูกค้า', exact: true }).click();
    await page.getByRole('button', { name: 'ส่งงานให้ทีม', exact: true }).filter({ visible: true }).click();
    let dialog = page.getByRole('dialog', { name: 'ส่งงานให้ทีม', exact: true });
    const title = `ฝากงานหน้าจอ ${width} ${Date.now()}`;
    await dialog.getByLabel('เรื่องที่ฝาก', { exact: true }).fill(title);
    await dialog.getByLabel('รายละเอียดงาน', { exact: true }).fill('ตรวจสีและสภาพเครื่อง');
    await dialog.getByLabel('วันเวลานัด (เวลาไทย)').fill('2026-11-01T10:30');
    await expect(dialog.getByLabel('ผู้รับผิดชอบงาน').locator(`option[value="${info.previewActors.receiver.id}"]`)).toHaveCount(1);
    await dialog.getByLabel('ผู้รับผิดชอบงาน').selectOption(info.previewActors.receiver.id);
    const creation = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes(`/rooms/${roomId}/handoffs`));
    await dialog.getByRole('button', { name: 'ส่งงาน', exact: true }).click();
    const created = await creation; assert.equal(created.status(), 201); const task = await created.json();
    await expect(dialog).toHaveCount(0);
    await switchActor('receiver');
    await page.goto(roomUrl);
    const inbox = async () => (await (await page.request.get(`${origin}/api/staff-chat/work-notifications?company=SHOP&limit=100`)).json()).data;
    let notifications = await inbox();
    const notice = notifications.find(n => n.targetId === task.id); assert.ok(notice); assert.equal(notice.readAt, null);
    assert.ok(notifications.some(n => n.targetId === noteId));
    // Neither viewing the room nor opening its notification accepts the task.
    await page.getByRole('button', { name: /^การแจ้งเตือนงาน/ }).click();
    await page.getByRole('button', { name: /มีงานในแชทถึงคุณ/ }).first().click();
    dialog = page.getByRole('dialog', { name: title, exact: true });
    await expect(dialog.getByText('สถานะ: รอรับงาน', { exact: true })).toBeVisible();
    notifications = await inbox(); assert.ok(notifications.find(n => n.id === notice.id).readAt);
    const readTask = await (await page.request.get(`${origin}/api/todos/${task.id}?company=SHOP`)).json(); assert.equal(readTask.status, 'TODO');
    await dialog.getByRole('button', { name: 'รับงาน', exact: true }).click();
    await expect(dialog.getByText('สถานะ: กำลังทำ', { exact: true })).toBeVisible();
    await dialog.getByLabel('ผลการทำงาน').fill('ตรวจแล้ว เครื่องพร้อมให้ลูกค้าดู');
    await dialog.getByRole('button', { name: 'จบงาน', exact: true }).click();
    await expect(dialog.getByText('สถานะ: เสร็จแล้ว', { exact: true })).toBeVisible();
    await expect(dialog.getByText('ตรวจแล้ว เครื่องพร้อมให้ลูกค้าดู', { exact: true })).toBeVisible();
    const queue = await (await page.request.get(`${origin}/api/staff-chat/work?company=SHOP&view=FOR_ME&limit=200`)).json();
    assert.ok(!queue.data.some(row => row.targetId === task.id));
    await page.screenshot({ path: join(output, `chat-team-receiver-${width}.png`), animations: 'disabled' });
    await switchActor('owner');
    await page.goto(`${origin}/inbox/${roomId}?zone=shop&todoId=${task.id}`);
    dialog = page.getByRole('dialog', { name: title, exact: true });
    await expect(dialog.getByText('สถานะ: เสร็จแล้ว', { exact: true })).toBeVisible();
    await expect(dialog.getByText('ตรวจแล้ว เครื่องพร้อมให้ลูกค้าดู', { exact: true })).toBeVisible();
    notifications = await inbox(); assert.ok(notifications.some(n => n.targetId === task.id && n.title === 'งานที่คุณฝากเสร็จแล้ว'));
    assert.ok(!notifications.some(n => n.id === notice.id), 'Previous recipient inbox must not leak to sender');
    assert.equal(sent.length, 0, 'Internal notes and handoffs must not call customer send routes');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(output, `chat-team-sender-${width}.png`), animations: 'disabled' });
  } finally { page.off('request', collect); await switchActor('owner'); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      await context.routeWebSocket('**/socket.io/**', socket => socket.close());
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await checkChatTeam(page, process.env.LOCAL_CHAT_ORIGIN || 'http://localhost:5217', '.tmp/local-preview', width);
      assert.deepEqual(errors, []); await context.close();
    }
    console.log('PASS: scoped note mentions, independent drafts, A/B handoff through actual desktop/mobile UI');
  } finally { await browser.close(); }
}
