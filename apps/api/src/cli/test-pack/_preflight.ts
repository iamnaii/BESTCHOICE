import type { PrismaService } from '../../prisma/prisma.service';
import { validatePeriodOpen } from '../../utils/period-lock.util';
import type { SeedRefs } from './_types';

/**
 * บัญชีที่แผนเดินเรื่อง (เฟส 3) แตะ — ขาดตัวใดตัวหนึ่ง = ยังไม่ได้รัน seed:coa
 *
 * หมายเหตุ S21-2001 (เจ้าหนี้เงินดาวน์) **จงใจไม่อยู่ในลิสต์** — สัญญา DRAFT ของ pack
 * ตั้ง downPayment = 0 โดยเจตนา (ดู contracts.seed.ts ด่านข้อ 7) ⇒ ทั้งขา ShopDownPayment
 * catch-up ใน activate และขาล้างดาวน์ใน ShopInventoryTransferTemplate เป็นศูนย์/ถูกข้าม
 * โดยโครงสร้าง — อย่า "เติมให้ครบ" โดยไม่มีผู้โพสต์จริง
 */
export const DRIVE_REQUIRED_ACCOUNTS: string[] = [
  '11-1101',
  '11-1201', // เอกสาร DRAW ของ equity seeder จ่ายผ่านธนาคาร KBank (Task 12)
  '22-1102', // ถอนใช้ส่วนตัว (Contra) — ขา Dr ของ DRAW (Task 12)
  '11-2101',
  '11-2103',
  '11-2106',
  '21-1101',
  '21-1102',
  '21-2101',
  '21-2102',
  '42-1103', // ค่าปรับล่าช้า — PaymentReceipt2B เครดิตทุกครั้งที่งวดมีค่าปรับ ณ วันโพสต์ (fix round 1)
  'S11-1101',
  'S11-1201', // ขาย/มัดจำในโหมดเดินเรื่องใช้ BANK_TRANSFER → SHOP receiving bank (Task 12)
  'S11-2001',
  'S11-3001',
  'S11-3002',
  'S11-3101',
  'S21-2002',
  'S41-1101',
  'S41-1201', // ค่าคอมจาก FINANCE — ShopInventoryTransferTemplate เครดิตเมื่อ commission > 0 (สัญญา DRAFT มี 1,990 เสมอ)
  'S50-1101',
  // มือสอง: ก้าวขายสด + ขายไฟแนนซ์แชร์ตัวเลือกเครื่อง orderBy imeiSerial เดียวกัน —
  // ก้าว 3 ใช้เครื่อง PHONE_NEW ไป ก้าว 4 จึงได้เครื่องมือสอง (resolver → คู่ S*-*102)
  'S11-2002',
  'S50-1102',
  'S41-1102',
  // อุปกรณ์เสริม: รันเดินเรื่องซ้ำหลังโทรศัพท์สองเครื่องถูกขายไป ก้าวขายจะหยิบหูฟัง
  // (ACCESSORY → คู่ S*-*103) — ประกาศไว้ให้ invariant "ขาด = ยังไม่ seed:coa" เป็นจริง
  'S11-2003',
  'S50-1103',
  'S41-1103',
  'S51-1106',
];

export function missingAccounts(required: string[], present: string[]): string[] {
  const have = new Set(present);
  return required.filter((c) => !have.has(c));
}

/**
 * POST_DATE ที่พิมพ์ผิด (เช่น 2026-13-99) ต้องกลายเป็นปัญหาไทยในลิสต์ ไม่ใช่ stack trace —
 * Invalid Date ทำให้ getUTCFullYear()/getUTCMonth() เป็น NaN แล้ว query งวดบัญชีโยน
 * PrismaClientValidationError หลุดไปถึง main().catch เป็น FATAL.
 * Pure function: ตัดสินจาก Date ที่ parse แล้ว; `raw` ใช้ระบุค่าที่ operator พิมพ์ในข้อความ.
 */
export function invalidPostDateProblem(postDate: Date, raw?: string): string | null {
  if (!Number.isNaN(postDate.getTime())) return null;
  const typed = raw ?? String(postDate);
  return `POST_DATE="${typed}" ไม่ใช่วันที่ที่ถูกต้อง — ใช้รูปแบบ POST_DATE=YYYY-MM-DD (เช่น POST_DATE=2026-08-01) แล้วรันใหม่`;
}

