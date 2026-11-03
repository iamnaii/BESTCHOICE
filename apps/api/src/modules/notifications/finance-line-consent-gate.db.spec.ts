/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/notifications/finance-line-consent-gate.db.spec.ts --runInBand
 *
 * Task 34 ข้อ 3 — การ์ดลิงก์ชำระอัตโนมัติ (A6 `CollectionsNotifierService.sendAutoPaymentLinks` 08:30 · T-3) และบอทการเงินเตือน/ทวง
 * (`AutoTriggerService` 09:00 T-5..T0 · 10:00 T+1/T+3) ใช้**ด่านความยินยอม PDPA ตัวเดียวกับ A1/A2** (`ensurePdpaConsentOrLogSkip`) บน Postgres จริง:
 *   - ลูกค้าที่ผูก LINE การเงินด้วย OTP หลัง #1763 (ยินยอมตอนผูก — `VerificationService.verifyOtp` บันทึก `pdpa_consents` GRANTED ในทรานแซกชันของการผูก)
 *     ได้รับตามปกติ
 *   - ลูกค้าที่ไม่มีความยินยอม (ผูกก่อน #1763 / ถูกเพิกถอน) ไม่ได้รับ · ทิ้งแถว IN_APP SKIPPED แบบเดียวกับ A1/A2 · บอทไม่จองแถว
 *
 * ปลายทางจริงถูก stub (LineOaService ของ A6 · LineFinanceClient ของบอท · SMS ของ OTP) — นับข้อความต่อ LINE ที่ส่งผ่าน
 */
import { PrismaClient } from '@prisma/client';
import { PDPAService } from '../pdpa/pdpa.service';
import { AutoTriggerService } from '../chatbot-finance/services/auto-trigger.service';
import { VerificationService } from '../chatbot-finance/services/verification.service';
import { CollectionsNotifierService } from './services/collections-notifier.service';
import {
  FinanceFixtureBase,
  InstallmentFixture,
  assertTestDatabase,
  bangkokAt,
  createFinanceFixtureBase,
  createInstallmentFixture,
  dueDateBkk,
  realBangkokDate,
  retireFixtures,
  useFakeDate,
} from './__tests__/finance-line-fixtures';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));
jest.mock('@sentry/node', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const prisma = new PrismaClient();
const stamp = `t34c-${Date.now()}`;
const day = realBangkokDate();
let base: FinanceFixtureBase;
let collections: CollectionsNotifierService;
let bot: AutoTriggerService;
let verification: VerificationService;
let pdpa: PDPAService;
let seq = 0;
const fixtures: InstallmentFixture[] = [];
const sms = { sendSmsFromQueue: jest.fn().mockResolvedValue(undefined) };

type Via = 'payLink' | 'bot';
const delivered: { to: string; via: Via }[] = [];
const sink = (via: Via) => async (to: string) => {
  delivered.push({ to, via });
};
const deliveries = (lineUserId: string, via: Via) =>
  delivered.filter((d) => d.to === lineUserId && d.via === via).length;

/** งวดเดียวของลูกค้าใหม่ — `otp`: ยังไม่ผูก แล้วผูกด้วย OTP จริง (ยินยอมตอนผูก) · ไม่งั้นแถว OTP จาก fixture โดยไม่มีความยินยอม */
async function customer(label: string, dueInDays: number, how: 'otp' | 'no-consent') {
  const phone = `08${String(Date.now() + ++seq).slice(-8)}`;
  const overdue = dueInDays < 0;
  const f = await createInstallmentFixture(prisma, base, {
    label: `${label}-${seq}`,
    dueDate: dueDateBkk(day, dueInDays),
    linkedAt: how === 'otp' ? null : undefined,
    consent: false,
    contractStatus: overdue ? 'OVERDUE' : 'ACTIVE',
    paymentStatus: overdue ? 'OVERDUE' : 'PENDING',
    phone,
  });
  fixtures.push(f);
  if (how === 'otp') {
    jest.useRealTimers(); // ทาง OTP เทียบเวลาหมดอายุกับนาฬิกาฐานข้อมูล
    await verification.requestOtp({ lineUserId: f.lineUserId, phone });
    const otp = (sms.sendSmsFromQueue.mock.calls.at(-1)?.[1] as string).match(/(\d{6})/)![1];
    await verification.verifyOtp({ lineUserId: f.lineUserId, otp, consent: { granted: true } });
  }
  return f;
}

const consentSkips = (relatedId: string) =>
  prisma.notificationLog.findMany({
    where: { relatedId, channel: 'IN_APP', status: 'SKIPPED' },
    select: { subject: true, message: true, recipient: true },
  });

async function runPayLinksAt(hh: number, mm = 0) {
  useFakeDate(bangkokAt(day, 0, hh, mm));
  await collections.sendAutoPaymentLinks();
}
async function runBotRemindersAt(hh: number) {
  useFakeDate(bangkokAt(day, 0, hh));
  await bot.runDailyReminders();
}
async function runBotEscalationsAt(hh: number) {
  useFakeDate(bangkokAt(day, 0, hh));
  await bot.runDailyEscalations();
}

beforeAll(async () => {
  assertTestDatabase();
  base = await createFinanceFixtureBase(prisma, stamp);
  pdpa = new PDPAService(prisma as never);
  collections = new CollectionsNotifierService(
    prisma as never,
    { sendFlexMessage: jest.fn(sink('payLink')) } as never,
    pdpa,
    {} as never,
    {
      createPaymentLink: jest.fn().mockResolvedValue({
        url: 'https://pay.test/x',
        token: 't',
        amount: 1515.83,
        expiresAt: new Date(),
      }),
    } as never,
  );
  bot = new AutoTriggerService(
    prisma as never,
    { pushText: jest.fn(sink('bot')) } as never,
    {
      getOrCreate: jest.fn().mockResolvedValue({ id: 'room' }),
      saveMessage: jest.fn().mockResolvedValue({ id: 'msg' }),
    } as never,
    { bankInfoBlock: '🏦 ทดสอบ' } as never,
  );
  verification = new VerificationService(
    prisma as never,
    sms as never,
    { isEnabled: jest.fn().mockResolvedValue(false) } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    undefined,
    undefined,
    { get: jest.fn(() => ({ switchRichMenu: jest.fn().mockResolvedValue(undefined) })) } as never,
  );
  verification._setResponseFloorForTests(0);
});

afterEach(async () => {
  jest.useRealTimers();
  delivered.splice(0);
  await retireFixtures(prisma, fixtures.splice(0));
});

afterAll(async () => prisma.$disconnect());

describe('Task 34 ข้อ 3 — ด่านความยินยอม PDPA ของการ์ดลิงก์ชำระ (A6) และบอทเตือน/ทวง', () => {
  it('ผูก LINE การเงินด้วย OTP (ยินยอมตอนผูก) → การ์ดลิงก์ชำระ T-3 · บอทเตือน T-5 · บอททวง T+1 ได้รับตามปกติ', async () => {
    const t3 = await customer('otp-t3', 3, 'otp');
    const t5 = await customer('otp-t5', 5, 'otp');
    const tp1 = await customer('otp-tp1', -1, 'otp');
    for (const f of [t3, t5, tp1]) {
      // ความยินยอมมาจากการผูกจริง (fixture ไม่ได้สร้าง)
      expect(await pdpa.hasActiveConsent(f.customerId)).toBe(true);
    }

    await runPayLinksAt(8, 30);
    await runBotRemindersAt(9);
    await runBotEscalationsAt(10);

    expect(deliveries(t3.lineUserId, 'payLink')).toBe(1);
    expect(deliveries(t3.lineUserId, 'bot')).toBe(0); // T-3 = การ์ดใบเดียว (Task 30 รอบ 2 ข้อ 1)
    expect(deliveries(t5.lineUserId, 'bot')).toBe(1);
    expect(deliveries(tp1.lineUserId, 'bot')).toBe(1);
    for (const f of [t3, t5, tp1]) expect(await consentSkips(f.paymentId)).toEqual([]);
  });

  it('ไม่มีความยินยอม (ผูกก่อน #1763) → ไม่ได้การ์ด/ข้อความบอท · บอทไม่จองแถว · แถว IN_APP SKIPPED แบบเดียวกับ A1/A2', async () => {
    const t3 = await customer('none-t3', 3, 'no-consent');
    const t5 = await customer('none-t5', 5, 'no-consent');
    const tp1 = await customer('none-tp1', -1, 'no-consent');

    await runPayLinksAt(8, 30);
    await runBotRemindersAt(9);
    await runBotEscalationsAt(10);

    for (const f of [t3, t5, tp1]) {
      expect(delivered.filter((d) => d.to === f.lineUserId)).toEqual([]);
      expect(await prisma.chatAutoTrigger.count({ where: { customerId: f.customerId } })).toBe(0);
    }
    const skipped = (f: InstallmentFixture, subject: string) => ({
      subject,
      message: 'ข้ามการแจ้งเตือน — ลูกค้าไม่มี PDPA consent',
      recipient: f.customerId,
    });
    // T-3: การ์ดข้าม (A6) แล้วบอท 09:00 ก็ข้าม — ลูกค้าไม่ได้ข้อความเลย
    expect(await consentSkips(t3.paymentId)).toEqual(
      expect.arrayContaining([
        skipped(t3, 'ลิงก์ชำระอัตโนมัติ'),
        skipped(t3, 'AutoTrigger REMINDER_T_MINUS_3'),
      ]),
    );
    expect(await consentSkips(t5.paymentId)).toEqual([
      skipped(t5, 'AutoTrigger REMINDER_T_MINUS_5'),
    ]);
    expect(await consentSkips(tp1.paymentId)).toEqual([
      skipped(tp1, 'AutoTrigger ESCALATION_T_PLUS_1'),
    ]);
  });

  it('ความยินยอมถูกเพิกถอน (REVOKED) → นับเป็นไม่มีความยินยอม: บอทไม่ส่ง', async () => {
    const t5 = await customer('revoked-t5', 5, 'otp');
    await prisma.pDPAConsent.updateMany({
      where: { customerId: t5.customerId },
      data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'ลูกค้าขอถอนความยินยอม' },
    });

    await runBotRemindersAt(9);

    expect(deliveries(t5.lineUserId, 'bot')).toBe(0);
    expect(await prisma.chatAutoTrigger.count({ where: { customerId: t5.customerId } })).toBe(0);
  });
});
