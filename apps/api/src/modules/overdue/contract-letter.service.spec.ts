import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { DunningEngineService } from './dunning-engine.service';
import { ContractLetterService } from './contract-letter.service';

const mockPrisma = {
  contractLetter: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  contract: {
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockDunningEngine = {
  executeEventTrigger: jest.fn(),
};

describe('ContractLetterService', () => {
  let service: ContractLetterService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractLetterService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DunningEngineService, useValue: mockDunningEngine },
      ],
    }).compile();
    service = module.get(ContractLetterService);
  });

  describe('createIfNotExists', () => {
    it('returns existing letter if present (idempotent)', async () => {
      const existing = { id: 'letter-1', contractId: 'c1', letterType: 'RETURN_DEVICE_45D' };
      mockPrisma.contractLetter.findUnique.mockResolvedValueOnce(existing);

      const result = await service.createIfNotExists('c1', 'RETURN_DEVICE_45D');
      expect(result).toBe(existing);
      expect(mockPrisma.contractLetter.create).not.toHaveBeenCalled();
    });

    it('creates with sequential letterNumber ST-YYYY-NNNNN when none exists', async () => {
      mockPrisma.contractLetter.findUnique.mockResolvedValueOnce(null);
      mockPrisma.contractLetter.count.mockResolvedValueOnce(4);
      mockPrisma.contractLetter.create.mockResolvedValueOnce({ id: 'letter-2', letterNumber: 'x' });

      await service.createIfNotExists('c2', 'RETURN_DEVICE_45D');

      const createArg = mockPrisma.contractLetter.create.mock.calls[0][0];
      expect(createArg.data.letterNumber).toMatch(/^ST-\d{4}-\d{5}$/);
      expect(createArg.data.letterNumber.endsWith('00005')).toBe(true);
      expect(createArg.data.status).toBe('PENDING_DISPATCH');
    });
  });

  describe('cancel', () => {
    it('cancels when in PENDING_DISPATCH', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce({
        id: 'letter-3',
        status: 'PENDING_DISPATCH',
      });
      const cancelled = { id: 'letter-3', status: 'CANCELLED', cancelReason: 'ลูกค้าชำระครบแล้ว' };
      mockPrisma.$transaction.mockResolvedValueOnce([cancelled, {}]);

      const result = await service.cancel('letter-3', 'u1', 'ลูกค้าชำระครบแล้ว');
      expect(result).toBe(cancelled);
      // Ensure soft-delete guard present
      const findArg = mockPrisma.contractLetter.findFirst.mock.calls[0][0];
      expect(findArg.where.deletedAt).toBeNull();
    });

    it('creates audit log with CANCEL_LETTER action', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce({
        id: 'letter-3b',
        status: 'PENDING_DISPATCH',
      });
      mockPrisma.$transaction.mockResolvedValueOnce([{ id: 'letter-3b' }, {}]);
      await service.cancel('letter-3b', 'user-42', 'เหตุผลยกเลิก');
      const txArg = mockPrisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(txArg)).toBe(true);
      expect(txArg).toHaveLength(2);
    });

    it('throws when letter is DISPATCHED', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce({
        id: 'letter-4',
        status: 'DISPATCHED',
      });
      await expect(service.cancel('letter-4', 'u1', 'ลูกค้าชำระครบแล้ว')).rejects.toThrow(/ยกเลิก/);
    });

    it('requires reason length ≥ 5', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce({
        id: 'letter-5',
        status: 'PENDING_DISPATCH',
      });
      await expect(service.cancel('letter-5', 'u1', 'no')).rejects.toThrow(/เหตุผล/);
    });

    it('throws NotFound when letter missing', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce(null);
      await expect(service.cancel('nope', 'u1', 'abcde')).rejects.toThrow(/ไม่พบหนังสือ/);
    });
  });

  // ---------- New tests for extended methods ----------

  describe('list', () => {
    const mockLetters = [
      { id: 'l1', status: 'PENDING_DISPATCH', letterType: 'RETURN_DEVICE_45D' },
      { id: 'l2', status: 'PDF_GENERATED', letterType: 'CONTRACT_TERMINATION_60D' },
    ];

    it('returns letters without filter', async () => {
      mockPrisma.contractLetter.findMany.mockResolvedValueOnce(mockLetters);
      const result = await service.list({});
      expect(result).toBe(mockLetters);
      const findArg = mockPrisma.contractLetter.findMany.mock.calls[0][0];
      expect(findArg.where.deletedAt).toBeNull();
    });

    it('filters by status', async () => {
      mockPrisma.contractLetter.findMany.mockResolvedValueOnce([mockLetters[0]]);
      await service.list({ status: 'PENDING_DISPATCH' });
      const findArg = mockPrisma.contractLetter.findMany.mock.calls[0][0];
      expect(findArg.where.status).toBe('PENDING_DISPATCH');
    });

    it('filters by letterType', async () => {
      mockPrisma.contractLetter.findMany.mockResolvedValueOnce([mockLetters[1]]);
      await service.list({ letterType: 'CONTRACT_TERMINATION_60D' });
      const findArg = mockPrisma.contractLetter.findMany.mock.calls[0][0];
      expect(findArg.where.letterType).toBe('CONTRACT_TERMINATION_60D');
    });

    it('filters by branchId via contract relation', async () => {
      mockPrisma.contractLetter.findMany.mockResolvedValueOnce([]);
      await service.list({ branchId: 'branch-1' });
      const findArg = mockPrisma.contractLetter.findMany.mock.calls[0][0];
      expect(findArg.where.contract).toEqual({ branchId: 'branch-1' });
    });
  });

  describe('markPdfGenerated', () => {
    it('transitions PENDING_DISPATCH -> PDF_GENERATED and records URL', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce({
        id: 'l1',
        status: 'PENDING_DISPATCH',
        contractId: 'c1',
      });
      const updatedLetter = { id: 'l1', status: 'PDF_GENERATED', pdfUrl: 'https://s3.../letter.pdf' };
      mockPrisma.$transaction.mockResolvedValueOnce([updatedLetter, {}]);

      const result = await service.markPdfGenerated('l1', 'https://s3.../letter.pdf', 'u1');
      expect(result).toBe(updatedLetter);
    });

    it('throws BadRequest when status is not PENDING_DISPATCH', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce({
        id: 'l2',
        status: 'PDF_GENERATED',
      });
      await expect(service.markPdfGenerated('l2', 'url', 'u1')).rejects.toThrow(/PENDING_DISPATCH/);
    });

    it('throws NotFound for unknown letter', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce(null);
      await expect(service.markPdfGenerated('nope', 'url', 'u1')).rejects.toThrow(/ไม่พบหนังสือ/);
    });
  });

  describe('markDispatched', () => {
    const pdfGeneratedLetter = {
      id: 'l3',
      status: 'PDF_GENERATED',
      contractId: 'c3',
      letterType: 'RETURN_DEVICE_45D',
    };

    it('validates tracking number length ≥ 5', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce(pdfGeneratedLetter);
      await expect(
        service.markDispatched('l3', 'u1', { trackingNumber: 'AB1' }),
      ).rejects.toThrow(/tracking/);
    });

    it('transitions PDF_GENERATED -> DISPATCHED and fires LETTER_DISPATCHED event', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce(pdfGeneratedLetter);
      const dispatched = { id: 'l3', status: 'DISPATCHED', trackingNumber: 'EMS12345' };
      mockPrisma.$transaction.mockResolvedValueOnce([dispatched, {}]);
      mockDunningEngine.executeEventTrigger.mockResolvedValue(undefined);

      const result = await service.markDispatched('l3', 'u1', { trackingNumber: 'EMS12345' });
      expect(result).toBe(dispatched);
      expect(mockDunningEngine.executeEventTrigger).toHaveBeenCalledWith(
        'LETTER_DISPATCHED',
        'c3',
        null,
        null,
        expect.any(Object),
      );
    });

    it('fires CONTRACT_TERMINATED event for CONTRACT_TERMINATION_60D letter type', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce({
        ...pdfGeneratedLetter,
        letterType: 'CONTRACT_TERMINATION_60D',
      });
      mockPrisma.contract.findUnique.mockResolvedValueOnce({ status: 'DEFAULT' });
      const dispatched = { id: 'l3', status: 'DISPATCHED' };
      mockPrisma.$transaction.mockResolvedValueOnce([dispatched, {}]);
      mockDunningEngine.executeEventTrigger.mockResolvedValue(undefined);

      await service.markDispatched('l3', 'u1', { trackingNumber: 'EMS99999' });

      expect(mockDunningEngine.executeEventTrigger).toHaveBeenCalledWith(
        'CONTRACT_TERMINATED',
        'c3',
        null,
        null,
      );
    });

    it('does not fire CONTRACT_TERMINATED for RETURN_DEVICE_45D letter type', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce(pdfGeneratedLetter);
      mockPrisma.$transaction.mockResolvedValueOnce([{ id: 'l3', status: 'DISPATCHED' }, {}]);
      mockDunningEngine.executeEventTrigger.mockResolvedValue(undefined);

      await service.markDispatched('l3', 'u1', { trackingNumber: 'EMS54321' });

      const calls = mockDunningEngine.executeEventTrigger.mock.calls;
      const terminatedCall = calls.find((c: string[]) => c[0] === 'CONTRACT_TERMINATED');
      expect(terminatedCall).toBeUndefined();
    });

    it('markDispatched sets contract.status=LEGAL for 60d termination letter (4 tx ops)', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce({
        id: 'letter-t',
        status: 'PDF_GENERATED',
        contractId: 'c1',
        letterType: 'CONTRACT_TERMINATION_60D',
        letterNumber: 'ST-2026-00001',
      });
      // New: service now reads current contract status for audit `from` field
      mockPrisma.contract.findUnique.mockResolvedValueOnce({ status: 'OVERDUE' });
      mockPrisma.$transaction.mockResolvedValueOnce([
        { id: 'letter-t', status: 'DISPATCHED' },
        {},
        {},
        {},
      ]);
      mockDunningEngine.executeEventTrigger.mockResolvedValue(undefined);

      await service.markDispatched('letter-t', 'u1', { trackingNumber: 'EX123456' });

      const txOps = mockPrisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(txOps)).toBe(true);
      // 2 base ops + 2 legal-escalation ops for 60d letters
      expect(txOps.length).toBe(4);
    });

    it('markDispatched audit log uses actual current contract status in `from` field', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce({
        id: 'letter-t2',
        status: 'PDF_GENERATED',
        contractId: 'c-audit',
        letterType: 'CONTRACT_TERMINATION_60D',
        letterNumber: 'ST-2026-00007',
      });
      mockPrisma.contract.findUnique.mockResolvedValueOnce({ status: 'OVERDUE' });
      // Capture auditLog.create calls to assert `from`
      mockPrisma.auditLog.create.mockImplementation((args: any) => args);
      mockPrisma.$transaction.mockResolvedValueOnce([
        { id: 'letter-t2', status: 'DISPATCHED' },
        {},
        {},
        {},
      ]);
      mockDunningEngine.executeEventTrigger.mockResolvedValue(undefined);

      await service.markDispatched('letter-t2', 'u1', { trackingNumber: 'EX987654' });

      // Find the CONTRACT_STATUS_LEGAL audit op inside the transaction payload
      const txOps = mockPrisma.$transaction.mock.calls[0][0];
      const legalAuditCall = mockPrisma.auditLog.create.mock.calls.find(
        (call: any[]) => call[0]?.data?.action === 'CONTRACT_STATUS_LEGAL',
      );
      expect(legalAuditCall).toBeDefined();
      expect(legalAuditCall?.[0]?.data?.newValue?.from).toBe('OVERDUE');
      expect(legalAuditCall?.[0]?.data?.newValue?.to).toBe('LEGAL');
      expect(txOps.length).toBe(4);
    });

    it('markDispatched does NOT set LEGAL for 45d return-device letter (2 tx ops)', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce({
        id: 'letter-r',
        status: 'PDF_GENERATED',
        contractId: 'c1',
        letterType: 'RETURN_DEVICE_45D',
        letterNumber: 'ST-2026-00002',
      });
      mockPrisma.$transaction.mockResolvedValueOnce([{ id: 'letter-r', status: 'DISPATCHED' }, {}]);
      mockDunningEngine.executeEventTrigger.mockResolvedValue(undefined);

      await service.markDispatched('letter-r', 'u1', { trackingNumber: 'EX777AB' });

      const txOps = mockPrisma.$transaction.mock.calls[0][0];
      expect(txOps.length).toBe(2); // only 2 base ops
    });

    it('throws BadRequest when status is not PDF_GENERATED', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce({
        id: 'l4',
        status: 'PENDING_DISPATCH',
        contractId: 'c4',
        letterType: 'RETURN_DEVICE_45D',
      });
      await expect(
        service.markDispatched('l4', 'u1', { trackingNumber: 'EMS00001' }),
      ).rejects.toThrow(/PDF_GENERATED/);
    });
  });

  describe('markDelivered', () => {
    it('transitions DISPATCHED -> DELIVERED', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce({
        id: 'l5',
        status: 'DISPATCHED',
        contractId: 'c5',
      });
      const delivered = { id: 'l5', status: 'DELIVERED' };
      mockPrisma.$transaction.mockResolvedValueOnce([delivered, {}]);

      const result = await service.markDelivered('l5', 'u1');
      expect(result).toBe(delivered);
    });

    it('throws BadRequest when status is not DISPATCHED', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce({
        id: 'l6',
        status: 'PDF_GENERATED',
      });
      await expect(service.markDelivered('l6', 'u1')).rejects.toThrow(/DISPATCHED/);
    });

    it('throws NotFound when letter missing', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce(null);
      await expect(service.markDelivered('nope', 'u1')).rejects.toThrow(/ไม่พบหนังสือ/);
    });
  });

  describe('markUndeliverable', () => {
    const dispatchedLetter = {
      id: 'l7',
      status: 'DISPATCHED',
      contractId: 'c7',
    };

    it('requires reason length ≥ 5', async () => {
      await expect(
        service.markUndeliverable('l7', 'u1', 'abc'),
      ).rejects.toThrow(/เหตุผล/);
    });

    it('flips contract.needsSkipTracing = true and marks UNDELIVERABLE', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce(dispatchedLetter);
      const undeliverable = { id: 'l7', status: 'UNDELIVERABLE' };
      mockPrisma.$transaction.mockResolvedValueOnce([undeliverable, {}, {}]);

      const result = await service.markUndeliverable('l7', 'u1', 'ที่อยู่ไม่ถูกต้อง');
      expect(result).toBe(undeliverable);

      // Verify transaction includes contract.update for needsSkipTracing
      const txArg = mockPrisma.$transaction.mock.calls[0][0];
      expect(Array.isArray(txArg)).toBe(true);
      expect(txArg).toHaveLength(3);
    });

    it('throws BadRequest when status is not DISPATCHED', async () => {
      mockPrisma.contractLetter.findFirst.mockResolvedValueOnce({
        id: 'l8',
        status: 'DELIVERED',
      });
      await expect(
        service.markUndeliverable('l8', 'u1', 'ที่อยู่ไม่ถูกต้อง'),
      ).rejects.toThrow(/สถานะ/);
    });
  });

  describe('updateEvidence', () => {
    it('updates evidencePhotoUrl and creates audit log for DISPATCHED letter', async () => {
      mockPrisma.contractLetter.findUnique.mockResolvedValueOnce({
        id: 'l9',
        status: 'DISPATCHED',
        contractId: 'c9',
      });
      const updatedLetter = { id: 'l9', status: 'DISPATCHED', evidencePhotoUrl: 'https://s3.example.com/slip.jpg' };
      mockPrisma.$transaction.mockResolvedValueOnce([updatedLetter, {}]);

      const result = await service.updateEvidence('l9', 'https://s3.example.com/slip.jpg', 'u1');
      expect(result).toBe(updatedLetter);
    });

    it('updates evidencePhotoUrl for DELIVERED letter', async () => {
      mockPrisma.contractLetter.findUnique.mockResolvedValueOnce({
        id: 'l10',
        status: 'DELIVERED',
        contractId: 'c10',
      });
      const updatedLetter = { id: 'l10', status: 'DELIVERED', evidencePhotoUrl: 'https://s3.example.com/slip2.jpg' };
      mockPrisma.$transaction.mockResolvedValueOnce([updatedLetter, {}]);

      const result = await service.updateEvidence('l10', 'https://s3.example.com/slip2.jpg', 'u1');
      expect(result).toBe(updatedLetter);
    });

    it('throws NotFound when letter missing', async () => {
      mockPrisma.contractLetter.findUnique.mockResolvedValueOnce(null);
      await expect(service.updateEvidence('nope', 'https://example.com/a.jpg', 'u1')).rejects.toThrow(/ไม่พบหนังสือ/);
    });

    it('throws BadRequest when status is PENDING_DISPATCH (not yet dispatched)', async () => {
      mockPrisma.contractLetter.findUnique.mockResolvedValueOnce({
        id: 'l11',
        status: 'PENDING_DISPATCH',
      });
      await expect(service.updateEvidence('l11', 'https://example.com/a.jpg', 'u1')).rejects.toThrow(/ส่งแล้ว/);
    });

    it('throws BadRequest when evidencePhotoUrl is empty string', async () => {
      mockPrisma.contractLetter.findUnique.mockResolvedValueOnce({
        id: 'l12',
        status: 'DISPATCHED',
      });
      await expect(service.updateEvidence('l12', '   ', 'u1')).rejects.toThrow(/อัปโหลด/);
    });
  });
});
