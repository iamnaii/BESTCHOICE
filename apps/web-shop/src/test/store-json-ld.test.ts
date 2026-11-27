// @vitest-environment node
// (ภายใต้ jsdom import.meta.url ไม่ใช่ file: URL — อ่านไฟล์นอก src/ ไม่ได้)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shopInfo } from '@/lib/copy';

/**
 * JSON-LD ของร้านใน index.html เป็นข้อความตายตัว (อยู่ใน HTML ทุกหน้า ทั้งหน้า prerender และ spa-shell)
 * แต่ข้อเท็จจริงของร้านมีแหล่งเดียวคือ shopInfo ใน copy.ts — เทสต์นี้กันสองที่เดินแยกกัน
 * (Google / AI ไม่เชื่อว่าเป็นธุรกิจเดียวกันเมื่อ ชื่อ ที่อยู่ เบอร์ ไม่ตรงกัน)
 */
const indexHtml = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
const store = JSON.parse(
  /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(indexHtml)![1],
) as Record<string, unknown>;

const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const [, opens, closes] = /(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/.exec(shopInfo.hours)!;

describe('JSON-LD ร้านใน index.html ตรงกับ shopInfo (copy.ts)', () => {
  it('ที่อยู่ เบอร์ และช่องทางติดต่อ', () => {
    const address = store.address as Record<string, string>;
    expect(shopInfo.address.startsWith(address.streetAddress)).toBe(true);
    expect(shopInfo.address).toContain(address.postalCode);
    expect(store.telephone).toBe(shopInfo.phoneHref.replace('tel:', ''));
    expect(store.sameAs).toEqual(
      expect.arrayContaining([shopInfo.lineUrl, shopInfo.facebookPageUrl]),
    );
  });

  // ผลตรวจ SEO 27 พ.ย. 2569 ข้อ 11 — ส่วนที่ไม่ต้องใช้พิกัด (geo รอเจ้าของส่งพิกัด)
  it('มี @id ถาวรของร้าน', () => {
    expect(store['@id']).toBe('https://www.bestchoicephone.com/#store');
  });

  it('hasMap = ลิงก์ Google Maps ของร้าน (place_id เดียวกับปุ่มนำทาง)', () => {
    expect(store.hasMap).toBe(shopInfo.mapsUrl);
  });

  it('เวลาเปิด-ปิดทั้งสองรูปแบบ = เวลาใน shopInfo.hours (เปิดทุกวัน)', () => {
    expect(shopInfo.hours).toContain('ทุกวัน');
    expect(store.openingHours).toBe(`Mo-Su ${opens}-${closes}`);
    expect(store.openingHoursSpecification).toEqual([
      { '@type': 'OpeningHoursSpecification', dayOfWeek: WEEK, opens, closes },
    ]);
  });
});
