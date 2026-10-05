import { ChatWorkSettingsService } from '../src/modules/staff-chat/services/chat-work-settings.service';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { ChatWorkAccessService } from '../src/modules/staff-chat/services/chat-work-access.service';
import { StaffInboxService } from '../src/modules/staff-chat/services/staff-inbox.service';
import { ResponseCycleService } from '../src/modules/chat-engine/services/response-cycle.service';
import { ChatSlaNotifierService } from '../src/modules/chat-engine/services/chat-sla-notifier.service';

if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.'))
  throw new Error('Use isolated chat-operations harness');
describe('SLA and follow-up alerts', () => {
  const db = new PrismaService();
  const access = new ChatWorkAccessService(db);
  const inbox = new StaffInboxService(db, access);
  const cycles = new ResponseCycleService(db);
  const notifier = new ChatSlaNotifierService(db, access, inbox, cycles);
  const now = new Date('2026-10-06T05:00:00Z'); // noon Bangkok
  const cutover = new Date('2026-10-06T04:00:00Z');
  let staffId: string;
  let managerId: string;
  let roomId: string;
  let cycleId: string;
  let branchId: string;
  beforeAll(async () => {
    await db.$connect();
    branchId = (await db.branch.create({ data: { name: 'Synthetic SLA branch' } })).id;
    staffId = (
      await db.user.create({
        data: {
          name: 'Synthetic SLA staff',
          email: `${randomUUID()}@test.invalid`,
          password: 'unused',
          role: 'SALES',
          branchId,
          accessibleCompanies: ['SHOP'],
        },
      })
    ).id;
    managerId = (
      await db.user.create({
        data: {
          name: 'Synthetic SLA manager',
          email: `${randomUUID()}@test.invalid`,
          password: 'unused',
          role: 'BRANCH_MANAGER',
          branchId,
          accessibleCompanies: ['SHOP'],
        },
      })
    ).id;
  });
  beforeEach(async () => {
    for (const key of [
      'chat_work_queue_enabled',
      'chat_sla_alerts_enabled',
      'in_app_notifications_enabled',
    ])
      await db.systemConfig.upsert({
        where: { key },
        create: { key, value: 'true', updatedAt: cutover },
        update: { value: 'true', updatedAt: cutover },
      });
    const startedAt = new Date('2026-10-06T04:44:00Z');
    roomId = (
      await db.chatRoom.create({
        data: { channel: 'FACEBOOK', assignedToId: staffId, waitingSince: startedAt },
      })
    ).id;
    cycleId = (
      await db.chatResponseCycle.create({
        data: {
          roomId,
          startedAt,
          origin: 'LIVE',
          policyVersion: 'initial-5-15',
          alertEligibleAt: startedAt,
          assignedAtOpenId: staffId,
        },
      })
    ).id;
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  const items = () => db.staffInboxItem.findMany({ where: { roomId } });
  it('concurrent scans notify the owner and branch manager once each', async () => {
    await Promise.all([notifier.scan(now), notifier.scan(now)]);
    expect((await items()).map((item) => item.recipientId).sort()).toEqual(
      [staffId, managerId].sort(),
    );
    await notifier.scan(now);
    expect(await items()).toHaveLength(2);
  });
  it('does not notify resolved rooms or legacy backlog', async () => {
    await db.$transaction((tx) => cycles.resolveInTx(tx, { roomId, resolvedAt: now }));
    await notifier.scan(now);
    expect(await items()).toHaveLength(0);
    await db.chatResponseCycle.update({
      where: { id: cycleId },
      data: { endedAt: null, endReason: null, origin: 'LEGACY_OPEN', alertEligibleAt: null },
    });
    await db.chatRoom.update({
      where: { id: roomId },
      data: { waitingSince: new Date('2026-01-01') },
    });
    await notifier.scan(now);
    expect(await items()).toHaveLength(0);
  });
  it('uses the current owner and never grants access through an alert', async () => {
    const replacement = await db.user.create({
      data: {
        name: 'Replacement',
        email: `${randomUUID()}@test.invalid`,
        password: 'unused',
        role: 'SALES',
        branchId,
        accessibleCompanies: ['SHOP'],
      },
    });
    await db.chatRoom.update({ where: { id: roomId }, data: { assignedToId: replacement.id } });
    await notifier.scan(now);
    expect((await items()).map((item) => item.recipientId)).toContain(replacement.id);
    expect((await items()).map((item) => item.recipientId)).not.toContain(staffId);
  });
  it('toggle reactivation does not send the old backlog', async () => {
    await db.systemConfig.update({
      where: { key: 'in_app_notifications_enabled' },
      data: { value: 'false' },
    });
    await notifier.scan(now);
    expect(await items()).toHaveLength(0);
    await db.systemConfig.update({
      where: { key: 'in_app_notifications_enabled' },
      data: { value: 'true', updatedAt: now },
    });
    await notifier.scan(now);
    expect(await items()).toHaveLength(0);
  });
  it('rescheduling changes reminder identity, and completed tasks never alert', async () => {
    await db.$transaction((tx) => cycles.resolveInTx(tx, { roomId, resolvedAt: now }));
    const todo = await db.todo.create({
      data: {
        title: 'Synthetic follow up',
        roomId,
        assigneeId: staffId,
        createdById: staffId,
        dueDate: new Date('2026-10-06T04:50:00Z'),
      },
    });
    await notifier.scan(now);
    expect(await items()).toHaveLength(1);
    await db.todo.update({
      where: { id: todo.id },
      data: { dueDate: new Date('2026-10-06T04:55:00Z') },
    });
    await notifier.scan(now);
    expect(await items()).toHaveLength(2);
    await db.todo.update({
      where: { id: todo.id },
      data: { status: 'DONE', dueDate: new Date('2026-10-06T04:56:00Z') },
    });
    await notifier.scan(now);
    expect(await items()).toHaveLength(2);
  });
  it('only a current owner can change policy, and changing it leaves older cycle policy intact', async () => {
    const settings = new ChatWorkSettingsService(db, access);
    const staff = await db.user.findUniqueOrThrow({ where: { id: staffId } });
    await expect(settings.update(staff, { ownerMinutes: 7, managerMinutes: 20 })).rejects.toThrow();
    const owner = await db.user.create({
      data: {
        name: 'Synthetic policy owner',
        email: `${randomUUID()}@test.invalid`,
        password: 'unused',
        role: 'OWNER',
        accessibleCompanies: ['SHOP'],
      },
    });
    await settings.update(owner, { ownerMinutes: 7, managerMinutes: 20 });
    expect(
      (await db.chatResponseCycle.findUniqueOrThrow({ where: { id: cycleId } })).policyVersion,
    ).toBe('initial-5-15');
    const room = await db.chatRoom.create({ data: { channel: 'FACEBOOK' } });
    const message = await db.chatMessage.create({
      data: { roomId: room.id, role: 'CUSTOMER', createdAt: now },
    });
    await db.$transaction((tx) =>
      cycles.openInTx(tx, { roomId: room.id, messageId: message.id, receivedAt: now }),
    );
    const policy = (await db.chatResponseCycle.findFirstOrThrow({ where: { roomId: room.id } }))
      .policyVersion;
    expect(policy).toContain('"ownerMinutes":7');
    expect(policy).toContain('"managerMinutes":20');
  });

  it('a fresh inbound after reactivation becomes eligible without replaying the older wait', async () => {
    await db.systemConfig.update({
      where: { key: 'in_app_notifications_enabled' },
      data: { value: 'true', updatedAt: new Date('2026-10-06T04:50:00Z') },
    });
    const receivedAt = new Date('2026-10-06T04:54:00Z');
    const message = await db.chatMessage.create({
      data: { roomId, role: 'CUSTOMER', createdAt: receivedAt },
    });
    await db.$transaction((tx) =>
      cycles.openInTx(tx, { roomId, messageId: message.id, receivedAt }),
    );
    await notifier.scan(now);
    expect((await items()).map((item) => item.recipientId)).toEqual([staffId]);
  });
  it('rechecks resolution after waiting for a concurrent room transaction', async () => {
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const writer = db.$transaction(
      async (tx) => {
        await cycles.lock(tx, roomId);
        locked();
        await gate;
        await cycles.resolveInTx(tx, { roomId, resolvedAt: now });
      },
      { timeout: 10000 },
    );
    await ready;
    const scanning = notifier.scan(now);
    try {
      const deadline = Date.now() + 5000;
      for (;;) {
        const blocked = await db.$queryRaw<
          Array<{ count: bigint }>
        >`SELECT count(*) AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'SELECT id FROM chat_rooms%'`;
        if (Number(blocked[0].count) > 0) break;
        if (Date.now() > deadline) throw new Error('Scanner never waited for the locked room');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      release();
      await writer;
      await scanning;
    }
    expect(await items()).toHaveLength(0);
  });
});
