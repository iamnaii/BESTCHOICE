import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CaptureLeadTool } from './capture-lead.tool';
import { PrismaService } from '../../../prisma/prisma.service';
import { CustomerPiiService } from '../../customers/customer-pii.service';
import { CustomerMergeService, SYSTEM_ACTOR } from '../../chat-prospects/customer-merge.service';
import { ChatProspectService } from '../../chat-prospects/chat-prospect.service';
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { CHAT_GATEWAY_TOKEN } from '../../chat-engine/interfaces/chat-gateway.interface';

/**
 * prisma.customer กับ tx.customer ใช้ mock ชุดเดียวกัน — ตัวอ่านก่อนทรานแซกชัน (ตัดสินใจรวม/ผูก)
 * และตัวอ่านซ้ำในทรานแซกชันจึงเห็นค่าเดียวกัน · เคสแข่งกันใช้ mockResolvedValueOnce เรียงลำดับ
 */
function makeHarness() {
  const order: string[] = [];
  const customer = {
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 'cust-new' }),
    update: jest.fn().mockResolvedValue({}),
  };
  const txClient = {
    customer,
    chatRoom: { update: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => {
      order.push('tx');
      return fn(txClient);
    }),
    customer,
    chatRoom: { findUnique: jest.fn() },
    systemConfig: {
      findMany: jest.fn().mockResolvedValue([{ key: 'shop_bot_central_branch_id', value: 'branch-central' }]),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'system-user-1' }) },
  };
  const pii = {
    searchByHash: jest.fn((_field: string, value: string) => ({ phoneHash: `h:${value}` })),
    encryptCustomerFields: jest.fn((input: Record<string, string>) => {
      const out: Record<string, string> = {};
      if ('phone' in input) {
        out.phoneEncrypted = `e:${input.phone}`;
        out.phoneHash = `h:${input.phone}`;
      }
      if ('phoneSecondary' in input) out.phoneSecondaryEncrypted = `e:${input.phoneSecondary}`;
      return out;
    }),
  };
  const merge = {
    absorbPlaceholder: jest.fn(async () => {
      order.push('absorb');
      return {};
    }),
  };
  const prospects = {
    ensureForRoom: jest.fn(async () => {
      order.push('ensure');
      return { customerId: 'cust-ensured', created: true };
    }),
  };
  const journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
  const gateway = { emitRoomUpdate: jest.fn() };
  return { order, customer, txClient, prisma, pii, merge, prospects, journey, gateway };
}

type Harness = ReturnType<typeof makeHarness>;

async function buildTool(h: Harness): Promise<CaptureLeadTool> {
  const mod: TestingModule = await Test.createTestingModule({
    providers: [
      CaptureLeadTool,
      { provide: PrismaService, useValue: h.prisma },
      { provide: CustomerPiiService, useValue: h.pii },
      { provide: CustomerMergeService, useValue: h.merge },
      { provide: ChatProspectService, useValue: h.prospects },
      { provide: JourneyEntryWriter, useValue: h.journey },
      { provide: CHAT_GATEWAY_TOKEN, useValue: h.gateway },
    ],
  }).compile();
  return mod.get(CaptureLeadTool);
}

function room(overrides: Record<string, unknown> = {}) {
  return {
    id: 'room-1',
    channel: 'FACEBOOK',
    lineUserId: null,
    externalUserId: 'psid-1',
    customerId: null,
    customer: null,
    ...overrides,
  };
}

function boundRoom(customerId: string, overrides: Record<string, unknown> = {}) {
  return room({ customerId, customer: { deletedAt: null }, ...overrides });
}

function owner(id: string, overrides: Record<string, unknown> = {}) {
  return { id, lineIdShop: null, lineIdFinance: null, facebookUserId: null, ...overrides };
}

const auditValue = (h: Harness) => h.txClient.auditLog.create.mock.calls[0][0].data.newValue;
const auditEntityId = (h: Harness) => h.txClient.auditLog.create.mock.calls[0][0].data.entityId;
const updateData = (h: Harness, i = 0) => h.customer.update.mock.calls[i][0].data;

