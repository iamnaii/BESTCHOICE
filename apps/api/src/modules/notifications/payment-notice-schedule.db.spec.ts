/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/notifications/payment-notice-schedule.db.spec.ts --runInBand
 * (รันทั้ง `TZ=Asia/Bangkok` และ `TZ=UTC` — ผลต้องเท่ากัน)
 *
 * Task 30 รอบ 3 C1 — ตารางข้อความเรื่องงวดบน**รูปข้อมูลจริง**: `dueDate` เก็บที่เที่ยงคืนไทย (ตารางงวด · สัญญานำเข้า) และรันตามเวลา cron จริง
 * (A1 08:00 → A6 08:30 → บอทเตือน 09:00 → A2 09:00 → บอททวง 10:00) — ลูกค้าต้องได้ตามตารางที่เจ้าของตั้งใจ:
 * T-5 บอท · T-3 การ์ดลิงก์ชำระ · T-1 / T0 A1 · T+1 / T+3 / T+7 A2 · วันอื่นไม่มีข้อความ · **วันครบกำหนดไม่มีข้อความ "ค้างชำระ"**
 * (เดิม A1/A2 เลือกงวดตามวัน UTC ⇒ A1 ส่ง T-4/T-2/T-1 · A2 ส่ง T0 "เลยกำหนด 0 วัน"/T+2/T+6 — สเปคจำลองของผู้รีวิว)
 */
import { PrismaClient } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { ComplianceService } from './compliance.service';
import { HolidayService } from './holiday.service';
import { NotificationTemplateService } from './notification-template.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { AutoTriggerService } from '../chatbot-finance/services/auto-trigger.service';
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

const prisma = new PrismaClient();
const stamp = `t30c-${Date.now()}`;
const day = realBangkokDate();
let base: FinanceFixtureBase;
let notifications: NotificationsService;
let bot: AutoTriggerService;
let collections: CollectionsNotifierService;
const pushText = jest.fn();
const fixtures: InstallmentFixture[] = [];
const delivered: { to: string; via: string }[] = [];
const sink = (via: string) => async (to: string) => {
  delivered.push({ to, via });
};

beforeAll(async () => {
  assertTestDatabase();
  base = await createFinanceFixtureBase(prisma, stamp);
  notifications = new NotificationsService(
    prisma as never,
    { get: jest.fn() } as never,
    {
      paymentReminder: jest.fn(() => ({ type: 'flex', altText: 'เตือน', contents: {} })),
      overdueNotice: jest.fn(() => ({ type: 'flex', altText: 'ค้างชำระ', contents: {} })),
    } as never,
    { afterPayment: jest.fn(() => []) } as never,
    { getValue: jest.fn().mockResolvedValue('') } as never,
    new ComplianceService(prisma as never, new PDPAService(prisma as never), new HolidayService()),
    new NotificationTemplateService(prisma as never),
  );
  jest.spyOn(notifications.transport, 'sendLineFlexMessage').mockImplementation(sink('flex'));
  jest.spyOn(notifications.transport, 'sendLine').mockImplementation(sink('text'));
  jest.spyOn(notifications.transport, 'sendSms').mockResolvedValue('sms');
  pushText.mockImplementation(sink('bot'));
  bot = new AutoTriggerService(
    prisma as never,
    { pushText } as never,
    {
      getOrCreate: jest.fn().mockResolvedValue({ id: 'room' }),
      saveMessage: jest.fn().mockResolvedValue({ id: 'msg' }),
    } as never,
    { bankInfoBlock: '🏦 ทดสอบ' } as never,
  );
  collections = new CollectionsNotifierService(
    prisma as never,
    { sendFlexMessage: jest.fn(sink('payLink')) } as never,
    new PDPAService(prisma as never),
    notifications,
    {
      createPaymentLink: jest.fn(async () => ({
        url: 'https://pay.test/x',
        token: 't',
        amount: 1515.83,
        expiresAt: new Date(),
      })),
    } as never,
  );
});

afterAll(async () => {
  jest.useRealTimers();
  await retireFixtures(prisma, fixtures);
  await prisma.$disconnect();
});

it('วันครบกำหนดเก็บที่เที่ยงคืนไทย + เวลา cron จริง → ข้อความตรงตารางของเจ้าของ (งวดละไม่เกินหนึ่งข้อความต่อวัน)', async () => {
  useFakeDate(bangkokAt(day, 0, 7));
  const offsets = [5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6, -7];
  const byOffset = new Map<number, InstallmentFixture>();
  for (const k of offsets) {
    const overdue = k < 0;
    const f = await createInstallmentFixture(prisma, base, {
      label: `due${k}`,
      dueDate: dueDateBkk(day, k),
      paymentStatus: overdue ? 'OVERDUE' : 'PENDING',
      contractStatus: overdue ? 'OVERDUE' : 'ACTIVE',
    });
    fixtures.push(f);
    byOffset.set(k, f);
  }

  jest.setSystemTime(bangkokAt(day, 0, 8));
  const a1 = await notifications.sendPaymentReminders();
  jest.setSystemTime(bangkokAt(day, 0, 8, 30));
  await collections.sendAutoPaymentLinks();
  jest.setSystemTime(bangkokAt(day, 0, 9));
  await bot.runDailyReminders();
  const a2 = await notifications.sendOverdueNotices();
  jest.setSystemTime(bangkokAt(day, 0, 10));
  await bot.runDailyEscalations();

  const received = (k: number) =>
    delivered.filter((d) => d.to === byOffset.get(k)!.lineUserId).map((d) => d.via);
  const expected: Record<number, string[]> = {
    5: ['bot'],
    4: [],
    3: ['payLink'],
    2: [],
    1: ['flex'],
    0: ['flex'],
    [-1]: ['flex'],
    [-2]: [],
    [-3]: ['flex'],
    [-4]: [],
    [-5]: [],
    [-6]: [],
    [-7]: ['flex'],
  };
  expect(Object.fromEntries(offsets.map((k) => [k, received(k)]))).toEqual(expected);
  expect(a1.deferredToPayLink).toBeGreaterThanOrEqual(1);

  // ข้อความที่ A1/A2 บันทึกบอกจำนวนวันตามวันไทย · วันครบกำหนดไม่มีแถว "แจ้งค้างชำระ"
  const logs = await prisma.notificationLog.findMany({
    where: {
      relatedId: { in: offsets.map((k) => byOffset.get(k)!.paymentId) },
      status: 'SENT',
    },
    select: { relatedId: true, subject: true, message: true },
  });
  const logOf = (k: number) => logs.filter((l) => l.relatedId === byOffset.get(k)!.paymentId);
  expect(logOf(1).map((l) => l.message)).toEqual([expect.stringContaining('อีก 1 วัน')]);
  expect(logOf(0).map((l) => l.message)).toEqual([expect.stringContaining('อีก 0 วัน')]);
  expect(logOf(0).some((l) => l.subject === 'แจ้งค้างชำระ')).toBe(false);
  expect(logOf(-1).map((l) => l.message)).toEqual([expect.stringContaining('เลยกำหนด 1 วัน')]);
  expect(logOf(-3).map((l) => l.message)).toEqual([expect.stringContaining('เลยกำหนด 3 วัน')]);
  expect(logOf(-7).map((l) => l.message)).toEqual([expect.stringContaining('เลยกำหนด 7 วัน')]);
  expect(a2.sent).toBeGreaterThanOrEqual(3);
}, 60_000);
