import assert from 'node:assert/strict';
import { join } from 'node:path';
import { expect } from '@playwright/test';

// Real composer + isolated API; speech and outbound delivery are simulated, not microphone acceptance.
export async function checkInboxVoice(browser, origin, output) {
  const info = await (await fetch(new URL('/api/admin/preview/info', origin))).json();
  assert.equal(info.isolated, true);
  const fixture = async () => {
    const response = await fetch(new URL('/api/admin/preview/fixture', origin), { method: 'POST' });
    assert.equal(response.status, 201);
    return (await response.json()).roomId;
  };
  const roomA = await fixture();
  const roomB = await fixture();
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.routeWebSocket('**/socket.io/**', socket => socket.close());
    // The limited preview has no outbound messaging provider. Verify the request
    // boundary without contacting any customer or requiring provider credentials.
    await context.route('**/staff-chat/rooms/*/messages?*', route => route.request().method() === 'POST'
      ? route.fulfill({ json: { success: true } }) : route.continue());
    await context.addInitScript(() => {
      window.voiceInstances = [];
      class MockSpeechRecognition {
        constructor() { window.voiceInstances.push(this); }
        start() { this.onstart?.(); }
        stop() { this.onend?.(); }
        abort() { this.aborted = true; }
        emit(text, final = true, index = 0) {
          this.results ??= [];
          this.results[index] = { isFinal: final, 0: { transcript: text } };
          this.onresult?.({ resultIndex: index, results: this.results });
        }
      }
      window.SpeechRecognition = MockSpeechRecognition;
    });
    try {
      const page = await context.newPage();
      const errors = [];
      const sends = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', req => {
        if (req.method() === 'POST' && /\/staff-chat\/rooms\/[^/]+\/messages$/.test(new URL(req.url()).pathname)) sends.push(req.postDataJSON());
      });
      await page.goto(new URL(`/inbox/${roomA}`, origin).href);
      const input = page.getByRole('textbox', { name: 'พิมพ์ข้อความ', exact: true });
      const mic = page.getByRole('button', { name: 'พูดเป็นข้อความ', exact: true });
      const send = page.getByRole('button', { name: 'ส่งข้อความ', exact: true });
      await input.fill('ข้อความเดิม');
      assert.equal(await page.evaluate(() => window.voiceInstances.length), 0);
      await mic.click();
      await expect(send).toBeDisabled();
      await page.evaluate(() => window.voiceInstances.at(-1).emit('กำลังพูด', false));
      await expect(input).toHaveValue('ข้อความเดิม');
      await expect(page.getByText('กำลังพูด', { exact: true })).toBeVisible();
      await input.fill('แก้ข้อความเดิม');
      await page.evaluate(() => {
        const voice = window.voiceInstances.at(-1);
        voice.emit('สวัสดีครับ');
        voice.emit('สวัสดีครับ');
      });
      await expect(input).toHaveValue('แก้ข้อความเดิม สวัสดีครับ');
      await input.press('Enter');
      await expect(input).toHaveValue('แก้ข้อความเดิม สวัสดีครับ');
      assert.equal(sends.length, 0, 'speech and Enter while listening must not send');
      await page.screenshot({ path: join(output, `inbox-voice-${width}.png`) });
      await page.getByRole('button', { name: 'หยุดรับเสียง', exact: true }).click();
      await expect(send).toBeEnabled();
      await input.fill('ตรวจแล้ว ส่งข้อความนี้');
      await send.click();
      await expect.poll(() => sends.length).toBe(1);
      assert.equal(sends[0].text, 'ตรวจแล้ว ส่งข้อความนี้');
      await expect(input).toHaveValue('');
      await expect(mic).toBeEnabled();
      await mic.click();
      await page.evaluate(roomB => {
        window.staleVoice = window.voiceInstances.at(-1).onresult;
        window.history.pushState({}, '', '/inbox/' + roomB);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, roomB);
      await expect(input).toHaveValue('');
      await expect(mic).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.voiceInstances.at(-1).aborted)).toBe(true);
      await page.evaluate(() => window.staleVoice({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'ของห้องเก่า' } }] }));
      await expect(input).toHaveValue('');
      await mic.click();
      await page.getByRole('radio', { name: 'โน้ตภายใน', exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.voiceInstances.at(-1).aborted)).toBe(true);
      await expect(page.getByRole('textbox', { name: 'พิมพ์โน้ตภายใน', exact: true })).toHaveValue('');
      await page.getByRole('radio', { name: 'ตอบลูกค้า', exact: true }).click();
      await mic.click();
      await page.evaluate(() => window.voiceInstances.at(-1).onerror({ error: 'not-allowed' }));
      await expect(page.getByText(/เปิดไมค์ไม่ได้ กรุณาอนุญาต/)).toBeVisible();
      await input.fill('ยังพิมพ์ได้');
      await expect(send).toBeEnabled();
      // Feature unavailable: usable keyboard input and a visible dictation fallback.
      await page.evaluate(() => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; });
      await input.fill('พิมพ์ต่อ');
      await expect(page.getByText(/เบราว์เซอร์นี้ยังใช้ปุ่มไมค์ไม่ได้/)).toBeVisible();
      await expect(send).toBeEnabled();
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
}
