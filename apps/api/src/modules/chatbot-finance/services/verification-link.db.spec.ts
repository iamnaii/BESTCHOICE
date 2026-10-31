/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/chatbot-finance/services/verification-link.db.spec.ts --runInBand
 *
 * Task 19 — /liff/finance-verify (เบอร์ + OTP) เป็นทางผูก LINE การเงินทางเดียวแล้ว (liff/register ตอบ 410)
 * เทสนี้พิสูจน์บน Postgres จริง เพราะเงื่อนไขที่ตัดสินคือ unique ของ customer_line_links
 * (lineUserId, channel) + (customerId, channel) ซึ่ง mock มองไม่เห็น:
 *   1. ยืนยัน OTP → แถว link + line_id_finance + สลับ rich menu
 *   2. ยกเลิกผูกใน LIFF → ปิดแถว ⇒ หน้า finance-verify ไม่ขึ้น "ยืนยันแล้ว" ค้าง (ผูกกลับได้)
 *   3. ผูกกลับด้วย LINE เดิม → เปิดแถวเดิม
 *   4. ยกเลิกแล้วผูกด้วย LINE ใหม่ → ชี้แถวเดิมของลูกค้ามาที่ LINE ใหม่ (เดิมชน unique เป็น 500)
 *   5. ลูกค้ายังผูก LINE อื่นอยู่ → 409 ไม่เปลี่ยนอะไร
 *   6. (Task 22 I3) พนักงานตั้ง U-id ในฟอร์มลูกค้า → 400 ไม่เปลี่ยนอะไร
 *   7. (Task 22 I4) พนักงานล้างช่อง LINE การเงินในฟอร์มลูกค้า → ปิดแถว ⇒ ลูกค้ายืนยัน OTP ด้วย LINE ใหม่ได้ (ไม่ติด 409)
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { LineChannelType, PrismaClient } from '@prisma/client';
import { VerificationService } from './verification.service';
import { LiffApiService } from '../../line-oa/liff-api.service';
import { CustomerWriteService } from '../../customers/services/customer-write.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const prisma = new PrismaClient();
const tag = `t19-${Date.now()}`;
const digits = String(Date.now()).slice(-8);
const PHONE = `09${digits}`;
const U1 = `U${tag}-one`;
const U2 = `U${tag}-two`;
const U3 = `U${tag}-three`;
const U4 = `U${tag}-four`;
let customerId = '';

const sms = { sendSmsFromQueue: jest.fn().mockResolvedValue(undefined) };
const richMenu = { switchRichMenu: jest.fn().mockResolvedValue(undefined) };
const moduleRef = { get: jest.fn(() => richMenu) };
let verification: VerificationService;
let liff: LiffApiService;
let customerForm: CustomerWriteService;

/** ขอ OTP ไปที่เบอร์ของลูกค้า แล้วยืนยันด้วยรหัสที่ส่งทาง SMS (เส้นจริง ไม่ใช่ test-mode) */
async function verifyWithOtp(lineUserId: string) {
  await verification.requestOtp({ lineUserId, phone: PHONE });
  const otp = (sms.sendSmsFromQueue.mock.calls.at(-1)?.[1] as string).match(/(\d{6})/)![1];
  return verification.verifyOtp({ lineUserId, otp });
}

const linkRows = () =>
  prisma.customerLineLink.findMany({
    where: { customerId, channel: LineChannelType.FINANCE },
    select: { lineUserId: true, unlinkedAt: true },
  });
