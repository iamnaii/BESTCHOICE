import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('PurchaseOrdersService.getQCPending — additive filters', () => {
  let service: PurchaseOrdersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const build = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return module.get<PurchaseOrdersService>(PurchaseOrdersService);
  };

  beforeEach(() => {
    prisma = {
      product: {
        findMany: jest.fn().mockResolvedValue([{ id: 'p1' }]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
  });

  it('defaults to QC_PENDING only (back-compat — no flag passed)', async () => {
    service = await build();
    await service.getQCPending({});
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'QC_PENDING', deletedAt: null }),
      }),
    );
  });

  it('includes PHOTO_PENDING when includePhotoPending is true', async () => {
    service = await build();
    await service.getQCPending({ includePhotoPending: true });
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['QC_PENDING', 'PHOTO_PENDING'] } }),
      }),
    );
  });

  it('filters by poId and branchId when provided', async () => {
    service = await build();
    await service.getQCPending({ poId: 'po-9', branchId: 'b-1' });
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ poId: 'po-9', branchId: 'b-1', status: 'QC_PENDING' }),
      }),
    );
  });
});
