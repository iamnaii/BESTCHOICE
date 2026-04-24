import { Test } from '@nestjs/testing';
import { SearchService } from './search.service';
import { PrismaService } from '../../prisma/prisma.service';

function mockPrisma() {
  return {
    contract: { findMany: jest.fn().mockResolvedValue([]) },
    customer: { findMany: jest.fn().mockResolvedValue([]) },
    contractLetter: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
}

describe('SearchService', () => {
  let service: SearchService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: PrismaService, useValue: mockPrisma() },
      ],
    }).compile();
    service = module.get(SearchService);
    prisma = module.get(PrismaService);
  });

  it('normalizes phone queries (strips non-digits, preserves +66)', () => {
    expect(service.normalizePhone('082-123-4567')).toBe('0821234567');
    expect(service.normalizePhone('+66 82 123 4567')).toBe('+66821234567');
    expect(service.normalizePhone('  (082) 123-4567  ')).toBe('0821234567');
  });

  it('returns empty groups when query shorter than 2 chars', async () => {
    const result = await service.unionSearch({
      q: 'a',
      userId: 'u1',
      userRole: 'OWNER',
    });
    expect(result).toEqual({
      contracts: [],
      customers: [],
      imeis: [],
      letterTrackings: [],
    });
    expect(prisma.contract.findMany).not.toHaveBeenCalled();
  });

  it('returns grouped results (contracts, customers, IMEIs, tracking)', async () => {
    jest.spyOn(prisma.contract, 'findMany').mockResolvedValue([
      {
        id: 'c1',
        contractNumber: 'CT001',
        status: 'ACTIVE',
        customer: { name: 'นายทดสอบ' },
      } as any,
    ]);
    jest.spyOn(prisma.customer, 'findMany').mockResolvedValue([
      {
        id: 'cu1',
        name: 'นายทดสอบ',
        phone: '0821234567',
      } as any,
    ]);
    jest.spyOn(prisma.contractLetter, 'findMany').mockResolvedValue([
      {
        id: 'l1',
        trackingNumber: 'TH123',
        contractId: 'c1',
        contract: { contractNumber: 'CT001' },
      } as any,
    ]);
    jest.spyOn(prisma.product, 'findMany').mockResolvedValue([
      {
        imeiSerial: '356938035643809',
        contracts: [
          {
            id: 'c1',
            contractNumber: 'CT001',
            customer: { name: 'นายทดสอบ' },
          },
        ],
      } as any,
    ]);

    const result = await service.unionSearch({
      q: 'ทดสอบ',
      userId: 'u1',
      userRole: 'OWNER',
    });

    expect(result.contracts).toHaveLength(1);
    expect(result.contracts[0]).toMatchObject({
      id: 'c1',
      contractNumber: 'CT001',
      customerName: 'นายทดสอบ',
      status: 'ACTIVE',
    });
    expect(result.customers).toHaveLength(1);
    expect(result.letterTrackings).toHaveLength(1);
    expect(result.letterTrackings[0].trackingNumber).toBe('TH123');
    expect(result.imeis).toHaveLength(1);
    expect(result.imeis[0]).toMatchObject({
      contractId: 'c1',
      imei: '356938035643809',
      contractNumber: 'CT001',
    });
  });

  it('respects branch scope for SALES on contracts', async () => {
    jest.spyOn(prisma.contract, 'findMany').mockResolvedValue([]);
    await service.unionSearch({
      q: 'anything',
      userId: 'u1',
      userRole: 'SALES',
      branchId: 'br1',
    });

    expect(prisma.contract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ branchId: 'br1' }),
      }),
    );
  });

  it('does NOT branch-scope customers (customers are global)', async () => {
    jest.spyOn(prisma.customer, 'findMany').mockResolvedValue([]);
    await service.unionSearch({
      q: 'anything',
      userId: 'u1',
      userRole: 'SALES',
      branchId: 'br1',
    });

    const call = (prisma.customer.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where).not.toHaveProperty('branchId');
  });

  it('scopes letters by contract.branchId when SALES', async () => {
    jest.spyOn(prisma.contractLetter, 'findMany').mockResolvedValue([]);
    await service.unionSearch({
      q: 'TH99',
      userId: 'u1',
      userRole: 'SALES',
      branchId: 'br1',
    });

    expect(prisma.contractLetter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contract: { branchId: 'br1' },
        }),
      }),
    );
  });

  it('OWNER role not branch-scoped', async () => {
    jest.spyOn(prisma.contract, 'findMany').mockResolvedValue([]);
    await service.unionSearch({
      q: 'anything',
      userId: 'u1',
      userRole: 'OWNER',
      branchId: 'br1',
    });

    const call = (prisma.contract.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where).not.toHaveProperty('branchId');
  });
});