describe('CaptureLeadTool', () => {
  let h: Harness;
  let tool: CaptureLeadTool;

  beforeEach(async () => {
    h = makeHarness();
    tool = await buildTool(h);
  });

  it('creates new Customer + handoff + returns lead-only result for first-time lead', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(room({ channel: 'LINE_SHOP', lineUserId: 'line-user-1', externalUserId: null }));
    h.customer.create.mockResolvedValue({ id: 'cust-1' });

    const result = await tool.run({
      customerName: 'พี่เอ',
      phone: '0899999999',
      productId: 'prod-1',
      packageChoice: 'B',
      downAmount: 2900,
      roomId: 'room-1',
    });

    expect(h.customer.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: 'พี่เอ',
        phone: '0899999999',
        phoneHash: 'h:0899999999',
        phoneEncrypted: 'e:0899999999',
        chatConsent: true,
        lineIdShop: 'line-user-1',
        acquisitionSource: 'AI_CHAT',
        status: 'ACTIVE',
      }),
    }));
    expect(h.txClient.chatRoom.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        customerId: 'cust-1',
        handoffMode: true,
        handoffReason: 'lead_captured',
      }),
    }));
    expect(h.txClient.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'system-user-1',
        action: 'AI_LEAD_CAPTURED',
        entity: 'customer',
        entityId: 'cust-1',
      }),
    }));
    expect(auditValue(h)).toEqual(expect.objectContaining({
      phoneOutcome: 'CREATED', phoneConflict: null, absorbedPlaceholderId: null,
    }));
    // สร้างใหม่ไม่เขียนบันทึกการเดินทาง (ตรงกับ create() ของพนักงาน)
    expect(h.journey.recordAfterCommit).not.toHaveBeenCalled();
    expect(result.customerId).toBe('cust-1');
    expect(result.promptPayQr).toBeNull();
    expect(result.downAmount).toBe(2900);
    expect(result.handoffMessage).toContain('ติดต่อกลับ');
  });

  it('matches existing Customer by lineIdShop + (phone OR phoneHash) composite (sets AI_CHAT_RETURN)', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(room({ id: 'room-2', channel: 'LINE_SHOP', lineUserId: 'line-user-2', externalUserId: null }));
    h.customer.findFirst.mockResolvedValue({ id: 'cust-existing', acquisitionSource: null });

    const result = await tool.run({
      customerName: 'พี่บี',
      phone: '0888888888',
      productId: 'prod-2',
      packageChoice: 'A',
      downAmount: 490,
      roomId: 'room-2',
    });

    expect(h.customer.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        deletedAt: null,
        lineIdShop: 'line-user-2',
        OR: [{ phone: '0888888888' }, { phoneHash: 'h:0888888888' }],
      },
    }));
    expect(h.customer.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cust-existing' },
      data: expect.objectContaining({ acquisitionSource: 'AI_CHAT_RETURN' }),
    }));
    expect(h.customer.create).not.toHaveBeenCalled();
    expect(h.customer.findMany).not.toHaveBeenCalled();
    expect(auditValue(h).phoneOutcome).toBe('MATCHED_LINE');
    expect(result.customerId).toBe('cust-existing');
  });

  it('composite match ไม่มี salt (searchByHash → null) → OR เหลือแค่ phone', async () => {
    h.pii.searchByHash.mockReturnValue(null as never);
    h.prisma.chatRoom.findUnique.mockResolvedValue(room({ channel: 'LINE_SHOP', lineUserId: 'line-u', externalUserId: null }));
    await tool.run({ customerName: 'ก', phone: '0888888888', downAmount: 1, roomId: 'room-1' });
    expect(h.customer.findFirst.mock.calls[0][0].where.OR).toEqual([{ phone: '0888888888' }]);
    expect(h.customer.findMany.mock.calls[0][0].where.OR).toEqual([{ phone: '0888888888' }]);
  });

  // Ruling R14 (fix round 1): Branch 2 ก็ต้องไม่ทับที่มา CHAT_* เหมือน Branch 1 —
  // ลูกค้าที่จับคู่ได้ (phone+lineIdShop) อาจเป็นอดีต placeholder ที่เพิ่งได้เบอร์จาก
  // ห้องอื่นมาก่อนแล้ว ที่มาต้องคงเดิม ไม่ใช่ถูกทับด้วย AI_CHAT_RETURN
  it('Ruling R14: Branch 2 จับคู่ลูกค้าที่ที่มายังเป็น CHAT_LINE_SHOP → ไม่ทับที่มา', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(room({ channel: 'LINE_SHOP', lineUserId: 'line-user-chat', externalUserId: null }));
    h.customer.findFirst.mockResolvedValue({
      id: 'cust-chat-sourced', acquisitionSource: 'CHAT_LINE_SHOP', phone: '0888888888', nationalId: null,
    });

    await tool.run({
      customerName: 'พี่แชท',
      phone: '0888888888',
      productId: 'prod-1',
      packageChoice: 'B',
      downAmount: 2900,
      roomId: 'room-1',
    });

    const data = updateData(h);
    expect(data).not.toHaveProperty('acquisitionSource');
    expect(data.name).toBe('พี่แชท');
  });

  it('throws when central branch not configured', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(room());
    h.prisma.systemConfig.findMany.mockResolvedValue([]);

    await expect(
      tool.run({ customerName: 'พี่ซี', phone: '0877777777', downAmount: 490, roomId: 'room-1' }),
    ).rejects.toThrow('shop_bot_central_branch_id not configured');
  });

  it('throws when system user not found', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(room());
    h.prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      tool.run({ customerName: 'พี่ดี', phone: '0866666666', downAmount: 1900, roomId: 'room-1' }),
    ).rejects.toThrow('System user');
  });

  it('Blocker 2: uses room.customerId when already bound — never re-matches or creates', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(boundRoom('cust-bound-by-sales', { channel: 'LINE_SHOP', lineUserId: 'line-user-X' }));
    h.customer.findUnique.mockResolvedValue({ id: 'cust-bound-by-sales', phone: '0811111111', phoneSecondary: null, acquisitionSource: null, nationalId: null });

    const result = await tool.run({ customerName: 'พี่ใหม่', phone: '0888888888', downAmount: 2900, roomId: 'room-1' });

    expect(result.customerId).toBe('cust-bound-by-sales');
    expect(h.customer.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'cust-bound-by-sales' } }));
    expect(h.customer.findFirst).not.toHaveBeenCalled();
    expect(h.customer.create).not.toHaveBeenCalled();
    // ลูกค้าที่พนักงานผูกไว้ ไม่ต้องหาเจ้าของเบอร์ (ไม่เขียนเบอร์หลักอยู่แล้ว)
    expect(h.customer.findMany).not.toHaveBeenCalled();
  });

  it('Blocker 1: FB room ไม่มีเจ้าของเบอร์ → สร้างใหม่ · ไม่ใช้ composite match (null=null)', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(room());
    h.customer.create.mockResolvedValue({ id: 'cust-fb-new' });

    const result = await tool.run({ customerName: 'พี่เอฟบี', phone: '0877777777', downAmount: 490, roomId: 'room-1' });

    expect(result.customerId).toBe('cust-fb-new');
    expect(h.customer.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: 'พี่เอฟบี',
        phone: '0877777777',
        lineIdShop: null,
        acquisitionSource: 'AI_CHAT',
      }),
    }));
    expect(h.customer.findFirst).not.toHaveBeenCalled();
    expect(h.customer.update).not.toHaveBeenCalled();
    // เช็คเจ้าของเบอร์ทั้งก่อนและในทรานแซกชัน — ทั้งคอลัมน์ phone และ phoneHash
    expect(h.customer.findMany).toHaveBeenCalledTimes(2);
    expect(h.customer.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({
      where: { deletedAt: null, OR: [{ phone: '0877777777' }, { phoneHash: 'h:0877777777' }] },
      take: 2,
    }));
  });

  it('ไม่ส่ง QR / ไม่ชวนโอน แม้ตั้ง shop_bot_promptpay_id ไว้', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(room({ channel: 'LINE_SHOP', lineUserId: 'line-qr-user', externalUserId: null }));
    h.prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'shop_bot_central_branch_id', value: 'branch-central' },
      { key: 'shop_bot_promptpay_id', value: '0812345678' },
    ]);
    h.customer.create.mockResolvedValue({ id: 'cust-qr' });

    const result = await tool.run({
      customerName: 'พี่คิวอาร์', phone: '0866666666', productId: 'prod-qr', packageChoice: 'B', downAmount: 2900, roomId: 'room-1',
    });

    expect(result.customerId).toBe('cust-qr');
    // ห้ามชวนโอน/ส่ง QR ในแชทเด็ดขาด แม้ตั้งเลขพร้อมเพย์ไว้ (คำสั่งเจ้าของ 2026-08-22)
    expect(result.promptPayQr).toBeNull();
    expect(result.handoffMessage).not.toContain('QR');
    expect(result.handoffMessage).not.toContain('โอน' + 'เสร็จ');
    expect(result.handoffMessage).toContain('ยังไม่ต้องโอน');
    expect(result.handoffMessage).toContain('ติดต่อกลับ');
  });

  it('จัดรูปเบอร์ก่อนใช้ทุกที่: "081-234 5678" → "0812345678"', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(room());
    await tool.run({ customerName: 'ก', phone: '081-234 5678', downAmount: 1, roomId: 'room-1' });
    expect(h.customer.findMany.mock.calls[0][0].where.OR).toEqual([{ phone: '0812345678' }, { phoneHash: 'h:0812345678' }]);
    expect(h.customer.create.mock.calls[0][0].data.phone).toBe('0812345678');
    expect(auditValue(h).phone).toBe('0812345678');
  });

  it('เบอร์ว่าง (มีแต่ช่องว่าง) → ไม่โยน · สร้างโดย phone null · ไม่หาเจ้าของเบอร์', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(room({ channel: 'LINE_SHOP', lineUserId: 'line-u', externalUserId: null }));
    const result = await tool.run({ customerName: 'ก', phone: '   ', downAmount: 1, roomId: 'room-1' });
    expect(result.customerId).toBe('cust-new');
    expect(h.customer.findFirst).not.toHaveBeenCalled();
    expect(h.customer.findMany).not.toHaveBeenCalled();
    const data = h.customer.create.mock.calls[0][0].data;
    expect(data.phone).toBeNull();
    expect(data).not.toHaveProperty('phoneHash');
    expect(auditValue(h)).toEqual(expect.objectContaining({ phone: null, phoneOutcome: 'CREATED' }));
  });

  it('ห้องชี้ลูกค้าที่ถูก soft-delete → ถือว่าไม่มีเจ้าของ (ไปทางสร้าง/ผูก)', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(room({ customerId: 'dead', customer: { deletedAt: new Date() } }));
    const result = await tool.run({ customerName: 'ก', phone: '0800000000', downAmount: 1, roomId: 'room-1' });
    expect(result.customerId).toBe('cust-new');
    expect(h.customer.findUnique).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'dead' } }));
    expect(h.txClient.chatRoom.update.mock.calls[0][0].data.customerId).toBe('cust-new');
  });
});

