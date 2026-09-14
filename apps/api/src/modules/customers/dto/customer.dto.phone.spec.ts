import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { UpdateCustomerDto } from './customer.dto';

const validateBody = async (body: Record<string, unknown>) =>
  validate(plainToInstance(UpdateCustomerDto, body));

const errorsFor = async (body: Record<string, unknown>) =>
  (await validateBody(body)).map((e) => e.property);

// I1 (review fix round 1): ดึงข้อความ constraint ทั้งหมดของ field `phone` เพื่อยืนยันว่า
// ไม่มี default message ภาษาอังกฤษของ @IsString() ("phone must be a string") หลุดปนมา —
// ValidationPipe ไม่ได้ตั้ง stopAtFirstError จึงรันทุก decorator แล้วรวม constraints ทั้งหมด
// เข้า ValidationError เดียวซึ่งไหลตรงถึง client
const phoneConstraintMessagesFor = async (body: Record<string, unknown>) => {
  const errors = await validateBody(body);
  const phoneError = errors.find((e: ValidationError) => e.property === 'phone');
  return Object.values(phoneError?.constraints ?? {});
};

const PHONE_THAI_MESSAGE = 'เบอร์โทรต้องเป็นเลข 10 หลัก ขึ้นต้นด้วย 0';

describe('UpdateCustomerDto.phone — ผู้สนใจอัตโนมัติ', () => {
  it('ไม่ส่ง phone → ผ่าน (คงค่าเดิม / ยังไม่มีเบอร์ก็เว้นได้)', async () => {
    expect(await errorsFor({ nickname: 'เล็ก' })).not.toContain('phone');
  });
  it('phone: null → ปฏิเสธ (ล้างเบอร์ไม่ได้)', async () => {
    expect(await errorsFor({ phone: null })).toContain('phone');
  });
  it('phone: "" → ปฏิเสธ', async () => {
    expect(await errorsFor({ phone: '' })).toContain('phone');
  });
  it('phone ถูกรูปแบบ → ผ่าน', async () => {
    expect(await errorsFor({ phone: '0812345678' })).not.toContain('phone');
  });

  it('phone: null → ทุกข้อความ error เป็นภาษาไทยล้วน (ไม่มี default ภาษาอังกฤษของ @IsString หลุดมา)', async () => {
    const messages = await phoneConstraintMessagesFor({ phone: null });
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message).toBe(PHONE_THAI_MESSAGE);
      expect(message).not.toMatch(/must be/i);
    }
  });
  it('phone: "" → ทุกข้อความ error เป็นภาษาไทยล้วน', async () => {
    const messages = await phoneConstraintMessagesFor({ phone: '' });
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message).toBe(PHONE_THAI_MESSAGE);
      expect(message).not.toMatch(/must be/i);
    }
  });
});
