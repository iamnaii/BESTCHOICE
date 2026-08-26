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

describe('runPreflight — POST_DATE พิมพ์ผิด', () => {
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
  // และ findFirst เลียนแบบ Prisma จริง — filter Int ที่เป็น NaN โยน PrismaClientValidationError
  // ⇒ ถ้า guard หาย เทสนี้ล้มด้วย rejection จริง ไม่ใช่แค่ assertion บน mock
  const prismaStub = {
    chartOfAccount: { findMany: async () => [] },
    accountingPeriod: {
      findFirst: async (args: { where: { year: number; month: number } }) => {
        if (Number.isNaN(args.where.year) || Number.isNaN(args.where.month)) {
          throw new Error('PrismaClientValidationError: NaN is not a valid Int');
        }
        return null;
      },
    },
  } as unknown as PrismaService;

  it('เก็บเป็นปัญหาในลิสต์เดียวกับเช็คผังบัญชี — ไม่ throw และไม่ตัดเช็คอื่นทิ้ง', async () => {
    const res = await runPreflight(prismaStub, refs, {
      drive: true,
      postDate: new Date('2026-13-99T00:00:00.000Z'),
      postDateRaw: '2026-13-99',
    });
    expect(res.ok).toBe(false);
    expect(res.problems.some((p) => p.includes('POST_DATE="2026-13-99"'))).toBe(true);
    // เช็คผังบัญชี (ข้อ 3) ยังรันและรายงานตามปกติ — ปัญหาเดียวไม่ short-circuit ลิสต์
    expect(res.problems.some((p) => p.includes('ผังบัญชีขาด'))).toBe(true);
  });

  it('POST_DATE ถูกต้อง → ไม่มีปัญหา POST_DATE และเช็คงวดบัญชียังเดินตามปกติ', async () => {
    const res = await runPreflight(prismaStub, refs, {
      drive: true,
      postDate: new Date('2026-08-01T00:00:00.000Z'),
      postDateRaw: '2026-08-01',
    });
    expect(res.problems.some((p) => p.includes('ไม่ใช่วันที่ที่ถูกต้อง'))).toBe(false);
  });
});
