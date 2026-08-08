import { collectAttachmentsFromToolResult, BotAttachment } from './bot-attachments.util';

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
