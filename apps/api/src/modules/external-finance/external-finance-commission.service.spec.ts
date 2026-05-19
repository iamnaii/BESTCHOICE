import { ExternalFinanceCommissionService } from './external-finance-commission.service';
import { Prisma } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('ExternalFinanceCommissionService', () => {
  let prismaMock: any;
  let svc: ExternalFinanceCommissionService;

  beforeEach(() => {
    prismaMock = {
      externalFinanceCommission: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn((args: any) => Promise.resolve({ id: 'c1', ...args.data })),
        update: jest.fn((args: any) =>
          Promise.resolve({ id: args.where.id, ...args.data }),
        ),
      },
    };
    svc = new ExternalFinanceCommissionService(prismaMock);
  });

  it('accrue computes commissionAmount = financedAmount × rate', async () => {
    const result = await svc.accrue({
      externalFinanceCompanyId: 'gfin',
      financedAmount: 10000,
      commissionRate: 0.025,
    });
    expect(result.commissionAmount.toString()).toBe('250');
    expect(result.status).toBe('PENDING');
  });

  it('accrue rejects rate > 1', async () => {
    await expect(
      svc.accrue({
        externalFinanceCompanyId: 'gfin',
        financedAmount: 10000,
        commissionRate: 1.5,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accrue rejects negative rate', async () => {
    await expect(
      svc.accrue({
        externalFinanceCompanyId: 'gfin',
        financedAmount: 10000,
        commissionRate: -0.1,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('markReceived flips PENDING → RECEIVED', async () => {
    prismaMock.externalFinanceCommission.findFirst.mockResolvedValue({
      id: 'c1',
      status: 'PENDING',
    });
    const result = await svc.markReceived('c1', { bankSlipUrl: 'http://s3/slip.jpg' });
    expect(result.status).toBe('RECEIVED');
  });

  it('markReceived rejects when status not PENDING', async () => {
    prismaMock.externalFinanceCommission.findFirst.mockResolvedValue({
      id: 'c1',
      status: 'RECEIVED',
    });
    await expect(svc.markReceived('c1', {})).rejects.toThrow(BadRequestException);
  });

  it('markReceived NotFound when missing', async () => {
    prismaMock.externalFinanceCommission.findFirst.mockResolvedValue(null);
    await expect(svc.markReceived('c1', {})).rejects.toThrow(NotFoundException);
  });
});
