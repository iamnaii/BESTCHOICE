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
 *   8. (Task 22 I-1 ก) LIFF การเงินหาลูกค้าจากแถว OTP ไม่ใช่คอลัมน์: คอลัมน์ค้างบนลูกค้าอีกคน (ค่าซ้ำ/พนักงานพิมพ์ก่อน Task 22)
 *      ไม่ให้สิทธิ์ · LINE ที่ไม่มีแถว OTP ได้ null ทุกทาง (รวมตั๋ว PDF)
 *   9. (Task 22 I-1 ข) LINE ย้ายไปลูกค้าอีกคนด้วย OTP → U-id ถูกล้างจากคอลัมน์ของลูกค้าคนอื่นทุกคน (รวมแถวที่ถูกลบ)
 */
import { randomUUID } from 'node:crypto';
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
const extraCustomerIds: string[] = [];

const sms = { sendSmsFromQueue: jest.fn().mockResolvedValue(undefined) };
const richMenu = { switchRichMenu: jest.fn().mockResolvedValue(undefined) };
const moduleRef = { get: jest.fn(() => richMenu) };
let verification: VerificationService;
let liff: LiffApiService;
let customerForm: CustomerWriteService;

/** ขอ OTP ไปที่เบอร์ของลูกค้า แล้วยืนยันด้วยรหัสที่ส่งทาง SMS (เส้นจริง ไม่ใช่ test-mode) */
async function verifyWithOtp(lineUserId: string, phone = PHONE) {
  await verification.requestOtp({ lineUserId, phone });
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
  await prisma.customerLineLink.deleteMany({
    where: { customerId: { in: [customerId, ...extraCustomerIds] } },
  });
  await prisma.chatbotOtpRequest.deleteMany({ where: { lineUserId: { in: [U1, U2, U3, U4] } } });
  await prisma.chatRoom.deleteMany({ where: { lineUserId: { in: [U1, U2, U3, U4] } } });
  await prisma.customer.deleteMany({ where: { id: { in: extraCustomerIds } } });
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

  it('8. LIFF identity = the OTP link row, not line_id_finance (Task 22 I-1 ก)', async () => {
    // ค่าซ้ำของ U4 บนลูกค้าอีกคน (สร้างก่อน → findFirst ตามคอลัมน์จะเจอคนนี้ก่อน) + U-id ที่พนักงานพิมพ์ไว้โดยไม่มีแถว OTP
    const stale = await prisma.customer.create({
      data: {
        name: `ทดสอบค้าง ${tag}`,
        phone: `08${digits}`,
        lineIdFinance: U4,
        createdAt: new Date('2020-01-01'),
      },
    });
    const typed = await prisma.customer.create({
      data: { name: `ทดสอบพิมพ์ ${tag}`, phone: `06${digits}`, lineIdFinance: U3 },
    });
    extraCustomerIds.push(stale.id, typed.id);

    expect(await liff.findCustomerByLineId(U4)).toMatchObject({ id: customerId });
    expect(await liff.findCustomerByLineId(U3)).toBeNull();
    expect(await liff.findCustomerContractsFull(U3)).toBeNull();
    expect(await liff.findCustomerProfile(U3)).toBeNull();
    await expect(liff.resolveDownloadDocumentId(U3, 'receipt', randomUUID())).rejects.toThrow(
      'ไม่พบข้อมูลลูกค้า',
    );
  });

  it('9. the LINE moves to another customer by OTP → its U-id is cleared from every other customer column, deleted rows too (Task 22 I-1 ข)', async () => {
    const otherPhone = `07${digits}`;
    const other = await prisma.customer.create({
      data: { name: `ทดสอบคนใหม่ ${tag}`, phone: otherPhone },
    });
    const ghost = await prisma.customer.create({
      data: {
        name: `ทดสอบถูกลบ ${tag}`,
        phone: `05${digits}`,
        lineIdFinance: U4,
        deletedAt: new Date(),
      },
    });
    extraCustomerIds.push(other.id, ghost.id);

    await expect(verifyWithOtp(U4, otherPhone)).resolves.toMatchObject({ customerId: other.id });

    const columns = await prisma.customer.findMany({
      where: { lineIdFinance: U4 },
      select: { id: true },
    });
    expect(columns).toEqual([{ id: other.id }]); // คนเดิม (customerId) · แถวค้างจากข้อ 8 · แถวที่ถูกลบ = ล้างหมด
    expect(await lineIdFinance()).toBeNull();
    expect(await liff.findCustomerByLineId(U4)).toMatchObject({ id: other.id });
  });
});
