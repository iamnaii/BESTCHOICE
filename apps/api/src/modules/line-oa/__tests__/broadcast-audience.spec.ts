import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BroadcastService } from '../broadcast.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { IntegrationConfigService } from '../../integrations/integration-config.service';

/**
 * REGRESSION: broadcast ส่งด้วย token ของ OA **ร้าน** (`getValue('line-shop','channelToken')`)
 * แต่เดิมดึงผู้รับจากตาราง `CustomerLineLink` โดยไม่กรอง channel ซึ่งมีแต่แถวช่อง FINANCE
 * ⇒ ยิง userId ของ OA ไฟแนนซ์ด้วย token ของ OA ร้าน = ผิด OA เชิงโครงสร้าง
 *
 * ตัวตนฝั่งร้านอยู่ที่ `customer.lineIdShop` — เทสต์ชุดนี้ปักว่าทุกกลุ่มผู้รับอ่านจากที่นั่น
 * และ **ห้ามแตะ `customerLineLink` อีก**
 */
describe('BroadcastService — กลุ่มผู้รับต้องมาจากช่องร้าน (lineIdShop)', () => {
  let service: BroadcastService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      customer: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // ถ้าโค้ดกลับไปเรียกตารางนี้อีก เทสต์จะจับได้ทันที
      customerLineLink: {
        count: jest.fn(() => {
          throw new Error('ห้ามอ่าน customerLineLink — ช่องร้านใช้ customer.lineIdShop');
        }),
        findMany: jest.fn(() => {
          throw new Error('ห้ามอ่าน customerLineLink — ช่องร้านใช้ customer.lineIdShop');
        }),
      },
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        BroadcastService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: StorageService, useValue: { upload: jest.fn() } },
        { provide: IntegrationConfigService, useValue: { getValue: jest.fn() } },
      ],
    }).compile();
    service = mod.get(BroadcastService);
  });

  it('getAudienceCount นับจาก customer.lineIdShop ทั้ง 3 กลุ่ม', async () => {
    prisma.customer.count
      .mockResolvedValueOnce(10) // all
      .mockResolvedValueOnce(4) // existing
      .mockResolvedValueOnce(2); // overdue

    const res = await service.getAudienceCount();

    expect(res).toEqual({ all: 10, existing: 4, overdue: 2, new: 6 });
    expect(prisma.customerLineLink.count).not.toHaveBeenCalled();
    for (const call of prisma.customer.count.mock.calls) {
      expect(call[0].where.lineIdShop).toEqual({ not: null });
      expect(call[0].where.deletedAt).toBeNull();
    }
  });

  it.each([
    ['OVERDUE', 'some'],
    ['EXISTING', 'some'],
    ['NEW', 'none'],
  ])('getAudienceUserIds(%s) กรองด้วย lineIdShop และใช้ contracts.%s', async (audience, key) => {
    prisma.customer.findMany.mockResolvedValue([
      { lineIdShop: 'U-1' },
      { lineIdShop: 'U-2' },
    ]);

    const ids = await service.getAudienceUserIds(audience);

    expect(ids).toEqual(['U-1', 'U-2']);
    const where = prisma.customer.findMany.mock.calls[0][0].where;
    expect(where.lineIdShop).toEqual({ not: null });
    expect(where.contracts).toHaveProperty(key);
    expect(prisma.customerLineLink.findMany).not.toHaveBeenCalled();
  });

  it('แถวที่ lineIdShop เป็น null ถูกกรองทิ้ง (ไม่ส่ง undefined เข้า LINE)', async () => {
    prisma.customer.findMany.mockResolvedValue([
      { lineIdShop: 'U-1' },
      { lineIdShop: null },
      { lineIdShop: '' },
    ]);
    expect(await service.getAudienceUserIds('OVERDUE')).toEqual(['U-1']);
  });

  it('ALL → คืน [] เพื่อให้ไปใช้ broadcast API ของ LINE (ส่งหาผู้ติดตาม OA ทั้งหมด)', async () => {
    expect(await service.getAudienceUserIds('ALL')).toEqual([]);
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });

  it('กลุ่มที่ไม่รู้จัก → คืน [] ไม่ throw', async () => {
    expect(await service.getAudienceUserIds('WHATEVER')).toEqual([]);
  });
});
