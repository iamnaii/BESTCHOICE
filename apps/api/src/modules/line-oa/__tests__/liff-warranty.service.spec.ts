import { Test } from '@nestjs/testing';
import { LiffWarrantyService } from '../liff-warranty.service';
import { PrismaService } from '../../../prisma/prisma.service';

const PRODUCT = {
  brand: 'Samsung',
  model: 'A16',
  storage: '128GB',
  imeiSerial: 'IMEI-1',
  warrantyExpireDate: null,
};

const future = (days: number) => new Date(Date.now() + days * 86_400_000);
const past = (days: number) => new Date(Date.now() - days * 86_400_000);

describe('LiffWarrantyService.getMyWarranties', () => {
  let service: LiffWarrantyService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 'c-1', name: 'นาย ก' }) },
      sale: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const mod = await Test.createTestingModule({
      providers: [LiffWarrantyService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(LiffWarrantyService);
  });

  it('ยังไม่ผูกบัญชี → linked:false ไม่ throw (หน้าจอจะบอกวิธีผูกเอง)', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);
    const res = await service.getMyWarranties('U-unlinked');
    expect(res).toEqual({ linked: false, customerName: null, devices: [] });
    // ต้องไม่ยิง query อื่นเลยเมื่อยังไม่ผูก
    expect(prisma.sale.findMany).not.toHaveBeenCalled();
  });

  it('ค้นลูกค้าด้วย lineIdShop เท่านั้น (ไม่ใช่ lineIdFinance / CustomerLineLink)', async () => {
    await service.getMyWarranties('U-shop-1');
    expect(prisma.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { lineIdShop: 'U-shop-1', deletedAt: null } }),
    );
  });

  it('ใบขายที่ผูกสัญญาแล้วต้องถูกกรองออก — ไม่งั้นเครื่องเดียวโผล่สองแถว', async () => {
    await service.getMyWarranties('U-shop-1');
    expect(prisma.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contractId: null, deletedAt: null }),
      }),
    );
  });

  it('ขายสดที่ยังอยู่ในประกันร้าน → IN_SHOP_WARRANTY + นับวันคงเหลือ', async () => {
    prisma.sale.findMany.mockResolvedValue([
      { createdAt: past(30), shopWarrantyEndDate: future(30), product: PRODUCT },
    ]);
    const res = await service.getMyWarranties('U-shop-1');

    expect(res.linked).toBe(true);
    expect(res.devices).toHaveLength(1);
    expect(res.devices[0].title).toBe('Samsung A16 128GB');
    expect(res.devices[0].status).toBe('IN_SHOP_WARRANTY');
    expect(res.devices[0].shopWarrantyDaysLeft).toBeGreaterThanOrEqual(29);
    expect(res.devices[0].shopWarrantyDaysLeft).toBeLessThanOrEqual(30);
  });

  it('เครื่องใหม่ขายสด (ไม่มีประกันร้าน) แต่ประกันศูนย์ยังอยู่ → IN_MANUFACTURER', async () => {
    prisma.sale.findMany.mockResolvedValue([
      {
        createdAt: past(10),
        shopWarrantyEndDate: null,
        product: { ...PRODUCT, warrantyExpireDate: future(180) },
      },
    ]);
    const res = await service.getMyWarranties('U-shop-1');

    expect(res.devices[0].status).toBe('IN_MANUFACTURER');
    expect(res.devices[0].shopWarrantyDaysLeft).toBeNull();
    expect(res.devices[0].manufacturerWarrantyDaysLeft).toBeGreaterThan(170);
  });

  it('ประกันหมดทุกชั้น → EXPIRED และวันคงเหลือเป็น null ไม่ใช่ติดลบ', async () => {
    prisma.sale.findMany.mockResolvedValue([
      {
        createdAt: past(400),
        shopWarrantyEndDate: past(340),
        product: { ...PRODUCT, warrantyExpireDate: past(30) },
      },
    ]);
    const res = await service.getMyWarranties('U-shop-1');

    expect(res.devices[0].status).toBe('EXPIRED');
    expect(res.devices[0].shopWarrantyDaysLeft).toBeNull();
    expect(res.devices[0].manufacturerWarrantyDaysLeft).toBeNull();
  });

  it('รวมเครื่องจากทั้งใบขายและสัญญาผ่อนในรายการเดียว', async () => {
    prisma.sale.findMany.mockResolvedValue([
      { createdAt: past(5), shopWarrantyEndDate: future(55), product: PRODUCT },
    ]);
    prisma.contract.findMany.mockResolvedValue([
      {
        createdAt: past(100),
        deviceReceivedAt: past(100),
        shopWarrantyEndDate: past(40),
        product: { ...PRODUCT, imeiSerial: 'IMEI-2' },
      },
    ]);
    const res = await service.getMyWarranties('U-shop-1');

    expect(res.devices).toHaveLength(2);
    expect(res.devices.map((d) => d.imeiSerial)).toEqual(['IMEI-1', 'IMEI-2']);
    expect(res.devices[0].status).toBe('IN_SHOP_WARRANTY');
    expect(res.devices[1].status).toBe('EXPIRED');
  });

  it('แถวที่ไม่มีสินค้าผูกอยู่ ต้องถูกตัดทิ้ง ไม่ทำให้ทั้งหน้าพัง', async () => {
    prisma.sale.findMany.mockResolvedValue([
      { createdAt: past(1), shopWarrantyEndDate: null, product: null },
    ]);
    const res = await service.getMyWarranties('U-shop-1');
    expect(res.devices).toEqual([]);
  });
});
