import type { PrismaService } from '../../prisma/prisma.service';
import type { SeedRefs } from './_types';

/** บัญชีที่แผนเดินเรื่อง (เฟส 3) แตะ — ขาดตัวใดตัวหนึ่ง = ยังไม่ได้รัน seed:coa */
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
  'S11-1101',
  'S11-1201', // ขาย/มัดจำในโหมดเดินเรื่องใช้ BANK_TRANSFER → SHOP receiving bank (Task 12)
  'S11-2001',
  'S11-3001',
  'S11-3002',
  'S11-3101',
  'S21-2002',
  'S41-1101',
  'S50-1101',
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

  // ข้อ 4 — งวดบัญชีของวันที่จะโพสต์ต้องเปิดทั้งสองฝั่ง
  // (ตรวจได้เฉพาะเมื่อ POST_DATE ใช้การได้ — year/month ที่เป็น NaN จะทำให้ query โยน)
  if (!postDateProblem) {
    const year = opts.postDate.getUTCFullYear();
    const month = opts.postDate.getUTCMonth() + 1;
    for (const [name, companyId] of [
      ['SHOP', refs.shopCompanyId],
      ['FINANCE', refs.financeCompanyId],
    ] as const) {
      if (!companyId) continue;
      const period = await prisma.accountingPeriod.findFirst({
        where: { companyId, year, month },
        select: { status: true },
      });
      if (period && period.status !== 'OPEN') {
        problems.push(
          `งวดบัญชี ${year}-${String(month).padStart(2, '0')} ของ ${name} สถานะ ${period.status} — เปิดงวดก่อน หรือใช้ POST_DATE=YYYY-MM-DD ชี้ไปเดือนที่ยังเปิด`,
        );
      }
    }
  }

  return { ok: problems.length === 0, problems };
}
