import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { IntercoSettlementService } from './interco-settlement.service';
import { IntercoPendingService, PendingContract } from './interco-pending.service';
import { IntercoBatchNumberService } from './interco-batch-number.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { PairedJournalService } from '../journal/paired-journal.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { StorageService } from '../storage/storage.service';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

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
  swapCreditGl: new Prisma.Decimal(0),
  shopBuybackPayableGl: new Prisma.Decimal(0),
  swapCreditEligible: false,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pairedJournal: any;

  beforeEach(async () => {
    (Sentry.captureMessage as jest.Mock).mockClear();
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
      // approveBatch's drift guard reads these via glContractBalance — default
      // to "no lines" (0 balance everywhere); approveBatch specs below
      // override per accountCode to match their item snapshot (no drift).
      journalLine: { findMany: jest.fn().mockResolvedValue([]) },
      // Phase 2 drift guard also reads the typed 11-2107/S21-3001 balances via
      // interco-typed-balance's raw SQL — 0 everywhere matches the fixtures'
      // swapCreditAmount/recallAmount = 0 (no drift).
      $queryRaw: jest.fn().mockResolvedValue([{ balance: 0 }]),
      interCompanyTransaction: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      // approveBatch step 1b reads `interco_maker_checker_enabled` here.
      // Default = row absent → maker-checker OFF (owner 2026-08-03: approval is
      // governed by role assignment, not a hard different-person rule).
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
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

    pendingService = {
      getPendingContracts: jest.fn().mockResolvedValue([]),
      getPendingRecalls: jest.fn().mockResolvedValue([]),
    };
    batchNumberService = { next: jest.fn().mockResolvedValue('IC-20260801-0001') };
    // approveBatch/reverseBatch (Task 4) deps — unused by the create/update/
    // submit/withdraw/cancel specs below, just need to satisfy Nest DI.
    pairedJournal = { postPaired: jest.fn() };
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

    it('W1: rejects a pending row with a negative GL component (e.g. commissionGl < 0 from a stray JV) and reports it to Sentry', async () => {
      pendingService.getPendingContracts.mockResolvedValue([
        pendingRow({
          contractId: 'c-1',
          financedGl: new Prisma.Decimal(11000),
          // HAVING SUM(cr-dr) on 21-1101+21-1102 combined still nets +10500
          // (11000 - 500) even though this single component is negative.
          commissionGl: new Prisma.Decimal(-500),
        }),
      ]);

      await expect(service.createBatch(dto({ contractIds: ['c-1'] }), 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createBatch(dto({ contractIds: ['c-1'] }), 'user-1')).rejects.toThrow(
        /CT-0001.*21-1102/,
      );
      expect(tx.interCoSettlementBatch.create).not.toHaveBeenCalled();
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('negative GL component'),
        expect.objectContaining({
          level: 'warning',
          tags: { subsystem: 'interco-settlement' },
          extra: expect.objectContaining({ contractId: 'c-1', accountCode: '21-1102' }),
        }),
      );
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

  describe('approveBatch', () => {
    /** No-drift batch: 1 item, live GL (mocked via tx.journalLine) matches the snapshot exactly. */
    function approvableBatchFixture() {
      return {
        id: 'batch-1',
        status: 'PENDING_APPROVAL',
        deletedAt: null,
        makerId: 'maker-1',
        batchNumber: 'IC-20260801-0001',
        transferDate: new Date('2026-07-15T00:00:00Z'),
        financeBankCode: '11-1201',
        shopBankCode: 'S11-1201',
        totalFinanced: new Prisma.Decimal(100),
        totalCommission: new Prisma.Decimal(0),
        totalAmount: new Prisma.Decimal(100),
        shopPostedAmount: new Prisma.Decimal(100),
        // Phase 2 snapshot totals (no deduction on this fixture)
        totalDeduction: new Prisma.Decimal(0),
        netTransferAmount: new Prisma.Decimal(100),
        shopNetAmount: new Prisma.Decimal(100),
        items: [
          {
            contractId: 'c-1',
            itemType: 'SETTLEMENT',
            financedGl: new Prisma.Decimal(100),
            commissionGl: new Prisma.Decimal(0),
            shopFinancedGl: new Prisma.Decimal(100),
            shopCommissionGl: new Prisma.Decimal(0),
            legacyNoShop: false,
            swapCreditAmount: new Prisma.Decimal(0),
            recallAmount: new Prisma.Decimal(0),
            contract: { contractNumber: 'CT-0001' },
          },
        ],
      };
    }

    /** Wires tx.journalLine.findMany so glContractBalance reproduces the fixture's snapshot exactly (drift guard passes). */
    function noDriftJournalLineMock() {
      tx.journalLine.findMany.mockImplementation(({ where }: { where: { accountCode: string } }) => {
        if (where.accountCode === '21-1101') {
          return Promise.resolve([{ debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(100) }]);
        }
        if (where.accountCode === 'S11-3001') {
          return Promise.resolve([{ debit: new Prisma.Decimal(100), credit: new Prisma.Decimal(0) }]);
        }
        return Promise.resolve([]); // 21-1102 / S11-3002 → 0, matches fixture
      });
    }

    it('maker-checker DEFAULT OFF (no SystemConfig row): the SAME person may approve the batch they created — approverId === makerId, both still recorded', async () => {
      tx.interCoSettlementBatch.findUnique.mockResolvedValue(approvableBatchFixture());
      noDriftJournalLineMock();
      pairedJournal.postPaired.mockResolvedValue({
        financeJournalEntryId: 'je-finance-1',
        shopJournalEntryId: 'je-shop-1',
      });

      // maker-1 approves their OWN batch — allowed now that approval is gated by
      // role (@Roles OWNER/FINANCE_MANAGER at the controller) instead of SoD.
      const posted = await service.approveBatch('batch-1', 'maker-1');

      expect(tx.systemConfig.findUnique).toHaveBeenCalledWith({
        where: { key: 'interco_maker_checker_enabled' },
      });
      expect(posted.status).toBe('POSTED');
      expect(posted.approverId).toBe('maker-1');
      expect(pairedJournal.postPaired).toHaveBeenCalled();

      // Audit trail unchanged: the batch row carries approverId, and the
      // INTERCO_BATCH_APPROVED audit log carries the acting userId — even though
      // maker and approver are the same human.
      const updateArgs = tx.interCoSettlementBatch.update.mock.calls[0][0];
      expect(updateArgs.data.approverId).toBe('maker-1');
      const auditArgs = tx.auditLog.create.mock.calls[0][0];
      expect(auditArgs.data.userId).toBe('maker-1');
      expect(auditArgs.data.action).toBe('INTERCO_BATCH_APPROVED');
      expect(auditArgs.data.entityId).toBe('batch-1');
    });

    it("maker-checker ON (interco_maker_checker_enabled='true'): the maker approving their own batch is rejected with ForbiddenException, nothing posted", async () => {
      tx.interCoSettlementBatch.findUnique.mockResolvedValue(approvableBatchFixture());
      noDriftJournalLineMock();
      tx.systemConfig.findUnique.mockResolvedValue({ value: 'true' });

      await expect(service.approveBatch('batch-1', 'maker-1')).rejects.toThrow(ForbiddenException);
      await expect(service.approveBatch('batch-1', 'maker-1')).rejects.toThrow(
        /ผู้อนุมัติต้องไม่ใช่ผู้สร้างรอบ/,
      );

      expect(pairedJournal.postPaired).not.toHaveBeenCalled();
      expect(tx.interCoSettlementBatch.update).not.toHaveBeenCalled();
    });

    it("maker-checker ON but a DIFFERENT person approves → allowed (the flag only blocks maker === approver)", async () => {
      tx.interCoSettlementBatch.findUnique.mockResolvedValue(approvableBatchFixture());
      noDriftJournalLineMock();
      tx.systemConfig.findUnique.mockResolvedValue({ value: 'true' });
      pairedJournal.postPaired.mockResolvedValue({
        financeJournalEntryId: 'je-finance-1',
        shopJournalEntryId: 'je-shop-1',
      });

      const posted = await service.approveBatch('batch-1', 'approver-1');
      expect(posted.status).toBe('POSTED');
      expect(posted.approverId).toBe('approver-1');
    });

    it('a non-"true" config value (e.g. "false") leaves maker-checker OFF — same person may still approve', async () => {
      tx.interCoSettlementBatch.findUnique.mockResolvedValue(approvableBatchFixture());
      noDriftJournalLineMock();
      tx.systemConfig.findUnique.mockResolvedValue({ value: 'false' });
      pairedJournal.postPaired.mockResolvedValue({
        financeJournalEntryId: 'je-finance-1',
        shopJournalEntryId: 'je-shop-1',
      });

      const posted = await service.approveBatch('batch-1', 'maker-1');
      expect(posted.status).toBe('POSTED');
      expect(posted.approverId).toBe('maker-1');
    });

    it('W2: translates a P2002 race from postPaired into ConflictException without marking the batch POSTED', async () => {
      tx.interCoSettlementBatch.findUnique.mockResolvedValue(approvableBatchFixture());
      noDriftJournalLineMock();
      pairedJournal.postPaired.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );

      await expect(service.approveBatch('batch-1', 'approver-1')).rejects.toThrow(
        ConflictException,
      );
      await expect(service.approveBatch('batch-1', 'approver-1')).rejects.toThrow(/ลงบัญชีไปแล้ว/);

      // The whole $transaction rolled back on the thrown ConflictException —
      // the batch-status update (step 7) must never have been reached/committed.
      expect(tx.interCoSettlementBatch.update).not.toHaveBeenCalled();
    });
  });
});
