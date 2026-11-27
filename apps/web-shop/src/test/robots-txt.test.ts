// @vitest-environment node
// (ภายใต้ jsdom import.meta.url ไม่ใช่ file: URL — อ่านไฟล์ใน public/ ไม่ได้)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROBOTS = readFileSync(
  fileURLToPath(new URL('../../public/robots.txt', import.meta.url)),
  'utf8',
);

/** แยกเป็นกลุ่มตาม User-agent (RFC 9309: บอทที่มีกลุ่มของตัวเองอ่านเฉพาะกลุ่มนั้น) */
function groups(): Array<{ agent: string; rules: string[] }> {
  const out: Array<{ agent: string; rules: string[] }> = [];
  for (const raw of ROBOTS.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('User-agent:')) {
      out.push({ agent: line.slice('User-agent:'.length).trim(), rules: [] });
    } else if (/^(Allow|Disallow):/.test(line) && out.length > 0) {
      out[out.length - 1].rules.push(line);
    }
  }
  return out;
}

const PHOTO_ALLOW = 'Allow: /api/shop/products/*/photos/';

describe('robots.txt — รูปสินค้า', () => {
  // รูปสินค้าอยู่ที่ /api/shop/products/:id/photos/:angle ซึ่งอยู่ใต้ Disallow: /api/
  it('ทุกกลุ่มที่บล็อก /api/ ต้องเปิดรูปสินค้าไว้ด้วย', () => {
    const blocking = groups().filter((g) => g.rules.includes('Disallow: /api/'));
    expect(blocking.length).toBeGreaterThan(0);
    for (const g of blocking) {
      expect(g.rules, `กลุ่ม ${g.agent}`).toContain(PHOTO_ALLOW);
    }
  });

  it('กลุ่มที่บล็อกทั้งเว็บ (Disallow: /) ไม่ถูกเปิดรูป', () => {
    const blocked = groups().filter((g) => g.rules.includes('Disallow: /'));
    for (const g of blocked) {
      expect(g.rules, `กลุ่ม ${g.agent}`).not.toContain(PHOTO_ALLOW);
    }
  });
});
