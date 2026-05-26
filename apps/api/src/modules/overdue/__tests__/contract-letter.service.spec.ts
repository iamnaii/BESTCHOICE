import { Test } from '@nestjs/testing';
import { ContractLetterService } from '../contract-letter.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { DunningEngineService } from '../dunning-engine.service';

describe('ContractLetterService.list (v2)', () => {
  let service: ContractLetterService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ContractLetterService,
        {
          provide: PrismaService,
          useValue: {
            contractLetter: {
              findMany: jest.fn().mockResolvedValue([]),
              count: jest.fn().mockResolvedValue(0),
            },
          },
        },
        {
          provide: DunningEngineService,
          useValue: { executeEventTrigger: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(ContractLetterService);
    prisma = module.get(PrismaService);
  });

  it('returns paginated shape { data, total, page, limit }', async () => {
    const result = await service.list({ page: 1, limit: 50, user: { role: 'OWNER', branchId: null } });
    expect(result).toEqual({ data: [], total: 0, page: 1, limit: 50 });
  });

  it('applies branch scope for SALES role', async () => {
    await service.list({ page: 1, limit: 50, user: { role: 'SALES', branchId: 'branch-1' } });
    const findManyCall = (prisma.contractLetter.findMany as jest.Mock).mock.calls[0][0];
    expect(findManyCall.where.contract.branchId).toBe('branch-1');
  });

  it('builds OR search clause for q param', async () => {
    await service.list({ page: 1, limit: 50, q: 'สมชาย', user: { role: 'OWNER', branchId: null } });
    const findManyCall = (prisma.contractLetter.findMany as jest.Mock).mock.calls[0][0];
    expect(findManyCall.where.OR).toHaveLength(3);
    expect(findManyCall.where.OR[0]).toEqual({ letterNumber: { contains: 'สมชาย', mode: 'insensitive' } });
  });

  it('returns empty when SALES has no branchId', async () => {
    const result = await service.list({ page: 1, limit: 50, user: { role: 'SALES', branchId: null } });
    expect(result).toEqual({ data: [], total: 0, page: 1, limit: 50 });
    expect(prisma.contractLetter.findMany).not.toHaveBeenCalled();
  });
});
