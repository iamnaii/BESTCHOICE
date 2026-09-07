import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * คิว "รอถ่ายรูป" (2026-09-07): PHOTO_PENDING อย่างเดียว — ขั้น QC_PENDING ถูกยกเลิก
 * แต่ละแถวบอกที่มาจากความสัมพันธ์จริงของเครื่อง + จำนวนมุมที่ถ่ายแล้ว (ไม่โหลด base64)
 */
describe('PurchaseOrdersService.getQCPending — คิวรอถ่ายรูป', () => {
  let service: PurchaseOrdersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const row = (over: Record<string, unknown>) => ({
    id: 'p1',
    poId: null,
    status: 'PHOTO_PENDING',
    branch: null,
    supplier: null,
    po: null,
    repossession: null,
    tradeIns: [],
    ...over,
  });

  const build = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PurchaseOrdersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return module.get<PurchaseOrdersService>(PurchaseOrdersService);
  };

  beforeEach(() => {
    prisma = {
      product: {
        findMany: jest.fn().mockResolvedValue([row({})]),
        count: jest.fn().mockResolvedValue(1),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
  });

  it('คิวเป็น PHOTO_PENDING อย่างเดียว — flag includePhotoPending เดิมไม่มีผล', async () => {
    service = await build();
    await service.getQCPending({});
    await service.getQCPending({ includePhotoPending: true });
    for (const call of prisma.product.findMany.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ status: 'PHOTO_PENDING', deletedAt: null }));
      expect(call[0].include).toEqual(
        expect.objectContaining({ repossession: expect.anything(), tradeIns: expect.anything() }),
      );
    }
  });

  it('filters by poId and branchId when provided', async () => {
    service = await build();
    await service.getQCPending({ poId: 'po-9', branchId: 'b-1' });
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ poId: 'po-9', branchId: 'b-1', status: 'PHOTO_PENDING' }),
      }),
    );
  });

  it('ที่มาต่อแถว: ยึดเครื่องคืน > รับซื้อมือสอง > จาก PO > อื่น ๆ + เลขสัญญาของเครื่องยึด', async () => {
    prisma.product.findMany.mockResolvedValue([
      row({
        id: 'repo',
        poId: 'po-old',
        repossession: { id: 'r1', contract: { id: 'c1', contractNumber: 'CT-2026-08-0042' } },
      }),
      row({ id: 'trade', tradeIns: [{ id: 't1' }] }),
      row({ id: 'po', poId: 'po-1', po: { id: 'po-1', poNumber: 'PO-2026-09-010' } }),
      row({ id: 'other' }),
    ]);
    prisma.product.count.mockResolvedValue(4);
    service = await build();
    const res = await service.getQCPending({});
    expect(res.data.map((d) => [d.id, d.source])).toEqual([
      ['repo', 'REPOSSESSION'],
      ['trade', 'TRADE_IN'],
      ['po', 'PO'],
      ['other', 'OTHER'],
    ]);
    expect(res.data[0].repossession).toEqual({ id: 'r1', contractId: 'c1', contractNumber: 'CT-2026-08-0042' });
    expect(res.data[1].repossession).toBeNull();
    // ความสัมพันธ์ดิบ (tradeIns) ไม่หลุดออกไปหน้าจอ
    expect('tradeIns' in res.data[1]).toBe(false);
  });

  it('photoAngles มาจาก query นับมุมครั้งเดียวทั้งหน้า — เครื่องที่ไม่มีแถวรูป = 0', async () => {
    prisma.product.findMany.mockResolvedValue([row({ id: 'a' }), row({ id: 'b' })]);
    prisma.product.count.mockResolvedValue(2);
    prisma.$queryRaw.mockResolvedValue([{ product_id: 'a', count: BigInt(4) }]);
    service = await build();
    const res = await service.getQCPending({});
    expect(res.data.map((d) => [d.id, d.photoAngles])).toEqual([
      ['a', 4],
      ['b', 0],
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('คิวว่าง → ไม่ยิง query นับมุม', async () => {
    prisma.product.findMany.mockResolvedValue([]);
    prisma.product.count.mockResolvedValue(0);
    service = await build();
    const res = await service.getQCPending({});
    expect(res.data).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
