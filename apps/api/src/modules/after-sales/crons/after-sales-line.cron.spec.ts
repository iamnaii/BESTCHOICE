import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import * as Sentry from '@sentry/nestjs';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

import { PrismaService } from '../../../prisma/prisma.service';
import { AfterSalesLineService } from '../services/after-sales-line.service';
import { AfterSalesLineCron } from './after-sales-line.cron';

const DAY = 86_400_000;
const NOW = new Date('2026-09-25T03:00:00.000Z'); // 10:00 Asia/Bangkok

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Row builder satisfying the `READY_SELECT` shape (RECONCILE_SELECT + receivedAt/approvedAt +
 * repairTicket.sentToRepairAt/repairedAt) — default = a REPAIR case sitting at READY_FOR_PICKUP
 * with no drift, so `reconcileStage` is a no-op unless a test overrides `repairTicket.status`. */
function readyRow(over: Partial<Row> = {}): Row {
  return {
    id: 'case-1',
    deletedAt: null,
    stage: 'READY_FOR_PICKUP',
    outcome: 'REPAIR',
    cancelledAt: null,
    closedAt: null,
    replacementContractId: null,
    receivedAt: new Date('2026-09-01T00:00:00.000Z'),
    approvedAt: null as Date | null,
    repairTicket: {
      status: 'READY_FOR_PICKUP',
      deletedAt: null,
      returnedToCustomerAt: null as Date | null,
      sentToRepairAt: null as Date | null,
      repairedAt: null as Date | null,
    } as Row | null,
    exchangeRequest: null,
    ...over,
  };
}

/** Row for the PRICED_EXCHANGE / CLOSED query (select `{ id: true }` only — extra fields below
 * exist purely so the in-memory `matches()` filter can simulate the real DB `where` clause). */
function closedRow(over: Partial<Row> = {}): Row {
  return {
    id: 'closed-1',
    deletedAt: null,
    outcome: 'PRICED_EXCHANGE',
    stage: 'CLOSED',
    cancelledAt: null,
    closedAt: new Date(NOW.getTime() - DAY),
    ...over,
  };
}

/** Simulates a Prisma `where` filter over an in-memory row array — close enough to real
 * behaviour to exercise the cron's actual query args (equality, `null`, and `{ gte }`). */
function matchesWhere(row: Row, where: Row): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (cond === null) {
      if (row[key] !== null) return false;
      continue;
    }
    if (typeof cond === 'object' && cond !== null && 'gte' in cond) {
      const gte = (cond as { gte: Date }).gte;
      if (!(row[key] instanceof Date) || row[key].getTime() < gte.getTime()) return false;
      continue;
    }
    if (row[key] !== cond) return false;
  }
  return true;
}

function makeFindMany(rows: Row[]) {
  return jest.fn(async ({ where }: { where: Row }) => rows.filter((r) => matchesWhere(r, where)));
}

