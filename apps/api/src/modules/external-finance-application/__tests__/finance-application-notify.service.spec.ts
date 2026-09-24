import { FinanceApplicationNotifyService } from '../services/finance-application-notify.service';

const app = {
  id: 'app-1',
  number: 'BC-260924-001',
  status: 'APPROVED',
  roomId: 'room-1',
  sentById: 'u-sender',
  createdById: 'u-creator',
  events: [{ kind: 'PARTNER_APPROVED', note: 'ผ่านครับ', createdAt: new Date() }],
};

function make(row: any) {
  const prisma = {
    externalFinanceApplication: { findFirst: jest.fn().mockResolvedValue(row) },
    todo: { create: jest.fn().mockResolvedValue({ id: 't1' }), findFirst: jest.fn().mockResolvedValue(null) },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u-system' }) },
  } as any;
  const notifications = { send: jest.fn().mockResolvedValue({ id: 'n1', status: 'SENT' }) } as any;
  return { prisma, notifications, service: new FinanceApplicationNotifyService(prisma, notifications) };
}

describe('FinanceApplicationNotifyService.partnerReplied', () => {
  it('creates a HIGH todo for the sender tagged gfin and pushes an IN_APP notification', async () => {
    const { prisma, notifications, service } = make(app);
    await service.partnerReplied('app-1');
    expect(prisma.todo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assigneeId: 'u-sender',
          createdById: 'u-system',
          roomId: 'room-1',
          priority: 'HIGH',
          tags: ['gfin'],
          title: expect.stringContaining('BC-260924-001'),
        }),
      }),
    );
    expect(notifications.send).toHaveBeenCalledWith(expect.objectContaining({ channel: 'IN_APP', recipient: 'u-sender' }));
  });

  it('falls back to the creator when sentById is null and does not duplicate an open todo', async () => {
    const { prisma, service } = make({ ...app, sentById: null });
    prisma.todo.findFirst.mockResolvedValueOnce({ id: 'existing' });
    await service.partnerReplied('app-1');
    expect(prisma.todo.create).not.toHaveBeenCalled();
  });

  it('swallows notification transport errors (never throws into the public reply path)', async () => {
    const { notifications, service } = make(app);
    notifications.send.mockRejectedValueOnce(new Error('boom'));
    await expect(service.partnerReplied('app-1')).resolves.toBeUndefined();
  });

  it('never throws even when the todo create fails', async () => {
    const { prisma, service } = make(app);
    prisma.todo.create.mockRejectedValueOnce(new Error('db down'));
    await expect(service.partnerReplied('app-1')).resolves.toBeUndefined();
  });

  it('is a no-op when the application cannot be found', async () => {
    const { prisma, notifications, service } = make(null);
    await service.partnerReplied('missing');
    expect(prisma.todo.create).not.toHaveBeenCalled();
    expect(notifications.send).not.toHaveBeenCalled();
  });
});
