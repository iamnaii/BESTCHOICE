import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContactsService } from '../contacts.service';

describe('ContactsService.list', () => {
  let svc: ContactsService;
  let prisma: any;
  beforeEach(async () => {
    prisma = { contact: { findMany: jest.fn(), count: jest.fn() } };
    const mod = await Test.createTestingModule({
      providers: [ContactsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    svc = mod.get(ContactsService);
  });
  it('returns paginated shape and filters soft-deleted', async () => {
    prisma.contact.findMany.mockResolvedValue([{ id: 'c1', name: 'A' }]);
    prisma.contact.count.mockResolvedValue(1);
    const res = await svc.list({ page: 1, limit: 50 });
    expect(res).toEqual({ data: [{ id: 'c1', name: 'A' }], total: 1, page: 1, limit: 50 });
    expect(prisma.contact.findMany.mock.calls[0][0].where.deletedAt).toBeNull();
  });
  it('filters by role via has', async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    prisma.contact.count.mockResolvedValue(0);
    await svc.list({ role: 'SUPPLIER' as any, page: 1, limit: 50 });
    expect(prisma.contact.findMany.mock.calls[0][0].where.roles).toEqual({ has: 'SUPPLIER' });
  });
  it('searches name/phone/taxId/contactCode case-insensitive', async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    prisma.contact.count.mockResolvedValue(0);
    await svc.list({ search: 'apple', page: 1, limit: 50 });
    expect(prisma.contact.findMany.mock.calls[0][0].where.OR).toEqual(
      expect.arrayContaining([
        { name: { contains: 'apple', mode: 'insensitive' } },
        { taxId: { contains: 'apple', mode: 'insensitive' } },
        { contactCode: { contains: 'apple', mode: 'insensitive' } },
      ]),
    );
  });
  it('filters by isActive boolean string', async () => {
    prisma.contact.findMany.mockResolvedValue([]);
    prisma.contact.count.mockResolvedValue(0);
    await svc.list({ isActive: 'false', page: 1, limit: 50 });
    expect(prisma.contact.findMany.mock.calls[0][0].where.isActive).toBe(false);
  });
});

describe('ContactsService.findOne', () => {
  let svc: ContactsService;
  let prisma: any;
  beforeEach(async () => {
    prisma = { contact: { findFirst: jest.fn() } };
    const mod = await Test.createTestingModule({
      providers: [ContactsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    svc = mod.get(ContactsService);
  });
  it('returns the contact with linked role records', async () => {
    prisma.contact.findFirst.mockResolvedValue({
      id: 'c1',
      roles: ['CUSTOMER', 'TRADE_IN_SELLER'],
      customers: [{ id: 'cus1' }],
      suppliers: [],
      tradeInsAsSeller: [{ id: 't1' }],
      externalFinanceCompany: [],
    });
    const res = await svc.findOne('c1');
    expect(res.customers).toHaveLength(1);
    expect(res.tradeInsAsSeller).toHaveLength(1);
  });
  it('throws NotFound when missing', async () => {
    prisma.contact.findFirst.mockResolvedValue(null);
    await expect(svc.findOne('nope')).rejects.toThrow('ไม่พบผู้ติดต่อ');
  });
});

describe('ContactsService.merge', () => {
  let svc: ContactsService;
  let prisma: any;
  beforeEach(async () => {
    const tx = {
      contact: { findMany: jest.fn(), update: jest.fn() },
      customer: { updateMany: jest.fn() },
      supplier: { updateMany: jest.fn() },
      tradeIn: { updateMany: jest.fn() },
      externalFinanceCompany: { updateMany: jest.fn() },
    };
    prisma = { $transaction: jest.fn(async (cb: any) => cb(tx)), _tx: tx };
    const mod = await Test.createTestingModule({
      providers: [ContactsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    svc = mod.get(ContactsService);
  });
  it('repoints role records to primary, unions roles, soft-deletes duplicate', async () => {
    prisma._tx.contact.findMany.mockResolvedValue([
      { id: 'p1', roles: ['CUSTOMER'] },
      { id: 'd1', roles: ['SUPPLIER'] },
    ]);
    await svc.merge({ primaryId: 'p1', duplicateId: 'd1' });
    expect(prisma._tx.customer.updateMany).toHaveBeenCalledWith({
      where: { contactId: 'd1' },
      data: { contactId: 'p1' },
    });
    expect(prisma._tx.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' } }),
    );
    expect(prisma._tx.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });
  it('rejects merging a contact into itself', async () => {
    await expect(svc.merge({ primaryId: 'x', duplicateId: 'x' })).rejects.toThrow(
      'ไม่สามารถรวมผู้ติดต่อกับตัวเองได้',
    );
  });
  it('throws NotFound when either contact missing', async () => {
    prisma._tx.contact.findMany.mockResolvedValue([{ id: 'p1', roles: ['CUSTOMER'] }]);
    await expect(svc.merge({ primaryId: 'p1', duplicateId: 'd1' })).rejects.toThrow(
      'ไม่พบผู้ติดต่อที่จะรวม',
    );
  });
});
