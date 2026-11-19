import { Prisma, PrismaClient } from '@prisma/client';
import { getRateForMonths } from './get-rate-for-months.util';

const mockPrisma = {
  interestConfigRate: {
    findMany: jest.fn(),
  },
  interestConfig: {
    findUnique: jest.fn(),
  },
} as unknown as PrismaClient;

const rateRows = (...rows: Array<[number, string]>) =>
  rows.map(([months, ratePct]) => ({ months, ratePct: new Prisma.Decimal(ratePct) }));

describe('getRateForMonths', () => {
  const previousFlag = process.env.USE_NEW_RATE_LOOKUP;
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    if (previousFlag === undefined) delete process.env.USE_NEW_RATE_LOOKUP;
    else process.env.USE_NEW_RATE_LOOKUP = previousFlag;
  });

  it('มีแถวรายงวด → ใช้อัตราของงวดนั้น และอ่านเฉพาะแถวที่ยังไม่ถูกลบ', async () => {
    (mockPrisma.interestConfigRate.findMany as jest.Mock).mockResolvedValue(
      rateRows([10, '0.5'], [12, '0.5']),
    );
    const rate = await getRateForMonths(mockPrisma, 'config-1', 12);
    expect(rate.toString()).toBe('0.5');
    expect(mockPrisma.interestConfigRate.findMany).toHaveBeenCalledWith({
      where: { configId: 'config-1', deletedAt: null },
      select: { months: true, ratePct: true },
      orderBy: { months: 'asc' },
    });
    expect(mockPrisma.interestConfig.findUnique).not.toHaveBeenCalled();
  });

  it('มีแถวรายงวดแต่ไม่มีงวดที่ขอ → ปฏิเสธพร้อมบอกงวดที่เลือกได้', async () => {
    (mockPrisma.interestConfigRate.findMany as jest.Mock).mockResolvedValue(
      rateRows([10, '0.5'], [12, '0.5']),
    );
    await expect(getRateForMonths(mockPrisma, 'config-1', 6)).rejects.toThrow(
      'ไม่มีอัตราดอกเบี้ยสำหรับ 6 งวด — เลือกได้: 10, 12 งวด',
    );
  });

  it('ไม่มีแถวรายงวดเลย → ดอกเบี้ยต่อเดือน × งวด', async () => {
    (mockPrisma.interestConfigRate.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.interestConfig.findUnique as jest.Mock).mockResolvedValue({
      interestRate: new Prisma.Decimal('0.05'),
    });
    const rate = await getRateForMonths(mockPrisma, 'config-1', 10);
    expect(rate.toFixed(4)).toBe('0.5000');
  });

  it('ผลไม่ขึ้นกับ env USE_NEW_RATE_LOOKUP', async () => {
    (mockPrisma.interestConfigRate.findMany as jest.Mock).mockResolvedValue(rateRows([12, '0.5']));
    process.env.USE_NEW_RATE_LOOKUP = 'false';
    expect((await getRateForMonths(mockPrisma, 'config-1', 12)).toString()).toBe('0.5');
    process.env.USE_NEW_RATE_LOOKUP = 'true';
    expect((await getRateForMonths(mockPrisma, 'config-1', 12)).toString()).toBe('0.5');
  });

  it('ไม่มีแถวรายงวดและไม่พบตั้งค่าดอกเบี้ย → ปฏิเสธ', async () => {
    (mockPrisma.interestConfigRate.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.interestConfig.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(getRateForMonths(mockPrisma, 'config-1', 12)).rejects.toThrow(/ไม่พบ InterestConfig/);
  });

  it('ตั้งค่าดอกเบี้ยถูกลบ → ปฏิเสธ', async () => {
    (mockPrisma.interestConfigRate.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.interestConfig.findUnique as jest.Mock).mockResolvedValue({
      interestRate: new Prisma.Decimal('0.05'),
      deletedAt: new Date(),
    });
    await expect(getRateForMonths(mockPrisma, 'config-1', 12)).rejects.toThrow(/ไม่พบ InterestConfig/);
  });
});
