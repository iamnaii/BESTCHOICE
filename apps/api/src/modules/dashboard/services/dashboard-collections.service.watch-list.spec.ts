import { DashboardCollectionsService } from './dashboard-collections.service';
import { renderSqlCall } from '../../../utils/__tests__/raw-sql-call';

/** GET /dashboard/watch-list (การ์ดลูกค้าเฝ้าระวังบนแดชบอร์ดผู้บริหาร) — "ชำระล่าช้า" เทียบวันตามปฏิทินไทย (2026-11-18) */
const LATE =
  "p.paid_date IS NOT NULL AND ((p.paid_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date > ((p.due_date AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::date";

describe('DashboardCollectionsService.computeWatchList — งวดล่าช้านับตามวันไทย', () => {
  const prisma = { $queryRaw: jest.fn() };
  const service = new DashboardCollectionsService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
  });

  it('เงื่อนไขล่าช้าทั้งสามจุด (นับ · HAVING · ลำดับคะแนน) ใช้วันไทยของ paid_date และ due_date', async () => {
    await service.computeWatchList();
    const { text, values } = renderSqlCall(prisma.$queryRaw.mock.calls[0]);
    expect(text.split(LATE)).toHaveLength(4);
    expect(text).not.toContain('p.paid_date::date');
    expect(values).toEqual([]);
  });

  it('นับงวดละครั้ง: COUNT(DISTINCT p.id) · ไม่ join payments ซ้ำ (p2) · ไม่นับงวดที่ถูกลบ (2026-11-18)', async () => {
    // เดิม LEFT JOIN payments p × LEFT JOIN payments p2 (งวดค้าง) + COUNT(p.id) ⇒ ล่าช้า/จ่ายไม่ครบ ถูกคูณด้วยจำนวนงวดค้าง
    // (ช้าจริง 1 ครั้ง ค้าง 8 งวด → "ชำระล่าช้า 8 ครั้ง" + HIGH) · แบบเดียวกับ customer-analytics.service.ts (GET /customers/watch-list)
    await service.computeWatchList();
    const { text } = renderSqlCall(prisma.$queryRaw.mock.calls[0]);
    expect(text).not.toContain('COUNT(p.id)');
    expect(text.split('COUNT(DISTINCT p.id)')).toHaveLength(7);
    expect(text).not.toContain('LEFT JOIN payments p2');
    expect(text).toContain('LEFT JOIN payments p ON p.contract_id = c.id AND p.deleted_at IS NULL');
    expect(text).toContain(
      "(SELECT p2.due_date FROM payments p2 WHERE p2.contract_id = c.id AND p2.deleted_at IS NULL AND p2.status IN ('PENDING', 'OVERDUE') ORDER BY p2.due_date, p2.installment_no, p2.id LIMIT 1) AS \"nextDueDate\"",
    );
    expect(text).toContain(
      "(SELECT p2.amount_due FROM payments p2 WHERE p2.contract_id = c.id AND p2.deleted_at IS NULL AND p2.status IN ('PENDING', 'OVERDUE') ORDER BY p2.due_date, p2.installment_no, p2.id LIMIT 1) AS \"nextAmountDue\"",
    );
  });

  it('กรองสาขายังเป็นพารามิเตอร์', async () => {
    await service.computeWatchList('b1');
    expect(renderSqlCall(prisma.$queryRaw.mock.calls[0]).values).toEqual(['b1']);
  });

  it('จำนวนงวดล่าช้าจาก SQL ยังแปลงเป็นระดับความเสี่ยงแบบเดิม', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        customerId: 'cu1', customerName: 'ก', customerPhone: '0800000000', contractId: 'c1', contractNumber: 'CT-1',
        latePaymentCount: BigInt(3), partialPaymentCount: BigInt(1), hadDunningReset: false,
        nextDueDate: null, nextAmountDue: null,
      },
    ]);
    const res = await service.computeWatchList();
    expect(res.watchList[0]).toMatchObject({ riskScore: 5, riskLevel: 'HIGH', reasons: ['ชำระล่าช้า 3 ครั้ง', 'จ่ายไม่ครบ 1 ครั้ง'] });
    expect(res.highCount).toBe(1);
  });
});
