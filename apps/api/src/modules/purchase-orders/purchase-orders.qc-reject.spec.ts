import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PurchaseOrdersService.rejectQC', () => {
  let service: PurchaseOrdersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const buildTx = (products: { id: string; status: string; name: string }[]) => {
    const tx = {
      product: {
        findMany: jest.fn().mockResolvedValue(products),
        updateMany: jest.fn().mockResolvedValue({ count: products.length }),
      },
    };
    return tx;
  };

  const build = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return module.get<PurchaseOrdersService>(PurchaseOrdersService);
  };

  it('soft-deletes QC_PENDING products and returns the count', async () => {
    const tx = buildTx([
      { id: 'p1', status: 'QC_PENDING', name: 'iPhone' },
      { id: 'p2', status: 'PHOTO_PENDING', name: 'iPhone 2' },
    ]);
    prisma = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    service = await build();

    const res = await service.rejectQC(['p1', 'p2'], 'จอแตก');
    expect(res.rejected).toBe(2);
    expect(tx.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['p1', 'p2'] } },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it('rejects when no productIds are given', async () => {
    prisma = { $transaction: jest.fn() };
    service = await build();
    await expect(service.rejectQC([], 'x')).rejects.toThrow(BadRequestException);
  });

  it('rejects when a product is not in a QC stage', async () => {
    const tx = buildTx([{ id: 'p1', status: 'IN_STOCK', name: 'Sold-in' }]);
    prisma = { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) };
    service = await build();
    await expect(service.rejectQC(['p1'], 'late')).rejects.toThrow(BadRequestException);
  });
});
