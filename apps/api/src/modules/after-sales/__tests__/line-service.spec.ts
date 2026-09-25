import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { IntegrationConfigService } from '../../integrations/integration-config.service';
import { AfterSalesLineService } from '../services/after-sales-line.service';
import * as lineCopyUtil from '../utils/after-sales-line-copy.util';
import { buildLineData, lineEventNote, LineCaseRow } from '../utils/after-sales-line-copy.util';

const SHOP_LINE_ID = 'Ushop-secret-1234567890';

function makeCase(over: Record<string, unknown> = {}) {
  return {
    id: 'case-1',
    caseNumber: 'AS-20260925-0001',
    outcome: 'REPAIR' as const,
    symptom: 'จอแตกมุมขวาบน',
    deviceBrand: 'Apple',
    deviceModel: 'iPhone 13',
    deviceImei: '356938035643809',
    warrantySnapshot: {
      status: 'IN_SHOP_WARRANTY',
      within7Days: false,
      daysRemainingIn7Day: 0,
      shopWarrantyEndDate: '2026-12-01T00:00:00.000Z',
      manufacturerWarrantyEndDate: null,
      checkedAt: '2026-09-25T00:00:00.000Z',
    },
    replacementProductId: null as string | null,
    replacementContractId: null as string | null,
    approvedAt: null,
    customer: { id: 'cust-1', lineIdShop: SHOP_LINE_ID as string | null },
    branch: { name: 'ลาดพร้าว' },
    repairTicket: {
      payer: 'SHOP' as const,
      estimatedCost: null as Prisma.Decimal | null,
      actualCost: null as Prisma.Decimal | null,
    },
    ...over,
  };
}

