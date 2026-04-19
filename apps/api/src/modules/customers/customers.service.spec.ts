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
