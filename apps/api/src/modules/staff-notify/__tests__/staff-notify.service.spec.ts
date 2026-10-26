import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { StaffNotifyService } from '../staff-notify.service';
import type { StaffNotifyRule } from '../staff-event-catalog';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const NOW = new Date('2026-10-26T03:00:00.000Z'); // 26 ต.ค. 2569 10:00 ไทย
const user = (over: Record<string, unknown>) => ({ id: 'u', name: 'คน', role: 'OWNER', branchId: null, lineStaffUserId: 'U', phone: '0812345678', ...over });
const RULE: StaffNotifyRule = { enabled: true, roles: ['OWNER', 'ACCOUNTANT'], branchScoped: false, includeGroup: false };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any, rules: any, lineConfig: any, notifications: any, lineOa: any;
let service: StaffNotifyService;
let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.FRONTEND_URL = 'https://app.test/';
  prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([
        user({ id: 'a', name: 'A', role: 'OWNER', lineStaffUserId: 'U1' }),
        user({ id: 'b', name: 'B', role: 'ACCOUNTANT', lineStaffUserId: 'U2' }),
      ]),
      findUnique: jest.fn().mockResolvedValue(user({ id: 'a', name: 'A', lineStaffUserId: 'U1' })),
    },
    notificationLog: {
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  rules = { getRule: jest.fn().mockResolvedValue(RULE), getMonthlyCap: jest.fn().mockResolvedValue(280) };
  lineConfig = { isConfigured: jest.fn().mockResolvedValue(true), groupTargets: jest.fn().mockResolvedValue([]) };
  notifications = { send: jest.fn().mockResolvedValue({ id: 'n1', status: 'SENT' }) };
  lineOa = { sendFlexMessage: jest.fn().mockResolvedValue(undefined) };
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  service = new StaffNotifyService(prisma, rules, lineConfig, notifications, lineOa);
});
afterEach(() => warn.mockRestore());

