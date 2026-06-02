import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContactResolverService } from '../contact-resolver.service';

describe('ContactResolverService.nextContactCode', () => {
  let svc: ContactResolverService;
  let prisma: { $executeRawUnsafe: jest.Mock; contact: { findFirst: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      contact: { findFirst: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [
        ContactResolverService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = mod.get(ContactResolverService);
  });

  it('starts at P-00001 when no contacts exist', async () => {
    prisma.contact.findFirst.mockResolvedValue(null);
    const code = await svc.nextContactCode(prisma as any);
    expect(code).toBe('P-00001');
    expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
  });

  it('increments from the last code', async () => {
    prisma.contact.findFirst.mockResolvedValue({ contactCode: 'P-00042' });
    const code = await svc.nextContactCode(prisma as any);
    expect(code).toBe('P-00043');
  });
});

describe('ContactResolverService.findOrCreateByNaturalKey', () => {
  let svc: ContactResolverService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      contact: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    const mod = await Test.createTestingModule({
      providers: [ContactResolverService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    svc = mod.get(ContactResolverService);
  });

  it('creates a new Contact when no natural-key match', async () => {
    prisma.contact.findFirst
      .mockResolvedValueOnce(null) // natural-key lookup
      .mockResolvedValueOnce(null); // nextContactCode lookup
    prisma.contact.create.mockResolvedValue({ id: 'c1', roles: ['CUSTOMER'] });
    const res = await svc.findOrCreateByNaturalKey(prisma, {
      name: 'สมชาย', taxId: null, nationalIdHash: 'h1', role: 'CUSTOMER',
    });
    expect(prisma.contact.create).toHaveBeenCalled();
    expect(res.id).toBe('c1');
  });

  it('adds the role to an existing Contact matched by nationalIdHash', async () => {
    prisma.contact.findFirst.mockResolvedValueOnce({ id: 'c1', roles: ['CUSTOMER'] });
    prisma.contact.update.mockResolvedValue({ id: 'c1', roles: ['CUSTOMER', 'TRADE_IN_SELLER'] });
    const res = await svc.findOrCreateByNaturalKey(prisma, {
      name: 'สมชาย', taxId: null, nationalIdHash: 'h1', role: 'TRADE_IN_SELLER',
    });
    expect(prisma.contact.create).not.toHaveBeenCalled();
    expect(prisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' } }),
    );
    expect(res.roles).toContain('TRADE_IN_SELLER');
  });

  it('does NOT duplicate a role already present', async () => {
    prisma.contact.findFirst.mockResolvedValueOnce({ id: 'c1', roles: ['CUSTOMER'] });
    const res = await svc.findOrCreateByNaturalKey(prisma, {
      name: 'สมชาย', taxId: null, nationalIdHash: 'h1', role: 'CUSTOMER',
    });
    expect(prisma.contact.update).not.toHaveBeenCalled();
    expect(res.id).toBe('c1');
  });

  it('matches an existing Contact by taxId (first-priority key) and appends role', async () => {
    prisma.contact.findFirst.mockResolvedValueOnce({ id: 'cx', roles: ['CUSTOMER'] });
    prisma.contact.update.mockResolvedValue({ id: 'cx', roles: ['CUSTOMER', 'SUPPLIER'] });
    const res = await svc.findOrCreateByNaturalKey(prisma, {
      name: 'บ.แอปเปิล', taxId: '0105500000010', nationalIdHash: null, role: 'SUPPLIER',
    });
    expect(prisma.contact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: expect.arrayContaining([{ taxId: '0105500000010' }]) }),
      }),
    );
    expect(prisma.contact.create).not.toHaveBeenCalled();
    expect(res.roles).toContain('SUPPLIER');
  });

  it('creates a new Contact (no merge) when no natural key is available', async () => {
    prisma.contact.findFirst.mockResolvedValueOnce(null); // nextContactCode only
    prisma.contact.create.mockResolvedValue({ id: 'c2', roles: ['TRADE_IN_SELLER'] });
    const res = await svc.findOrCreateByNaturalKey(prisma, {
      name: 'คนเดินเข้า', taxId: null, nationalIdHash: null, role: 'TRADE_IN_SELLER',
    });
    expect(prisma.contact.create).toHaveBeenCalled();
    expect(res.id).toBe('c2');
  });

  it('translates a P2002 on create into a ConflictException (no in-tx re-query)', async () => {
    prisma.contact.findFirst
      .mockResolvedValueOnce(null) // initial natural-key lookup → no match
      .mockResolvedValueOnce({ contactCode: 'P-00001' }); // nextContactCode lookup
    const err: any = new Error('unique'); err.code = 'P2002';
    prisma.contact.create.mockRejectedValue(err);
    await expect(
      svc.findOrCreateByNaturalKey(prisma, { name: 'X', taxId: '0105', nationalIdHash: null, role: 'SUPPLIER' }),
    ).rejects.toThrow('ผู้ติดต่อนี้ถูกสร้างพร้อมกัน');
    expect(prisma.contact.findFirst).toHaveBeenCalledTimes(2); // no third (no in-tx re-query)
  });
});
