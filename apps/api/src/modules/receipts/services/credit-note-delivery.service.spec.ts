import { Decimal } from '@prisma/client/runtime/library';
import * as Sentry from '@sentry/nestjs';
import { CreditNoteDeliveryService } from './credit-note-delivery.service';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

const BASE_RECEIPT = {
  id: 'receipt-1',
  receiptNumber: 'RT-202607-00099',
  amount: new Decimal('4547.49'),
  publicToken: 'tok-abc123',
  payerName: 'สมชาย ใจดี',
  deletedAt: null,
  contract: {
    contractNumber: 'CT-0001',
    customer: {
      id: 'cust-1',
      name: 'สมชาย ใจดี',
      lineIdFinance: null as string | null,
      lineLinks: [] as Array<{ lineUserId: string }>,
    },
  },
};

interface Overrides {
  receipt?: Record<string, unknown> | null;
  pushMessage?: jest.Mock;
  systemUser?: { id: string } | null;
  baseUrl?: string | undefined;
  existingTodo?: { id: string } | null;
  notificationLogCreate?: jest.Mock;
}

function buildHarness(overrides: Overrides = {}) {
  const created: {
    notificationLogs: Record<string, unknown>[];
    todos: Record<string, unknown>[];
    auditLogs: Record<string, unknown>[];
  } = { notificationLogs: [], todos: [], auditLogs: [] };

  const prisma = {
    receipt: {
      findUnique: jest
        .fn()
        .mockResolvedValue(overrides.receipt === undefined ? BASE_RECEIPT : overrides.receipt),
      update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
        id: args.where.id,
        ...args.data,
      })),
    },
    notificationLog: {
      create:
        overrides.notificationLogCreate ??
        jest.fn(async (args: { data: Record<string, unknown> }) => {
          created.notificationLogs.push(args.data);
          return { id: 'notif-1', ...args.data };
        }),
    },
    todo: {
      findFirst: jest
        .fn()
        .mockResolvedValue(overrides.existingTodo === undefined ? null : overrides.existingTodo),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        created.todos.push(args.data);
        return { id: 'todo-1', ...args.data };
      }),
    },
    auditLog: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        created.auditLogs.push(args.data);
        return { id: 'audit-1', ...args.data };
      }),
    },
    user: {
      findFirst: jest
        .fn()
        .mockResolvedValue(overrides.systemUser === undefined ? { id: 'sys-1' } : overrides.systemUser),
    },
  };

  const lineFinanceClient = {
    pushMessage: overrides.pushMessage ?? jest.fn().mockResolvedValue(undefined),
  };

  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'PAYMENT_LINK_BASE_URL') return overrides.baseUrl ?? 'https://finance.bestchoice.app';
      return undefined;
    }),
  };

  const service = new CreditNoteDeliveryService(
    prisma as never,
    lineFinanceClient as never,
    configService as never,
  );

  return { service, prisma, lineFinanceClient, configService, created };
}

