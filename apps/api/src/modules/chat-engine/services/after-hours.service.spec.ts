import { AfterHoursService } from './after-hours.service';

/**
 * ไม่มีการเรียก LLM จริงในไฟล์นี้: ไม่ตั้ง ANTHROPIC_API_KEY (client = null → ข้อความสำรอง)
 * และเคสที่ต้องดูพฤติกรรมตอนมีคำตอบ ใช้ client ปลอมที่คืนค่าคงที่
 */
describe('AfterHoursService — ข้อมูลร้านจริง (C03, 2026-09-22)', () => {
  const aiUsage = { record: jest.fn().mockResolvedValue(undefined) };
  const make = () => new AfterHoursService({ get: () => undefined } as any, aiUsage as any);
  const fakeClient = (text: string) => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
  });

  afterEach(() => jest.useRealTimers());

  it('ช่วงตอบยังเป็น 20:00-10:00 (ใช้ร่วมกับ LINE_FINANCE — ยังไม่เปลี่ยน)', () => {
    const svc = make();
    const at = (iso: string) => {
      jest.useFakeTimers({ now: new Date(iso) });
      const v = svc.isAfterHours();
      jest.useRealTimers();
      return v;
    };
    expect(at('2026-09-22T12:30:00.000Z')).toBe(false); // 19:30 ไทย
    expect(at('2026-09-22T13:00:00.000Z')).toBe(true); // 20:00 ไทย
    expect(at('2026-09-22T02:59:00.000Z')).toBe(true); // 09:59 ไทย
    expect(at('2026-09-22T03:00:00.000Z')).toBe(false); // 10:00 ไทย
  });

  it('ไม่มี API key → ข้อความสำรองบอกเวลาร้านจริง 10:00-19:00 และเวลาที่ทีมงานเข้ามาตอบ', async () => {
    const reply = await make().getAutoReply('ผ่อนเดือนละเท่าไหร่');
    expect(reply).toContain('10:00-19:00 น.');
    expect(reply).toContain('ร้านเปิด 10 โมง');
    expect(reply).not.toContain('20:00');
    expect(reply).not.toContain('สักครู่');
  });

  it('system prompt มีเวลาร้านจริง + ห้ามตัวเลข + ห้ามแต่งข้อมูลสาขา', async () => {
    const svc = make();
    const client = fakeClient('รับเรื่องไว้แล้วนะคะ ทีมงานจะเข้ามาตอบตอนร้านเปิด 10 โมงค่ะ');
    (svc as any).anthropic = client;
    await svc.getAutoReply('ร้านอยู่ไหนคะ');
    const system: string = client.messages.create.mock.calls[0][0].system;
    expect(system).toBe(AfterHoursService.SYSTEM_PROMPT);
    expect(system).toContain('ร้านเปิดทุกวัน 10:00-19:00 น.');
    expect(system).toContain('ห้ามบอกตัวเลข');
    expect(system).toContain('ห้ามแต่งที่อยู่ สาขา เบอร์โทร');
    expect(system).not.toContain('10:00-20:00');
  });

  it('คำตอบปกติ → ส่งตามที่ได้ · คำตอบหลุดบอกตัวเลขราคา/เบอร์ → ใช้ข้อความสำรองแทน', async () => {
    const svc = make();
    (svc as any).anthropic = fakeClient('รับเรื่องไว้แล้วนะคะ ร้านเปิดทุกวัน 10:00-19:00 น. ค่ะ');
    expect(await svc.getAutoReply('ร้านเปิดกี่โมง')).toBe(
      'รับเรื่องไว้แล้วนะคะ ร้านเปิดทุกวัน 10:00-19:00 น. ค่ะ',
    );

    (svc as any).anthropic = fakeClient('รุ่นนี้ผ่อนเดือนละ 2,778 บาทค่ะ');
    const reply = await svc.getAutoReply('ผ่อนเท่าไหร่');
    expect(reply).not.toContain('2,778');
    expect(reply).toContain('ร้านเปิด 10 โมง');
  });

  it('containsFigures: เวลาไม่นับ · ราคา/เบอร์/จำนวนหลายหลักนับ', () => {
    expect(AfterHoursService.containsFigures('ร้านเปิด 10:00-19:00 น.')).toBe(false);
    expect(AfterHoursService.containsFigures('เปิด 10.00 น. ค่ะ')).toBe(false);
    expect(AfterHoursService.containsFigures('ผ่อน 12 เดือน')).toBe(false);
    expect(AfterHoursService.containsFigures('ราคา 2,778 บาท')).toBe(true);
    expect(AfterHoursService.containsFigures('โทร 0812345678')).toBe(true);
    expect(AfterHoursService.containsFigures('ดาวน์ 500 บาท')).toBe(true);
  });
});
