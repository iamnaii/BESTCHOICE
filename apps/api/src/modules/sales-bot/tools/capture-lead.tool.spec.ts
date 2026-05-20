import { Test, TestingModule } from '@nestjs/testing';
import { CaptureLeadTool } from './capture-lead.tool';
import { PrismaService } from '../../../prisma/prisma.service';

describe('CaptureLeadTool', () => {
  let tool: CaptureLeadTool;
  let prisma: any;
  let txClient: any;

  beforeEach(async () => {
    txClient = {
      customer: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      chatRoom: { update: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn((fn) => fn(txClient)),
      chatRoom: { findUnique: jest.fn() },
      systemConfig: { findMany: jest.fn() },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'system-user-1' }) },
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        CaptureLeadTool,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    tool = mod.get(CaptureLeadTool);
  });

  it('creates new Customer + handoff + returns lead-only result for first-time lead', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({
      id: 'room-1',
      lineUserId: 'line-user-1',
      customerId: null,
    });
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'shop_bot_central_branch_id', value: 'branch-central' },
    ]);
    txClient.customer.findFirst.mockResolvedValue(null);
    txClient.customer.create.mockResolvedValue({ id: 'cust-1' });

    const result = await tool.run({
      customerName: 'พี่เอ',
      phone: '0899999999',
      productId: 'prod-1',
      packageChoice: 'B',
      downAmount: 2900,
      roomId: 'room-1',
    });

    expect(txClient.customer.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: 'พี่เอ',
        phone: '0899999999',
        chatConsent: true,
        lineIdShop: 'line-user-1',
        acquisitionSource: 'AI_CHAT',
        status: 'ACTIVE',
      }),
    }));
    expect(txClient.chatRoom.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerId: 'cust-1',
        handoffMode: true,
        handoffReason: 'lead_captured',
      }),
    }));
    expect(txClient.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'system-user-1',
        action: 'AI_LEAD_CAPTURED',
        entity: 'customer',
        entityId: 'cust-1',
      }),
    }));
    expect(result.customerId).toBe('cust-1');
    expect(result.promptPayQr).toBeNull();
    expect(result.downAmount).toBe(2900);
    expect(result.handoffMessage).toContain('แอดมิน');
  });

  it('matches existing Customer by phone + lineIdShop composite (sets AI_CHAT_RETURN)', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({
      id: 'room-2',
      lineUserId: 'line-user-2',
      customerId: null,
    });
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'shop_bot_central_branch_id', value: 'branch-central' },
    ]);
    txClient.customer.findFirst.mockResolvedValue({ id: 'cust-existing' });

    const result = await tool.run({
      customerName: 'พี่บี',
      phone: '0888888888',
      productId: 'prod-2',
      packageChoice: 'A',
      downAmount: 490,
      roomId: 'room-2',
    });

    expect(txClient.customer.findFirst).toHaveBeenCalledWith({
      where: { phone: '0888888888', lineIdShop: 'line-user-2', deletedAt: null },
    });
    expect(txClient.customer.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cust-existing' },
      data: expect.objectContaining({ acquisitionSource: 'AI_CHAT_RETURN' }),
    }));
    expect(txClient.customer.create).not.toHaveBeenCalled();
    expect(result.customerId).toBe('cust-existing');
  });

  it('throws when central branch not configured', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({
      id: 'room-3',
      lineUserId: 'line-user-3',
      customerId: null,
    });
    prisma.systemConfig.findMany.mockResolvedValue([]); // no central branch

    await expect(
      tool.run({
        customerName: 'พี่ซี',
        phone: '0877777777',
        productId: 'prod-3',
        packageChoice: 'A',
        downAmount: 490,
        roomId: 'room-3',
      }),
    ).rejects.toThrow('shop_bot_central_branch_id not configured');
  });

  it('throws when system user not found', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({
      id: 'room-4',
      lineUserId: 'line-user-4',
      customerId: null,
    });
    prisma.user.findFirst.mockResolvedValue(null); // no system user

    await expect(
      tool.run({
        customerName: 'พี่ดี',
        phone: '0866666666',
        productId: 'prod-4',
        packageChoice: 'B',
        downAmount: 1900,
        roomId: 'room-4',
      }),
    ).rejects.toThrow('System user');
  });

  it('Blocker 2: uses room.customerId when already bound — never overwrites with phone match', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({
      id: 'room-bound',
      lineUserId: 'line-user-X',
      customerId: 'cust-bound-by-sales', // ← pre-existing binding
    });
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'shop_bot_central_branch_id', value: 'branch-central' },
    ]);
    // simulate a different customer with same phone exists
    txClient.customer.findFirst.mockResolvedValue({ id: 'cust-different-person' });

    const result = await tool.run({
      customerName: 'พี่ใหม่',
      phone: '0888888888',
      productId: 'prod-1',
      packageChoice: 'B',
      downAmount: 2900,
      roomId: 'room-bound',
    });

    // Must use pre-bound customer, NOT the phone-matched one
    expect(result.customerId).toBe('cust-bound-by-sales');
    expect(txClient.customer.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cust-bound-by-sales' },
    }));
    // Must NOT findFirst by phone (room.customerId path skips that lookup)
    expect(txClient.customer.findFirst).not.toHaveBeenCalled();
    // Must NOT create a new customer
    expect(txClient.customer.create).not.toHaveBeenCalled();
  });

  it('Blocker 1: FB room (lineUserId=null) always creates new — never matches null=null on phone', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue({
      id: 'room-fb',
      lineUserId: null,  // FB Page customer, no LINE id
      customerId: null,  // no prior binding
    });
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'shop_bot_central_branch_id', value: 'branch-central' },
    ]);
    // simulate that ANOTHER customer (walk-in) exists with same phone + null lineIdShop
    // Current buggy code would match this one — fix must NOT match
    txClient.customer.findFirst.mockResolvedValue({ id: 'cust-walkin-unrelated' });
    txClient.customer.create.mockResolvedValue({ id: 'cust-fb-new' });

    const result = await tool.run({
      customerName: 'พี่เอฟบี',
      phone: '0877777777',
      productId: 'prod-1',
      packageChoice: 'A',
      downAmount: 490,
      roomId: 'room-fb',
    });

    // Must create new customer (no LINE lineUserId → cannot composite-match safely)
    expect(result.customerId).toBe('cust-fb-new');
    expect(txClient.customer.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: 'พี่เอฟบี',
        phone: '0877777777',
        lineIdShop: null, // correctly nulls lineIdShop for non-LINE
        acquisitionSource: 'AI_CHAT',
      }),
    }));
    // findFirst MUST NOT be called for non-LINE channels (no safe composite key)
    expect(txClient.customer.findFirst).not.toHaveBeenCalled();
    expect(txClient.customer.update).not.toHaveBeenCalled();
  });
});