describe('CreditNoteDeliveryService.deliver', () => {
  beforeEach(() => {
    (Sentry.captureMessage as jest.Mock).mockClear();
    (Sentry.captureException as jest.Mock).mockClear();
  });

  it('(a) success: pushes via LINE FINANCE with the resolved lineUserId + a flex containing the /cn/ URL, writes NotificationLog SENT + AuditLog CN_SENT', async () => {
    const { service, prisma, lineFinanceClient, created } = buildHarness({
      receipt: {
        ...BASE_RECEIPT,
        contract: {
          ...BASE_RECEIPT.contract,
          customer: {
            ...BASE_RECEIPT.contract.customer,
            lineLinks: [{ lineUserId: 'U-finance-1' }],
          },
        },
      },
    });

    const result = await service.deliver('receipt-1');

    expect(result).toEqual({ delivered: true });

    // pushMessage called with the resolved FINANCE line id
    expect(lineFinanceClient.pushMessage).toHaveBeenCalledTimes(1);
    const [to, messages] = lineFinanceClient.pushMessage.mock.calls[0];
    expect(to).toBe('U-finance-1');
    expect(messages).toHaveLength(1);
    const flexJson = JSON.stringify(messages[0]);
    expect(flexJson).toContain('https://finance.bestchoice.app/cn/tok-abc123');
    expect(flexJson).toContain('RT-202607-00099');

    // NotificationLog SENT
    expect(created.notificationLogs).toHaveLength(1);
    expect(created.notificationLogs[0]).toMatchObject({
      channel: 'LINE',
      channelKey: 'line-finance',
      recipient: 'U-finance-1',
      status: 'SENT',
      relatedId: 'receipt-1',
      customerId: 'cust-1',
      category: 'CREDIT_NOTE',
    });

    // AuditLog CN_SENT
    expect(created.auditLogs).toHaveLength(1);
    expect(created.auditLogs[0]).toMatchObject({
      userId: 'sys-1',
      action: 'CN_SENT',
      entity: 'receipt',
      entityId: 'receipt-1',
    });

    // No failure fallback on the happy path
    expect(prisma.todo.create).not.toHaveBeenCalled();
  });

  it('(I1) resend on a receipt with an already-EXPIRED publicTokenExpiresAt: extends the token to now+30d (same token, no rotation) and still proceeds to push', async () => {
    const expiredReceipt = {
      ...BASE_RECEIPT,
      publicTokenExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
      contract: {
        ...BASE_RECEIPT.contract,
        customer: {
          ...BASE_RECEIPT.contract.customer,
          lineLinks: [{ lineUserId: 'U-finance-1' }],
        },
      },
    };
    const { service, prisma, lineFinanceClient } = buildHarness({ receipt: expiredReceipt });

    const before = Date.now();
    const result = await service.deliver('receipt-1');
    const after = Date.now();

    expect(result).toEqual({ delivered: true });

    // receipt.update called with a future expiry, same token (never rotated)
    expect(prisma.receipt.update).toHaveBeenCalledTimes(1);
    const updateArgs = prisma.receipt.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'receipt-1' });
    const newExpiry = (updateArgs.data.publicTokenExpiresAt as Date).getTime();
    expect(newExpiry).toBeGreaterThan(before + 29 * 24 * 60 * 60 * 1000);
    expect(newExpiry).toBeLessThanOrEqual(after + 30 * 24 * 60 * 60 * 1000);

    // push still proceeds — a stale token must not block a resend
    expect(lineFinanceClient.pushMessage).toHaveBeenCalledTimes(1);
    const flexJson = JSON.stringify(lineFinanceClient.pushMessage.mock.calls[0][1][0]);
    expect(flexJson).toContain('tok-abc123'); // same token, not rotated
  });

  it('falls back to legacy Customer.lineIdFinance when no CustomerLineLink row exists', async () => {
    const { service, lineFinanceClient } = buildHarness({
      receipt: {
        ...BASE_RECEIPT,
        contract: {
          ...BASE_RECEIPT.contract,
          customer: { ...BASE_RECEIPT.contract.customer, lineIdFinance: 'U-legacy-1', lineLinks: [] },
        },
      },
    });

    const result = await service.deliver('receipt-1');

    expect(result).toEqual({ delivered: true });
    expect(lineFinanceClient.pushMessage).toHaveBeenCalledWith('U-legacy-1', expect.any(Array));
  });

  it('(M5) push succeeds but the SENT bookkeeping write fails afterward: still resolves { delivered: true } (customer really did get the message) and raises a Sentry warning so ops notices the silent double-send risk', async () => {
    const notificationLogCreate = jest.fn().mockRejectedValue(new Error('DB write failed'));
    const { service, lineFinanceClient } = buildHarness({
      receipt: {
        ...BASE_RECEIPT,
        contract: {
          ...BASE_RECEIPT.contract,
          customer: {
            ...BASE_RECEIPT.contract.customer,
            lineLinks: [{ lineUserId: 'U-finance-1' }],
          },
        },
      },
      notificationLogCreate,
    });

    const result = await service.deliver('receipt-1');

    expect(result).toEqual({ delivered: true });
    expect(lineFinanceClient.pushMessage).toHaveBeenCalledTimes(1);
    expect(notificationLogCreate).toHaveBeenCalledTimes(1);

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'CN sent but SENT log failed',
      expect.objectContaining({
        level: 'warning',
        tags: { subsystem: 'credit-note' },
        extra: expect.objectContaining({ receiptId: 'receipt-1' }),
      }),
    );
  });

  it('(b) push throws: writes NotificationLog FAILED + Todo fallback + AuditLog CN_SEND_FAILED, resolves { delivered: false } (never throws)', async () => {
    const { service, created } = buildHarness({
      receipt: {
        ...BASE_RECEIPT,
        contract: {
          ...BASE_RECEIPT.contract,
          customer: {
            ...BASE_RECEIPT.contract.customer,
            lineLinks: [{ lineUserId: 'U-finance-1' }],
          },
        },
      },
      pushMessage: jest.fn().mockRejectedValue(new Error('LINE API 500')),
    });

    const result = await service.deliver('receipt-1');

    expect(result).toEqual({ delivered: false });

    expect(created.notificationLogs).toHaveLength(1);
    expect(created.notificationLogs[0]).toMatchObject({
      status: 'FAILED',
      errorMsg: 'LINE API 500',
      recipient: 'U-finance-1',
      relatedId: 'receipt-1',
      category: 'CREDIT_NOTE',
    });

    expect(created.todos).toHaveLength(1);
    expect(created.todos[0]).toMatchObject({
      priority: 'MEDIUM',
      tags: ['credit-note'],
      createdById: 'sys-1',
    });
    expect(created.todos[0].title as string).toContain('RT-202607-00099');
    expect(created.todos[0].title as string).toContain('สมชาย ใจดี');
    expect(created.todos[0].title as string).toContain('EMS');

    expect(created.auditLogs).toHaveLength(1);
    expect(created.auditLogs[0]).toMatchObject({
      userId: 'sys-1',
      action: 'CN_SEND_FAILED',
      entity: 'receipt',
      entityId: 'receipt-1',
    });

    // Legally-mandated document delivery must alert ops, not just log —
    // a push rejection has to raise a Sentry alarm.
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('LINE API 500'),
      expect.objectContaining({
        level: 'warning',
        tags: { subsystem: 'credit-note' },
        extra: expect.objectContaining({ receiptId: 'receipt-1', reason: 'LINE API 500' }),
      }),
    );
  });

  it('(M6) second failure while an open (not-DONE) credit-note todo already exists for this receipt: skips creating a duplicate todo, still writes NotificationLog FAILED + AuditLog for every attempt', async () => {
    const { service, prisma, created } = buildHarness({
      receipt: {
        ...BASE_RECEIPT,
        contract: {
          ...BASE_RECEIPT.contract,
          customer: {
            ...BASE_RECEIPT.contract.customer,
            lineLinks: [{ lineUserId: 'U-finance-1' }],
          },
        },
      },
      pushMessage: jest.fn().mockRejectedValue(new Error('LINE API 500 again')),
      existingTodo: { id: 'todo-existing-1' },
    });

    const result = await service.deliver('receipt-1');

    expect(result).toEqual({ delivered: false });

    // dedup lookup happened
    expect(prisma.todo.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tags: { has: 'credit-note' },
          title: { contains: 'RT-202607-00099' },
          status: { not: 'DONE' },
        }),
      }),
    );

    // no second todo created
    expect(prisma.todo.create).not.toHaveBeenCalled();
    expect(created.todos).toHaveLength(0);

    // failure is still recorded every attempt
    expect(created.notificationLogs).toHaveLength(1);
    expect(created.notificationLogs[0]).toMatchObject({ status: 'FAILED' });
    expect(created.auditLogs).toHaveLength(1);
    expect(created.auditLogs[0]).toMatchObject({
      action: 'CN_SEND_FAILED',
      newValue: expect.objectContaining({ todoId: 'todo-existing-1' }),
    });
  });

  it('(c) no LINE link at all: same FAILED path, never pushes, never throws', async () => {
    const { service, lineFinanceClient, created } = buildHarness({
      receipt: BASE_RECEIPT, // lineLinks: [] and lineIdFinance: null
    });

    const result = await service.deliver('receipt-1');

    expect(result).toEqual({ delivered: false });
    expect(lineFinanceClient.pushMessage).not.toHaveBeenCalled();

    expect(created.notificationLogs).toHaveLength(1);
    expect(created.notificationLogs[0]).toMatchObject({
      status: 'FAILED',
      recipient: 'NO_LINE_LINK',
      blockReason: 'NO_LINE_LINK',
    });
    expect(created.todos).toHaveLength(1);
    expect(created.auditLogs[0]).toMatchObject({ action: 'CN_SEND_FAILED' });
  });

  it('returns { delivered: false } without throwing when the receipt does not exist', async () => {
    const { service } = buildHarness({ receipt: null });

    await expect(service.deliver('missing-id')).resolves.toEqual({ delivered: false });
  });

  it('returns { delivered: false } without throwing when the receipt is soft-deleted', async () => {
    const { service } = buildHarness({ receipt: { ...BASE_RECEIPT, deletedAt: new Date() } });

    await expect(service.deliver('receipt-1')).resolves.toEqual({ delivered: false });
  });

  it('never throws even when the SYSTEM user is missing (failure path degrades gracefully)', async () => {
    const { service } = buildHarness({
      receipt: BASE_RECEIPT,
      systemUser: null,
    });

    await expect(service.deliver('receipt-1')).resolves.toEqual({ delivered: false });
  });
});
