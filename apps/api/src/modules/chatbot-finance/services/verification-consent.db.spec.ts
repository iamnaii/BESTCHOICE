/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/chatbot-finance/services/verification-consent.db.spec.ts --runInBand
 *
 * Task 33 (mockup C1–C3 "ยินยอมตอนผูก" ที่เจ้าของอนุมัติ · canvas cRecord) — ความยินยอมเป็นส่วนหนึ่งของการผูก LINE การเงิน:
 * - รหัส OTP ถูก → `pdpa_consents` สถานะ GRANTED **ในทรานแซกชันเดียวกับการผูก** · ครั้งเดียวต่อลูกค้า (มีแถว GRANTED ของวัตถุประสงค์เดียวกัน
 *   แล้ว = ไม่สร้างซ้ำ) · ทรานแซกชันที่ถูกลองใหม่ (`runWithTransactionRetry`) ไม่ทำให้เกิดแถวซ้ำ
 * - รหัสผิด / หมดอายุ = ไม่บันทึกอะไร
 * - รอบแจ้งเตือนค่างวดที่มีอยู่ (`NotificationReminderService` — ด่าน PDPA "มี GRANTED สักแถว") และ `PDPAService.hasActiveConsent`
 *   (compliance · collections-notifier · line-flex-builder) นับลูกค้าเก่าที่ไม่มีความยินยอมเดิมแต่เพิ่งผูกผ่าน OTP+ยินยอม ว่า "มีความยินยอม"
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { VerificationService } from './verification.service';
import { LiffApiService } from '../../line-oa/liff-api.service';
import { FinanceLineLockSetUnstableError } from '../../line-oa/services/finance-line-link';
import { NotificationReminderService } from '../../notifications/services/notification-reminder.service';
import { PDPAService } from '../../pdpa/pdpa.service';
import {
  LINE_FINANCE_CONSENT_PURPOSE,
  LINE_FINANCE_CONSENT_TEXT,
  LINE_FINANCE_CONSENT_VERSION,
} from '../../pdpa/line-finance-consent';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const prisma = new PrismaClient();
const tag = `t33c-${Date.now()}`;
const digits = String(Date.now()).slice(-8);
const PHONE = `08${digits}`;
const LINE = `U${tag}-one`;
const dec = (v: string) => new Prisma.Decimal(v);
const CONSENT = { granted: true as const, ipAddress: '203.0.113.7', userAgent: 'Line/14.0 spec' };

const sms = { sendSmsFromQueue: jest.fn().mockResolvedValue(undefined) };
const transport = { sendLineFlexMessage: jest.fn().mockResolvedValue(undefined) };
const dispatch = { send: jest.fn(), sendFromTemplate: jest.fn() };
let verification: VerificationService;
let reminders: NotificationReminderService;
let pdpa: PDPAService;
let liff: LiffApiService;
let customerId = '';
let paymentId = '';
const ids = { branch: '', user: '', product: '', contract: '' };

/**
 * ขอรหัสใหม่ทางจริง (SMS mock) — ล้างแถวนับเพดานรายวันของลูกค้า/LINE นี้ + เลื่อนเวลาขอครั้งก่อนย้อน 2 นาที (cooldown 60 วิ)
 * เพราะเทสขอรหัสหลายครั้ง (เพดาน (ลูกค้า, LINE) = 2/วัน — กติกาข้อ 4 ของ security.md)
 */
async function requestCode(): Promise<string> {
  await prisma.chatbotOtpRequest.deleteMany({
    where: {
      lineUserId: { startsWith: 'otp-quota:' },
      OR: [{ lineUserId: { contains: customerId } }, { lineUserId: { contains: LINE } }],
    },
  });
  await prisma.chatbotOtpRequest.updateMany({
    where: { lineUserId: LINE },
    data: { lastRequestAt: new Date(Date.now() - 2 * 60_000) },
  });
  sms.sendSmsFromQueue.mockClear();
  await verification.requestOtp({ lineUserId: LINE, phone: PHONE });
  const message = sms.sendSmsFromQueue.mock.calls.at(-1)?.[1] as string | undefined;
  if (!message) throw new Error('ไม่มี SMS — ได้แถว decoy');
  return message.match(/(\d{6})/)![1];
}

