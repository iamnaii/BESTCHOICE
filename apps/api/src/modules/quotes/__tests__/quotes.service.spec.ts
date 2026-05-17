import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { QuotesService } from '../quotes.service';
import { PrismaService } from '../../../prisma/prisma.service';

// Mock sequence util so tests don't need a real `quote` delegate
jest.mock('../../../utils/sequence.util', () => ({
  generateQuoteNumber: jest.fn().mockResolvedValue('QU-20260517-0001'),
  generateSaleNumber: jest.fn().mockResolvedValue('SL000123'),
}));

describe('QuotesService', () => {
  let service: QuotesService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    const txQuote = {
      create: jest.fn((args) =>
        Promise.resolve({
          id: 'q-new',
          quoteNumber: 'QU-20260517-0001',
          status: 'DRAFT',
          ...args.data,
          items: [{ id: 'qi-1', quantity: 1 }],
        }),
      ),
      update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      findFirst: jest.fn().mockResolvedValue({ convertedToSaleId: null }),
    };

    const txQuoteItem = {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    };

    const txSale = {
      create: jest.fn((args) => Promise.resolve({ id: 'sale-new', ...args.data })),
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
        fn({ quote: txQuote, quoteItem: txQuoteItem, sale: txSale }),
      ),
      _tx: { quote: txQuote, quoteItem: txQuoteItem, sale: txSale },
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
    );

    expect(prisma.$transaction).toHaveBeenCalled();
    const createArgs = prisma._tx.quote.create.mock.calls[0][0];
    // subtotal = 35000 + 2*5990 = 46980; total = 46980 - 1000 + 0 = 45980
    expect(Number(createArgs.data.subtotal)).toBe(46980);
    expect(Number(createArgs.data.total)).toBe(45980);
    expect(createArgs.data.status).toBe('DRAFT');
    expect(createArgs.data.quoteNumber).toBe('QU-20260517-0001');
    expect(result.id).toBe('q-new');
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
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // 2. update — only DRAFT mutable
  it('update — rejects non-DRAFT quotes', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({ id: 'q-1', status: 'SENT' });
    await expect(
      service.update('q-1', { notes: 'updated' }),
    ).rejects.toThrow(BadRequestException);
  });

  // 3. send — DRAFT → SENT
  it('send — DRAFT → SENT sets sentAt', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({ id: 'q-1', status: 'DRAFT' });
    await service.send('q-1');
    expect(prisma.quote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'q-1' },
        data: expect.objectContaining({ status: 'SENT', sentAt: expect.any(Date) }),
      }),
    );
  });

  it('send — rejects SENT/ACCEPTED quotes', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({ id: 'q-1', status: 'SENT' });
    await expect(service.send('q-1')).rejects.toThrow(BadRequestException);
  });

  // 4. accept — SENT → ACCEPTED requires not expired
  it('accept — SENT → ACCEPTED inside validity', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({
      id: 'q-1',
      status: 'SENT',
      validUntil: new Date(Date.now() + 86400 * 1000),
    });
    await service.accept('q-1');
    expect(prisma.quote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACCEPTED', acceptedAt: expect.any(Date) }),
      }),
    );
  });

  it('accept — rejects expired quote', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({
      id: 'q-1',
      status: 'SENT',
      validUntil: new Date(Date.now() - 86400 * 1000),
    });
    await expect(service.accept('q-1')).rejects.toThrow(BadRequestException);
  });

  // 5. convert — ACCEPTED → Sale (CASH) + flips CONVERTED + saleId
  it('convert — creates Sale + flips quote CONVERTED', async () => {
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

    const result = await service.convert('q-1', {}, 'user-1');
    expect(prisma._tx.sale.create).toHaveBeenCalled();
    expect(result.sale.id).toBe('sale-new');
    // Verify the tx.quote.update was called to flip status + link
    expect(prisma._tx.quote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CONVERTED',
          convertedToSaleId: 'sale-new',
        }),
      }),
    );
  });

  it('convert — rejects non-ACCEPTED quote', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({
      id: 'q-1',
      status: 'DRAFT',
      convertedToSaleId: null,
      items: [],
    });
    await expect(service.convert('q-1', {}, 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('convert — rejects double-convert (already linked)', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({
      id: 'q-1',
      status: 'ACCEPTED',
      convertedToSaleId: 'sale-existing',
      items: [{ productId: 'prod-1' }],
    });
    await expect(service.convert('q-1', {}, 'user-1')).rejects.toThrow(ConflictException);
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

  // 7. findAll — status filter passed to where
  it('findAll — applies status + branchId filters', async () => {
    await service.findAll({ status: 'DRAFT', branchId: 'br-1', page: 1, limit: 20 });
    const findArgs = prisma.quote.findMany.mock.calls[0][0];
    expect(findArgs.where).toMatchObject({
      deletedAt: null,
      status: 'DRAFT',
      branchId: 'br-1',
    });
    expect(findArgs.take).toBe(20);
  });

  // 8. delete — DRAFT only + soft-delete
  it('remove — soft-deletes DRAFT quote', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({ id: 'q-1', status: 'DRAFT' });
    await service.remove('q-1');
    expect(prisma.quote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'q-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it('remove — rejects non-DRAFT quote', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce({ id: 'q-1', status: 'CONVERTED' });
    await expect(service.remove('q-1')).rejects.toThrow(BadRequestException);
  });

  it('findOne — throws when not found', async () => {
    prisma.quote.findFirst.mockResolvedValueOnce(null);
    await expect(service.findOne('q-missing')).rejects.toThrow(NotFoundException);
  });
});
