import { CustomerAnalyticsService } from './customer-analytics.service';
import { renderSqlCall } from '../../../utils/__tests__/raw-sql-call';

/** GET /customers/watch-list — "ชำระล่าช้า" เทียบวันตามปฏิทินไทย (2026-11-18) */
const LATE =
  "p.paid_date IS NOT NULL AND ((p.paid_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date > ((p.due_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date";

describe('CustomerAnalyticsService.getWatchList — งวดล่าช้านับตามวันไทย', () => {
  const prisma = { $queryRaw: jest.fn() };
  const service = new CustomerAnalyticsService(prisma as never, {} as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
  });

  it('เงื่อนไขล่าช้าทั้งสามจุด (นับ · HAVING · ลำดับคะแนน) ใช้วันไทยของ paid_date และ due_date', async () => {
    await service.getWatchList(undefined, 30);
    const { text, values } = renderSqlCall(prisma.$queryRaw.mock.calls[0]);
    expect(text.split(LATE)).toHaveLength(4);
    expect(text).not.toContain('p.paid_date::date');
    expect(values).toEqual([30]);
  });

  it('กรองสาขาและ limit ยังเป็นพารามิเตอร์ตามลำดับเดิม', async () => {
    await service.getWatchList('b1', 10);
    expect(renderSqlCall(prisma.$queryRaw.mock.calls[0]).values).toEqual(['b1', 10]);
  });

  it('จำนวนงวดล่าช้าจาก SQL ยังแปลงเป็นเหตุผล/คะแนนแบบเดิม', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        customerId: 'cu1', customerName: 'ก', customerPhone: '0800000000', contractId: 'c1', contractNumber: 'CT-1',
        latePaymentCount: BigInt(2), partialPaymentCount: BigInt(0), hadDunningReset: false, dunningStage: 'NONE',
        totalMonths: 10, paidCount: BigInt(4), nextDueDate: null, nextAmountDue: null,
      },
    ]);
    const res = await service.getWatchList(undefined, 30);
    expect(res.watchList[0]).toMatchObject({ latePaymentCount: 2, riskScore: 2, riskLevel: 'LOW', reasons: ['ชำระล่าช้า 2 ครั้ง'] });
  });
});
