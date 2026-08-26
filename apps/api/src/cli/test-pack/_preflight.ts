import type { PrismaService } from '../../prisma/prisma.service';
import type { SeedRefs } from './_types';

/** บัญชีที่แผนเดินเรื่อง (เฟส 3) แตะ — ขาดตัวใดตัวหนึ่ง = ยังไม่ได้รัน seed:coa */
export const DRIVE_REQUIRED_ACCOUNTS: string[] = [
  '11-1101',
  '11-2101',
  '11-2103',
  '11-2106',
  '21-1101',
  '21-1102',
  '21-2101',
  '21-2102',
  'S11-1101',
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

export async function runPreflight(
  prisma: PrismaService,
  refs: SeedRefs,
  opts: { drive: boolean; postDate: Date },
): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];

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

  return { ok: problems.length === 0, problems };
}