describe('CaptureLeadTool — ห้องยังไม่มีเจ้าของ แต่มีคนถือเบอร์นี้อยู่แล้ว (Branch 2/3)', () => {
  let h: Harness;
  let tool: CaptureLeadTool;
  const input = { roomId: 'room-1', customerName: 'ฝน', phone: '0800000000', downAmount: 3200 } as const;

  beforeEach(async () => {
    h = makeHarness();
    tool = await buildTool(h);
  });

  it('FB · เจ้าของเบอร์ 1 คน ไม่ชนตัวตน → ผูกห้องเข้าคนเดิม ไม่สร้างใหม่ ไม่แตะชื่อ/เบอร์', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(room());
    h.customer.findMany.mockResolvedValue([owner('cust-owner')]);
    h.customer.findUnique.mockResolvedValue({ id: 'cust-owner', acquisitionSource: 'WALK_IN' });

    const result = await tool.run(input);

    expect(result.customerId).toBe('cust-owner');
    expect(h.customer.create).not.toHaveBeenCalled();
    expect(h.prospects.ensureForRoom).not.toHaveBeenCalled();
    expect(h.customer.update).toHaveBeenCalledWith({ where: { id: 'cust-owner' }, data: { acquisitionSource: 'AI_CHAT_RETURN' } });
    expect(h.txClient.chatRoom.update.mock.calls[0][0].data.customerId).toBe('cust-owner');
    expect(auditEntityId(h)).toBe('cust-owner');
    expect(auditValue(h)).toEqual(expect.objectContaining({ phoneOutcome: 'LINKED_BY_PHONE', phoneConflict: null }));
    expect(h.gateway.emitRoomUpdate).toHaveBeenCalledWith('room-1', expect.objectContaining({ customerId: 'cust-owner' }));
  });

  it('LINE ไม่ match composite · เจ้าของเบอร์ 1 คน lineIdShop ว่าง → ผูก · ไม่ตั้ง lineIdShop ให้คนเดิม · ที่มา CHAT_* คงเดิม', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(room({ channel: 'LINE_SHOP', lineUserId: 'U1', externalUserId: null }));
    h.customer.findMany.mockResolvedValue([owner('cust-owner')]);
    h.customer.findUnique.mockResolvedValue({ id: 'cust-owner', acquisitionSource: 'CHAT_LINE_SHOP' });

    const result = await tool.run(input);

    expect(result.customerId).toBe('cust-owner');
    expect(h.customer.update).not.toHaveBeenCalled();
    expect(h.customer.create).not.toHaveBeenCalled();
  });

  it('LINE · เจ้าของเบอร์มี lineIdShop ของคนอื่น → deferred ผ่าน ensureForRoom · เบอร์ไปช่องสำรอง', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(room({ channel: 'LINE_SHOP', lineUserId: 'U1', externalUserId: null }));
    h.customer.findMany.mockResolvedValue([owner('cust-owner', { lineIdShop: 'U-other' })]);
    h.customer.findUnique.mockResolvedValue({
      id: 'cust-ensured', phone: null, phoneSecondary: null, acquisitionSource: 'CHAT_LINE_SHOP', nationalId: null,
    });

    const result = await tool.run(input);

    expect(h.order).toEqual(['ensure', 'tx']);
    expect(result.customerId).toBe('cust-ensured');
    expect(h.customer.create).not.toHaveBeenCalled();
    const data = updateData(h);
    expect(data).toEqual({ name: 'ฝน', phoneSecondary: '0800000000', phoneSecondaryEncrypted: 'e:0800000000' });
    expect(auditValue(h)).toEqual(expect.objectContaining({
      phoneOutcome: 'DEFERRED',
      phoneConflict: { reason: 'IDENTITY_CONFLICT', customerIds: ['cust-owner'] },
    }));
  });

  it('เจ้าของเบอร์ 2 คน → deferred (AMBIGUOUS) · ensureForRoom คืนลูกค้าจริงที่มีเบอร์สำรองแล้ว → ไม่แตะเบอร์เลย', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(room());
    h.customer.findMany.mockResolvedValue([owner('o1'), owner('o2')]);
    h.prospects.ensureForRoom.mockResolvedValue({ customerId: 'cust-real', created: false });
    h.customer.findUnique.mockResolvedValue({
      id: 'cust-real', phone: '0811111111', phoneSecondary: '0822222222', acquisitionSource: 'WALK_IN', nationalId: null,
    });

    const result = await tool.run(input);

    expect(result.customerId).toBe('cust-real');
    const data = updateData(h);
    expect(data).toEqual({ name: 'ฝน', acquisitionSource: 'AI_CHAT_RETURN' });
    expect(auditValue(h)).toEqual(expect.objectContaining({
      phoneOutcome: 'DEFERRED',
      phoneConflict: { reason: 'AMBIGUOUS', customerIds: ['o1', 'o2'] },
    }));
  });

  it('deferred · ensureForRoom คืนเจ้าของเบอร์เอง (เบอร์หลักตรงอยู่แล้ว) → ไม่ย้ายเบอร์ไปช่องสำรอง', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(room());
    h.customer.findMany.mockResolvedValue([owner('o1'), owner('o2')]);
    h.prospects.ensureForRoom.mockResolvedValue({ customerId: 'o1', created: false });
    h.customer.findUnique.mockResolvedValue({
      id: 'o1', phone: '0800000000', phoneSecondary: null, acquisitionSource: 'AI_CHAT', nationalId: null,
    });
    await tool.run(input);
    expect(updateData(h)).toEqual({ name: 'ฝน', acquisitionSource: 'AI_CHAT_RETURN' });
  });

  it('deferred · ensureForRoom คืน null (ห้องไม่มีรหัสผู้ใช้) → สร้าง AI_CHAT โดย phone null + เบอร์สำรอง', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(room({ externalUserId: null, channel: 'WEB' }));
    h.customer.findMany.mockResolvedValue([owner('o1'), owner('o2')]);
    h.prospects.ensureForRoom.mockResolvedValue(null as never);

    const result = await tool.run(input);

    expect(result.customerId).toBe('cust-new');
    const data = h.customer.create.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({
      phone: null,
      phoneSecondary: '0800000000',
      phoneSecondaryEncrypted: 'e:0800000000',
      acquisitionSource: 'AI_CHAT',
    }));
    expect(data).not.toHaveProperty('phoneHash');
    expect(auditValue(h).phoneOutcome).toBe('DEFERRED');
  });

  it('แข่งกัน: ก่อนทรานแซกชันไม่มีเจ้าของ แต่ในทรานแซกชันมี → สร้างโดยไม่เขียนเบอร์หลัก', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(room());
    h.customer.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([owner('o-late')]);

    await tool.run(input);

    const data = h.customer.create.mock.calls[0][0].data;
    expect(data.phone).toBeNull();
    expect(data.phoneSecondary).toBe('0800000000');
    expect(h.prospects.ensureForRoom).not.toHaveBeenCalled();
    expect(auditValue(h)).toEqual(expect.objectContaining({
      phoneOutcome: 'DEFERRED',
      phoneConflict: { reason: 'AMBIGUOUS', customerIds: ['o-late'] },
    }));
  });
});

