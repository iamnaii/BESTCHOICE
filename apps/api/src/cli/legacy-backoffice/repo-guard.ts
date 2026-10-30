import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * กันไม่ให้ไฟล์ผลลัพธ์ของตัวนำเข้า (มีข้อมูลลูกค้าจริง) ถูกเขียนลงในโฟลเดอร์ของ repo — repo เป็นสาธารณะ
 * ไฟล์ที่ไม่ได้ track ใน repo ถูก commit ติดไปได้ง่าย
 */

/** `outPath` อยู่ใน `repoRoot` (หรือคือตัวมันเอง) — เทียบ path ที่ resolve แล้วเท่านั้น ไม่แตะไฟล์ */
export function isInsideRepo(outPath: string, repoRoot: string): boolean {
  const rel = relative(resolve(repoRoot), resolve(outPath));
  // ชื่อโฟลเดอร์ที่ขึ้นต้นด้วย ".." (เช่น "..data") ยังอยู่ข้างใน — เทียบทั้งส่วนของ path ไม่ใช่ตัวอักษร
  return !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/**
 * ทุกโฟลเดอร์ตั้งแต่ `from` ขึ้นไปที่มี `.git` (ไฟล์ = worktree · โฟลเดอร์ = checkout หลัก) เรียงจากใกล้ไปไกล
 * — worktree อยู่ใต้ checkout หลัก จึงต้องกันทั้งสองชั้น
 */
export function findRepoRoots(from: string): string[] {
  const roots: string[] = [];
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, '.git'))) roots.push(dir);
    const parent = dirname(dir);
    if (parent === dir) return roots;
    dir = parent;
  }
}

/** path จริงของ `p` — ตามลิงก์ของส่วนที่มีอยู่แล้ว (โฟลเดอร์ผลลัพธ์อาจยังไม่ถูกสร้าง) */
function canonical(p: string): string {
  let existing = resolve(p);
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    rest.unshift(basename(existing));
    existing = parent;
  }
  return join(realpathSync.native(existing), ...rest);
}

/** `outPath` อยู่ใน repo ที่ครอบ `from` (ค่าเริ่มต้น = โฟลเดอร์ของโค้ดนี้) → throw ข้อความไทย */
export function assertOutsideRepo(outPath: string, from: string = __dirname): void {
  const out = canonical(outPath);
  for (const root of findRepoRoots(from)) {
    if (isInsideRepo(out, canonical(root))) {
      throw new Error(
        `ห้ามเขียนผลลัพธ์ลงในโฟลเดอร์ของ repo (${root}) — repo เป็นสาธารณะ และไฟล์ผลลัพธ์มีข้อมูลลูกค้าจริง · ` +
          `ระบุ --out เป็นโฟลเดอร์นอก repo`,
      );
    }
  }
}
