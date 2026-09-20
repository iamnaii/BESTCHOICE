import { Test, TestingModule } from '@nestjs/testing';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn(), captureException: jest.fn() }));

import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DeviceReturnNotifyService, DEVICE_RETURN_TODO_TAG } from './device-return-notify.service';

function makeReturn(over: Record<string, unknown> = {}) {
  return {
    id: 'dr-1',
    docNumber: 'DR-20260920-0001',
    deletedAt: null,
    status: 'PENDING_CONFIRM',
    returnKind: 'VOLUNTARY',
    conditionGrade: 'B',
    deviceReceivedAt: new Date('2026-09-20T03:00:00.000Z'),
    receivingBranch: { name: 'ลาดพร้าว' },
    product: { brand: 'Apple', model: 'iPhone 14', storage: '128GB' },
    contract: { contractNumber: 'BCP2609-00042' },
    customer: {
      id: 'cust-1',
      name: 'สมชาย ใจดี',
      lineIdFinance: null,
      lineLinks: [{ lineUserId: 'U-link' }],
    },
    ...over,
  };
}

describe('DeviceReturnNotifyService', () => {
  let service: DeviceReturnNotifyService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let notifications: any;

  beforeEach(async () => {
    prisma = {
      deviceReturn: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      todo: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'todo-1' }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'sys-uid' }) },
    };
    notifications = {
      sendFromTemplate: jest.fn().mockResolvedValue({ id: 'log-1', status: 'SENT' }),
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceReturnNotifyService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = mod.get(DeviceReturnNotifyService);
  });

  it('SENT: ส่งผ่านแม่แบบ DEVICE_RETURNED ไป lineLinks ก่อน lineIdFinance พร้อมตัวแปรครบ (ไม่มีราคาประเมิน ไม่มี fallbackPhone) แล้วบันทึกผลบนใบ', async () => {
    prisma.deviceReturn.findUnique.mockResolvedValue(
      makeReturn({ customer: { ...makeReturn().customer, lineIdFinance: 'U-old' } }),
    );

    await service.notify('dr-1', 'DEVICE_RETURNED');

    expect(notifications.sendFromTemplate).toHaveBeenCalledTimes(1);
    const [eventType, data, recipient, options] = notifications.sendFromTemplate.mock.calls[0];
    expect(eventType).toBe('DEVICE_RETURNED');
    expect(recipient).toBe('U-link');
    expect(options).toEqual({ customerId: 'cust-1', relatedId: 'dr-1' });
    expect(data).toEqual({
      customerName: 'สมชาย ใจดี',
      docNumber: 'DR-20260920-0001',
      contractNumber: 'BCP2609-00042',
      deviceName: 'Apple iPhone 14 128GB',
      branchName: 'ลาดพร้าว',
      receivedDate: '20/09/2026',
      grade: 'B',
      returnKindLabel: 'คืนเครื่องเอง',
    });
    expect(JSON.stringify(data)).not.toMatch(/appraisal|ราคา/);
    expect(prisma.deviceReturn.update).toHaveBeenCalledWith({
      where: { id: 'dr-1' },
      data: {
        lineNotifyStatus: 'SENT',
        lineNotifiedAt: expect.any(Date),
        lineNotificationId: 'log-1',
      },
    });
    expect(prisma.todo.create).not.toHaveBeenCalled();
  });

  it('REPOSSESSION → returnKindLabel "ยึดคืนหลังบอกเลิกสัญญา"; ใช้ lineIdFinance เมื่อไม่มี lineLinks', async () => {
    prisma.deviceReturn.findUnique.mockResolvedValue(
      makeReturn({
        returnKind: 'REPOSSESSION',
        customer: { id: 'cust-1', name: 'x', lineIdFinance: 'U-fin', lineLinks: [] },
      }),
    );
    await service.notify('dr-1', 'DEVICE_RETURN_CANCELED');
    const [eventType, data, recipient] = notifications.sendFromTemplate.mock.calls[0];
    expect(eventType).toBe('DEVICE_RETURN_CANCELED');
    expect(recipient).toBe('U-fin');
    expect(data.returnKindLabel).toBe('ยึดคืนหลังบอกเลิกสัญญา');
  });

  it('FAILED: dispatcher คืนสถานะไม่ใช่ SENT → บันทึก FAILED + id ของ log (dispatcher retry เอง)', async () => {
    prisma.deviceReturn.findUnique.mockResolvedValue(makeReturn());
    notifications.sendFromTemplate.mockResolvedValueOnce({ id: 'log-2', status: 'FAILED' });
    await service.notify('dr-1', 'DEVICE_RETURNED');
    expect(prisma.deviceReturn.update).toHaveBeenCalledWith({
      where: { id: 'dr-1' },
      data: {
        lineNotifyStatus: 'FAILED',
        lineNotifiedAt: expect.any(Date),
        lineNotificationId: 'log-2',
      },
    });
  });

  it('FAILED: sendFromTemplate throw (เช่น ไม่มีแม่แบบ) → บันทึก FAILED, ไม่ throw ออก', async () => {
    prisma.deviceReturn.findUnique.mockResolvedValue(makeReturn());
    notifications.sendFromTemplate.mockRejectedValueOnce(
      new Error('Notification template not found'),
    );
    await expect(service.notify('dr-1', 'DEVICE_RETURNED')).resolves.toBeUndefined();
    expect(prisma.deviceReturn.update).toHaveBeenCalledWith({
      where: { id: 'dr-1' },
      data: {
        lineNotifyStatus: 'FAILED',
        lineNotifiedAt: expect.any(Date),
        lineNotificationId: null,
      },
    });
  });

  it('NO_LINE: ไม่มีทั้ง lineLinks และ lineIdFinance → ไม่ส่ง, บันทึก NO_LINE, สร้าง Todo MEDIUM tag device-return', async () => {
    prisma.deviceReturn.findUnique.mockResolvedValue(
      makeReturn({
        customer: { id: 'cust-1', name: 'สมชาย ใจดี', lineIdFinance: null, lineLinks: [] },
      }),
    );
    await service.notify('dr-1', 'DEVICE_RETURNED');
    expect(notifications.sendFromTemplate).not.toHaveBeenCalled();
    expect(prisma.deviceReturn.update).toHaveBeenCalledWith({
      where: { id: 'dr-1' },
      data: {
        lineNotifyStatus: 'NO_LINE',
        lineNotifiedAt: expect.any(Date),
        lineNotificationId: null,
      },
    });
    expect(prisma.todo.findFirst).toHaveBeenCalledWith({
      where: {
        tags: { has: DEVICE_RETURN_TODO_TAG },
        title: { contains: 'DR-20260920-0001' },
        status: { not: 'DONE' },
        deletedAt: null,
      },
      select: { id: true },
    });
    expect(prisma.todo.create).toHaveBeenCalledWith({
      data: {
        title: 'แจ้งลูกค้าไม่ได้ ไม่มีไลน์ผูก — ใบรับเครื่องคืน DR-20260920-0001 (สมชาย ใจดี)',
        description: expect.stringContaining('BCP2609-00042'),
        priority: 'MEDIUM',
        tags: [DEVICE_RETURN_TODO_TAG],
        createdById: 'sys-uid',
      },
    });
  });

  it('NO_LINE dedup: มี Todo เปิดอยู่แล้วของใบเดียวกัน → ไม่สร้างซ้ำ', async () => {
    prisma.deviceReturn.findUnique.mockResolvedValue(
      makeReturn({ customer: { id: 'cust-1', name: 'x', lineIdFinance: null, lineLinks: [] } }),
    );
    prisma.todo.findFirst.mockResolvedValueOnce({ id: 'todo-old' });
    await service.notify('dr-1', 'DEVICE_RETURNED');
    expect(prisma.todo.create).not.toHaveBeenCalled();
  });

  it.each(['BLOCKED', 'DELAYED'])('records %s as FAILED without SMS fallback', async (status) => {
    prisma.deviceReturn.findUnique.mockResolvedValue(makeReturn());
    notifications.sendFromTemplate.mockResolvedValueOnce({ id: null, status });
    await service.notify('dr-1', 'DEVICE_RETURNED');
    expect(prisma.deviceReturn.update).toHaveBeenCalledWith({
      where: { id: 'dr-1' },
      data: {
        lineNotifyStatus: 'FAILED',
        lineNotifiedAt: expect.any(Date),
        lineNotificationId: null,
      },
    });
    expect(notifications.sendFromTemplate.mock.calls[0][3]).not.toHaveProperty('fallbackPhone');
  });

  it('loads only active FINANCE links and formats the Bangkok calendar date', async () => {
    prisma.deviceReturn.findUnique.mockResolvedValue(
      makeReturn({ deviceReceivedAt: new Date('2026-09-19T18:00:00Z') }),
    );
    await service.notify('dr-1', 'DEVICE_RETURNED');
    expect(
      prisma.deviceReturn.findUnique.mock.calls[0][0].include.customer.select.lineLinks,
    ).toEqual({
      where: { channel: 'FINANCE', unlinkedAt: null, deletedAt: null },
      select: { lineUserId: true },
      take: 1,
    });
    expect(notifications.sendFromTemplate.mock.calls[0][1].receivedDate).toBe('20/09/2026');
  });

  it('skips deleted returns', async () => {
    prisma.deviceReturn.findUnique.mockResolvedValue(makeReturn({ deletedAt: new Date() }));
    await expect(service.notify('dr-1', 'DEVICE_RETURNED')).resolves.toBeUndefined();
    expect(notifications.sendFromTemplate).not.toHaveBeenCalled();
    expect(prisma.deviceReturn.update).not.toHaveBeenCalled();
  });

  it.each(['load', 'record', 'todo'])('does not throw when %s fails', async (stage) => {
    prisma.deviceReturn.findUnique.mockResolvedValue(
      makeReturn({ customer: { id: 'cust-1', name: 'x', lineIdFinance: null, lineLinks: [] } }),
    );
    if (stage === 'load')
      prisma.deviceReturn.findUnique.mockRejectedValueOnce(new Error('load failed'));
    if (stage === 'record')
      prisma.deviceReturn.update.mockRejectedValueOnce(new Error('record failed'));
    if (stage === 'todo') prisma.todo.create.mockRejectedValueOnce(new Error('todo failed'));
    await expect(service.notify('dr-1', 'DEVICE_RETURNED')).resolves.toBeUndefined();
  });

  it('records NO_LINE even when no system user can create the Todo', async () => {
    prisma.deviceReturn.findUnique.mockResolvedValue(
      makeReturn({ customer: { id: 'cust-1', name: 'x', lineIdFinance: null, lineLinks: [] } }),
    );
    prisma.user.findFirst.mockResolvedValueOnce(null);
    await expect(service.notify('dr-1', 'DEVICE_RETURNED')).resolves.toBeUndefined();
    expect(prisma.deviceReturn.update).toHaveBeenCalled();
    expect(prisma.todo.create).not.toHaveBeenCalled();
  });

  it('ใบไม่พบ/ถูกลบ → ไม่ทำอะไร ไม่ throw', async () => {
    prisma.deviceReturn.findUnique.mockResolvedValue(null);
    await expect(service.notify('missing', 'DEVICE_RETURNED')).resolves.toBeUndefined();
    expect(notifications.sendFromTemplate).not.toHaveBeenCalled();
    expect(prisma.deviceReturn.update).not.toHaveBeenCalled();
  });
});
