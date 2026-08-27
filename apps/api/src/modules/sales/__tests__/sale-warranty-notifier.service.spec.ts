import { Test } from '@nestjs/testing';
import { SaleWarrantyNotifierService } from '../services/sale-warranty-notifier.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { LineOaService } from '../../line-oa/line-oa.service';
import { IntegrationConfigService } from '../../integrations/integration-config.service';

const SALE = {
  id: 's-1',
  saleNumber: 'SL-001',
  shopWarrantyEndDate: new Date('2026-10-26T00:00:00.000Z'),
  customer: { id: 'c-1', name: 'นาย ก', lineIdShop: 'U-shop-1' },
  product: { brand: 'Samsung', model: 'A16', storage: '128GB', imeiSerial: 'IMEI-1' },
};

describe('SaleWarrantyNotifierService.notify', () => {
  let service: SaleWarrantyNotifierService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let line: any;

  beforeEach(async () => {
    prisma = {
      sale: { findFirst: jest.fn().mockResolvedValue(SALE) },
      notificationLog: { create: jest.fn().mockResolvedValue({}) },
    };
    line = { sendFlexMessage: jest.fn().mockResolvedValue(undefined) };
    const mod = await Test.createTestingModule({
      providers: [
        SaleWarrantyNotifierService,
        { provide: PrismaService, useValue: prisma },
        { provide: LineOaService, useValue: line },
        {
          provide: IntegrationConfigService,
          useValue: { getValue: jest.fn().mockResolvedValue('LIFF-123') },
        },
      ],
    }).compile();
    service = mod.get(SaleWarrantyNotifierService);
  });

  it('ส่ง Flex ผ่านช่อง line-shop ไปยัง lineIdShop ของลูกค้า', async () => {
    await service.notify('s-1');

    expect(line.sendFlexMessage).toHaveBeenCalledTimes(1);
    const [to, payload, channelKey] = line.sendFlexMessage.mock.calls[0];
    expect(to).toBe('U-shop-1');
    expect(channelKey).toBe('line-shop');
    expect(payload.altText).toContain('Samsung A16 128GB');
  });

  it('ปุ่มพาไปหน้าประกันใน LIFF เมื่อมี LIFF ID', async () => {
    await service.notify('s-1');
    const [, payload] = line.sendFlexMessage.mock.calls[0];
    expect(payload.contents.footer.contents[0].action.uri).toBe(
      'https://liff.line.me/LIFF-123/liff/warranty',
    );
  });

  it('ไม่มี LIFF ID → ไม่มีปุ่ม (ปุ่มที่กดแล้วไปหน้าเปล่าแย่กว่าไม่มีปุ่ม)', async () => {
    const mod = await Test.createTestingModule({
      providers: [
        SaleWarrantyNotifierService,
        { provide: PrismaService, useValue: prisma },
        { provide: LineOaService, useValue: line },
        { provide: IntegrationConfigService, useValue: { getValue: jest.fn().mockResolvedValue('') } },
      ],
    }).compile();
    await mod.get(SaleWarrantyNotifierService).notify('s-1');

    const [, payload] = line.sendFlexMessage.mock.calls[0];
    expect(payload.contents.footer).toBeUndefined();
  });

  it('ไม่มีประกันร้าน (เครื่องใหม่) → ไม่ส่งอะไรเลย', async () => {
    prisma.sale.findFirst.mockResolvedValue({ ...SALE, shopWarrantyEndDate: null });
    await service.notify('s-1');
    expect(line.sendFlexMessage).not.toHaveBeenCalled();
    expect(prisma.notificationLog.create).not.toHaveBeenCalled();
  });

  it('ลูกค้ายังไม่ผูก LINE ร้าน → ไม่ส่ง และไม่นับเป็นความล้มเหลว', async () => {
    prisma.sale.findFirst.mockResolvedValue({
      ...SALE,
      customer: { ...SALE.customer, lineIdShop: null },
    });
    await service.notify('s-1');
    expect(line.sendFlexMessage).not.toHaveBeenCalled();
    expect(prisma.notificationLog.create).not.toHaveBeenCalled();
  });

  it('ส่งสำเร็จ → NotificationLog SENT พร้อม customerId/category', async () => {
    await service.notify('s-1');
    expect(prisma.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SENT',
          channelKey: 'line-shop',
          recipient: 'U-shop-1',
          customerId: 'c-1',
          category: 'TRANSACTIONAL',
          relatedId: 's-1',
        }),
      }),
    );
  });

  it('LINE ล้มเหลว → บันทึก FAILED และ **ไม่ throw** (ขายไปแล้ว ห้ามพัง)', async () => {
    line.sendFlexMessage.mockRejectedValue(new Error('LINE 500'));

    await expect(service.notify('s-1')).resolves.toBeUndefined();

    expect(prisma.notificationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', errorMsg: 'LINE 500', sentAt: null }),
      }),
    );
  });

  it('อ่านใบขายพังทั้งก้อน → กลืนไว้ ไม่ throw ออกเส้นทางการขาย', async () => {
    prisma.sale.findFirst.mockRejectedValue(new Error('db down'));
    await expect(service.notify('s-1')).resolves.toBeUndefined();
  });

  it('ใบขายที่ถูกยกเลิกแล้วต้องไม่ถูกหยิบมาส่ง', async () => {
    await service.notify('s-1');
    expect(prisma.sale.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's-1', deletedAt: null } }),
    );
  });
});