const consents = () =>
  prisma.pDPAConsent.findMany({ where: { customerId }, orderBy: { createdAt: 'asc' } });

/** ค่างวดที่ครบกำหนดวันนี้ (วันตามที่รอบแจ้งเตือนคำนวณ — UTC) ของสัญญา ACTIVE */
async function seedDuePayment() {
  const today = new Date(new Date().toISOString().split('T')[0]);
  ids.branch = (await prisma.branch.create({ data: { name: `${tag} สาขา` } })).id;
  ids.user = (
    await prisma.user.create({
      data: {
        email: `${tag}@spec.local`,
        password: 'x',
        name: tag,
        role: 'SALES',
        branchId: ids.branch,
      },
    })
  ).id;
  ids.product = (
    await prisma.product.create({
      data: {
        name: `spec ${tag}`,
        brand: 'Apple',
        model: 'iPhone 15',
        category: 'PHONE_NEW',
        costPrice: dec('20000.00'),
        branchId: ids.branch,
        imeiSerial: `${tag}-imei`,
      },
    })
  ).id;
  ids.contract = (
    await prisma.contract.create({
      data: {
        contractNumber: `${tag}-C1`,
        customerId,
        productId: ids.product,
        branchId: ids.branch,
        salespersonId: ids.user,
        planType: 'STORE_WITH_INTEREST',
        sellingPrice: dec('30000.00'),
        downPayment: dec('5000.00'),
        interestRate: dec('0.0500'),
        totalMonths: 12,
        interestTotal: dec('15000.00'),
        financedAmount: dec('25000.00'),
        monthlyPayment: dec('3333.33'),
        status: 'ACTIVE',
      },
    })
  ).id;
  paymentId = (
    await prisma.payment.create({
      data: {
        contractId: ids.contract,
        installmentNo: 1,
        dueDate: new Date(today.getTime() + 6 * 60 * 60 * 1000),
        amountDue: dec('3333.33'),
        status: 'PENDING',
      },
    })
  ).id;
}

const reminderLogs = () =>
  prisma.notificationLog.findMany({ where: { relatedId: paymentId }, orderBy: { sentAt: 'asc' } });

beforeAll(async () => {
  const dbName = new URL(process.env.DATABASE_URL ?? 'postgresql://unset/unset').pathname.slice(1);
  if (!/^test_db$|_test$/.test(dbName)) {
    throw new Error(`สเปคนี้เขียน/ลบแถวจริง — ต้องรันกับฐานทดสอบ แต่ได้ "${dbName}"`);
  }
  // ลูกค้าเก่า (ย้ายมาจากระบบเดิม) — ไม่มีแถว pdpa_consents เลย
  customerId = (await prisma.customer.create({ data: { name: `ทดสอบ ${tag}`, phone: PHONE } })).id;
  await seedDuePayment();
  verification = new VerificationService(
    prisma as never,
    sms as never,
    { isEnabled: jest.fn().mockResolvedValue(false) } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
  );
  verification._setResponseFloorForTests(0);
  reminders = new NotificationReminderService(
    prisma as never,
    dispatch as never,
    transport as never,
    { paymentReminder: jest.fn(() => ({ type: 'flex', altText: 'แจ้งเตือนค่างวด' })) } as never,
    { afterPayment: jest.fn(() => []) } as never,
  );
  pdpa = new PDPAService(prisma as never);
  liff = new LiffApiService(prisma as never);
});

