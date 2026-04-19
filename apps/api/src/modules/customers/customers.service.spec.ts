import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { PrismaService } from '../../prisma/prisma.service';

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
    prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn((args) => Promise.resolve({ id: 'cust-new', ...args.data })),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [CustomersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(CustomersService);
  });

  const baseDto = (nid: string) => ({
    name: 'John Doe',
    nationalId: nid,
    isForeigner: true, // skip Thai checksum for test convenience
    phone: '0812345678',
  }) as unknown as Parameters<CustomersService['create']>[0];

  it('normalizes NID with dashes before dedup check', async () => {
    await service.create(baseDto('1-1234-56789-00-1'));
    const findArgs = prisma.customer.findUnique.mock.calls[0][0];
    expect(findArgs.where.nationalId).toBe('1123456789001');
  });

  it('normalizes NID with spaces', async () => {
    await service.create(baseDto('1 1234 56789 00 1'));
    const findArgs = prisma.customer.findUnique.mock.calls[0][0];
    expect(findArgs.where.nationalId).toBe('1123456789001');
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

  it('ignores soft-deleted customer with same NID', async () => {
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-old',
      name: 'Deleted',
      deletedAt: new Date(),
    });
    // Should not throw — soft-deleted doesn't block new create
    await expect(service.create(baseDto('1123456789001'))).resolves.toBeDefined();
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
    prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn((args) => Promise.resolve({ id: 'cust-new', ...args.data })),
        update: jest.fn((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [CustomersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(CustomersService);
  });

  const baseDto = (overrides: Record<string, unknown> = {}) => ({
    name: 'Test',
    nationalId: '1123456789001',
    isForeigner: true, // skip checksum
    phone: '0812345678',
    ...overrides,
  }) as unknown as Parameters<CustomersService['create']>[0];

  it('normalizes phone (dashes, spaces, +66) and rejects dedup collision', async () => {
    // Existing customer has the normalized form "0812345678"
    prisma.customer.findFirst.mockImplementation(
      (args: { where: { phone?: string } }) => {
        if (args.where?.phone === '0812345678') {
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
