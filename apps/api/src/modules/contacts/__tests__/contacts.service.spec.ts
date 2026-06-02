import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ContactsService } from '../contacts.service';

describe('ContactsService.list', () => {
  let svc: ContactsService;
  let prisma: any;
  beforeEach(async () => {
    prisma = { contact: { findMany: jest.fn(), count: jest.fn() } };
    const mod = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
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
      providers: [
        ContactsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
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
  it('selects read-through fields per role record (no customer PII address)', async () => {
    prisma.contact.findFirst.mockResolvedValue({ id: 'c1', roles: ['SUPPLIER'], customers: [], suppliers: [], tradeInsAsSeller: [], externalFinanceCompany: [] });
    await svc.findOne('c1');
    const include = prisma.contact.findFirst.mock.calls[0][0].include;
    expect(include.suppliers.select).toEqual(expect.objectContaining({
      id: true, name: true, type: true, taxId: true, branchCode: true,
      contactName: true, contactPhone: true, phone: true, hasVat: true, address: true,
    }));
    expect(include.customers.select).toEqual(expect.objectContaining({ id: true, name: true, prefix: true, phone: true }));
    expect(include.customers.select.addressCurrent).toBeUndefined();
    expect(include.customers.select.addressIdCard).toBeUndefined();
    expect(include.externalFinanceCompany.select).toEqual(expect.objectContaining({ id: true, name: true, taxId: true, contactPhone: true, email: true, creditTermDays: true }));
    expect(include.tradeInsAsSeller.select).toEqual(expect.objectContaining({ id: true, sellerName: true, sellerPhone: true, createdAt: true }));
  });
});

describe('ContactsService.merge', () => {
  let svc: ContactsService;
  let prisma: any;
  let audit: any;
  beforeEach(async () => {
    const tx = {
      contact: { findMany: jest.fn(), update: jest.fn() },
      customer: { updateMany: jest.fn() },
      supplier: { updateMany: jest.fn() },
      tradeIn: { updateMany: jest.fn() },
      externalFinanceCompany: { updateMany: jest.fn() },
    };
    prisma = { $transaction: jest.fn(async (cb: any) => cb(tx)), _tx: tx };
    audit = { log: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        ContactsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    svc = mod.get(ContactsService);
  });
  it('repoints role records to primary, unions roles, soft-deletes duplicate', async () => {
    prisma._tx.contact.findMany.mockResolvedValue([
      { id: 'p1', roles: ['CUSTOMER'], taxId: null, nationalIdHash: null, peakContactCode: null, phone: null, email: null },
      { id: 'd1', roles: ['SUPPLIER'], taxId: null, nationalIdHash: null, peakContactCode: null, phone: null, email: null },
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
  it('carries identity fields from duplicate to primary when primary lacks them + audits + soft-deletes duplicate FIRST', async () => {
    prisma._tx.contact.findMany.mockResolvedValue([
      { id: 'p1', roles: ['CUSTOMER'], taxId: null, nationalIdHash: null, peakContactCode: null, phone: null, email: null },
      { id: 'd1', roles: ['SUPPLIER'], taxId: '0105', nationalIdHash: 'h', peakContactCode: 'C001', phone: '02', email: 'a@b.c' },
    ]);
    await svc.merge({ primaryId: 'p1', duplicateId: 'd1' });
    // duplicate soft-deleted
    expect(prisma._tx.contact.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'd1' }, data: expect.objectContaining({ deletedAt: expect.any(Date) }) }));
    // primary updated with carried fields + union roles
    expect(prisma._tx.contact.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1' },
      data: expect.objectContaining({ taxId: '0105', nationalIdHash: 'h', peakContactCode: 'C001', phone: '02', email: 'a@b.c' }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CONTACTS_MERGED' }));
    // ordering: duplicate soft-delete recorded before primary carry update
    const calls = prisma._tx.contact.update.mock.calls;
    const dupIdx = calls.findIndex((c: any) => c[0].where.id === 'd1');
    const primIdx = calls.findIndex((c: any) => c[0].where.id === 'p1');
    expect(dupIdx).toBeGreaterThanOrEqual(0);
    expect(primIdx).toBeGreaterThanOrEqual(0);
    expect(dupIdx).toBeLessThan(primIdx);
  });
  it('does not overwrite identity fields already set on primary', async () => {
    prisma._tx.contact.findMany.mockResolvedValue([
      { id: 'p1', roles: [], taxId: '9999', nationalIdHash: null, peakContactCode: null, phone: '08', email: null },
      { id: 'd1', roles: [], taxId: '0105', nationalIdHash: null, peakContactCode: null, phone: '02', email: null },
    ]);
    await svc.merge({ primaryId: 'p1', duplicateId: 'd1' });
    const primaryCall = prisma._tx.contact.update.mock.calls.find((c: any) => c[0].where.id === 'p1');
    expect(primaryCall[0].data.taxId).toBe('9999');
    expect(primaryCall[0].data.phone).toBe('08');
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