describe('CaptureLeadTool — ลูกค้าเดิมให้เบอร์ใหม่ (Branch 1)', () => {
  let h: Harness;
  let tool: CaptureLeadTool;
  const baseInput = { roomId: 'room-1', customerName: 'ฝน', phone: '0800000000', downAmount: 3200 } as const;

  beforeEach(async () => {
    h = makeHarness();
    h.prisma.chatRoom.findUnique.mockResolvedValue(boundRoom('cust-1'));
    tool = await buildTool(h);
  });

  it('ลูกค้าที่บอทสร้างเอง ไม่มีใครถือเบอร์ → อัปเดตเบอร์หลัก + hash/encrypted · มีเบอร์อยู่แล้วจึงไม่บันทึกการเดินทาง', async () => {
    h.customer.findUnique.mockResolvedValue({ id: 'cust-1', phone: '0890000000', phoneSecondary: null, acquisitionSource: 'AI_CHAT', nationalId: null });
    await tool.run(baseInput);
    expect(h.customer.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      id: { not: 'cust-1' },
      OR: [{ phone: '0800000000' }, { phoneHash: 'h:0800000000' }],
    });
    expect(h.customer.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cust-1' },
      data: expect.objectContaining({ phone: '0800000000', phoneHash: 'h:0800000000', phoneEncrypted: 'e:0800000000' }),
    }));
    expect(auditValue(h).phoneOutcome).toBe('FILLED');
    expect(h.journey.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('ลูกค้าที่บอทสร้างเอง แต่มีคนอื่นถือเบอร์ → ไม่รวม (ไม่ใช่ placeholder) · เบอร์ไปช่องสำรอง', async () => {
    h.customer.findUnique.mockResolvedValue({ id: 'cust-1', phone: '0890000000', phoneSecondary: null, acquisitionSource: 'AI_CHAT', nationalId: null });
    h.customer.findMany.mockResolvedValue([owner('o1')]);
    await tool.run(baseInput);
    expect(h.merge.absorbPlaceholder).not.toHaveBeenCalled();
    const data = updateData(h);
    expect(data.phone).toBeUndefined();
    expect(data).toEqual(expect.objectContaining({ phoneSecondary: '0800000000', phoneSecondaryEncrypted: 'e:0800000000' }));
    expect(auditValue(h)).toEqual(expect.objectContaining({
      phoneOutcome: 'DEFERRED',
      phoneConflict: { reason: 'NOT_PLACEHOLDER', customerIds: ['o1'] },
    }));
  });

  it('ลูกค้าที่พนักงานผูกไว้ → ไม่ทับเบอร์หลัก เก็บเป็นเบอร์สำรอง (+เข้ารหัส)', async () => {
    h.customer.findUnique.mockResolvedValue({ id: 'cust-1', phone: '0811111111', phoneSecondary: null, acquisitionSource: 'WALK_IN', nationalId: null });
    await tool.run(baseInput);
    const data = updateData(h);
    expect(data.phone).toBeUndefined();
    expect(data.phoneSecondary).toBe('0800000000');
    expect(data.phoneSecondaryEncrypted).toBe('e:0800000000');
    expect(auditValue(h).phoneOutcome).toBe('SECONDARY');
  });

  it('ลูกค้าที่พนักงานผูกไว้ มีเบอร์สำรองแล้ว → ไม่แตะเบอร์', async () => {
    h.customer.findUnique.mockResolvedValue({ id: 'cust-1', phone: '0811111111', phoneSecondary: '0822222222', acquisitionSource: 'WALK_IN', nationalId: null });
    await tool.run(baseInput);
    const data = updateData(h);
    expect(data).not.toHaveProperty('phoneSecondary');
    expect(data).not.toHaveProperty('phoneSecondaryEncrypted');
  });

  it('เบอร์เดิม → ไม่แตะช่องเบอร์เลย', async () => {
    h.customer.findUnique.mockResolvedValue({ id: 'cust-1', phone: '0800000000', phoneSecondary: null, acquisitionSource: 'AI_CHAT', nationalId: null });
    await tool.run(baseInput);
    const data = updateData(h);
    expect(data.phone).toBeUndefined();
    expect(data.phoneSecondary).toBeUndefined();
    expect(h.customer.findMany).not.toHaveBeenCalled();
    expect(auditValue(h).phoneOutcome).toBe('UNCHANGED');
  });

  it('audit log ต้องมีชื่อ+เบอร์ล่าสุดเสมอ (ทีมโทรกลับจากตรงนี้)', async () => {
    h.customer.findUnique.mockResolvedValue({ id: 'cust-1', phone: '0890000000', phoneSecondary: null, acquisitionSource: 'AI_CHAT', nationalId: null });
    await tool.run(baseInput);
    expect(h.txClient.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        newValue: expect.objectContaining({ customerName: 'ฝน', phone: '0800000000', absorbedPlaceholderId: null }),
      }),
    }));
  });
});

