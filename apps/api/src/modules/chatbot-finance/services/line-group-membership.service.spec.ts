import { LineGroupMembershipService } from './line-group-membership.service';

function make(over: { linkedCompany?: unknown; row?: unknown } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    lineGroupMembership: {
      upsert: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(over.row ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    externalFinanceCompany: { findFirst: jest.fn().mockResolvedValue(over.linkedCompany ?? null) },
    user: {
      findMany: jest.fn().mockResolvedValue([{ id: 'u-owner' }, { id: 'u-fm' }]),
      findFirst: jest.fn().mockResolvedValue({ id: 'u-system' }),
    },
    todo: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 't1' }) },
  };
  const lineClient = { getGroupSummary: jest.fn().mockResolvedValue({ groupId: 'C1', groupName: 'GFIN : BESTCHOICE', pictureUrl: 'https://p' }), getGroupMemberCount: jest.fn().mockResolvedValue(5) };
  const notifications = { send: jest.fn().mockResolvedValue({ id: 'n', status: 'SENT' }) };
  return { prisma, lineClient, notifications, service: new LineGroupMembershipService(prisma, lineClient as never, notifications as never) };
}

describe('LineGroupMembershipService.onJoin', () => {
  it('upserts one row per (channel, groupId) with summary + member count, clearing leftAt', async () => {
    const { prisma, service } = make();
    await service.onJoin('FINANCE', 'C1');
    expect(prisma.lineGroupMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { channel_groupId: { channel: 'FINANCE', groupId: 'C1' } },
      create: expect.objectContaining({ channel: 'FINANCE', groupId: 'C1', groupName: 'GFIN : BESTCHOICE', pictureUrl: 'https://p', memberCount: 5, leftAt: null }),
      update: expect.objectContaining({ groupName: 'GFIN : BESTCHOICE', memberCount: 5, leftAt: null, deletedAt: null }),
    }));
  });
  it('summary/count unavailable → still records the join, keeps the previous name (update omits groupName)', async () => {
    const { prisma, lineClient, service } = make();
    lineClient.getGroupSummary.mockResolvedValue(null);
    lineClient.getGroupMemberCount.mockResolvedValue(null);
    await service.onJoin('FINANCE', 'C2');
    const arg = prisma.lineGroupMembership.upsert.mock.calls[0][0];
    expect(arg.create).toEqual(expect.objectContaining({ groupName: null, memberCount: null }));
    expect(arg.update).not.toHaveProperty('groupName');
    expect(arg.update).not.toHaveProperty('memberCount');
  });
});

describe('LineGroupMembershipService.onLeave', () => {
  it('stamps leftAt and does NOT notify when the group is not linked to GFIN', async () => {
    const { prisma, notifications, service } = make({ row: { id: 'm1', groupName: 'อื่น ๆ' } });
    await service.onLeave('FINANCE', 'C9');
    expect(prisma.lineGroupMembership.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { leftAt: expect.any(Date) } });
    expect(prisma.todo.create).not.toHaveBeenCalled();
    expect(notifications.send).not.toHaveBeenCalled();
  });
  it('linked group → HIGH todo tagged gfin for every active OWNER/FINANCE_MANAGER + IN_APP each (spec §13)', async () => {
    const { prisma, notifications, service } = make({ row: { id: 'm1', groupName: 'GFIN : BESTCHOICE' }, linkedCompany: { id: 'gfin-1', name: 'GFIN' } });
    await service.onLeave('FINANCE', 'C1');
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ role: { in: ['OWNER', 'FINANCE_MANAGER'] }, isActive: true, deletedAt: null }) }));
    expect(prisma.todo.create).toHaveBeenCalledTimes(2);
    expect(prisma.todo.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ assigneeId: 'u-owner', createdById: 'u-system', priority: 'HIGH', tags: ['gfin'], title: expect.stringContaining('GFIN : BESTCHOICE') }) }));
    expect(notifications.send).toHaveBeenCalledTimes(2);
    expect(notifications.send).toHaveBeenCalledWith(expect.objectContaining({ channel: 'IN_APP', recipient: 'u-fm' }));
  });
  it('dedups: an open todo with the same title for that user → no second todo (IN_APP still sent)', async () => {
    const { prisma, service } = make({ row: { id: 'm1', groupName: 'G' }, linkedCompany: { id: 'gfin-1', name: 'GFIN' } });
    prisma.todo.findFirst.mockResolvedValue({ id: 'open' });
    await service.onLeave('FINANCE', 'C1');
    expect(prisma.todo.create).not.toHaveBeenCalled();
  });
  it('unknown group (no row) → logs and returns without throwing', async () => {
    const { prisma, service } = make();
    await expect(service.onLeave('FINANCE', 'Cx')).resolves.toBeUndefined();
    expect(prisma.lineGroupMembership.update).not.toHaveBeenCalled();
  });
  it('notification failures never propagate (webhook must stay 200)', async () => {
    const { prisma, notifications, service } = make({ row: { id: 'm1', groupName: 'G' }, linkedCompany: { id: 'gfin-1', name: 'GFIN' } });
    prisma.todo.create.mockRejectedValue(new Error('db'));
    notifications.send.mockRejectedValue(new Error('down'));
    await expect(service.onLeave('FINANCE', 'C1')).resolves.toBeUndefined();
  });
});

describe('LineGroupMembershipService.ensureKnown (final-fix F3)', () => {
  it('no row at all (bot invited before this webhook shipped — LINE never resends join) → same as a real join', async () => {
    const { prisma, service } = make();
    await service.ensureKnown('FINANCE', 'C1');
    expect(prisma.lineGroupMembership.findFirst).toHaveBeenCalledWith({ where: { channel: 'FINANCE', groupId: 'C1' } });
    expect(prisma.lineGroupMembership.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { channel_groupId: { channel: 'FINANCE', groupId: 'C1' } },
    }));
  });
  it('an existing row — even with leftAt set — is never resurrected (only a real `join` clears leftAt)', async () => {
    const { prisma, service } = make({ row: { id: 'm1', groupId: 'C1', leftAt: new Date() } });
    await service.ensureKnown('FINANCE', 'C1');
    expect(prisma.lineGroupMembership.upsert).not.toHaveBeenCalled();
  });
  it('an existing row still in the group (leftAt null) is also left untouched — no needless re-upsert', async () => {
    const { prisma, service } = make({ row: { id: 'm2', groupId: 'C1', leftAt: null } });
    await service.ensureKnown('FINANCE', 'C1');
    expect(prisma.lineGroupMembership.upsert).not.toHaveBeenCalled();
  });
  it('DB errors are swallowed — called on every group event before the kill switch, must never throw', async () => {
    const { prisma, service } = make();
    prisma.lineGroupMembership.findFirst.mockRejectedValue(new Error('db down'));
    await expect(service.ensureKnown('FINANCE', 'C1')).resolves.toBeUndefined();
  });
});

describe('LineGroupMembershipService.list', () => {
  it('orders groups the bot is still in first, then most recently joined', async () => {
    const { prisma, service } = make();
    prisma.lineGroupMembership.findMany.mockResolvedValue([
      { id: 'a', joinedAt: new Date('2026-09-01'), leftAt: new Date('2026-09-10') },
      { id: 'b', joinedAt: new Date('2026-09-02'), leftAt: null },
      { id: 'c', joinedAt: new Date('2026-09-05'), leftAt: null },
    ]);
    expect((await service.list('FINANCE')).map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(prisma.lineGroupMembership.findMany).toHaveBeenCalledWith({ where: { channel: 'FINANCE', deletedAt: null } });
  });
});
