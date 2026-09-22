import { collectAttachmentsFromToolResult, BotAttachment, MAX_BOT_ATTACHMENTS } from './bot-attachments.util';

// รีวิว ATTACH-1 / TOOLLOOP-2 (2026-09-22): เพดานแนบ 2 ใบใช้ร่วมกันทั้งรูปสินค้าและรูปตาราง —
// รูปสินค้าจาก search_products/calculate_installment เคยกินช่องหมดแล้วรูปตารางที่บอทตั้งใจส่งถูกทิ้งเงียบ
describe('collectAttachmentsFromToolResult — รูปตาราง (send_rate_card) ชนะรูปสินค้าเมื่อช่องเต็ม', () => {
  const productUnits = {
    groups: [
      {
        units: [
          { id: 'p1', photoUrl: 'https://cdn.example.com/p1.jpg', model: 'iPhone 13' },
          { id: 'p2', photoUrl: 'https://cdn.example.com/p2.jpg', model: 'iPhone 13' },
        ],
      },
    ],
  };
  const cards = (...keys: string[]) => ({
    images: keys.map((k) => ({ id: `card:${k}`, photoUrl: `https://s.example.com/${k}.jpg`, productName: k })),
  });

  it('รูปสินค้าเต็ม 2 ช่อง → รูปตาราง 1 ใบถอดรูปสินค้าที่ใส่ก่อนสุดออก', () => {
    const into = new Map<string, BotAttachment>();
    collectAttachmentsFromToolResult('search_products', productUnits, into);
    collectAttachmentsFromToolResult('send_rate_card', cards('shop_map'), into);
    expect([...into.keys()]).toEqual(['p2', 'card:shop_map']);
  });

  it('รูปตาราง 2 ใบ → แทนรูปสินค้าทั้งคู่ (ไม่เกินเพดาน)', () => {
    const into = new Map<string, BotAttachment>();
    collectAttachmentsFromToolResult('search_products', productUnits, into);
    collectAttachmentsFromToolResult('send_rate_card', cards('used_rate1', 'used_rate2'), into);
    expect([...into.keys()]).toEqual(['card:used_rate1', 'card:used_rate2']);
    expect(into.size).toBe(MAX_BOT_ATTACHMENTS);
  });

  it('ช่องเต็มด้วยรูปตารางแล้ว → รูปตารางใบที่ 3 ไม่ถูกแนบ (ผู้เรียกกระทบยอดเป็น missing)', () => {
    const into = new Map<string, BotAttachment>();
    collectAttachmentsFromToolResult('send_rate_card', cards('used_rate1', 'used_rate2'), into);
    collectAttachmentsFromToolResult('send_rate_card', cards('shop_map'), into);
    expect([...into.keys()]).toEqual(['card:used_rate1', 'card:used_rate2']);
  });

  it('รูปตารางที่ลิงก์ใช้ไม่ได้ ไม่ถอดรูปสินค้าทิ้งฟรี ๆ', () => {
    const into = new Map<string, BotAttachment>();
    collectAttachmentsFromToolResult('search_products', productUnits, into);
    collectAttachmentsFromToolResult(
      'send_rate_card',
      { images: [{ id: 'card:shop_map', photoUrl: 'http://not-https/map.jpg' }] },
      into,
    );
    expect([...into.keys()]).toEqual(['p1', 'p2']);
  });

  it('รูปสินค้ามาทีหลังรูปตาราง → ไม่ดันรูปตารางออก', () => {
    const into = new Map<string, BotAttachment>();
    collectAttachmentsFromToolResult('send_rate_card', cards('used_rate1', 'used_rate2'), into);
    collectAttachmentsFromToolResult(
      'calculate_installment',
      { productId: 'p9', photoUrl: 'https://cdn.example.com/p9.jpg' },
      into,
    );
    expect([...into.keys()]).toEqual(['card:used_rate1', 'card:used_rate2']);
  });
});

// review round 1 [I1]: util รับ string อะไรก็ได้เป็น imageUrl/webUrl ทั้งที่คอมเมนต์ในไฟล์เอง
// เขียนว่า "public HTTPS เท่านั้น" — วันนี้ inert (Task 3/4 ยังไม่ emit shape นี้จริง) แต่พอ
// Task 9 wire เข้า MessageRouter ค่า non-https (storage key ดิบ / http:// / line:// deep link)
// จะไปตายปลายทางแบบไม่มี error message ที่ตรงสาเหตุ — เทสต์นี้พิสูจน์ว่า util กรองเองที่ต้นทาง
describe('collectAttachmentsFromToolResult — HTTPS-only URL filter (review round 1, I1)', () => {
  it('ข้าม imageUrl/webUrl ที่ไม่ใช่ public https:// เงียบ ๆ — storage key ดิบ / http:// / line://', () => {
    const cases: Record<string, unknown>[] = [
      // storage key ดิบ ไม่มี scheme เลย (เช่นค่าที่มาจาก S3 object key)
      {
        productId: 'prd-a',
        photoUrl: 'products/prd-a/photo.jpg',
        webUrl: 'shop.example.com/products/prd-a',
      },
      // http:// (ไม่ใช่ HTTPS)
      {
        productId: 'prd-b',
        photoUrl: 'http://cdn.example.com/p.jpg',
        webUrl: 'http://shop.example.com/products/prd-b',
      },
      // line:// deep link (ไม่ใช่ public HTTPS URL)
      {
        productId: 'prd-c',
        photoUrl: 'line://app/xyz',
        webUrl: 'line://app/products/prd-c',
      },
    ];

    for (const result of cases) {
      const into = new Map<string, BotAttachment>();
      collectAttachmentsFromToolResult('calculate_installment', result, into);
      expect(into.size).toBe(0);
    }
  });
});
