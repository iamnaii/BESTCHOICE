import {
  BOT_STAFF_ATTENTION_PREFIX,
  hasPendingBotStaffAttention,
  mergeWithBotStaffAttention,
} from './bot-staff-attention';

describe('bot-staff-attention — คำขอของบอทให้พนักงานตามต่อ (notify_staff)', () => {
  const now = new Date('2026-09-22T10:00:00.000Z');
  const reason = `${BOT_STAFF_ATTENTION_PREFIX} iPhone 15 ขอดูรูปเครื่องจริง`;

  it('ค้างอยู่เมื่อ: ไม่อยู่ใน handoff + ขึ้นต้น prefix + ไม่เกิน 24 ชม. (ไม่มีเวลาปักธง = ยังค้าง)', () => {
    expect(
      hasPendingBotStaffAttention(
        { handoffMode: false, handoffReason: reason, handoffTaggedAt: now },
        now,
      ),
    ).toBe(true);
    expect(
      hasPendingBotStaffAttention(
        { handoffMode: false, handoffReason: reason, handoffTaggedAt: null },
        now,
      ),
    ).toBe(true);
    expect(
      hasPendingBotStaffAttention(
        {
          handoffMode: false,
          handoffReason: reason,
          handoffTaggedAt: new Date(now.getTime() - 25 * 3_600_000),
        },
        now,
      ),
    ).toBe(false);
    expect(
      hasPendingBotStaffAttention(
        { handoffMode: true, handoffReason: reason, handoffTaggedAt: now },
        now,
      ),
    ).toBe(false);
    expect(
      hasPendingBotStaffAttention({ handoffMode: false, handoffReason: 'lead_captured' }, now),
    ).toBe(false);
    expect(hasPendingBotStaffAttention(null, now)).toBe(false);
  });

  it('merge ต่อท้ายคำขอที่ค้าง · ไม่ซ้ำถ้ามีอยู่แล้ว · ไม่ค้าง = เหตุผลเดิม', () => {
    const room = { handoffMode: false, handoffReason: reason, handoffTaggedAt: now };
    expect(mergeWithBotStaffAttention('AI ไม่มั่นใจ', room, now)).toBe(`AI ไม่มั่นใจ · ${reason}`);
    expect(mergeWithBotStaffAttention(`AI ไม่มั่นใจ · ${reason}`, room, now)).toBe(
      `AI ไม่มั่นใจ · ${reason}`,
    );
    expect(
      mergeWithBotStaffAttention('AI ไม่มั่นใจ', { handoffMode: false, handoffReason: null }, now),
    ).toBe('AI ไม่มั่นใจ');
  });
});
