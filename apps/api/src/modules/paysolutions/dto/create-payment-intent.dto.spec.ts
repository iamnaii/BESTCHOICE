import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePaymentIntentDto } from './create-payment-intent.dto';

/** เหมือน ValidationPipe ของ app.setup.ts: whitelist เปิด · forbidNonWhitelisted ปิด · แปลงชนิดอัตโนมัติ */
async function errorsOf(plain: Record<string, unknown>) {
  const dto = plainToInstance(CreatePaymentIntentDto, plain, { enableImplicitConversion: true });
  const errors = await validate(dto, { whitelist: true });
  return Object.fromEntries(errors.map((e) => [e.property, Object.values(e.constraints ?? {})]));
}

const base = { contractId: 'ct-1', amount: 1000, lineId: 'U-1' };

// Task 39 รีวิว m-2 — `paymentLinkToken` รับเฉพาะ token ของลิงก์ `/pay/:token` (64 hex จาก createPaymentLink) ไม่ใช่เลขอ้างอิง 12 หลักของแถวติดตาม
describe('CreatePaymentIntentDto.paymentLinkToken', () => {
  it('64 hex ผ่าน · ไม่ส่งก็ผ่าน (ทางเลขงวด / LiffEarlyPayoff)', async () => {
    expect(await errorsOf({ ...base, paymentLinkToken: 'a1'.repeat(32) })).toEqual({});
    expect(await errorsOf({ ...base, installmentNo: 1 })).toEqual({});
  });

  it.each([
    ['เลขอ้างอิง 12 หลักของแถวติดตาม intent', '793686721395'],
    ['ตัวพิมพ์ใหญ่', 'A1'.repeat(32)],
    ['ไม่ใช่ hex', 'g'.repeat(64)],
    ['สั้นไป', 'f'.repeat(63)],
    ['ยาวไป', 'f'.repeat(65)],
    ['ไม่ใช่ข้อความ', 12345],
  ])('%s → "ลิงก์ชำระเงินไม่ถูกต้อง"', async (_label, paymentLinkToken) => {
    expect((await errorsOf({ ...base, paymentLinkToken })).paymentLinkToken).toContain(
      'ลิงก์ชำระเงินไม่ถูกต้อง',
    );
  });
});
