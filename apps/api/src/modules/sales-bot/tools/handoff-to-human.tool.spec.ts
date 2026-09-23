import { HandoffToHumanTool } from './handoff-to-human.tool';
import { BOT_STAFF_ATTENTION_PREFIX } from '../../chat-engine/constants/bot-staff-attention';

/**
 * ตรวจข้ามเลน 2026-09-23 (รีวิว RT-X5): handoff_to_human เคยเขียนทับ handoffReason ทิ้ง
 * คำขอของ notify_staff — พอ handoffMode = true แล้วไม่มีใคร merge ให้อีก พนักงานจึงไม่เห็น
 * ว่าบอทขออะไรไว้ (HandoffManager merge ให้เฉพาะห้องที่ยังไม่ handoff)
 */
describe('HandoffToHumanTool — ไม่เขียนทับคำขอของ notify_staff', () => {
  function build(current: unknown) {
    const prisma = {
      chatRoom: {
        findUnique: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    return { tool: new HandoffToHumanTool(prisma as any, undefined), prisma };
  }

  const input = { reason: 'info_request', roomId: 'room-1' };

  it('มีคำขอของบอทค้าง → ต่อท้ายเหตุผลรอบนี้', async () => {
    const pending = `${BOT_STAFF_ATTENTION_PREFIX} ขอดูรูปเครื่องจริง iPhone 16`;
    const { tool, prisma } = build({
      handoffMode: false,
      handoffReason: pending,
      handoffTaggedAt: new Date(),
    });
    await tool.run(input);
    expect(prisma.chatRoom.update.mock.calls[0][0].data.handoffReason).toBe(
      `info_request · ${pending}`,
    );
  });

  it('ไม่มีคำขอค้าง / คำขอเก่าเกิน 24 ชม. / อ่านห้องไม่ได้ → ใช้เหตุผลรอบนี้ตามเดิม', async () => {
    const stale = {
      handoffMode: false,
      handoffReason: `${BOT_STAFF_ATTENTION_PREFIX} ขอราคาเงินสด`,
      handoffTaggedAt: new Date(Date.now() - 25 * 3_600_000),
    };
    for (const current of [null, { handoffMode: false, handoffReason: null, handoffTaggedAt: null }, stale]) {
      const { tool, prisma } = build(current);
      await tool.run(input);
      expect(prisma.chatRoom.update.mock.calls[0][0].data.handoffReason).toBe('info_request');
    }

    const prisma = {
      chatRoom: {
        findUnique: jest.fn().mockRejectedValue(new Error('db down')),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    await new HandoffToHumanTool(prisma as any, undefined).run(input);
    expect(prisma.chatRoom.update.mock.calls[0][0].data.handoffReason).toBe('info_request');
  });
});
