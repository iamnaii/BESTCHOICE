import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomerTierService } from './customer-tier.service';
import { ContactResolverService } from '../contacts/contact-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptPII } from '../../utils/crypto.util';

/**
 * T3-C8: NID dedup — the @unique constraint on nationalId only catches byte-
 * identical strings. Users can defeat it with space/dash variations unless
 * we normalize before both the lookup and the write.
 */
describe('CustomersService.create — NID normalization', () => {
  let service: CustomersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    // Phase 5: PII_HASH_SALT required because create() now calls hashPII for NID dedup
    process.env.PII_HASH_SALT = 'b'.repeat(32);
    prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn((args) => Promise.resolve({ id: 'cust-new', ...args.data })),
        update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
      // create() now always runs inside a transaction; invoke the callback
      // with the same prisma mock so customer.create/update assertions hold.
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomerTierService, useValue: { getCustomerTier: jest.fn() } },
        {
          provide: ContactResolverService,
          useValue: { findOrCreateByNaturalKey: jest.fn().mockResolvedValue({ id: 'contact-test-id' }) },
        },
      ],
    }).compile();
    service = mod.get(CustomersService);
  });

  afterEach(() => {
    delete process.env.PII_HASH_SALT;
  });

  const baseDto = (nid: string) => ({
    name: 'John Doe',
    nationalId: nid,
    isForeigner: true, // skip Thai checksum for test convenience
    phone: '0812345678',
  }) as unknown as Parameters<CustomersService['create']>[0];

  it('normalizes NID with dashes before dedup check (Phase 5: uses nationalIdHash)', async () => {
    await service.create(baseDto('1-1234-56789-00-1'));
    const findArgs = prisma.customer.findUnique.mock.calls[0][0];
    // Phase 5: dedup now uses nationalIdHash, not plaintext nationalId
    expect(findArgs.where.nationalIdHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalizes NID with spaces (Phase 5: uses nationalIdHash)', async () => {
    await service.create(baseDto('1 1234 56789 00 1'));
    const findArgs = prisma.customer.findUnique.mock.calls[0][0];
    // Phase 5: dedup now uses nationalIdHash, not plaintext nationalId
    expect(findArgs.where.nationalIdHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uppercases letters (passport-style IDs)', async () => {
    await service.create(baseDto('ab1234567'));
    const createArgs = prisma.customer.create.mock.calls[0][0];
    expect(createArgs.data.nationalId).toBe('AB1234567');
  });

  it('rejects duplicate NID after normalization', async () => {
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-existing',
      name: 'Existing',
      deletedAt: null,
    });

    await expect(service.create(baseDto('1-1234-56789-00-1'))).rejects.toThrow(
      ConflictException,
    );
  });

  it('writes normalized NID to DB (strips dashes)', async () => {
    await service.create(baseDto('1-1234-56789-00-1'));
    const createArgs = prisma.customer.create.mock.calls[0][0];
    expect(createArgs.data.nationalId).toBe('1123456789001');
  });

  it('revives soft-deleted customer with same NID instead of P2002', async () => {
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-old',
      name: 'Deleted',
      deletedAt: new Date(),
    });

    await service.create(baseDto('1123456789001'));

    // Must NOT call create() — nationalId is @unique, create would throw P2002
    expect(prisma.customer.create).not.toHaveBeenCalled();
    // Must update the ghost row with deletedAt: null and the new form data
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cust-old' },
        data: expect.objectContaining({ deletedAt: null }),
      }),
    );
  });
});

/**
 * T3-C9: phone + email dedup at application level (no DB @unique because
 * legacy rows have duplicates we cannot auto-resolve). Normalization
 * strips dashes/spaces and optional +66 prefix from phones; lowercases
 * and trims emails.
 */
