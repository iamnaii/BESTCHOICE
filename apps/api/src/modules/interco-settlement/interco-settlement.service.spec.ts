import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IntercoSettlementService } from './interco-settlement.service';
import { IntercoPendingService, PendingContract } from './interco-pending.service';
import { IntercoBatchNumberService } from './interco-batch-number.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { PairedJournalService } from '../journal/paired-journal.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { StorageService } from '../storage/storage.service';

/** Minimal valid JPEG header (FF D8 FF ...) — passes the magic-byte check. */
const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

const uploadedFile = (overrides: Partial<Express.Multer.File> = {}): Express.Multer.File =>
  ({
    fieldname: 'file',
    originalname: 'slip.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: jpegBuffer.length,
    buffer: jpegBuffer,
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  }) as Express.Multer.File;

const pendingRow = (overrides: Partial<PendingContract> = {}): PendingContract => ({
  contractId: 'c-1',
  contractNumber: 'CT-0001',
  customerName: 'ลูกค้า A',
  activatedAt: new Date('2026-06-01T00:00:00Z'),
  financedGl: new Prisma.Decimal(10000),
  commissionGl: new Prisma.Decimal(1000),
  shopFinancedGl: new Prisma.Decimal(10000),
  shopCommissionGl: new Prisma.Decimal(1000),
  legacyNoShop: false,
  ...overrides,
});

const dto = (over: Partial<CreateBatchDto> = {}): CreateBatchDto => ({
  contractIds: ['c-1'],
  transferDate: '2026-08-01',
  ...over,
});