describe('CaptureLeadTool — ห้องถือผู้สนใจอัตโนมัติ (placeholder)', () => {
  let h: Harness;
  let tool: CaptureLeadTool;
  const baseInput = { roomId: 'room-1', customerName: 'สมชาย ใจดี', phone: '0812345678', downAmount: 3200 } as const;
  const placeholderRow = { id: 'p1', phone: null, phoneSecondary: null, acquisitionSource: 'CHAT_FACEBOOK', nationalId: null };

  beforeEach(async () => {
    h = makeHarness();
    h.prisma.chatRoom.findUnique.mockResolvedValue(boundRoom('p1'));
    tool = await buildTool(h);
  });

  it('ไม่มีใครถือเบอร์ → เติมชื่อ+เบอร์(+hash/encrypted) ไม่ทับที่มา CHAT_* · บันทึก CONTACT_ADDED หลัง commit', async () => {
    h.customer.findUnique.mockResolvedValue(placeholderRow);
    await tool.run(baseInput);
    expect(h.customer.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { name: 'สมชาย ใจดี', phone: '0812345678', phoneHash: 'h:0812345678', phoneEncrypted: 'e:0812345678' },
    });
    expect(h.journey.recordAfterCommit).toHaveBeenCalledTimes(1);
    const entry = h.journey.recordAfterCommit.mock.calls[0][0];
    expect(entry).toEqual(expect.objectContaining({
      customerId: 'p1', kind: 'CONTACT_ADDED', actorType: 'BOT', actorUserId: null,
      data: { fields: ['phone'], via: 'CAPTURE_LEAD' },
    }));
    expect(h.order).toEqual(['tx']);
    expect(auditValue(h).phoneOutcome).toBe('FILLED');
  });

  it('มีเจ้าของเบอร์ 1 คน ไม่ชนตัวตน → absorb ก่อนทรานแซกชัน · lead จบที่คนเดิม · ไม่แตะชื่อ/เบอร์ของคนเดิม', async () => {
    h.customer.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'p1' ? placeholderRow : { id: 'o1', acquisitionSource: 'CHAT_FACEBOOK' },
    );
    h.customer.findMany.mockResolvedValue([owner('o1', { facebookUserId: 'psid-1' })]);

    const result = await tool.run(baseInput);

    expect(h.merge.absorbPlaceholder).toHaveBeenCalledWith('p1', 'o1', SYSTEM_ACTOR);
    expect(h.order).toEqual(['absorb', 'tx']);
    expect(result.customerId).toBe('o1');
    // ที่มา CHAT_* ที่ absorb ยกมาให้ (R24) อ่านในทรานแซกชัน → ไม่ทับ ⇒ ไม่มี update ลูกค้าเลย
    expect(h.customer.update).not.toHaveBeenCalled();
    expect(h.txClient.chatRoom.update.mock.calls[0][0].data).toEqual(expect.objectContaining({ customerId: 'o1', handoffMode: true }));
    expect(auditEntityId(h)).toBe('o1');
    expect(auditValue(h)).toEqual(expect.objectContaining({
      phoneOutcome: 'ABSORBED', phoneConflict: null, absorbedPlaceholderId: 'p1',
    }));
    expect(h.gateway.emitRoomUpdate).toHaveBeenCalledWith('room-1', expect.objectContaining({ customerId: 'o1' }));
    expect(h.journey.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('absorb เจ้าของเบอร์ที่ไม่มีที่มา → ตั้ง AI_CHAT_RETURN อย่างเดียว (ไม่แตะชื่อ/เบอร์)', async () => {
    h.customer.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'p1' ? placeholderRow : { id: 'o1', acquisitionSource: null },
    );
    h.customer.findMany.mockResolvedValue([owner('o1')]);
    await tool.run(baseInput);
    expect(h.customer.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { acquisitionSource: 'AI_CHAT_RETURN' } });
  });

  it('absorb ล้ม (409) → deferred: ไม่เขียนเบอร์หลัก เบอร์ไปช่องสำรองของ placeholder', async () => {
    h.customer.findUnique.mockResolvedValue(placeholderRow);
    h.customer.findMany.mockResolvedValue([owner('o1')]);
    h.merge.absorbPlaceholder.mockRejectedValue(new ConflictException('รวมไม่ได้'));

    const result = await tool.run(baseInput);

    expect(result.customerId).toBe('p1');
    expect(updateData(h)).toEqual({
      name: 'สมชาย ใจดี', phoneSecondary: '0812345678', phoneSecondaryEncrypted: 'e:0812345678',
    });
    expect(auditValue(h)).toEqual(expect.objectContaining({
      phoneOutcome: 'DEFERRED',
      phoneConflict: { reason: 'ABSORB_FAILED', customerIds: ['o1'] },
      absorbedPlaceholderId: null,
    }));
  });

  it('เจ้าของเบอร์ 2 คน → ไม่ absorb · deferred · มีเบอร์สำรองแล้วไม่ทับ', async () => {
    h.customer.findUnique.mockResolvedValue({ ...placeholderRow, phoneSecondary: '0899999999' });
    h.customer.findMany.mockResolvedValue([owner('o1'), owner('o2')]);
    await tool.run(baseInput);
    expect(h.merge.absorbPlaceholder).not.toHaveBeenCalled();
    expect(updateData(h)).toEqual({ name: 'สมชาย ใจดี' });
    expect(auditValue(h).phoneConflict).toEqual({ reason: 'AMBIGUOUS', customerIds: ['o1', 'o2'] });
  });

  it('FB · เจ้าของเบอร์มี PSID คนละคน → IDENTITY_CONFLICT ไม่ absorb', async () => {
    h.customer.findUnique.mockResolvedValue(placeholderRow);
    h.customer.findMany.mockResolvedValue([owner('o1', { facebookUserId: 'psid-other' })]);
    await tool.run(baseInput);
    expect(h.merge.absorbPlaceholder).not.toHaveBeenCalled();
    expect(updateData(h).phone).toBeUndefined();
    expect(auditValue(h).phoneConflict).toEqual({ reason: 'IDENTITY_CONFLICT', customerIds: ['o1'] });
  });

  it('LINE_SHOP · เจ้าของเบอร์ผูก LINE ร้านคนอื่น → IDENTITY_CONFLICT · LINE_FINANCE ของคนเดิมไม่นับ', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(boundRoom('p1', { channel: 'LINE_SHOP', lineUserId: 'U1', externalUserId: null }));
    h.customer.findUnique.mockResolvedValue({ ...placeholderRow, acquisitionSource: 'CHAT_LINE_SHOP' });
    h.customer.findMany.mockResolvedValue([owner('o1', { lineIdShop: 'U-other' })]);
    await tool.run(baseInput);
    expect(h.merge.absorbPlaceholder).not.toHaveBeenCalled();
    expect(auditValue(h).phoneConflict).toEqual({ reason: 'IDENTITY_CONFLICT', customerIds: ['o1'] });
  });

  it('LINE_SHOP · เจ้าของเบอร์มีแค่ lineIdFinance ของคนอื่น → ไม่ชน · absorb', async () => {
    h.prisma.chatRoom.findUnique.mockResolvedValue(boundRoom('p1', { channel: 'LINE_SHOP', lineUserId: 'U1', externalUserId: null }));
    h.customer.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'p1' ? { ...placeholderRow, acquisitionSource: 'CHAT_LINE_SHOP' } : { id: 'o1', acquisitionSource: 'WALK_IN' },
    );
    h.customer.findMany.mockResolvedValue([owner('o1', { lineIdFinance: 'U-fin', lineIdShop: 'U1' })]);
    await tool.run(baseInput);
    expect(h.merge.absorbPlaceholder).toHaveBeenCalledWith('p1', 'o1', SYSTEM_ACTOR);
  });

  it('แข่งกัน: ก่อนทรานแซกชันไม่มีเจ้าของ ในทรานแซกชันมี → deferred ไม่ absorb ในทรานแซกชัน', async () => {
    h.customer.findUnique.mockResolvedValue(placeholderRow);
    h.customer.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([owner('o-late')]);
    await tool.run(baseInput);
    expect(h.merge.absorbPlaceholder).not.toHaveBeenCalled();
    expect(updateData(h)).toEqual({
      name: 'สมชาย ใจดี', phoneSecondary: '0812345678', phoneSecondaryEncrypted: 'e:0812345678',
    });
    expect(auditValue(h)).toEqual(expect.objectContaining({
      phoneOutcome: 'DEFERRED',
      phoneConflict: { reason: 'AMBIGUOUS', customerIds: ['o-late'] },
    }));
    expect(h.journey.recordAfterCommit).not.toHaveBeenCalled();
  });

  // Ruling R14 (fix round 1): ที่มา CHAT_* ห้ามถูกทับไม่ว่าจะยังเป็น placeholder อยู่หรือไม่
  // (เช็คจาก acquisitionSource ปัจจุบันตรงๆ ไม่ใช่จาก isChatPlaceholder).
  it('Ruling R14: capture รอบสองบนลูกค้าที่มี CHAT_FACEBOOK + มีเบอร์แล้ว (ไม่ใช่ placeholder แล้ว) → ยังไม่ทับที่มา', async () => {
    h.customer.findUnique.mockResolvedValue({ ...placeholderRow, phone: '0899999999' });
    await tool.run(baseInput);
    const data = updateData(h);
    expect(data).not.toHaveProperty('acquisitionSource');
    // ไม่ใช่ placeholder และไม่ใช่ AI_CHAT ⇒ ไปลง phoneSecondary เหมือนเดิม
    expect(data.phone).toBeUndefined();
    expect(data.phoneSecondary).toBe('0812345678');
  });

  it('regression pin: ลูกค้า WALK_IN (ไม่ใช่ CHAT_* เลย) → ยังทับที่มาเป็น AI_CHAT_RETURN ตามเดิม', async () => {
    h.customer.findUnique.mockResolvedValue({ ...placeholderRow, phone: '0811111111', acquisitionSource: 'WALK_IN' });
    await tool.run(baseInput);
    expect(updateData(h).acquisitionSource).toBe('AI_CHAT_RETURN');
  });

  it('audit log ยังบันทึกชื่อ+เบอร์ล่าสุดตามปกติแม้เป็น placeholder', async () => {
    h.customer.findUnique.mockResolvedValue({ ...placeholderRow, acquisitionSource: 'CHAT_LINE_SHOP' });
    await tool.run(baseInput);
    expect(auditValue(h)).toEqual(expect.objectContaining({ customerName: 'สมชาย ใจดี', phone: '0812345678' }));
  });
});

