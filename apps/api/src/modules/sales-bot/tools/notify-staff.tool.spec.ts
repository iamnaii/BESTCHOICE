import { ChatPriority } from '@prisma/client';
import {
  NOTIFY_STAFF_REASON_MAX,
  NOTIFY_STAFF_TOOL,
  NotifyStaffTool,
  mergeNotifyStaffReason,
} from './notify-staff.tool';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { IChatGateway } from '../../chat-engine/interfaces/chat-gateway.interface';
import { hasPendingBotStaffAttention } from '../../chat-engine/constants/bot-staff-attention';

const P = '[บอทขอให้พนักงานตามต่อ]';

const makeTool = (withGateway = true) => {
  const chatRoom = {
    findUnique: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const gateway = { emitRoomUpdate: jest.fn(), emitNewMessage: jest.fn(), emitToStaff: jest.fn() };
  const tool = new NotifyStaffTool(
    { chatRoom } as unknown as PrismaService,
    withGateway ? (gateway as unknown as IChatGateway) : undefined,
  );
  return { tool, chatRoom, gateway };
};

describe('NotifyStaffTool.run — ปักธงให้พนักงานโดยไม่ปิดบอท (คำตัดสิน 2026-09-22)', () => {
  it('บันทึกเหตุผล + เวลา แต่ไม่แตะ handoffMode (บอทยังตอบเทิร์นถัดไปได้)', async () => {
    const { tool, chatRoom } = makeTool();
    const r = await tool.run({ reason: 'iPhone 15 128GB ขอดูรูปเครื่องจริง', roomId: 'room-1' });
    expect(r).toEqual({ staffNotified: true });
    expect(chatRoom.update).toHaveBeenCalledWith({
      where: { id: 'room-1' },
      data: {
        handoffReason: '[บอทขอให้พนักงานตามต่อ] iPhone 15 128GB ขอดูรูปเครื่องจริง',
        handoffTaggedAt: expect.any(Date),
      },
    });
    for (const call of [...chatRoom.update.mock.calls, ...chatRoom.updateMany.mock.calls]) {
      expect(call[0].data).not.toHaveProperty('handoffMode');
      expect(call[0].data).not.toHaveProperty('aiPaused');
    }
  });

  it('ยกห้องขึ้น "ด่วน" (HIGH) เฉพาะห้องที่ LOW/NORMAL — ไม่ลดห้องที่ CRITICAL', async () => {
    const { tool, chatRoom } = makeTool();
    await tool.run({ reason: 'ขอราคาเงินสด iPhone 16', roomId: 'room-2' });
    expect(chatRoom.updateMany).toHaveBeenCalledWith({
      where: { id: 'room-2', priority: { in: [ChatPriority.LOW, ChatPriority.NORMAL] } },
      data: { priority: ChatPriority.HIGH },
    });
  });

  it('แจ้งกล่องแชทพนักงานแบบ realtime (payload ไม่มี handoffMode)', async () => {
    const { tool, gateway } = makeTool();
    await tool.run({ reason: 'ลูกค้าเก่า: ส่งสลิปค่างวด', roomId: 'room-3' });
    expect(gateway.emitRoomUpdate).toHaveBeenCalledWith('room-3', {
      event: 'staff_attention',
      roomId: 'room-3',
      priority: ChatPriority.HIGH,
      reason: '[บอทขอให้พนักงานตามต่อ] ลูกค้าเก่า: ส่งสลิปค่างวด',
    });
    expect(gateway.emitRoomUpdate.mock.calls[0][1]).not.toHaveProperty('handoffMode');
  });

  it('ไม่มี gateway (spec/CLI) ก็ยังปักธงได้', async () => {
    const { tool, chatRoom } = makeTool(false);
    await expect(tool.run({ reason: 'x', roomId: 'r' })).resolves.toEqual({ staffNotified: true });
    expect(chatRoom.update).toHaveBeenCalled();
  });

  it('เหตุผลว่าง → ใส่ข้อความตั้งต้น · เหตุผลยาวถูกตัดที่ 300 ตัวอักษร', async () => {
    const { tool, chatRoom } = makeTool();
    await tool.run({ reason: '   ', roomId: 'r' });
    expect(chatRoom.update.mock.calls[0][0].data.handoffReason).toBe(
      '[บอทขอให้พนักงานตามต่อ] ลูกค้าขอข้อมูลเครื่องจริง',
    );
    await tool.run({ reason: 'ก'.repeat(500), roomId: 'r' });
    expect(chatRoom.update.mock.calls[1][0].data.handoffReason).toHaveLength(
      '[บอทขอให้พนักงานตามต่อ] '.length + 300,
    );
  });

  it('เหตุผลที่บันทึกถูกตัวตรวจคำขอของ chat-engine จำได้ (prefix แหล่งเดียวกัน · handoffMode = false)', async () => {
    const { tool, chatRoom } = makeTool();
    const now = new Date('2026-09-22T10:00:00Z');
    await tool.run({ reason: 'iPhone 15 ขอดูรูปเครื่องจริง', roomId: 'r' });
    const data = chatRoom.update.mock.calls[0][0].data;
    expect(
      hasPendingBotStaffAttention({ handoffMode: false, handoffReason: data.handoffReason, handoffTaggedAt: now }, now),
    ).toBe(true);
  });

  describe('ยกป้าย/แจ้ง realtime เป็นของเสริม — ล้มแล้วคำตอบของเทิร์นต้องไม่หาย (รีวิว SB-V5)', () => {
    it('ยกป้าย "ด่วน" พัง → ยังคืน staffNotified (เหตุผลบันทึกแล้ว) · payload ไม่อ้างว่า HIGH', async () => {
      const { tool, chatRoom, gateway } = makeTool();
      chatRoom.updateMany.mockRejectedValueOnce(new Error('deadlock'));
      await expect(tool.run({ reason: 'ขอราคาเงินสด', roomId: 'r' })).resolves.toEqual({ staffNotified: true });
      expect(chatRoom.update).toHaveBeenCalled();
      expect(gateway.emitRoomUpdate.mock.calls[0][1]).not.toHaveProperty('priority');
    });

    it('ส่ง realtime พัง → ยังคืน staffNotified', async () => {
      const { tool, gateway } = makeTool();
      gateway.emitRoomUpdate.mockImplementationOnce(() => {
        throw new Error('socket down');
      });
      await expect(tool.run({ reason: 'x', roomId: 'r' })).resolves.toEqual({ staffNotified: true });
    });

    it('อ่านห้องไม่ได้ → บันทึกเหตุผลของรอบนี้อย่างเดียว ไม่ล้ม', async () => {
      const { tool, chatRoom } = makeTool();
      chatRoom.findUnique.mockRejectedValueOnce(new Error('timeout'));
      await expect(tool.run({ reason: 'ขอราคาเงินสด', roomId: 'r' })).resolves.toEqual({ staffNotified: true });
      expect(chatRoom.update.mock.calls[0][0].data.handoffReason).toBe(`${P} ขอราคาเงินสด`);
    });

    it('บันทึกเหตุผลไม่ได้ = งานหลักล้ม → โยนต่อ (ผู้เรียกบันทึก tool_error)', async () => {
      const { tool, chatRoom } = makeTool();
      chatRoom.update.mockRejectedValueOnce(new Error('P2025'));
      await expect(tool.run({ reason: 'x', roomId: 'gone' })).rejects.toThrow('P2025');
    });

    it('ห้อง CRITICAL (ไม่ถูกยก) → payload บอก CRITICAL ไม่ใช่ HIGH', async () => {
      const { tool, chatRoom, gateway } = makeTool();
      chatRoom.findUnique.mockResolvedValueOnce({
        handoffMode: false,
        handoffReason: null,
        handoffTaggedAt: null,
        priority: ChatPriority.CRITICAL,
      });
      chatRoom.updateMany.mockResolvedValueOnce({ count: 0 });
      await tool.run({ reason: 'x', roomId: 'r' });
      expect(gateway.emitRoomUpdate.mock.calls[0][1].priority).toBe(ChatPriority.CRITICAL);
    });
  });

  describe('คำขอที่สองในห้องเดียวกันต่อท้าย ไม่ทับคำขอที่ยังค้าง (รีวิว SB-V5)', () => {
    const now = new Date('2026-09-22T10:00:00Z');
    const pending = (reason: string, hoursAgo = 1, handoffMode = false) => ({
      handoffMode,
      handoffReason: reason,
      handoffTaggedAt: new Date(now.getTime() - hoursAgo * 3_600_000),
    });

    it('คำขอค้าง (≤24 ชม.) → ต่อท้ายด้วย " · "', () => {
      expect(mergeNotifyStaffReason('ขอราคาเงินสด', pending(`${P} iPhone 15 ขอดูรูปเครื่องจริง`), now)).toBe(
        `${P} iPhone 15 ขอดูรูปเครื่องจริง · ขอราคาเงินสด`,
      );
    });

    it('คำขอหมดอายุ / ห้องถูกส่งต่อพนักงานเต็มตัว / เหตุผลอื่นที่ไม่ใช่ของบอท → เขียนใหม่', () => {
      expect(mergeNotifyStaffReason('ขอราคาเงินสด', pending(`${P} เก่า`, 30), now)).toBe(`${P} ขอราคาเงินสด`);
      expect(mergeNotifyStaffReason('ขอราคาเงินสด', pending(`${P} เก่า`, 1, true), now)).toBe(`${P} ขอราคาเงินสด`);
      expect(mergeNotifyStaffReason('ขอราคาเงินสด', pending('AI ไม่มั่นใจ'), now)).toBe(`${P} ขอราคาเงินสด`);
      expect(mergeNotifyStaffReason('ขอราคาเงินสด', null, now)).toBe(`${P} ขอราคาเงินสด`);
    });

    it('เรื่องซ้ำไม่เพิ่มซ้ำ (ย้ายไปท้ายสุด)', () => {
      expect(mergeNotifyStaffReason('ก', pending(`${P} ก · ข`), now)).toBe(`${P} ข · ก`);
    });

    it('ยาวเกินเพดาน → ทิ้งคำขอเก่าสุดก่อน คำขอล่าสุดอยู่เสมอ', () => {
      const old1 = 'ก'.repeat(150);
      const old2 = 'ข'.repeat(150);
      const merged = mergeNotifyStaffReason('ค'.repeat(100), pending(`${P} ${old1} · ${old2}`), now);
      expect(merged).toBe(`${P} ${old2} · ${'ค'.repeat(100)}`);
      expect(merged.length - `${P} `.length).toBeLessThanOrEqual(NOTIFY_STAFF_REASON_MAX);
    });

    it('run(): อ่านคำขอเดิมจากห้องแล้วบันทึกแบบต่อท้าย', async () => {
      const { tool, chatRoom } = makeTool();
      chatRoom.findUnique.mockResolvedValueOnce({
        ...pending(`${P} iPhone 15 ขอดูรูปเครื่องจริง`, 0),
        handoffTaggedAt: new Date(),
        priority: ChatPriority.HIGH,
      });
      await tool.run({ reason: 'ขอราคาเงินสด', roomId: 'r' });
      expect(chatRoom.update.mock.calls[0][0].data.handoffReason).toBe(
        `${P} iPhone 15 ขอดูรูปเครื่องจริง · ขอราคาเงินสด`,
      );
    });
  });

  it('คำอธิบายเครื่องมือ: บอทยังตอบต่อ + ครองงานบริการลูกค้าเก่า (synth C06)', () => {
    const d = NOTIFY_STAFF_TOOL.description;
    expect(d).toContain('บอทยังตอบห้องนี้ต่อได้ตามปกติ');
    for (const s of ['ส่งสลิป', 'วันครบกำหนด', 'ปลดล็อก', 'แอปธนาคาร', 'เลื่อนงวด', 'ผ่อนเครื่องเพิ่ม']) {
      expect(d).toContain(s);
    }
    // ประโยคเดิม "แล้วพนักงานจะคุยต่อเอง" สั่งให้บอทหยุด — ต้องไม่อยู่แล้ว
    expect(d).not.toContain('พนักงานจะคุยต่อเอง');
  });
});
