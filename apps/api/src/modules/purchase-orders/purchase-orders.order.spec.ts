import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PurchaseOrdersService.order — APPROVED → ORDERED', () => {
  let service: PurchaseOrdersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const makePrisma = (status: string) => ({
    purchaseOrder: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'po-1', status, deletedAt: null, items: [], supplier: { id: 's1', name: 'S' },
      }),
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: 'po-1', status: data.status, orderedAt: data.orderedAt })),
    },
  });

  const build = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return module.get<PurchaseOrdersService>(PurchaseOrdersService);
  };

  it('advances an APPROVED PO to ORDERED and stamps orderedAt', async () => {
    prisma = makePrisma('APPROVED');
    service = await build();
    const result = await service.order('po-1', 'user-1', {});
    expect(result.status).toBe('ORDERED');
    expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'po-1' },
        data: expect.objectContaining({ status: 'ORDERED', orderedAt: expect.any(Date) }),
      }),
    );
  });

  it('rejects ordering a PO that is not APPROVED', async () => {
    prisma = makePrisma('DRAFT');
    service = await build();
    await expect(service.order('po-1', 'user-1', {})).rejects.toThrow(BadRequestException);
  });

  it('updates expectedDate when provided', async () => {
    prisma = makePrisma('APPROVED');
    service = await build();
    await service.order('po-1', 'user-1', { expectedDate: '2026-07-15' });
    expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ expectedDate: new Date('2026-07-15') }) }),
    );
  });
});
