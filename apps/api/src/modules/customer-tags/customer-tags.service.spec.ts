import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerTagsService } from './customer-tags.service';

const mockPrisma = {
  customer: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  contract: {
    count: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  auditLog: {
    count: jest.fn(),
  },
  customerTag: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

describe('CustomerTagsService', () => {
  let service: CustomerTagsService;

  const NOW = new Date('2026-04-25T00:00:00.000Z');
  const TWO_YEARS_AGO = new Date('2024-04-25T00:00:00.000Z');
  const RECENT_DATE = new Date('2026-04-15T00:00:00.000Z'); // 10 days old

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(NOW);

    mockPrisma.customerTag.findFirst.mockResolvedValue(null);
    mockPrisma.customerTag.findMany.mockResolvedValue([]);
    mockPrisma.customerTag.create.mockImplementation((args: any) =>
      Promise.resolve({ id: 'tag-1', deletedAt: null, ...args.data }),
    );
    mockPrisma.customerTag.update.mockImplementation((args: any) =>
      Promise.resolve({ id: args.where.id, ...args.data }),
    );
    mockPrisma.customerTag.updateMany.mockResolvedValue({ count: 0 });

    mockPrisma.contract.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(0);

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerTagsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = mod.get(CustomerTagsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('applyTag (manual + auto)', () => {
    it('creates a new tag row when none exists', async () => {
      mockPrisma.customerTag.findFirst.mockResolvedValueOnce(null);
      const result = await service.applyTag('cust-1', 'BLACKLIST', 'MANUAL', 'fraud', 'user-1');
      expect(mockPrisma.customerTag.create).toHaveBeenCalled();
      expect(result.tag).toBe('BLACKLIST');
    });

    it('returns existing tag row idempotently when already active (no duplicate insert)', async () => {
      const existing = { id: 'tag-existing', tag: 'VIP', deletedAt: null };
      mockPrisma.customerTag.findFirst.mockResolvedValueOnce(existing as any);
      const result = await service.applyTag('cust-1', 'VIP', 'AUTO');
      expect(mockPrisma.customerTag.create).not.toHaveBeenCalled();
      expect(result).toBe(existing as any);
    });
  });

  describe('removeTag / removeById', () => {
    it('soft-deletes active tag for (customer, tag)', async () => {
      mockPrisma.customerTag.updateMany.mockResolvedValueOnce({ count: 1 });
      const result = await service.removeTag('cust-1', 'VIP', 'user-1');
      expect(mockPrisma.customerTag.updateMany).toHaveBeenCalledWith({
        where: { customerId: 'cust-1', tag: 'VIP', deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(result).toEqual({ removed: 1 });
    });

    it('removeById throws NotFoundException for missing tag', async () => {
      mockPrisma.customerTag.findFirst.mockResolvedValueOnce(null);
      await expect(service.removeById('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('recomputeForCustomer — auto-tag rules', () => {
    function setupCustomer(opts: {
      contractCount?: number;
      firstContractAt?: Date | null;
      contractIds?: string[];
      brokenLifetime?: number;
      broken12mo?: number;
      broken90d?: number;
      customerCreatedAt?: Date;
    }) {
      const contractIds = opts.contractIds ?? (opts.contractCount
        ? Array.from({ length: opts.contractCount }, (_, i) => `c${i + 1}`)
        : []);
      mockPrisma.customer.findFirst.mockResolvedValue({
        id: 'cust-1',
        createdAt: opts.customerCreatedAt ?? RECENT_DATE,
      });
      mockPrisma.contract.count.mockResolvedValue(opts.contractCount ?? 0);
      mockPrisma.contract.findFirst.mockResolvedValue(
        opts.firstContractAt ? { createdAt: opts.firstContractAt } : null,
      );
      mockPrisma.contract.findMany.mockResolvedValue(
        contractIds.map((id) => ({ id })),
      );
      // The lifetime / 12mo / 90d count calls fire in order inside the
      // service. The service early-returns 0 when contractIds is empty so we
      // only need to mock return values when contracts exist.
      mockPrisma.auditLog.count
        .mockResolvedValueOnce(opts.brokenLifetime ?? 0) // lifetime
        .mockResolvedValueOnce(opts.broken12mo ?? 0) // 12 month
        .mockResolvedValueOnce(opts.broken90d ?? 0); // 90 day
    }

    it('VIP: ≥3 contracts AND zero broken-promise in last 12mo → tag applied', async () => {
      setupCustomer({
        contractCount: 4,
        firstContractAt: new Date('2024-01-01'),
        broken12mo: 0,
      });
      const result = await service.recomputeForCustomer('cust-1');
      expect(result.added).toContain('VIP');
    });

    it('NOT VIP when broken promise within 12mo (even with ≥3 contracts)', async () => {
      setupCustomer({
        contractCount: 5,
        firstContractAt: new Date('2024-01-01'),
        broken12mo: 1,
      });
      const result = await service.recomputeForCustomer('cust-1');
      expect(result.added).not.toContain('VIP');
    });

    it('HIGH_RISK: ≥3 broken promises in last 90 days → tag applied', async () => {
      setupCustomer({
        contractCount: 1,
        firstContractAt: new Date('2026-04-20'),
        broken90d: 3,
        broken12mo: 5,
      });
      const result = await service.recomputeForCustomer('cust-1');
      expect(result.added).toContain('HIGH_RISK');
    });

    it('NEW: first contract <30 days ago AND only one contract → tag applied', async () => {
      setupCustomer({
        contractCount: 1,
        firstContractAt: RECENT_DATE,
      });
      const result = await service.recomputeForCustomer('cust-1');
      expect(result.added).toContain('NEW');
    });

    it('LOYAL: customer >2yr old AND zero broken promise lifetime → tag applied', async () => {
      setupCustomer({
        contractCount: 2,
        customerCreatedAt: new Date('2023-01-01'),
        firstContractAt: new Date('2023-02-01'),
        brokenLifetime: 0,
      });
      const result = await service.recomputeForCustomer('cust-1');
      expect(result.added).toContain('LOYAL');
    });

    it('BLACKLIST: never auto-applied (manual only)', async () => {
      setupCustomer({
        contractCount: 10,
        customerCreatedAt: new Date('2020-01-01'),
        firstContractAt: new Date('2020-02-01'),
        brokenLifetime: 50,
        broken12mo: 30,
        broken90d: 20,
      });
      const result = await service.recomputeForCustomer('cust-1');
      expect(result.added).not.toContain('BLACKLIST');
      expect(result.removed).not.toContain('BLACKLIST');
    });

    it('removes a stale auto tag when conditions no longer hold', async () => {
      setupCustomer({
        contractCount: 1,
        firstContractAt: new Date('2025-01-01'), // not new anymore
      });
      mockPrisma.customerTag.findMany.mockResolvedValueOnce([
        { id: 'tag-stale', tag: 'NEW', source: 'AUTO' },
      ]);
      const result = await service.recomputeForCustomer('cust-1');
      expect(result.removed).toContain('NEW');
      expect(mockPrisma.customerTag.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tag-stale' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });

    it('NotFoundException when customer missing', async () => {
      mockPrisma.customer.findFirst.mockResolvedValueOnce(null);
      await expect(service.recomputeForCustomer('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('recomputeAll (cron entry-point)', () => {
    it('iterates every active customer and continues past per-customer errors', async () => {
      mockPrisma.customer.findMany.mockResolvedValueOnce([
        { id: 'cust-1', createdAt: TWO_YEARS_AGO },
        { id: 'cust-2', createdAt: TWO_YEARS_AGO },
      ]);
      // First customer: contract.count throws — service must skip and continue.
      mockPrisma.contract.count.mockImplementationOnce(() => {
        throw new Error('boom');
      });
      mockPrisma.contract.count.mockResolvedValueOnce(1);
      mockPrisma.contract.findFirst.mockResolvedValueOnce({ createdAt: RECENT_DATE });
      mockPrisma.contract.findMany.mockResolvedValueOnce([{ id: 'c1' }]);

      const result = await service.recomputeAll();
      expect(result.processed).toBe(2);
    });
  });
});
