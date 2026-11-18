import { TransactionalReportService } from './transactional-report.service';

/**
 * /reports/profit-loss · /reports/comparative-pl · /reports/quarterly · สแนปช็อตปิดงวด (getProfitLossReport)
 * และ /reports/cash-flow (getCashFlowStatement) รับวันที่ 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * วันเริ่ม 2026-11-01 = 2026-10-31T17:00:00.000Z · วันสิ้นสุด 2026-11-17 = 2026-11-17T16:59:59.999Z
 *
 * เดิม start = new Date('YYYY-MM-DD') = 07:00 น. ไทย ⇒ ใบขาย/การรับชำระ 00:00–06:59 น. ของวันแรกหายจากรายงาน
 * และ end ถูกต้องเพราะ setHours(23,59,59,999) ตาม TZ ของโปรเซสเท่านั้น
 */
describe('TransactionalReportService — วันที่ของ P&L และกระแสเงินสด', () => {
  const START = new Date('2026-10-31T17:00:00.000Z');
  const END = new Date('2026-11-17T16:59:59.999Z');

  function build() {
    const prisma = {
      sale: {
        aggregate: jest.fn().mockResolvedValue({ _sum: {} }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: {} }),
      },
      financeReceivable: { aggregate: jest.fn().mockResolvedValue({ _sum: {} }) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      purchaseOrder: { aggregate: jest.fn().mockResolvedValue({ _sum: {} }) },
      journalLine: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    const companyResolver = { getFinanceCompanyId: jest.fn().mockResolvedValue('finance-co-1') };
    const service = new TransactionalReportService(prisma as never, companyResolver as never);
    return { service, prisma };
  }

  describe('getProfitLossReport', () => {
    it('ทุก query ใช้ช่วง 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
      const { service, prisma } = build();
      await service.getProfitLossReport('2026-11-01', '2026-11-17', undefined, undefined, true);

      for (const call of prisma.sale.aggregate.mock.calls) {
        expect(call[0].where.createdAt).toEqual({ gte: START, lte: END });
      }
      expect(prisma.sale.findMany.mock.calls[0][0].where.createdAt).toEqual({ gte: START, lte: END });
      expect(prisma.payment.findMany.mock.calls[0][0].where.paidDate).toEqual({ gte: START, lte: END });
      expect(prisma.financeReceivable.aggregate.mock.calls[0][0].where.receivedDate).toEqual({
        gte: START,
        lte: END,
      });
      expect(prisma.journalLine.groupBy.mock.calls[0][0].where.journalEntry.entryDate).toEqual({
        gte: START,
        lte: END,
      });
    });

    it('ใบขาย/รับชำระเที่ยงคืนไทยของวันแรกอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
      const { service, prisma } = build();
      await service.getProfitLossReport('2026-11-01', '2026-11-17');
      const range = prisma.sale.aggregate.mock.calls[0][0].where.createdAt as { gte: Date; lte: Date };
      const firstMinute = new Date('2026-11-01T00:00:00+07:00');
      const lastDayEvening = new Date('2026-11-17T23:30:00+07:00');
      const nextMidnight = new Date('2026-11-18T00:00:00+07:00');
      expect(firstMinute >= range.gte && firstMinute <= range.lte).toBe(true);
      expect(lastDayEvening <= range.lte).toBe(true);
      expect(nextMidnight <= range.lte).toBe(false);
    });

    it('ค่าที่ไม่ใช่ YYYY-MM-DD ได้พฤติกรรมเดิม (ISO เต็ม = new Date(value) · สิ้นวันตาม setHours)', async () => {
      const { service, prisma } = build();
      await service.getProfitLossReport('2026-11-01T03:00:00.000Z', '2026-11-17T03:00:00.000Z');
      const range = prisma.sale.aggregate.mock.calls[0][0].where.createdAt as { gte: Date; lte: Date };
      expect(range.gte.toISOString()).toBe('2026-11-01T03:00:00.000Z');
      const legacyEnd = new Date('2026-11-17T03:00:00.000Z');
      legacyEnd.setHours(23, 59, 59, 999);
      expect(range.lte.getTime()).toBe(legacyEnd.getTime());
    });
  });

  describe('getCashFlowStatement', () => {
    it('ทุก query ใช้ช่วง 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
      const { service, prisma } = build();
      const result = await service.getCashFlowStatement('2026-11-01', '2026-11-17');

      for (const call of prisma.sale.aggregate.mock.calls) {
        expect(call[0].where.createdAt).toEqual({ gte: START, lte: END });
      }
      expect(prisma.payment.aggregate.mock.calls[0][0].where.paidDate).toEqual({ gte: START, lte: END });
      expect(prisma.financeReceivable.aggregate.mock.calls[0][0].where.receivedDate).toEqual({
        gte: START,
        lte: END,
      });
      expect(prisma.purchaseOrder.aggregate.mock.calls[0][0].where.orderDate).toEqual({ gte: START, lte: END });
      // คำตอบยัง echo ค่าที่ผู้ใช้ส่งมาตามเดิม
      expect(result.period).toEqual({ start: '2026-11-01', end: '2026-11-17' });
    });

    it('รับชำระเที่ยงคืนไทยของวันแรกอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
      const { service, prisma } = build();
      await service.getCashFlowStatement('2026-11-01', '2026-11-17');
      const range = prisma.payment.aggregate.mock.calls[0][0].where.paidDate as { gte: Date; lte: Date };
      const firstMinute = new Date('2026-11-01T00:00:00+07:00');
      const nextMidnight = new Date('2026-11-18T00:00:00+07:00');
      expect(firstMinute >= range.gte && firstMinute <= range.lte).toBe(true);
      expect(nextMidnight <= range.lte).toBe(false);
    });
  });
});
