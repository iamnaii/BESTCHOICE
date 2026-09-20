import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import * as Sentry from '@sentry/nestjs';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

import { PrismaService } from '../../prisma/prisma.service';
import { DEVICE_RETURN_TODO_TAG } from './device-return-notify.service';
import { DeviceReturnPendingCron } from './device-return-pending.cron';

const DAY = 86_400_000;

function pendingRow(docNumber: string, ageDays: number, now: Date) {
  return {
    id: `id-${docNumber}`,
    docNumber,
    createdAt: new Date(now.getTime() - ageDays * DAY),
    contract: { contractNumber: `BCP-${docNumber.slice(-4)}` },
    customer: { name: 'สมชาย ใจดี' },
    receivingBranch: { name: 'ลาดพร้าว' },
  };
}

describe('DeviceReturnPendingCron', () => {
  let cron: DeviceReturnPendingCron;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = {
      deviceReturn: { findMany: jest.fn().mockResolvedValue([]) },
      todo: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'todo-x',
            ...data,
          })),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'sys-uid' }) },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [DeviceReturnPendingCron, { provide: PrismaService, useValue: prisma }],
    }).compile();
    cron = mod.get(DeviceReturnPendingCron);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('registers daily 09:20 Bangkok scheduling without starting a scheduler', () => {
    expect(Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, cron.tick)).toMatchObject({
      cronTime: '20 9 * * *',
      timeZone: 'Asia/Bangkok',
    });
  });

  it('includes exactly three elapsed days, excluding one millisecond younger', async () => {
    const now = new Date('2026-09-10T02:20:00Z');
    jest.useFakeTimers().setSystemTime(now);
    const younger = pendingRow('DR-younger', 3, now);
    younger.createdAt = new Date(younger.createdAt.getTime() + 1);
    prisma.deviceReturn.findMany.mockResolvedValue([pendingRow('DR-boundary', 3, now), younger]);
    expect(await cron.tick()).toMatchObject({ pending: 2, stale: 1, todosCreated: 1 });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { isSystemUser: true, deletedAt: null },
      select: { id: true },
    });
    expect(prisma.todo.create).toHaveBeenCalledTimes(1);
    expect(prisma.todo.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: expect.stringContaining('DR-boundary'),
      }),
    });
  });

  it('กลางเดือน: ใบค้างเกิน 3 วัน → Todo MEDIUM ต่อใบ (ใบ 1 วันไม่เตือน), ไม่มี Todo สิ้นเดือน', async () => {
    const now = new Date('2026-09-10T02:20:00.000Z'); // 09:20 BKK วันที่ 10
    jest.useFakeTimers().setSystemTime(now);
    prisma.deviceReturn.findMany.mockResolvedValue([
      pendingRow('DR-20260905-0001', 5, now),
      pendingRow('DR-20260909-0002', 1, now),
    ]);

    const result = await cron.tick();

    expect(prisma.deviceReturn.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'PENDING_CONFIRM', deletedAt: null } }),
    );
    expect(result).toEqual({
      pending: 2,
      stale: 1,
      todosCreated: 1,
      monthEnd: false,
      monthEndTodoCreated: false,
    });
    expect(prisma.todo.create).toHaveBeenCalledTimes(1);
    expect(prisma.todo.create).toHaveBeenCalledWith({
      data: {
        title: 'ใบรับเครื่องคืน DR-20260905-0001 รอ FINANCE ยืนยันเกิน 5 วัน (สัญญา BCP-0001)',
        description: expect.stringContaining('สมชาย ใจดี'),
        priority: 'MEDIUM',
        tags: [DEVICE_RETURN_TODO_TAG],
        createdById: 'sys-uid',
      },
    });
    expect(prisma.todo.findFirst).toHaveBeenCalledWith({
      where: {
        tags: { has: DEVICE_RETURN_TODO_TAG },
        title: { contains: 'DR-20260905-0001' },
        status: { not: 'DONE' },
        deletedAt: null,
      },
      select: { id: true },
    });
  });

  it('dedup: ใบเดิมมี Todo เปิดอยู่ → ไม่สร้างซ้ำ', async () => {
    const now = new Date('2026-09-10T02:20:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    prisma.deviceReturn.findMany.mockResolvedValue([pendingRow('DR-20260905-0001', 5, now)]);
    prisma.todo.findFirst.mockResolvedValue({ id: 'todo-old' });

    const result = await cron.tick();

    expect(prisma.todo.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ stale: 1, todosCreated: 0 });
  });

  it('2 วันสุดท้ายของเดือน BKK (29 ก.ย. — เดือน 30 วัน) + มีใบค้าง (แม้ยังไม่เกิน 3 วัน) → Todo HIGH หนึ่งใบ title มี "สิ้นเดือน 2026-09"; รันซ้ำไม่สร้างซ้ำ', async () => {
    const now = new Date('2026-09-29T02:20:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    prisma.deviceReturn.findMany.mockResolvedValue([pendingRow('DR-20260928-0009', 1, now)]);

    const first = await cron.tick();
    expect(first).toEqual({
      pending: 1,
      stale: 0,
      todosCreated: 0,
      monthEnd: true,
      monthEndTodoCreated: true,
    });
    expect(prisma.todo.create).toHaveBeenCalledWith({
      data: {
        title:
          'ใบรับเครื่องคืนค้างยืนยัน 1 ใบ ก่อนสิ้นเดือน 2026-09 — ยืนยันภายในเดือนนี้ ไม่งั้น JE/ใบลดหนี้ตกเดือนถัดไป',
        description: expect.stringContaining('DR-20260928-0009'),
        priority: 'HIGH',
        tags: [DEVICE_RETURN_TODO_TAG],
        createdById: 'sys-uid',
      },
    });
    expect(prisma.todo.findFirst).toHaveBeenCalledWith({
      where: {
        tags: { has: DEVICE_RETURN_TODO_TAG },
        title: { contains: 'สิ้นเดือน 2026-09' },
        status: { not: 'DONE' },
        deletedAt: null,
      },
      select: { id: true },
    });

    prisma.todo.findFirst.mockResolvedValue({ id: 'todo-month' });
    const second = await cron.tick();
    expect(second.monthEndTodoCreated).toBe(false);
    expect(prisma.todo.create).toHaveBeenCalledTimes(1);
  });

  it('ขอบเขตวันสิ้นเดือน: 28 ก.ย. ยังไม่ใช่ (30 − 2 = 28 < 29) → ไม่มี Todo HIGH; 30 ก.ย. ใช่', async () => {
    prisma.deviceReturn.findMany.mockResolvedValue([
      pendingRow('DR-20260927-0001', 1, new Date('2026-09-28T02:20:00.000Z')),
    ]);
    jest.useFakeTimers().setSystemTime(new Date('2026-09-28T02:20:00.000Z'));
    expect((await cron.tick()).monthEnd).toBe(false);
    jest.setSystemTime(new Date('2026-09-30T02:20:00.000Z'));
    expect((await cron.tick()).monthEnd).toBe(true);
  });

  it('ไม่มีใบค้าง → ไม่แตะ Todo/ผู้ใช้ SYSTEM เลย', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T02:20:00.000Z'));
    const result = await cron.tick();
    expect(result).toEqual({
      pending: 0,
      stale: 0,
      todosCreated: 0,
      monthEnd: true,
      monthEndTodoCreated: false,
    });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.todo.create).not.toHaveBeenCalled();
  });

  it('ไม่มีผู้ใช้ SYSTEM → ข้ามการสร้าง Todo (Sentry) ไม่ throw', async () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const now = new Date('2026-09-10T02:20:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    prisma.deviceReturn.findMany.mockResolvedValue([pendingRow('DR-20260905-0001', 5, now)]);
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(cron.tick()).resolves.toMatchObject({ stale: 1, todosCreated: 0 });
    expect(prisma.todo.create).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('SYSTEM user missing'),
      expect.objectContaining({
        level: 'warning',
        extra: { pending: 1, stale: 1, monthEnd: false },
      }),
    );
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('DB พัง → ไม่ throw ออกจาก tick (scheduler ต้องไม่ตาย)', async () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const error = new Error('db down');
    prisma.deviceReturn.findMany.mockRejectedValue(error);
    await expect(cron.tick()).resolves.toEqual({
      pending: 0,
      stale: 0,
      todosCreated: 0,
      monthEnd: false,
      monthEndTodoCreated: false,
    });
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { subsystem: 'device-return', cron: 'device-return-pending', scope: 'tick' },
    });
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });

  it('continues later rows and the month-end alert after an individual Todo fails', async () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const now = new Date('2026-09-29T02:20:00Z');
    jest.useFakeTimers().setSystemTime(now);
    prisma.deviceReturn.findMany.mockResolvedValue([
      pendingRow('DR-0001', 5, now),
      pendingRow('DR-0002', 4, now),
    ]);
    const error = new Error('row write failed');
    prisma.todo.create.mockRejectedValueOnce(error);
    expect(await cron.tick()).toMatchObject({
      stale: 2,
      todosCreated: 1,
      monthEndTodoCreated: true,
    });
    expect(prisma.todo.create).toHaveBeenCalledTimes(3);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { subsystem: 'device-return', cron: 'device-return-pending' },
      extra: { deviceReturnId: 'id-DR-0001', docNumber: 'DR-0001' },
    });
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('row write failed'));
  });

  it('reports month-end dedup failure without discarding successful stale reminders', async () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const now = new Date('2026-09-29T02:20:00Z');
    jest.useFakeTimers().setSystemTime(now);
    prisma.deviceReturn.findMany.mockResolvedValue([pendingRow('DR-0001', 5, now)]);
    const error = new Error('monthly lookup failed');
    prisma.todo.findFirst.mockResolvedValueOnce(null).mockRejectedValueOnce(error);
    expect(await cron.tick()).toMatchObject({
      todosCreated: 1,
      monthEnd: true,
      monthEndTodoCreated: false,
    });
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { subsystem: 'device-return', cron: 'device-return-pending', step: 'month-end' },
    });
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('monthly lookup failed'));
  });

  it.each([
    ['2026-09-28T16:59:59Z', false],
    ['2026-09-28T17:00:00Z', true],
    ['2026-01-29T17:00:00Z', true],
    ['2027-02-26T17:00:00Z', true],
    ['2028-02-26T17:00:00Z', false],
    ['2028-02-27T17:00:00Z', true],
    ['2026-12-31T17:00:00Z', false],
  ])('uses Bangkok calendar boundaries at %s', async (instant, monthEnd) => {
    const now = new Date(instant);
    jest.useFakeTimers().setSystemTime(now);
    prisma.deviceReturn.findMany.mockResolvedValue([pendingRow('DR-0001', 1, now)]);
    expect(await cron.tick()).toMatchObject({ monthEnd, monthEndTodoCreated: monthEnd });
  });
});
