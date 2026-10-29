import { describe, expect, it } from 'vitest';
// `?raw` ของ Vite — อ่านไฟล์จริงจาก public/
import raw from '../../../../public/kiosk/manifest.webmanifest?raw';

/** ก้อน 10 D3 รีวิว minor — manifest ของเครื่องตอกบัตร: start_url ต้องอยู่ใน scope ไม่งั้นเบราว์เซอร์ใช้ scope "/" (ทับแอปหลัก) */
describe('kiosk web manifest', () => {
  it('KM1 start_url is inside scope and both stay under /kiosk', () => {
    const m = JSON.parse(raw as string) as { start_url: string; scope: string };
    expect(m.start_url.startsWith(m.scope)).toBe(true);
    expect(m.scope.startsWith('/kiosk')).toBe(true);
  });
});