describe('IntercoSettlementService', () => {
  let service: IntercoSettlementService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pendingService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let batchNumberService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let storage: any;

  beforeEach(async () => {
    tx = {
      interCoSettlementBatch: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn().mockImplementation(({ data }: { data: unknown }) =>
          Promise.resolve({ id: 'batch-1', ...(data as Record<string, unknown>) }),
        ),
      },
      interCoSettlementItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };

    prisma = {
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
      interCoSettlementBatch: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn().mockImplementation(({ data }: { data: unknown }) =>
          Promise.resolve({ id: 'batch-1', ...(data as Record<string, unknown>) }),
        ),
      },
      journalEntry: { findUnique: jest.fn() },
    };

    pendingService = { getPendingContracts: jest.fn().mockResolvedValue([]) };
    batchNumberService = { next: jest.fn().mockResolvedValue('IC-20260801-0001') };
    // approveBatch/reverseBatch (Task 4) deps — unused by the create/update/
    // submit/withdraw/cancel specs below, just need to satisfy Nest DI.
    const pairedJournal = { postPaired: jest.fn() };
    const companyResolver = {
      getFinanceCompanyId: jest.fn().mockResolvedValue('company-finance'),
      getShopCompanyId: jest.fn().mockResolvedValue('company-shop'),
    };
    const journalAuto = { createAndPost: jest.fn() };
    storage = { upload: jest.fn().mockResolvedValue(undefined), delete: jest.fn().mockResolvedValue(undefined) };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        IntercoSettlementService,
        { provide: PrismaService, useValue: prisma },
        { provide: IntercoPendingService, useValue: pendingService },
        { provide: IntercoBatchNumberService, useValue: batchNumberService },
        { provide: PairedJournalService, useValue: pairedJournal },
        { provide: CompanyResolverService, useValue: companyResolver },
        { provide: JournalAutoService, useValue: journalAuto },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = mod.get(IntercoSettlementService);
  });

  describe('createBatch', () => {
    it('snapshots the 4 GL amounts from the pending engine (not contract fields) and sums totals, excluding legacyNoShop items from shopPostedAmount', async () => {
      pendingService.getPendingContracts.mockResolvedValue([
        pendingRow({
          contractId: 'c-1',
          financedGl: new Prisma.Decimal(10000),
          commissionGl: new Prisma.Decimal(1000),
          shopFinancedGl: new Prisma.Decimal(10000),
          shopCommissionGl: new Prisma.Decimal(1000),
          legacyNoShop: false,
        }),
        pendingRow({
          contractId: 'c-2',
          contractNumber: 'CT-0002',
          financedGl: new Prisma.Decimal(5000),
          commissionGl: new Prisma.Decimal(500),
          // Even if these GL columns carried a stray non-zero balance, legacyNoShop=true
          // must still exclude the contract from shopPostedAmount (F1/F2 policy).
          shopFinancedGl: new Prisma.Decimal(999),
          shopCommissionGl: new Prisma.Decimal(999),
          legacyNoShop: true,
        }),
      ]);
      tx.interCoSettlementBatch.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'batch-1', ...data }),
      );

      await service.createBatch(dto({ contractIds: ['c-1', 'c-2'] }), 'user-1');

      const createArgs = tx.interCoSettlementBatch.create.mock.calls[0][0];
      expect((createArgs.data.totalFinanced as Prisma.Decimal).toString()).toBe('15000');
      expect((createArgs.data.totalCommission as Prisma.Decimal).toString()).toBe('1500');
      expect((createArgs.data.totalAmount as Prisma.Decimal).toString()).toBe('16500');
      // Only c-1 (legacyNoShop=false) contributes: 10000 + 1000 = 11000
      expect((createArgs.data.shopPostedAmount as Prisma.Decimal).toString()).toBe('11000');
      expect(createArgs.data.status).toBe('DRAFT');
      expect(createArgs.data.makerId).toBe('user-1');
      expect(createArgs.data.financeBankCode).toBe('11-1201');
      expect(createArgs.data.shopBankCode).toBe('S11-1201');

      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'INTERCO_BATCH_CREATED',
            entity: 'interco_settlement_batch',
            userId: 'user-1',
          }),
        }),
      );
    });

    it('honors explicit financeBankCode/shopBankCode overrides instead of the defaults', async () => {
      pendingService.getPendingContracts.mockResolvedValue([pendingRow()]);
      tx.interCoSettlementBatch.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'batch-1', ...data }),
      );

      await service.createBatch(
        dto({ financeBankCode: '11-1202', shopBankCode: 'S11-1202' }),
        'user-1',
      );

      const createArgs = tx.interCoSettlementBatch.create.mock.calls[0][0];
      expect(createArgs.data.financeBankCode).toBe('11-1202');
      expect(createArgs.data.shopBankCode).toBe('S11-1202');
    });

    it('rejects when a contract is not in the pending queue (settled elsewhere) with its contract number in the message', async () => {
      pendingService.getPendingContracts.mockResolvedValue([pendingRow({ contractId: 'c-1' })]);
      tx.contract.findMany.mockResolvedValue([{ id: 'c-2', contractNumber: 'CT-0002' }]);

      await expect(
        service.createBatch(dto({ contractIds: ['c-1', 'c-2'] }), 'user-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createBatch(dto({ contractIds: ['c-1', 'c-2'] }), 'user-1'),
      ).rejects.toThrow(/CT-0002/);

      // Must not have created a batch for the rejected attempt.
      expect(tx.interCoSettlementBatch.create).not.toHaveBeenCalled();
    });

    it('falls back to the raw id in the error message when the contract itself cannot be found', async () => {
      pendingService.getPendingContracts.mockResolvedValue([]);
      tx.contract.findMany.mockResolvedValue([]); // soft-deleted / never existed

      await expect(
        service.createBatch(dto({ contractIds: ['ghost-id'] }), 'user-1'),
      ).rejects.toThrow(/ghost-id/);
    });

    it('rejects duplicate contractIds in the same request', async () => {
      await expect(
        service.createBatch(dto({ contractIds: ['c-1', 'c-1'] }), 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateBatch', () => {
    it('rejects editing a batch that is not DRAFT (e.g. PENDING_APPROVAL)', async () => {
      tx.interCoSettlementBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        makerId: 'maker-1',
        status: 'PENDING_APPROVAL',
        deletedAt: null,
      });

      await expect(
        service.updateBatch('batch-1', dto(), 'maker-1'),
      ).rejects.toThrow(BadRequestException);
      expect(tx.interCoSettlementItem.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects when the caller is not the maker', async () => {
      tx.interCoSettlementBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        makerId: 'maker-1',
        status: 'DRAFT',
        deletedAt: null,
      });

      await expect(
        service.updateBatch('batch-1', dto(), 'someone-else'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('re-snapshots by deleting existing items and recreating from the pending engine', async () => {
      tx.interCoSettlementBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        makerId: 'maker-1',
        status: 'DRAFT',
        deletedAt: null,
        batchNumber: 'IC-20260801-0001',
      });
      pendingService.getPendingContracts.mockResolvedValue([
        pendingRow({ contractId: 'c-3', financedGl: new Prisma.Decimal(2000), commissionGl: new Prisma.Decimal(200) }),
      ]);

      await service.updateBatch('batch-1', dto({ contractIds: ['c-3'] }), 'maker-1');

      expect(tx.interCoSettlementItem.deleteMany).toHaveBeenCalledWith({
        where: { batchId: 'batch-1' },
      });
      const updateArgs = tx.interCoSettlementBatch.update.mock.calls[0][0];
      expect(updateArgs.data.items.create).toEqual([
        expect.objectContaining({ contractId: 'c-3' }),
      ]);
    });
  });

  describe('submitBatch', () => {
    it('rejects when the caller is not the maker', async () => {
      tx.interCoSettlementBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        makerId: 'maker-1',
        status: 'DRAFT',
        deletedAt: null,
        items: [],
      });

      await expect(service.submitBatch('batch-1', 'someone-else')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects submitting a non-DRAFT batch', async () => {
      tx.interCoSettlementBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        makerId: 'maker-1',
        status: 'PENDING_APPROVAL',
        deletedAt: null,
        items: [],
      });

      await expect(service.submitBatch('batch-1', 'maker-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when a contract got grabbed by another PENDING_APPROVAL/POSTED batch since createBatch', async () => {
      tx.interCoSettlementBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        makerId: 'maker-1',
        status: 'DRAFT',
        deletedAt: null,
        batchNumber: 'IC-20260801-0001',
        items: [{ contractId: 'c-1' }],
      });
      tx.interCoSettlementItem.findMany.mockResolvedValue([
        { contractId: 'c-1', contract: { contractNumber: 'CT-0001' } },
      ]);

      await expect(service.submitBatch('batch-1', 'maker-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.submitBatch('batch-1', 'maker-1')).rejects.toThrow(/CT-0001/);
    });

    it('moves DRAFT to PENDING_APPROVAL when the maker submits with no clashes', async () => {
      tx.interCoSettlementBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        makerId: 'maker-1',
        status: 'DRAFT',
        deletedAt: null,
        batchNumber: 'IC-20260801-0001',
        items: [{ contractId: 'c-1' }],
      });
      tx.interCoSettlementItem.findMany.mockResolvedValue([]);

      const result = await service.submitBatch('batch-1', 'maker-1');
      expect(result.status).toBe('PENDING_APPROVAL');
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'INTERCO_BATCH_SUBMITTED' }),
        }),
      );
    });
  });

  describe('withdrawBatch', () => {
    it('rejects when the caller is not the maker', async () => {
      tx.interCoSettlementBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        makerId: 'maker-1',
        status: 'PENDING_APPROVAL',
        deletedAt: null,
      });

      await expect(service.withdrawBatch('batch-1', 'someone-else')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('moves PENDING_APPROVAL back to DRAFT for the maker', async () => {
      tx.interCoSettlementBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        makerId: 'maker-1',
        status: 'PENDING_APPROVAL',
        deletedAt: null,
        batchNumber: 'IC-20260801-0001',
      });

      const result = await service.withdrawBatch('batch-1', 'maker-1');
      expect(result.status).toBe('DRAFT');
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'INTERCO_BATCH_WITHDRAWN' }),
        }),
      );
    });

    it('rejects withdrawing a DRAFT batch (nothing to withdraw)', async () => {
      tx.interCoSettlementBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        makerId: 'maker-1',
        status: 'DRAFT',
        deletedAt: null,
      });

      await expect(service.withdrawBatch('batch-1', 'maker-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('cancelBatch', () => {
    it.each(['POSTED', 'REVERSED', 'CANCELLED'])(
      'blocks cancelling a %s batch',
      async (status) => {
        tx.interCoSettlementBatch.findUnique.mockResolvedValue({
          id: 'batch-1',
          status,
          makerId: 'maker-1',
          deletedAt: null,
        });

        await expect(service.cancelBatch('batch-1', 'anyone')).rejects.toThrow(
          BadRequestException,
        );
      },
    );

    it.each(['DRAFT', 'PENDING_APPROVAL'])(
      'allows cancelling a %s batch regardless of who calls it (role gating is the controller\'s job)',
      async (status) => {
        tx.interCoSettlementBatch.findUnique.mockResolvedValue({
          id: 'batch-1',
          status,
          makerId: 'maker-1',
          batchNumber: 'IC-20260801-0001',
          deletedAt: null,
        });

        const result = await service.cancelBatch('batch-1', 'not-the-maker');
        expect(result.status).toBe('CANCELLED');
        expect(tx.auditLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ action: 'INTERCO_BATCH_CANCELLED' }),
          }),
        );
      },
    );
  });

  describe('uploadSlip', () => {
    it('rejects when the caller is not the maker', async () => {
      prisma.interCoSettlementBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        makerId: 'maker-1',
        status: 'DRAFT',
        deletedAt: null,
      });

      await expect(
        service.uploadSlip('batch-1', uploadedFile(), 'someone-else'),
      ).rejects.toThrow(ForbiddenException);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it.each(['POSTED', 'REVERSED', 'CANCELLED'])(
      'rejects attaching a slip to a %s batch',
      async (status) => {
        prisma.interCoSettlementBatch.findUnique.mockResolvedValue({
          id: 'batch-1',
          makerId: 'maker-1',
          status,
          deletedAt: null,
        });

        await expect(
          service.uploadSlip('batch-1', uploadedFile(), 'maker-1'),
        ).rejects.toThrow(BadRequestException);
        expect(storage.upload).not.toHaveBeenCalled();
      },
    );

    it.each(['DRAFT', 'PENDING_APPROVAL'])(
      'allows the maker to attach a slip to a %s batch and stores slipFileKey',
      async (status) => {
        prisma.interCoSettlementBatch.findUnique.mockResolvedValue({
          id: 'batch-1',
          makerId: 'maker-1',
          status,
          deletedAt: null,
        });

        const result = await service.uploadSlip('batch-1', uploadedFile(), 'maker-1');
        expect(storage.upload).toHaveBeenCalledTimes(1);
        const [key] = storage.upload.mock.calls[0];
        expect(key).toMatch(/^interco-slips\/batch-1\//);
        expect(result.slipFileKey).toBe(key);
      },
    );

    it('rejects a file whose magic bytes do not match its declared mimetype', async () => {
      prisma.interCoSettlementBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        makerId: 'maker-1',
        status: 'DRAFT',
        deletedAt: null,
      });

      const spoofed = uploadedFile({
        mimetype: 'image/jpeg',
        buffer: Buffer.from('not-a-real-jpeg-------'),
      });

      await expect(service.uploadSlip('batch-1', spoofed, 'maker-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(storage.upload).not.toHaveBeenCalled();
    });
  });
});
