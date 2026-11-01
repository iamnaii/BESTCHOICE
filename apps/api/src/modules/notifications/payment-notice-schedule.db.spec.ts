/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/notifications/payment-notice-schedule.db.spec.ts --runInBand
 * (รันทั้ง `TZ=Asia/Bangkok` และ `TZ=UTC` — ผลต้องเท่ากัน)
 *
 * Task 30 — ตาราง "วันไหนลูกค้าได้ข้อความอะไร" บน**รูปข้อมูลจริง** และ**ทุกรอบของวันจริง**:
 * 00:30 เปลี่ยนสถานะสัญญา → 01:00 เลื่อนขั้นทวง → 08:00 A1 → 08:05 ข้อความผลรอบกลางคืน (A3/A4) → 08:30 A6 → 09:00 บอทเตือน + A2 →
 * 10:00 บอททวง · `dueDate` เก็บที่เที่ยงคืนไทย (ตารางงวด · สัญญานำเข้า) · สถานะก่อนคืนนั้นเป็นแบบที่ระบบสร้างจริง (สัญญาเป็น OVERDUE ได้ทางเดียว
 * คือรอบ 00:30 เมื่อเลยกำหนดเกิน 7 วัน — สัญญาที่เพิ่งเลยกำหนด 1–6 วันยังเป็น ACTIVE · งวดที่เลยกำหนดเป็น OVERDUE แล้วจากรอบค่าปรับคืนก่อน)
 * · ไม่รันรอบค่าปรับ 00:00 (`calculateLateFees`): SQL ของมันแปลงเวลาตาม time zone ของ session ฐานข้อมูล — ฐานบนเครื่อง (Asia/Bangkok) ทำให้
 * งวดที่ครบกำหนดวันนี้เป็น OVERDUE ตอน 00:00 ซึ่งไม่เกิดบน prod (Cloud SQL ใช้ UTC) · รอบนี้ไม่ส่งข้อความ
 *
 * - รอบ 3 C1: เดิม A1/A2 เลือกงวดตามวัน UTC ⇒ A1 ส่ง T-4/T-2/T-1 · A2 ส่ง T0 "เลยกำหนด 0 วัน"/T+2/T+6
 * - รอบ 4 I2 (รีวิวรอบ 3): สเปคเดิมไม่รันรอบกลางคืน — วันเปลี่ยนเป็น OVERDUE (T+7) ลูกค้าได้ A3 08:05 + A2 09:00 ของงวดเดียวกัน ⇒
 *   A2/บอทเห็นข้อความทวงระดับสัญญาที่ส่งแล้ววันนี้ (`contractDunningSentToday` — เจ้าของ: ข้อความทวงหลังครบกำหนดวันละข้อความเดียว)
 * - รอบ 5 (เจ้าของ 01/11 ข้อ 2): งวดนับเป็น "พลาด" หลังสิ้นวันครบกำหนด ⇒ วันครบกำหนดงวด 2 สัญญายังเป็น OVERDUE (บอทเตือนงวด 2 อย่างเดียว)
 *   และเปลี่ยนเป็น DEFAULT คืนถัดไป (T+1 ของงวด 2: แจ้งสถานะอย่างเดียว — A2 ไม่ดูสัญญา DEFAULT · บอททวง T+1 เว้นให้ข้อความทวงของสัญญา)
 * - รอบ 5 (เจ้าของ 01/11 ข้อ 1): สัญญาที่ได้ข้อความทวงแล้ววันนี้ไม่ได้**เตือนค่างวด**วันนั้นด้วย (A1 / A6 / บอทเตือน) — ข้ามหมวด REMINDER/DUNNING
 */
