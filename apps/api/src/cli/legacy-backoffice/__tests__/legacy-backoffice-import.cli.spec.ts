import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { main } from '../legacy-backoffice-import.cli';

/** ตัว CLI — เฉพาะด่านที่ต้องทำงานก่อนอ่านไฟล์ใด ๆ (ไม่มีไฟล์จริงในเทส) */

describe('legacy-backoffice-import CLI', () => {
  // โฟลเดอร์ใน repo ที่ไม่มีอยู่จริง — ด่านต้องปฏิเสธก่อนสร้าง และก่อนอ่าน --dump (ซึ่งไม่มีอยู่จริงเช่นกัน)
  const insideRepo = resolve(__dirname, '..', '__out-must-not-exist__');
  const missing = join(__dirname, '__missing__');

  it.each([
    ['peak-recon', ['--dump', `${missing}.sql`, '--peak-ar', `${missing}.csv`]],
    [
      'match-statement',
      ['--dump', `${missing}.sql`, '--statement', `${missing}.csv`, '--cols', 'date=d,amount=a'],
    ],
  ])('%s refuses --out inside the repo before reading anything', async (command, args) => {
    // ด่านเขตเวลาตัวแทน — jest ให้สำเนา process.env จึงตั้ง TZ จริงไม่ได้บนเครื่อง UTC (cli.spec.ts ทดสอบตัวด่าน)
    const noTz = () => undefined;
    await expect(main([command, ...args, '--out', insideRepo], undefined, noTz)).rejects.toThrow(
      /ห้ามเขียนผลลัพธ์ลงในโฟลเดอร์ของ repo/,
    );
    expect(existsSync(insideRepo)).toBe(false);
  });
});
