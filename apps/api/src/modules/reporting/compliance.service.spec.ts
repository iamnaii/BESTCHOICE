import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ComplianceService } from './compliance.service';

const mockPrisma = {
  dunningAction: { groupBy: jest.fn() },
  contract: { findMany: jest.fn() },
  legalCase: { findMany: jest.fn() },
  auditLog: { groupBy: jest.fn(), count: jest.fn() },
  callLog: { findMany: jest.fn() },
  systemConfig: { findUnique: jest.fn() },
};

describe('ComplianceService', () => {
  let service: ComplianceService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        ComplianceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = mod.get(ComplianceService);
  });

  describe('getDunningFrequency', () => {
    it('joins contract metadata onto group-by results above the configured threshold', async () => {
      mockPrisma.systemConfig.findUnique.mockResolvedValueOnce(null);
      mockPrisma.dunningAction.groupBy.mockResolvedValueOnce([
        { contractId: 'c-1', _count: { _all: 6 } },
        { contractId: 'c-2', _count: { _all: 5 } },
      ] as never);
      mockPrisma.contract.findMany.mockResolvedValueOnce([
        {
          id: 'c-1',
          contractNumber: 'CT-1',
          customer: { name: 'Alice A', nickname: null },
        },
        {
          id: 'c-2',
          contractNumber: 'CT-2',
          customer: { name: 'Bob', nickname: 'B' },
        },
      ] as never);

      const out = await service.getDunningFrequency();
      expect(out.threshold).toBe(ComplianceService.DEFAULT_DUNNING_THRESHOLD);
      expect(out.rows).toHaveLength(2);
      expect(out.rows[0]).toMatchObject({
        contractId: 'c-1',
        contractNumber: 'CT-1',
        customerName: 'Alice A',
        actionCount: 6,
      });
      expect(out.rows[1].customerName).toBe('Bob');
      // having clause should pass our threshold (4) into the prisma call
      const args = mockPrisma.dunningAction.groupBy.mock.calls[0][0];
      expect(args.having.contractId._count.gt).toBe(4);
    });
  });

  describe('getLegalPipeline', () => {
    it('buckets hearings into 7 / 14 / 30 day windows', async () => {
      const now = Date.now();
      mockPrisma.legalCase.findMany.mockResolvedValueOnce([
        {
          contractId: 'c-1',
          caseNumber: 'CR-1',
          court: 'ศาลแพ่ง',
          hearingDate: new Date(now + 3 * 86400000),
          contract: { contractNumber: 'CT-1' },
        },
        {
          contractId: 'c-2',
          caseNumber: 'CR-2',
          court: 'ศาลแพ่ง',
          hearingDate: new Date(now + 10 * 86400000),
          contract: { contractNumber: 'CT-2' },
        },
        {
          contractId: 'c-3',
          caseNumber: 'CR-3',
          court: 'ศาลแพ่ง',
          hearingDate: new Date(now + 25 * 86400000),
          contract: { contractNumber: 'CT-3' },
        },
      ] as never);

      const out = await service.getLegalPipeline();
      const win7 = out.windows.find((w) => w.days === 7)!;
      const win14 = out.windows.find((w) => w.days === 14)!;
      const win30 = out.windows.find((w) => w.days === 30)!;
      expect(win7.count).toBe(1);
      expect(win14.count).toBe(2);
      expect(win30.count).toBe(3);
      expect(out.rows).toHaveLength(3);
      expect(out.rows[0].daysUntil).toBeLessThanOrEqual(7);
    });
  });

  describe('getAuditSummary', () => {
    it('aggregates by user and entity and counts DENY anomalies', async () => {
      mockPrisma.auditLog.groupBy
        .mockResolvedValueOnce([
          { userId: 'u-1', _count: { _all: 50 } },
          { userId: 'u-2', _count: { _all: 12 } },
        ] as never)
        .mockResolvedValueOnce([
          { entity: 'contract', _count: { _all: 30 } },
          { entity: 'payment', _count: { _all: 32 } },
        ] as never);
      mockPrisma.auditLog.count.mockResolvedValueOnce(3);

      const out = await service.getAuditSummary('week');
      expect(out.period).toBe('week');
      expect(out.actionsByUser).toEqual([
        { userId: 'u-1', count: 50 },
        { userId: 'u-2', count: 12 },
      ]);
      expect(out.actionsByType.find((r) => r.entity === 'payment')!.count).toBe(32);
      expect(out.anomalyCount).toBe(3);
    });
  });

  describe('getVoiceMemoRetention', () => {
    it('returns counts for both Glacier-eligible and delete-eligible call logs', async () => {
      mockPrisma.callLog.findMany
        .mockResolvedValueOnce([{ id: 'cl-1' }, { id: 'cl-2' }] as never)
        .mockResolvedValueOnce([{ id: 'cl-old' }] as never);

      const out = await service.getVoiceMemoRetention();
      expect(out.hotDays).toBe(ComplianceService.VOICE_MEMO_HOT_DAYS);
      expect(out.deleteDays).toBe(ComplianceService.VOICE_MEMO_DELETE_DAYS);
      expect(out.eligibleForGlacier.count).toBe(2);
      expect(out.eligibleForGlacier.sample).toEqual(['cl-1', 'cl-2']);
      expect(out.eligibleForDelete.count).toBe(1);
      // Glacier query: HOT tier + between hot/delete cutoffs
      const glacierArgs = mockPrisma.callLog.findMany.mock.calls[0][0];
      expect(glacierArgs.where.voiceMemoTier).toBe('HOT');
      expect(glacierArgs.where.calledAt.lte).toBeInstanceOf(Date);
      expect(glacierArgs.where.calledAt.gt).toBeInstanceOf(Date);
    });
  });
});
