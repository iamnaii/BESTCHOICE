import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

/**
 * เจ้าของสั่ง 28 พ.ย. 2569 "เปลี่ยนเป็นมือ 2 ทั้งร้าน": ข้อความที่ลูกค้าเห็นบนหน้าร้านใช้คำว่า "มือ 2"
 * คำว่า "มือสอง" เหลือได้เฉพาะส่วนที่ Google อ่าน (ชื่อหน้า · คำอธิบายหน้า · ที่อยู่ของหน้า) และหน้าเจาะคำค้น
 * "iPhone มือสอง ลพบุรี" ซึ่งทั้งหน้าตั้งใจให้ตรงกับคำที่คนค้น — เพิ่มข้อยกเว้นใหม่ต้องเป็นส่วนของ Google เท่านั้น
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** ทั้งไฟล์เป็นของ Google / หน้าเจาะคำค้น */
const ALLOWED_FILES = new Set([
  'hooks/usePageMeta.ts', // คำอธิบายหน้าตั้งต้น
  'lib/product-meta.ts', // ชื่อหน้าและคำอธิบายของหน้าสินค้า
  'pages/landing/UsedIphoneLopburiPage.tsx', // หน้าเจาะคำค้น "iPhone มือสอง ลพบุรี"
]);

/** ข้อความที่ยกเว้นทีละจุด: ที่อยู่/ชื่อของหน้าเจาะคำค้น และคำอธิบายหน้าที่ส่งให้ usePageMeta */
const ALLOWED_SNIPPETS = [
  '/iphone-มือสอง-ลพบุรี',
  'iPhone มือสอง ลพบุรี',
  'รู้จัก BESTCHOICE ร้านมือถือลพบุรี ขาย iPhone มือ 1 และมือสองของแท้',
  "'iPhone มือ 1 และมือสอง ผ่อนบัตรประชาชนใบเดียว'",
  "'iPhone มือ 1 และมือสอง ตรวจ 30 จุด ผ่อนบัตรประชาชนใบเดียว ร้านมือถือลพบุรี'",
  'ทักไลน์หรือโทรสอบถามซื้อ-ผ่อน iPhone มือ 1 และมือสอง',
  "'iPhone มือ 1 และมือสองคุณภาพ ผ่อนได้บัตรประชาชนใบเดียว ไม่เช็กบูโร",
  "'วิธีผ่อน iPhone มือ 1 และมือสองบัตรประชาชนใบเดียว 3 ขั้นตอนง่ายๆ",
  "'โปรโมชันและส่วนลด iPhone มือ 1 และมือสองผ่อนได้บัตรประชาชนใบเดียว ร้านมือถือลพบุรี'",
  "ใช้บัตรประชาชนใบเดียว ผ่อน iPhone มือ 1 และมือสองได้สูงสุด 15 งวด ดาวน์เริ่ม 0 บาท'",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

/** ตัดคอมเมนต์ออกโดยคงจำนวนบรรทัดเดิม — คอมเมนต์ไม่ใช่ข้อความที่ลูกค้าเห็น */
function withoutComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

it('ข้อความที่ลูกค้าเห็นใช้ "มือ 2" — "มือสอง" เหลือเฉพาะส่วนของ Google', () => {
  const leftovers: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const name = relative(SRC, file);
    if (ALLOWED_FILES.has(name)) continue;
    withoutComments(readFileSync(file, 'utf8'))
      .split('\n')
      .forEach((line, i) => {
        if (!line.includes('มือสอง')) return;
        if (ALLOWED_SNIPPETS.some((snippet) => line.includes(snippet))) return;
        leftovers.push(`${name}:${i + 1} ${line.trim().slice(0, 90)}`);
      });
  }
  expect(leftovers).toEqual([]);
});