import { PrismaClient } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { ComplianceService } from './compliance.service';
import { HolidayService } from './holiday.service';
import { NotificationTemplateService } from './notification-template.service';
import { PDPAService } from '../pdpa/pdpa.service';
import { AutoTriggerService } from '../chatbot-finance/services/auto-trigger.service';
import { CollectionsNotifierService } from './services/collections-notifier.service';
import { OverdueLifecycleCronService } from '../overdue/services/overdue-lifecycle-cron.service';
import { ConsecutiveMissedService } from '../overdue/consecutive-missed.service';
import {
  FinanceFixtureBase,
  InstallmentFixture,
  assertTestDatabase,
  bangkokAt,
  createFinanceFixtureBase,
  createInstallmentFixture,
  dec,
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
let lifecycle: OverdueLifecycleCronService;
const fixtures: InstallmentFixture[] = [];
const delivered: { to: string; via: string }[] = [];
/** เวลาไทย hh:mm ของนาฬิกาปลอมตอนส่ง + ผู้ส่ง */
const record = (to: string, via: string) => {
  const hhmm = new Date(Date.now() + 7 * 3600_000).toISOString().slice(11, 16);
  delivered.push({ to, via: `${hhmm} ${via}` });
};
/** template ที่ `sendFromTemplate` กำลังส่ง (A4 ขั้นทวง / แจ้งล็อก) — ทาง Flex ของ template ใช้ transport ตัวเดียวกับ A1/A2 */
let templateInFlight: string | null = null;

beforeAll(async () => {
  assertTestDatabase();
  base = await createFinanceFixtureBase(prisma, stamp);
  notifications = new NotificationsService(
    prisma as never,
    { get: jest.fn() } as never,
    {
      paymentReminder: jest.fn(() => ({ type: 'flex', altText: 'A1', contents: {} })),
      overdueNotice: jest.fn(() => ({ type: 'flex', altText: 'A2', contents: {} })),
    } as never,
    { afterPayment: jest.fn(() => []) } as never,
    { getValue: jest.fn().mockResolvedValue('') } as never,
    new ComplianceService(prisma as never, new PDPAService(prisma as never), new HolidayService()),
    new NotificationTemplateService(prisma as never),
  );
  jest
    .spyOn(notifications.transport, 'sendLineFlexMessage')
    .mockImplementation(async (to: string, flex: { altText?: string }) =>
      record(to, templateInFlight ? `tpl:${templateInFlight}` : (flex.altText ?? 'flex')),
    );
  jest
    .spyOn(notifications.transport, 'sendLine')
    .mockImplementation(async (to: string) => record(to, 'text'));
  jest.spyOn(notifications.transport, 'sendSms').mockResolvedValue('sms');
  const sendFromTemplate = notifications.sendFromTemplate.bind(notifications);
  jest.spyOn(notifications, 'sendFromTemplate').mockImplementation(async (eventType, ...rest) => {
    templateInFlight = eventType;
    try {
      return await sendFromTemplate(eventType, ...rest);
    } finally {
      templateInFlight = null;
    }
  });
  bot = new AutoTriggerService(
    prisma as never,
    { pushText: jest.fn(async (to: string) => record(to, 'bot')) } as never,
    {
      getOrCreate: jest.fn().mockResolvedValue({ id: 'room' }),
      saveMessage: jest.fn().mockResolvedValue({ id: 'msg' }),
    } as never,
    { bankInfoBlock: '🏦 ทดสอบ' } as never,
  );
  collections = new CollectionsNotifierService(
    prisma as never,
    {
      // A3 (แจ้งสถานะ — "แจ้งค้างชำระ: …") และ A6 (การ์ดลิงก์ชำระ — "แจ้งเตือน: …") ใช้ทางเดียวกัน
      sendFlexMessage: jest.fn(async (to: string, flex: { altText: string }) =>
        record(to, flex.altText.startsWith('แจ้งค้างชำระ') ? 'A3' : 'A6'),
      ),
    } as never,
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
  lifecycle = new OverdueLifecycleCronService(
    prisma as never,
    new ConsecutiveMissedService(prisma as never),
  );
});

afterAll(async () => {
  jest.useRealTimers();
  await retireFixtures(prisma, fixtures);
  await prisma.$disconnect();
});

it('วันครบกำหนดเที่ยงคืนไทย + ทุกรอบของวันจริง → ข้อความตรงตารางของเจ้าของ (ทวงหลังครบกำหนดวันละหนึ่งข้อความต่อสัญญา)', async () => {
  useFakeDate(bangkokAt(day, 0, 0, 0));
  // สัญญาเลยกำหนด 1–7 วันยังเป็น ACTIVE (เปลี่ยนเป็น OVERDUE คืน T+7) · ทุกงวดยังไม่จ่าย
  const offsets = [5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6, -7];
  const byOffset = new Map<number, InstallmentFixture>();
  for (const k of offsets) {
    const f = await createInstallmentFixture(prisma, base, {
      label: `due${k}`,
      dueDate: dueDateBkk(day, k),
      paymentStatus: k < 0 ? 'OVERDUE' : 'PENDING',
      contractStatus: 'ACTIVE',
    });
    fixtures.push(f);
    byOffset.set(k, f);
  }
  // T+8: เปลี่ยนเป็น OVERDUE + ขั้น REMINDER เมื่อคืนก่อน (T+7) → คืนนี้เลื่อนเป็น NOTICE
  const t8 = await createInstallmentFixture(prisma, base, {
    label: 'due-8',
    dueDate: dueDateBkk(day, -8),
    paymentStatus: 'OVERDUE',
    contractStatus: 'OVERDUE',
  });
  await prisma.contract.update({
    where: { id: t8.contractId },
    data: { dunningStage: 'REMINDER' },
  });
  // สัญญา OVERDUE (ขั้น NOTICE แล้ว): งวด 1 ค้าง + งวด 2 ครบกำหนดตาม `secondDue` (วันไทยเทียบวันนี้) ยังไม่จ่าย
  const overdueWithSecond = async (label: string, secondDue: number) => {
    const f = await createInstallmentFixture(prisma, base, {
      label,
      dueDate: dueDateBkk(day, secondDue - 30),
      paymentStatus: 'OVERDUE',
      contractStatus: 'OVERDUE',
    });
    await prisma.contract.update({ where: { id: f.contractId }, data: { dunningStage: 'NOTICE' } });
    const second = await prisma.payment.create({
      data: {
        contractId: f.contractId,
        installmentNo: 2,
        dueDate: dueDateBkk(day, secondDue),
        amountDue: dec('1515.83'),
        lateFee: dec('0.00'),
        status: secondDue < 0 ? 'OVERDUE' : 'PENDING',
      },
    });
    fixtures.push(f, { ...f, paymentId: second.id });
    return f;
  };
  // วันครบกำหนดงวด 2 — งวด 2 ยังไม่นับเป็นพลาด ⇒ ยังไม่เปลี่ยนเป็น DEFAULT (รอบ 5)
  const secondDueToday = await overdueWithSecond('second0', 0);
  // วันถัดจากวันครบกำหนดงวด 2 — คืนนี้ OVERDUE → DEFAULT
  const def = await overdueWithSecond('default', -1);
  // ตารางงวดถี่ (เช่นสัญญานำเข้า): งวด 1 เลยกำหนด 7 วัน (คืนนี้ ACTIVE → OVERDUE) + งวด 2 ครบกำหนดพรุ่งนี้ (บอทเตือน T-1 ดูสัญญา OVERDUE)
  const flipWithReminder = await createInstallmentFixture(prisma, base, {
    label: 'flipT-1',
    dueDate: dueDateBkk(day, -7),
    paymentStatus: 'OVERDUE',
    contractStatus: 'ACTIVE',
  });
  const flipSecond = await prisma.payment.create({
    data: {
      contractId: flipWithReminder.contractId,
      installmentNo: 2,
      dueDate: dueDateBkk(day, 1),
      amountDue: dec('1515.83'),
      lateFee: dec('0.00'),
      status: 'PENDING',
    },
  });
  fixtures.push(t8, flipWithReminder, { ...flipWithReminder, paymentId: flipSecond.id });

  // รอบกลางคืน
  jest.setSystemTime(bangkokAt(day, 0, 0, 30));
  const statuses = await lifecycle.updateContractStatuses();
  jest.setSystemTime(bangkokAt(day, 0, 1, 0));
  await lifecycle.escalateDunningStages();
  expect(statuses.overdueIds).toContain(byOffset.get(-7)!.contractId);
  expect(statuses.defaultIds).toContain(def.contractId);
  expect(statuses.defaultIds).not.toContain(secondDueToday.contractId);

  // รอบเช้า
  jest.setSystemTime(bangkokAt(day, 0, 8, 0));
  const a1 = await notifications.sendPaymentReminders();
  jest.setSystemTime(bangkokAt(day, 0, 8, 5));
  await collections.sendOvernightCollectionsNotices();
  jest.setSystemTime(bangkokAt(day, 0, 8, 30));
  await collections.sendAutoPaymentLinks();
  jest.setSystemTime(bangkokAt(day, 0, 9, 0));
  await bot.runDailyReminders();
  const a2 = await notifications.sendOverdueNotices();
  jest.setSystemTime(bangkokAt(day, 0, 10, 0));
  await bot.runDailyEscalations();

  const received = (f: InstallmentFixture) =>
    delivered.filter((d) => d.to === f.lineUserId).map((d) => d.via);
  const expected: Record<string, string[]> = {
    'T-5': ['09:00 bot'],
    'T-4': [],
    'T-3': ['08:30 A6'],
    'T-2': [],
    'T-1': ['08:00 A1'],
    T0: ['08:00 A1'],
    'T+1': ['09:00 A2'],
    'T+2': [],
    'T+3': ['09:00 A2'],
    'T+4': [],
    'T+5': [],
    'T+6': [],
    // เปลี่ยนเป็น OVERDUE + ขั้น REMINDER คืนนี้: แจ้งสถานะแทนข้อความขั้นทวง · A2 T+7 เห็นข้อความทวงของสัญญาแล้ว = ไม่ส่ง
    'T+7': ['08:05 A3'],
    // เลื่อนเป็น NOTICE คืนนี้ (เดิมส่ง 01:00)
    'T+8': ['08:05 tpl:dunning.notice'],
    // วันครบกำหนดงวด 2: สัญญายัง OVERDUE (งวด 2 ยังไม่พลาด) — บอทเตือนงวด 2 (T0) อย่างเดียว · A1 ดูเฉพาะสัญญา ACTIVE
    'งวด 2 T0': ['09:00 bot'],
    // วันถัดไป: เปลี่ยนเป็น DEFAULT คืนนี้ → แจ้งสถานะอย่างเดียว (A2 ไม่ดูสัญญา DEFAULT · บอททวง T+1 เว้นให้ — เจ้าของ 01/11 ข้อ 1)
    'DEFAULT (งวด 2 T+1)': ['08:05 A3'],
    // เจ้าของ 01/11 ข้อ 1 — สัญญาที่ได้ข้อความทวงแล้ววันนี้ไม่ได้เตือนค่างวดด้วย (บอทเตือน T-1 ของงวด 2 เว้นให้แจ้งสถานะ)
    'เปลี่ยนเป็น OVERDUE + งวด 2 T-1': ['08:05 A3'],
  };
  const label = (k: number) => (k === 0 ? 'T0' : k > 0 ? `T-${k}` : `T+${-k}`);
  expect({
    ...Object.fromEntries(offsets.map((k) => [label(k), received(byOffset.get(k)!)])),
    'T+8': received(t8),
    'งวด 2 T0': received(secondDueToday),
    'DEFAULT (งวด 2 T+1)': received(def),
    'เปลี่ยนเป็น OVERDUE + งวด 2 T-1': received(flipWithReminder),
  }).toEqual(expected);
  expect(a1.deferredToPayLink).toBeGreaterThanOrEqual(1);

  // ข้อความที่ A1/A2 บันทึกบอกจำนวนวันตามวันไทย · วันครบกำหนด/วันเปลี่ยนสถานะไม่มีแถว "แจ้งค้างชำระ" ของ A2
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
  expect(logOf(-7)).toEqual([]);
  expect(a2.dedupedByContractDunning).toBeGreaterThanOrEqual(1);
}, 120_000);
