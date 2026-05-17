import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { QuotesService } from '../quotes.service';
import { PrismaService } from '../../../prisma/prisma.service';

// Mock sequence util so tests don't need a real `quote` delegate
jest.mock('../../../utils/sequence.util', () => ({
  generateQuoteNumber: jest.fn().mockResolvedValue('QU-20260517-0001'),
  generateSaleNumber: jest.fn().mockResolvedValue('SL000123'),
}));

const OWNER = { id: 'u-owner', role: 'OWNER', branchId: null as string | null };
const SALES_BR1 = { id: 'u-sales', role: 'SALES', branchId: 'br-1' };
const SALES_BR2 = { id: 'u-sales-other', role: 'SALES', branchId: 'br-2' };

describe('QuotesService', () => {
  let service: QuotesService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    const txAuditLog = {
      create: jest.fn().mockResolvedValue({ id: 'log-1' }),
    };

    const txQuote = {
      create: jest.fn((args) =>
        Promise.resolve({
          id: 'q-new',
          quoteNumber: 'QU-20260517-0001',
          status: 'DRAFT',
          total: args.data.total,
          ...args.data,
          items: [{ id: 'qi-1', quantity: 1 }],
        }),
      ),
      update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue({ convertedToSaleId: null }),
    };

    const txQuoteItem = {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    };

    const txSale = {
      create: jest.fn((args) =>
        Promise.resolve({ id: 'sale-new', saleNumber: 'SL000123', ...args.data }),
      ),
    };

    prisma = {
      quote: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cust-1' }),
      },
      branch: {
        findFirst: jest.fn().mockResolvedValue({ id: 'br-1' }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $transaction: jest.fn(async (fn: any) =>
        fn({
          quote: txQuote,
          quoteItem: txQuoteItem,
          sale: txSale,
          auditLog: txAuditLog,
        }),
      ),
      _tx: { quote: txQuote, quoteItem: txQuoteItem, sale: txSale, auditLog: txAuditLog },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [QuotesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(QuotesService);
  });

  // 1. create — happy path computes subtotal/total + persists DRAFT
  it('create — computes subtotal/total + persists DRAFT with quote number', async () => {
    const future = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
    const result = await service.create(
      {
        customerId: 'cust-1',
        branchId: 'br-1',
        validUntil: future,
        items: [
          { description: 'iPhone 15', quantity: 1, unitPrice: 35000 },
          { description: 'AirPods', quantity: 2, unitPrice: 5990 },
        ],
        discount: 1000,
        vatAmount: 0,
      },
      'user-1',
      OWNER,
    );

    expect(prisma.$transaction).toHaveBeenCalled();
    const createArgs = prisma._tx.quote.create.mock.calls[0][0];
    // subtotal = 35000 + 2*5990 = 46980; total = 46980 - 1000 + 0 = 45980
    expect(Number(createArgs.data.subtotal)).toBe(46980);
    expect(Number(createArgs.data.total)).toBe(45980);
    expect(createArgs.data.status).toBe('DRAFT');
    expect(createArgs.data.quoteNumber).toBe('QU-20260517-0001');
    expect(result.id).toBe('q-new');
    // Audit log written
    expect(prisma._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'QUOTE_CREATED',
          entity: 'quote',
        }),
      }),
    );
  });

  it('create — uses Prisma.Decimal for totals (precision)', async () => {
    const future = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
    await service.create(
      {
        customerId: 'cust-1',
        branchId: 'br-1',
        validUntil: future,
        // 0.1 + 0.2 typically floats to 0.30000000000000004 in JS Number math
        items: [{ description: 'penny test', quantity: 3, unitPrice: 0.1 }],
        discount: 0.2,
        vatAmount: 0,
      },
      'user-1',
      OWNER,
    );
    const createArgs = prisma._tx.quote.create.mock.calls[0][0];
    // Decimal math: subtotal = 0.3, total = 0.3 - 0.2 = 0.1 exactly
    expect(createArgs.data.total).toBeInstanceOf(Prisma.Decimal);
    expect(createArgs.data.total.toFixed(2)).toBe('0.10');
  });

  it('create — rejects past validUntil', async () => {
    await expect(
      service.create(
        {
          customerId: 'cust-1',
          branchId: 'br-1',
          validUntil: new Date(Date.now() - 7 * 86400 * 1000).toISOString(),
          items: [{ description: 'X', quantity: 1, unitPrice: 100 }],
        },
        'user-1',
        OWNER,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('create — rejects discount > subtotal', async () => {
    const future = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
    await expect(
      service.create(
        {
          customerId: 'cust-1',
          branchId: 'br-1',
          validUntil: future,
          items: [{ description: 'X', quantity: 1, unitPrice: 100 }],
          discount: 500, // > subtotal 100
          vatAmount: 0,
        },
        'user-1',
        OWNER,
      ),
    ).rejects.toThrow(/ส่วนลด.*ห้ามมากกว่า/);
  });

  it('create — SALES cannot create against another branch', async () => {
    const future = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
    await expect(
      service.create(
        {
          customerId: 'cust-1',
          branchId: 'br-1',
          validUntil: future,
          items: [{ description: 'X', quantity: 1, unitPrice: 100 }],
        },
        'user-1',
        SALES_BR2, // SALES from br-2 trying to write to br-1
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  // 2. update — only DRAFT mutable
  it('update — rejects non-DRAFT quotes', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({ id: 'q-1', status: 'SENT', branchId: 'br-1' });
    await expect(service.update('q-1', { notes: 'updated' }, OWNER)).rejects.toThrow(
      BadRequestException,
    );
  });

  // 3. send — DRAFT → SENT
  it('send — DRAFT → SENT sets sentAt + audit log', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({ id: 'q-1', status: 'DRAFT', branchId: 'br-1' });
    await service.send('q-1', OWNER);
    expect(prisma._tx.quote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'q-1' },
        data: expect.objectContaining({ status: 'SENT', sentAt: expect.any(Date) }),
      }),
    );
    expect(prisma._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'QUOTE_SENT', entity: 'quote' }),
      }),
    );
  });

  it('send — rejects SENT/ACCEPTED quotes', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({ id: 'q-1', status: 'SENT', branchId: 'br-1' });
    await expect(service.send('q-1', OWNER)).rejects.toThrow(BadRequestException);
  });

  // 4. accept — SENT → ACCEPTED requires not expired
  it('accept — SENT → ACCEPTED inside validity + audit', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({
      id: 'q-1',
      status: 'SENT',
      branchId: 'br-1',
      validUntil: new Date(Date.now() + 86400 * 1000),
    });
    await service.accept('q-1', OWNER);
    expect(prisma._tx.quote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACCEPTED', acceptedAt: expect.any(Date) }),
      }),
    );
    expect(prisma._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'QUOTE_ACCEPTED' }),
      }),
    );
  });

  it('accept — rejects expired quote', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({
      id: 'q-1',
      status: 'SENT',
      branchId: 'br-1',
      validUntil: new Date(Date.now() - 86400 * 1000),
    });
    await expect(service.accept('q-1', OWNER)).rejects.toThrow(BadRequestException);
  });

  it('reject — SENT → REJECTED + audit', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({ id: 'q-1', status: 'SENT', branchId: 'br-1' });
    await service.reject('q-1', OWNER);
    expect(prisma._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'QUOTE_REJECTED' }),
      }),
    );
  });

  // 5. convert — ACCEPTED → Sale (CASH) + flips CONVERTED + saleId
  it('convert — creates Sale + flips quote CONVERTED + audit log', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({
      id: 'q-1',
      status: 'ACCEPTED',
      convertedToSaleId: null,
      quoteNumber: 'QU-20260517-0001',
      customerId: 'cust-1',
      branchId: 'br-1',
      total: new Prisma.Decimal(45980),
      discount: new Prisma.Decimal(1000),
      items: [{ productId: 'prod-1', quantity: 1, unitPrice: 35000, amount: 35000 }],
    });

    const result = await service.convert('q-1', {}, 'user-1', OWNER);
    // Race-safe claim: updateMany with status filter
    expect(prisma._tx.quote.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'q-1',
          status: 'ACCEPTED',
          convertedToSaleId: null,
        }),
        data: expect.objectContaining({ status: 'CONVERTED' }),
      }),
    );
    expect(prisma._tx.sale.create).toHaveBeenCalled();
    expect(result.sale.id).toBe('sale-new');
    // Link-back update
    expect(prisma._tx.quote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ convertedToSaleId: 'sale-new' }),
      }),
    );
    // Audit
    expect(prisma._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'QUOTE_CONVERTED',
          entity: 'quote',
        }),
      }),
    );
  });

  it('convert — rejects non-ACCEPTED quote', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({
      id: 'q-1',
      status: 'DRAFT',
      convertedToSaleId: null,
      branchId: 'br-1',
      items: [],
    });
    await expect(service.convert('q-1', {}, 'user-1', OWNER)).rejects.toThrow(BadRequestException);
  });

  it('convert — rejects double-convert (already linked)', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({
      id: 'q-1',
      status: 'ACCEPTED',
      convertedToSaleId: 'sale-existing',
      branchId: 'br-1',
      items: [{ productId: 'prod-1' }],
    });
    await expect(service.convert('q-1', {}, 'user-1', OWNER)).rejects.toThrow(ConflictException);
  });

  it('convert — race: second concurrent caller throws ConflictException (updateMany count=0)', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({
      id: 'q-1',
      status: 'ACCEPTED',
      convertedToSaleId: null,
      quoteNumber: 'QU-20260517-0001',
      customerId: 'cust-1',
      branchId: 'br-1',
      total: new Prisma.Decimal(45980),
      discount: new Prisma.Decimal(1000),
      items: [{ productId: 'prod-1', quantity: 1, unitPrice: 35000, amount: 35000 }],
    });
    // Simulate the race — another concurrent tx already flipped the quote
    prisma._tx.quote.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.convert('q-1', {}, 'user-1', OWNER)).rejects.toThrow(ConflictException);
    // CRITICAL: no Sale was created when the race-claim failed
    expect(prisma._tx.sale.create).not.toHaveBeenCalled();
  });

  it('convert — SALES cannot convert quote from another branch', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({
      id: 'q-1',
      status: 'ACCEPTED',
      convertedToSaleId: null,
      branchId: 'br-1',
      items: [{ productId: 'prod-1' }],
    });
    await expect(service.convert('q-1', {}, 'user-1', SALES_BR2)).rejects.toThrow(
      ForbiddenException,
    );
  });

  // 6. PDF — buildPdfData returns shape
  it('buildPdfData — returns hydrated shape for renderer', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({
      id: 'q-1',
      quoteNumber: 'QU-20260517-0001',
      status: 'DRAFT',
      createdAt: new Date('2026-05-17'),
      validUntil: new Date('2026-05-24'),
      notes: 'หมายเหตุ',
      subtotal: new Prisma.Decimal(46980),
      discount: new Prisma.Decimal(1000),
      vatAmount: new Prisma.Decimal(0),
      total: new Prisma.Decimal(45980),
      items: [
        { description: 'iPhone 15', quantity: 1, unitPrice: 35000, amount: 35000 },
      ],
      customer: { id: 'cust-1', name: 'นาย ก', phone: '0812345678', addressCurrent: 'BKK', addressIdCard: null },
      branch: {
        id: 'br-1',
        name: 'สาขาลาดพร้าว',
        company: { nameTh: 'BESTCHOICE SHOP', taxId: '0105500001234', address: '123 ถ.', phone: '021234567' },
      },
      createdBy: { name: 'พนักงาน X' },
    });

    const data = await service.buildPdfData('q-1');
    expect(data.quoteNumber).toBe('QU-20260517-0001');
    expect(data.companyName).toBe('BESTCHOICE SHOP');
    expect(data.companyTaxId).toBe('0105500001234');
    expect(data.subtotal).toBe(46980);
    expect(data.total).toBe(45980);
    expect(data.items).toHaveLength(1);
  });

  // 7. findAll — status filter passed to where + branch scoping
  it('findAll — applies status + branchId filters (OWNER cross-branch)', async () => {
    await service.findAll({ status: 'DRAFT', branchId: 'br-1', page: 1, limit: 20 }, OWNER);
    const findArgs = prisma.quote.findMany.mock.calls[0][0];
    expect(findArgs.where).toMatchObject({
      deletedAt: null,
      status: 'DRAFT',
      branchId: 'br-1',
    });
    expect(findArgs.take).toBe(20);
  });

  it('findAll — SALES is forced to own branchId regardless of query param', async () => {
    await service.findAll({}, SALES_BR1);
    const findArgs = prisma.quote.findMany.mock.calls[0][0];
    expect(findArgs.where.branchId).toBe('br-1');
  });

  it('findAll — SALES requesting another branchId is forbidden', async () => {
    await expect(service.findAll({ branchId: 'br-2' }, SALES_BR1)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('findOne — SALES cannot read quote from another branch (returns NotFound to avoid leakage)', async () => {
    // Even though the row exists in DB, the scoped findFirst returns null
    prisma.quote.findFirst.mockResolvedValueOnce(null);
    await expect(service.findOne('q-1', SALES_BR1)).rejects.toThrow(NotFoundException);
    // Verify the scope was applied to the where clause
    const findArgs = prisma.quote.findFirst.mock.calls[0][0];
    expect(findArgs.where.branchId).toBe('br-1');
  });

  // 8. delete — DRAFT only + soft-delete + audit
  it('remove — soft-deletes DRAFT quote + audit', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({ id: 'q-1', status: 'DRAFT', branchId: 'br-1' });
    await service.remove('q-1', OWNER);
    expect(prisma._tx.quote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'q-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
    expect(prisma._tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'QUOTE_DELETED' }),
      }),
    );
  });

  it('remove — rejects non-DRAFT quote', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({ id: 'q-1', status: 'CONVERTED', branchId: 'br-1' });
    await expect(service.remove('q-1', OWNER)).rejects.toThrow(BadRequestException);
  });

  it('findOne — throws when not found', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce(null);
    await expect(service.findOne('q-missing', OWNER)).rejects.toThrow(NotFoundException);
  });
});