describe('CaptureLeadTool — สวิตช์ช่วงทดสอบ shop_bot_lead_handoff_enabled', () => {
  let h: Harness;
  let tool: CaptureLeadTool;
  const input = { roomId: 'room-1', customerName: 'ฝน', phone: '0800000000', downAmount: 3200 } as const;

  beforeEach(async () => {
    h = makeHarness();
    h.customer.create.mockResolvedValue({ id: 'c-new' });
    h.prisma.chatRoom.findUnique.mockResolvedValue(room());
    tool = await buildTool(h);
  });

  it("= 'false' → เก็บ lead + audit ตามปกติ แต่ไม่ปักธง handoff (บอทคุยต่อได้)", async () => {
    h.prisma.systemConfig.findMany.mockResolvedValue([
      { key: 'shop_bot_central_branch_id', value: 'b1' },
      { key: 'shop_bot_lead_handoff_enabled', value: 'false' },
    ]);
    await tool.run(input);
    const data = h.txClient.chatRoom.update.mock.calls[0][0].data;
    expect(data.customerId).toBe('c-new');
    expect(data.handoffMode).toBeUndefined();
    expect(h.txClient.auditLog.create).toHaveBeenCalled();
  });

  it('ไม่มีแถว → ปักธง handoff ตามดีไซน์ (ค่า go-live)', async () => {
    h.prisma.systemConfig.findMany.mockResolvedValue([{ key: 'shop_bot_central_branch_id', value: 'b1' }]);
    await tool.run(input);
    const data = h.txClient.chatRoom.update.mock.calls[0][0].data;
    expect(data.handoffMode).toBe(true);
    expect(data.handoffReason).toBe('lead_captured');
  });
});
