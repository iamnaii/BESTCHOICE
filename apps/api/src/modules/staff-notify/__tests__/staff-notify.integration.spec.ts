import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { StaffNotifyRulesService } from '../staff-notify-rules.service';
import { StaffLineConfigService } from '../staff-line-config.service';
import { STAFF_LINE_CHANNEL_KEY, StaffNotifyService } from '../staff-notify.service';
import { STAFF_NOTIFY_RULES_KEY } from '../staff-event-catalog';
import { AuditService } from '../../audit/audit.service';

/**
 * ก้อน 7 A16 — แจ้งพนักงานทาง LINE บนฐานข้อมูลจริง (spec §4, §5, §9):
 * จัดเส้นทางผู้รับตามบทบาท/สาขาจาก User จริง · กันซ้ำด้วย NotificationLog จริง · กติกาใน SystemConfig จริง (รวมค่าเสียหาย)
 * รัน: bash tools/test-db-vitest.sh src/modules/staff-notify/__tests__/staff-notify.integration.spec.ts
 */

const prisma = new PrismaClient();
const stamp = Date.now();
const NOW = new Date('2026-10-26T03:00:00.000Z'); // 26 ต.ค. 2569 10:00 ไทย

const lineConfig = new StaffLineConfigService({
  getValue: async (_key: string, field: string) => (field === 'channelToken' ? 'x' : field === 'notifyTargets' ? 'G1' : null),
} as never);
// NotificationsService ตัวแทน — เขียน NotificationLog จริงเหมือนของจริงทำ แล้วคืน SENT (ไม่ยิง LINE)
const notifications = {
  send: vi.fn(async (input: { channelKey: string; recipient: string; message: string; relatedId?: string }) => {
    await prisma.notificationLog.create({
      data: { channel: 'LINE', channelKey: input.channelKey, recipient: input.recipient, message: input.message, status: 'SENT', relatedId: input.relatedId ?? null, category: 'STAFF', sentAt: new Date() },
    });
    return { status: 'SENT' };
  }),
};
const lineOa = { sendFlexMessage: vi.fn(), pushMessage: vi.fn() };
const rules = new StaffNotifyRulesService(prisma as never, new AuditService(prisma as never));
const service = new StaffNotifyService(prisma as never, rules, lineConfig, notifications as never, lineOa as never);

let branchA: string;
let branchB: string;
let ownerId: string;
const lineIds = {
  owner: `U-owner-${stamp}`,
  accountant: `U-acct-${stamp}`,
  bmA: `U-bm-a-${stamp}`,
  bmB: `U-bm-b-${stamp}`,
};

async function makeUser(role: string, over: Record<string, unknown>) {
  return prisma.user.create({
    data: { email: `sn-${role.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}-${stamp}@test.local`, password: 'x', name: `${role} ทดสอบ`, role: role as never, isActive: true, ...over } as never,
  });
}

beforeAll(async () => {
  branchA = (await prisma.branch.create({ data: { name: `สาขา A ${stamp}` } })).id;
  branchB = (await prisma.branch.create({ data: { name: `สาขา B ${stamp}` } })).id;
  ownerId = (await makeUser('OWNER', { branchId: null, lineStaffUserId: lineIds.owner })).id;
  await makeUser('ACCOUNTANT', { branchId: null, lineStaffUserId: lineIds.accountant });
  await makeUser('BRANCH_MANAGER', { branchId: branchA, lineStaffUserId: lineIds.bmA });
  await makeUser('BRANCH_MANAGER', { branchId: branchB, lineStaffUserId: lineIds.bmB });
  await makeUser('SALES', { branchId: branchA, lineStaffUserId: null }); // ยังไม่ผูก LINE
  await prisma.systemConfig.deleteMany({ where: { key: STAFF_NOTIFY_RULES_KEY } });
});

afterAll(async () => {
  await prisma.systemConfig.deleteMany({ where: { key: STAFF_NOTIFY_RULES_KEY } });
  await prisma.$disconnect();
});

const recipientsCalled = () => notifications.send.mock.calls.map((c) => c[0].recipient).sort();

