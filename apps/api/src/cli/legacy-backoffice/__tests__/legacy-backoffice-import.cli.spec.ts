import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { main } from '../legacy-backoffice-import.cli';

/** ตัว CLI — เฉพาะด่านที่ต้องทำงานก่อนอ่านไฟล์ใด ๆ (ไม่มีไฟล์จริงในเทส) */

describe('legacy-backoffice-import CLI', () => {
  // โฟลเดอร์ใน repo ที่ไม่มีอยู่จริง — ด่านต้องปฏิเสธก่อนสร้าง และก่อนอ่าน --dump (ซึ่งไม่มีอยู่จริงเช่นกัน)
  const insideRepo = resolve(__dirname, '..', '__out-must-not-exist__');
  const missing = join(__dirname, '__missing__');

  it.each([['peak-recon', ['--dump', `${missing}.sql`, '--peak-ar', `${missing}.csv`]]])(
    '%s refuses --out inside the repo before reading anything',
    async (command, args) => {
      await expect(main([command, ...args, '--out', insideRepo])).rejects.toThrow(
        /ห้ามเขียนผลลัพธ์ลงในโฟลเดอร์ของ repo/,
      );
      expect(existsSync(insideRepo)).toBe(false);
    },
  );
});
