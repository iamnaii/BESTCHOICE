import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { StuckContractsService } from './stuck-contracts.service';

const mockPrisma = {
  $queryRawUnsafe: jest.fn(),
};

describe('StuckContractsService', () => {
  let service: StuckContractsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StuckContractsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(StuckContractsService);
  });

  it('returns empty array when no stuck contracts', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
    const result = await service.getStuckContracts({ days: 14 });
    expect(result).toEqual([]);
  });

  it('maps DB rows + computes daysIdle', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000);
    mockPrisma.$queryRawUnsafe.mockResolvedValue([
      {
        id: 'c1',
        contract_number: 'C-001',
        customer_name: 'นายเอ',
        customer_phone: '0812345678',
        branch_name: 'สาขา 1',
        assigned_to_id: 'u1',
        assigned_to_name: 'แนน',
        last_activity: tenDaysAgo,
        outstanding: '5500.00',
      },
    ]);
    const result = await service.getStuckContracts({ days: 7 });
    expect(result).toHaveLength(1);
    expect(result[0].contractId).toBe('c1');
    expect(result[0].daysIdle).toBeGreaterThanOrEqual(9);
    expect(result[0].daysIdle).toBeLessThanOrEqual(11);
    expect(result[0].outstanding).toBe(5500);
  });

  it('handles null assigned + null phone', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([
      {
        id: 'c2',
        contract_number: 'C-002',
        customer_name: 'นายบี',
        customer_phone: null,
        branch_name: 'สาขา 2',
        assigned_to_id: null,
        assigned_to_name: null,
        last_activity: null,
        outstanding: 0,
      },
    ]);
    const result = await service.getStuckContracts({ days: 14 });
    expect(result[0].customerPhone).toBeNull();
    expect(result[0].assignedToId).toBeNull();
    expect(result[0].outstanding).toBe(0);
  });

  it('clamps days to [1, 365]', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
    await service.getStuckContracts({ days: -5 });
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(expect.any(String), 1);
    await service.getStuckContracts({ days: 9999 });
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenLastCalledWith(expect.any(String), 365);
  });

  it('returns empty list on DB error (no throw)', async () => {
    mockPrisma.$queryRawUnsafe.mockRejectedValue(new Error('boom'));
    const result = await service.getStuckContracts({ days: 14 });
    expect(result).toEqual([]);
  });
});
