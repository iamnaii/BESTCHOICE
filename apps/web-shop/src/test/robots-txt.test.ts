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

const group = (agent: string) => groups().find((g) => g.agent === agent);

const PHOTO_ALLOW = 'Allow: /api/shop/products/*/photos/';
const SHARE_ALLOW = 'Allow: /api/shop/share/';
/** บอทที่ API หน้าร้านตอบ 403 (ShopBotDefenseGuard) แต่ยังให้อ่านหน้าเว็บ — robots ต้องไม่เปิดเส้นใต้ /api/ ให้ */
const API_BLOCKED_AGENTS = ['CCBot'];

describe('robots.txt — รูปสินค้า', () => {
  // รูปสินค้าอยู่ที่ /api/shop/products/:id/photos/:angle ซึ่งอยู่ใต้ Disallow: /api/
  it('ทุกกลุ่มที่บล็อก /api/ ต้องเปิดรูปสินค้าไว้ด้วย (ยกเว้นบอทที่ API บล็อก)', () => {
    const blocking = groups().filter(
      (g) => g.rules.includes('Disallow: /api/') && !API_BLOCKED_AGENTS.includes(g.agent),
    );
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

  // เจ้าของเลือก 27 พ.ย. 2569: CCBot อ่านหน้าเว็บได้ทุกหน้า แต่รูปสินค้า/การ์ดแชร์ปิด
  // ให้ตรงกับ ShopBotDefenseGuard ที่ตอบ 403 ให้ CCBot ทุกเส้นใต้ /api/
  it('CCBot: เปิดหน้าเว็บ ปิดทุกเส้นใต้ /api/ (รวมรูปสินค้าและการ์ดแชร์)', () => {
    const ccbot = group('CCBot');
    expect(ccbot?.rules).toContain('Allow: /');
    expect(ccbot?.rules).toContain('Disallow: /api/');
    expect(ccbot?.rules).not.toContain(PHOTO_ALLOW);
    expect(ccbot?.rules).not.toContain(SHARE_ALLOW);
  });
});

describe('robots.txt — กลุ่มบอท', () => {
  // ผลตรวจ SEO 27 พ.ย. 2569 ข้อ 6: เอกสาร Anthropic มีแค่ ClaudeBot / Claude-User / Claude-SearchBot
  it('ไม่มีกลุ่ม Anthropic-AI (ชื่อเลิกใช้) แต่ยังมีกลุ่ม ClaudeBot', () => {
    expect(group('Anthropic-AI')).toBeUndefined();
    expect(group('ClaudeBot')?.rules).toContain('Allow: /');
  });
});
