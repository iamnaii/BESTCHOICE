// @vitest-environment node
// (ภายใต้ jsdom import.meta.url ไม่ใช่ file: URL — อ่านไฟล์ใน public/ ไม่ได้)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const publicFile = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../public/${path}`, import.meta.url)), 'utf8');

// ผลตรวจ SEO 27 พ.ย. 2569 (เจ้าของเลือก "ไม่ให้ค้นเจอ"): เนื้อหาเป็นเว็บแอปที่ฝังไว้
// Google อ่านรายการเครื่องข้างในไม่ได้ เห็นเป็นหน้าว่าง — ลิงก์ที่ส่งให้ลูกค้ายังเปิดได้ตามปกติ
it('หน้า /stock มี noindex', () => {
  expect(publicFile('stock/index.html')).toMatch(
    /<meta\s+name="robots"\s+content="noindex"\s*\/?>/,
  );
});

it('หน้า /stock ไม่อยู่ใน sitemap (noindex กับ sitemap ขัดกัน)', () => {
  expect(publicFile('sitemap.xml')).not.toMatch(/<loc>[^<]*\/stock\/?<\/loc>/);
});
