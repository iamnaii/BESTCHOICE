import { ChatPriority, ChatRoomStatus } from '@prisma/client';
import { HandoffManagerService } from './handoff-manager.service';

describe('HandoffManagerService.initiateHandoff → BOT_HANDOFF (writer mocked)', () => {
  const params = {
    roomId: 'room-1',
    reason: 'AI ไม่มั่นใจในการตอบ — ส่งต่อให้พนักงาน',
    priority: 'normal' as const,
    summary: 'ขอคุยกับคนหน่อย เบอร์ 0812345678',
  };
  let prisma: { chatRoom: { update: jest.Mock } };
  let gateway: { emitRoomUpdate: jest.Mock };
  let journey: { recordAfterCommit: jest.Mock };

  beforeEach(() => {
    prisma = { chatRoom: { update: jest.fn().mockResolvedValue({ customerId: 'cust-1' }) } };
    gateway = { emitRoomUpdate: jest.fn() };
    journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
  });

  function build(withWriter = true): HandoffManagerService {
    return new HandoffManagerService(prisma as any, gateway as any, withWriter ? (journey as any) : undefined);
  }

  it('ห้องมีเจ้าของ → ตั้งห้องเหมือนเดิม แล้วบันทึก BOT_HANDOFF ด้วยเวลาเดียวกับ handoffTaggedAt', async () => {
    await build().initiateHandoff(params);

    const updateArgs = prisma.chatRoom.update.mock.calls[0][0];
    expect(updateArgs).toEqual({
      where: { id: 'room-1' },
      data: {
        handoffMode: true,
        handoffReason: params.reason,
        handoffTaggedAt: expect.any(Date),
        status: ChatRoomStatus.ACTIVE,
        priority: ChatPriority.NORMAL,
      },
      select: { customerId: true },
    });
    const taggedAt = updateArgs.data.handoffTaggedAt as Date;
    expect(gateway.emitRoomUpdate).toHaveBeenCalledWith('room-1', expect.objectContaining({ event: 'handoff' }));
    expect(journey.recordAfterCommit).toHaveBeenCalledTimes(1);
    expect(journey.recordAfterCommit).toHaveBeenCalledWith({
      customerId: 'cust-1',
      kind: 'BOT_HANDOFF',
      occurredAt: taggedAt,
      actorType: 'BOT',
      actorUserId: null,
      roomId: 'room-1',
      refType: null,
      refId: null,
      data: { priority: 'normal', reasonCode: 'LOW_CONFIDENCE' },
      dedupeKey: `BOT_HANDOFF:room-1:${taggedAt.getTime()}`,
    });
    expect(Object.keys(journey.recordAfterCommit.mock.calls[0][0].data)).toEqual(['priority', 'reasonCode']);
  });

  it('PDPA: ข้อความลูกค้า (summary) และข้อความเหตุผลไม่หลุดเข้าแถว', async () => {
    await build().initiateHandoff(params);
    const json = JSON.stringify(journey.recordAfterCommit.mock.calls[0][0]);
    expect(json).not.toContain('ขอคุยกับคนหน่อย');
    expect(json).not.toContain('0812345678');
    expect(json).not.toContain(params.reason);
  });

  it('ห้องยังไม่มีเจ้าของ (customerId null) → handoff ทำงานครบ แต่ไม่บันทึก', async () => {
    prisma.chatRoom.update.mockResolvedValue({ customerId: null });
    await build().initiateHandoff(params);
    expect(gateway.emitRoomUpdate).toHaveBeenCalled();
    expect(journey.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('ไม่มี writer ต่อสาย (@Optional) → handoff ไม่พัง', async () => {
    await expect(build(false).initiateHandoff(params)).resolves.toBeUndefined();
    expect(gateway.emitRoomUpdate).toHaveBeenCalled();
  });

  it('ตั้งห้องล้ม (prisma โยน) → ไม่บันทึก และโยนต่อให้ผู้เรียกเหมือนเดิม', async () => {
    prisma.chatRoom.update.mockRejectedValue(new Error('room gone'));
    await expect(build().initiateHandoff(params)).rejects.toThrow('room gone');
    expect(journey.recordAfterCommit).not.toHaveBeenCalled();
  });
});

describe('HandoffManagerService.initiateHandoff — ไม่เขียนทับคำขอของบอทที่ยังค้าง (notify_staff, 2026-09-22)', () => {
  const params = {
    roomId: 'room-1',
    reason: 'AI ไม่มั่นใจในการตอบ — ส่งต่อให้พนักงาน',
    priority: 'normal' as const,
    summary: 'ผ่อนเดือนละเท่าไหร่',
  };
  const pending = '[บอทขอให้พนักงานตามต่อ] iPhone 15 ขอดูรูปเครื่องจริง';

  function build(current: unknown, opts: { throwOnRead?: boolean } = {}) {
    const prisma = {
      chatRoom: {
        findUnique: opts.throwOnRead
          ? jest.fn().mockRejectedValue(new Error('db down'))
          : jest.fn().mockResolvedValue(current),
        update: jest.fn().mockResolvedValue({ customerId: 'cust-1' }),
      },
    };
    const journey = { recordAfterCommit: jest.fn().mockResolvedValue(undefined) };
    const gateway = { emitRoomUpdate: jest.fn() };
    return { svc: new HandoffManagerService(prisma as any, gateway as any, journey as any), prisma, journey, gateway };
  }

  it('ห้องมีคำขอของบอทค้าง (ไม่ได้อยู่ใน handoff) → ต่อท้ายเหตุผล · รหัสเหตุผลในการเดินทางยังเป็นของรอบนี้', async () => {
    const { svc, prisma, journey, gateway } = build({
      handoffMode: false,
      handoffReason: pending,
      handoffTaggedAt: new Date(),
      priority: ChatPriority.HIGH, // notify_staff ยกเป็น "ด่วน"
    });
    await svc.initiateHandoff(params);
    expect(prisma.chatRoom.update.mock.calls[0][0].data.handoffReason).toBe(`${params.reason} · ${pending}`);
    // ไม่ลดป้าย "ด่วน" ของคำขอที่ค้างลงเป็น NORMAL
    expect(prisma.chatRoom.update.mock.calls[0][0].data.priority).toBe(ChatPriority.HIGH);
    expect(gateway.emitRoomUpdate).toHaveBeenCalledWith(
      'room-1',
      expect.objectContaining({ reason: `${params.reason} · ${pending}` }),
    );
    expect(journey.recordAfterCommit.mock.calls[0][0].data.reasonCode).toBe('LOW_CONFIDENCE');
  });

  it('คำขอเก่าเกิน 24 ชม. / เหตุผลอื่น / ห้องอยู่ใน handoff แล้ว → ใช้เหตุผลรอบนี้ตามเดิม', async () => {
    for (const current of [
      {
        handoffMode: false,
        handoffReason: pending,
        handoffTaggedAt: new Date(Date.now() - 25 * 3_600_000),
        priority: ChatPriority.HIGH,
      },
      { handoffMode: false, handoffReason: 'lead_captured', handoffTaggedAt: new Date(), priority: ChatPriority.HIGH },
      { handoffMode: true, handoffReason: pending, handoffTaggedAt: new Date(), priority: ChatPriority.HIGH },
      null,
    ]) {
      const { svc, prisma } = build(current);
      await svc.initiateHandoff(params);
      expect(prisma.chatRoom.update.mock.calls[0][0].data.handoffReason).toBe(params.reason);
      expect(prisma.chatRoom.update.mock.calls[0][0].data.priority).toBe(ChatPriority.NORMAL);
    }
  });

  it('อ่านห้องไม่ได้ → ยังส่งต่อพนักงานได้ด้วยเหตุผลรอบนี้', async () => {
    const { svc, prisma } = build(null, { throwOnRead: true });
    await expect(svc.initiateHandoff(params)).resolves.toBeUndefined();
    expect(prisma.chatRoom.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ handoffMode: true, handoffReason: params.reason }),
    );
  });
});

describe('HandoffManagerService.resolveHandoff → ลดป้าย "ด่วน" ของคำขอบอท (ตรวจข้ามเลน 2026-09-23)', () => {
  const PREFIX = '[บอทขอให้พนักงานตามต่อ]';

  function build(room: { handoffReason: string | null; priority: ChatPriority }) {
    const prisma = {
      chatRoom: {
        findUnique: jest.fn().mockResolvedValue({ id: 'room-1', ...room }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    return {
      svc: new HandoffManagerService(prisma as any, undefined as any, undefined),
      prisma,
    };
  }

  it('เหตุผลมี prefix ของบอท + ห้อง HIGH → ลดเป็น NORMAL พร้อมล้างเหตุผล', async () => {
    const { svc, prisma } = build({
      handoffReason: `${PREFIX} ขอดูรูปเครื่องจริง iPhone 16`,
      priority: ChatPriority.HIGH,
    });
    await svc.resolveHandoff('room-1', true);
    expect(prisma.chatRoom.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        handoffMode: false,
        handoffReason: null,
        priority: ChatPriority.NORMAL,
      }),
    );
  });

  it('คำขอบอทถูกต่อท้ายเหตุผลส่งต่อ (merge) → ยังลดป้ายให้', async () => {
    const { svc, prisma } = build({
      handoffReason: `AI ไม่มั่นใจในการตอบ · ${PREFIX} ขอราคาเงินสด`,
      priority: ChatPriority.HIGH,
    });
    await svc.resolveHandoff('room-1', true);
    expect(prisma.chatRoom.update.mock.calls[0][0].data.priority).toBe(ChatPriority.NORMAL);
  });

  it('ห้อง CRITICAL หรือเหตุผลอื่น → ไม่แตะความด่วน', async () => {
    for (const room of [
      { handoffReason: `${PREFIX} ขอดูรูป`, priority: ChatPriority.CRITICAL },
      { handoffReason: 'ลูกค้าขอคุยกับพนักงาน', priority: ChatPriority.HIGH },
      { handoffReason: null, priority: ChatPriority.HIGH },
    ]) {
      const { svc, prisma } = build(room);
      await svc.resolveHandoff('room-1', true);
      expect(prisma.chatRoom.update.mock.calls[0][0].data.priority).toBeUndefined();
    }
  });
});