describe('AfterSalesLineService', () => {
  let service: AfterSalesLineService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let notifications: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let integrationConfig: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = {
      afterSalesCase: { findFirst: jest.fn() },
      afterSalesEvent: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn() },
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) }, // missing row → readBoolFlag fallback (true)
      product: { findFirst: jest.fn() },
      contract: { findFirst: jest.fn() },
    };
    notifications = {
      sendFromTemplate: jest.fn().mockResolvedValue({ id: 'log-1', status: 'SENT' }),
    };
    integrationConfig = { getValue: jest.fn().mockResolvedValue(undefined) };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AfterSalesLineService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: IntegrationConfigService, useValue: integrationConfig },
      ],
    }).compile();
    service = mod.get(AfterSalesLineService);
  });

  afterEach(() => jest.restoreAllMocks());

  // ---------------------------------------------------------------------
  // (a) มี lineIdShop → ส่งจริง + event LINE_SENT + {status:'SENT'}
  // ---------------------------------------------------------------------
  it('(a) sends via sendFromTemplate, records LINE_SENT with the exact SENT note, and returns SENT', async () => {
    const c = makeCase();
    prisma.afterSalesCase.findFirst.mockResolvedValue(c);

    const result = await service.notifyMoment('case-1', 'RECEIVED', 'actor-1');

    expect(notifications.sendFromTemplate).toHaveBeenCalledTimes(1);
    const [eventType, data, recipient, options] = notifications.sendFromTemplate.mock.calls[0];
    expect(eventType).toBe('AFTER_SALES_RECEIVED');
    expect(recipient).toBe(SHOP_LINE_ID);
    expect(options).toEqual({ customerId: 'cust-1', relatedId: 'case-1' });
    // ตรวจว่า data ตรงกับ buildLineData ของ LineCaseRow ที่ควรถูก map จริง (behavior จริง ไม่ใช่แค่ mock call)
    const expectedRow: LineCaseRow = {
      caseNumber: c.caseNumber,
      outcome: c.outcome,
      symptom: c.symptom,
      deviceBrand: c.deviceBrand,
      deviceModel: c.deviceModel,
      deviceImei: c.deviceImei,
      branch: { name: c.branch.name },
      warrantySnapshot: {
        status: c.warrantySnapshot.status,
        shopWarrantyEndDate: c.warrantySnapshot.shopWarrantyEndDate,
        manufacturerWarrantyEndDate: c.warrantySnapshot.manufacturerWarrantyEndDate,
      },
      repairTicket: { payer: 'SHOP', estimatedCost: null, actualCost: null },
      replacement: null,
    };
    expect(data).toEqual(buildLineData(expectedRow, 'RECEIVED', ''));

    expect(prisma.afterSalesEvent.create).toHaveBeenCalledWith({
      data: {
        caseId: 'case-1',
        kind: 'LINE_SENT',
        note: '[AFTER_SALES_RECEIVED] รับเรื่องแล้ว · ส่งแล้ว',
        actorId: 'actor-1',
      },
    });
    expect(result).toEqual({ status: 'SENT' });
  });

  // ---------------------------------------------------------------------
  // (b) ไม่มี lineIdShop → ไม่ส่ง, event LINE_SKIPPED_NO_LINK
  // ---------------------------------------------------------------------
  it('(b) skips sending and records LINE_SKIPPED_NO_LINK when the customer has no lineIdShop', async () => {
    prisma.afterSalesCase.findFirst.mockResolvedValue(
      makeCase({ customer: { id: 'cust-1', lineIdShop: null } }),
    );

    const result = await service.notifyMoment('case-1', 'RECEIVED', 'actor-1');

    expect(notifications.sendFromTemplate).not.toHaveBeenCalled();
    expect(prisma.afterSalesEvent.create).toHaveBeenCalledWith({
      data: {
        caseId: 'case-1',
        kind: 'LINE_SKIPPED_NO_LINK',
        note: '[AFTER_SALES_RECEIVED] รับเรื่องแล้ว · ไม่ได้ส่ง — ลูกค้ายังไม่ผูก LINE',
        actorId: 'actor-1',
      },
    });
    expect(result).toEqual({ status: 'NO_LINK' });
  });

  // ---------------------------------------------------------------------
  // (c) sendFromTemplate reject → NOTE FAILED + Sentry.captureException + FAILED, ไม่ throw
  // ---------------------------------------------------------------------
  it('(c) records NOTE/FAILED and reports Sentry.captureException when sendFromTemplate rejects, without throwing', async () => {
    prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase());
    const err = new Error('LINE 429');
    notifications.sendFromTemplate.mockRejectedValueOnce(err);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(service.notifyMoment('case-1', 'RECEIVED', 'actor-1')).resolves.toEqual({
      status: 'FAILED',
    });

    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      tags: { subsystem: 'after-sales-line', moment: 'RECEIVED' },
    });
    expect(prisma.afterSalesEvent.create).toHaveBeenCalledWith({
      data: {
        caseId: 'case-1',
        kind: 'NOTE',
        note: '[AFTER_SALES_RECEIVED] รับเรื่องแล้ว · ส่งไม่สำเร็จ (LINE 429)',
        actorId: 'actor-1',
      },
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('LINE 429'));
  });

  // ---------------------------------------------------------------------
  // (d) sendFromTemplate คืน BLOCKED/TEMPLATE_INACTIVE → NOTE BLOCKED, ไม่ Sentry
  // ---------------------------------------------------------------------
  it('(d) records NOTE/BLOCKED with the block reason and does not report Sentry when the dispatcher returns BLOCKED', async () => {
    prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase());
    notifications.sendFromTemplate.mockResolvedValueOnce({
      id: null,
      status: 'BLOCKED',
      blockReason: 'TEMPLATE_INACTIVE',
    });

    const result = await service.notifyMoment('case-1', 'RECEIVED', 'actor-1');

    expect(prisma.afterSalesEvent.create).toHaveBeenCalledWith({
      data: {
        caseId: 'case-1',
        kind: 'NOTE',
        note: '[AFTER_SALES_RECEIVED] รับเรื่องแล้ว · ไม่ได้ส่ง — TEMPLATE_INACTIVE',
        actorId: 'actor-1',
      },
    });
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'BLOCKED' });
  });

  // ---------------------------------------------------------------------
  // (e) PII — lineIdShop ไม่รั่วไปที่ data / note / logger call ใด ๆ
  // ---------------------------------------------------------------------
  it('(e) never leaks lineIdShop into the template data, any event note, or any logger call', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    // เดินสามจังหวะที่ต่างกัน (SENT ปกติ + FAILED ที่มี logger.warn) เพื่อกวาดทุก call site
    prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase());
    await service.notifyMoment('case-1', 'RECEIVED', 'actor-1');

    prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase());
    notifications.sendFromTemplate.mockRejectedValueOnce(new Error('boom'));
    await service.notifyMoment('case-1', 'READY', 'actor-1');

    const dataCalls = notifications.sendFromTemplate.mock.calls.map(
      ([, data]: [string, unknown]) => data,
    );
    for (const data of dataCalls) {
      expect(JSON.stringify(data)).not.toContain(SHOP_LINE_ID);
    }
    for (const call of prisma.afterSalesEvent.create.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SHOP_LINE_ID);
    }
    for (const call of [...logSpy.mock.calls, ...warnSpy.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain(SHOP_LINE_ID);
    }
  });

  // ---------------------------------------------------------------------
  // (f) kill switch off → ไม่ส่ง, event NOTE DISABLED
  // ---------------------------------------------------------------------
  it('(f) does not send and records NOTE/DISABLED when after_sales_line_enabled is false', async () => {
    prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase());
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'false' });

    const result = await service.notifyMoment('case-1', 'RECEIVED', 'actor-1');

    expect(prisma.systemConfig.findFirst).toHaveBeenCalledWith({
      where: { key: 'after_sales_line_enabled', deletedAt: null },
      select: { value: true },
    });
    expect(notifications.sendFromTemplate).not.toHaveBeenCalled();
    expect(prisma.afterSalesEvent.create).toHaveBeenCalledWith({
      data: {
        caseId: 'case-1',
        kind: 'NOTE',
        note: '[AFTER_SALES_RECEIVED] รับเรื่องแล้ว · ไม่ได้ส่ง — ปิดการส่ง LINE (after_sales_line_enabled)',
        actorId: 'actor-1',
      },
    });
    expect(result).toEqual({ status: 'DISABLED' });
  });

  // ---------------------------------------------------------------------
  // (g) liffId ว่าง/มี — data.liffLine ตรงตามคาด, CLOSED ใช้ label ต่างจากจังหวะอื่น
  // ---------------------------------------------------------------------
  it('(g) liffLine is empty when no liffId is configured', async () => {
    prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase());
    integrationConfig.getValue.mockResolvedValue(undefined);

    await service.notifyMoment('case-1', 'RECEIVED', 'actor-1');

    const data = notifications.sendFromTemplate.mock.calls[0][1];
    expect(data.liffLine).toBe('');
  });

  it('(g) liffLine starts with "ดูสถานะเคส: https://liff.line.me/" for RECEIVED/READY when liffId is configured', async () => {
    prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase());
    integrationConfig.getValue.mockResolvedValue('1234567890-abcdefgh');

    await service.notifyMoment('case-1', 'READY', 'actor-1');

    expect(integrationConfig.getValue).toHaveBeenCalledWith('line-shop', 'liffId');
    const data = notifications.sendFromTemplate.mock.calls[0][1];
    expect(data.liffLine.startsWith('ดูสถานะเคส: https://liff.line.me/')).toBe(true);
  });

  it('(g) moment CLOSED uses the "ประกันของฉัน" label for the liff line instead of "ดูสถานะเคส"', async () => {
    prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase());
    integrationConfig.getValue.mockResolvedValue('1234567890-abcdefgh');

    await service.notifyMoment('case-1', 'CLOSED', 'actor-1');

    const data = notifications.sendFromTemplate.mock.calls[0][1];
    expect(data.liffLine.startsWith('ประกันของฉัน: https://liff.line.me/')).toBe(true);
  });

  // liffId lookup ต้องไม่ล้มทั้งเคสเมื่อ IntegrationConfigService throw (เช่น key ไม่รู้จัก)
  it('(g) treats a rejected liffId lookup as "no liff link" instead of failing the whole send', async () => {
    prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase());
    integrationConfig.getValue.mockRejectedValue(new Error('NotFoundException'));

    const result = await service.notifyMoment('case-1', 'RECEIVED', 'actor-1');

    expect(result).toEqual({ status: 'SENT' });
    const data = notifications.sendFromTemplate.mock.calls[0][1];
    expect(data.liffLine).toBe('');
  });

  // ---------------------------------------------------------------------
  // (h) hasLineEvent — probe ผ่าน note startsWith tag
  // ---------------------------------------------------------------------
  it('(h) hasLineEvent probes afterSalesEvent by kind LINE_SENT + note startsWith the event tag, and returns true on a hit', async () => {
    prisma.afterSalesEvent.findFirst.mockResolvedValue({ id: 'evt-1' });

    const result = await service.hasLineEvent('case-1', 'AFTER_SALES_PICKUP_REMINDER');

    expect(prisma.afterSalesEvent.findFirst).toHaveBeenCalledWith({
      where: {
        caseId: 'case-1',
        kind: 'LINE_SENT',
        note: { startsWith: '[AFTER_SALES_PICKUP_REMINDER]' },
      },
      select: { id: true },
    });
    expect(result).toBe(true);
  });

  it('(h) hasLineEvent returns false when no matching event exists', async () => {
    prisma.afterSalesEvent.findFirst.mockResolvedValue(null);
    const result = await service.hasLineEvent('case-1', 'AFTER_SALES_PICKUP_REMINDER');
    expect(result).toBe(false);
  });

  // ---------------------------------------------------------------------
  // (i) เคสไม่พบ → FAILED + Sentry, ไม่ throw
  // ---------------------------------------------------------------------
  it('(i) returns FAILED and reports Sentry.captureMessage when the case cannot be found, without throwing', async () => {
    prisma.afterSalesCase.findFirst.mockResolvedValue(null);

    const result = await service.notifyMoment('missing-case', 'RECEIVED', 'actor-1');

    expect(result).toEqual({ status: 'FAILED' });
    expect(Sentry.captureMessage).toHaveBeenCalledWith('after-sales line: case not found', {
      level: 'warning',
      tags: { subsystem: 'after-sales-line' },
      extra: { caseId: 'missing-case', moment: 'RECEIVED' },
    });
    expect(notifications.sendFromTemplate).not.toHaveBeenCalled();
    expect(prisma.afterSalesEvent.create).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // actorId: null ที่มา cron ต้องผ่านเข้า create ตรง ๆ (ไม่ throw / ไม่แปลงเป็นค่าอื่น)
  // ---------------------------------------------------------------------
  it('passes a null actorId straight through to the recorded event (cron caller has no human actor)', async () => {
    prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase());
    await service.notifyMoment('case-1', 'PICKUP_REMINDER', null);
    expect(prisma.afterSalesEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorId: null }),
    });
  });

  // ---------------------------------------------------------------------
  // "ไม่ throw ทุกกรณี" ต้องครอบคลุมตอนบันทึก event เองก็ล้มด้วย ไม่ใช่แค่ตอน sendFromTemplate ล้ม —
  // ถ้า service `return this.record(...)` โดยไม่ `await` จุดที่ afterSalesEvent.create รีเจกต์จะ
  // มองข้าม catch ของฟังก์ชันแล้ว reject promise ของ notifyMoment ตรง ๆ ให้ผู้เรียก
  // ---------------------------------------------------------------------
  it('does not throw when afterSalesEvent.create itself rejects on the DISABLED path', async () => {
    prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase());
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'false' });
    prisma.afterSalesEvent.create.mockRejectedValueOnce(new Error('db down'));

    await expect(service.notifyMoment('case-1', 'RECEIVED', 'actor-1')).resolves.toEqual({
      status: 'FAILED',
    });
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('does not throw when afterSalesEvent.create itself rejects on the SENT path', async () => {
    prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase());
    prisma.afterSalesEvent.create.mockRejectedValueOnce(new Error('db down'));

    await expect(service.notifyMoment('case-1', 'RECEIVED', 'actor-1')).resolves.toEqual({
      status: 'FAILED',
    });
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('does not throw when afterSalesEvent.create itself rejects on the NO_LINK path', async () => {
    prisma.afterSalesCase.findFirst.mockResolvedValue(
      makeCase({ customer: { id: 'cust-1', lineIdShop: null } }),
    );
    prisma.afterSalesEvent.create.mockRejectedValueOnce(new Error('db down'));

    await expect(service.notifyMoment('case-1', 'RECEIVED', 'actor-1')).resolves.toEqual({
      status: 'FAILED',
    });
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('does not throw when afterSalesEvent.create itself rejects on the BLOCKED path', async () => {
    prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase());
    notifications.sendFromTemplate.mockResolvedValueOnce({
      id: null,
      status: 'BLOCKED',
      blockReason: 'X',
    });
    prisma.afterSalesEvent.create.mockRejectedValueOnce(new Error('db down'));

    await expect(service.notifyMoment('case-1', 'RECEIVED', 'actor-1')).resolves.toEqual({
      status: 'FAILED',
    });
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // PF-1 mapping traps — replacement / Decimal / malformed warrantySnapshot
  // ---------------------------------------------------------------------
  describe('DB→LineCaseRow mapping (PF-1)', () => {
    it('maps replacementProductId/replacementContractId into LineCaseRow.replacement with shopWarrantyEndDate as an ISO string', async () => {
      const buildSpy = jest.spyOn(lineCopyUtil, 'buildLineData');
      prisma.afterSalesCase.findFirst.mockResolvedValue(
        makeCase({
          outcome: 'SAME_MODEL_EXCHANGE',
          replacementProductId: 'prod-new-1',
          replacementContractId: 'contract-new-1',
        }),
      );
      prisma.product.findFirst.mockResolvedValue({
        brand: 'Apple',
        model: 'iPhone 15',
        storage: '256GB',
        imeiSerial: '111122223333444',
      });
      const warrantyEnd = new Date('2027-01-15T00:00:00.000Z');
      prisma.contract.findFirst.mockResolvedValue({ shopWarrantyEndDate: warrantyEnd });

      await service.notifyMoment('case-1', 'CLOSED', 'actor-1');

      expect(prisma.product.findFirst).toHaveBeenCalledWith({
        where: { id: 'prod-new-1', deletedAt: null },
        select: { brand: true, model: true, storage: true, imeiSerial: true },
      });
      expect(prisma.contract.findFirst).toHaveBeenCalledWith({
        where: { id: 'contract-new-1' },
        select: { shopWarrantyEndDate: true },
      });
      const row = buildSpy.mock.calls[0][0];
      expect(row.replacement).toEqual({
        brand: 'Apple',
        model: 'iPhone 15',
        storage: '256GB',
        imeiSerial: '111122223333444',
        shopWarrantyEndDate: warrantyEnd.toISOString(),
      });
    });

    it('leaves replacement null when replacementProductId is absent, without querying product/contract', async () => {
      const buildSpy = jest.spyOn(lineCopyUtil, 'buildLineData');
      prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase());

      await service.notifyMoment('case-1', 'RECEIVED', 'actor-1');

      expect(prisma.product.findFirst).not.toHaveBeenCalled();
      expect(prisma.contract.findFirst).not.toHaveBeenCalled();
      const row = buildSpy.mock.calls[0][0];
      expect(row.replacement).toBeNull();
    });

    it('leaves replacement null when the replacement product was soft-deleted (not found under deletedAt:null)', async () => {
      const buildSpy = jest.spyOn(lineCopyUtil, 'buildLineData');
      prisma.afterSalesCase.findFirst.mockResolvedValue(
        makeCase({ outcome: 'SAME_MODEL_EXCHANGE', replacementProductId: 'prod-deleted' }),
      );
      prisma.product.findFirst.mockResolvedValue(null);

      await service.notifyMoment('case-1', 'CLOSED', 'actor-1');

      const row = buildSpy.mock.calls[0][0];
      expect(row.replacement).toBeNull();
    });

    it('converts repairTicket estimatedCost/actualCost Decimal fields to strings (never a raw Decimal object)', async () => {
      const buildSpy = jest.spyOn(lineCopyUtil, 'buildLineData');
      prisma.afterSalesCase.findFirst.mockResolvedValue(
        makeCase({
          repairTicket: {
            payer: 'CUSTOMER',
            estimatedCost: new Prisma.Decimal('1250.50'),
            actualCost: new Prisma.Decimal('1300.00'),
          },
        }),
      );

      await service.notifyMoment('case-1', 'RECEIVED', 'actor-1');

      const row = buildSpy.mock.calls[0][0];
      expect(row.repairTicket?.estimatedCost).toBe('1250.5');
      expect(row.repairTicket?.actualCost).toBe('1300');
      expect(typeof row.repairTicket?.estimatedCost).toBe('string');
      expect(typeof row.repairTicket?.actualCost).toBe('string');
    });

    it('maps a null repairTicket straight through as null (walk-in cases with no ticket)', async () => {
      const buildSpy = jest.spyOn(lineCopyUtil, 'buildLineData');
      prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase({ repairTicket: null }));

      await service.notifyMoment('case-1', 'RECEIVED', 'actor-1');

      const row = buildSpy.mock.calls[0][0];
      expect(row.repairTicket).toBeNull();
    });

    it('maps a well-formed warrantySnapshot (shopWarrantyEnd/manufacturerWarrantyEnd key names) into shopWarrantyEndDate/manufacturerWarrantyEndDate', async () => {
      const buildSpy = jest.spyOn(lineCopyUtil, 'buildLineData');
      prisma.afterSalesCase.findFirst.mockResolvedValue(
        makeCase({
          warrantySnapshot: {
            status: 'IN_MANUFACTURER',
            within7Days: false,
            daysRemainingIn7Day: 0,
            shopWarrantyEnd: '2026-11-01T00:00:00.000Z',
            manufacturerWarrantyEnd: '2027-03-01T00:00:00.000Z',
            checkedAt: '2026-09-25T00:00:00.000Z',
          },
        }),
      );

      await service.notifyMoment('case-1', 'RECEIVED', 'actor-1');

      const row = buildSpy.mock.calls[0][0];
      expect(row.warrantySnapshot).toEqual({
        status: 'IN_MANUFACTURER',
        shopWarrantyEndDate: '2026-11-01T00:00:00.000Z',
        manufacturerWarrantyEndDate: '2027-03-01T00:00:00.000Z',
      });
    });

    it('maps a malformed/missing warrantySnapshot to null instead of throwing', async () => {
      const buildSpy = jest.spyOn(lineCopyUtil, 'buildLineData');
      prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase({ warrantySnapshot: {} }));

      const result = await service.notifyMoment('case-1', 'RECEIVED', 'actor-1');

      expect(result).toEqual({ status: 'SENT' });
      const row = buildSpy.mock.calls[0][0];
      expect(row.warrantySnapshot).toBeNull();
    });

    it('maps a null warrantySnapshot column to null', async () => {
      const buildSpy = jest.spyOn(lineCopyUtil, 'buildLineData');
      prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase({ warrantySnapshot: null }));

      await service.notifyMoment('case-1', 'RECEIVED', 'actor-1');

      const row = buildSpy.mock.calls[0][0];
      expect(row.warrantySnapshot).toBeNull();
    });

    it('leaves deviceStorage undefined — AfterSalesCase has no storage column', async () => {
      const buildSpy = jest.spyOn(lineCopyUtil, 'buildLineData');
      prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase());

      await service.notifyMoment('case-1', 'RECEIVED', 'actor-1');

      const row = buildSpy.mock.calls[0][0];
      expect(row.deviceStorage).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------
  // แม่แบบใหม่ที่ dispatcher ยังไม่รองรับ (PENDING/RETRY_PENDING/DELAYED) ต้องนับเป็น SENT
  // ---------------------------------------------------------------------
  it.each(['PENDING', 'RETRY_PENDING', 'DELAYED'])(
    'treats dispatcher status %s as SENT (still in flight, not a failure)',
    async (status) => {
      prisma.afterSalesCase.findFirst.mockResolvedValue(makeCase());
      notifications.sendFromTemplate.mockResolvedValueOnce({ id: 'log-x', status });

      const result = await service.notifyMoment('case-1', 'RECEIVED', 'actor-1');

      expect(result).toEqual({ status: 'SENT' });
      expect(prisma.afterSalesEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ kind: 'LINE_SENT' }),
      });
    },
  );

  it('sanity: lineEventNote helper used by the fixtures above matches the literal note asserted in test (a)', () => {
    expect(lineEventNote('AFTER_SALES_RECEIVED', 'SENT')).toBe(
      '[AFTER_SALES_RECEIVED] รับเรื่องแล้ว · ส่งแล้ว',
    );
  });
});
