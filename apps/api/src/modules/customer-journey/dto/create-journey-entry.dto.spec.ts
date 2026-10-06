import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateJourneyEntryDto } from './create-journey-entry.dto';

const REQUEST_ID = '3f8e2b1c-6d4a-4f7e-9b2a-1c5d8e7f9a0b';

/** เหมือน ValidationPipe ของ app.setup.ts: whitelist เปิด · forbidNonWhitelisted ปิด */
async function check(plain: Record<string, unknown>) {
  const dto = plainToInstance(CreateJourneyEntryDto, plain, { enableImplicitConversion: true });
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors: Object.fromEntries(errors.map((e) => [e.property, Object.values(e.constraints ?? {})])) };
}

describe('CreateJourneyEntryDto — บันทึกมือแตะเดียว (ขอบเขต v2: ไม่มี note / occurredAt / roomId)', () => {
  it.each([
    { kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'APPOINTED', clientRequestId: REQUEST_ID },
    { kind: 'TOUCHPOINT', channel: 'WALK_IN', outcome: 'NOT_INTERESTED' },
    { kind: 'HEARD_FROM', heardFrom: 'OLD_CUSTOMER' },
    { kind: 'MARKED_LOST', lostReason: 'UNREACHABLE', clientRequestId: REQUEST_ID },
    { kind: 'REOPENED' },
  ])('%j ผ่าน', async (plain) => {
    expect((await check(plain)).errors).toEqual({});
  });

  it.each([
    ['kind ไม่รู้จัก', { kind: 'NOTE' }, { kind: ['ชนิดรายการไม่ถูกต้อง'] }],
    ['kind ของระบบ', { kind: 'CONTRACT_ACTIVATED' }, { kind: ['ชนิดรายการไม่ถูกต้อง'] }],
    ['ช่องทาง OTHER (กดไม่ได้ · มีแค่ป้ายของแถวเก่า)', { kind: 'TOUCHPOINT', channel: 'OTHER', outcome: 'APPOINTED' }, { channel: ['กรุณาเลือกช่องทาง'] }],
    ['ไม่มีช่องทาง', { kind: 'TOUCHPOINT', outcome: 'APPOINTED' }, { channel: ['กรุณาเลือกช่องทาง'] }],
    ['ไม่มีผล', { kind: 'TOUCHPOINT', channel: 'PHONE' }, { outcome: ['กรุณาเลือกผลการติดต่อ'] }],
    ['ผลไม่รู้จัก', { kind: 'TOUCHPOINT', channel: 'PHONE', outcome: 'CALL_BACK' }, { outcome: ['กรุณาเลือกผลการติดต่อ'] }],
    ['ติดป้ายหลุดไม่มีเหตุผล', { kind: 'MARKED_LOST' }, { lostReason: ['กรุณาเลือกเหตุผล'] }],
    ['เหตุผลไม่รู้จัก', { kind: 'MARKED_LOST', lostReason: 'TOO_EXPENSIVE' }, { lostReason: ['กรุณาเลือกเหตุผล'] }],
    ['รู้จักร้านจากช่องทางไม่รู้จัก', { kind: 'HEARD_FROM', heardFrom: 'RADIO' }, { heardFrom: ['กรุณาเลือกช่องทางที่รู้จักร้าน'] }],
    ['clientRequestId ไม่ใช่ UUID', { kind: 'REOPENED', clientRequestId: 'tap-1' }, { clientRequestId: ['รหัสคำขอไม่ถูกต้อง'] }],
    ['clientRequestId เป็น UUID v1', { kind: 'REOPENED', clientRequestId: 'a8098c1a-f86e-11da-bd1a-00112444be1e' }, { clientRequestId: ['รหัสคำขอไม่ถูกต้อง'] }],
  ])('%s → 400 ข้อความไทยที่ช่องนั้นช่องเดียว', async (_label, plain, expected) => {
    expect((await check(plain)).errors).toEqual(expected);
  });

  it('note · occurredAt · roomId ถูก whitelist ตัดทิ้งโดยไม่ error · ช่องของ kind อื่นไม่ถูกตรวจ (service เป็นคนไม่เขียน)', async () => {
    const { dto, errors } = await check({
      kind: 'TOUCHPOINT',
      channel: 'FB_APP',
      outcome: 'THINKING',
      note: 'โทร 0899999999',
      occurredAt: '2026-09-01T03:00:00.000Z',
      roomId: REQUEST_ID,
      lostReason: 'ไม่ใช่รหัส',
    });
    expect(errors).toEqual({});
    expect(dto).not.toHaveProperty('note');
    expect(dto).not.toHaveProperty('occurredAt');
    expect(dto).not.toHaveProperty('roomId');
    expect(dto).toMatchObject({ kind: 'TOUCHPOINT', channel: 'FB_APP', outcome: 'THINKING', lostReason: 'ไม่ใช่รหัส' });
  });
});