export async function runPreflight(
  prisma: PrismaService,
  refs: SeedRefs,
  opts: { drive: boolean; postDate: Date; postDateRaw?: string },
): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];

  // POST_DATE พิมพ์ผิด = เก็บเป็นปัญหาแล้วตรวจข้ออื่นต่อ (ห้าม throw / ห้ามตัดเช็คอื่นทิ้ง)
  const postDateProblem = invalidPostDateProblem(opts.postDate, opts.postDateRaw);
  if (postDateProblem) problems.push(postDateProblem);

  // ข้อ 2 — ข้อมูลอ้างอิง (resolveRefs โยนไปแล้วถ้าขาด branch/user; ที่นี่ตรวจนิติบุคคล)
  if (!refs.shopCompanyId) problems.push('ไม่พบนิติบุคคล SHOP ใน company_info');
  if (!refs.financeCompanyId) problems.push('ไม่พบนิติบุคคล FINANCE ใน company_info');

  if (!opts.drive) return { ok: problems.length === 0, problems };

  // ข้อ 3 — ผังบัญชีครบไหม
  const rows = await prisma.chartOfAccount.findMany({
    where: { code: { in: DRIVE_REQUIRED_ACCOUNTS }, deletedAt: null },
    select: { code: true },
  });
  const missing = missingAccounts(
    DRIVE_REQUIRED_ACCOUNTS,
    rows.map((r) => r.code),
  );
  if (missing.length) {
    problems.push(
      `ผังบัญชีขาด ${missing.length} รหัส: ${missing.join(', ')} — รัน "npm --prefix apps/api run seed:coa" ก่อน แล้วค่อยรันใหม่`,
    );
  }

  // ข้อ 4 — งวดบัญชีของวันที่จะโพสต์ต้องรับรายการได้ทั้งสองฝั่ง (B2, 2026-08-26):
  // เรียก validatePeriodOpen ตัวเดียวกับที่ทุกเส้นทางลงบัญชีจริงใช้ — ได้ทั้ง grace window
  // (`period_grace_days`, default 5 วันหลังสิ้นเดือน: งวด CLOSED/SYNCED ยังโพสต์ได้) และ
  // การอ่านเดือนแบบ getFullYear/getMonth เดียวกับ guard ⇒ preflight เข้มหรือหย่อนกว่า
  // ด่านจริงไม่ได้โดยโครงสร้าง. เดิมเช็ค `status !== 'OPEN'` เอง ซึ่งปฏิเสธงวด CLOSED
  // ที่ยังอยู่ในช่วงผ่อนผัน — เข้มกว่า production แล้วชี้ทางแก้ที่เป็นอันตราย (สั่งเปิดงวด
  // ทั้งที่ไม่จำเป็น). (ตรวจได้เฉพาะเมื่อ POST_DATE ใช้การได้ — Invalid Date ทำให้ query โยน)
  if (!postDateProblem) {
    for (const [name, companyId] of [
      ['SHOP', refs.shopCompanyId],
      ['FINANCE', refs.financeCompanyId],
    ] as const) {
      if (!companyId) continue;
      try {
        await validatePeriodOpen(prisma, opts.postDate, companyId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        problems.push(
          `งวดบัญชีฝั่ง ${name} ไม่รับรายการ ณ วันที่จะโพสต์: ${msg} — ทางที่ทำได้จริง: ` +
            'เลือก POST_DATE=YYYY-MM-DD ในเดือนที่งวดยังเปิด/ยังอยู่ในช่วงผ่อนผัน ' +
            '(ข้อแลก: ก้าวที่ลงบัญชี ณ วันปัจจุบันเสมอ เช่น เปิดสัญญา/ขาย/มัดจำ จะถูกข้ามเมื่อเดือนไม่ตรงเดือนนี้ — ผลรันจะบอกว่าข้ามเพราะอะไร) ' +
            'หรือให้ OWNER เปิดงวดนั้นใหม่ที่หน้าตั้งค่า › งวดบัญชี (/settings) แล้วรันใหม่',
        );
      }
    }
  }

  return { ok: problems.length === 0, problems };
}
