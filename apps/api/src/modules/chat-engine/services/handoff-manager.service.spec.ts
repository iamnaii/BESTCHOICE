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
