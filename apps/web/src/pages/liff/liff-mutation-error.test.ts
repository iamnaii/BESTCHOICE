import { describe, expect, it } from 'vitest';
import { liffMutationErrorMessage } from './liff-mutation-error';

// Task 36 review m-c (1 พ.ย. 2026): หน้า LIFF ปิดยอด/ลิงก์ชำระเคย toast `err.message` ของ axios ("Request failed with status code 400")
// ⇒ ข้อความไทยจาก server (เช่น #24 "ยังปิดยอดผ่าน LINE ไม่ได้ในขณะนี้ — …") ไม่ถึงลูกค้า
describe('liffMutationErrorMessage', () => {
  const fallback = 'ไม่สามารถสร้างรายการชำระเงินได้';
  const axios400 = (message: unknown) =>
    Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: { message } },
    });

  it('shows the Thai message from the server response, not the axios text', () => {
    const msg = 'ยังปิดยอดผ่าน LINE ไม่ได้ในขณะนี้ — สัญญานี้มีรายการคืนเงินที่รอธนาคารดำเนินการ';
    expect(liffMutationErrorMessage(axios400(msg), fallback)).toBe(msg);
    expect(liffMutationErrorMessage(axios400([msg]), fallback)).toBe(msg);
  });

  it('a non-Thai server message or transport error → the Thai fallback', () => {
    expect(liffMutationErrorMessage(axios400('Bad Request'), fallback)).toBe(fallback);
    expect(liffMutationErrorMessage(new Error('Network Error'), fallback)).toBe(fallback);
    expect(liffMutationErrorMessage(undefined, fallback)).toBe(fallback);
  });

  it('keeps a Thai error thrown by the page itself (no response)', () => {
    expect(liffMutationErrorMessage(new Error('ไม่พบข้อมูลยอดปิดสัญญา'), fallback)).toBe(
      'ไม่พบข้อมูลยอดปิดสัญญา',
    );
  });
});
