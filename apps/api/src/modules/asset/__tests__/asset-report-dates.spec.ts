import { AssetQueryService } from '../services/asset-query.service';
import { AssetJournalService } from '../asset-journal.service';

/**
 * GET /assets/audit?fromDate&toDate และ GET /assets/journal?fromDate&toDate — 'YYYY-MM-DD' = วันตามปฏิทินไทย (2026-11-18)
 * - AuditLog.createdAt และ JournalEntry.entryDate ของรายการกลับรายการ/ใบกำกับมาถึงเป็นเวลาจริง
 * - เดิม gte = new Date('YYYY-MM-DD') = 07:00 น. ไทย ⇒ รายการ 00:00–06:59 น. ของวันเริ่มหาย
 *   (ฝั่ง lte ถูกเพราะ setHours(23,59,59,999) ตาม TZ ของโปรเซสเท่านั้น)
 * ตามแบบ asset-register-summary.spec.ts (hand-built prisma mock + new Service(prisma))
 */
describe('Asset reports — ช่วงวันที่', () => {
  const RANGE = {
    gte: new Date('2026-10-31T17:00:00.000Z'),
    lte: new Date('2026-11-17T16:59:59.999Z'),
  };

  describe('AssetQueryService.listGlobalAudit', () => {
    const prisma = {
      auditLog: { findMany: jest.fn(), count: jest.fn() },
      fixedAsset: { findMany: jest.fn() },
    };
    const service = new AssetQueryService(prisma as never);

    beforeEach(() => {
      jest.clearAllMocks();
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);
      prisma.fixedAsset.findMany.mockResolvedValue([]);
    });

    it('createdAt = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
      await service.listGlobalAudit({ fromDate: '2026-11-01', toDate: '2026-11-17' });
      expect(prisma.auditLog.findMany.mock.calls[0][0].where.createdAt).toEqual(RANGE);
      expect(prisma.auditLog.count.mock.calls[0][0].where.createdAt).toEqual(RANGE);
    });

    it('บันทึกเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
      await service.listGlobalAudit({ fromDate: '2026-11-01', toDate: '2026-11-17' });
      const { gte, lte } = prisma.auditLog.findMany.mock.calls[0][0].where.createdAt as { gte: Date; lte: Date };
      const reversal = new Date('2026-11-01T00:00:00+07:00');
      const nextMidnight = new Date('2026-11-18T00:00:00+07:00');
      expect(reversal >= gte && reversal <= lte).toBe(true);
      expect(nextMidnight <= lte).toBe(false);
    });

    it('ส่งแค่ fromDate / แค่ toDate = ใส่เฉพาะขอบที่ส่ง · ไม่ส่ง = ไม่กรอง', async () => {
      await service.listGlobalAudit({ fromDate: '2026-11-01' });
      expect(prisma.auditLog.findMany.mock.calls[0][0].where.createdAt).toEqual({ gte: RANGE.gte });
      await service.listGlobalAudit({ toDate: '2026-11-17' });
      expect(prisma.auditLog.findMany.mock.calls[1][0].where.createdAt).toEqual({ lte: RANGE.lte });
      await service.listGlobalAudit({});
      expect(prisma.auditLog.findMany.mock.calls[2][0].where.createdAt).toBeUndefined();
    });
  });

  describe('AssetJournalService.list', () => {
    const prisma = {
      journalEntry: { findMany: jest.fn(), count: jest.fn() },
      fixedAsset: { findMany: jest.fn() },
    };
    const service = new AssetJournalService(prisma as never);

    beforeEach(() => {
      jest.clearAllMocks();
      prisma.journalEntry.findMany.mockResolvedValue([]);
      prisma.journalEntry.count.mockResolvedValue(0);
      prisma.fixedAsset.findMany.mockResolvedValue([]);
    });

    it('entryDate = 00:00 น. วันเริ่ม ถึง 23:59:59.999 น. วันสิ้นสุด (เวลาไทย)', async () => {
      await service.list({ fromDate: '2026-11-01', toDate: '2026-11-17' });
      expect(prisma.journalEntry.findMany.mock.calls[0][0].where.entryDate).toEqual(RANGE);
      expect(prisma.journalEntry.count.mock.calls[0][0].where.entryDate).toEqual(RANGE);
    });

    it('รายการกลับรายการเที่ยงคืนไทยของวันเริ่มอยู่ในช่วง · เที่ยงคืนไทยของวันถัดจากวันสิ้นสุดอยู่นอกช่วง', async () => {
      await service.list({ fromDate: '2026-11-01', toDate: '2026-11-17' });
      const { gte, lte } = prisma.journalEntry.findMany.mock.calls[0][0].where.entryDate as {
        gte: Date;
        lte: Date;
      };
      const reversal = new Date('2026-11-01T00:00:00+07:00');
      const nextMidnight = new Date('2026-11-18T00:00:00+07:00');
      expect(reversal >= gte && reversal <= lte).toBe(true);
      expect(nextMidnight <= lte).toBe(false);
    });

    it('ส่งแค่ fromDate / แค่ toDate = ใส่เฉพาะขอบที่ส่ง · ไม่ส่ง = ไม่กรอง', async () => {
      await service.list({ fromDate: '2026-11-01' });
      expect(prisma.journalEntry.findMany.mock.calls[0][0].where.entryDate).toEqual({ gte: RANGE.gte });
      await service.list({ toDate: '2026-11-17' });
      expect(prisma.journalEntry.findMany.mock.calls[1][0].where.entryDate).toEqual({ lte: RANGE.lte });
      await service.list({});
      expect(prisma.journalEntry.findMany.mock.calls[2][0].where.entryDate).toBeUndefined();
    });
  });
});
