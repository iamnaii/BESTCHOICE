import { StaffNotificationService } from '../staff-notification.service';

const NOW = new Date('2026-10-26T03:00:00.000Z');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any, staffNotify: any;
let service: StaffNotificationService;

beforeEach(() => {
  jest.clearAllMocks();
  prisma = {
    chatRoom: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'room-1',
        customer: { name: 'คุณประสิทธิ์ ทองดี', phone: '0812345678' },
        messages: [
          { role: 'BOT', text: 'สวัสดีค่ะ', createdAt: new Date('2026-10-26T02:58:00Z') },
          { role: 'CUSTOMER', text: 'ขอคุยกับพนักงานได้ไหมครับ', createdAt: new Date('2026-10-26T02:59:00Z') },
        ],
      }),
    },
  };
  staffNotify = { notify: jest.fn().mockResolvedValue({ sent: 1 }) };
  service = new StaffNotificationService(prisma, staffNotify);
});

describe('StaffNotificationService → StaffNotifyService', () => {
  it('H1 handoff: title/lines from the old message, masked phone, link to the room, dedupe by room', async () => {
    await service.notifyHandoff({ roomId: 'room-1', reason: 'ถามเรื่องปิดยอดก่อนกำหนด', priority: 'high', summary: 'ลูกค้าอยากปิดยอด' } as never);
    expect(staffNotify.notify).toHaveBeenCalledTimes(1);
    const [event, payload] = staffNotify.notify.mock.calls[0];
    expect(event).toBe('chat.handoff');
    expect(payload.title).toMatch(/ลูกค้ารอคุย/);
    expect(payload.lines).toEqual(expect.arrayContaining([
      '👤 คุณประสิทธิ์ ทองดี',
      expect.stringMatching(/^📞 0\d{2}-\*\*\*-\d{4}$/),
      '📌 เรื่อง: ถามเรื่องปิดยอดก่อนกำหนด',
      '📝 ลูกค้าอยากปิดยอด',
    ]));
    expect(payload.lines.join('\n')).toContain('ขอคุยกับพนักงานได้ไหมครับ');
    expect(payload).toMatchObject({ link: '/inbox?room=room-1', dedupeKey: 'room-1' });
  });

  it('H2 slip review keeps the old wording; dedupe by evidence', async () => {
    await service.notifySlipReview({ customerName: 'คุณประสิทธิ์', customerPhone: '0812345678', contractNumber: 'CT-1', slipAmount: 2500, expectedAmount: 3000, reason: 'amount_mismatch', evidenceId: 'ev-1' });
    const [event, payload] = staffNotify.notify.mock.calls[0];
    expect(event).toBe('chat.slip_review');
    expect(payload.title).toBe('🧾 สลิปรอตรวจสอบ');
    expect(payload.lines).toEqual(['👤 คุณประสิทธิ์', expect.stringMatching(/^📞 /), '📋 สัญญา: CT-1', '💰 ยอดในสลิป: 2,500 บาท', '💰 ยอดงวดนี้: 3,000 บาท', '💰 ยอดไม่ตรง']);
    expect(payload).toMatchObject({ link: '/slip-review', dedupeKey: 'ev-1' });
  });

  it('H3 SLA: count 0 → not sent; otherwise one aggregate per Thai day', async () => {
    await service.notifySlipSlaBreached({ count: 0, oldestAgeHours: 9 }, NOW);
    expect(staffNotify.notify).not.toHaveBeenCalled();
    await service.notifySlipSlaBreached({ count: 3, oldestAgeHours: 5.5 }, NOW);
    const [event, payload] = staffNotify.notify.mock.calls[0];
    expect(event).toBe('chat.slip_sla');
    expect(payload).toMatchObject({ title: '⏰ สลิปรอตรวจสอบเกิน SLA', lines: ['📋 จำนวน: 3 ใบ', '⏳ ใบเก่าสุดรอมาแล้ว 5.5 ชั่วโมง'], link: '/slip-review', dedupeKey: 'sla:2026-10-26' });
  });

  it('H4 room not found → nothing sent, no throw; hub failure never propagates', async () => {
    prisma.chatRoom.findUnique.mockResolvedValue(null);
    await expect(service.notifyHandoff({ roomId: 'nope', reason: 'x', priority: 'low', summary: 's' } as never)).resolves.toBeUndefined();
    expect(staffNotify.notify).not.toHaveBeenCalled();
    staffNotify.notify.mockRejectedValue(new Error('boom'));
    await expect(service.notifySlipReview({ customerName: 'a', contractNumber: 'c', slipAmount: 1, reason: 'unmatched', evidenceId: 'e' })).resolves.toBeUndefined();
  });
});
