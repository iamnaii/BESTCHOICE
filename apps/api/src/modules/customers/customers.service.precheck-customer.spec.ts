import { Test, TestingModule } from '@nestjs/testing';
import { CustomersService } from './customers.service';
import { CustomerQueryService } from './services/customer-query.service';
import { CustomerWriteService } from './services/customer-write.service';
import { CustomerAnalyticsService } from './services/customer-analytics.service';
import { CustomerTierService } from './customer-tier.service';
import { ContactResolverService } from '../contacts/contact-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * findOrCreatePrecheckCustomer — the shared placeholder-customer helper that the
 * credit pre-check intake now uses. The bug it fixes: pre-check used to create a
 * Customer with ONLY plaintext nationalId (no nationalIdHash, no Contact), so
 * create() — which dedups on nationalIdHash + contactId — would later make a
 * SECOND duplicate identity for the same person. These tests pin that the helper
 * writes nationalIdHash + links a Contact (the keys that make create() dedup
 * find it), and revives/upgrades instead of duplicating.
 */
describe('CustomersService.findOrCreatePrecheckCustomer', () => {
  let service: CustomersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let contactResolver: { findOrCreateByNaturalKey: jest.Mock };

  beforeEach(async () => {
    process.env.PII_HASH_SALT = 'b'.repeat(32); // enables nationalIdHash computation
    prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null), // stub-upgrade check (inside tx)
        update: jest.fn((args: { where: { id: string }; data: object }) =>
          Promise.resolve({ id: args.where.id, ...args.data }),
        ),
        create: jest.fn((args: { data: object }) => Promise.resolve({ id: 'cust-new', ...args.data })),
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    contactResolver = {
      findOrCreateByNaturalKey: jest.fn().mockResolvedValue({ id: 'contact-1' }),
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        CustomerQueryService,
        CustomerWriteService,
        CustomerAnalyticsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomerTierService, useValue: { getCustomerTier: jest.fn() } },
        { provide: ContactResolverService, useValue: contactResolver },
      ],
    }).compile();
    service = mod.get(CustomersService);
  });

  afterEach(() => {
    delete process.env.PII_HASH_SALT;
  });

  it('returns an existing non-deleted customer (dedup by nationalIdHash) without creating a second row', async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: 'cust-existing', deletedAt: null });

    const res = await service.findOrCreatePrecheckCustomer({
      nationalId: '1234567890123',
      phone: '0812345678',
    });

    expect(res).toEqual({ id: 'cust-existing', isNew: false });
    // Looked up by the HASH column (not plaintext) — the same key create() uses.
    expect(prisma.customer.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ nationalIdHash: expect.any(String) }) }),
    );
    expect(prisma.customer.create).not.toHaveBeenCalled();
    expect(contactResolver.findOrCreateByNaturalKey).not.toHaveBeenCalled();
  });

  it('creates a new placeholder WITH nationalIdHash + a linked Contact (so create() can later dedup it)', async () => {
    prisma.customer.findUnique.mockResolvedValue(null);

    const res = await service.findOrCreatePrecheckCustomer({
      nationalId: '2222222222222',
      phone: '0898765432',
    });

    expect(res).toEqual({ id: 'cust-new', isNew: true });
    // Contact resolved with the nationalIdHash (party-master link).
    expect(contactResolver.findOrCreateByNaturalKey).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ nationalIdHash: expect.any(String), role: 'CUSTOMER' }),
    );
    // The created Customer carries the hash + the Contact connect — the two keys
    // create() dedups on. (Previously precheck wrote neither → duplicate.)
    const createArg = prisma.customer.create.mock.calls[0][0];
    expect(createArg.data.nationalIdHash).toEqual(expect.any(String));
    expect(createArg.data.contact).toEqual({ connect: { id: 'contact-1' } });
  });

  it('revives a soft-deleted ghost (same person) instead of creating a duplicate', async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: 'cust-ghost', deletedAt: new Date('2026-01-01') });

    const res = await service.findOrCreatePrecheckCustomer({
      nationalId: '3333333333333',
      phone: '0811111111',
    });

    expect(res).toEqual({ id: 'cust-ghost', isNew: false });
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cust-ghost' },
        data: expect.objectContaining({ deletedAt: null, nationalIdHash: expect.any(String) }),
      }),
    );
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it('upgrades an existing ensureRole stub on the same Contact instead of creating a second row', async () => {
    prisma.customer.findUnique.mockResolvedValue(null);
    prisma.customer.findFirst.mockResolvedValue({ id: 'stub-1' }); // stub on contact-1

    const res = await service.findOrCreatePrecheckCustomer({
      nationalId: '4444444444444',
      phone: '0820000000',
    });

    expect(res).toEqual({ id: 'stub-1', isNew: false });
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'stub-1' } }),
    );
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });
});
