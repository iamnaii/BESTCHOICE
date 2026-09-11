import { Test } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { StickersService } from './stickers.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * สติกเกอร์ติดเครื่องอ่านข้อมูลจาก "ตัวเครื่อง" ล้วน ๆ (คำตัดสินเจ้าของ 2026-09-11) —
 * ไม่แตะตารางราคากลาง PricingTemplate / SystemConfig sticker.* / โลโก้ร้านอีกต่อไป
 * ราคาและค่างวดให้ฝั่ง web คำนวณด้วยสูตรเดียวกับหน้ารายละเอียดสินค้า จึงส่งเฉพาะข้อมูลดิบ
 */
describe('StickersService — ข้อมูลเครื่องสำหรับพิมพ์สติกเกอร์', () => {
  let service: StickersService;
  let prisma: { product: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { product: { findMany: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [StickersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(StickersService);
  });

  const inTwoYears = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000);
  const baseProduct = {
    id: 'product-1',
    name: 'Apple iPhone 15 128GB Black',
    brand: 'Apple',
    model: 'iPhone 15',
    category: 'PHONE_NEW' as const,
    status: 'IN_STOCK' as const,
    color: 'ดำ',
    storage: '128GB',
    batteryHealth: null,
    hasBox: true,
    warrantyExpireDate: inTwoYears,
    warrantyExpired: false,
    imeiSerial: '351000000007919',
    stockInDate: new Date('2026-08-11T03:00:00.000Z'),
    cashPrice: new Decimal(19900),
    installmentPrice: new Decimal(19900),
    prices: [
      { label: 'ราคาเงินสด', amount: new Decimal(19900), isDefault: true },
      { label: 'ราคาผ่อน BESTCHOICE', amount: new Decimal(19900), isDefault: false },
    ],
  };

  it('ส่งข้อมูลจากตัวเครื่อง: ราคา (คอลัมน์ + แถวราคา) แบต กล่อง ประกันศูนย์ วันที่รับเข้า IMEI', async () => {
    prisma.product.findMany.mockResolvedValue([baseProduct]);

    const [result] = await service.getStickerDataBatch(['product-1']);

    expect(result).toEqual({
      productId: 'product-1',
      name: 'Apple iPhone 15 128GB Black',
      brand: 'Apple',
      model: 'iPhone 15',
      category: 'PHONE_NEW',
      status: 'IN_STOCK',
      color: 'ดำ',
      storage: '128GB',
      batteryHealth: null,
      hasBox: true,
      warrantyExpireDate: inTwoYears.toISOString().slice(0, 10),
      imei: '351000000007919',
      stockInDate: '2026-08-11T03:00:00.000Z',
      cashPrice: '19900',
      installmentPrice: '19900',
      prices: [
        { label: 'ราคาเงินสด', amount: '19900', isDefault: true },
        { label: 'ราคาผ่อน BESTCHOICE', amount: '19900', isDefault: false },
      ],
    });
  });

  it('ค้นได้ทั้ง Product ID และ IMEI (ยิงบาร์โค้ดจากช่องสแกน) — คืนตามลำดับที่ขอ ไม่ซ้ำ', async () => {
    const second = { ...baseProduct, id: 'product-2', imeiSerial: '351000000055433', model: 'Galaxy S24' };
    prisma.product.findMany.mockResolvedValue([baseProduct, second]);

    const result = await service.getStickerDataBatch([
      '351000000055433',
      'product-1',
      '351000000007919', // IMEI ของเครื่องแรก — เครื่องเดียวกัน ไม่ต้องส่งซ้ำ
    ]);

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          OR: [
            { id: { in: ['351000000055433', 'product-1', '351000000007919'] } },
            { imeiSerial: { in: ['351000000055433', 'product-1', '351000000007919'] } },
          ],
        },
      }),
    );
    expect(result.map((r) => r.productId)).toEqual(['product-2', 'product-1']);
  });

  it('ประกันศูนย์: หมดแล้ว (flag) หรือวันที่ผ่านมาแล้ว = null · ไม่ระบุ = null', async () => {
    prisma.product.findMany.mockResolvedValue([
      { ...baseProduct, id: 'a', warrantyExpired: true },
      { ...baseProduct, id: 'b', warrantyExpireDate: new Date('2024-01-01'), warrantyExpired: false },
      { ...baseProduct, id: 'c', warrantyExpireDate: null, warrantyExpired: null },
    ]);

    const result = await service.getStickerDataBatch(['a', 'b', 'c']);

    expect(result.map((r) => r.warrantyExpireDate)).toEqual([null, null, null]);
  });

  it('เครื่องที่ยังไม่ตั้งราคา: cashPrice/installmentPrice = null และไม่มีแถวราคา (ให้ web เตือน ไม่พิมพ์)', async () => {
    prisma.product.findMany.mockResolvedValue([
      { ...baseProduct, cashPrice: null, installmentPrice: null, prices: [], batteryHealth: 87, hasBox: false, category: 'PHONE_USED' },
    ]);

    const [result] = await service.getStickerDataBatch(['product-1']);

    expect(result.cashPrice).toBeNull();
    expect(result.installmentPrice).toBeNull();
    expect(result.prices).toEqual([]);
    expect(result.batteryHealth).toBe(87);
    expect(result.hasBox).toBe(false);
    expect(result.category).toBe('PHONE_USED');
  });

  it('ไม่มี key = ไม่ยิง DB · เกิน 100 key ตัดที่ 100', async () => {
    expect(await service.getStickerDataBatch([])).toEqual([]);
    expect(prisma.product.findMany).not.toHaveBeenCalled();

    prisma.product.findMany.mockResolvedValue([]);
    await service.getStickerDataBatch(Array.from({ length: 120 }, (_, i) => `id-${i}`));
    const call = prisma.product.findMany.mock.calls[0][0];
    expect(call.where.OR[0].id.in).toHaveLength(100);
  });

  it('getStickerData (เดี่ยว) โยน NotFound เมื่อไม่พบทั้ง ID และ IMEI', async () => {
    prisma.product.findMany.mockResolvedValue([]);
    await expect(service.getStickerData('missing')).rejects.toThrow('ไม่พบสินค้า');
  });
});
