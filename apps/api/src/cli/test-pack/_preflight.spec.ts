import type { PrismaService } from '../../prisma/prisma.service';
import type { SeedRefs } from './_types';
import {
  DRIVE_REQUIRED_ACCOUNTS,
  invalidPostDateProblem,
  missingAccounts,
  runPreflight,
} from './_preflight';

describe('missingAccounts', () => {
  it('คืนรหัสที่ขาด เรียงตามลำดับที่ต้องการ', () => {
    expect(missingAccounts(['S11-3101', 'S51-1106', 'S21-2002'], ['S21-2002'])).toEqual([
      'S11-3101',
      'S51-1106',
    ]);
  });

  it('มีครบ = คืน array ว่าง', () => {
    expect(missingAccounts(['11-1101'], ['11-1101', '11-2101'])).toEqual([]);
  });
});

describe('DRIVE_REQUIRED_ACCOUNTS', () => {
  it('มีบัญชีใหม่สามตัวที่ prod ต้องรัน seed:coa ถึงจะมี', () => {
    expect(DRIVE_REQUIRED_ACCOUNTS).toEqual(
      expect.arrayContaining(['S11-3101', 'S51-1106', 'S21-2002']),
    );
  });

  it('ไม่มีรหัสซ้ำ', () => {
    expect(new Set(DRIVE_REQUIRED_ACCOUNTS).size).toBe(DRIVE_REQUIRED_ACCOUNTS.length);
  });
});

describe('invalidPostDateProblem', () => {
  it('POST_DATE พิมพ์ผิด → ข้อความไทยที่ระบุค่าที่พิมพ์ + รูปแบบ YYYY-MM-DD', () => {
    const problem = invalidPostDateProblem(new Date('2026-13-99T00:00:00.000Z'), '2026-13-99');
    expect(problem).toContain('POST_DATE="2026-13-99"');
    expect(problem).toContain('YYYY-MM-DD');
  });

  it('วันที่ถูกต้อง → null', () => {
    expect(invalidPostDateProblem(new Date('2026-08-01T00:00:00.000Z'), '2026-08-01')).toBeNull();
  });
});

describe('runPreflight — POST_DATE + งวดบัญชี (ผ่าน validatePeriodOpen ตัวจริง)', () => {
  const refs: SeedRefs = {
    branchId: 'b1',
    branchName: 'สาขาทดสอบ',
    secondBranchId: null,
    salespersonId: 'u-sales',
    reviewerId: 'u-reviewer',
    ownerId: 'u-owner',
    shopCompanyId: 'c-shop',
    financeCompanyId: 'c-finance',
  };

  // Fake (ไม่ใช่ jest.mock ที่นับจำนวนครั้ง): ผังว่าง = เช็คข้อ 3 ต้องรายงาน "ผังบัญชีขาด",
  // และ findUnique เลียนแบบ Prisma จริง — filter Int ที่เป็น NaN โยน PrismaClientValidationError
  // ⇒ ถ้า guard หาย เทสนี้ล้มด้วย rejection จริง ไม่ใช่แค่ assertion บน mock.
  // periodStatus = สถานะงวดที่ findUnique จะคืนให้ทุก (company, year, month) ที่ถาม —
  // null = ไม่มีแถวงวด (validatePeriodOpen ถือว่าไม่ล็อก)
  const makeStub = (periodStatus: string | null) =>
    ({
      chartOfAccount: { findMany: async () => [] },
      systemConfig: { findUnique: async () => null }, // period_grace_days → default 5
      accountingPeriod: {
        findUnique: async (args: {
          where: { companyId_year_month: { companyId: string; year: number; month: number } };
        }) => {
          const { year, month } = args.where.companyId_year_month;
          if (Number.isNaN(year) || Number.isNaN(month)) {
            throw new Error('PrismaClientValidationError: NaN is not a valid Int');
          }
          return periodStatus ? { status: periodStatus } : null;
        },
      },
    }) as unknown as PrismaService;

  it('เก็บเป็นปัญหาในลิสต์เดียวกับเช็คผังบัญชี — ไม่ throw และไม่ตัดเช็คอื่นทิ้ง', async () => {
    const res = await runPreflight(makeStub(null), refs, {
      drive: true,
      postDate: new Date('2026-13-99T00:00:00.000Z'),
      postDateRaw: '2026-13-99',
    });
    expect(res.ok).toBe(false);
    expect(res.problems.some((p) => p.includes('POST_DATE="2026-13-99"'))).toBe(true);
    // เช็คผังบัญชี (ข้อ 3) ยังรันและรายงานตามปกติ — ปัญหาเดียวไม่ short-circuit ลิสต์
    expect(res.problems.some((p) => p.includes('ผังบัญชีขาด'))).toBe(true);
  });

  it('POST_DATE ถูกต้อง + งวดเปิด → ไม่มีปัญหา POST_DATE และไม่มีปัญหางวดบัญชี', async () => {
    const res = await runPreflight(makeStub('OPEN'), refs, {
      drive: true,
      postDate: new Date(),
      postDateRaw: undefined,
    });
    expect(res.problems.some((p) => p.includes('ไม่ใช่วันที่ที่ถูกต้อง'))).toBe(false);
    expect(res.problems.some((p) => p.includes('งวดบัญชี'))).toBe(false);
  });

  // assertion แยกแยะจริง (B2): mutant ที่ลบเช็คงวดทิ้งทั้งก้อนต้องล้มเทสนี้ —
  // งวด CLOSED ของเดือนที่พ้นช่วงผ่อนผันไปนานแล้ว ต้องโผล่เป็นปัญหาพร้อมข้อความไทย
  // ของ guard ตัวจริง (validatePeriodOpen) ครบทั้งสองฝั่งนิติบุคคล
  it('งวด CLOSED ที่พ้น grace แล้ว → ปัญหางวดบัญชีทั้งฝั่ง SHOP และ FINANCE พร้อมข้อความของ guard จริง', async () => {
    const res = await runPreflight(makeStub('CLOSED'), refs, {
      drive: true,
      postDate: new Date('2020-01-15T00:00:00.000Z'), // ม.ค. 2020 — grace (สิ้นเดือน+5วัน) พ้นไปนานแล้ว
      postDateRaw: '2020-01-15',
    });
    expect(res.ok).toBe(false);
    const periodProblems = res.problems.filter((p) =>
      p.includes('ไม่สามารถบันทึกรายการในงวดที่ปิดแล้ว'),
    );
    expect(periodProblems.some((p) => p.includes('ฝั่ง SHOP'))).toBe(true);
    expect(periodProblems.some((p) => p.includes('ฝั่ง FINANCE'))).toBe(true);
  });

  // preflight ห้ามเข้มกว่าด่านจริง: งวด CLOSED ของ "เดือนปัจจุบัน" ยังอยู่ในช่วงผ่อนผัน
  // (สิ้นเดือน + period_grace_days ≥ วันนี้เสมอ) — validatePeriodOpen ปล่อยผ่าน ⇒
  // preflight ต้องไม่รายงานปัญหางวด (เคสจริงบน prod: ส.ค. CLOSED แต่โพสต์ได้ถึง 5 ก.ย.)
  it('งวด CLOSED ของเดือนปัจจุบัน (ยังใน grace) → ไม่เป็นปัญหา — ตรงกับที่ production guard ปล่อยผ่าน', async () => {
    const res = await runPreflight(makeStub('CLOSED'), refs, {
      drive: true,
      postDate: new Date(),
      postDateRaw: undefined,
    });
    expect(res.problems.some((p) => p.includes('งวดบัญชี'))).toBe(false);
  });
});
