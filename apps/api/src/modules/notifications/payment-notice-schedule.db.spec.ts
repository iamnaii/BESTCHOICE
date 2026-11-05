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
 * - รอบ 5 (เจ้าของ 01/11 ข้อ 1) → รอบ 6 I3 (ทาง ก): เตือนค่างวด (A1 / A6 / บอทเตือน) ถูกข้ามเฉพาะเมื่อสัญญาได้ข้อความรอบ 08:05 (แจ้งสถานะ/ขั้นทวง)
 *   วันนั้น **และ** งวดครบกำหนดแล้ว (อยู่ในยอดของข้อความนั้น) · ข้อความทวงอื่น (ปลดล็อก · ไม่รับสาย · แจ้งล็อก 01:30) ไม่บอกงวด/ยอด ⇒ ไม่ข้าม
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
import { DunningEngineService } from '../overdue/dunning-engine.service';
import { DunningRuleResolverService } from '../overdue/dunning-rule-resolver.service';
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
import { useSeededEventDunningRules } from './__tests__/event-dunning-rules';
import { upsertSystemUser } from '../../../prisma/seeds/collections-foundation.seed';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const prisma = new PrismaClient();
const stamp = `t30c-${Date.now()}`;
const day = realBangkokDate();
let base: FinanceFixtureBase;
/** กฎทวงตามเหตุการณ์ของสเปค (ข้อความจาก seed) — CI ไม่ seed ฐาน */
let restoreEventRules: () => Promise<void> = async () => {};
let notifications: NotificationsService;
let bot: AutoTriggerService;
let collections: CollectionsNotifierService;
let lifecycle: OverdueLifecycleCronService;
let engine: DunningEngineService;
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
  // ผู้ใช้ระบบ (ผู้บันทึกของรอบกลางคืน) — แถวเดียวกับ seed · CI ไม่ seed ฐาน
  await upsertSystemUser(prisma as never);
  restoreEventRules = await useSeededEventDunningRules(prisma, stamp, [
    'DEVICE_UNLOCKED',
    'CALL_NO_ANSWER',
  ]);
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
  // กฎทวงตามเหตุการณ์ (ปลดล็อก · ไม่รับสาย) — กฎที่ seed ไว้ในฐาน ส่งผ่าน `send()` (ทางข้อความ)
  engine = new DunningEngineService(
    prisma as never,
    {} as never,
    notifications,
    { createPaymentLink: jest.fn(async () => ({ url: 'https://pay.test/y' })) } as never,
    new DunningRuleResolverService(prisma as never),
  );
});