describe('AfterSalesLineCron', () => {
  let cron: AfterSalesLineCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let line: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = {
      afterSalesCase: {
        findMany: makeFindMany([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    line = {
      hasLineAttempt: jest.fn().mockResolvedValue(false),
      notifyMoment: jest.fn().mockResolvedValue({ status: 'SENT' }),
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        AfterSalesLineCron,
        { provide: PrismaService, useValue: prisma },
        { provide: AfterSalesLineService, useValue: line },
      ],
    }).compile();
    cron = mod.get(AfterSalesLineCron);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers daily 10:00 Bangkok scheduling without starting a scheduler', () => {
    expect(Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, cron.run)).toMatchObject({
      cronTime: '0 10 * * *',
      timeZone: 'Asia/Bangkok',
    });
  });

  // (a) — 7-day pickup reminder: overdue REPAIR/SAME_MODEL cases fire once each, a 6-day case
  // does not, and a case that already has the LINE event does not fire a second time.
  it('reminds READY_FOR_PICKUP cases at/after the configured day threshold, once per case', async () => {
    const repairOverdue = readyRow({
      id: 'case-repair-8d',
      repairTicket: {
        status: 'READY_FOR_PICKUP',
        deletedAt: null,
        returnedToCustomerAt: null,
        sentToRepairAt: new Date(NOW.getTime() - 10 * DAY),
        repairedAt: new Date(NOW.getTime() - 8 * DAY),
      },
    });
    const sameModelOverdue = readyRow({
      id: 'case-same-8d',
      outcome: 'SAME_MODEL_EXCHANGE',
      replacementContractId: 'contract-x',
      repairTicket: null,
      approvedAt: new Date(NOW.getTime() - 8 * DAY),
    });
    const repairYoung = readyRow({
      id: 'case-repair-6d',
      repairTicket: {
        status: 'READY_FOR_PICKUP',
        deletedAt: null,
        returnedToCustomerAt: null,
        sentToRepairAt: new Date(NOW.getTime() - 10 * DAY),
        repairedAt: new Date(NOW.getTime() - 6 * DAY),
      },
    });
    const alreadyNotified = readyRow({
      id: 'case-dup',
      repairTicket: {
        status: 'READY_FOR_PICKUP',
        deletedAt: null,
        returnedToCustomerAt: null,
        sentToRepairAt: new Date(NOW.getTime() - 10 * DAY),
        repairedAt: new Date(NOW.getTime() - 9 * DAY),
      },
    });
    prisma.afterSalesCase.findMany = makeFindMany([
      repairOverdue,
      sameModelOverdue,
      repairYoung,
      alreadyNotified,
    ]);
    line.hasLineAttempt.mockImplementation(async (caseId: string) => caseId === 'case-dup');

    const result = await cron.tick(NOW);

    expect(prisma.systemConfig.findFirst).toHaveBeenCalledWith({
      where: { key: 'after_sales_line_enabled', deletedAt: null },
      select: { value: true },
    });
    expect(prisma.systemConfig.findFirst).toHaveBeenCalledWith({
      where: { key: 'after_sales_pickup_reminder_days', deletedAt: null },
      select: { value: true },
    });
    expect(line.notifyMoment).toHaveBeenCalledTimes(2);
    expect(line.notifyMoment).toHaveBeenCalledWith('case-repair-8d', 'PICKUP_REMINDER', null);
    expect(line.notifyMoment).toHaveBeenCalledWith('case-same-8d', 'PICKUP_REMINDER', null);
    expect(line.hasLineAttempt).toHaveBeenCalledWith('case-dup', 'AFTER_SALES_PICKUP_REMINDER');
    expect(result).toEqual({ reminded: 2, closedNotified: 0, skipped: 2, failed: 0 });
  });

  // (b) — stored stage READY_FOR_PICKUP but the repair ticket was closed outside the after-sales
  // proxy: reconcileStage must run BEFORE the reminder decision, same as list/summary.
  it('does not remind a case whose reconciled stage is no longer READY_FOR_PICKUP', async () => {
    const drifted = readyRow({
      id: 'case-drifted',
      repairTicket: {
        status: 'CLOSED',
        deletedAt: null,
        returnedToCustomerAt: new Date(NOW.getTime() - DAY),
        sentToRepairAt: new Date(NOW.getTime() - 20 * DAY),
        repairedAt: new Date(NOW.getTime() - 15 * DAY),
      },
    });
    prisma.afterSalesCase.findMany = makeFindMany([drifted]);

    const result = await cron.tick(NOW);

    expect(prisma.afterSalesCase.updateMany).toHaveBeenCalledWith({
      where: { id: 'case-drifted', stage: 'READY_FOR_PICKUP' },
      data: { stage: 'CLOSED', closedAt: new Date(NOW.getTime() - DAY) },
    });
    expect(line.hasLineAttempt).not.toHaveBeenCalled();
    expect(line.notifyMoment).not.toHaveBeenCalled();
    expect(result).toEqual({ reminded: 0, closedNotified: 0, skipped: 1, failed: 0 });
  });

  // (c) — moment 3 for a PRICED_EXCHANGE case closed by the contract engine on activation:
  // sends once, skips a case that already has [AFTER_SALES_CLOSED], and the 3-day window is
  // enforced by the query itself (closedAt >= now - 3d).
  it('notifies CLOSED for a PRICED_EXCHANGE case within the 3-day window, dedup by hasLineAttempt', async () => {
    const freshClosed = closedRow({ id: 'closed-fresh', closedAt: new Date(NOW.getTime() - DAY) });
    const dupClosed = closedRow({ id: 'closed-dup', closedAt: new Date(NOW.getTime() - 2 * DAY) });
    const oldClosed = closedRow({ id: 'closed-old', closedAt: new Date(NOW.getTime() - 4 * DAY) });
    prisma.afterSalesCase.findMany = makeFindMany([freshClosed, dupClosed, oldClosed]);
    line.hasLineAttempt.mockImplementation(async (caseId: string) => caseId === 'closed-dup');

    const result = await cron.tick(NOW);

    const closedCall = prisma.afterSalesCase.findMany.mock.calls.find(
      ([args]: [Row]) => args.where.outcome === 'PRICED_EXCHANGE',
    );
    expect(closedCall[0]).toEqual({
      where: {
        deletedAt: null,
        outcome: 'PRICED_EXCHANGE',
        stage: 'CLOSED',
        cancelledAt: null,
        closedAt: { gte: new Date(NOW.getTime() - 3 * DAY) },
      },
      select: { id: true },
    });
    expect(line.hasLineAttempt).toHaveBeenCalledWith('closed-fresh', 'AFTER_SALES_CLOSED');
    expect(line.notifyMoment).toHaveBeenCalledTimes(1);
    expect(line.notifyMoment).toHaveBeenCalledWith('closed-fresh', 'CLOSED', null);
    expect(line.notifyMoment).not.toHaveBeenCalledWith('closed-dup', 'CLOSED', null);
    expect(line.notifyMoment).not.toHaveBeenCalledWith('closed-old', 'CLOSED', null);
    // oldClosed is excluded by the DB-side `gte` filter itself — it never enters the loop, so it
    // contributes to neither `closedNotified` nor `skipped`.
    expect(result).toEqual({ reminded: 0, closedNotified: 1, skipped: 1, failed: 0 });
  });

  // final fix M-5 — เพดานอายุ 30 วัน: รอบแรกหลัง deploy ต้องไม่เตือนเคสที่ค้างนานมาก (น่าจะส่งมอบ
  // ไปแล้วแต่ไม่ได้บันทึก) — นับเป็น skipped ไม่ถามประวัติ ไม่ส่ง
  it('does not remind a READY_FOR_PICKUP case older than PICKUP_REMINDER_MAX_AGE_DAYS (31 days → skipped)', async () => {
    const stale = readyRow({
      id: 'case-31d',
      receivedAt: new Date(NOW.getTime() - 40 * DAY),
      repairTicket: {
        status: 'READY_FOR_PICKUP',
        deletedAt: null,
        returnedToCustomerAt: null,
        sentToRepairAt: new Date(NOW.getTime() - 35 * DAY),
        repairedAt: new Date(NOW.getTime() - 31 * DAY),
      },
    });
    prisma.afterSalesCase.findMany = makeFindMany([stale]);

    const result = await cron.tick(NOW);

    expect(line.hasLineAttempt).not.toHaveBeenCalled();
    expect(line.notifyMoment).not.toHaveBeenCalled();
    expect(result).toEqual({ reminded: 0, closedNotified: 0, skipped: 1, failed: 0 });
  });

  // (d) — kill switch OFF: zeroed counters, no case query, no LINE calls at all.
  it('does nothing when after_sales_line_enabled is OFF', async () => {
    prisma.systemConfig.findFirst.mockImplementation(
      async ({ where }: { where: { key: string } }) =>
        where.key === 'after_sales_line_enabled' ? { value: 'false' } : null,
    );

    const result = await cron.tick(NOW);

    expect(prisma.afterSalesCase.findMany).not.toHaveBeenCalled();
    expect(line.hasLineAttempt).not.toHaveBeenCalled();
    expect(line.notifyMoment).not.toHaveBeenCalled();
    expect(result).toEqual({ reminded: 0, closedNotified: 0, skipped: 0, failed: 0 });
  });

  // (e) — per-row failure keeps going; outer failure (e.g. the first findMany rejecting) never
  // throws out of tick() and reports via Sentry with the tags the brief specifies.
  it('counts a per-row notifyMoment failure without stopping the rest of the batch', async () => {
    const throwsRow = readyRow({
      id: 'case-throws',
      repairTicket: {
        status: 'READY_FOR_PICKUP',
        deletedAt: null,
        returnedToCustomerAt: null,
        sentToRepairAt: new Date(NOW.getTime() - 10 * DAY),
        repairedAt: new Date(NOW.getTime() - 8 * DAY),
      },
    });
    const okRow = readyRow({
      id: 'case-ok',
      repairTicket: {
        status: 'READY_FOR_PICKUP',
        deletedAt: null,
        returnedToCustomerAt: null,
        sentToRepairAt: new Date(NOW.getTime() - 10 * DAY),
        repairedAt: new Date(NOW.getTime() - 8 * DAY),
      },
    });
    prisma.afterSalesCase.findMany = makeFindMany([throwsRow, okRow]);
    const boom = new Error('boom');
    line.notifyMoment.mockImplementation(async (caseId: string) => {
      if (caseId === 'case-throws') throw boom;
      return { status: 'SENT' };
    });

    const result = await cron.tick(NOW);

    expect(line.notifyMoment).toHaveBeenCalledTimes(2);
    expect(Sentry.captureException).toHaveBeenCalledWith(boom, {
      tags: { subsystem: 'after-sales-line', cron: 'after-sales-line', step: 'reminder' },
      extra: { caseId: 'case-throws' },
    });
    expect(result).toEqual({ reminded: 1, closedNotified: 0, skipped: 0, failed: 1 });
  });

  it('never throws when the case query itself fails, and reports via Sentry with the tick tags', async () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const dbError = new Error('db down');
    prisma.afterSalesCase.findMany.mockRejectedValue(dbError);

    await expect(cron.tick(NOW)).resolves.toEqual({
      reminded: 0,
      closedNotified: 0,
      skipped: 0,
      failed: 0,
    });
    expect(line.notifyMoment).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      dbError,
      expect.objectContaining({
        tags: expect.objectContaining({
          subsystem: 'after-sales-line',
          cron: 'after-sales-line',
        }),
      }),
    );
    expect(errorLog).toHaveBeenCalledWith('after-sales line cron failed', expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// final fix I-1 — dedup นับ "ทุกความพยายามที่ถูกบันทึก" ไม่ใช่เฉพาะ LINE_SENT: ใช้ AfterSalesLineService
// ของจริงบน prisma ปลอมในหน่วยความจำ (events array — create push / findFirst กรองตาม where จริง)
// แล้วเดิน cron สองรอบ (สองวันติดกัน) — รอบสองต้องไม่เขียนแถวซ้ำ/ไม่ส่งซ้ำ
// ---------------------------------------------------------------------------
describe('AfterSalesLineCron + AfterSalesLineService จริง — dedup สองรอบ (final fix I-1)', () => {
  const CASE_ID = 'case-real-1';

  /** แถว CASE_FOR_LINE_SELECT ที่ notifyMoment โหลด — READY_FOR_PICKUP ซ่อมเสร็จมาแล้ว 8 วัน */
  function lineCase(lineIdShop: string | null): Row {
    return {
      id: CASE_ID,
      caseNumber: 'AS-20260901-0001',
      outcome: 'REPAIR',
      symptom: 'จอแตก',
      deviceBrand: 'Apple',
      deviceModel: 'iPhone 13',
      deviceImei: '356938035643809',
      warrantySnapshot: null,
      replacementProductId: null,
      replacementContractId: null,
      stage: 'READY_FOR_PICKUP',
      receivedAt: new Date(NOW.getTime() - 12 * DAY),
      approvedAt: null,
      customer: { id: 'cust-1', lineIdShop },
      branch: { name: 'ลาดพร้าว' },
      repairTicket: {
        payer: 'SHOP',
        estimatedCost: null,
        actualCost: null,
        sentToRepairAt: new Date(NOW.getTime() - 10 * DAY),
        repairedAt: new Date(NOW.getTime() - 8 * DAY),
      },
      exchangeRequest: null,
    };
  }

  /** where ของ afterSalesEvent.findFirst — equality ทุก key ยกเว้น note ที่เป็น { startsWith } */
  function eventMatches(e: Row, where: Row): boolean {
    for (const [key, cond] of Object.entries(where)) {
      if (key === 'note') {
        if (!String(e.note).startsWith((cond as { startsWith: string }).startsWith)) return false;
        continue;
      }
      if (e[key] !== cond) return false;
    }
    return true;
  }

  function setup(lineIdShop: string | null) {
    const events: Row[] = [];
    const readyRowReal = readyRow({
      id: CASE_ID,
      receivedAt: new Date(NOW.getTime() - 12 * DAY),
      repairTicket: {
        status: 'READY_FOR_PICKUP',
        deletedAt: null,
        returnedToCustomerAt: null,
        sentToRepairAt: new Date(NOW.getTime() - 10 * DAY),
        repairedAt: new Date(NOW.getTime() - 8 * DAY),
      },
    });
    const prisma = {
      systemConfig: { findFirst: jest.fn().mockResolvedValue(null) },
      afterSalesCase: {
        findMany: makeFindMany([readyRowReal]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(async () => lineCase(lineIdShop)),
      },
      afterSalesEvent: {
        create: jest.fn(async ({ data }: { data: Row }) => {
          events.push({ ...data });
          return data;
        }),
        findFirst: jest.fn(async ({ where }: { where: Row }) =>
          events.some((e) => eventMatches(e, where)) ? { id: 'evt-hit' } : null,
        ),
      },
      product: { findFirst: jest.fn() },
      contract: { findFirst: jest.fn() },
    };
    const notifications = { sendFromTemplate: jest.fn() };
    const integrationConfig = { getValue: jest.fn().mockResolvedValue(undefined) };
    const realLine = new AfterSalesLineService(
      prisma as never,
      notifications as never,
      integrationConfig as never,
    );
    const realCron = new AfterSalesLineCron(prisma as never, realLine);
    return { events, notifications, realCron };
  }

  beforeEach(() => jest.clearAllMocks());

  it('ลูกค้าไม่ผูก LINE: รอบ 1 เขียน LINE_SKIPPED_NO_LINK หนึ่งแถว · รอบ 2 ยังคงหนึ่งแถว (ไม่งอกทุกวัน)', async () => {
    const { events, notifications, realCron } = setup(null);

    const first = await realCron.tick(NOW);
    const noLinkAfterFirst = events.filter((e) => e.kind === 'LINE_SKIPPED_NO_LINK');
    expect(noLinkAfterFirst).toHaveLength(1);
    expect(noLinkAfterFirst[0].note).toMatch(/^\[AFTER_SALES_PICKUP_REMINDER\]/);
    expect(first).toEqual({ reminded: 0, closedNotified: 0, skipped: 1, failed: 0 });

    const second = await realCron.tick(new Date(NOW.getTime() + DAY));
    expect(events.filter((e) => e.kind === 'LINE_SKIPPED_NO_LINK')).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(second).toEqual({ reminded: 0, closedNotified: 0, skipped: 1, failed: 0 });
    expect(notifications.sendFromTemplate).not.toHaveBeenCalled();
  });

  it('ลูกค้าผูก LINE แต่ dispatcher คืน FAILED: รอบ 2 ไม่เรียก sendFromTemplate ซ้ำ (คิว retry ของ dispatcher ส่งซ้ำเอง)', async () => {
    const { events, notifications, realCron } = setup('Ushop-real-1');
    notifications.sendFromTemplate.mockResolvedValue({ id: 'n1', status: 'FAILED' });

    await realCron.tick(NOW);
    expect(notifications.sendFromTemplate).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);

    const second = await realCron.tick(new Date(NOW.getTime() + DAY));
    expect(notifications.sendFromTemplate).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(second).toEqual({ reminded: 0, closedNotified: 0, skipped: 1, failed: 0 });
  });
});