describe('StaffNotifyService.notify', () => {
  it('S1 sends to active users of the rule roles via line-staff with the formatted message and relatedId', async () => {
    const res = await service.notify('stock.low', { title: 'หัวข้อ', lines: ['บรรทัด 1'], link: '/x', dedupeKey: 'rp-1' }, NOW);
    expect(res).toEqual({ recipients: 2, sent: 2, deduped: 0, failed: 0, quotaSkipped: 0 });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ isActive: true, deletedAt: null, isSystemUser: false, lineStaffUserId: { not: null }, role: { in: ['OWNER', 'ACCOUNTANT'] } }),
    }));
    expect(notifications.send).toHaveBeenCalledWith({
      channel: 'LINE', channelKey: 'line-staff', recipient: 'U1',
      message: '📣 BESTCHOICE · หัวข้อ\nบรรทัด 1\n🔗 https://app.test/x',
      relatedId: 'staff:stock.low:rp-1', category: 'STAFF',
    });
    expect(notifications.send).toHaveBeenCalledTimes(2);
  });

  it('S2 branchScoped: branch roles only for their own branch; central roles always', async () => {
    rules.getRule.mockResolvedValue({ ...RULE, roles: ['OWNER', 'BRANCH_MANAGER'], branchScoped: true });
    prisma.user.findMany.mockResolvedValue([
      user({ id: 'a', role: 'OWNER', lineStaffUserId: 'U1' }),
      user({ id: 'b', role: 'BRANCH_MANAGER', branchId: 'br-1', lineStaffUserId: 'U2' }),
      user({ id: 'c', role: 'BRANCH_MANAGER', branchId: 'br-2', lineStaffUserId: 'U3' }),
    ]);
    await service.notify('stock.low', { title: 't', lines: [], branchId: 'br-1' }, NOW);
    expect(notifications.send.mock.calls.map((c: [{ recipient: string }]) => c[0].recipient)).toEqual(['U1', 'U2']);
    notifications.send.mockClear();
    await service.notify('stock.low', { title: 't', lines: [] }, NOW);
    expect(notifications.send).toHaveBeenCalledTimes(3);
  });

  it('S3 extra recipients and the LINE group are added; missing lineStaffUserId filtered; duplicates sent once', async () => {
    rules.getRule.mockResolvedValue({ ...RULE, roles: ['OWNER'], includeGroup: true });
    lineConfig.groupTargets.mockResolvedValue(['G1', 'U1']);
    prisma.user.findMany.mockResolvedValue([
      user({ id: 'a', role: 'OWNER', lineStaffUserId: 'U1' }),
      user({ id: 'acc-1', role: 'ACCOUNTANT', lineStaffUserId: 'U9' }),
    ]);
    const res = await service.notify('stock.low', { title: 't', lines: [], extraRecipientUserIds: ['acc-1', 'ghost'] }, NOW);
    expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({ OR: [{ role: { in: ['OWNER'] } }, { id: { in: ['acc-1', 'ghost'] } }] });
    expect(notifications.send.mock.calls.map((c: [{ recipient: string }]) => c[0].recipient).sort()).toEqual(['G1', 'U1', 'U9']);
    expect(res.recipients).toBe(3);
  });

  it('S4 disabled → skipped without touching prisma; not configured (token only) → skipped and warned once per day', async () => {
    rules.getRule.mockResolvedValue({ ...RULE, enabled: false });
    expect(await service.notify('stock.low', { title: 't', lines: [] }, NOW)).toEqual({ skipped: 'disabled', recipients: 0, sent: 0, deduped: 0, failed: 0, quotaSkipped: 0 });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    rules.getRule.mockResolvedValue(RULE);
    lineConfig.isConfigured.mockResolvedValue(false);
    for (let i = 0; i < 3; i++) expect((await service.notify('stock.low', { title: 't', lines: [] }, NOW)).skipped).toBe('not_configured');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('S5 dedupe via NotificationLog within the window; no dedupeKey → no log query', async () => {
    prisma.notificationLog.findFirst.mockResolvedValue({ id: 'old' });
    const res = await service.notify('stock.low', { title: 't', lines: [], dedupeKey: 'rp-1' }, NOW);
    expect(res).toMatchObject({ deduped: 2, sent: 0 });
    expect(prisma.notificationLog.findFirst).toHaveBeenCalledWith({
      where: { channelKey: 'line-staff', recipient: 'U1', relatedId: 'staff:stock.low:rp-1', status: 'SENT', createdAt: { gte: new Date(NOW.getTime() - 20 * 3600_000) } },
      select: { id: true },
    });
    prisma.notificationLog.findFirst.mockClear();
    await service.notify('stock.low', { title: 't', lines: [] }, NOW);
    expect(prisma.notificationLog.findFirst).not.toHaveBeenCalled();
  });

  it('S6 one failing recipient does not stop the others; notify never rejects', async () => {
    notifications.send.mockImplementation(({ recipient }: { recipient: string }) => (recipient === 'U1' ? Promise.reject(new Error('boom')) : Promise.resolve({ id: 'n', status: 'SENT' })));
    expect(await service.notify('stock.low', { title: 't', lines: [] }, NOW)).toMatchObject({ sent: 1, failed: 1 });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    prisma.user.findMany.mockRejectedValue(new Error('db down'));
    await expect(service.notify('stock.low', { title: 't', lines: [] }, NOW)).resolves.toMatchObject({ failed: 1, sent: 0 });
  });

  it('S7 flex payload goes through LineOaService and is logged by the service itself', async () => {
    const contents = { type: 'bubble' };
    await service.notify('report.owner_daily', { title: 'รายงาน', lines: [], flex: { altText: 'รายงานประจำวัน', contents }, dedupeKey: '2026-10-26' }, NOW);
    expect(lineOa.sendFlexMessage).toHaveBeenCalledWith('U1', { type: 'flex', altText: 'รายงานประจำวัน', contents }, 'line-staff');
    expect(notifications.send).not.toHaveBeenCalled();
    expect(prisma.notificationLog.create).toHaveBeenCalledWith({
      data: { channel: 'LINE', channelKey: 'line-staff', recipient: 'U1', message: 'รายงานประจำวัน', status: 'SENT', relatedId: 'staff:report.owner_daily:2026-10-26', category: 'STAFF', sentAt: expect.any(Date) },
    });
    lineOa.sendFlexMessage.mockRejectedValueOnce(new Error('429'));
    prisma.notificationLog.create.mockClear();
    const res = await service.notify('report.owner_daily', { title: 'รายงาน', lines: [], flex: { altText: 'x', contents } }, NOW);
    expect(res.failed).toBe(1);
    expect(prisma.notificationLog.create.mock.calls[0][0].data).toMatchObject({ status: 'FAILED', errorMsg: '429' });
  });

  it('S8 testToUser and sendSample', async () => {
    prisma.user.findUnique.mockResolvedValue(user({ id: 'a', name: 'A', lineStaffUserId: null }));
    await expect(service.testToUser('a', 'เจ้าของ', NOW)).rejects.toThrow(/ยังไม่ได้ผูก LINE/);
    prisma.user.findUnique.mockResolvedValue(user({ id: 'a', name: 'A', lineStaffUserId: 'U1' }));
    lineConfig.isConfigured.mockResolvedValue(false);
    await expect(service.testToUser('a', 'เจ้าของ', NOW)).rejects.toThrow(/ยังไม่ได้ตั้งค่า/);
    lineConfig.isConfigured.mockResolvedValue(true);
    await service.testToUser('a', 'เจ้าของ', NOW);
    expect(notifications.send).toHaveBeenCalledWith(expect.objectContaining({ recipient: 'U1', relatedId: 'staff:test:a', category: 'STAFF' }));
    expect(notifications.send.mock.calls[0][0].message).toMatch(/ทดสอบการเชื่อมต่อ LINE พนักงาน[\s\S]*"A"[\s\S]*เจ้าของ/);
    notifications.send.mockClear();
    rules.getRule.mockResolvedValue({ ...RULE, enabled: false });
    const res = await service.sendSample('stock.low', 'a', NOW);
    expect(res.sent).toBe(1);
    expect(notifications.send.mock.calls[0][0].message).toContain('ของต่ำกว่าจุดสั่งซื้อซ้ำ');
    expect(prisma.notificationLog.findFirst).not.toHaveBeenCalled();
  });

  it('S9 monthly quota: recipients beyond the cap are skipped and warned once', async () => {
    rules.getMonthlyCap.mockResolvedValue(3);
    prisma.notificationLog.count.mockResolvedValue(2);
    prisma.user.findMany.mockResolvedValue([user({ id: 'a', lineStaffUserId: 'U1' }), user({ id: 'b', lineStaffUserId: 'U2' }), user({ id: 'c', lineStaffUserId: 'U3' })]);
    const res = await service.notify('stock.low', { title: 't', lines: [] }, NOW);
    expect(res).toMatchObject({ sent: 1, quotaSkipped: 2 });
    expect(prisma.notificationLog.count).toHaveBeenCalledWith({ where: { channelKey: 'line-staff', status: 'SENT', createdAt: { gte: new Date('2026-09-30T17:00:00.000Z') } } });
    expect(warn).toHaveBeenCalledTimes(1);
    const usage = await service.usage(NOW);
    expect(usage).toEqual({ used: 2, cap: 3, monthKey: '2026-10' });
  });

  it('S10 smsFallback passes the user phone as fallbackPhone; group recipients get none', async () => {
    rules.getRule.mockResolvedValue({ ...RULE, roles: ['OWNER'], includeGroup: true });
    lineConfig.groupTargets.mockResolvedValue(['G1']);
    prisma.user.findMany.mockResolvedValue([user({ id: 'a', lineStaffUserId: 'U1', phone: '0899999999' })]);
    await service.notify('overdue.owner_alert', { title: 't', lines: [], smsFallback: true }, NOW);
    const calls = notifications.send.mock.calls.map((c: [Record<string, unknown>]) => c[0]);
    expect(calls.find((c) => c.recipient === 'U1')).toMatchObject({ fallbackPhone: '0899999999' });
    expect(calls.find((c) => c.recipient === 'G1')).not.toHaveProperty('fallbackPhone');
  });
});