afterAll(async () => {
  jest.useRealTimers();
  await retireFixtures(prisma, fixtures);
  await restoreEventRules();
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
  fixtures.push(t8);
  // งวด 1 ครบกำหนด `firstDue` + งวด 2 ครบกำหนด `secondDue` (วันไทยเทียบวันนี้ · ตารางงวดถี่ เช่นสัญญานำเข้า) — บอทเตือนดูสัญญา OVERDUE ด้วย
  const twoInstallments = async (
    label: string,
    firstDue: number,
    secondDue: number,
    contract: { status: 'ACTIVE' | 'OVERDUE'; stage?: 'REMINDER' | 'NOTICE' },
  ) => {
    const f = await createInstallmentFixture(prisma, base, {
      label,
      dueDate: dueDateBkk(day, firstDue),
      paymentStatus: 'OVERDUE',
      contractStatus: contract.status,
    });
    if (contract.stage) {
      await prisma.contract.update({
        where: { id: f.contractId },
        data: { dunningStage: contract.stage },
      });
    }
    const second = await prisma.payment.create({
      data: {
        contractId: f.contractId,
        installmentNo: 2,
        dueDate: dueDateBkk(day, secondDue),
        amountDue: dec('1515.83'),
        lateFee: dec('0.00'),
        status: 'PENDING',
      },
    });
    fixtures.push(f, { ...f, paymentId: second.id });
    return f;
  };
  // คืนนี้ ACTIVE → OVERDUE (งวด 1 เลยกำหนด 7 วัน) + งวด 2 ครบกำหนดพรุ่งนี้ / วันนี้
  const flipWithReminder = await twoInstallments('flipT-1', -7, 1, { status: 'ACTIVE' });
  const flipDueToday = await twoInstallments('flipT0', -7, 0, { status: 'ACTIVE' });
  // คืนนี้เลื่อนขั้น REMINDER → NOTICE (งวด 1 เลยกำหนด 8 วัน) + งวด 2 ครบกำหนดวันนี้
  const escalateDueToday = await twoInstallments('escT0', -8, 0, {
    status: 'OVERDUE',
    stage: 'REMINDER',
  });
  // ตารางของผู้รีวิวรอบ 4–5 (I3): ข้อความทวงของสัญญาที่ไม่บอกงวด/ยอดของงวดที่จะเตือน
  const unlocked = await twoInstallments('unlockT-1', -20, 1, {
    status: 'OVERDUE',
    stage: 'NOTICE',
  });
  const noAnswer = await twoInstallments('noAnsT-1', -20, 1, {
    status: 'OVERDUE',
    stage: 'NOTICE',
  });
  const lockedNight = await twoInstallments('lockT0', -30, 0, {
    status: 'OVERDUE',
    stage: 'NOTICE',
  });
  // จ่ายไล่ทันแล้วแต่สถานะค้าง OVERDUE (ไม่มีงวดที่ถึงกำหนดค้าง) — รอบ 00:30 คืนเป็น ACTIVE (Step 1b · เจ้าของ 05/11)
  // งวด 2 ครบกำหนดอีก `nextDue` วัน (ยังไม่จ่าย) · ขั้นทวงค้าง NOTICE จากรอบที่ค้างก่อนหน้า
  const caughtUp = async (label: string, nextDue: number) => {
    const f = await createInstallmentFixture(prisma, base, {
      label,
      dueDate: dueDateBkk(day, -20),
      paymentStatus: 'PAID',
      contractStatus: 'OVERDUE',
    });
    await prisma.payment.update({
      where: { id: f.paymentId },
      data: { amountPaid: dec('1515.83'), paidDate: dueDateBkk(day, -2) },
    });
    await prisma.contract.update({ where: { id: f.contractId }, data: { dunningStage: 'NOTICE' } });
    const next = await prisma.payment.create({
      data: {
        contractId: f.contractId,
        installmentNo: 2,
        dueDate: dueDateBkk(day, nextDue),
        amountDue: dec('1515.83'),
        lateFee: dec('0.00'),
        status: 'PENDING',
      },
    });
    fixtures.push(f, { ...f, paymentId: next.id });
    return f;
  };
  const caughtUpFar = await caughtUp('caughtUpT-10', 10);
  const caughtUpTomorrow = await caughtUp('caughtUpT-1', 1);

  // รอบกลางคืน
  jest.setSystemTime(bangkokAt(day, 0, 0, 30));
  const statuses = await lifecycle.updateContractStatuses();
  jest.setSystemTime(bangkokAt(day, 0, 1, 0));
  await lifecycle.escalateDunningStages();
  // 01:30 แจ้งล็อก — การเรียกเดียวกับ `MdmAutoService.notifyCustomerLock` (ไม่แตะ MDM)
  jest.setSystemTime(bangkokAt(day, 0, 1, 30));
  await notifications.sendFromTemplate(
    'mdm.lock_notice',
    { name: 'ทดสอบ', contractNumber: lockedNight.contractNumber, daysOverdue: '30' },
    lockedNight.lineUserId,
    { relatedId: lockedNight.contractId, customerId: lockedNight.customerId },
  );
  expect(statuses.overdueIds).toContain(byOffset.get(-7)!.contractId);
  expect(statuses.defaultIds).toContain(def.contractId);
  expect(statuses.defaultIds).not.toContain(secondDueToday.contractId);
  expect(statuses.recoveredIds).toEqual(
    expect.arrayContaining([caughtUpFar.contractId, caughtUpTomorrow.contractId]),
  );
  // ไม่มีสัญญาที่ยังค้างงวดถึงกำหนดถูกคืนเป็น ACTIVE
  for (const f of [t8, secondDueToday, def, escalateDueToday, unlocked, noAnswer, lockedNight]) {
    expect(statuses.recoveredIds).not.toContain(f.contractId);
  }

  // รอบเช้า
  jest.setSystemTime(bangkokAt(day, 0, 8, 0));
  const a1 = await notifications.sendPaymentReminders();
  jest.setSystemTime(bangkokAt(day, 0, 8, 5));
  await collections.sendOvernightCollectionsNotices();
  jest.setSystemTime(bangkokAt(day, 0, 8, 30));
  await collections.sendAutoPaymentLinks();
  jest.setSystemTime(bangkokAt(day, 0, 8, 40));
  await engine.executeEventTrigger('DEVICE_UNLOCKED', unlocked.contractId, null, null);
  jest.setSystemTime(bangkokAt(day, 0, 8, 50));
  await engine.executeEventTrigger('CALL_NO_ANSWER', noAnswer.contractId, null, null);
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
    // รอบ 6 I3 (ทาง ก) — เตือนค่างวดถูกข้ามเฉพาะงวดที่อยู่ในยอดของข้อความรอบ 08:05 (ครบกำหนดแล้ว)
    'เปลี่ยนเป็น OVERDUE + งวด 2 T-1': ['08:05 A3', '09:00 bot'], // งวด 2 ยังไม่ครบ — ไม่อยู่ในยอดแจ้งสถานะ
    'เปลี่ยนเป็น OVERDUE + งวด 2 T0': ['08:05 A3'], // งวด 2 อยู่ในยอดแจ้งสถานะแล้ว
    'เลื่อนขั้น NOTICE + งวด 2 T0': ['08:05 tpl:dunning.notice'], // อยู่ในยอดข้อความขั้นทวงแล้ว
    // ข้อความทวงที่ไม่บอกงวด/ยอดของงวดนั้นไม่ทำให้เตือนถูกข้าม
    'ปลดล็อก 08:40 + งวด 2 T-1': ['08:40 text', '09:00 bot'],
    'ไม่รับสาย 08:50 + งวด 2 T-1': ['08:50 text', '09:00 bot'],
    'แจ้งล็อก 01:30 + งวด 2 T0': ['01:30 tpl:mdm.lock_notice', '09:00 bot'],
    // คืนเป็น ACTIVE คืนนี้ (Step 1b): การคืนสถานะเองไม่ส่งอะไร (A3 08:05 อ่านเฉพาะแถวที่ไป OVERDUE/DEFAULT)
    'คืนเป็น ACTIVE + งวด 2 T-10': [],
    // …แล้วได้เตือนค่างวดตามปกติของสัญญา ACTIVE ข้อความเดียว (เหมือน T-1 ข้างบน)
    'คืนเป็น ACTIVE + งวด 2 T-1': ['08:00 A1'],
  };
  const label = (k: number) => (k === 0 ? 'T0' : k > 0 ? `T-${k}` : `T+${-k}`);
  expect({
    ...Object.fromEntries(offsets.map((k) => [label(k), received(byOffset.get(k)!)])),
    'T+8': received(t8),
    'งวด 2 T0': received(secondDueToday),
    'DEFAULT (งวด 2 T+1)': received(def),
    'เปลี่ยนเป็น OVERDUE + งวด 2 T-1': received(flipWithReminder),
    'เปลี่ยนเป็น OVERDUE + งวด 2 T0': received(flipDueToday),
    'เลื่อนขั้น NOTICE + งวด 2 T0': received(escalateDueToday),
    'ปลดล็อก 08:40 + งวด 2 T-1': received(unlocked),
    'ไม่รับสาย 08:50 + งวด 2 T-1': received(noAnswer),
    'แจ้งล็อก 01:30 + งวด 2 T0': received(lockedNight),
    'คืนเป็น ACTIVE + งวด 2 T-10': received(caughtUpFar),
    'คืนเป็น ACTIVE + งวด 2 T-1': received(caughtUpTomorrow),
  }).toEqual(expected);
  expect(a1.deferredToPayLink).toBeGreaterThanOrEqual(1);
  // รอบ 6 m7 — กฎไม่รับสายจากทางโทร (ไม่ระบุงวด) บอกงวด/ยอดของงวดค้างที่เก่าที่สุด ไม่ใช่ "งวดที่  ยอด  ฿"
  const noAnswerLog = await prisma.notificationLog.findFirst({
    where: { relatedId: noAnswer.contractId, status: 'SENT', channel: 'LINE' },
    select: { message: true },
  });
  expect(noAnswerLog?.message).toContain('งวดที่ 1 ยอด 1,515.83');

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