afterAll(async () => {
  await prisma.notificationLog.deleteMany({ where: { relatedId: paymentId } });
  await prisma.payment.deleteMany({ where: { contractId: ids.contract } });
  await prisma.contract.deleteMany({ where: { id: ids.contract } });
  await prisma.product.deleteMany({ where: { id: ids.product } });
  await prisma.pDPAConsent.deleteMany({ where: { customerId } });
  await prisma.customerLineLink.deleteMany({ where: { customerId } });
  await prisma.chatbotOtpRequest.deleteMany({
    where: { OR: [{ lineUserId: LINE }, { lineUserId: { contains: LINE } }, { customerId }] },
  });
  await prisma.chatRoom.deleteMany({ where: { lineUserId: LINE } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
  await prisma.branch.deleteMany({ where: { id: ids.branch } });
  await prisma.$disconnect();
});

describe('Task 33 — ความยินยอมตอนผูก LINE การเงิน (Postgres จริง)', () => {
  it('1. ลูกค้าเก่าไม่มีความยินยอม → รอบแจ้งเตือนค่างวดข้าม (SKIPPED) ไม่ส่ง LINE · hasActiveConsent = false', async () => {
    expect(await consents()).toEqual([]);
    expect(await pdpa.hasActiveConsent(customerId)).toBe(false);

    await reminders.sendPaymentReminders();

    expect(transport.sendLineFlexMessage).not.toHaveBeenCalledWith(
      LINE,
      expect.anything(),
      expect.anything(),
    );
    const logs = await reminderLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: 'SKIPPED', subject: 'แจ้งเตือนค่างวด' });
    // ข้อค้นพบ: แถว SKIPPED นับเป็น "แจ้งแล้ววันนี้" (alreadyNotifiedToday) — ล้างก่อนรอบถัดไปของเทส
    await prisma.notificationLog.deleteMany({ where: { relatedId: paymentId } });
  });

  it('2. รหัส OTP ผิด (ติ๊กยินยอมแล้ว) → ไม่บันทึกความยินยอม ไม่ผูก', async () => {
    const code = await requestCode();
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(
      verification.verifyOtp({ lineUserId: LINE, otp: wrong, consent: CONSENT }),
    ).rejects.toThrow('OTP ไม่ถูกต้อง (เหลือ 2 ครั้ง)');
    expect(await consents()).toEqual([]);
    expect(await verification.isLinked(LINE)).toEqual({ linked: false });
  });

  it('3. รหัส OTP หมดอายุ → ไม่บันทึกความยินยอม', async () => {
    const code = await requestCode();
    await prisma.chatbotOtpRequest.update({
      where: { lineUserId: LINE },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      verification.verifyOtp({ lineUserId: LINE, otp: code, consent: CONSENT }),
    ).rejects.toThrow('OTP หมดอายุ');
    expect(await consents()).toEqual([]);
  });

  it('4. รหัสถูก + ยินยอม → GRANTED หนึ่งแถว (ข้อความ/วัตถุประสงค์ของหน้า LIFF + หลักฐาน) ในทรานแซกชันเดียวกับการผูก · ลองทรานแซกชันใหม่ไม่ซ้ำ', async () => {
    const code = await requestCode();
    // ทรานแซกชันของ bind รอบแรกเขียนครบแล้วล้ม (ข้อผิดพลาดที่ runWithTransactionRetry ลองใหม่) ⇒ rollback ทั้งก้อน แล้วลองรอบสอง
    const original = prisma.$transaction.bind(prisma) as (...args: unknown[]) => Promise<unknown>;
    const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce(((
      fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
      opts?: unknown,
    ) =>
      original(async (tx: Prisma.TransactionClient) => {
        await fn(tx);
        throw new FinanceLineLockSetUnstableError();
      }, opts)) as never);

    const result = await verification.verifyOtp({ lineUserId: LINE, otp: code, consent: CONSENT });
    // รอบแรกล้มหลังเขียนครบ → runWithTransactionRetry เปิดทรานแซกชันใหม่ (รอบสองผ่าน)
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    spy.mockRestore();

    const rows = await consents();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'GRANTED',
      purposes: [LINE_FINANCE_CONSENT_PURPOSE],
      privacyNoticeText: LINE_FINANCE_CONSENT_TEXT,
      consentVersion: LINE_FINANCE_CONSENT_VERSION,
      ipAddress: '203.0.113.7',
      deviceInfo: 'Line/14.0 spec',
      capturedById: null,
      revokedAt: null,
      deletedAt: null,
    });
    expect(rows[0].grantedAt).toBeInstanceOf(Date);
    expect(result).toEqual({
      customerId,
      customerName: `ทดสอบ ${tag}`,
      consentRecordedAt: rows[0].grantedAt!.toISOString(),
    });
    expect(await verification.isLinked(LINE)).toMatchObject({ linked: true, customerId });
    // ข้อความในหน้า LIFF (C1) ทุกตัวอักษร
    expect(LINE_FINANCE_CONSENT_TEXT).toBe(
      'ยินยอมให้บริษัทส่งแจ้งเตือนค่างวด ใบเสร็จ และข้อมูลสัญญาทาง LINE',
    );
  });

  it('5. รอบแจ้งเตือนค่างวดนับลูกค้าที่เพิ่งผูก + ยินยอม ว่ามีความยินยอม → ส่ง LINE ถึงแถว OTP · hasActiveConsent = true', async () => {
    expect(await pdpa.hasActiveConsent(customerId)).toBe(true);
    transport.sendLineFlexMessage.mockClear();

    await reminders.sendPaymentReminders();

    expect(transport.sendLineFlexMessage).toHaveBeenCalledWith(
      LINE,
      expect.anything(),
      'line-finance',
    );
    const logs = await reminderLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: 'SENT', channel: 'LINE', recipient: LINE });
  });

  it('6. ยกเลิกผูกแล้วยืนยัน OTP + ยินยอมอีกครั้ง → ไม่สร้างแถวซ้ำ (ครั้งเดียวต่อลูกค้า) · วันที่บันทึกคือของแถวเดิม', async () => {
    const [first] = await consents();
    await liff.unlinkLineAccount(LINE);
    const code = await requestCode();

    const result = await verification.verifyOtp({ lineUserId: LINE, otp: code, consent: CONSENT });

    const rows = await consents();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(result.consentRecordedAt).toBe(first.grantedAt!.toISOString());
  });

  it('7. ความยินยอมเดิมถูกเพิกถอน (เจ้าของกดที่เมนู PDPA) → ผูกใหม่ + ยินยอม = แถว GRANTED ใหม่', async () => {
    const [first] = await consents();
    await pdpa.revokeConsent(first.id, 'ลูกค้าขอถอนผ่านเจ้าหน้าที่');
    await liff.unlinkLineAccount(LINE);
    const code = await requestCode();

    await verification.verifyOtp({ lineUserId: LINE, otp: code, consent: CONSENT });

    const rows = await consents();
    expect(rows.map((r) => r.status)).toEqual(['REVOKED', 'GRANTED']);
  });

  it('8. (fix round 1 M2) ครั้งเดียวต่อลูกค้า **ต่อเวอร์ชันข้อความ** — มีแถว GRANTED ของฉบับเก่า → ผูกใหม่ + ติ๊กฉบับปัจจุบัน = แถวใหม่ของฉบับปัจจุบัน', async () => {
    const granted = (await consents()).find((r) => r.status === 'GRANTED')!;
    // จำลองแถวที่ลูกค้ายินยอมไว้กับข้อความฉบับก่อน (เปลี่ยนข้อความ = เปลี่ยน LINE_FINANCE_CONSENT_VERSION)
    await prisma.pDPAConsent.update({
      where: { id: granted.id },
      data: { consentVersion: 'line-finance-verify-previous' },
    });
    await liff.unlinkLineAccount(LINE);
    const code = await requestCode();

    const result = await verification.verifyOtp({ lineUserId: LINE, otp: code, consent: CONSENT });

    const current = (await consents()).filter(
      (r) => r.status === 'GRANTED' && r.consentVersion === LINE_FINANCE_CONSENT_VERSION,
    );
    expect(current).toHaveLength(1);
    expect(result.consentRecordedAt).toBe(current[0].grantedAt!.toISOString());
  });
});
