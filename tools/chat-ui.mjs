import { expect } from '@playwright/test';

export async function chooseComposerMode(page, mode) {
  if (page.viewportSize().width < 1024) {
    await page.getByRole('button', { name: 'เลือกโหมดช่องพิมพ์', exact: true }).click();
    await page.getByRole('menuitemradio', { name: mode === 'chat' ? 'ตอบลูกค้า' : 'โน้ตภายใน · ลูกค้าไม่เห็น', exact: true }).click();
    await expect(page.getByRole('menu')).toBeHidden();
  } else {
    await page.getByRole('radio', { name: mode === 'chat' ? 'ตอบลูกค้า' : 'โน้ตภายใน', exact: true }).click();
  }
}
export async function openComposerTool(page, name) {
  const target = page.getByRole('button', { name, exact: true });
  if (!await target.isVisible() && page.viewportSize().width < 1024) {
    await page.getByRole('button', { name: 'เครื่องมือแชท', exact: true }).click();
  }
  await target.click();
}
export async function showWorkControl(page, name) {
  const target = page.getByRole('button', { name, exact: typeof name === 'string' });
  if (!await target.isVisible() && page.viewportSize().width < 1024) {
    const back = page.getByRole('button', { name: 'กลับ', exact: true });
    if (/^\/inbox\/[^/]+/.test(new URL(page.url()).pathname)) { await expect(back).toBeVisible(); await back.click(); }
    if (!await target.isVisible()) await page.getByRole('button', { name: 'เมนูงานแชท', exact: true }).click();
  }
  await expect(target).toBeVisible();
  return target;
}
export async function toggleChatTheme(page) {
  const wasNote = await page.getByRole('textbox', { name: 'พิมพ์โน้ตภายใน', exact: true }).isVisible();
  const roomUrl = page.url();
  const wasRoom = /\/inbox\/[^/?]+/.test(new URL(roomUrl).pathname);
  await (await showWorkControl(page, 'สลับธีม')).click();
  if (page.viewportSize().width < 1024) {
    await page.keyboard.press('Escape');
    if (wasRoom) { await page.goBack(); if (wasNote) await chooseComposerMode(page, 'note'); }
  }
}