const lineIdFinance = async () =>
  (await prisma.customer.findUniqueOrThrow({ where: { id: customerId } })).lineIdFinance;

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) {
    throw new Error(`สเปคนี้เขียน/ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  }
  const customer = await prisma.customer.create({ data: { name: `ทดสอบ ${tag}`, phone: PHONE } });
  customerId = customer.id;
  const testMode = { isEnabled: jest.fn().mockResolvedValue(false) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  verification = new VerificationService(
    prisma as never,
    sms as never,
    testMode as never,
    audit as never,
    undefined,
    undefined,
    moduleRef as never,
  );
  liff = new LiffApiService(prisma as never);
  // ฟอร์มลูกค้าของพนักงาน (PATCH /customers/:id) — update() ใช้แค่ query.findOne (ไม่แตะ contact resolver)
  const query = { findOne: (id: string) => prisma.customer.findUniqueOrThrow({ where: { id } }) };
  customerForm = new CustomerWriteService(prisma as never, {} as never, query as never);
});

afterAll(async () => {
  await prisma.customerLineLink.deleteMany({ where: { customerId } });
  await prisma.chatbotOtpRequest.deleteMany({ where: { lineUserId: { in: [U1, U2, U3, U4] } } });
  await prisma.chatRoom.deleteMany({ where: { lineUserId: { in: [U1, U2, U3, U4] } } });
  await prisma.customer.delete({ where: { id: customerId } });
  await prisma.$disconnect();
});

describe('finance-verify is the only LINE-link path — link rows on real Postgres', () => {
  it('1. OTP verified → link row + line_id_finance + rich menu switched to verified', async () => {
    await expect(verifyWithOtp(U1)).resolves.toMatchObject({ customerId });

    expect(await linkRows()).toEqual([{ lineUserId: U1, unlinkedAt: null }]);
    expect(await lineIdFinance()).toBe(U1);
    expect(await verification.isLinked(U1)).toMatchObject({ linked: true, customerId });
    expect(richMenu.switchRichMenu).toHaveBeenCalledWith(U1, true, 'finance');
  });

  it('2. LIFF unlink closes the link row → finance-verify no longer reports "already linked"', async () => {
    await expect(liff.unlinkLineAccount(U1)).resolves.toEqual({ success: true });

    expect(await lineIdFinance()).toBeNull();
    const [row] = await linkRows();
    expect(row.unlinkedAt).toBeInstanceOf(Date);
    expect(await verification.isLinked(U1)).toEqual({ linked: false });
  });

  it('3. re-link with the same LINE after unlink → the same row is reopened', async () => {
    await expect(verifyWithOtp(U1)).resolves.toMatchObject({ customerId });

    expect(await linkRows()).toEqual([{ lineUserId: U1, unlinkedAt: null }]);
    expect(await lineIdFinance()).toBe(U1);
  });

  it('4. unlink, then link a NEW LINE account → the customer row is re-pointed (no unique-violation 500)', async () => {
    await liff.unlinkLineAccount(U1);

    await expect(verifyWithOtp(U2)).resolves.toMatchObject({ customerId });

    expect(await linkRows()).toEqual([{ lineUserId: U2, unlinkedAt: null }]);
    expect(await lineIdFinance()).toBe(U2);
    expect(await verification.isLinked(U2)).toMatchObject({ linked: true, customerId });
    expect(await verification.isLinked(U1)).toEqual({ linked: false });
  });

  it('5. customer still linked to another LINE → 409 and nothing changes', async () => {
    const err = await verifyWithOtp(U3).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect(await linkRows()).toEqual([{ lineUserId: U2, unlinkedAt: null }]);
    expect(await lineIdFinance()).toBe(U2);
    expect(await verification.isLinked(U3)).toEqual({ linked: false });
  });

  it('6. staff types a U-id into the customer form → 400, nothing changes (Task 22 I3)', async () => {
    const err = await customerForm
      .update(customerId, { lineIdFinance: U4 } as never)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(await linkRows()).toEqual([{ lineUserId: U2, unlinkedAt: null }]);
    expect(await lineIdFinance()).toBe(U2);
  });

  it('7. staff clears "LINE การเงิน" in the customer form → row closed → the customer verifies a new LINE (Task 22 I4)', async () => {
    await customerForm.update(customerId, { lineIdFinance: null } as never);

    expect(await lineIdFinance()).toBeNull();
    const [row] = await linkRows();
    expect(row).toMatchObject({ lineUserId: U2 });
    expect(row.unlinkedAt).toBeInstanceOf(Date);
    expect(await verification.isLinked(U2)).toEqual({ linked: false });

    await expect(verifyWithOtp(U4)).resolves.toMatchObject({ customerId });
    expect(await linkRows()).toEqual([{ lineUserId: U4, unlinkedAt: null }]);
    expect(await lineIdFinance()).toBe(U4);
  });
});
