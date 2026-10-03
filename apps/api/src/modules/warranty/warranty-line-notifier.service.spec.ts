import { Test, TestingModule } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { IntegrationConfigService } from '../integrations/integration-config.service';
import { WarrantyLineNotifierService } from './warranty-line-notifier.service';
import type { ExpiringWarrantyItem } from './warranty.service';

function makeItem(over: Partial<ExpiringWarrantyItem> = {}): ExpiringWarrantyItem {
  return {
    type: 'shop',
    source: 'SALE',
    sourceId: 'sale-1',
    productName: 'iPhone 13',
    deviceName: 'Apple 13 128GB',
    customerName: 'สมชาย ใจดี',
    customerId: 'cust-1',
    expireDate: new Date('2026-11-17T00:00:00.000Z'), // → BE 2569 → short "17 พ.ย. 69"
    daysRemaining: 3,
    lineIdShop: 'U-shop-1',
    ...over,
  };
}

describe('WarrantyLineNotifierService.notifyExpiring', () => {
  let service: WarrantyLineNotifierService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let notifications: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let integrationConfig: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = {
      notificationLog: { findFirst: jest.fn().mockResolvedValue(null) },
      notificationTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    notifications = {
      sendFromTemplate: jest.fn().mockResolvedValue({ id: 'log-1', status: 'SENT' }),
    };
    integrationConfig = { getValue: jest.fn().mockResolvedValue('liff-xxx') };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        WarrantyLineNotifierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: IntegrationConfigService, useValue: integrationConfig },
      ],
    }).compile();
    service = mod.get(WarrantyLineNotifierService);
  });

  afterEach(() => jest.restoreAllMocks());

  // final fix M-7 — cron ถามก่อนว่าแม่แบบเปิดอยู่ไหม (ปิดอยู่ = ไม่ต้องไล่ส่งทีละ item ให้ Sentry เตือนทุกวัน)
  describe('isTemplateActive', () => {
    it('หาแม่แบบ WARRANTY_EXPIRING_7D ที่ isActive + ยังไม่ถูกลบ → true เมื่อเจอ', async () => {
      prisma.notificationTemplate.findFirst.mockResolvedValue({ id: 'tpl-1' });

      await expect(service.isTemplateActive()).resolves.toBe(true);
      expect(prisma.notificationTemplate.findFirst).toHaveBeenCalledWith({
        where: { eventType: 'WARRANTY_EXPIRING_7D', isActive: true, deletedAt: null },
        select: { id: true },
      });
    });

    it('ไม่เจอ (ปิดอยู่/ไม่มีแถว) → false', async () => {
      prisma.notificationTemplate.findFirst.mockResolvedValue(null);
      await expect(service.isTemplateActive()).resolves.toBe(false);
    });
  });

  it('ไม่มี lineIdShop → NO_LINK ทันที ไม่ตรวจ dedup ไม่ส่ง', async () => {
    const result = await service.notifyExpiring(makeItem({ lineIdShop: null }));
    expect(result).toBe('NO_LINK');
    expect(prisma.notificationLog.findFirst).not.toHaveBeenCalled();
    expect(notifications.sendFromTemplate).not.toHaveBeenCalled();
  });

  it('เคยส่งแล้ว (probe เจอแถว in-flight) → DUP ไม่ส่งซ้ำ', async () => {
    prisma.notificationLog.findFirst.mockResolvedValue({ id: 'existing-log' });

    const result = await service.notifyExpiring(makeItem());

    expect(result).toBe('DUP');
    expect(prisma.notificationLog.findFirst).toHaveBeenCalledWith({
      where: {
        relatedId: 'warranty:SALE:sale-1:shop',
        status: { in: ['SENT', 'PENDING', 'RETRY_PENDING', 'DELAYED'] },
      },
      select: { id: true },
    });
    expect(notifications.sendFromTemplate).not.toHaveBeenCalled();
  });

  it('ยังไม่เคยส่ง (type shop) → เรียก sendFromTemplate ด้วย data/relatedId/recipient ตามสัญญา แล้วคืน SENT', async () => {
    const result = await service.notifyExpiring(makeItem({ type: 'shop' }));

    expect(result).toBe('SENT');
    expect(integrationConfig.getValue).toHaveBeenCalledWith('line-shop', 'liffId');
    expect(notifications.sendFromTemplate).toHaveBeenCalledWith(
      'WARRANTY_EXPIRING_7D',
      {
        warrantyType: 'ร้าน',
        deviceName: 'Apple 13 128GB',
        daysRemaining: '3',
        expireDate: '17 พ.ย. 69',
        liffLine: 'ประกันของฉัน: https://liff.line.me/liff-xxx/liff/warranty',
      },
      'U-shop-1',
      { customerId: 'cust-1', relatedId: 'warranty:SALE:sale-1:shop' },
    );
  });

  it('type manufacturer → warrantyType = ศูนย์ และ relatedId ใช้ type ต่างกับ shop', async () => {
    await service.notifyExpiring(
      makeItem({ type: 'manufacturer', sourceId: 'contract-9', source: 'CONTRACT' }),
    );

    const [, data, , options] = notifications.sendFromTemplate.mock.calls[0];
    expect(data.warrantyType).toBe('ศูนย์');
    expect(options.relatedId).toBe('warranty:CONTRACT:contract-9:manufacturer');
  });

  it('แม่แบบปิด (BLOCKED/TEMPLATE_INACTIVE) → คืน BLOCKED ไม่ยิง Sentry ทั้งสองแบบ', async () => {
    notifications.sendFromTemplate.mockResolvedValue({
      id: null,
      status: 'BLOCKED',
      blockReason: 'TEMPLATE_INACTIVE',
    });

    const result = await service.notifyExpiring(makeItem());

    expect(result).toBe('BLOCKED');
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  // fix round 1, Important — sendFromTemplate can RESOLVE (not throw) with status:'FAILED'
  // once its internal retry loop exhausts (LINE push failed 3x, stale/blocked recipient).
  // Folding this into 'BLOCKED' meant no layer ever alerted on it. Must surface via
  // Sentry.captureMessage (not captureException — nothing threw) with no PII.
  it('sendFromTemplate resolves {status:FAILED} (retry exhausted, no throw) → FAILED + Sentry.captureMessage, ไม่ใช่ captureException', async () => {
    notifications.sendFromTemplate.mockResolvedValue({
      id: 'n1',
      status: 'FAILED',
      errorMsg: 'Notification failed after 3 retries',
    });

    const result = await service.notifyExpiring(makeItem());

    expect(result).toBe('FAILED');
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'warranty line: dispatcher returned FAILED',
      {
        level: 'warning',
        tags: { subsystem: 'warranty-line' },
        extra: { relatedId: 'warranty:SALE:sale-1:shop', blockReason: null },
      },
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
    // ห้ามมี PII (lineIdShop / ชื่อลูกค้า) หลุดเข้า Sentry call ใดๆ
    expect(JSON.stringify((Sentry.captureMessage as jest.Mock).mock.calls[0])).not.toContain(
      'U-shop-1',
    );
  });

  it('sendFromTemplate throw → FAILED + Sentry, ไม่ throw ออกไป', async () => {
    const boom = new Error('dispatcher down');
    notifications.sendFromTemplate.mockRejectedValue(boom);

    const result = await service.notifyExpiring(makeItem());

    expect(result).toBe('FAILED');
    expect(Sentry.captureException).toHaveBeenCalledWith(boom, {
      tags: { subsystem: 'warranty-line' },
    });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('probe (notificationLog.findFirst) throw → FAILED + Sentry, ไม่ throw ออกไป และไม่ส่งจริง', async () => {
    const boom = new Error('db down');
    prisma.notificationLog.findFirst.mockRejectedValue(boom);

    const result = await service.notifyExpiring(makeItem());

    expect(result).toBe('FAILED');
    expect(notifications.sendFromTemplate).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(boom, {
      tags: { subsystem: 'warranty-line' },
    });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('getValue liffId throw → กลืนเอง (catch(() => null)) ยังส่งต่อได้โดย liffLine ว่าง', async () => {
    integrationConfig.getValue.mockRejectedValue(new Error('unknown key'));

    const result = await service.notifyExpiring(makeItem());

    expect(result).toBe('SENT');
    const [, data] = notifications.sendFromTemplate.mock.calls[0];
    expect(data.liffLine).toBe('');
  });
});