describe('CustomersService.create — T3-C9 phone + email dedup', () => {
  let service: CustomersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    // Phase 5: PII_HASH_SALT required because assertContactNotDuplicate now calls hashPII
    process.env.PII_HASH_SALT = 'b'.repeat(32);
    prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn((args) => Promise.resolve({ id: 'cust-new', ...args.data })),
        update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomerTierService, useValue: { getCustomerTier: jest.fn() } },
        {
          provide: ContactResolverService,
          useValue: { findOrCreateByNaturalKey: jest.fn().mockResolvedValue({ id: 'contact-test-id' }) },
        },
      ],
    }).compile();
    service = mod.get(CustomersService);
  });

  afterEach(() => {
    delete process.env.PII_HASH_SALT;
  });

  const baseDto = (overrides: Record<string, unknown> = {}) => ({
    name: 'Test',
    nationalId: '1123456789001',
    isForeigner: true, // skip checksum
    phone: '0812345678',
    ...overrides,
  }) as unknown as Parameters<CustomersService['create']>[0];

  it('normalizes phone (dashes, spaces, +66) and rejects dedup collision (Phase 5: uses phoneHash)', async () => {
    // Phase 5: assertContactNotDuplicate now queries by phoneHash, not plaintext phone.
    // We simulate a collision by always returning an existing customer for any phoneHash lookup.
    prisma.customer.findFirst.mockImplementation(
      (args: { where: { phoneHash?: string } }) => {
        if (args.where?.phoneHash) {
          return Promise.resolve({ id: 'cust-existing', name: 'Previous' });
        }
        return Promise.resolve(null);
      },
    );

    // DTO uses dashed format — should still collide after normalization.
    await expect(
      service.create(baseDto({ phone: '081-234-5678' })),
    ).rejects.toThrow(ConflictException);

    // +66 prefix also normalizes to the same 10-digit 0-prefixed form.
    await expect(
      service.create(baseDto({ phone: '+66812345678' })),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects duplicate email case-insensitively and writes lowercased form', async () => {
    // Collision on email (case-insensitive)
    prisma.customer.findFirst.mockImplementation(
      (args: { where: { email?: unknown } }) => {
        if (
          args.where?.email &&
          typeof args.where.email === 'object' &&
          (args.where.email as { equals?: string }).equals === 'foo@example.com'
        ) {
          return Promise.resolve({ id: 'cust-existing', name: 'Prev' });
        }
        return Promise.resolve(null);
      },
    );

    await expect(
      service.create(baseDto({ email: '  FOO@Example.COM  ' })),
    ).rejects.toThrow(ConflictException);

    // No collision case — email must be written lowercased + trimmed
    prisma.customer.findFirst.mockResolvedValue(null);
    await service.create(baseDto({ email: '  Bar@Example.COM ' }));
    const createArgs = prisma.customer.create.mock.calls[0][0];
    expect(createArgs.data.email).toBe('bar@example.com');
  });
});