describe('staff-notify บน Postgres จริง', () => {
  it('I1: stock.low สาขา A → ถึง OWNER + ผจก.สาขา A เท่านั้น (ผจก.สาขา B / บัญชี / SALES ที่ยังไม่ผูก ไม่ได้รับ)', async () => {
    notifications.send.mockClear();
    const result = await service.notify('stock.low', {
      title: 'ของต่ำกว่าจุดสั่งซื้อซ้ำ: iPhone 15', lines: ['เหลือ 1 (จุดสั่งซื้อ 3)'], link: '/stock/reorder-points', branchId: branchA, dedupeKey: `i1-${stamp}`,
    }, NOW);

    expect(result).toMatchObject({ recipients: 2, sent: 2, deduped: 0, failed: 0, quotaSkipped: 0 });
    expect(recipientsCalled()).toEqual([lineIds.bmA, lineIds.owner].sort());
    const logs = await prisma.notificationLog.findMany({ where: { relatedId: `staff:stock.low:i1-${stamp}` } });
    expect(logs.map((l) => l.recipient).sort()).toEqual([lineIds.bmA, lineIds.owner].sort());
    expect(logs.every((l) => l.channelKey === STAFF_LINE_CHANNEL_KEY && l.status === 'SENT' && l.category === 'STAFF')).toBe(true);
    expect(logs[0].message).toContain('📣 BESTCHOICE · ของต่ำกว่าจุดสั่งซื้อซ้ำ: iPhone 15');
  });

  it('I2: เรียกซ้ำ dedupeKey เดิมในหน้าต่างเวลา → ครั้งแรก SENT 2 แถว · ครั้งสอง deduped 2 ไม่มีแถวใหม่', async () => {
    notifications.send.mockClear();
    const payload = { title: 'ของต่ำกว่าจุดสั่งซื้อซ้ำ: iPad', lines: [], branchId: branchA, dedupeKey: `i2-${stamp}` };
    const first = await service.notify('stock.low', payload, NOW);
    const second = await service.notify('stock.low', payload, new Date(NOW.getTime() + 60_000));

    expect(first).toMatchObject({ sent: 2, deduped: 0 });
    expect(second).toMatchObject({ sent: 0, deduped: 2 });
    expect(notifications.send).toHaveBeenCalledTimes(2);
    await expect(prisma.notificationLog.count({ where: { relatedId: `staff:stock.low:i2-${stamp}` } })).resolves.toBe(2);
  });

  it('I3: saveRules เขียน SystemConfig + audit จริง → อ่านกลับตรง · ปิดสวิตช์แล้ว notify ข้าม · ค่าเสียหาย → ค่าเริ่มต้น', async () => {
    const custom = { enabled: false, roles: ['OWNER'], branchScoped: false, includeGroup: true };
    await rules.saveRules({ 'stock.low': custom }, ownerId);

    const effective = await rules.getEffectiveRules();
    expect(effective['stock.low']).toEqual(custom);
    expect(effective['recurring_bill']).toEqual(StaffNotifyRulesService.defaults()['recurring_bill']);
    const row = await prisma.systemConfig.findUnique({ where: { key: STAFF_NOTIFY_RULES_KEY } });
    expect(row).not.toBeNull();
    expect(JSON.parse(row!.value)['stock.low']).toEqual(custom);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'STAFF_NOTIFY_RULES_UPDATED', userId: ownerId }, orderBy: { createdAt: 'desc' } });
    expect(audit?.entityId).toBe(STAFF_NOTIFY_RULES_KEY);

    notifications.send.mockClear();
    const skipped = await service.notify('stock.low', { title: 'x', lines: [], branchId: branchA, dedupeKey: `i3-${stamp}` }, NOW);
    expect(skipped.skipped).toBe('disabled');
    expect(notifications.send).not.toHaveBeenCalled();

    await prisma.systemConfig.update({ where: { key: STAFF_NOTIFY_RULES_KEY }, data: { value: 'oops' } });
    await expect(rules.getEffectiveRules()).resolves.toEqual(StaffNotifyRulesService.defaults());
  });
});