describe('PII dual-write (Phase 3)', () => {
  let service: CustomersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'c1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomerTierService, useValue: { getCustomerTier: jest.fn() } },
        {
          provide: ContactResolverService,
          useValue: { findOrCreateByNaturalKey: jest.fn().mockResolvedValue({ id: 'contact-test-id' }) },
        },
      ],
    }).compile();
    service = mod.get(CustomersService);

    process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.PII_HASH_SALT = 'b'.repeat(32);
  });

  afterEach(() => {
    delete process.env.PII_ENCRYPTION_KEY;
    delete process.env.PII_HASH_SALT;
  });

  it('writes encrypted + hash columns alongside legacy columns on create', async () => {
    const dto = {
      nationalId: '1234567890123',
      phone: '0812345678',
      email: 'test@example.com',
      name: 'Test',
      isForeigner: true, // skip Thai NID checksum
    } as unknown as Parameters<CustomersService['create']>[0];

    await service.create(dto);

    const call = (prisma.customer.create as jest.Mock).mock.calls[0][0];
    // Legacy columns still populated
    expect(call.data.nationalId).toBe('1234567890123');
    expect(call.data.phone).toMatch(/^08\d{8}$/);
    // Encrypted columns populated (GCM iv:tag:cipher format — C1)
    expect(call.data.nationalIdEncrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(call.data.phoneEncrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(call.data.emailEncrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    // Hash columns populated (sha256 = 64 hex chars)
    expect(call.data.nationalIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(call.data.phoneHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('only encrypts fields present in update dto', async () => {
    (prisma.customer.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', deletedAt: null });

    await service.update('c1', { name: 'NewName' } as unknown as Parameters<CustomersService['update']>[1]);

    const call = (prisma.customer.update as jest.Mock).mock.calls[0][0];
    expect(call.data.phoneEncrypted).toBeUndefined();
    expect(call.data.emailEncrypted).toBeUndefined();
  });

  it('encrypts new phone on update', async () => {
    (prisma.customer.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', deletedAt: null });

    await service.update('c1', { phone: '0899999999' } as unknown as Parameters<CustomersService['update']>[1]);

    const call = (prisma.customer.update as jest.Mock).mock.calls[0][0];
    expect(call.data.phone).toMatch(/^08\d{8}$/);
    expect(call.data.phoneEncrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(call.data.phoneHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('PII read decryption (Phase 5)', () => {
  let service: CustomersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.PII_HASH_SALT = 'b'.repeat(32);
    prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'c1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomerTierService, useValue: { getCustomerTier: jest.fn() } },
        {
          provide: ContactResolverService,
          useValue: { findOrCreateByNaturalKey: jest.fn().mockResolvedValue({ id: 'contact-test-id' }) },
        },
      ],
    }).compile();
    service = mod.get(CustomersService);
  });

  afterEach(() => {
    delete process.env.PII_ENCRYPTION_KEY;
    delete process.env.PII_HASH_SALT;
  });

  it('decrypts PII columns when returning single customer', async () => {
    const key = 'a'.repeat(64);
    (prisma.customer.findUnique as jest.Mock).mockResolvedValue({
      id: 'c1',
      nationalId: 'legacy-1234567890123',
      nationalIdEncrypted: encryptPII('1234567890123', key),
      phone: 'legacy-0812345678',
      phoneEncrypted: encryptPII('0812345678', key),
      name: 'Test',
      deletedAt: null,
    });
    const result = await service.findOne('c1');
    expect((result as unknown as Record<string, unknown>)['nationalId']).toBe('1234567890123');
    expect((result as unknown as Record<string, unknown>)['phone']).toBe('0812345678');
  });

  it('falls back to legacy field when encrypted is NULL (pre-backfill row)', async () => {
    (prisma.customer.findUnique as jest.Mock).mockResolvedValue({
      id: 'c2',
      nationalId: '1234567890124',
      nationalIdEncrypted: null,
      phone: '0899999999',
      phoneEncrypted: null,
      name: 'Legacy',
      deletedAt: null,
    });
    const result = await service.findOne('c2');
    expect((result as unknown as Record<string, unknown>)['nationalId']).toBe('1234567890124');
    expect((result as unknown as Record<string, unknown>)['phone']).toBe('0899999999');
  });

  it('uses nationalIdHash for dedup query in create', async () => {
    (prisma.customer.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.customer.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.customer.create as jest.Mock).mockResolvedValue({ id: 'c1' });

    await service.create({
      nationalId: '1234567890123',
      phone: '0812345678',
      name: 'Test',
      isForeigner: true,
    } as unknown as Parameters<CustomersService['create']>[0]);

    // Verify the dedup query used nationalIdHash, not plaintext
    const findUniqueCalls = (prisma.customer.findUnique as jest.Mock).mock.calls;
    const dedupCall = findUniqueCalls.find(
      (c: unknown[]) => (c[0] as { where?: { nationalIdHash?: string } })?.where?.nationalIdHash,
    );
    expect(dedupCall).toBeDefined();
    expect(
      (dedupCall![0] as { where: { nationalIdHash: string } }).where.nationalIdHash,
    ).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('CustomersService.remove — block if open contracts', () => {
  let service: CustomersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    process.env.PII_HASH_SALT = 'b'.repeat(32);
    prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', deletedAt: null, references: null }),
        update: jest.fn((args) => Promise.resolve({ id: 'c1', ...args.data })),
      },
      contract: { count: jest.fn() },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomerTierService, useValue: { getCustomerTier: jest.fn() } },
        {
          provide: ContactResolverService,
          useValue: { findOrCreateByNaturalKey: jest.fn().mockResolvedValue({ id: 'contact-test-id' }) },
        },
      ],
    }).compile();
    service = mod.get(CustomersService);
  });

  afterEach(() => {
    delete process.env.PII_HASH_SALT;
  });

  it('soft-deletes customer with no open contracts', async () => {
    prisma.contract.count.mockResolvedValue(0);
    await service.remove('c1');
    const countArgs = prisma.contract.count.mock.calls[0][0];
    expect(countArgs.where.customerId).toBe('c1');
    expect(countArgs.where.status.in).toEqual(['ACTIVE', 'OVERDUE', 'DEFAULT']);
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('throws BadRequestException if customer has open contracts', async () => {
    prisma.contract.count.mockResolvedValue(2);
    await expect(service.remove('c1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });
});

/**
 * Task 10: unified contact party-master. On customer create, a Contact row
 * (role=CUSTOMER) is resolved/created in the SAME transaction and linked via
 * Customer.contactId. The Contact stores PLAINTEXT phone/name (lightweight
 * directory), keyed by nationalIdHash.
 */
describe('CustomersService.create — links Contact (party master)', () => {
  let service: CustomersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let contactResolver: { findOrCreateByNaturalKey: jest.Mock };

  beforeEach(async () => {
    process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.PII_HASH_SALT = 'b'.repeat(32);

    // tx client passed into the $transaction callback. It exposes the same
    // customer ops the service uses; create/update echo their data back.
    const tx = {
      customer: {
        // P4: stub-upgrade guard calls findFirst inside the tx; return null (no stub)
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn((args) => Promise.resolve({ id: 'cust-new', ...args.data })),
        update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
    };
    prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn((args) => Promise.resolve({ id: 'cust-new', ...args.data })),
        update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
      // Interactive transaction: invoke callback with the tx client.
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => Promise.resolve(cb(tx))),
      _tx: tx,
    };
    contactResolver = {
      findOrCreateByNaturalKey: jest.fn().mockResolvedValue({ id: 'contact-1' }),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomerTierService, useValue: { getCustomerTier: jest.fn() } },
        { provide: ContactResolverService, useValue: contactResolver },
      ],
    }).compile();
    service = mod.get(CustomersService);
  });

  afterEach(() => {
    delete process.env.PII_ENCRYPTION_KEY;
    delete process.env.PII_HASH_SALT;
  });

  const baseDto = (overrides: Record<string, unknown> = {}) => ({
    name: 'Party Person',
    nationalId: '1234567890123',
    isForeigner: true, // skip checksum
    phone: '0812345678',
    ...overrides,
  }) as unknown as Parameters<CustomersService['create']>[0];

  it('resolves a Contact with role CUSTOMER + name and links contactId on create', async () => {
    const result = await service.create(baseDto());

    expect(contactResolver.findOrCreateByNaturalKey).toHaveBeenCalledTimes(1);
    const [txArg, input] = contactResolver.findOrCreateByNaturalKey.mock.calls[0];
    // Resolved inside the same transaction
    expect(txArg).toBe(prisma._tx);
    expect(input.role).toBe('CUSTOMER');
    expect(input.name).toBe('Party Person');
    // nationalIdHash reused (sha256 hex), plaintext phone passed (not encrypted)
    expect(input.nationalIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(input.phone).toBe('0812345678');

    // Created customer is linked to the resolved contact (via relation connect)
    const createArgs = prisma._tx.customer.create.mock.calls[0][0];
    expect(createArgs.data.contact).toEqual({ connect: { id: 'contact-1' } });
    // Mock echoes data back, so the relation connect is observable on the result
    expect((result as Record<string, unknown>).contact).toEqual({ connect: { id: 'contact-1' } });
  });

  it('still links a (keyless) Contact when nationalId is absent (walk-in)', async () => {
    await service.create(baseDto({ nationalId: undefined }));
    expect(contactResolver.findOrCreateByNaturalKey).toHaveBeenCalledTimes(1);
    const [, input] = contactResolver.findOrCreateByNaturalKey.mock.calls[0];
    expect(input.role).toBe('CUSTOMER');
    expect(input.nationalIdHash ?? null).toBeNull();
  });
});

/**
 * P4 Cleanup 2 — stub-upgrade guard.
 * When ensureRole creates a lightweight Customer stub (phone:'', no hashes),
 * a subsequent /customers create for the same person must UPGRADE the stub
 * (update in place) rather than create a second Customer row on the same
 * contactId. The upgrade must populate full PII-encrypted fields.
 */
describe('CustomersService.create — stub-upgrade guard (P4)', () => {
  let service: CustomersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    process.env.PII_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.PII_HASH_SALT = 'b'.repeat(32);

    const tx = {
      customer: {
        // findFirst returns null by default (no stub) — individual tests override.
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn((args) => Promise.resolve({ id: 'cust-new', ...args.data })),
        update: jest.fn((args) => Promise.resolve({ id: args.where?.id ?? 'stub-id', ...args.data })),
      },
    };
    prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn((args) => Promise.resolve({ id: 'cust-new', ...args.data })),
        update: jest.fn((args) => Promise.resolve({ id: args.where?.id, ...args.data })),
      },
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => Promise.resolve(cb(tx))),
      _tx: tx,
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prisma },
        { provide: CustomerTierService, useValue: { getCustomerTier: jest.fn() } },
        {
          provide: ContactResolverService,
          useValue: { findOrCreateByNaturalKey: jest.fn().mockResolvedValue({ id: 'contact-stub' }) },
        },
      ],
    }).compile();
    service = mod.get(CustomersService);
  });

  afterEach(() => {
    delete process.env.PII_ENCRYPTION_KEY;
    delete process.env.PII_HASH_SALT;
  });

  const baseDto = (overrides: Record<string, unknown> = {}) => ({
    name: 'Stub Person',
    nationalId: '1234567890123',
    isForeigner: true, // skip checksum
    phone: '0812345678',
    ...overrides,
  }) as unknown as Parameters<CustomersService['create']>[0];

  it('creates a new Customer row when no stub exists for the resolved contactId', async () => {
    // tx.customer.findFirst returns null → no stub
    await service.create(baseDto());

    expect(prisma._tx.customer.create).toHaveBeenCalledTimes(1);
    expect(prisma._tx.customer.update).not.toHaveBeenCalled();
    const createArgs = prisma._tx.customer.create.mock.calls[0][0];
    expect(createArgs.data.contact).toEqual({ connect: { id: 'contact-stub' } });
  });

  it('upgrades the stub (update in place) when a Customer row already exists for that contactId', async () => {
    // Simulate a pre-existing stub created by ensureRole
    prisma._tx.customer.findFirst.mockResolvedValue({ id: 'stub-existing-id' });

    await service.create(baseDto());

    // Must update the stub, not create a second row
    expect(prisma._tx.customer.create).not.toHaveBeenCalled();
    expect(prisma._tx.customer.update).toHaveBeenCalledTimes(1);
    const updateArgs = prisma._tx.customer.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'stub-existing-id' });
    // Full contact link is applied on the upgrade
    expect(updateArgs.data.contact).toEqual({ connect: { id: 'contact-stub' } });
  });

  it('populates PII-encrypted fields on the stub upgrade path', async () => {
    prisma._tx.customer.findFirst.mockResolvedValue({ id: 'stub-existing-id' });

    await service.create(baseDto());

    const updateArgs = prisma._tx.customer.update.mock.calls[0][0];
    // Encrypted columns must be written — format: iv:tag:cipher hex
    expect(updateArgs.data.phoneEncrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(updateArgs.data.nationalIdEncrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    // Hash columns must be written — sha256 = 64 hex chars
    expect(updateArgs.data.phoneHash).toMatch(/^[0-9a-f]{64}$/);
    expect(updateArgs.data.nationalIdHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stub lookup uses contactId + deletedAt:null filter', async () => {
    await service.create(baseDto());

    const findFirstCalls = prisma._tx.customer.findFirst.mock.calls;
    expect(findFirstCalls.length).toBeGreaterThanOrEqual(1);
    const stubLookup = findFirstCalls.find(
      (c: unknown[]) =>
        (c[0] as { where?: { contactId?: string } })?.where?.contactId === 'contact-stub',
    );
    expect(stubLookup).toBeDefined();
    expect(
      (stubLookup![0] as { where: { deletedAt: null } }).where.deletedAt,
    ).toBeNull();
  });
});
